using System.Text;
using System.Security.Cryptography;
using System.Threading.Channels;
using AethorStudioV2.Domain;

namespace AethorStudioV2.Application;

public sealed class RobotGateway : IAsyncDisposable
{
    private const int EngineeringFeedbackMinimumSamples = 8;
    private const double EngineeringFeedbackMovementEpsilonDeg = 0.02;
    private const double EngineeringFeedbackTargetErrorThresholdDeg = 0.5;
    private readonly IAsciiTransportFactory transportFactory;
    private readonly ISerialPortCatalog portCatalog;
    private readonly IRobotGatewayEventSink eventSink;
    private readonly IGatewayDiagnostics diagnostics;
    private readonly TimeProvider timeProvider;
    private readonly RobotGatewayOptions options;
    private readonly SemaphoreSlim lifecycleGate = new(1, 1);
    private readonly object stateGate = new();
    private readonly object commandStateGate = new();
    private readonly Queue<ProtocolFrame> protocolFrames = new();
    private readonly Dictionary<string, CommandEntry> commandEntries = new(StringComparer.Ordinal);
    private readonly Queue<string> commandOrder = new();
    private readonly Dictionary<string, DirectCommandEntry> directCommandEntries = new(StringComparer.Ordinal);
    private readonly Queue<string> directCommandOrder = new();
    private readonly Channel<GatewayEvent> eventQueue;
    private readonly CancellationTokenSource eventPumpCancellation = new();
    private readonly Task eventPumpTask;

    private RobotSessionSnapshot session;
    private JointStateFrame jointState;
    private DummySerialSession? activeSerialSession;
    private CancellationTokenSource? pollingCancellation;
    private Task? pollingTask;
    private TaskCompletionSource? disconnectCompletion;
    private string? engineeringMotionResponseCorrelationId;
    private string? engineeringMotionRequestId;
    private double[]? engineeringMotionTargetPositionsDeg;
    private double[]? engineeringMotionBaselinePositionsDeg;
    private long engineeringMotionStartedTimestamp;
    private int engineeringMotionFeedbackSamples;
    private double engineeringMotionMaximumObservedMovementDeg;
    private bool engineeringMotionFeedbackFrozenSuspected;
    private string? exclusiveCommandId;
    private int commandInterlockLatched;
    private int engineeringManualMotionActive;
    private int serialOpenRecoveryRequired;
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

