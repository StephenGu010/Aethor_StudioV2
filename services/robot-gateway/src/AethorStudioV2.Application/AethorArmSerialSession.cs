using System.Collections.Concurrent;
using System.Globalization;
using System.Text;
using AethorStudioV2.Domain;

namespace AethorStudioV2.Application;

public sealed record AethorArmSerialWrite(
    string WorkId,
    uint? RequestId,
    string Operation,
    string Line,
    string HostSessionId,
    string CorrelationId,
    SerialWorkPriority Priority);

public sealed record AethorArmResponseContext(
    string WorkId,
    uint RequestId,
    string Operation,
    string HostSessionId,
    string CorrelationId,
    SerialWorkPriority Priority);

public sealed record AethorArmSessionProbeSnapshot(
    bool Running,
    bool IdentityEstablished,
    int ActiveRequests,
    long ValidFrames,
    long InvalidFrames,
    long CorrelatedResponses,
    long OrphanResponses,
    long ProjectedMotorFrames,
    long PublishedMotorFrames,
    long CoalescedMotorFrames,
    long RejectedMotorFrames,
    long TimedOutRequests,
    long BootResets,
    SerialDuplexProbeSnapshot Scheduler);

public sealed class AethorArmRemoteErrorException(uint requestId, string errorCode)
    : GatewayException($"Aethor controller rejected request {requestId}: {errorCode}")
{
    public uint RequestId { get; } = requestId;
    public string ErrorCode { get; } = errorCode;
}

public sealed class AethorArmFirmwareRestartedException(string message)
    : GatewayException(message);

/// <summary>
/// Owns one Aethor ASCII protocol session over an already-open transport.
/// Request IDs correlate responses without a response fence, so the writer is
/// never held while a request waits for a device result.
/// </summary>
public sealed class AethorArmSerialSession : IAsyncDisposable
{
    private const int MaximumPendingRequests = 64;
    private static readonly HashSet<string> SingleResponseOperations = new(StringComparer.Ordinal)
    {
        "HELLO",
        "GET_INFO",
        "GET_CONFIG",
        "GET_STATE",
        "GET_JPOS",
        "GET_MOTORS",
        "GET_DIAG",
        "HEARTBEAT",
        "SET_STREAM"
    };

    private readonly string jointGroupId;
    private readonly string hostSessionId;
    private readonly IGatewayDiagnostics diagnostics;
    private readonly TimeProvider timeProvider;
    private readonly SerialDuplexScheduler scheduler;
    private readonly AethorArmAsciiLineDecoder decoder = new();
    private readonly ConcurrentDictionary<uint, PendingRequest> pendingRequests = new();
    private readonly ConcurrentDictionary<string, AethorArmSerialWrite> writes = new(StringComparer.Ordinal);
    private readonly Action<AethorArmAsciiFrame, AethorArmResponseContext?> frameObserver;
    private readonly Action<AethorArmDecodedRecord, string?> discardedObserver;
    private readonly Action<AethorArmSerialWrite> physicalWriteObserver;
    private readonly Action<AethorArmSessionIdentity?> identityObserver;
    private readonly object identityGate = new();
    private readonly object requestIdGate = new();
    private readonly object motorDispatchGate = new();
    private readonly System.Threading.Channels.Channel<byte> motorDispatchWake;
    private readonly Task monitorTask;

    private AethorArmSessionIdentity? identity;
    private AethorArmMotorFrameV1? pendingMotorFrame;
    private uint lastClaimedRequestId;
    private long gatewayFrameSequence;
    private long validFrames;
    private long invalidFrames;
    private long correlatedResponses;
    private long orphanResponses;
    private long projectedMotorFrames;
    private long publishedMotorFrames;
    private long coalescedMotorFrames;
    private long rejectedMotorFrames;
    private long timedOutRequests;
    private long bootResets;
    private int disposed;

