using System.Text;
using System.Threading.Channels;
using AethorStudioV2.Domain;

namespace AethorStudioV2.Application;

public sealed class ReadOnlyRobotGateway : IAsyncDisposable
{
    private readonly IAsciiTransportFactory transportFactory;
    private readonly ISerialPortCatalog portCatalog;
    private readonly IReadOnlyGatewayEventSink eventSink;
    private readonly IGatewayDiagnostics diagnostics;
    private readonly TimeProvider timeProvider;
    private readonly ReadOnlyGatewayOptions options;
    private readonly SemaphoreSlim lifecycleGate = new(1, 1);
    private readonly object stateGate = new();
    private readonly Queue<ProtocolFrame> protocolFrames = new();
    private readonly Channel<GatewayEvent> eventQueue;
    private readonly CancellationTokenSource eventPumpCancellation = new();
    private readonly Task eventPumpTask;

    private RobotSessionSnapshot session;
    private JointStateFrame jointState;
    private IAsciiTransport? activeTransport;
    private CancellationTokenSource? pollingCancellation;
    private Task? pollingTask;
    private TaskCompletionSource? disconnectCompletion;
    private bool disposed;

    public ReadOnlyRobotGateway(
        IAsciiTransportFactory transportFactory,
        ISerialPortCatalog portCatalog,
        IReadOnlyGatewayEventSink? eventSink = null,
        IGatewayDiagnostics? diagnostics = null,
        TimeProvider? timeProvider = null,
        ReadOnlyGatewayOptions? options = null)
    {
        this.transportFactory = transportFactory;
        this.portCatalog = portCatalog;
        this.eventSink = eventSink ?? new NullGatewayEventSink();
        this.diagnostics = diagnostics ?? new NullGatewayDiagnostics();
        this.timeProvider = timeProvider ?? TimeProvider.System;
        this.options = options ?? new ReadOnlyGatewayOptions();
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
    }

    public ReadOnlyGatewayCapabilities Capabilities { get; } = new(
        GatewayContractV1.Version,
        GatewayContractV1.DummyProtocolAdapterId,
        SerialEnumeration: true,
        ReadOnlyConnection: true,
        LiveTelemetry: true,
        HardwareCommands: false,
        AllowedQueries: ["#GETJPOS", "#GETMODE", "#GETENABLE"]);

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

    public ValueTask<IReadOnlyList<SerialPortDescriptor>> ListPortsAsync(CancellationToken cancellationToken) =>
        portCatalog.ListAsync(cancellationToken);

    public async Task<RobotSessionSnapshot> ConnectAsync(
        ReadOnlyConnectRequest request,
        CancellationToken cancellationToken)
    {
        ValidateConnectRequest(request);
        await lifecycleGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            ThrowIfDisposed();
            if (activeTransport is not null || GetSession().ConnectionState is ConnectionState.Connecting or ConnectionState.Connected or ConnectionState.Disconnecting)
            {
                throw new GatewayConflictException("A robot session is already active");
            }

            var availablePorts = await portCatalog.ListAsync(cancellationToken).ConfigureAwait(false);
            if (!availablePorts.Any(port => string.Equals(port.PortName, request.PortName, StringComparison.OrdinalIgnoreCase)))
            {
                throw new GatewayValidationException("Selected serial port is not currently enumerated");
            }

            var sessionId = Guid.NewGuid().ToString("N");
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

    public async Task<RobotSessionSnapshot> DisconnectAsync(CancellationToken cancellationToken)
    {
        Task? existingDisconnect = null;
        IAsciiTransport? transport = null;
        Task? pollTask = null;
        TaskCompletionSource? completion = null;

        await lifecycleGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            ThrowIfDisposed(allowDisposing: true);
            if (disconnectCompletion is not null)
            {
                existingDisconnect = disconnectCompletion.Task;
            }
            else if (activeTransport is null)
            {
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
            if (pollTask is not null)
            {
                await pollTask.ConfigureAwait(false);
            }

            if (transport is not null)
            {
                await DisposeTransportAsync(transport).ConfigureAwait(false);
            }

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

        await DisconnectAsync(CancellationToken.None).ConfigureAwait(false);
        eventQueue.Writer.TryComplete();
        eventPumpCancellation.CancelAfter(TimeSpan.FromSeconds(2));
        try
        {
            await eventPumpTask.ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            diagnostics.Record(new(
                "events.shutdown.timeout",
                GatewayDiagnosticSeverity.Warning,
                null,
                null,
                "Event publisher did not drain within two seconds"));
        }

        eventPumpCancellation.Dispose();
        lifecycleGate.Dispose();
    }

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
                        throw new GatewayProtocolException("Read-only status cycle returned incompatible response types");
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
                        $"Read-only query timeout {consecutiveTimeouts}/{options.ConsecutiveTimeoutLimit}",
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
        CancellationToken cancellationToken)
    {
        var correlationId = Guid.NewGuid().ToString("N");
        var line = DummyAsciiProtocol.FormatQuery(query);
        var encoded = Encoding.ASCII.GetBytes(line + DummyAsciiProtocol.LineEnding);
        await transport.WriteAsync(encoded, cancellationToken).ConfigureAwait(false);
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
                }
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
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

    private static void ValidateConnectRequest(ReadOnlyConnectRequest request)
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
        _ => "Read-only serial session failed"
    };

    private async ValueTask DisposeTransportAsync(IAsciiTransport transport)
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

        await transport.DisposeAsync().ConfigureAwait(false);
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
}