    public IReadOnlyList<DirectCommandResult> GetDirectCommandHistory(int limit = 50)
    {
        if (limit is < 1 or > 500)
        {
            throw new GatewayValidationException("Direct command history limit must be between 1 and 500");
        }

        lock (commandStateGate)
        {
            return directCommandOrder
                .TakeLast(limit)
                .Select(requestId => directCommandEntries[requestId].Result)
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

        var serialSession = activeSerialSession;
        if (current.ConnectionState != ConnectionState.Connected || serialSession?.IsRunning != true)
        {
            return DirectResult(request, DirectCommandStatus.Rejected, CommandEvidence.None, parsedCommand.NormalizedLine, "Dummy 串口未连接");
        }

        var commandValidation = ValidateDirectCommand(parsedCommand, current);
        if (commandValidation is not null)
        {
            return DirectResult(request, DirectCommandStatus.Rejected, CommandEvidence.None, parsedCommand.NormalizedLine, commandValidation);
        }

        var fingerprint = DirectFingerprint(request, parsedCommand.NormalizedLine);
        DirectCommandResult queued;
        lock (commandStateGate)
        {
            if (directCommandEntries.TryGetValue(request.RequestId, out var existing))
            {
                return string.Equals(existing.Fingerprint, fingerprint, StringComparison.Ordinal)
                    ? existing.Result
                    : DirectResult(request, DirectCommandStatus.Rejected, CommandEvidence.None, parsedCommand.NormalizedLine, "requestId 已用于不同的直连请求");
            }

            if (exclusiveCommandId is not null
                && parsedCommand.Kind is not (DummyDirectCommandKind.Stop or DummyDirectCommandKind.Disable))
            {
                return DirectResult(request, DirectCommandStatus.Rejected, CommandEvidence.None, parsedCommand.NormalizedLine, "已有结构化硬件命令正在执行");
            }

            cancellationToken.ThrowIfCancellationRequested();
            queued = DirectResult(
                request,
                DirectCommandStatus.Queued,
                CommandEvidence.GatewayAccepted,
                parsedCommand.NormalizedLine,
                "请求已进入有界串口队列；尚未写入 transport");
            directCommandEntries.Add(request.RequestId, new(
                fingerprint,
                parsedCommand,
                queued,
                new(TaskCreationOptions.RunContinuationsAsynchronously)));
            directCommandOrder.Enqueue(request.RequestId);
            TrimDirectCommandHistoryLocked();
        }
        EnqueueEvent(new DirectCommandResultEvent(queued));

        var priority = parsedCommand.Kind is DummyDirectCommandKind.Stop or DummyDirectCommandKind.Disable
            ? SerialWorkPriority.Safety
            : SerialWorkPriority.Interactive;
        SerialWriteTicket ticket;
        try
        {
            if (!ReferenceEquals(activeSerialSession, serialSession)
                || GetSession().ConnectionState != ConnectionState.Connected)
            {
                return UpdateDirectCommandResult(
                    request.RequestId,
                    DirectCommandStatus.Cancelled,
                    CommandEvidence.GatewayAccepted,
                    "串口会话已变化；排队请求未发送");
            }

            ticket = serialSession.QueueUnobserved(
                $"direct:{request.RequestId}",
                parsedCommand.NormalizedLine,
                DirectParsedKind(parsedCommand.Kind),
                request.SessionId,
                priority,
                options.CommandTimeout,
                directRequestId: request.RequestId);
        }
        catch (Exception exception) when (exception is GatewayConflictException or InvalidOperationException or ObjectDisposedException)
        {
            return UpdateDirectCommandResult(
                request.RequestId,
                DirectCommandStatus.Failed,
                CommandEvidence.GatewayAccepted,
                "请求未能进入串口队列",
                SafeExceptionMessage(exception));
        }

        if (!ticket.Accepted)
        {
            return UpdateDirectCommandResult(
                request.RequestId,
                DirectCommandStatus.Rejected,
                CommandEvidence.None,
                ticket.RejectionReason ?? "串口队列拒绝请求");
        }

        _ = ObserveDirectWriteCompletionAsync(request.RequestId, ticket.Completion!);
        await Task.CompletedTask;
        return queued;
    }

    private void BeginEngineeringManualMotion(
        string sessionId,
        string requestId,
        IReadOnlyList<double> targetPositionsDeg)
    {
        var measured = GetJointState();
        lock (commandStateGate)
        {
            engineeringMotionResponseCorrelationId ??= $"engineering-manual-{sessionId}";
            engineeringMotionRequestId = requestId;
            engineeringMotionTargetPositionsDeg = [.. targetPositionsDeg];
            engineeringMotionBaselinePositionsDeg = measured.Source == DataSource.Measured
                && measured.PositionsDeg.Count == DummyAsciiProtocol.JointCount
                ? [.. measured.PositionsDeg]
                : null;
            engineeringMotionStartedTimestamp = timeProvider.GetTimestamp();
            engineeringMotionFeedbackSamples = 0;
            engineeringMotionMaximumObservedMovementDeg = 0;
        }
        Interlocked.Exchange(ref engineeringManualMotionActive, 1);
    }

    private string? ObserveEngineeringMotionResponse(DummyResponse response)
    {
        if (Volatile.Read(ref engineeringManualMotionActive) == 0) return null;
        if (response.Kind is not (DummyResponseKind.Queue or DummyResponseKind.GenericAck or DummyResponseKind.Error))
        {
            return null;
        }
        if (response.Kind == DummyResponseKind.GenericAck
            && !string.Equals(response.Raw, "ok", StringComparison.Ordinal))
        {
            return null;
        }
        if (response.Kind == DummyResponseKind.Error
            && !string.Equals(response.Detail, "CMD FIFO FULL", StringComparison.Ordinal))
        {
            return null;
        }

        string? correlationId;
        lock (commandStateGate)
        {
            correlationId = engineeringMotionResponseCorrelationId;
        }

        diagnostics.Record(new(
            "engineering.motion.device_response_observed",
            response.Kind == DummyResponseKind.Error
                ? GatewayDiagnosticSeverity.Warning
                : GatewayDiagnosticSeverity.Information,
            GetSession().SessionId,
            activeSerialSession?.PortName,
            $"ResponseKind={response.Kind}; unowned observation only, no command state transition"));
        return correlationId;
    }

    private bool ObserveDummyResponse(
        DummyResponse response,
        string sessionId,
        DummyResponseContext? responseContext)
    {
        var engineeringCorrelationId = responseContext?.CommandId is null
            ? ObserveEngineeringMotionResponse(response)
            : null;
        RecordProtocolFrame(
            ProtocolDirection.Rx,
            response.Raw,
            response.ContractKind,
            sessionId,
            engineeringCorrelationId ?? responseContext?.CorrelationId);
        ApplyObservedResponse(response);
        return engineeringCorrelationId is not null;
    }

    private void ObservePhysicalSerialWrite(DummySerialWrite write)
    {
        if (write.CommandId is not null)
        {
            RecordCommandTransmission(write.CommandId, write.Line);
        }

        RecordProtocolFrame(
            ProtocolDirection.Tx,
            write.Line,
            write.ParsedKind,
            write.SessionId,
            write.CorrelationId);

        if (write.DirectRequestId is null)
        {
            return;
        }

        DirectCommandEntry? entry;
        lock (commandStateGate)
        {
            directCommandEntries.TryGetValue(write.DirectRequestId, out entry);
        }

        if (entry?.Command.Kind == DummyDirectCommandKind.JointGroup)
        {
            BeginEngineeringManualMotion(
                write.SessionId,
                write.DirectRequestId,
                entry.Command.PositionsDeg!);
            diagnostics.Record(new(
                "engineering.motion.transport_written",
                GatewayDiagnosticSeverity.Information,
                write.SessionId,
                activeSerialSession?.PortName,
                $"RequestId={write.DirectRequestId} Result=sent-unconfirmed; terminal did not wait for a device reply"));
        }
        else if (entry?.Command.Kind is DummyDirectCommandKind.Stop or DummyDirectCommandKind.Disable)
        {
            EndEngineeringManualMotion();
        }

        UpdateDirectCommandResult(
            write.DirectRequestId,
            DirectCommandStatus.Sent,
            CommandEvidence.TransportWritten,
            "命令已写入 transport；终端未等待设备回包");
    }

    private void EndEngineeringManualMotion()
    {
        Interlocked.Exchange(ref engineeringManualMotionActive, 0);
        lock (commandStateGate)
        {
            engineeringMotionResponseCorrelationId = null;
            engineeringMotionRequestId = null;
            engineeringMotionTargetPositionsDeg = null;
            engineeringMotionBaselinePositionsDeg = null;
            engineeringMotionStartedTimestamp = 0;
            engineeringMotionFeedbackSamples = 0;
            engineeringMotionMaximumObservedMovementDeg = 0;
            engineeringMotionFeedbackFrozenSuspected = false;
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
            if (Volatile.Read(ref serialOpenRecoveryRequired) != 0)
            {
                throw new GatewayConflictException(
                    "A previous serial open was interrupted; restart the gateway before retrying");
            }

            if (activeSerialSession is not null
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
            using var openCancellation = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            openCancellation.CancelAfter(options.SerialOpenTimeout);
            try
            {
                await transport.OpenAsync(openCancellation.Token).ConfigureAwait(false);
            }
            catch (OperationCanceledException exception) when (!cancellationToken.IsCancellationRequested)
            {
                Interlocked.Exchange(ref serialOpenRecoveryRequired, 1);
                await DisposeTransportAsync(transport).ConfigureAwait(false);
                UpdateSession(OfflineSession(timeProvider.GetUtcNow()));
                diagnostics.Record(new(
                    "serial.open.timeout",
                    GatewayDiagnosticSeverity.Error,
                    sessionId,
                    request.PortName,
                    $"Serial open exceeded {options.SerialOpenTimeout.TotalMilliseconds:F0} ms; gateway restart required before retry",
                    exception));
                throw new GatewayDependencyException(
                    "Serial port open timed out; restart the gateway before retrying",
                    exception);
            }
            catch (OperationCanceledException exception)
            {
                Interlocked.Exchange(ref serialOpenRecoveryRequired, 1);
                await DisposeTransportAsync(transport).ConfigureAwait(false);
                UpdateSession(OfflineSession(timeProvider.GetUtcNow()));
                diagnostics.Record(new(
                    "serial.open.cancelled",
                    GatewayDiagnosticSeverity.Warning,
                    sessionId,
                    request.PortName,
                    "Serial open was cancelled; gateway restart required before retry",
                    exception));
                throw;
            }
            catch (Exception exception)
            {
                await DisposeTransportAsync(transport).ConfigureAwait(false);
                // Open never transferred transport ownership to the gateway. Keep the
                // failure in diagnostics and the API result, but return the session to
                // offline so a port owned by another process cannot trap Desktop close.
                UpdateSession(OfflineSession(timeProvider.GetUtcNow()));
                diagnostics.Record(new(
                    "serial.open.failed",
                    GatewayDiagnosticSeverity.Error,
                    sessionId,
                    request.PortName,
                    "Serial port could not be opened",
                    exception));
                throw new GatewayDependencyException("Serial port could not be opened", exception);
            }

            DummySerialSession serialSession;
            try
            {
                serialSession = new(
                    transport,
                    (response, responseContext) => ObserveDummyResponse(response, sessionId, responseContext),
                    (record, correlationId) => RecordProtocolError(
                        record.Reason ?? "discarded",
                        record.Value,
                        sessionId,
                        correlationId),
                    ObservePhysicalSerialWrite,
                    diagnostics,
                    timeProvider,
                    new SerialDuplexSchedulerOptions { ReadBufferBytes = options.ReadBufferBytes });
            }
            catch
            {
                await DisposeTransportAsync(transport).ConfigureAwait(false);
                UpdateSession(OfflineSession(timeProvider.GetUtcNow()));
                throw;
            }

            activeSerialSession = serialSession;
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
            pollingTask = PollAsync(serialSession, sessionId, pollingCancellation.Token);
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
        DummySerialSession? transport = null;
        Task? pollTask = null;
        TaskCompletionSource? completion = null;

        await lifecycleGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            ThrowIfDisposed(allowDisposing: true);
            var disconnectState = GetSession();
            if (!allowPossiblyEnabled
                && options.HardwareCommandsEnabled
                && activeSerialSession is not null
                && HasRunningCommand())
            {
                throw new GatewayConflictException("Wait for the active hardware command to finish, or use stop and disable, before disconnecting");
            }

            if (!allowPossiblyEnabled
                && options.HardwareCommandsEnabled
                && activeSerialSession is not null
                && disconnectState.ConnectionState == ConnectionState.Connected
                && disconnectState.MotorState == MotorState.Enabled)
            {
                throw new GatewayConflictException("Stop and confirm motor disabled before releasing the serial session");
            }

            if (disconnectCompletion is not null)
            {
                existingDisconnect = disconnectCompletion.Task;
            }
            else if (activeSerialSession is null)
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
                transport = activeSerialSession;
                pollTask = pollingTask;
                activeSerialSession = null;
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
            if (transport is not null) await transport.DisposeAsync().ConfigureAwait(false);

            if (pollTask is not null)
            {
                await pollTask.ConfigureAwait(false);
            }

            await AwaitRunningCommandsAsync().ConfigureAwait(false);

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
        try
        {
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
                activeSerialSession?.PortName,
                "Unexpected command execution failure",
                exception));
            result = Result(
                entry.Spec,
                CommandStatus.Failed,
                CommandResultCode.TransportError,
                CommandEvidence.GatewayAccepted,
                "网关内部错误；物理结果未知");
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
        var transport = activeSerialSession;
        if (!string.Equals(spec.SessionId, current.SessionId, StringComparison.Ordinal)
            || !string.Equals(spec.ProfileId, current.ProfileId, StringComparison.Ordinal))
        {
            return Result(spec, CommandStatus.Rejected, CommandResultCode.SessionMismatch, CommandEvidence.None, "命令会话或设备配置与当前连接不匹配");
        }

        if (current.ConnectionState != ConnectionState.Connected || transport?.IsRunning != true)
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

        if (!ReferenceEquals(activeSerialSession, transport)
            || GetSession().ConnectionState != ConnectionState.Connected)
        {
            return Result(spec, CommandStatus.Rejected, CommandResultCode.NotConnected, CommandEvidence.None, "串口会话已变化，命令未发送");
        }

        return spec.Kind switch
        {
            RobotCommandKind.Enable => await ExecuteEnableAsync(spec, transport, cancellationToken).ConfigureAwait(false),
            RobotCommandKind.StopAndDisable => await ExecuteStopAndDisableAsync(spec, transport, cancellationToken).ConfigureAwait(false),
            RobotCommandKind.SetMode => await ExecuteSetModeAsync(spec, transport, cancellationToken).ConfigureAwait(false),
            RobotCommandKind.JointGroup => await ExecuteJointGroupAsync(spec, transport, cancellationToken).ConfigureAwait(false),
            _ => Result(spec, CommandStatus.Unsupported, CommandResultCode.InvalidRequest, CommandEvidence.None, "不支持的命令类型")
        };
    }

    private async Task<CommandResult> ExecuteEnableAsync(
        CommandSpec spec,
        DummySerialSession transport,
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
            spec.SessionId,
            spec.CommandId,
            cancellationToken).ConfigureAwait(false);
        var enable = await QueryCoreAsync(transport, DummyReadQuery.Enable, spec.SessionId, spec.CommandId, cancellationToken).ConfigureAwait(false);
        return enable.Enabled == true
            ? Result(spec, CommandStatus.Completed, CommandResultCode.Ok, CommandEvidence.FeedbackConfirmed, "使能已由设备状态回读确认", enable.Raw)
            : Result(spec, CommandStatus.Unconfirmed, CommandResultCode.DeviceUnconfirmed, CommandEvidence.DeviceAck, "设备已应答，但使能状态未确认", acknowledgement.Raw);
    }

    private async Task<CommandResult> ExecuteSetModeAsync(
        CommandSpec spec,
        DummySerialSession transport,
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
            spec.SessionId,
            spec.CommandId,
            cancellationToken).ConfigureAwait(false);
        var mode = await QueryCoreAsync(transport, DummyReadQuery.Mode, spec.SessionId, spec.CommandId, cancellationToken).ConfigureAwait(false);
        return mode.Mode == spec.Mode
            ? Result(spec, CommandStatus.Completed, CommandResultCode.Ok, CommandEvidence.FeedbackConfirmed, $"模式 {spec.Mode} 已由设备回读确认", mode.Raw)
            : Result(spec, CommandStatus.Unconfirmed, CommandResultCode.DeviceUnconfirmed, CommandEvidence.DeviceAck, "设备已应答，但控制模式未确认", acknowledgement.Raw);
    }