    public AethorArmSerialSession(
        IAsciiTransport transport,
        string jointGroupId,
        string hostSessionId,
        Action<AethorArmAsciiFrame, AethorArmResponseContext?>? frameObserver = null,
        Action<AethorArmDecodedRecord, string?>? discardedObserver = null,
        Action<AethorArmSerialWrite>? physicalWriteObserver = null,
        Action<AethorArmSessionIdentity?>? identityObserver = null,
        IGatewayDiagnostics? diagnostics = null,
        TimeProvider? timeProvider = null,
        SerialDuplexSchedulerOptions? schedulerOptions = null)
    {
        ArgumentNullException.ThrowIfNull(transport);
        if (jointGroupId is not AethorArmGatewayContractV1.LeftArmGroupId
            and not AethorArmGatewayContractV1.RightArmGroupId)
        {
            throw new ArgumentException("Aethor joint group must be left-arm or right-arm", nameof(jointGroupId));
        }
        ArgumentException.ThrowIfNullOrWhiteSpace(hostSessionId);

        this.jointGroupId = jointGroupId;
        this.hostSessionId = hostSessionId;
        this.frameObserver = frameObserver ?? ((_, _) => { });
        this.discardedObserver = discardedObserver ?? ((_, _) => { });
        this.physicalWriteObserver = physicalWriteObserver ?? (_ => { });
        this.identityObserver = identityObserver ?? (_ => { });
        this.diagnostics = diagnostics ?? new NullGatewayDiagnostics();
        this.timeProvider = timeProvider ?? TimeProvider.System;
        motorDispatchWake = System.Threading.Channels.Channel.CreateBounded<byte>(
            new System.Threading.Channels.BoundedChannelOptions(1)
            {
                SingleReader = true,
                SingleWriter = true,
                FullMode = System.Threading.Channels.BoundedChannelFullMode.DropWrite
            });
        scheduler = new(
            transport,
            HandleReceivedChunkAsync,
            this.diagnostics,
            this.timeProvider,
            schedulerOptions,
            writeObserver: ObservePhysicalWrite,
            writeStartedObserver: ArmPendingRequest);
        monitorTask = MonitorSchedulerAsync();
        this.diagnostics.Record(new(
            "aethor.session.started",
            GatewayDiagnosticSeverity.Information,
            hostSessionId,
            transport.PortName,
            $"JointGroup={jointGroupId} ProductionRegistration=disabled"));
    }

    public string PortName => scheduler.PortName;
    public bool IsRunning => scheduler.GetProbeSnapshot().Running;
    public Task Completion => monitorTask;

    public AethorArmSessionIdentity? GetIdentity()
    {
        lock (identityGate)
        {
            return identity;
        }
    }

    public AethorArmSessionProbeSnapshot GetProbeSnapshot()
    {
        var currentIdentity = GetIdentity();
        return new(
            scheduler.GetProbeSnapshot().Running,
            currentIdentity is not null,
            pendingRequests.Count,
            Interlocked.Read(ref validFrames),
            Interlocked.Read(ref invalidFrames),
            Interlocked.Read(ref correlatedResponses),
            Interlocked.Read(ref orphanResponses),
            Interlocked.Read(ref projectedMotorFrames),
            Interlocked.Read(ref publishedMotorFrames),
            Interlocked.Read(ref coalescedMotorFrames),
            Interlocked.Read(ref rejectedMotorFrames),
            Interlocked.Read(ref timedOutRequests),
            Interlocked.Read(ref bootResets),
            scheduler.GetProbeSnapshot());
    }

    /// <summary>
    /// Waits for the newest projected snapshot. Exactly one production event
    /// pump must own this pull boundary. Slow consumers never backpressure the
    /// serial parser; intermediate snapshots are replaced by the newest one.
    /// </summary>
    public async ValueTask<AethorArmMotorFrameV1> WaitForLatestMotorFrameAsync(
        CancellationToken cancellationToken)
    {
        while (true)
        {
            if (TryReadLatestMotorFrame(out var frame))
            {
                return frame;
            }
            try
            {
                await motorDispatchWake.Reader.ReadAsync(cancellationToken).ConfigureAwait(false);
            }
            catch (System.Threading.Channels.ChannelClosedException)
            {
                throw new OperationCanceledException("Aethor motor frame stream is closed", cancellationToken);
            }
        }
    }

