using System.Collections.Concurrent;
using System.Text;
using AethorStudioV2.Domain;

namespace AethorStudioV2.Application;

public sealed record DummySerialWrite(
    string WorkId,
    string Line,
    string ParsedKind,
    string SessionId,
    string CorrelationId,
    string? CommandId,
    string? DirectRequestId,
    SerialWorkPriority Priority);

public sealed class DummyResponseFencePreemptedException(string workId)
    : OperationCanceledException($"Dummy response fence {workId} was preempted by safety work");

public sealed record DummyResponseContext(
    string WorkId,
    string CorrelationId,
    string? CommandId,
    SerialWorkPriority Priority);

/// <summary>
/// Owns the Dummy protocol boundary for one already-open transport. It is the
/// only line decoder and response dispatcher; physical I/O remains owned by
/// <see cref="SerialDuplexScheduler"/>.
/// </summary>
public sealed class DummySerialSession : IAsyncDisposable
{
    private readonly SerialDuplexScheduler scheduler;
    private readonly DummyAsciiLineDecoder decoder = new();
    private readonly Func<DummyResponse, DummyResponseContext?, bool> responseObserver;
    private readonly Action<DummyDecodedRecord, string?> discardedObserver;
    private readonly Action<DummySerialWrite> physicalWriteObserver;
    private readonly ConcurrentDictionary<string, DummySerialWrite> writes = new(StringComparer.Ordinal);
    private readonly object responseGate = new();
    private readonly Task monitorTask;
    private ResponseLease? activeResponse;
    private int disposed;

    public DummySerialSession(
        IAsciiTransport transport,
        Func<DummyResponse, DummyResponseContext?, bool> responseObserver,
        Action<DummyDecodedRecord, string?> discardedObserver,
        Action<DummySerialWrite> physicalWriteObserver,
        IGatewayDiagnostics? diagnostics = null,
        TimeProvider? timeProvider = null,
        SerialDuplexSchedulerOptions? schedulerOptions = null)
    {
        ArgumentNullException.ThrowIfNull(transport);
        this.responseObserver = responseObserver ?? throw new ArgumentNullException(nameof(responseObserver));
        this.discardedObserver = discardedObserver ?? throw new ArgumentNullException(nameof(discardedObserver));
        this.physicalWriteObserver = physicalWriteObserver ?? throw new ArgumentNullException(nameof(physicalWriteObserver));
        scheduler = new(
            transport,
            HandleReceivedChunkAsync,
            diagnostics,
            timeProvider,
            schedulerOptions,
            writeObserver: ObservePhysicalWrite,
            writeStartedObserver: ArmResponseLease);
        monitorTask = MonitorSchedulerAsync();
    }

    public string PortName => scheduler.PortName;
    public bool IsRunning => scheduler.GetProbeSnapshot().Running;
    public Task Completion => monitorTask;

    public SerialDuplexProbeSnapshot GetProbeSnapshot() => scheduler.GetProbeSnapshot();

    public SerialWriteTicket QueueUnobserved(
        string workId,
        string line,
        string parsedKind,
        string sessionId,
        SerialWorkPriority priority,
        TimeSpan maximumQueueDelay,
        string? correlationId = null,
        string? commandId = null,
        string? directRequestId = null)
    {
        ThrowIfDisposed();
        var write = CreateWrite(
            workId,
            line,
            parsedKind,
            sessionId,
            priority,
            correlationId,
            commandId,
            directRequestId);
        return QueueWrite(
            write,
            maximumQueueDelay,
            responseFence: null,
            retryOnTransientWriteTimeout: false);
    }