    private async Task<CommandResult> ExecuteJointGroupAsync(
        CommandSpec spec,
        DummySerialSession transport,
        CancellationToken cancellationToken)
    {
        var line = DummyAsciiProtocol.FormatJointGroup(spec.PositionsDeg!, spec.SpeedDegS!.Value);
        var queue = await SendAndWaitAsync(
            transport,
            line,
            "jointGroupCommand",
            response => response.Kind == DummyResponseKind.Queue,
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
        IReadOnlyList<double>? firstObservedPositionsDeg = null;
        var validFeedbackSampleCount = 0;
        var maximumObservedMovementDeg = 0d;
        var lastReply = queue.Raw;
        using var completionCancellation = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        completionCancellation.CancelAfter(TimeSpan.FromMilliseconds(completion.TimeoutMs));
        try
        {
            while (true)
            {
                var cycleStartedTimestamp = timeProvider.GetTimestamp();
                var positions = await QueryCoreAsync(
                    transport,
                    DummyReadQuery.JointPositions,
                    spec.SessionId,
                    spec.CommandId,
                    completionCancellation.Token).ConfigureAwait(false);
                lastReply = positions.Raw;
                validFeedbackSampleCount++;
                if (firstObservedPositionsDeg is null)
                {
                    firstObservedPositionsDeg = [.. positions.PositionsDeg!];
                }
                else
                {
                    maximumObservedMovementDeg = Math.Max(
                        maximumObservedMovementDeg,
                        positions.PositionsDeg!
                            .Zip(firstObservedPositionsDeg, (current, first) => Math.Abs(current - first))
                            .Max());
                }

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

                await DelayForRemainingIntervalAsync(
                    cycleStartedTimestamp,
                    options.JointPollInterval,
                    completionCancellation.Token).ConfigureAwait(false);
            }
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            var feedbackFrozenCandidate = validFeedbackSampleCount >= 3
                && maximumErrorDeg > completion.PositionToleranceDeg
                && maximumObservedMovementDeg <= 1e-6;
            if (feedbackFrozenCandidate)
            {
                diagnostics.Record(new(
                    "motion.feedback.frozen_suspected",
                    GatewayDiagnosticSeverity.Warning,
                    spec.SessionId,
                    transport.PortName,
                    $"CommandId={spec.CommandId} Samples={validFeedbackSampleCount} MaxObservedMovementDeg={maximumObservedMovementDeg:F6} LastMaxTargetErrorDeg={maximumErrorDeg:F3}; valid #GETJPOS replies remained unchanged while the target was outside tolerance; verify firmware currentJoints acquisition in motion modes 1-3; physical result remains unknown"));
            }

            return Result(
                spec,
                CommandStatus.TimedOut,
                CommandResultCode.Timeout,
                CommandEvidence.DeviceQueued,
                feedbackFrozenCandidate
                    ? $"目标已入队，但连续 {validFeedbackSampleCount} 个有效 #GETJPOS 样本保持不变；疑似固件运动模式未刷新关节反馈，物理结果未知；最后最大误差 {maximumErrorDeg:F3} deg"
                    : $"目标已入队，但未在经批准的超时内保持到位；最后最大误差 {maximumErrorDeg:F3} deg",
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
        DummySerialSession transport,
        CancellationToken cancellationToken)
    {
        var evidence = new List<string>();
        await TrySafetyStepAsync(
            () => SendAndWaitAsync(
                transport,
                DummyAsciiProtocol.FormatSystemCommand(DummySystemCommand.Stop),
                "safetyCommand",
                response => response.Raw == "Stopped ok",
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
                spec.SessionId,
                spec.CommandId,
                cancellationToken),
            evidence).ConfigureAwait(false);

        try
        {
            var enable = await QueryCoreAsync(transport, DummyReadQuery.Enable, spec.SessionId, spec.CommandId, cancellationToken).ConfigureAwait(false);
            evidence.Add(enable.Raw);
            if (enable.Enabled == false)
            {
                EndEngineeringManualMotion();
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
        DummySerialSession transport,
        string line,
        string parsedKind,
        Func<DummyResponse, bool> isExpected,
        string sessionId,
        string commandId,
        CancellationToken cancellationToken)
    {
        var priority = parsedKind.StartsWith("safety", StringComparison.Ordinal)
            ? SerialWorkPriority.Safety
            : SerialWorkPriority.Interactive;
        return await transport.TransactAsync(
            $"command:{commandId}:{Guid.NewGuid():N}",
            line,
            parsedKind,
            sessionId,
            isExpected,
            priority,
            options.CommandTimeout,
            options.CommandTimeout,
            cancellationToken,
            commandId: commandId).ConfigureAwait(false);
    }

    private async Task WriteLineAsync(
        DummySerialSession transport,
        string line,
        string parsedKind,
        string sessionId,
        CancellationToken cancellationToken,
        string? correlationId = null,
        string? commandId = null)
    {
        var priority = parsedKind.StartsWith("safety", StringComparison.Ordinal)
            ? SerialWorkPriority.Safety
            : SerialWorkPriority.Interactive;
        var ticket = transport.QueueUnobserved(
            $"write:{commandId ?? "unowned"}:{Guid.NewGuid():N}",
            line,
            parsedKind,
            sessionId,
            priority,
            options.CommandTimeout,
            correlationId,
            commandId);
        if (!ticket.Accepted)
        {
            throw new GatewayConflictException(ticket.RejectionReason ?? "Serial write queue rejected the request");
        }

        var completion = await ticket.Completion!.WaitAsync(cancellationToken).ConfigureAwait(false);
        if (completion.Outcome != SerialWriteOutcome.Written)
        {
            throw new IOException(completion.Detail ?? $"Serial write ended as {completion.Outcome}");
        }
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
        var isManualJointCommand = command.Kind == DummyDirectCommandKind.JointGroup;
        if (!isQuery && !isReleaseCommand && Volatile.Read(ref commandInterlockLatched) != 0)
        {
            return "上一运动命令结果未知；仅允许查询、!STOP 或 !DISABLE";
        }

        if (!isQuery && !isReleaseCommand && !isManualJointCommand && current.Validity != Validity.Valid)
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
            || measured.PositionsDeg.Count != DummyAsciiProtocol.JointCount)
        {
            return "当前 Dummy 会话尚未取得六轴实测反馈";
        }

        return null;
    }

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

    private static string DirectFingerprint(DirectCommandRequest request, string normalizedLine)
    {
        var canonical = string.Join('|', request.SessionId, request.ProfileId, normalizedLine);
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(canonical)));
    }

    private DirectCommandResult UpdateDirectCommandResult(
        string requestId,
        DirectCommandStatus status,
        CommandEvidence evidence,
        string message,
        string? deviceReply = null)
    {
        DirectCommandResult result;
        lock (commandStateGate)
        {
            if (!directCommandEntries.TryGetValue(requestId, out var entry))
            {
                return new(
                    requestId,
                    GetSession().SessionId,
                    status,
                    evidence,
                    string.Empty,
                    message,
                    timeProvider.GetUtcNow(),
                    deviceReply);
            }

            result = entry.Result with
            {
                Status = status,
                Evidence = evidence,
                Message = message,
                TimestampUtc = timeProvider.GetUtcNow(),
                DeviceReply = deviceReply
            };
            entry.Result = result;
            if (IsTerminalDirectStatus(status))
            {
                entry.Completion.TrySetResult(result);
            }
            TrimDirectCommandHistoryLocked();
        }

        EnqueueEvent(new DirectCommandResultEvent(result));
        return result;
    }

    private async Task ObserveDirectWriteCompletionAsync(string requestId, Task<SerialWriteCompletion> completionTask)
    {
        try
        {
            var completion = await completionTask.ConfigureAwait(false);
            if (completion.Outcome == SerialWriteOutcome.Written)
            {
                // The physical write observer publishes Sent before the scheduler
                // completes the ticket. No additional transition is needed here.
                return;
            }

            var (status, message) = completion.Outcome switch
            {
                SerialWriteOutcome.Expired => (DirectCommandStatus.Expired, "请求在有界队列内过期，未写入 transport"),
                SerialWriteOutcome.Superseded => (DirectCommandStatus.Superseded, "请求被更高优先级安全任务淘汰，未写入 transport"),
                SerialWriteOutcome.Cancelled => (DirectCommandStatus.Cancelled, "串口会话关闭，排队请求已取消"),
                SerialWriteOutcome.Failed => (DirectCommandStatus.Failed, "串口物理写入失败；设备状态未知"),
                _ => (DirectCommandStatus.Failed, "串口请求进入未知终态")
            };
            UpdateDirectCommandResult(
                requestId,
                status,
                CommandEvidence.GatewayAccepted,
                message,
                completion.Detail);
        }
        catch (Exception exception)
        {
            UpdateDirectCommandResult(
                requestId,
                DirectCommandStatus.Failed,
                CommandEvidence.GatewayAccepted,
                "串口写入结果观察失败",
                SafeExceptionMessage(exception));
        }
    }

    private static bool IsTerminalDirectStatus(DirectCommandStatus status) =>
        status is not DirectCommandStatus.Queued;

    private void TrimDirectCommandHistoryLocked()
    {
        while (directCommandEntries.Count > options.CommandHistoryCapacity && directCommandOrder.Count > 0)
        {
            var candidateId = directCommandOrder.Peek();
            if (!directCommandEntries.TryGetValue(candidateId, out var candidate)
                || !candidate.Completion.Task.IsCompleted)
            {
                break;
            }

            directCommandOrder.Dequeue();
            directCommandEntries.Remove(candidateId);
        }
    }

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
        lock (commandStateGate)
        {
            foreach (var entry in commandEntries.Values.Where(item => !item.Completion.Task.IsCompleted))
            {
                entry.ExecutionCancellation.Cancel();
            }
        }
    }

    private bool HasRunningCommand()
    {
        lock (commandStateGate)
        {
            return commandEntries.Values.Any(entry => !entry.Completion.Task.IsCompleted);
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
                .Concat(directCommandEntries.Values
                    .Select(entry => entry.Completion.Task)
                    .Where(task => !task.IsCompleted))
                .ToArray();
        }

        if (tasks.Length > 0)
        {
            await Task.WhenAll(tasks).ConfigureAwait(false);
        }
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
            directCommandEntries.Clear();
            directCommandOrder.Clear();
            exclusiveCommandId = null;
            engineeringMotionResponseCorrelationId = null;
            engineeringMotionRequestId = null;
            engineeringMotionTargetPositionsDeg = null;
            engineeringMotionBaselinePositionsDeg = null;
            engineeringMotionStartedTimestamp = 0;
            engineeringMotionFeedbackSamples = 0;
            engineeringMotionMaximumObservedMovementDeg = 0;
            engineeringMotionFeedbackFrozenSuspected = false;
        }
        Interlocked.Exchange(ref commandInterlockLatched, 0);
        Interlocked.Exchange(ref engineeringManualMotionActive, 0);
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

    private async Task PollAsync(DummySerialSession transport, string sessionId, CancellationToken cancellationToken)
    {
        var consecutiveTimeouts = 0;
        var statusRefreshRequired = true;
        var nextStatusQuery = DummyReadQuery.Mode;
        int? pendingMode = null;
        bool? pendingEnable = null;
        var lastStatusQueryTimestamp = timeProvider.GetTimestamp();
        var statusQueryInterval = TimeSpan.FromTicks(Math.Max(
            options.JointPollInterval.Ticks,
            options.StatusPollInterval.Ticks / 2));
        try
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                var cycleStartedTimestamp = timeProvider.GetTimestamp();
                try
                {
                    var positions = await QueryAsync(transport, DummyReadQuery.JointPositions, sessionId, cancellationToken).ConfigureAwait(false);
                    if (positions.Kind != DummyResponseKind.JointPositions)
                    {
                        throw new GatewayProtocolException("Joint polling returned an incompatible response type");
                    }

                    if (statusRefreshRequired
                        || timeProvider.GetElapsedTime(lastStatusQueryTimestamp) >= statusQueryInterval)
                    {
                        var status = await QueryAsync(
                            transport,
                            nextStatusQuery,
                            sessionId,
                            cancellationToken).ConfigureAwait(false);
                        if (nextStatusQuery == DummyReadQuery.Mode)
                        {
                            if (status.Kind != DummyResponseKind.Mode)
                            {
                                throw new GatewayProtocolException("Mode polling returned an incompatible response type");
                            }

                            pendingMode = status.Mode!.Value;
                            nextStatusQuery = DummyReadQuery.Enable;
                        }
                        else
                        {
                            if (status.Kind != DummyResponseKind.Enable)
                            {
                                throw new GatewayProtocolException("Enable polling returned an incompatible response type");
                            }

                            pendingEnable = status.Enabled!.Value;
                            nextStatusQuery = DummyReadQuery.Mode;
                        }

                        lastStatusQueryTimestamp = timeProvider.GetTimestamp();
                        if (pendingMode is { } mode && pendingEnable is { } enabled)
                        {
                            MarkStatusCycleValid(mode, enabled);
                            pendingMode = null;
                            pendingEnable = null;
                            statusRefreshRequired = false;
                        }
                    }

                    if (consecutiveTimeouts > 0 && Volatile.Read(ref engineeringManualMotionActive) != 0)
                    {
                        diagnostics.Record(new(
                            "engineering.motion.feedback_resumed",
                            GatewayDiagnosticSeverity.Information,
                            sessionId,
                            transport.PortName,
                            $"Joint polling resumed after {consecutiveTimeouts} consecutive timeout(s)"));
                    }
                    consecutiveTimeouts = 0;
                }
                catch (GatewayQueryTimeoutException exception)
                {
                    consecutiveTimeouts++;
                    statusRefreshRequired = true;
                    pendingMode = null;
                    pendingEnable = null;
                    nextStatusQuery = DummyReadQuery.Mode;
                    MarkFeedbackStale();
                    var manualMotionActive = Volatile.Read(ref engineeringManualMotionActive) != 0;
                    if (!manualMotionActive || consecutiveTimeouts == 1 || consecutiveTimeouts % 20 == 0)
                    {
                        RecordProtocolError("queryTimeout", exception.Message, sessionId);
                        diagnostics.Record(new(
                            manualMotionActive
                                ? "engineering.motion.query_timeout"
                                : "serial.query.timeout",
                            GatewayDiagnosticSeverity.Warning,
                            sessionId,
                            transport.PortName,
                            manualMotionActive
                                ? $"Query timeout while manual motion is active; retrying without disconnect, Consecutive={consecutiveTimeouts}"
                                : $"Status query timeout {consecutiveTimeouts}/{options.ConsecutiveTimeoutLimit}",
                            exception));
                    }
                    if (!manualMotionActive && consecutiveTimeouts >= options.ConsecutiveTimeoutLimit)
                    {
                        throw;
                    }
                }
                catch (DummyResponseFencePreemptedException)
                {
                    // A P0 safety transaction deliberately displaced this P2
                    // telemetry waiter. The scheduler and transport remain
                    // healthy; the next loop may poll again after safety releases
                    // its response fence.
                    statusRefreshRequired = true;
                    pendingMode = null;
                    pendingEnable = null;
                    nextStatusQuery = DummyReadQuery.Mode;
                }

                await DelayForRemainingIntervalAsync(
                    cycleStartedTimestamp,
                    options.JointPollInterval,
                    cancellationToken).ConfigureAwait(false);
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
        }
        catch (Exception exception)
        {
            await HandlePollingFaultAsync(transport, sessionId, exception).ConfigureAwait(false);
        }
    }