    public bool TryReadLatestMotorFrame(out AethorArmMotorFrameV1 frame)
    {
        lock (motorDispatchGate)
        {
            if (Volatile.Read(ref disposed) != 0 || pendingMotorFrame is null)
            {
                frame = null!;
                return false;
            }
            frame = pendingMotorFrame;
            pendingMotorFrame = null;
        }
        Interlocked.Increment(ref publishedMotorFrames);
        return true;
    }

    public async Task<AethorArmAsciiFrame> QueryAsync(
        string workId,
        uint requestId,
        string operation,
        IReadOnlyList<KeyValuePair<string, string>>? fields,
        SerialWorkPriority priority,
        TimeSpan maximumQueueDelay,
        TimeSpan responseTimeout,
        CancellationToken cancellationToken,
        string? correlationId = null)
    {
        ThrowIfDisposed();
        cancellationToken.ThrowIfCancellationRequested();
        if (!SingleResponseOperations.Contains(operation))
        {
            throw new GatewayValidationException($"{operation} is not a single-response Aethor request");
        }
        if (operation != "HELLO" && GetIdentity() is null)
        {
            throw new GatewayConflictException("Aethor HELLO must establish device identity before other requests");
        }
        var line = AethorArmAsciiProtocol.FormatRequest(requestId, operation, fields);
        var write = CreateWrite(
            workId,
            requestId,
            operation,
            line,
            priority,
            correlationId ?? Guid.NewGuid().ToString("N"));
        var pending = new PendingRequest(write);
        RegisterPendingRequest(pending);

        try
        {
            var ticket = QueueWrite(write, maximumQueueDelay);
            if (!ticket.Accepted)
            {
                throw new GatewayConflictException(ticket.RejectionReason ?? "Serial write queue rejected the Aethor request");
            }

            var writeCompletion = await ticket.Completion!
                .WaitAsync(cancellationToken)
                .ConfigureAwait(false);
            ThrowForWriteOutcome(writeCompletion, operation, cancellationToken);

            try
            {
                return await pending.Response.Task
                    .WaitAsync(responseTimeout, cancellationToken)
                    .ConfigureAwait(false);
            }
            catch (TimeoutException)
            {
                Interlocked.Increment(ref timedOutRequests);
                diagnostics.Record(new(
                    "aethor.session.request.timeout",
                    GatewayDiagnosticSeverity.Warning,
                    hostSessionId,
                    PortName,
                    $"RequestId={requestId} Operation={operation}"));
                throw new GatewayQueryTimeoutException($"{operation} request_id={requestId}");
            }
        }
        finally
        {
            pendingRequests.TryRemove(new KeyValuePair<uint, PendingRequest>(requestId, pending));
        }
    }

    /// <summary>
    /// Queues one validated protocol request and completes at physical write.
    /// No pending response owner is created, so terminal traffic cannot hold
    /// the writer while the device remains silent.
    /// </summary>
    public SerialWriteTicket QueueValidatedUnobserved(
        string workId,
        string line,
        SerialWorkPriority priority,
        TimeSpan maximumQueueDelay,
        string? correlationId = null)
    {
        ThrowIfDisposed();
        var parsed = AethorArmAsciiProtocol.ParseFrame(line);
        if (!parsed.IsValid || parsed.Frame?.Kind != AethorArmFrameKind.Request)
        {
            throw new GatewayValidationException("Aethor terminal line must be one valid REQ frame without a line ending");
        }
        if (parsed.Frame.Subject == "HELLO")
        {
            throw new GatewayValidationException("Aethor HELLO is owned by the correlated session handshake");
        }
        if (GetIdentity() is null)
        {
            throw new GatewayConflictException("Aethor HELLO must establish device identity before terminal writes");
        }
        ClaimRequestId(parsed.Frame.Sequence);

        var write = CreateWrite(
            workId,
            requestId: null,
            parsed.Frame.Subject,
            line,
            priority,
            correlationId ?? Guid.NewGuid().ToString("N"));
        return QueueWrite(write, maximumQueueDelay);
    }

