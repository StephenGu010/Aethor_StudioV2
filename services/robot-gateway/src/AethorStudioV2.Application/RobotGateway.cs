using System.Text;
using System.Security.Cryptography;
using System.Threading.Channels;
using AethorStudioV2.Domain;

namespace AethorStudioV2.Application;

public sealed class RobotGateway : IAsyncDisposable
{
    private readonly IAsciiTransportFactory transportFactory;
    private readonly ISerialPortCatalog portCatalog;
    private readonly IRobotGatewayEventSink eventSink;
    private readonly IGatewayDiagnostics diagnostics;
    private readonly TimeProvider timeProvider;
    private readonly RobotGatewayOptions options;
    private readonly SemaphoreSlim lifecycleGate = new(1, 1);
    private readonly SemaphoreSlim serialIoGate = new(1, 1);
    private readonly SemaphoreSlim commandGate = new(1, 1);
    private readonly object stateGate = new();
    private readonly object commandStateGate = new();
    private readonly Queue<ProtocolFrame> protocolFrames = new();
    private readonly Dictionary<string, CommandEntry> commandEntries = new(StringComparer.Ordinal);
    private readonly Queue<string> commandOrder = new();
    private readonly Channel<GatewayEvent> eventQueue;
    private readonly CancellationTokenSource eventPumpCancellation = new();
    private readonly Task eventPumpTask;

    private RobotSessionSnapshot session;
    private JointStateFrame jointState;
    private IAsciiTransport? activeTransport;
    private CancellationTokenSource? pollingCancellation;
    private Task? pollingTask;
    private TaskCompletionSource? disconnectCompletion;
    private CancellationTokenSource? activeDirectCommandCancellation;
    private TaskCompletionSource? activeDirectCommandCompletion;
    private string? exclusiveCommandId;
    private int commandDemand;
    private int commandInterlockLatched;
    private bool disposed;

    public RobotGateway(
        IAsciiTransportFactory transportFactory,
        ISerialPortCatalog portCatalog,
        IRobotGatewayEventSink? eventSink = null,
        IGatewayDiagnostics? diagnostics = null,
        TimeProvider? timeProvider = null,
        RobotGatewayOptions? options = null)
    {
        this.transportFactory = transportFactory;
        this.portCatalog = portCatalog;
        this.eventSink = eventSink ?? new NullGatewayEventSink();
        this.diagnostics = diagnostics ?? new NullGatewayDiagnostics();
        this.timeProvider = timeProvider ?? TimeProvider.System;
        this.options = options ?? new RobotGatewayOptions();
        this.options.Validate();

        var now = this.timeProvider.GetUtcNow();
        session = OfflineSession(now);
        jointState = UnavailableJointState(now);
        eventQueue = Channel.CreateBounded<GatewayEvent>(new BoundedChannelOptions(this.options.EventQueueCapacity)
        {
            SingleReader = true,
            SingleWriter = false,
            FullMode = BoundedChannelFullMode.DropOldest
        });
        eventPumpTask = PumpEventsAsync(eventPumpCancellation.Token);
        var supportedCommands = new List<RobotCommandKind>();
        if (this.options.HardwareCommandsEnabled)
        {
            supportedCommands.AddRange([
                RobotCommandKind.Enable,
                RobotCommandKind.StopAndDisable,
                RobotCommandKind.SetMode
            ]);
            if (this.options.JointGroupSpeedLimitDegS is not null
                && this.options.JointGroupCompletion is not null)
            {
                supportedCommands.Add(RobotCommandKind.JointGroup);
            }
        }

        Capabilities = new(
            GatewayContractV1.Version,
            GatewayContractV1.DummyProtocolAdapterId,
            SerialEnumeration: true,
            ReadOnlyConnection: true,
            LiveTelemetry: true,
            HardwareCommands: this.options.HardwareCommandsEnabled,
            DirectCommand: this.options.EngineeringCommandsEnabled,
            CommandPolicy: this.options.EngineeringCommandsEnabled
                ? GatewayCommandPolicy.Engineering
                : this.options.HardwareCommandsEnabled
                    ? GatewayCommandPolicy.Supervised
                    : GatewayCommandPolicy.Disabled,
            AllowedQueries: ["#GETJPOS", "#GETMODE", "#GETENABLE"],
            SupportedCommands: supportedCommands,
            JointGroupSpeedLimitDegS: this.options.JointGroupSpeedLimitDegS,
            JointGroupCompletion: this.options.JointGroupCompletion,
            EngineeringJointSpeedMaxDegS: this.options.EngineeringCommandsEnabled
                ? this.options.EngineeringJointSpeedMaxDegS
                : null);
    }

    public RobotGatewayCapabilities Capabilities { get; }

    public RobotSessionSnapshot GetSession()
    {
        lock (stateGate)
        {
            return session;
        }
    }

    public JointStateFrame GetJointState()
    {
        lock (stateGate)
        {
            return jointState with { PositionsDeg = [.. jointState.PositionsDeg] };
        }
    }

    public IReadOnlyList<ProtocolFrame> GetProtocolFrames(int limit = 100)
    {
        if (limit is < 1 or > 500)
        {
            throw new GatewayValidationException("Protocol frame limit must be between 1 and 500");
        }

        lock (stateGate)
        {
            return protocolFrames.TakeLast(limit).ToArray();
        }
    }

    public IReadOnlyList<CommandAuditRecord> GetCommandHistory(int limit = 50)
    {
        if (limit is < 1 or > 500)
        {
            throw new GatewayValidationException("Command history limit must be between 1 and 500");
        }

        lock (commandStateGate)
        {
            return commandOrder
                .TakeLast(limit)
                .Select(commandId => ToAuditRecord(commandEntries[commandId]))
                .ToArray();
        }
    }

    public CommandAuditRecord? GetCommand(string commandId)
    {
        if (string.IsNullOrWhiteSpace(commandId))
        {
            throw new GatewayValidationException("Command ID is required");
        }

        lock (commandStateGate)
        {
            return commandEntries.TryGetValue(commandId, out var entry)
                ? ToAuditRecord(entry)
                : null;
        }
    }

    public ValueTask<IReadOnlyList<SerialPortDescriptor>> ListPortsAsync(CancellationToken cancellationToken) =>
        portCatalog.ListAsync(cancellationToken);

    public Task<CommandResult> EnableAsync(SimpleRobotCommand command, CancellationToken cancellationToken) =>
        ExecuteCommandAsync(CommandSpec.From(command, RobotCommandKind.Enable), cancellationToken);

    public Task<CommandResult> StopAndDisableAsync(SimpleRobotCommand command, CancellationToken cancellationToken) =>
        ExecuteCommandAsync(CommandSpec.From(command, RobotCommandKind.StopAndDisable), cancellationToken);

    public Task<CommandResult> HomeAsync(SimpleRobotCommand command, CancellationToken cancellationToken) =>
        ExecuteCommandAsync(CommandSpec.From(command, RobotCommandKind.Home), cancellationToken);

    public Task<CommandResult> ResetAsync(SimpleRobotCommand command, CancellationToken cancellationToken) =>
        ExecuteCommandAsync(CommandSpec.From(command, RobotCommandKind.Reset), cancellationToken);

    public Task<CommandResult> SetModeAsync(SetModeCommand command, CancellationToken cancellationToken) =>
        ExecuteCommandAsync(CommandSpec.From(command), cancellationToken);

    public Task<CommandResult> SendJointGroupAsync(JointGroupCommand command, CancellationToken cancellationToken) =>
        ExecuteCommandAsync(CommandSpec.From(command), cancellationToken);