    private Task<DummyResponse> QueryAsync(
        DummySerialSession transport,
        DummyReadQuery query,
        string sessionId,
        CancellationToken cancellationToken,
        string? commandId = null) =>
        QueryCoreAsync(transport, query, sessionId, commandId, cancellationToken);

    private async Task DelayForRemainingIntervalAsync(
        long cycleStartedTimestamp,
        TimeSpan interval,
        CancellationToken cancellationToken)
    {
        var remaining = interval - timeProvider.GetElapsedTime(cycleStartedTimestamp);
        if (remaining > TimeSpan.Zero)
        {
            await Task.Delay(remaining, timeProvider, cancellationToken).ConfigureAwait(false);
            return;
        }

        cancellationToken.ThrowIfCancellationRequested();
        await Task.Yield();
    }

    private async Task<DummyResponse> QueryCoreAsync(
        DummySerialSession transport,
        DummyReadQuery query,
        string sessionId,
        string? commandId,
        CancellationToken cancellationToken)
    {
        var line = DummyAsciiProtocol.FormatQuery(query);
        return await transport.TransactAsync(
            $"query:{query}:{Guid.NewGuid():N}",
            line,
            "query",
            sessionId,
            response => DummyAsciiProtocol.IsExpectedResponse(query, response),
            commandId is null ? SerialWorkPriority.Telemetry : SerialWorkPriority.Interactive,
            options.CommandTimeout,
            options.QueryTimeout,
            cancellationToken,
            commandId: commandId).ConfigureAwait(false);
    }