    public async ValueTask DisposeAsync()
    {
        if (Interlocked.Exchange(ref disposed, 1) != 0)
        {
            return;
        }

        CancelPendingRequests(new OperationCanceledException("Aethor serial session is closing"));
        await scheduler.DisposeAsync().ConfigureAwait(false);
        await monitorTask.ConfigureAwait(false);
        lock (motorDispatchGate)
        {
            pendingMotorFrame = null;
        }
        motorDispatchWake.Writer.TryComplete();
        var incomplete = decoder.Finish();
        if (incomplete is not null)
        {
            SafeObserveDiscard(incomplete, null);
        }
        writes.Clear();
        SetIdentity(null, notify: true);
        diagnostics.Record(new(
            "aethor.session.closed",
            GatewayDiagnosticSeverity.Information,
            hostSessionId,
            PortName,
            $"Pending={pendingRequests.Count} Projected={Interlocked.Read(ref projectedMotorFrames)} Invalid={Interlocked.Read(ref invalidFrames)}"));
    }

    private SerialWriteTicket QueueWrite(AethorArmSerialWrite write, TimeSpan maximumQueueDelay)
    {
        if (!writes.TryAdd(write.WorkId, write))
        {
            throw new GatewayConflictException("Serial work ID is already active");
        }

        SerialWriteTicket ticket;
        try
        {
            ticket = scheduler.QueueWrite(new(
                write.WorkId,
                Encoding.ASCII.GetBytes(write.Line + AethorArmAsciiProtocol.LineEnding),
                write.Priority,
                maximumQueueDelay,
                write.CorrelationId));
        }
        catch
        {
            writes.TryRemove(write.WorkId, out _);
            throw;
        }

        if (!ticket.Accepted)
        {
            writes.TryRemove(write.WorkId, out _);
            return ticket;
        }

        _ = ticket.Completion!.ContinueWith(
            completedTask => writes.TryRemove(write.WorkId, out var _),
            CancellationToken.None,
            TaskContinuationOptions.ExecuteSynchronously,
            TaskScheduler.Default);
        return ticket;
    }

    private ValueTask HandleReceivedChunkAsync(
        ReadOnlyMemory<byte> chunk,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        foreach (var record in decoder.Append(chunk.Span))
        {
            if (record.Kind == AethorArmDecodedRecordKind.Discarded)
            {
                Interlocked.Increment(ref invalidFrames);
                SafeObserveDiscard(record, null);
                RecordInvalidFrame(record.Reason ?? "discarded");
                continue;
            }

            var parsed = AethorArmAsciiProtocol.ParseFrame(record.Value);
            if (!parsed.IsValid || parsed.Frame is null)
            {
                Interlocked.Increment(ref invalidFrames);
                SafeObserveDiscard(new(
                    AethorArmDecodedRecordKind.Discarded,
                    string.Empty,
                    parsed.ContractCode), null);
                RecordInvalidFrame(parsed.ContractCode);
                continue;
            }

            Interlocked.Increment(ref validFrames);
            HandleFrame(parsed.Frame);
        }
        return ValueTask.CompletedTask;
    }