    public async Task<DummyResponse> TransactAsync(
        string workId,
        string line,
        string parsedKind,
        string sessionId,
        Func<DummyResponse, bool> isExpected,
        SerialWorkPriority priority,
        TimeSpan maximumQueueDelay,
        TimeSpan responseTimeout,
        CancellationToken cancellationToken,
        string? correlationId = null,
        string? commandId = null,
        bool retryOnTransientWriteTimeout = false)
    {
        ArgumentNullException.ThrowIfNull(isExpected);
        ThrowIfDisposed();
        cancellationToken.ThrowIfCancellationRequested();

        var responseFence = new SerialResponseFence();
        var lease = await AcquireResponseLeaseAsync(
            workId,
            correlationId ?? Guid.NewGuid().ToString("N"),
            priority,
            isExpected,
            responseFence,
            commandId,
            cancellationToken).ConfigureAwait(false);
        try
        {
            var write = CreateWrite(
                workId,
                line,
                parsedKind,
                sessionId,
                priority,
                lease.CorrelationId,
                commandId,
                directRequestId: null);
            var ticket = QueueWrite(
                write,
                maximumQueueDelay,
                responseFence,
                retryOnTransientWriteTimeout);
            lease.ReleasePreemptedWriterFence();
            if (!ticket.Accepted)
            {
                throw new GatewayConflictException(ticket.RejectionReason ?? "Serial write queue rejected the transaction");
            }

            var writeCompletion = await ticket.Completion!
                .WaitAsync(cancellationToken)
                .ConfigureAwait(false);
            ThrowForWriteOutcome(writeCompletion, line, cancellationToken);

            using var responseCancellation = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            responseCancellation.CancelAfter(responseTimeout);
            try
            {
                return await lease.Response.Task
                    .WaitAsync(responseCancellation.Token)
                    .ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (
                !cancellationToken.IsCancellationRequested
                && responseCancellation.IsCancellationRequested)
            {
                throw new GatewayQueryTimeoutException(line);
            }
        }
        finally
        {
            lease.ReleasePreemptedWriterFence();
            responseFence.Release();
            ReleaseResponseLease(lease);
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (Interlocked.Exchange(ref disposed, 1) != 0)
        {
            return;
        }

        CancelActiveResponse(new OperationCanceledException("Dummy serial session is closing"));
        await scheduler.DisposeAsync().ConfigureAwait(false);
        await monitorTask.ConfigureAwait(false);
        var incomplete = decoder.Finish();
        if (incomplete is not null)
        {
            discardedObserver(incomplete, null);
        }
        writes.Clear();
    }

    private SerialWriteTicket QueueWrite(
        DummySerialWrite write,
        TimeSpan maximumQueueDelay,
        SerialResponseFence? responseFence,
        bool retryOnTransientWriteTimeout)
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
                Encoding.ASCII.GetBytes(write.Line + DummyAsciiProtocol.LineEnding),
                write.Priority,
                maximumQueueDelay,
                write.CorrelationId,
                responseFence,
                retryOnTransientWriteTimeout));
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

    private async ValueTask HandleReceivedChunkAsync(
        ReadOnlyMemory<byte> chunk,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        foreach (var record in decoder.Append(chunk.Span))
        {
            ResponseLease? lease;
            lock (responseGate)
            {
                lease = activeResponse is { IsArmed: true } candidate ? candidate : null;
            }

            if (record.Kind == DummyDecodedRecordKind.Discarded)
            {
                discardedObserver(record, lease?.CorrelationId);
                continue;
            }

            var response = DummyAsciiProtocol.ParseResponseLine(record.Value);
            var observedAsUnowned = responseObserver(response, lease?.Context);
            if (lease is null || observedAsUnowned)
            {
                continue;
            }

            if (response.Kind == DummyResponseKind.Error)
            {
                lease.Response.TrySetException(new GatewayProtocolException(
                    $"Device returned error: {response.ErrorCode}"));
            }
            else if (lease.IsExpected(response))
            {
                lease.Response.TrySetResult(response);
            }
        }

        await ValueTask.CompletedTask;
    }

    private void ObservePhysicalWrite(SerialWriteRequest request)
    {
        if (!writes.TryGetValue(request.WorkId, out var write))
        {
            throw new InvalidOperationException("Dummy serial write metadata was not found");
        }

        physicalWriteObserver(write);
    }

    private void ArmResponseLease(SerialWriteRequest request)
    {
        lock (responseGate)
        {
            if (activeResponse?.WorkId == request.WorkId)
            {
                activeResponse.Arm();
            }
        }
    }

    private async Task<ResponseLease> AcquireResponseLeaseAsync(
        string workId,
        string correlationId,
        SerialWorkPriority priority,
        Func<DummyResponse, bool> isExpected,
        SerialResponseFence writerFence,
        string? commandId,
        CancellationToken cancellationToken)
    {
        while (true)
        {
            Task waitForRelease;
            lock (responseGate)
            {
                if (activeResponse is null)
                {
                    var lease = new ResponseLease(
                        workId,
                        correlationId,
                        priority,
                        isExpected,
                        writerFence,
                        commandId);
                    activeResponse = lease;
                    return lease;
                }

                if (priority == SerialWorkPriority.Safety
                    && activeResponse.Priority != SerialWorkPriority.Safety)
                {
                    var preempted = activeResponse;
                    var lease = new ResponseLease(
                        workId,
                        correlationId,
                        priority,
                        isExpected,
                        writerFence,
                        commandId,
                        preempted.WriterFence);
                    activeResponse = lease;
                    preempted.Response.TrySetException(new DummyResponseFencePreemptedException(preempted.WorkId));
                    preempted.Released.TrySetResult();
                    return lease;
                }

                waitForRelease = activeResponse.Released.Task;
            }

            await waitForRelease.WaitAsync(cancellationToken).ConfigureAwait(false);
        }
    }