    private async Task HandlePollingFaultAsync(DummySerialSession transport, string sessionId, Exception exception)
    {
        var ownsTransport = false;
        await lifecycleGate.WaitAsync(CancellationToken.None).ConfigureAwait(false);
        try
        {
            if (ReferenceEquals(activeSerialSession, transport))
            {
                ownsTransport = true;
                activeSerialSession = null;
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
        await transport.DisposeAsync().ConfigureAwait(false);
    }

    private void ApplyObservedResponse(DummyResponse response)
    {
        if (response.Kind == DummyResponseKind.JointPositions && response.PositionsDeg is not null)
        {
            var feedbackValidity = ObserveEngineeringMotionFeedback(response.PositionsDeg);
            JointStateFrame next;
            lock (stateGate)
            {
                next = new(
                    jointState.Sequence + 1,
                    GatewayContractV1.DummyProfileId,
                    timeProvider.GetUtcNow(),
                    [.. response.PositionsDeg],
                    DataSource.Measured,
                    feedbackValidity);
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

    private Validity ObserveEngineeringMotionFeedback(IReadOnlyList<double> positionsDeg)
    {
        if (Volatile.Read(ref engineeringManualMotionActive) == 0)
        {
            return Validity.Valid;
        }

        var frozenBecameSuspected = false;
        var feedbackResumed = false;
        string? requestId;
        string? correlationId;
        int sampleCount;
        double maximumObservedMovementDeg;
        double maximumTargetErrorDeg;
        TimeSpan elapsed;
        bool feedbackFrozenSuspected;
        lock (commandStateGate)
        {
            if (engineeringMotionTargetPositionsDeg is null
                || engineeringMotionTargetPositionsDeg.Length != positionsDeg.Count)
            {
                return engineeringMotionFeedbackFrozenSuspected ? Validity.Stale : Validity.Valid;
            }

            engineeringMotionBaselinePositionsDeg ??= [.. positionsDeg];
            engineeringMotionFeedbackSamples++;
            engineeringMotionMaximumObservedMovementDeg = Math.Max(
                engineeringMotionMaximumObservedMovementDeg,
                positionsDeg.Zip(
                    engineeringMotionBaselinePositionsDeg,
                    (current, baseline) => Math.Abs(current - baseline)).Max());
            maximumTargetErrorDeg = positionsDeg.Zip(
                engineeringMotionTargetPositionsDeg,
                (current, target) => Math.Abs(target - current)).Max();
            elapsed = timeProvider.GetElapsedTime(engineeringMotionStartedTimestamp);

            if (engineeringMotionFeedbackFrozenSuspected
                && engineeringMotionMaximumObservedMovementDeg > EngineeringFeedbackMovementEpsilonDeg)
            {
                engineeringMotionFeedbackFrozenSuspected = false;
                feedbackResumed = true;
            }
            else if (!engineeringMotionFeedbackFrozenSuspected
                && engineeringMotionFeedbackSamples >= EngineeringFeedbackMinimumSamples
                && elapsed >= options.EngineeringFeedbackFreezeWindow
                && engineeringMotionMaximumObservedMovementDeg <= EngineeringFeedbackMovementEpsilonDeg
                && maximumTargetErrorDeg >= EngineeringFeedbackTargetErrorThresholdDeg)
            {
                engineeringMotionFeedbackFrozenSuspected = true;
                frozenBecameSuspected = true;
            }

            requestId = engineeringMotionRequestId;
            correlationId = engineeringMotionResponseCorrelationId;
            sampleCount = engineeringMotionFeedbackSamples;
            maximumObservedMovementDeg = engineeringMotionMaximumObservedMovementDeg;
            feedbackFrozenSuspected = engineeringMotionFeedbackFrozenSuspected;
        }

        if (frozenBecameSuspected)
        {
            var detail = $"RequestId={requestId ?? "unknown"} Samples={sampleCount} WindowMs={elapsed.TotalMilliseconds:F0} MaxObservedMovementDeg={maximumObservedMovementDeg:F3} MaxTargetErrorDeg={maximumTargetErrorDeg:F3}; #GETJPOS replies continued but the measured angles did not change; firmware feedback acquisition may be frozen while enabled";
            RecordProtocolError("feedbackFrozen", detail, GetSession().SessionId, correlationId);
            diagnostics.Record(new(
                "engineering.motion.feedback_frozen_suspected",
                GatewayDiagnosticSeverity.Warning,
                GetSession().SessionId,
                activeSerialSession?.PortName,
                detail));
        }
        else if (feedbackResumed)
        {
            diagnostics.Record(new(
                "engineering.motion.feedback_progress_resumed",
                GatewayDiagnosticSeverity.Information,
                GetSession().SessionId,
                activeSerialSession?.PortName,
                $"RequestId={requestId ?? "unknown"} Samples={sampleCount} MaxObservedMovementDeg={maximumObservedMovementDeg:F3}; measured joint motion is visible again"));
        }

        return Volatile.Read(ref engineeringManualMotionActive) != 0 && feedbackFrozenSuspected
            ? Validity.Stale
            : Validity.Valid;
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
                activeSerialSession?.PortName,
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
                    activeSerialSession?.PortName,
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
                    activeSerialSession?.PortName,
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
            case DirectCommandResultEvent directCommandResultEvent:
                await eventSink.PublishDirectCommandResultAsync(directCommandResultEvent.Value, cancellationToken).ConfigureAwait(false);
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
    private sealed record DirectCommandResultEvent(DirectCommandResult Value) : GatewayEvent;

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

    private sealed class DirectCommandEntry(
        string fingerprint,
        DummyDirectCommand command,
        DirectCommandResult result,
        TaskCompletionSource<DirectCommandResult> completion)
    {
        public string Fingerprint { get; } = fingerprint;
        public DummyDirectCommand Command { get; } = command;
        public DirectCommandResult Result { get; set; } = result;
        public TaskCompletionSource<DirectCommandResult> Completion { get; } = completion;
    }
}