    private void HandleFrame(AethorArmAsciiFrame frame)
    {
        PendingRequest? pending = null;
        if (frame.Kind is AethorArmFrameKind.Response
            or AethorArmFrameKind.Error
            or AethorArmFrameKind.Acknowledgement
            or AethorArmFrameKind.Done)
        {
            pendingRequests.TryGetValue(frame.Sequence, out pending);
            if (pending is { IsArmed: false })
            {
                pending = null;
            }
        }

        var context = pending?.Context;
        SafeObserveFrame(frame, context);

        if (TryHandleBootChange(frame, pending))
        {
            return;
        }

        if (frame.Kind == AethorArmFrameKind.Telemetry)
        {
            _ = ProjectMotorFrame(frame, sourceOperation: "TEL", out _);
            return;
        }

        if (pending is null)
        {
            if (frame.Kind is AethorArmFrameKind.Response
                or AethorArmFrameKind.Error
                or AethorArmFrameKind.Acknowledgement
                or AethorArmFrameKind.Done)
            {
                RecordOrphan(frame);
            }
            return;
        }

        if (frame.Kind == AethorArmFrameKind.Error)
        {
            if (pendingRequests.TryRemove(new KeyValuePair<uint, PendingRequest>(frame.Sequence, pending)))
            {
                Interlocked.Increment(ref correlatedResponses);
                pending.Response.TrySetException(new AethorArmRemoteErrorException(frame.Sequence, frame.Subject));
            }
            return;
        }
        if (frame.Kind != AethorArmFrameKind.Response)
        {
            return;
        }

        if (pending.Operation == "HELLO")
        {
            if (!TryCreateIdentity(frame, out var establishedIdentity, out var identityError))
            {
                pending.Response.TrySetException(new GatewayProtocolException($"HELLO response invalid: {identityError}"));
                pendingRequests.TryRemove(new KeyValuePair<uint, PendingRequest>(frame.Sequence, pending));
                return;
            }
            ApplyIdentity(establishedIdentity!, pending.RequestId);
        }
        else if (pending.Operation == "GET_JPOS")
        {
            if (!ProjectMotorFrame(frame, pending.Operation, out var projectionError))
            {
                if (pendingRequests.TryRemove(new KeyValuePair<uint, PendingRequest>(frame.Sequence, pending)))
                {
                    Interlocked.Increment(ref correlatedResponses);
                    pending.Response.TrySetException(new GatewayProtocolException(
                        $"GET_JPOS response invalid: {projectionError ?? "projection_failed"}"));
                }
                return;
            }
        }

        if (pendingRequests.TryRemove(new KeyValuePair<uint, PendingRequest>(frame.Sequence, pending)))
        {
            Interlocked.Increment(ref correlatedResponses);
            pending.Response.TrySetResult(frame);
        }
    }

    private bool TryHandleBootChange(AethorArmAsciiFrame frame, PendingRequest? pending)
    {
        var current = GetIdentity();
        if (current is null || pending?.Operation == "HELLO")
        {
            return false;
        }

        var hasBootField = frame.Fields.TryGetValue("boot_id", out var observedBootId);
        var bootEvent = frame.Kind == AethorArmFrameKind.Event && frame.Subject == "BOOT";
        if ((!hasBootField && !bootEvent)
            || string.IsNullOrWhiteSpace(observedBootId)
            || observedBootId == current.BootId)
        {
            return false;
        }

        Interlocked.Increment(ref bootResets);
        Interlocked.Exchange(ref gatewayFrameSequence, 0);
        SetIdentity(null, notify: true);
        var exception = new AethorArmFirmwareRestartedException(
            $"Aethor firmware boot changed from {current.BootId} to {observedBootId}");
        CancelPendingRequests(exception);
        diagnostics.Record(new(
            "aethor.session.boot.changed",
            GatewayDiagnosticSeverity.Warning,
            hostSessionId,
            PortName,
            $"PreviousBoot={current.BootId} ObservedBoot={observedBootId}"));
        return true;
    }

    private bool ProjectMotorFrame(
        AethorArmAsciiFrame source,
        string sourceOperation,
        out string? error)
    {
        error = null;
        var currentIdentity = GetIdentity();
        if (currentIdentity is null)
        {
            error = "identity_not_established";
            RecordRejectedProjection(error);
            return false;
        }

        var sequence = unchecked((uint)Interlocked.Increment(ref gatewayFrameSequence));
        var projection = AethorArmMotorFrameProjector.ProjectJointSnapshot(
            source,
            sourceOperation,
            currentIdentity,
            jointGroupId,
            sequence,
            timeProvider.GetUtcNow());
        if (!projection.IsValid)
        {
            error = projection.Error ?? "projection_failed";
            RecordRejectedProjection(error);
            return false;
        }

        lock (motorDispatchGate)
        {
            if (pendingMotorFrame is not null)
            {
                Interlocked.Increment(ref coalescedMotorFrames);
            }
            pendingMotorFrame = projection.Frame!;
        }
        Interlocked.Increment(ref projectedMotorFrames);
        motorDispatchWake.Writer.TryWrite(0);
        return true;
    }