    public async Task<DirectCommandResult> SendDirectAsync(
        DirectCommandRequest request,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var fallbackLine = NormalizeRejectedDirectLine(request.Line);
        if (!options.EngineeringCommandsEnabled)
        {
            return DirectResult(
                request,
                DirectCommandStatus.Rejected,
                CommandEvidence.None,
                fallbackLine,
                "Direct command is available only in the local engineering gateway policy");
        }

        if (!IsValidDirectIdentity(request, out var identityError))
        {
            return DirectResult(
                request,
                DirectCommandStatus.Rejected,
                CommandEvidence.None,
                fallbackLine,
                identityError);
        }

        if (!DummyAsciiProtocol.TryParseEngineeringCommand(
            request.Line,
            options.EngineeringJointSpeedMaxDegS,
            out var command,
            out var parseError))
        {
            return DirectResult(
                request,
                DirectCommandStatus.Rejected,
                CommandEvidence.None,
                fallbackLine,
                parseError);
        }

        var parsedCommand = command!;

        var current = GetSession();
        if (!string.Equals(request.SessionId, current.SessionId, StringComparison.Ordinal)
            || !string.Equals(request.ProfileId, current.ProfileId, StringComparison.Ordinal))
        {
            return DirectResult(request, DirectCommandStatus.Rejected, CommandEvidence.None, parsedCommand.NormalizedLine, "命令会话与当前连接不匹配");
        }

        var transport = activeTransport;
        if (current.ConnectionState != ConnectionState.Connected || transport?.IsOpen != true)
        {
            return DirectResult(request, DirectCommandStatus.Rejected, CommandEvidence.None, parsedCommand.NormalizedLine, "Dummy 串口未连接");
        }

        var commandValidation = ValidateDirectCommand(parsedCommand, current);
        if (commandValidation is not null)
        {
            return DirectResult(request, DirectCommandStatus.Rejected, CommandEvidence.None, parsedCommand.NormalizedLine, commandValidation);
        }

        using var executionCancellation = new CancellationTokenSource(TimeSpan.FromMilliseconds(
            Math.Max(500, options.CommandTimeout.TotalMilliseconds * 3)));
        var directCompletion = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        lock (commandStateGate)
        {
            if (exclusiveCommandId is not null || activeDirectCommandCancellation is not null)
            {
                return DirectResult(request, DirectCommandStatus.Rejected, CommandEvidence.None, parsedCommand.NormalizedLine, "已有硬件命令正在执行");
            }

            activeDirectCommandCancellation = executionCancellation;
            activeDirectCommandCompletion = directCompletion;
        }

        Interlocked.Increment(ref commandDemand);
        var ownsCommandGate = false;
        var ownsSerialIo = false;
        try
        {
            ownsCommandGate = await commandGate
                .WaitAsync(options.CommandTimeout, executionCancellation.Token)
                .ConfigureAwait(false);
            if (!ownsCommandGate)
            {
                return DirectResult(request, DirectCommandStatus.Rejected, CommandEvidence.None, parsedCommand.NormalizedLine, "串口已有命令正在执行");
            }

            ownsSerialIo = await serialIoGate
                .WaitAsync(options.CommandTimeout, executionCancellation.Token)
                .ConfigureAwait(false);
            if (!ownsSerialIo)
            {
                MarkFeedbackStale();
                return DirectResult(request, DirectCommandStatus.TimedOut, CommandEvidence.None, parsedCommand.NormalizedLine, "未能在期限内取得串口所有权；命令未发送");
            }

            if (!ReferenceEquals(activeTransport, transport)
                || GetSession().ConnectionState != ConnectionState.Connected)
            {
                return DirectResult(request, DirectCommandStatus.Rejected, CommandEvidence.None, parsedCommand.NormalizedLine, "串口会话已变化，命令未发送");
            }

            var decoder = new DummyAsciiLineDecoder();
            var readBuffer = new byte[options.ReadBufferBytes];
            var response = await SendAndWaitAsync(
                transport,
                parsedCommand.NormalizedLine,
                DirectParsedKind(parsedCommand.Kind),
                candidate => IsExpectedDirectResponse(parsedCommand, candidate),
                decoder,
                readBuffer,
                request.SessionId,
                request.RequestId,
                executionCancellation.Token).ConfigureAwait(false);

            if (parsedCommand.Kind == DummyDirectCommandKind.JointGroup)
            {
                if (response.QueueAccepted != true)
                {
                    return DirectResult(request, DirectCommandStatus.Rejected, CommandEvidence.GatewayAccepted, parsedCommand.NormalizedLine, "设备命令队列已满，目标未被接受", response.Raw);
                }

                return DirectResult(request, DirectCommandStatus.Queued, CommandEvidence.DeviceQueued, parsedCommand.NormalizedLine, "设备已接受六轴目标；仅表示进入固件队列，尚未验证机械臂到位", response.Raw);
            }

            var evidence = parsedCommand.Kind is DummyDirectCommandKind.QueryJointPositions
                or DummyDirectCommandKind.QueryMode
                or DummyDirectCommandKind.QueryEnable
                ? CommandEvidence.FeedbackConfirmed
                : CommandEvidence.DeviceAck;
            return DirectResult(request, DirectCommandStatus.Replied, evidence, parsedCommand.NormalizedLine, "设备已返回匹配应答", response.Raw);
        }
        catch (GatewayQueryTimeoutException exception)
        {
            MarkDirectCommandUnconfirmed(parsedCommand.Kind);
            return DirectResult(request, DirectCommandStatus.TimedOut, CommandEvidence.GatewayAccepted, parsedCommand.NormalizedLine, "设备应答超时；物理结果未知", exception.Message);
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or InvalidOperationException or TimeoutException or OperationCanceledException)
        {
            MarkDirectCommandUnconfirmed(parsedCommand.Kind);
            return DirectResult(request, DirectCommandStatus.Failed, CommandEvidence.GatewayAccepted, parsedCommand.NormalizedLine, "直连命令失败；物理结果未知", SafeExceptionMessage(exception));
        }
        finally
        {
            if (ownsSerialIo) serialIoGate.Release();
            if (ownsCommandGate) commandGate.Release();
            Interlocked.Decrement(ref commandDemand);
            lock (commandStateGate)
            {
                if (ReferenceEquals(activeDirectCommandCancellation, executionCancellation))
                {
                    activeDirectCommandCancellation = null;
                    activeDirectCommandCompletion = null;
                }
            }
            directCompletion.TrySetResult();
        }
    }

    public async Task<RobotSessionSnapshot> ConnectAsync(
        RobotConnectRequest request,
        CancellationToken cancellationToken)
    {
        ValidateConnectRequest(request);
        await lifecycleGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            ThrowIfDisposed();
            if (activeTransport is not null
                || HasRunningCommand()
                || GetSession().ConnectionState is ConnectionState.Connecting or ConnectionState.Connected or ConnectionState.Disconnecting)
            {
                throw new GatewayConflictException("A robot session is already active");
            }

            var availablePorts = await portCatalog.ListAsync(cancellationToken).ConfigureAwait(false);
            if (!availablePorts.Any(port => string.Equals(port.PortName, request.PortName, StringComparison.OrdinalIgnoreCase)))
            {
                throw new GatewayValidationException("Selected serial port is not currently enumerated");
            }

            var sessionId = Guid.NewGuid().ToString("N");
            ResetSessionEvidence();
            Interlocked.Exchange(ref commandInterlockLatched, 0);
            UpdateSession(new(
                sessionId,
                request.ProfileId,
                ConnectionState.Connecting,
                MotorState.Unknown,
                null,
                timeProvider.GetUtcNow(),
                DataSource.Unavailable,
                Validity.Unavailable));

            var transport = transportFactory.Create(request.PortName, DummyAsciiProtocol.BaudRate);
            try
            {
                await transport.OpenAsync(cancellationToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                await DisposeTransportAsync(transport).ConfigureAwait(false);
                UpdateSession(OfflineSession(timeProvider.GetUtcNow()));
                throw;
            }
            catch (Exception exception)
            {
                await DisposeTransportAsync(transport).ConfigureAwait(false);
                UpdateSession(FaultedSession(sessionId, timeProvider.GetUtcNow()));
                diagnostics.Record(new(
                    "serial.open.failed",
                    GatewayDiagnosticSeverity.Error,
                    sessionId,
                    request.PortName,
                    "Serial port could not be opened",
                    exception));
                throw new GatewayDependencyException("Serial port could not be opened", exception);
            }

            activeTransport = transport;
            pollingCancellation = new CancellationTokenSource();
            var connectedSnapshot = new RobotSessionSnapshot(
                sessionId,
                request.ProfileId,
                ConnectionState.Connected,
                MotorState.Unknown,
                null,
                timeProvider.GetUtcNow(),
                DataSource.Measured,
                Validity.Stale);
            UpdateSession(connectedSnapshot);
            pollingTask = PollAsync(transport, sessionId, pollingCancellation.Token);
            diagnostics.Record(new(
                "serial.opened",
                GatewayDiagnosticSeverity.Information,
                sessionId,
                request.PortName,
                "Read-only serial session opened"));
            return connectedSnapshot;
        }
        finally
        {
            lifecycleGate.Release();
        }
    }

    public Task<RobotSessionSnapshot> DisconnectAsync(CancellationToken cancellationToken) =>
        DisconnectCoreAsync(allowPossiblyEnabled: false, cancellationToken);

    public Task<RobotSessionSnapshot> ShutdownAsync(CancellationToken cancellationToken) =>
        DisconnectCoreAsync(allowPossiblyEnabled: true, cancellationToken);

    private async Task<RobotSessionSnapshot> DisconnectCoreAsync(
        bool allowPossiblyEnabled,
        CancellationToken cancellationToken)
    {
        Task? existingDisconnect = null;
        IAsciiTransport? transport = null;
        Task? pollTask = null;
        TaskCompletionSource? completion = null;

        await lifecycleGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            ThrowIfDisposed(allowDisposing: true);
            var disconnectState = GetSession();
            if (!allowPossiblyEnabled
                && options.HardwareCommandsEnabled
                && activeTransport is not null
                && HasRunningCommand())
            {
                throw new GatewayConflictException("Wait for the active hardware command to finish, or use stop and disable, before disconnecting");
            }

            if (!allowPossiblyEnabled
                && options.HardwareCommandsEnabled
                && activeTransport is not null
                && disconnectState.ConnectionState == ConnectionState.Connected
                && disconnectState.MotorState == MotorState.Enabled)
            {
                throw new GatewayConflictException("Stop and confirm motor disabled before releasing the serial session");
            }

            if (disconnectCompletion is not null)
            {
                existingDisconnect = disconnectCompletion.Task;
            }
            else if (activeTransport is null)
            {
                ResetSessionEvidence();
                UpdateSession(OfflineSession(timeProvider.GetUtcNow()));
                UpdateJointState(UnavailableJointState(timeProvider.GetUtcNow()));
                return GetSession();
            }
            else
            {
                completion = new(TaskCreationOptions.RunContinuationsAsynchronously);
                disconnectCompletion = completion;
                transport = activeTransport;
                pollTask = pollingTask;
                activeTransport = null;
                pollingTask = null;
                pollingCancellation?.Cancel();
                pollingCancellation?.Dispose();
                pollingCancellation = null;
                CancelCommandsForDisconnect();
                var current = GetSession();
                UpdateSession(current with
                {
                    ConnectionState = ConnectionState.Disconnecting,
                    MotorState = MotorState.Unknown,
                    ControlMode = null,
                    TimestampUtc = timeProvider.GetUtcNow(),
                    Source = DataSource.Unavailable,
                    Validity = Validity.Unavailable
                });
            }
        }
        finally
        {
            lifecycleGate.Release();
        }

        if (existingDisconnect is not null)
        {
            await existingDisconnect.WaitAsync(cancellationToken).ConfigureAwait(false);
            return GetSession();
        }