    private void ReleaseResponseLease(ResponseLease lease)
    {
        lock (responseGate)
        {
            if (ReferenceEquals(activeResponse, lease))
            {
                activeResponse = null;
            }
        }

        lease.Released.TrySetResult();
    }

    private void CancelActiveResponse(Exception exception)
    {
        ResponseLease? active;
        lock (responseGate)
        {
            active = activeResponse;
            activeResponse = null;
        }

        if (active is null)
        {
            return;
        }

        active.Response.TrySetException(exception);
        active.WriterFence.Release();
        active.ReleasePreemptedWriterFence();
        active.Released.TrySetResult();
    }

    private async Task MonitorSchedulerAsync()
    {
        await scheduler.Completion.ConfigureAwait(false);
        var probe = scheduler.GetProbeSnapshot();
        if (probe.Faulted)
        {
            CancelActiveResponse(new IOException(probe.LastFault ?? "Serial duplex scheduler faulted"));
        }
    }

    private static DummySerialWrite CreateWrite(
        string workId,
        string line,
        string parsedKind,
        string sessionId,
        SerialWorkPriority priority,
        string? correlationId,
        string? commandId,
        string? directRequestId)
    {
        if (string.IsNullOrWhiteSpace(line)
            || line.Length > DummyAsciiProtocol.MaximumLineCharacters
            || line.Any(character => !char.IsAscii(character) || char.IsControl(character)))
        {
            throw new GatewayValidationException("Dummy serial line must be printable ASCII within the protocol limit");
        }

        return new(
            workId,
            line,
            parsedKind,
            sessionId,
            correlationId ?? Guid.NewGuid().ToString("N"),
            commandId,
            directRequestId,
            priority);
    }

    private static void ThrowForWriteOutcome(
        SerialWriteCompletion completion,
        string line,
        CancellationToken cancellationToken)
    {
        switch (completion.Outcome)
        {
            case SerialWriteOutcome.Written:
                return;
            case SerialWriteOutcome.Expired:
                throw new GatewayQueryTimeoutException(line);
            case SerialWriteOutcome.Superseded:
                throw new DummyResponseFencePreemptedException(completion.WorkId);
            case SerialWriteOutcome.Cancelled:
                throw new OperationCanceledException(completion.Detail, cancellationToken);
            case SerialWriteOutcome.Failed:
                throw new IOException(completion.Detail ?? "Serial write failed");
            default:
                throw new ArgumentOutOfRangeException(nameof(completion), completion.Outcome, "Unknown serial write outcome");
        }
    }

    private void ThrowIfDisposed() => ObjectDisposedException.ThrowIf(
        Volatile.Read(ref disposed) != 0,
        this);

    private sealed class ResponseLease(
        string workId,
        string correlationId,
        SerialWorkPriority priority,
        Func<DummyResponse, bool> isExpected,
        SerialResponseFence writerFence,
        string? commandId,
        SerialResponseFence? preemptedWriterFence = null)
    {
        private int preemptedFenceReleased;
        private int armed;

        public string WorkId { get; } = workId;
        public string CorrelationId { get; } = correlationId;
        public SerialWorkPriority Priority { get; } = priority;
        public Func<DummyResponse, bool> IsExpected { get; } = isExpected;
        public SerialResponseFence WriterFence { get; } = writerFence;
        public DummyResponseContext Context { get; } = new(workId, correlationId, commandId, priority);
        public SerialResponseFence? PreemptedWriterFence { get; } = preemptedWriterFence;
        public TaskCompletionSource<DummyResponse> Response { get; } =
            new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource Released { get; } =
            new(TaskCreationOptions.RunContinuationsAsynchronously);
        public bool IsArmed => Volatile.Read(ref armed) != 0;

        public void Arm() => Volatile.Write(ref armed, 1);

        public void ReleasePreemptedWriterFence()
        {
            if (Interlocked.Exchange(ref preemptedFenceReleased, 1) == 0)
            {
                PreemptedWriterFence?.Release();
            }
        }
    }
}