    private void ApplyIdentity(AethorArmSessionIdentity establishedIdentity, uint currentRequestId)
    {
        var previous = GetIdentity();
        var changed = previous is not null && previous != establishedIdentity;
        if (changed)
        {
            CancelPendingRequestsExcept(
                currentRequestId,
                new AethorArmFirmwareRestartedException("Aethor HELLO established a new device session identity"));
            if (previous!.BootId != establishedIdentity.BootId)
            {
                Interlocked.Increment(ref bootResets);
            }
        }
        else if (previous is not null)
        {
            CancelPendingRequestsExcept(
                currentRequestId,
                new AethorArmFirmwareRestartedException("Aethor HELLO renewed the device session"));
        }

        Interlocked.Exchange(ref gatewayFrameSequence, 0);
        SetIdentity(establishedIdentity, notify: true);
        diagnostics.Record(new(
            "aethor.session.identity.established",
            GatewayDiagnosticSeverity.Information,
            hostSessionId,
            PortName,
            $"Controller={establishedIdentity.ControllerId} Arm={establishedIdentity.ArmId} Boot={establishedIdentity.BootId}"));
    }

    private static bool TryCreateIdentity(
        AethorArmAsciiFrame response,
        out AethorArmSessionIdentity? result,
        out string error)
    {
        result = null;
        error = string.Empty;
        if (!HasExact(response.Fields, "product", "aethor-robo")
            || !HasExact(response.Fields, "protocol", AethorArmAsciiProtocol.ProtocolId)
            || !HasExact(response.Fields, "dof", AethorArmAsciiProtocol.JointCount.ToString(CultureInfo.InvariantCulture)))
        {
            error = "product_protocol_or_dof_mismatch";
            return false;
        }
        if (!TryIdentityToken(response.Fields, "controller", out var controller)
            || !TryIdentityToken(response.Fields, "arm", out var arm)
            || !TryIdentityToken(response.Fields, "fw", out var firmwareVersion))
        {
            error = "identity_field_invalid";
            return false;
        }
        if (!TryUnsignedIdentity(response.Fields, "boot_id", out var bootId)
            || !TryUnsignedIdentity(response.Fields, "session", out var deviceSession))
        {
            error = "session_or_boot_id_invalid";
            return false;
        }
        if (!TryModes(response.Fields, out var modes))
        {
            error = "modes_invalid";
            return false;
        }
        if (!response.Fields.TryGetValue("stream_max_hz", out var streamText)
            || !int.TryParse(streamText, NumberStyles.None, CultureInfo.InvariantCulture, out var streamMaximumHz)
            || streamMaximumHz is < 1 or > 100)
        {
            error = "stream_max_hz_invalid";
            return false;
        }

        result = new(controller, arm, bootId, deviceSession, firmwareVersion, modes, streamMaximumHz);
        return true;
    }

    private static bool HasExact(IReadOnlyDictionary<string, string> fields, string key, string expected) =>
        fields.TryGetValue(key, out var value) && value == expected;

    private static bool TryIdentityToken(
        IReadOnlyDictionary<string, string> fields,
        string key,
        out string value)
    {
        value = string.Empty;
        if (!fields.TryGetValue(key, out var candidate)
            || candidate.Length is < 1 or > 64
            || candidate.Any(character => character is not (
                >= 'A' and <= 'Z'
                or >= 'a' and <= 'z'
                or >= '0' and <= '9'
                or '.' or '_' or '-')))
        {
            return false;
        }
        value = candidate;
        return true;
    }

    private static bool TryUnsignedIdentity(
        IReadOnlyDictionary<string, string> fields,
        string key,
        out string value)
    {
        value = string.Empty;
        if (!fields.TryGetValue(key, out var candidate)
            || !uint.TryParse(candidate, NumberStyles.None, CultureInfo.InvariantCulture, out _))
        {
            return false;
        }
        value = candidate;
        return true;
    }

    private static bool TryModes(
        IReadOnlyDictionary<string, string> fields,
        out IReadOnlyList<string> modes)
    {
        modes = [];
        if (!fields.TryGetValue("modes", out var value))
        {
            return false;
        }
        var parsed = value.Split(',', StringSplitOptions.None);
        if (parsed.Length is < 1 or > 8
            || parsed.Distinct(StringComparer.Ordinal).Count() != parsed.Length
            || parsed.Any(mode => mode is not "POS_VEL" and not "MIT"))
        {
            return false;
        }
        modes = parsed;
        return true;
    }