        try
        {
            // Closing the handle is the cancellation fallback for Windows serial drivers
            // that do not complete a pending BaseStream read when its token is cancelled.
            // Do this before awaiting runners so shutdown cannot wait forever on native I/O.
            if (transport is not null)
            {
                await CloseTransportAsync(transport).ConfigureAwait(false);
            }

            if (pollTask is not null)
            {
                await pollTask.ConfigureAwait(false);
            }

            await AwaitRunningCommandsAsync().ConfigureAwait(false);

            if (transport is not null)
            {
                await transport.DisposeAsync().ConfigureAwait(false);
            }

            ResetSessionEvidence();
            UpdateJointState(UnavailableJointState(timeProvider.GetUtcNow()));
            UpdateSession(OfflineSession(timeProvider.GetUtcNow()));
            diagnostics.Record(new(
                "serial.closed",
                GatewayDiagnosticSeverity.Information,
                null,
                transport?.PortName,
                "Serial session closed and resources released"));
        }
        finally
        {
            await lifecycleGate.WaitAsync(CancellationToken.None).ConfigureAwait(false);
            try
            {
                disconnectCompletion = null;
                completion?.TrySetResult();
            }
            finally
            {
                lifecycleGate.Release();
            }
        }

        return GetSession();
    }

    public async ValueTask DisposeAsync()
    {
        await lifecycleGate.WaitAsync(CancellationToken.None).ConfigureAwait(false);
        try
        {
            if (disposed)
            {
                return;
            }

            disposed = true;
        }
        finally
        {
            lifecycleGate.Release();
        }

        await ShutdownAsync(CancellationToken.None).ConfigureAwait(false);
        eventQueue.Writer.TryComplete();
        try
        {
            await eventPumpTask.WaitAsync(options.EventShutdownDrainTimeout).ConfigureAwait(false);
        }
        catch (TimeoutException)
        {
            diagnostics.Record(new(
                "events.shutdown.timeout",
                GatewayDiagnosticSeverity.Warning,
                null,
                null,
                $"Event publisher did not drain within {options.EventShutdownDrainTimeout.TotalMilliseconds:F0} ms; cancellation requested"));
            eventPumpCancellation.Cancel();
            try
            {
                await eventPumpTask.WaitAsync(TimeSpan.FromSeconds(1)).ConfigureAwait(false);
            }
            catch (TimeoutException)
            {
                diagnostics.Record(new(
                    "events.shutdown.abandoned",
                    GatewayDiagnosticSeverity.Warning,
                    null,
                    null,
                    "Event publisher ignored cancellation; gateway disposal continued after the bounded abort window"));
            }
        }

        eventPumpCancellation.Cancel();
        eventPumpCancellation.Dispose();
        lifecycleGate.Dispose();
        serialIoGate.Dispose();
        commandGate.Dispose();
    }

    private Task<CommandResult> ExecuteCommandAsync(CommandSpec spec, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var validationMessage = ValidateCommandIdentity(spec);
        if (validationMessage is not null)
        {
            return Task.FromResult(Result(
                spec,
                CommandStatus.Rejected,
                CommandResultCode.InvalidRequest,
                CommandEvidence.None,
                validationMessage));
        }

        if (spec.Kind == RobotCommandKind.StopAndDisable)
        {
            CancelActiveDirectCommand();
        }

        var fingerprint = Fingerprint(spec);
        CommandEntry entry;
        lock (commandStateGate)
        {
            if (commandEntries.TryGetValue(spec.CommandId, out var existing))
            {
                if (string.Equals(existing.Fingerprint, fingerprint, StringComparison.Ordinal))
                {
                    return AwaitCommandAsync(existing.Completion.Task, cancellationToken);
                }

                return Task.FromResult(Result(
                    spec,
                    CommandStatus.Rejected,
                    CommandResultCode.CommandIdConflict,
                    CommandEvidence.None,
                    "commandId 已用于不同请求，拒绝复用"));
            }

            if (activeDirectCommandCancellation is not null
                && spec.Kind != RobotCommandKind.StopAndDisable)
            {
                return Task.FromResult(StoreImmediateResultLocked(
                    spec,
                    fingerprint,
                    CommandStatus.Rejected,
                    CommandResultCode.CommandInFlight,
                    "已有 engineering 命令正在执行；一次只允许一个硬件命令"));
            }

            if (exclusiveCommandId is not null)
            {
                var active = commandEntries[exclusiveCommandId];
                if (spec.Kind != RobotCommandKind.StopAndDisable
                    || active.Spec.Kind == RobotCommandKind.StopAndDisable)
                {
                    return Task.FromResult(StoreImmediateResultLocked(
                        spec,
                        fingerprint,
                        CommandStatus.Rejected,
                        CommandResultCode.CommandInFlight,
                        "已有命令正在执行；一次只允许一个硬件命令"));
                }

                active.ExecutionCancellation.Cancel();
            }

            // This is the command acceptance boundary. A request cancelled before
            // this point must never create an audit entry or reach the transport.
            // Cancellation after this point only stops the caller from waiting;
            // the gateway-owned execution still reaches one auditable terminal state.
            cancellationToken.ThrowIfCancellationRequested();

            entry = new CommandEntry(spec, fingerprint, timeProvider.GetUtcNow());
            commandEntries.Add(spec.CommandId, entry);
            commandOrder.Enqueue(spec.CommandId);
            exclusiveCommandId = spec.CommandId;
            TrimCommandHistoryLocked();
        }

        entry.Runner = RunCommandAsync(entry);
        return AwaitCommandAsync(entry.Completion.Task, cancellationToken);
    }

    private async Task RunCommandAsync(CommandEntry entry)
    {
        CommandResult result;
        var ownsCommandGate = false;
        Interlocked.Increment(ref commandDemand);
        try
        {
            var gateAcquired = entry.Spec.Kind == RobotCommandKind.StopAndDisable
                ? await commandGate.WaitAsync(options.CommandTimeout, entry.ExecutionCancellation.Token).ConfigureAwait(false)
                : await WaitForCommandGateAsync(entry.ExecutionCancellation.Token).ConfigureAwait(false);
            if (!gateAcquired)
            {
                MarkFeedbackStale();
                result = Result(
                    entry.Spec,
                    CommandStatus.Unconfirmed,
                    CommandResultCode.Timeout,
                    CommandEvidence.GatewayAccepted,
                    "停止链未能及时取得串口所有权；请立即使用物理急停并检查设备");
            }
            else
            {
                ownsCommandGate = true;
                result = await ExecuteCommandCoreAsync(entry.Spec, entry.ExecutionCancellation.Token).ConfigureAwait(false);
                if (entry.Spec.Kind != RobotCommandKind.StopAndDisable
                    && entry.ExecutionCancellation.IsCancellationRequested)
                {
                    result = Result(
                        entry.Spec,
                        CommandStatus.Cancelled,
                        CommandResultCode.Cancelled,
                        CommandEvidence.GatewayAccepted,
                        "命令已被停止链取消；迟到回包不能证明机械臂状态");
                }
            }
        }
        catch (OperationCanceledException) when (entry.ExecutionCancellation.IsCancellationRequested)
        {
            result = Result(
                entry.Spec,
                CommandStatus.Cancelled,
                CommandResultCode.Cancelled,
                CommandEvidence.GatewayAccepted,
                "命令已取消；不能据此推断机械臂状态");
        }
        catch (Exception exception) when (
            entry.ExecutionCancellation.IsCancellationRequested
            && exception is IOException or UnauthorizedAccessException or InvalidOperationException)
        {
            result = Result(
                entry.Spec,
                CommandStatus.Cancelled,
                CommandResultCode.Cancelled,
                CommandEvidence.GatewayAccepted,
                "Command was cancelled while the serial session was closing; the physical robot state remains unknown");
        }
        catch (GatewayQueryTimeoutException exception)
        {
            result = Result(
                entry.Spec,
                CommandStatus.TimedOut,
                CommandResultCode.Timeout,
                CommandEvidence.GatewayAccepted,
                "设备响应超时；物理结果未知",
                exception.Message);
        }
        catch (GatewayProtocolException exception)
        {
            result = Result(
                entry.Spec,
                CommandStatus.Failed,
                CommandResultCode.DeviceRejected,
                CommandEvidence.GatewayAccepted,
                "设备拒绝命令或返回非法响应",
                exception.Message);
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or InvalidOperationException or TimeoutException)
        {
            result = Result(
                entry.Spec,
                CommandStatus.Failed,
                CommandResultCode.TransportError,
                CommandEvidence.GatewayAccepted,
                "串口命令失败；物理结果未知",
                SafeExceptionMessage(exception));
        }
        catch (Exception exception)
        {
            diagnostics.Record(new(
                "command.unexpected.failed",
                GatewayDiagnosticSeverity.Error,
                entry.Spec.SessionId,
                activeTransport?.PortName,
                "Unexpected command execution failure",
                exception));
            result = Result(
                entry.Spec,
                CommandStatus.Failed,
                CommandResultCode.TransportError,
                CommandEvidence.GatewayAccepted,
                "网关内部错误；物理结果未知");
        }
        finally
        {
            if (ownsCommandGate)
            {
                commandGate.Release();
            }

            Interlocked.Decrement(ref commandDemand);
        }

        UpdateCommandInterlock(entry.Spec.Kind, result.Status);
        entry.Completion.TrySetResult(result);
        lock (commandStateGate)
        {
            if (string.Equals(exclusiveCommandId, entry.Spec.CommandId, StringComparison.Ordinal))
            {
                exclusiveCommandId = null;
            }

            TrimCommandHistoryLocked();
        }

        EnqueueEvent(new CommandResultEvent(result));
        entry.ExecutionCancellation.Dispose();
    }

    private async Task<bool> WaitForCommandGateAsync(CancellationToken cancellationToken)
    {
        await commandGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        return true;
    }

    private void UpdateCommandInterlock(RobotCommandKind kind, CommandStatus status)
    {
        if (kind == RobotCommandKind.StopAndDisable && status == CommandStatus.Completed)
        {
            Interlocked.Exchange(ref commandInterlockLatched, 0);
            return;
        }

        if (status is CommandStatus.Unconfirmed or CommandStatus.Failed or CommandStatus.TimedOut)
        {
            Interlocked.Exchange(ref commandInterlockLatched, 1);
        }
    }

    private async Task<CommandResult> ExecuteCommandCoreAsync(CommandSpec spec, CancellationToken cancellationToken)
    {
        if (!options.HardwareCommandsEnabled)
        {
            return Result(
                spec,
                CommandStatus.Unsupported,
                CommandResultCode.CommandsDisabled,
                CommandEvidence.None,
                "硬件命令默认关闭；仅可由受监督的网关配置显式启用");
        }

        if (spec.Kind is RobotCommandKind.Home or RobotCommandKind.Reset)
        {
            return Result(
                spec,
                CommandStatus.Unsupported,
                CommandResultCode.CommandsDisabled,
                CommandEvidence.None,
                "固件回零/复位会阻塞命令处理；完成停止响应台架验证前保持关闭");
        }

        var current = GetSession();
        var transport = activeTransport;
        if (!string.Equals(spec.SessionId, current.SessionId, StringComparison.Ordinal)
            || !string.Equals(spec.ProfileId, current.ProfileId, StringComparison.Ordinal))
        {
            return Result(spec, CommandStatus.Rejected, CommandResultCode.SessionMismatch, CommandEvidence.None, "命令会话或设备配置与当前连接不匹配");
        }

        if (current.ConnectionState != ConnectionState.Connected || transport?.IsOpen != true)
        {
            return Result(spec, CommandStatus.Rejected, CommandResultCode.NotConnected, CommandEvidence.None, "机械臂未连接");
        }

        if (spec.Kind != RobotCommandKind.StopAndDisable && Volatile.Read(ref commandInterlockLatched) != 0)
        {
            return Result(
                spec,
                CommandStatus.Rejected,
                CommandResultCode.SafetyInterlockLatched,
                CommandEvidence.None,
                "上一命令的物理结果未确认；仅允许执行停止并去使能，或在现场复核后重新建立会话");
        }

        if (spec.Kind != RobotCommandKind.StopAndDisable && current.Validity != Validity.Valid)
        {
            return Result(spec, CommandStatus.Rejected, CommandResultCode.FeedbackStale, CommandEvidence.None, "反馈不是新鲜有效状态，拒绝硬件命令");
        }

        var requestValidation = ValidateCommandPayload(spec, current);
        if (requestValidation is { } rejected)
        {
            return Result(spec, CommandStatus.Rejected, rejected.Code, CommandEvidence.None, rejected.Message);
        }

        var serialIoAcquired = await serialIoGate
            .WaitAsync(options.CommandTimeout, cancellationToken)
            .ConfigureAwait(false);
        if (!serialIoAcquired)
        {
            MarkFeedbackStale();
            return spec.Kind == RobotCommandKind.StopAndDisable
                ? Result(
                    spec,
                    CommandStatus.Unconfirmed,
                    CommandResultCode.Timeout,
                    CommandEvidence.GatewayAccepted,
                    "STOP could not acquire serial I/O within the bounded deadline; use the physical emergency stop immediately")
                : Result(
                    spec,
                    CommandStatus.Rejected,
                    CommandResultCode.Timeout,
                    CommandEvidence.GatewayAccepted,
                    "Serial I/O remained busy beyond the command deadline; no command payload was sent");
        }

        try
        {
            if (!ReferenceEquals(activeTransport, transport)
                || GetSession().ConnectionState != ConnectionState.Connected)
            {
                return Result(spec, CommandStatus.Rejected, CommandResultCode.NotConnected, CommandEvidence.None, "串口会话已变化，命令未发送");
            }

            var decoder = new DummyAsciiLineDecoder();
            var readBuffer = new byte[options.ReadBufferBytes];
            return spec.Kind switch
            {
                RobotCommandKind.Enable => await ExecuteEnableAsync(spec, transport, decoder, readBuffer, cancellationToken).ConfigureAwait(false),
                RobotCommandKind.StopAndDisable => await ExecuteStopAndDisableAsync(spec, transport, decoder, readBuffer, cancellationToken).ConfigureAwait(false),
                RobotCommandKind.SetMode => await ExecuteSetModeAsync(spec, transport, decoder, readBuffer, cancellationToken).ConfigureAwait(false),
                RobotCommandKind.JointGroup => await ExecuteJointGroupAsync(spec, transport, decoder, readBuffer, cancellationToken).ConfigureAwait(false),
                _ => Result(spec, CommandStatus.Unsupported, CommandResultCode.InvalidRequest, CommandEvidence.None, "不支持的命令类型")
            };
        }
        finally
        {
            serialIoGate.Release();
        }
    }

    private async Task<CommandResult> ExecuteEnableAsync(
        CommandSpec spec,
        IAsciiTransport transport,
        DummyAsciiLineDecoder decoder,
        byte[] readBuffer,
        CancellationToken cancellationToken)
    {
        if (GetSession().MotorState == MotorState.Enabled)
        {
            return Result(spec, CommandStatus.Completed, CommandResultCode.Ok, CommandEvidence.FeedbackConfirmed, "电机已由有效反馈确认使能");
        }

        var acknowledgement = await SendAndWaitAsync(
            transport,
            DummyAsciiProtocol.FormatSystemCommand(DummySystemCommand.Enable),
            "command",
            response => response.Raw == "Started ok",
            decoder,
            readBuffer,
            spec.SessionId,
            spec.CommandId,
            cancellationToken).ConfigureAwait(false);
        var enable = await QueryCoreAsync(transport, DummyReadQuery.Enable, decoder, readBuffer, spec.SessionId, spec.CommandId, cancellationToken).ConfigureAwait(false);
        return enable.Enabled == true
            ? Result(spec, CommandStatus.Completed, CommandResultCode.Ok, CommandEvidence.FeedbackConfirmed, "使能已由设备状态回读确认", enable.Raw)
            : Result(spec, CommandStatus.Unconfirmed, CommandResultCode.DeviceUnconfirmed, CommandEvidence.DeviceAck, "设备已应答，但使能状态未确认", acknowledgement.Raw);
    }

    private async Task<CommandResult> ExecuteSetModeAsync(
        CommandSpec spec,
        IAsciiTransport transport,
        DummyAsciiLineDecoder decoder,
        byte[] readBuffer,
        CancellationToken cancellationToken)
    {
        if (GetSession().ControlMode == spec.Mode)
        {
            return Result(spec, CommandStatus.Completed, CommandResultCode.Ok, CommandEvidence.FeedbackConfirmed, $"模式 {spec.Mode} 已由有效反馈确认");
        }

        var acknowledgement = await SendAndWaitAsync(
            transport,
            DummyAsciiProtocol.FormatSetMode(spec.Mode!.Value),
            "command",
            response => response.Kind == DummyResponseKind.ModeAck && response.Mode == spec.Mode,
            decoder,
            readBuffer,
            spec.SessionId,
            spec.CommandId,
            cancellationToken).ConfigureAwait(false);
        var mode = await QueryCoreAsync(transport, DummyReadQuery.Mode, decoder, readBuffer, spec.SessionId, spec.CommandId, cancellationToken).ConfigureAwait(false);
        return mode.Mode == spec.Mode
            ? Result(spec, CommandStatus.Completed, CommandResultCode.Ok, CommandEvidence.FeedbackConfirmed, $"模式 {spec.Mode} 已由设备回读确认", mode.Raw)
            : Result(spec, CommandStatus.Unconfirmed, CommandResultCode.DeviceUnconfirmed, CommandEvidence.DeviceAck, "设备已应答，但控制模式未确认", acknowledgement.Raw);
    }

    private async Task<CommandResult> ExecuteJointGroupAsync(
        CommandSpec spec,
        IAsciiTransport transport,
        DummyAsciiLineDecoder decoder,
        byte[] readBuffer,
        CancellationToken cancellationToken)
    {
        var line = DummyAsciiProtocol.FormatJointGroup(spec.PositionsDeg!, spec.SpeedDegS!.Value);
        var queue = await SendAndWaitAsync(
            transport,
            line,
            "jointGroupCommand",
            response => response.Kind == DummyResponseKind.Queue,
            decoder,
            readBuffer,
            spec.SessionId,
            spec.CommandId,
            cancellationToken).ConfigureAwait(false);
        if (queue.QueueAccepted != true)
        {
            return Result(spec, CommandStatus.Rejected, CommandResultCode.DeviceRejected, CommandEvidence.GatewayAccepted, "设备命令队列已满，目标未被接受", queue.Raw);
        }

        var completion = options.JointGroupCompletion!;
        DateTimeOffset? withinToleranceSince = null;
        var maximumErrorDeg = double.PositiveInfinity;
        var lastReply = queue.Raw;
        using var completionCancellation = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        completionCancellation.CancelAfter(TimeSpan.FromMilliseconds(completion.TimeoutMs));
        try
        {
            while (true)
            {
                var positions = await QueryCoreAsync(
                    transport,
                    DummyReadQuery.JointPositions,
                    decoder,
                    readBuffer,
                    spec.SessionId,
                    spec.CommandId,
                    completionCancellation.Token).ConfigureAwait(false);
                lastReply = positions.Raw;
                maximumErrorDeg = positions.PositionsDeg!
                    .Zip(spec.PositionsDeg!, (actual, target) => Math.Abs(target - actual))
                    .Max();
                var now = timeProvider.GetUtcNow();
                if (maximumErrorDeg <= completion.PositionToleranceDeg)
                {
                    withinToleranceSince ??= now;
                    if (now - withinToleranceSince.Value >= TimeSpan.FromMilliseconds(completion.SettledDurationMs))
                    {
                        return Result(
                            spec,
                            CommandStatus.Completed,
                            CommandResultCode.Ok,
                            CommandEvidence.FeedbackConfirmed,
                            $"关节目标已由实测反馈确认；最大误差 {maximumErrorDeg:F3} deg",
                            lastReply);
                    }
                }
                else
                {
                    withinToleranceSince = null;
                }

                await Task.Delay(options.PollInterval, timeProvider, completionCancellation.Token).ConfigureAwait(false);
            }
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return Result(
                spec,
                CommandStatus.TimedOut,
                CommandResultCode.Timeout,
                CommandEvidence.DeviceQueued,
                $"目标已入队，但未在经批准的超时内保持到位；最后最大误差 {maximumErrorDeg:F3} deg",
                lastReply);
        }
        catch (GatewayQueryTimeoutException exception)
        {
            return Result(
                spec,
                CommandStatus.TimedOut,
                CommandResultCode.Timeout,
                CommandEvidence.DeviceQueued,
                "目标已入队，但到位反馈查询超时；物理结果未知",
                exception.Message);
        }
    }

    private async Task<CommandResult> ExecuteStopAndDisableAsync(
        CommandSpec spec,
        IAsciiTransport transport,
        DummyAsciiLineDecoder decoder,
        byte[] readBuffer,
        CancellationToken cancellationToken)
    {
        var evidence = new List<string>();
        await TrySafetyStepAsync(
            () => SendAndWaitAsync(
                transport,
                DummyAsciiProtocol.FormatSystemCommand(DummySystemCommand.Stop),
                "safetyCommand",
                response => response.Raw == "Stopped ok",
                decoder,
                readBuffer,
                spec.SessionId,
                spec.CommandId,
                cancellationToken),
            evidence).ConfigureAwait(false);
        await TrySafetyStepAsync(
            async () =>
            {
                await WriteLineAsync(
                    transport,
                    DummyAsciiProtocol.SafetyZeroCurrentLine,
                    "safetyCurrent",
                    spec.SessionId,
                    cancellationToken,
                    commandId: spec.CommandId).ConfigureAwait(false);
                return new DummyResponse(DummyResponseKind.GenericAck, "safety-current-written");
            },
            evidence).ConfigureAwait(false);
        await TrySafetyStepAsync(
            () => SendAndWaitAsync(
                transport,
                DummyAsciiProtocol.FormatSystemCommand(DummySystemCommand.Disable),
                "safetyCommand",
                response => response.Raw == "Disabled ok",
                decoder,
                readBuffer,
                spec.SessionId,
                spec.CommandId,
                cancellationToken),
            evidence).ConfigureAwait(false);

        try
        {
            var enable = await QueryCoreAsync(transport, DummyReadQuery.Enable, decoder, readBuffer, spec.SessionId, spec.CommandId, cancellationToken).ConfigureAwait(false);
            evidence.Add(enable.Raw);
            if (enable.Enabled == false)
            {
                return Result(
                    spec,
                    CommandStatus.Completed,
                    CommandResultCode.Ok,
                    CommandEvidence.FeedbackConfirmed,
                    "停止并去使能已由设备状态回读确认；软件停止不能替代物理急停",
                    string.Join(" | ", evidence));
            }
        }
        catch (Exception exception) when (exception is GatewayQueryTimeoutException or GatewayProtocolException or IOException or UnauthorizedAccessException or InvalidOperationException or TimeoutException)
        {
            evidence.Add(SafeExceptionMessage(exception));
        }

        return Result(
            spec,
            CommandStatus.Unconfirmed,
            CommandResultCode.DeviceUnconfirmed,
            CommandEvidence.DeviceAck,
            "停止链已执行但未确认去使能；请使用物理急停并检查设备",
            string.Join(" | ", evidence));
    }

    private async Task<DummyResponse> SendAndWaitAsync(
        IAsciiTransport transport,
        string line,
        string parsedKind,
        Func<DummyResponse, bool> isExpected,
        DummyAsciiLineDecoder decoder,
        byte[] readBuffer,
        string sessionId,
        string commandId,
        CancellationToken cancellationToken)
    {
        var correlationId = Guid.NewGuid().ToString("N");
        await WriteLineAsync(transport, line, parsedKind, sessionId, cancellationToken, correlationId, commandId).ConfigureAwait(false);
        using var commandCancellation = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        commandCancellation.CancelAfter(options.CommandTimeout);
        try
        {
            while (true)
            {
                var count = await transport.ReadAsync(readBuffer, commandCancellation.Token).ConfigureAwait(false);
                if (count == 0)
                {
                    throw new EndOfStreamException("Serial transport closed while reading command response");
                }

                DummyResponse? expected = null;
                foreach (var record in decoder.Append(readBuffer.AsSpan(0, count)))
                {
                    if (record.Kind == DummyDecodedRecordKind.Discarded)
                    {
                        RecordProtocolError(record.Reason ?? "discarded", record.Value, sessionId, correlationId);
                        continue;
                    }

                    var response = DummyAsciiProtocol.ParseResponseLine(record.Value);
                    RecordProtocolFrame(ProtocolDirection.Rx, response.Raw, response.ContractKind, sessionId, correlationId);
                    ApplyObservedResponse(response);
                    if (response.Kind == DummyResponseKind.Error)
                    {
                        throw new GatewayProtocolException($"Device returned error: {response.ErrorCode}");
                    }

                    if (expected is null && isExpected(response))
                    {
                        expected = response;
                    }
                }

                if (expected is not null)
                {
                    return expected;
                }
            }
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            throw new GatewayQueryTimeoutException(line);
        }
    }

    private async Task WriteLineAsync(
        IAsciiTransport transport,
        string line,
        string parsedKind,
        string sessionId,
        CancellationToken cancellationToken,
        string? correlationId = null,
        string? commandId = null)
    {
        var encoded = Encoding.ASCII.GetBytes(line + DummyAsciiProtocol.LineEnding);
        await transport.WriteAsync(encoded, cancellationToken).ConfigureAwait(false);
        if (commandId is not null)
        {
            RecordCommandTransmission(commandId, line);
        }
        RecordProtocolFrame(ProtocolDirection.Tx, line, parsedKind, sessionId, correlationId ?? Guid.NewGuid().ToString("N"));
    }

    private static async Task TrySafetyStepAsync(Func<Task<DummyResponse>> operation, List<string> evidence)
    {
        try
        {
            evidence.Add((await operation().ConfigureAwait(false)).Raw);
        }
        catch (Exception exception) when (exception is GatewayQueryTimeoutException or GatewayProtocolException or IOException or UnauthorizedAccessException or InvalidOperationException or TimeoutException)
        {
            evidence.Add(SafeExceptionMessage(exception));
        }
    }

    private string? ValidateDirectCommand(DummyDirectCommand command, RobotSessionSnapshot current)
    {
        var isQuery = command.Kind is DummyDirectCommandKind.QueryJointPositions
            or DummyDirectCommandKind.QueryMode
            or DummyDirectCommandKind.QueryEnable;
        var isReleaseCommand = command.Kind is DummyDirectCommandKind.Stop or DummyDirectCommandKind.Disable;
        if (!isQuery && !isReleaseCommand && Volatile.Read(ref commandInterlockLatched) != 0)
        {
            return "上一运动命令结果未知；仅允许查询、!STOP 或 !DISABLE";
        }

        if (!isQuery && !isReleaseCommand && current.Validity != Validity.Valid)
        {
            return "反馈不是新鲜有效状态，拒绝直接硬件命令";
        }

        if (command.Kind == DummyDirectCommandKind.SetMode && current.MotorState != MotorState.Disabled)
        {
            return "切换模式前必须由反馈确认电机已去使能";
        }

        if (command.Kind != DummyDirectCommandKind.JointGroup)
        {
            return null;
        }

        if (current.MotorState != MotorState.Enabled)
        {
            return "电机尚未由反馈确认使能";
        }

        if (current.ControlMode is not (1 or 2 or 3))
        {
            return "尚未取得有效控制模式";
        }

        var measured = GetJointState();
        if (measured.ProfileId != GatewayContractV1.DummyProfileId
            || measured.Source != DataSource.Measured
            || measured.Validity != Validity.Valid
            || measured.PositionsDeg.Count != DummyAsciiProtocol.JointCount)
        {
            return "缺少当前 Dummy 会话的新鲜六轴实测反馈";
        }

        return null;
    }

    private static bool IsExpectedDirectResponse(DummyDirectCommand command, DummyResponse response) =>
        command.Kind switch
        {
            DummyDirectCommandKind.QueryJointPositions => response.Kind == DummyResponseKind.JointPositions,
            DummyDirectCommandKind.QueryMode => response.Kind is DummyResponseKind.Mode or DummyResponseKind.UnsupportedMode,
            DummyDirectCommandKind.QueryEnable => response.Kind == DummyResponseKind.Enable,
            DummyDirectCommandKind.Enable => response.Raw == "Started ok",
            DummyDirectCommandKind.Stop => response.Raw == "Stopped ok",
            DummyDirectCommandKind.Disable => response.Raw == "Disabled ok",
            DummyDirectCommandKind.SetMode => response.Kind == DummyResponseKind.ModeAck && response.Mode == command.Mode,
            DummyDirectCommandKind.JointGroup => response.Kind == DummyResponseKind.Queue,
            _ => false
        };

    private static string DirectParsedKind(DummyDirectCommandKind kind) => kind switch
    {
        DummyDirectCommandKind.QueryJointPositions or DummyDirectCommandKind.QueryMode or DummyDirectCommandKind.QueryEnable => "engineeringQuery",
        DummyDirectCommandKind.JointGroup => "engineeringJointGroup",
        _ => "engineeringCommand"
    };

    private static bool IsValidDirectIdentity(DirectCommandRequest request, out string error)
    {
        if (string.IsNullOrWhiteSpace(request.RequestId)
            || request.RequestId.Length > 128
            || request.RequestId.Any(char.IsControl))
        {
            error = "requestId 必须为 1-128 个非控制字符";
            return false;
        }

        if (string.IsNullOrWhiteSpace(request.SessionId) || request.SessionId.Length > 128)
        {
            error = "sessionId 非法";
            return false;
        }

        if (!string.Equals(request.ProfileId, GatewayContractV1.DummyProfileId, StringComparison.Ordinal))
        {
            error = "直连调试仅支持 dummy-6dof";
            return false;
        }

        error = string.Empty;
        return true;
    }

    private DirectCommandResult DirectResult(
        DirectCommandRequest request,
        DirectCommandStatus status,
        CommandEvidence evidence,
        string normalizedLine,
        string message,
        string? deviceReply = null) => new(
            NormalizeDirectIdentifier(request.RequestId, "invalid-request"),
            NormalizeDirectIdentifier(request.SessionId, "invalid-session"),
            status,
            evidence,
            normalizedLine,
            message,
            timeProvider.GetUtcNow(),
            deviceReply);

    private static string NormalizeDirectIdentifier(string? value, string fallback)
    {
        if (string.IsNullOrWhiteSpace(value)) return fallback;
        var normalized = new string(value
            .Where(character => !char.IsControl(character))
            .Take(128)
            .ToArray());
        return string.IsNullOrWhiteSpace(normalized) ? fallback : normalized;
    }

    private static string NormalizeRejectedDirectLine(string? line)
    {
        if (string.IsNullOrWhiteSpace(line)) return string.Empty;
        var printable = new string(line
            .Where(character => char.IsAscii(character) && !char.IsControl(character))
            .Take(DummyAsciiProtocol.MaximumLineCharacters)
            .ToArray());
        return printable.Trim();
    }

    private (CommandResultCode Code, string Message)? ValidateCommandPayload(CommandSpec spec, RobotSessionSnapshot current)
    {
        if (spec.Kind == RobotCommandKind.SetMode)
        {
            if (spec.Mode is < 1 or > 3)
            {
                return (CommandResultCode.InvalidRequest, "Dummy 仅支持模式 1–3");
            }

            if (current.MotorState == MotorState.Enabled)
            {
                return (CommandResultCode.InvalidRequest, "切换模式前必须先去使能");
            }
        }

        if (spec.Kind != RobotCommandKind.JointGroup)
        {
            return null;
        }

        if (current.MotorState != MotorState.Enabled)
        {
            return (CommandResultCode.MotorNotEnabled, "电机未使能，拒绝下发关节目标");
        }

        if (GetJointState().Validity != Validity.Valid)
        {
            return (CommandResultCode.FeedbackStale, "关节反馈无效或过期，拒绝下发目标");
        }

        if (spec.PositionsDeg is null || spec.PositionsDeg.Count != DummyAsciiProtocol.JointCount)
        {
            return (CommandResultCode.InvalidTarget, "必须提供六个关节目标");
        }

        for (var index = 0; index < spec.PositionsDeg.Count; index++)
        {
            var value = spec.PositionsDeg[index];
            var limit = DummyJointLimits.All[index];
            if (!double.IsFinite(value) || value < limit.LowerDeg || value > limit.UpperDeg)
            {
                return (CommandResultCode.InvalidTarget, $"J{index + 1} 目标超出已验证限位");
            }
        }

        if (options.JointGroupSpeedLimitDegS is not { } speedLimit
            || options.JointGroupCompletion is null
            || spec.SpeedDegS is not { } speed)
        {
            return (CommandResultCode.SpeedUnverified, "未配置完整的经验证运动包络或请求未提供速度，拒绝运动命令");
        }

        if (!double.IsFinite(speed) || speed <= 0 || speed > speedLimit)
        {
            return (CommandResultCode.SpeedOutOfRange, "请求速度超出经验证的范围");
        }

        return null;
    }

    private static string? ValidateCommandIdentity(CommandSpec spec)
    {
        if (string.IsNullOrWhiteSpace(spec.CommandId) || spec.CommandId.Length > 128 || spec.CommandId.Any(char.IsControl))
        {
            return "commandId 必须为 1–128 个非控制字符";
        }

        if (string.IsNullOrWhiteSpace(spec.SessionId) || spec.SessionId.Length > 128)
        {
            return "sessionId 非法";
        }

        if (!string.Equals(spec.ProfileId, GatewayContractV1.DummyProfileId, StringComparison.Ordinal))
        {
            return "仅支持 dummy-6dof 配置";
        }

        return null;
    }

    private CommandResult StoreImmediateResultLocked(
        CommandSpec spec,
        string fingerprint,
        CommandStatus status,
        CommandResultCode code,
        string message)
    {
        var result = Result(spec, status, code, CommandEvidence.None, message);
        var entry = new CommandEntry(spec, fingerprint, timeProvider.GetUtcNow());
        entry.Completion.TrySetResult(result);
        entry.ExecutionCancellation.Dispose();
        commandEntries.Add(spec.CommandId, entry);
        commandOrder.Enqueue(spec.CommandId);
        TrimCommandHistoryLocked();
        EnqueueEvent(new CommandResultEvent(result));
        return result;
    }

    private void CancelCommandsForDisconnect()
    {
        CancellationTokenSource? directCancellation;
        lock (commandStateGate)
        {
            foreach (var entry in commandEntries.Values.Where(item => !item.Completion.Task.IsCompleted))
            {
                entry.ExecutionCancellation.Cancel();
            }
            directCancellation = activeDirectCommandCancellation;
        }
        directCancellation?.Cancel();
    }

    private bool HasRunningCommand()
    {
        lock (commandStateGate)
        {
            return activeDirectCommandCancellation is not null
                || commandEntries.Values.Any(entry => !entry.Completion.Task.IsCompleted);
        }
    }

    private async Task AwaitRunningCommandsAsync()
    {
        Task[] tasks;
        lock (commandStateGate)
        {
            tasks = commandEntries.Values
                .Select(entry => entry.Runner)
                .Where(task => task is not null && !task.IsCompleted)
                .Cast<Task>()
                .Concat(activeDirectCommandCompletion is { Task.IsCompleted: false } direct
                    ? [direct.Task]
                    : [])
                .ToArray();
        }

        if (tasks.Length > 0)
        {
            await Task.WhenAll(tasks).ConfigureAwait(false);
        }
    }

    private void CancelActiveDirectCommand()
    {
        CancellationTokenSource? cancellation;
        lock (commandStateGate)
        {
            cancellation = activeDirectCommandCancellation;
        }
        cancellation?.Cancel();
    }

    private void MarkDirectCommandUnconfirmed(DummyDirectCommandKind kind)
    {
        if (kind is DummyDirectCommandKind.QueryJointPositions
            or DummyDirectCommandKind.QueryMode
            or DummyDirectCommandKind.QueryEnable)
        {
            MarkFeedbackStale();
            return;
        }

        Interlocked.Exchange(ref commandInterlockLatched, 1);
        var current = GetSession();
        if (current.ConnectionState != ConnectionState.Connected) return;
        UpdateSession(current with
        {
            MotorState = kind is DummyDirectCommandKind.Enable
                or DummyDirectCommandKind.Stop
                or DummyDirectCommandKind.Disable
                ? MotorState.Unknown
                : current.MotorState,
            ControlMode = kind == DummyDirectCommandKind.SetMode ? null : current.ControlMode,
            TimestampUtc = timeProvider.GetUtcNow(),
            Validity = Validity.Stale
        });
    }

    private void ResetSessionEvidence()
    {
        lock (stateGate)
        {
            protocolFrames.Clear();
        }
        lock (commandStateGate)
        {
            commandEntries.Clear();
            commandOrder.Clear();
            exclusiveCommandId = null;
        }
        Interlocked.Exchange(ref commandInterlockLatched, 0);
    }

    private void TrimCommandHistoryLocked()
    {
        while (commandEntries.Count > options.CommandHistoryCapacity && commandOrder.Count > 0)
        {
            string? removableId = null;
            var itemsToInspect = commandOrder.Count;
            for (var index = 0; index < itemsToInspect; index++)
            {
                var candidateId = commandOrder.Dequeue();
                var canRemove = removableId is null
                    && commandEntries.TryGetValue(candidateId, out var candidate)
                    && candidate.Completion.Task.IsCompleted
                    && !string.Equals(candidateId, exclusiveCommandId, StringComparison.Ordinal);

                if (canRemove)
                {
                    removableId = candidateId;
                    continue;
                }

                commandOrder.Enqueue(candidateId);
            }

            if (removableId is null)
            {
                break;
            }

            commandEntries.Remove(removableId);
        }
    }

    private CommandAuditRecord ToAuditRecord(CommandEntry entry)
    {
        var result = entry.Completion.Task.IsCompletedSuccessfully
            ? entry.Completion.Task.Result
            : Result(entry.Spec, CommandStatus.Accepted, CommandResultCode.Ok, CommandEvidence.GatewayAccepted, "命令已由网关接受，等待终态");
        return new(
            entry.Spec.CommandId,
            entry.Spec.SessionId,
            entry.Spec.ProfileId,
            entry.Spec.Kind,
            entry.AcceptedAtUtc,
            ToRequestSnapshot(entry.Spec, entry.Fingerprint),
            entry.TransmittedPayloads.ToArray(),
            entry.TransmissionLogTruncated,
            result);
    }

    private void RecordCommandTransmission(string commandId, string payload)
    {
        lock (commandStateGate)
        {
            if (!commandEntries.TryGetValue(commandId, out var entry))
            {
                return;
            }

            if (entry.TransmittedPayloads.Count < 32)
            {
                entry.TransmittedPayloads.Add(payload);
            }
            else
            {
                entry.TransmissionLogTruncated = true;
            }
        }
    }

    private static RobotCommandRequestSnapshot ToRequestSnapshot(CommandSpec spec, string fingerprint)
    {
        var positionsCount = spec.PositionsDeg?.Count;
        var positions = spec.PositionsDeg is null
            ? null
            : spec.PositionsDeg.Take(6).ToArray();
        return new(
            spec.Kind,
            fingerprint,
            spec.Mode,
            positions,
            positionsCount,
            spec.SpeedDegS,
            positionsCount is > 6);
    }

    private CommandResult Result(
        CommandSpec spec,
        CommandStatus status,
        CommandResultCode code,
        CommandEvidence evidence,
        string message,
        string? deviceReply = null) => new(
            spec.CommandId,
            spec.SessionId,
            spec.Kind,
            status,
            code,
            evidence,
            message,
            timeProvider.GetUtcNow(),
            deviceReply);

    private static string Fingerprint(CommandSpec spec)
    {
        var positions = spec.PositionsDeg is null
            ? string.Empty
            : string.Join(',', spec.PositionsDeg.Select(value => value.ToString("R", System.Globalization.CultureInfo.InvariantCulture)));
        var canonical = string.Join('|',
            spec.Kind,
            spec.SessionId,
            spec.ProfileId,
            spec.Mode?.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? string.Empty,
            positions,
            spec.SpeedDegS?.ToString("R", System.Globalization.CultureInfo.InvariantCulture) ?? string.Empty);
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(canonical)));
    }

    private static async Task<CommandResult> AwaitCommandAsync(Task<CommandResult> task, CancellationToken cancellationToken) =>
        await task.WaitAsync(cancellationToken).ConfigureAwait(false);

    private async Task PollAsync(IAsciiTransport transport, string sessionId, CancellationToken cancellationToken)
    {
        var decoder = new DummyAsciiLineDecoder();
        var readBuffer = new byte[options.ReadBufferBytes];
        var consecutiveTimeouts = 0;
        try
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                try
                {
                    var positions = await QueryAsync(transport, DummyReadQuery.JointPositions, decoder, readBuffer, sessionId, cancellationToken).ConfigureAwait(false);
                    var mode = await QueryAsync(transport, DummyReadQuery.Mode, decoder, readBuffer, sessionId, cancellationToken).ConfigureAwait(false);
                    var enable = await QueryAsync(transport, DummyReadQuery.Enable, decoder, readBuffer, sessionId, cancellationToken).ConfigureAwait(false);

                    if (positions.Kind != DummyResponseKind.JointPositions
                        || mode.Kind != DummyResponseKind.Mode
                        || enable.Kind != DummyResponseKind.Enable)
                    {
                        throw new GatewayProtocolException("Status cycle returned incompatible response types");
                    }

                    consecutiveTimeouts = 0;
                    MarkStatusCycleValid(mode.Mode!.Value, enable.Enabled!.Value);
                }
                catch (GatewayQueryTimeoutException exception)
                {
                    consecutiveTimeouts++;
                    MarkFeedbackStale();
                    RecordProtocolError("queryTimeout", exception.Message, sessionId);
                    diagnostics.Record(new(
                        "serial.query.timeout",
                        GatewayDiagnosticSeverity.Warning,
                        sessionId,
                        transport.PortName,
                        $"Status query timeout {consecutiveTimeouts}/{options.ConsecutiveTimeoutLimit}",
                        exception));
                    if (consecutiveTimeouts >= options.ConsecutiveTimeoutLimit)
                    {
                        throw;
                    }
                }

                await Task.Delay(options.PollInterval, timeProvider, cancellationToken).ConfigureAwait(false);
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
        }
        catch (Exception exception)
        {
            await HandlePollingFaultAsync(transport, sessionId, exception).ConfigureAwait(false);
        }
        finally
        {
            var incomplete = decoder.Finish();
            if (incomplete is not null)
            {
                RecordProtocolError(incomplete.Reason ?? "incomplete", incomplete.Value, sessionId);
            }
        }
    }

    private async Task<DummyResponse> QueryAsync(
        IAsciiTransport transport,
        DummyReadQuery query,
        DummyAsciiLineDecoder decoder,
        byte[] readBuffer,
        string sessionId,
        CancellationToken cancellationToken,
        string? commandId = null)
    {
        while (Volatile.Read(ref commandDemand) > 0)
        {
            await Task.Delay(TimeSpan.FromMilliseconds(10), timeProvider, cancellationToken).ConfigureAwait(false);
        }

        await serialIoGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            return await QueryCoreAsync(transport, query, decoder, readBuffer, sessionId, commandId, cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            serialIoGate.Release();
        }
    }

    private async Task<DummyResponse> QueryCoreAsync(
        IAsciiTransport transport,
        DummyReadQuery query,
        DummyAsciiLineDecoder decoder,
        byte[] readBuffer,
        string sessionId,
        string? commandId,
        CancellationToken cancellationToken)
    {
        var correlationId = Guid.NewGuid().ToString("N");
        var line = DummyAsciiProtocol.FormatQuery(query);
        var encoded = Encoding.ASCII.GetBytes(line + DummyAsciiProtocol.LineEnding);
        await transport.WriteAsync(encoded, cancellationToken).ConfigureAwait(false);
        if (commandId is not null)
        {
            RecordCommandTransmission(commandId, line);
        }
        RecordProtocolFrame(ProtocolDirection.Tx, line, "query", sessionId, correlationId);

        using var queryCancellation = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        queryCancellation.CancelAfter(options.QueryTimeout);
        try
        {
            while (true)
            {
                var count = await transport.ReadAsync(readBuffer, queryCancellation.Token).ConfigureAwait(false);
                if (count == 0)
                {
                    throw new EndOfStreamException("Serial transport closed while reading");
                }

                DummyResponse? expected = null;
                foreach (var record in decoder.Append(readBuffer.AsSpan(0, count)))
                {
                    if (record.Kind == DummyDecodedRecordKind.Discarded)
                    {
                        RecordProtocolError(record.Reason ?? "discarded", record.Value, sessionId, correlationId);
                        continue;
                    }

                    var response = DummyAsciiProtocol.ParseResponseLine(record.Value);
                    RecordProtocolFrame(ProtocolDirection.Rx, response.Raw, response.ContractKind, sessionId, correlationId);
                    ApplyObservedResponse(response);
                    if (response.Kind == DummyResponseKind.Error)
                    {
                        throw new GatewayProtocolException($"Device returned error: {response.ErrorCode}");
                    }

                    if (expected is null && DummyAsciiProtocol.IsExpectedResponse(query, response))
                    {
                        expected = response;
                    }
                }

                if (expected is not null)
                {
                    return expected;
                }
            }
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            throw new GatewayQueryTimeoutException(line);
        }
    }

    private async Task HandlePollingFaultAsync(IAsciiTransport transport, string sessionId, Exception exception)
    {
        var ownsTransport = false;
        await lifecycleGate.WaitAsync(CancellationToken.None).ConfigureAwait(false);
        try
        {
            if (ReferenceEquals(activeTransport, transport))
            {
                ownsTransport = true;
                activeTransport = null;
                pollingTask = null;
                pollingCancellation?.Cancel();
                pollingCancellation?.Dispose();
                pollingCancellation = null;
                UpdateSession(FaultedSession(sessionId, timeProvider.GetUtcNow()));
                UpdateJointState(UnavailableJointState(timeProvider.GetUtcNow()));
            }
        }
        finally
        {
            lifecycleGate.Release();
        }

        if (!ownsTransport)
        {
            return;
        }

        RecordProtocolError("transportFault", SafeExceptionMessage(exception), sessionId);
        diagnostics.Record(new(
            "serial.polling.faulted",
            GatewayDiagnosticSeverity.Error,
            sessionId,
            transport.PortName,
            "Read-only polling stopped and the serial transport was released",
            exception));
        await DisposeTransportAsync(transport).ConfigureAwait(false);
    }

    private void ApplyObservedResponse(DummyResponse response)
    {
        if (response.Kind == DummyResponseKind.JointPositions && response.PositionsDeg is not null)
        {
            JointStateFrame next;
            lock (stateGate)
            {
                next = new(
                    jointState.Sequence + 1,
                    GatewayContractV1.DummyProfileId,
                    timeProvider.GetUtcNow(),
                    [.. response.PositionsDeg],
                    DataSource.Measured,
                    Validity.Valid);
                jointState = next;
            }

            EnqueueEvent(new JointStateEvent(next));
        }
        else if (response.Kind == DummyResponseKind.Enable && response.Enabled is { } enabled)
        {
            var current = GetSession();
            UpdateSession(current with
            {
                MotorState = enabled ? MotorState.Enabled : MotorState.Disabled,
                TimestampUtc = timeProvider.GetUtcNow(),
                Source = DataSource.Measured
            });
        }
        else if (response.Kind == DummyResponseKind.Mode && response.Mode is { } mode)
        {
            var current = GetSession();
            UpdateSession(current with
            {
                ControlMode = mode,
                TimestampUtc = timeProvider.GetUtcNow(),
                Source = DataSource.Measured
            });
        }
        else if (response.Kind == DummyResponseKind.UnsupportedMode)
        {
            var current = GetSession();
            UpdateSession(current with
            {
                MotorState = MotorState.Unknown,
                ControlMode = null,
                TimestampUtc = timeProvider.GetUtcNow(),
                Source = DataSource.Measured,
                Validity = Validity.Invalid
            });
        }
    }

    private void MarkStatusCycleValid(int mode, bool enabled)
    {
        if (mode is < 1 or > 3)
        {
            throw new GatewayProtocolException("Device reported an unsupported control mode");
        }

        var current = GetSession();
        UpdateSession(current with
        {
            MotorState = enabled ? MotorState.Enabled : MotorState.Disabled,
            ControlMode = mode,
            TimestampUtc = timeProvider.GetUtcNow(),
            Source = DataSource.Measured,
            Validity = Validity.Valid
        });
    }

    private void MarkFeedbackStale()
    {
        var current = GetSession();
        if (current.ConnectionState != ConnectionState.Connected)
        {
            return;
        }

        UpdateSession(current with { TimestampUtc = timeProvider.GetUtcNow(), Validity = Validity.Stale });
        lock (stateGate)
        {
            if (jointState.Validity == Validity.Valid)
            {
                jointState = jointState with { Validity = Validity.Stale };
                EnqueueEvent(new JointStateEvent(jointState));
            }
        }
    }

    private void UpdateSession(RobotSessionSnapshot next)
    {
        lock (stateGate)
        {
            session = next;
        }

        EnqueueEvent(new SessionEvent(next));
    }

    private void UpdateJointState(JointStateFrame next)
    {
        lock (stateGate)
        {
            jointState = next;
        }

        EnqueueEvent(new JointStateEvent(next));
    }

    private void RecordProtocolFrame(
        ProtocolDirection direction,
        string raw,
        string parsedKind,
        string? sessionId,
        string? correlationId = null)
    {
        var frame = new ProtocolFrame(
            Guid.NewGuid().ToString("N"),
            timeProvider.GetUtcNow(),
            direction,
            raw.Length <= DummyAsciiProtocol.MaximumLineCharacters ? raw : raw[..DummyAsciiProtocol.MaximumLineCharacters],
            parsedKind,
            direction switch
            {
                ProtocolDirection.Tx => DataSource.Commanded,
                ProtocolDirection.Rx => DataSource.Measured,
                ProtocolDirection.Error => DataSource.Unavailable,
                _ => throw new ArgumentOutOfRangeException(nameof(direction), direction, "Unsupported protocol direction")
            },
            correlationId);
        lock (stateGate)
        {
            while (protocolFrames.Count >= options.ProtocolFrameCapacity)
            {
                protocolFrames.Dequeue();
            }

            protocolFrames.Enqueue(frame);
        }

        EnqueueEvent(new ProtocolFrameEvent(frame));
    }

    private void RecordProtocolError(string kind, string detail, string? sessionId, string? correlationId = null) =>
        RecordProtocolFrame(ProtocolDirection.Error, detail, kind, sessionId, correlationId);

    private void EnqueueEvent(GatewayEvent gatewayEvent)
    {
        if (!eventQueue.Writer.TryWrite(gatewayEvent))
        {
            diagnostics.Record(new(
                "events.queue.closed",
                GatewayDiagnosticSeverity.Warning,
                GetSession().SessionId,
                activeTransport?.PortName,
                "Telemetry event could not be queued; REST snapshot remains authoritative"));
        }
    }

    private async Task PumpEventsAsync(CancellationToken cancellationToken)
    {
        await foreach (var gatewayEvent in eventQueue.Reader.ReadAllAsync(cancellationToken).ConfigureAwait(false))
        {
            try
            {
                await PublishEventAsync(gatewayEvent, cancellationToken)
                    .WaitAsync(options.EventPublishTimeout, cancellationToken)
                    .ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                return;
            }
            catch (TimeoutException exception)
            {
                diagnostics.Record(new(
                    "events.publish.timeout",
                    GatewayDiagnosticSeverity.Error,
                    GetSession().SessionId,
                    activeTransport?.PortName,
                    $"Event publisher exceeded {options.EventPublishTimeout.TotalMilliseconds:F0} ms; live event pumping stopped to prevent unbounded task accumulation",
                    exception));
                return;
            }
            catch (Exception exception)
            {
                diagnostics.Record(new(
                    "events.publish.failed",
                    GatewayDiagnosticSeverity.Warning,
                    GetSession().SessionId,
                    activeTransport?.PortName,
                    "Telemetry publishing failed; polling continues and REST snapshot remains authoritative",
                    exception));
            }
        }
    }

    private async Task PublishEventAsync(GatewayEvent gatewayEvent, CancellationToken cancellationToken)
    {
        switch (gatewayEvent)
        {
            case SessionEvent sessionEvent:
                await eventSink.PublishSessionAsync(sessionEvent.Value, cancellationToken).ConfigureAwait(false);
                break;
            case JointStateEvent jointStateEvent:
                await eventSink.PublishJointStateAsync(jointStateEvent.Value, cancellationToken).ConfigureAwait(false);
                break;
            case ProtocolFrameEvent protocolFrameEvent:
                await eventSink.PublishProtocolFrameAsync(protocolFrameEvent.Value, cancellationToken).ConfigureAwait(false);
                break;
            case CommandResultEvent commandResultEvent:
                await eventSink.PublishCommandResultAsync(commandResultEvent.Value, cancellationToken).ConfigureAwait(false);
                break;
        }
    }

    private static void ValidateConnectRequest(RobotConnectRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (!string.Equals(request.ProfileId, GatewayContractV1.DummyProfileId, StringComparison.Ordinal))
        {
            throw new GatewayValidationException("Only the dummy-6dof profile is supported in Phase 4");
        }

        if (request.PortName.Length is < 4 or > 12
            || !request.PortName.StartsWith("COM", StringComparison.OrdinalIgnoreCase)
            || !int.TryParse(request.PortName.AsSpan(3), out var portNumber)
            || portNumber is < 1 or > 4096)
        {
            throw new GatewayValidationException("Serial port must be a valid Windows COM port name");
        }
    }

    private static string SafeExceptionMessage(Exception exception) => exception switch
    {
        TimeoutException => "Serial operation timed out",
        IOException => "Serial transport I/O failed",
        UnauthorizedAccessException => "Serial port is occupied or access was denied",
        _ => "Serial gateway operation failed"
    };

    private async ValueTask DisposeTransportAsync(IAsciiTransport transport)
    {
        await CloseTransportAsync(transport).ConfigureAwait(false);
        await transport.DisposeAsync().ConfigureAwait(false);
    }

    private async ValueTask CloseTransportAsync(IAsciiTransport transport)
    {
        try
        {
            await transport.CloseAsync(CancellationToken.None).ConfigureAwait(false);
        }
        catch (Exception exception)
        {
            diagnostics.Record(new(
                "serial.close.failed",
                GatewayDiagnosticSeverity.Warning,
                GetSession().SessionId,
                transport.PortName,
                "Serial close failed; dispose will still run",
                exception));
        }
    }

    private static RobotSessionSnapshot OfflineSession(DateTimeOffset timestamp) => new(
        "offline",
        GatewayContractV1.DummyProfileId,
        ConnectionState.Offline,
        MotorState.Unknown,
        null,
        timestamp,
        DataSource.Unavailable,
        Validity.Unavailable);

    private static RobotSessionSnapshot FaultedSession(string sessionId, DateTimeOffset timestamp) => new(
        sessionId,
        GatewayContractV1.DummyProfileId,
        ConnectionState.Faulted,
        MotorState.Unknown,
        null,
        timestamp,
        DataSource.Unavailable,
        Validity.Invalid);

    private static JointStateFrame UnavailableJointState(DateTimeOffset timestamp) => new(
        0,
        GatewayContractV1.DummyProfileId,
        timestamp,
        new double[DummyAsciiProtocol.JointCount],
        DataSource.Unavailable,
        Validity.Unavailable);

    private void ThrowIfDisposed(bool allowDisposing = false)
    {
        ObjectDisposedException.ThrowIf(disposed && !allowDisposing, this);
    }

    private abstract record GatewayEvent;
    private sealed record SessionEvent(RobotSessionSnapshot Value) : GatewayEvent;
    private sealed record JointStateEvent(JointStateFrame Value) : GatewayEvent;
    private sealed record ProtocolFrameEvent(ProtocolFrame Value) : GatewayEvent;
    private sealed record CommandResultEvent(CommandResult Value) : GatewayEvent;

    private sealed record CommandSpec(
        string CommandId,
        string SessionId,
        string ProfileId,
        RobotCommandKind Kind,
        int? Mode = null,
        IReadOnlyList<double>? PositionsDeg = null,
        double? SpeedDegS = null)
    {
        public static CommandSpec From(SimpleRobotCommand command, RobotCommandKind kind) =>
            new(command.CommandId, command.SessionId, command.ProfileId, kind);

        public static CommandSpec From(SetModeCommand command) =>
            new(command.CommandId, command.SessionId, command.ProfileId, RobotCommandKind.SetMode, Mode: command.Mode);

        public static CommandSpec From(JointGroupCommand command) =>
            new(
                command.CommandId,
                command.SessionId,
                command.ProfileId,
                RobotCommandKind.JointGroup,
                PositionsDeg: command.PositionsDeg is null ? null : [.. command.PositionsDeg],
                SpeedDegS: command.SpeedDegS);
    }

    private sealed class CommandEntry(CommandSpec spec, string fingerprint, DateTimeOffset acceptedAtUtc)
    {
        public CommandSpec Spec { get; } = spec;
        public string Fingerprint { get; } = fingerprint;
        public DateTimeOffset AcceptedAtUtc { get; } = acceptedAtUtc;
        public CancellationTokenSource ExecutionCancellation { get; } = new();
        public TaskCompletionSource<CommandResult> Completion { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public List<string> TransmittedPayloads { get; } = [];
        public bool TransmissionLogTruncated { get; set; }
        public Task? Runner { get; set; }
    }
}