    private void ArmPendingRequest(SerialWriteRequest request)
    {
        if (!writes.TryGetValue(request.WorkId, out var write)
            || write.RequestId is not uint requestId
            || !pendingRequests.TryGetValue(requestId, out var pending)
            || pending.WorkId != request.WorkId)
        {
            return;
        }
        pending.Arm();
    }

    private void ObservePhysicalWrite(SerialWriteRequest request)
    {
        if (!writes.TryGetValue(request.WorkId, out var write))
        {
            throw new InvalidOperationException("Aethor serial write metadata was not found");
        }
        physicalWriteObserver(write);
    }

    private async Task MonitorSchedulerAsync()
    {
        await scheduler.Completion.ConfigureAwait(false);
        var probe = scheduler.GetProbeSnapshot();
        if (probe.Faulted)
        {
            CancelPendingRequests(new IOException(probe.LastFault ?? "Aethor serial scheduler faulted"));
        }
    }

    private void ClaimRequestId(uint requestId)
    {
        lock (requestIdGate)
        {
            if (requestId <= lastClaimedRequestId)
            {
                diagnostics.Record(new(
                    "aethor.session.request.conflict",
                    GatewayDiagnosticSeverity.Warning,
                    hostSessionId,
                    PortName,
                    $"RequestId={requestId} LastClaimed={lastClaimedRequestId} Reason=non-monotonic"));
                throw new GatewayConflictException(
                    $"Aethor request ID {requestId} was already used or is not monotonic in this serial session");
            }
            lastClaimedRequestId = requestId;
        }
    }

    private void RegisterPendingRequest(PendingRequest pending)
    {
        lock (requestIdGate)
        {
            if (pendingRequests.Count >= MaximumPendingRequests)
            {
                diagnostics.Record(new(
                    "aethor.session.request.capacity_rejected",
                    GatewayDiagnosticSeverity.Warning,
                    hostSessionId,
                    PortName,
                    $"RequestId={pending.RequestId} Capacity={MaximumPendingRequests}"));
                throw new GatewayConflictException("Aethor pending request registry is full");
            }
            if (pending.RequestId <= lastClaimedRequestId)
            {
                diagnostics.Record(new(
                    "aethor.session.request.conflict",
                    GatewayDiagnosticSeverity.Warning,
                    hostSessionId,
                    PortName,
                    $"RequestId={pending.RequestId} LastClaimed={lastClaimedRequestId} Reason=non-monotonic"));
                throw new GatewayConflictException(
                    $"Aethor request ID {pending.RequestId} was already used or is not monotonic in this serial session");
            }
            if (!pendingRequests.TryAdd(pending.RequestId, pending))
            {
                throw new GatewayConflictException($"Aethor request ID {pending.RequestId} is already active");
            }
            lastClaimedRequestId = pending.RequestId;
        }
    }

    private void CancelPendingRequests(Exception exception)
    {
        foreach (var entry in pendingRequests)
        {
            if (pendingRequests.TryRemove(entry))
            {
                entry.Value.Response.TrySetException(exception);
            }
        }
    }

    private void CancelPendingRequestsExcept(uint excludedRequestId, Exception exception)
    {
        foreach (var entry in pendingRequests)
        {
            if (entry.Key != excludedRequestId && pendingRequests.TryRemove(entry))
            {
                entry.Value.Response.TrySetException(exception);
            }
        }
    }

    private void SetIdentity(AethorArmSessionIdentity? value, bool notify)
    {
        lock (identityGate)
        {
            identity = value;
        }
        if (!notify)
        {
            return;
        }
        try
        {
            identityObserver(value);
        }
        catch (Exception exception)
        {
            diagnostics.Record(new(
                "aethor.session.identity_observer.failed",
                GatewayDiagnosticSeverity.Error,
                hostSessionId,
                PortName,
                "Identity observer failed",
                exception));
        }
    }

    private void SafeObserveFrame(AethorArmAsciiFrame frame, AethorArmResponseContext? context)
    {
        try
        {
            frameObserver(frame, context);
        }
        catch (Exception exception)
        {
            diagnostics.Record(new(
                "aethor.session.frame_observer.failed",
                GatewayDiagnosticSeverity.Error,
                hostSessionId,
                PortName,
                $"Kind={frame.Kind} Sequence={frame.Sequence}",
                exception));
        }
    }

    private void SafeObserveDiscard(AethorArmDecodedRecord record, string? correlationId)
    {
        try
        {
            discardedObserver(record, correlationId);
        }
        catch (Exception exception)
        {
            diagnostics.Record(new(
                "aethor.session.discard_observer.failed",
                GatewayDiagnosticSeverity.Error,
                hostSessionId,
                PortName,
                $"Reason={record.Reason ?? "unknown"}",
                exception));
        }
    }

    private void RecordInvalidFrame(string reason)
    {
        var count = Interlocked.Read(ref invalidFrames);
        if (count == 1 || count % 100 == 0)
        {
            diagnostics.Record(new(
                "aethor.session.frame.invalid",
                GatewayDiagnosticSeverity.Warning,
                hostSessionId,
                PortName,
                $"Reason={reason} Count={count}"));
        }
    }

    private void RecordOrphan(AethorArmAsciiFrame frame)
    {
        var count = Interlocked.Increment(ref orphanResponses);
        if (count == 1 || count % 100 == 0)
        {
            diagnostics.Record(new(
                "aethor.session.response.orphan",
                GatewayDiagnosticSeverity.Warning,
                hostSessionId,
                PortName,
                $"Kind={frame.Kind} Sequence={frame.Sequence} Count={count}"));
        }
    }

    private void RecordRejectedProjection(string reason)
    {
        var count = Interlocked.Increment(ref rejectedMotorFrames);
        if (count == 1 || count % 100 == 0)
        {
            diagnostics.Record(new(
                "aethor.session.motor_frame.rejected",
                GatewayDiagnosticSeverity.Warning,
                hostSessionId,
                PortName,
                $"Reason={reason} Count={count}"));
        }
    }

    private AethorArmSerialWrite CreateWrite(
        string workId,
        uint? requestId,
        string operation,
        string line,
        SerialWorkPriority priority,
        string correlationId)
    {
        if (string.IsNullOrWhiteSpace(workId)
            || string.IsNullOrWhiteSpace(correlationId)
            || string.IsNullOrWhiteSpace(line)
            || line.Length > AethorArmAsciiProtocol.MaximumLineBytes)
        {
            throw new GatewayValidationException("Aethor serial write metadata is invalid");
        }
        return new(workId, requestId, operation, line, hostSessionId, correlationId, priority);
    }

    private static void ThrowForWriteOutcome(
        SerialWriteCompletion completion,
        string operation,
        CancellationToken cancellationToken)
    {
        switch (completion.Outcome)
        {
            case SerialWriteOutcome.Written:
                return;
            case SerialWriteOutcome.Expired:
                throw new GatewayQueryTimeoutException(operation);
            case SerialWriteOutcome.Superseded:
                throw new OperationCanceledException(completion.Detail, cancellationToken);
            case SerialWriteOutcome.Cancelled:
                throw new OperationCanceledException(completion.Detail, cancellationToken);
            case SerialWriteOutcome.Failed:
                throw new IOException(completion.Detail ?? "Aethor serial write failed");
            default:
                throw new ArgumentOutOfRangeException(nameof(completion), completion.Outcome, "Unknown serial write outcome");
        }
    }

    private void ThrowIfDisposed() => ObjectDisposedException.ThrowIf(
        Volatile.Read(ref disposed) != 0,
        this);

    private sealed class PendingRequest(AethorArmSerialWrite write)
    {
        private int armed;

        public string WorkId { get; } = write.WorkId;
        public uint RequestId { get; } = write.RequestId!.Value;
        public string Operation { get; } = write.Operation;
        public AethorArmResponseContext Context { get; } = new(
            write.WorkId,
            write.RequestId!.Value,
            write.Operation,
            write.HostSessionId,
            write.CorrelationId,
            write.Priority);
        public TaskCompletionSource<AethorArmAsciiFrame> Response { get; } =
            new(TaskCreationOptions.RunContinuationsAsynchronously);
        public bool IsArmed => Volatile.Read(ref armed) != 0;

        public void Arm() => Volatile.Write(ref armed, 1);
    }
}
