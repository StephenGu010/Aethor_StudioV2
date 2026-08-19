namespace AethorStudioV2.Application;

public enum SerialWorkPriority
{
    Safety = 0,
    Interactive = 1,
    Telemetry = 2,
    Background = 3
}

public enum SerialWriteOutcome
{
    Written,
    Expired,
    Superseded,
    Cancelled,
    Failed
}

public sealed record SerialWriteRequest(
    string WorkId,
    ReadOnlyMemory<byte> Payload,
    SerialWorkPriority Priority,
    TimeSpan MaximumQueueDelay,
    string? CorrelationId = null,
    SerialResponseFence? ResponseFence = null,
    bool RetryOnTransientTimeout = false);

/// <summary>
/// Holds non-safety writes after a transaction payload reaches the transport.
/// The protocol adapter releases the fence after its matching response reaches
/// a terminal state. Safety writes remain dispatchable while the fence is held.
/// </summary>
public sealed class SerialResponseFence
{
    private readonly TaskCompletionSource released =
        new(TaskCreationOptions.RunContinuationsAsynchronously);

    internal Task Released => released.Task;

    public bool IsReleased => released.Task.IsCompleted;

    public void Release() => released.TrySetResult();
}

public sealed record SerialWriteCompletion(
    string WorkId,
    SerialWriteOutcome Outcome,
    DateTimeOffset CompletedAtUtc,
    string? Detail = null);

public sealed record SerialWriteTicket(
    bool Accepted,
    string WorkId,
    Task<SerialWriteCompletion>? Completion,
    string? RejectionReason = null);

public sealed record SerialDuplexProbeSnapshot(
    bool Running,
    bool Faulted,
    int QueueDepth,
    int SafetyDepth,
    int InteractiveDepth,
    int TelemetryDepth,
    int BackgroundDepth,
    long AcceptedWrites,
    long RejectedWrites,
    long CompletedWrites,
    long RetriedWrites,
    long ExpiredWrites,
    long SupersededWrites,
    long FailedWrites,
    long ReceivedChunks,
    long ReceivedBytes,
    string? LastFault);

public sealed record SerialDuplexSchedulerOptions
{
    public int WriteQueueCapacity { get; init; } = 64;
    public int ReservedSafetySlots { get; init; } = 4;
    public int ReceiveQueueCapacity { get; init; } = 64;
    public int ReadBufferBytes { get; init; } = 512;
    public int MaximumWriteBytes { get; init; } = 2048;

    public void Validate()
    {
        if (WriteQueueCapacity is < 8 or > 4096)
        {
            throw new ArgumentOutOfRangeException(nameof(WriteQueueCapacity));
        }

        if (ReservedSafetySlots is < 1 or > 64 || ReservedSafetySlots >= WriteQueueCapacity)
        {
            throw new ArgumentOutOfRangeException(nameof(ReservedSafetySlots));
        }

        if (ReceiveQueueCapacity is < 4 or > 4096)
        {
            throw new ArgumentOutOfRangeException(nameof(ReceiveQueueCapacity));
        }

        if (ReadBufferBytes is < 64 or > 16_384)
        {
            throw new ArgumentOutOfRangeException(nameof(ReadBufferBytes));
        }

        if (MaximumWriteBytes is < 16 or > 65_536)
        {
            throw new ArgumentOutOfRangeException(nameof(MaximumWriteBytes));
        }
    }
}

/// <summary>
/// Owns one continuous transport reader and one prioritized writer for an open
/// serial session. Queue acceptance is deliberately separate from physical
/// write completion so an operator terminal never waits for a device reply.
/// Protocol codecs and response correlation remain adapter responsibilities.
/// </summary>
public sealed class SerialDuplexScheduler : IAsyncDisposable
{
    private static readonly SerialWorkPriority[] FairSchedule =
    [
        SerialWorkPriority.Interactive,
        SerialWorkPriority.Interactive,
        SerialWorkPriority.Interactive,
        SerialWorkPriority.Telemetry,
        SerialWorkPriority.Interactive,
        SerialWorkPriority.Telemetry,
        SerialWorkPriority.Interactive,
        SerialWorkPriority.Background
    ];

    private readonly IAsciiTransport transport;
    private readonly Func<ReadOnlyMemory<byte>, CancellationToken, ValueTask> receiveHandler;
    private readonly IGatewayDiagnostics diagnostics;
    private readonly TimeProvider timeProvider;
    private readonly SerialDuplexSchedulerOptions options;
    private readonly object queueGate = new();
    private readonly LinkedList<PendingWrite>[] queues =
    [
        new(),
        new(),
        new(),
        new()
    ];
    private readonly HashSet<string> pendingWorkIds = new(StringComparer.Ordinal);
    private readonly System.Threading.Channels.Channel<byte> writerWake;
    private readonly SemaphoreSlim closeGate = new(1, 1);
    private readonly System.Threading.Channels.Channel<byte[]> receiveQueue;
    private readonly CancellationTokenSource lifetimeCancellation = new();
    private readonly Task readerTask;
    private readonly Task writerTask;
    private readonly Task dispatcherTask;
    private readonly Action<SerialWriteRequest>? writeObserver;
    private readonly Action<SerialWriteRequest>? writeStartedObserver;

    private int queueDepth;
    private int fairScheduleIndex;
    private int stopping;
    private int transportClosed;
    private long acceptedWrites;
    private long rejectedWrites;
    private long completedWrites;
    private long retriedWrites;
    private long expiredWrites;
    private long supersededWrites;
    private long failedWrites;
    private long receivedChunks;
    private long receivedBytes;
    private Exception? lastFault;
    private bool disposed;

    public SerialDuplexScheduler(
        IAsciiTransport transport,
        Func<ReadOnlyMemory<byte>, CancellationToken, ValueTask> receiveHandler,
        IGatewayDiagnostics? diagnostics = null,
        TimeProvider? timeProvider = null,
        SerialDuplexSchedulerOptions? options = null,
        Action<SerialWriteRequest>? writeObserver = null,
        Action<SerialWriteRequest>? writeStartedObserver = null)
    {
        this.transport = transport ?? throw new ArgumentNullException(nameof(transport));
        this.receiveHandler = receiveHandler ?? throw new ArgumentNullException(nameof(receiveHandler));
        this.diagnostics = diagnostics ?? new NullGatewayDiagnostics();
        this.timeProvider = timeProvider ?? TimeProvider.System;
        this.options = options ?? new SerialDuplexSchedulerOptions();
        this.writeObserver = writeObserver;
        this.writeStartedObserver = writeStartedObserver;
        this.options.Validate();

        if (!transport.IsOpen)
        {
            throw new InvalidOperationException("Serial transport must be open before the duplex scheduler starts");
        }

        receiveQueue = System.Threading.Channels.Channel.CreateBounded<byte[]>(
            new System.Threading.Channels.BoundedChannelOptions(this.options.ReceiveQueueCapacity)
            {
                SingleReader = true,
                SingleWriter = true,
                FullMode = System.Threading.Channels.BoundedChannelFullMode.Wait
            });
        writerWake = System.Threading.Channels.Channel.CreateBounded<byte>(
            new System.Threading.Channels.BoundedChannelOptions(1)
            {
                SingleReader = true,
                SingleWriter = false,
                FullMode = System.Threading.Channels.BoundedChannelFullMode.DropWrite
            });
        readerTask = RunReaderAsync(lifetimeCancellation.Token);
        writerTask = RunWriterAsync(lifetimeCancellation.Token);
        dispatcherTask = RunDispatcherAsync(lifetimeCancellation.Token);
    }

    public Task Completion => Task.WhenAll(readerTask, writerTask, dispatcherTask);

    public string PortName => transport.PortName;

    public SerialWriteTicket QueueWrite(SerialWriteRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        ValidateRequest(request);

        PendingWrite? superseded = null;
        PendingWrite? accepted = null;
        lock (queueGate)
        {
            if (Volatile.Read(ref stopping) != 0)
            {
                Interlocked.Increment(ref rejectedWrites);
                return Rejected(request.WorkId, "Serial scheduler is stopping");
            }

            if (!pendingWorkIds.Add(request.WorkId))
            {
                Interlocked.Increment(ref rejectedWrites);
                return Rejected(request.WorkId, "workId is already queued or being written");
            }

            var nonSafetyLimit = options.WriteQueueCapacity - options.ReservedSafetySlots;
            if (request.Priority != SerialWorkPriority.Safety && queueDepth >= nonSafetyLimit)
            {
                pendingWorkIds.Remove(request.WorkId);
                Interlocked.Increment(ref rejectedWrites);
                diagnostics.Record(new(
                    "serial.scheduler.queue.rejected",
                    GatewayDiagnosticSeverity.Warning,
                    null,
                    transport.PortName,
                    $"WorkId={request.WorkId} Priority={request.Priority} Depth={queueDepth} Reason=safety-reserve"));
                return Rejected(request.WorkId, "Serial write queue reserved capacity for safety work");
            }

            if (queueDepth >= options.WriteQueueCapacity)
            {
                superseded = request.Priority == SerialWorkPriority.Safety
                    ? RemoveOldestLowerPriorityLocked()
                    : null;
                if (superseded is null)
                {
                    pendingWorkIds.Remove(request.WorkId);
                    Interlocked.Increment(ref rejectedWrites);
                    diagnostics.Record(new(
                        "serial.scheduler.queue.rejected",
                        GatewayDiagnosticSeverity.Warning,
                        null,
                        transport.PortName,
                        $"WorkId={request.WorkId} Priority={request.Priority} Depth={queueDepth} Reason=full"));
                    return Rejected(request.WorkId, "Serial write queue is full");
                }
            }
            else
            {
                queueDepth++;
            }

            accepted = new PendingWrite(
                request with { Payload = request.Payload.ToArray() },
                timeProvider.GetTimestamp());
            queues[(int)request.Priority].AddLast(accepted);
            Interlocked.Increment(ref acceptedWrites);
        }

        if (superseded is not null)
        {
            Interlocked.Increment(ref supersededWrites);
            superseded.Completion.TrySetResult(new(
                superseded.Request.WorkId,
                SerialWriteOutcome.Superseded,
                timeProvider.GetUtcNow(),
                $"Superseded by safety work {request.WorkId}"));
            diagnostics.Record(new(
                "serial.scheduler.queue.superseded",
                GatewayDiagnosticSeverity.Warning,
                null,
                transport.PortName,
                $"WorkId={superseded.Request.WorkId} Priority={superseded.Request.Priority} ReplacedBy={request.WorkId}"));
        }

        SignalWriter();

        return new(true, request.WorkId, accepted!.Completion.Task);
    }

    public bool CancelQueuedWrite(string workId, string detail)
    {
        if (string.IsNullOrWhiteSpace(workId)) return false;
        PendingWrite? cancelled = null;
        lock (queueGate)
        {
            foreach (var queue in queues)
            {
                var node = queue.First;
                while (node is not null)
                {
                    var next = node.Next;
                    if (string.Equals(node.Value.Request.WorkId, workId, StringComparison.Ordinal))
                    {
                        cancelled = node.Value;
                        queue.Remove(node);
                        pendingWorkIds.Remove(workId);
                        queueDepth--;
                        break;
                    }
                    node = next;
                }
                if (cancelled is not null) break;
            }
        }

        if (cancelled is null) return false;
        cancelled.Completion.TrySetResult(new(
            cancelled.Request.WorkId,
            SerialWriteOutcome.Cancelled,
            timeProvider.GetUtcNow(),
            detail));
        SignalWriter();
        return true;
    }

    public SerialDuplexProbeSnapshot GetProbeSnapshot()
    {
        int[] depths;
        int currentDepth;
        lock (queueGate)
        {
            depths = queues.Select(queue => queue.Count).ToArray();
            currentDepth = queueDepth;
        }

        var fault = Volatile.Read(ref lastFault);
        return new(
            Running: Volatile.Read(ref stopping) == 0,
            Faulted: fault is not null,
            QueueDepth: currentDepth,
            SafetyDepth: depths[(int)SerialWorkPriority.Safety],
            InteractiveDepth: depths[(int)SerialWorkPriority.Interactive],
            TelemetryDepth: depths[(int)SerialWorkPriority.Telemetry],
            BackgroundDepth: depths[(int)SerialWorkPriority.Background],
            AcceptedWrites: Interlocked.Read(ref acceptedWrites),
            RejectedWrites: Interlocked.Read(ref rejectedWrites),
            CompletedWrites: Interlocked.Read(ref completedWrites),
            RetriedWrites: Interlocked.Read(ref retriedWrites),
            ExpiredWrites: Interlocked.Read(ref expiredWrites),
            SupersededWrites: Interlocked.Read(ref supersededWrites),
            FailedWrites: Interlocked.Read(ref failedWrites),
            ReceivedChunks: Interlocked.Read(ref receivedChunks),
            ReceivedBytes: Interlocked.Read(ref receivedBytes),
            LastFault: fault?.Message);
    }

    public async ValueTask DisposeAsync()
    {
        if (disposed)
        {
            return;
        }

        disposed = true;
        Interlocked.Exchange(ref stopping, 1);
        lifetimeCancellation.Cancel();
        await CloseTransportOnceAsync().ConfigureAwait(false);
        try
        {
            await Completion.ConfigureAwait(false);
        }
        finally
        {
            CancelQueuedWrites();
            await transport.DisposeAsync().ConfigureAwait(false);
            lifetimeCancellation.Dispose();
            closeGate.Dispose();
        }
    }

    private async Task RunReaderAsync(CancellationToken cancellationToken)
    {
        var buffer = new byte[options.ReadBufferBytes];
        try
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                var count = await transport.ReadAsync(buffer, cancellationToken).ConfigureAwait(false);
                if (count == 0)
                {
                    throw new EndOfStreamException("Serial transport closed while the duplex reader was active");
                }

                var chunk = buffer.AsSpan(0, count).ToArray();
                Interlocked.Increment(ref receivedChunks);
                Interlocked.Add(ref receivedBytes, count);
                await receiveQueue.Writer.WriteAsync(chunk, cancellationToken).ConfigureAwait(false);
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
        }
        catch (Exception exception)
        {
            await RecordFaultAndStopAsync("serial.scheduler.read.failed", exception).ConfigureAwait(false);
        }
        finally
        {
            receiveQueue.Writer.TryComplete();
        }
    }

    private async Task RunDispatcherAsync(CancellationToken cancellationToken)
    {
        try
        {
            await foreach (var chunk in receiveQueue.Reader.ReadAllAsync(cancellationToken).ConfigureAwait(false))
            {
                await receiveHandler(chunk, cancellationToken).ConfigureAwait(false);
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
        }
        catch (Exception exception)
        {
            await RecordFaultAndStopAsync("serial.scheduler.receive_handler.failed", exception).ConfigureAwait(false);
        }
    }

    private async Task RunWriterAsync(CancellationToken cancellationToken)
    {
        SerialResponseFence? activeFence = null;
        try
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                if (activeFence?.IsReleased == true)
                {
                    activeFence = null;
                }

                var pending = TakeNextWrite(safetyOnly: activeFence is not null);
                if (pending is null)
                {
                    await WaitForEligibleWriteAsync(activeFence, cancellationToken).ConfigureAwait(false);
                    continue;
                }

                if (timeProvider.GetElapsedTime(pending.EnqueuedTimestamp) > pending.Request.MaximumQueueDelay)
                {
                    Interlocked.Increment(ref expiredWrites);
                    CompleteWrite(pending, new(
                        pending.Request.WorkId,
                        SerialWriteOutcome.Expired,
                        timeProvider.GetUtcNow(),
                        "Serial work expired before reaching the transport"));
                    diagnostics.Record(new(
                        "serial.scheduler.write.expired",
                        GatewayDiagnosticSeverity.Warning,
                        null,
                        transport.PortName,
                        $"WorkId={pending.Request.WorkId} Priority={pending.Request.Priority}"));
                    continue;
                }

                try
                {
                    writeStartedObserver?.Invoke(pending.Request);
                    await WriteWithBoundedRetryAsync(pending.Request, cancellationToken).ConfigureAwait(false);
                    if (writeObserver is not null)
                    {
                        try
                        {
                            writeObserver(pending.Request);
                        }
                        catch (Exception exception)
                        {
                            Interlocked.Increment(ref failedWrites);
                            CompleteWrite(pending, new(
                                pending.Request.WorkId,
                                SerialWriteOutcome.Failed,
                                timeProvider.GetUtcNow(),
                                exception.Message));
                            await RecordFaultAndStopAsync("serial.scheduler.write_observer.failed", exception).ConfigureAwait(false);
                            break;
                        }
                    }

                    Interlocked.Increment(ref completedWrites);
                    CompleteWrite(pending, new(
                        pending.Request.WorkId,
                        SerialWriteOutcome.Written,
                        timeProvider.GetUtcNow()));

                    if (pending.Request.ResponseFence is { IsReleased: false } responseFence)
                    {
                        activeFence = responseFence;
                    }
                }
                catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
                {
                    CompleteWrite(pending, new(
                        pending.Request.WorkId,
                        SerialWriteOutcome.Cancelled,
                        timeProvider.GetUtcNow(),
                        "Serial scheduler stopped before write completion"));
                    throw;
                }
                catch (Exception) when (cancellationToken.IsCancellationRequested)
                {
                    CompleteWrite(pending, new(
                        pending.Request.WorkId,
                        SerialWriteOutcome.Cancelled,
                        timeProvider.GetUtcNow(),
                        "Serial scheduler stopped before write completion"));
                    break;
                }
                catch (Exception exception)
                {
                    Interlocked.Increment(ref failedWrites);
                    CompleteWrite(pending, new(
                        pending.Request.WorkId,
                        SerialWriteOutcome.Failed,
                        timeProvider.GetUtcNow(),
                        exception.Message));
                    await RecordFaultAndStopAsync("serial.scheduler.write.failed", exception).ConfigureAwait(false);
                }
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
        }
        finally
        {
            CancelQueuedWrites();
        }
    }

    private async Task WriteWithBoundedRetryAsync(
        SerialWriteRequest request,
        CancellationToken cancellationToken)
    {
        try
        {
            await transport.WriteAsync(request.Payload, cancellationToken).ConfigureAwait(false);
        }
        catch (Exception exception) when (
            request.RetryOnTransientTimeout
            && !cancellationToken.IsCancellationRequested
            && IsTransientWriteTimeout(exception))
        {
            Interlocked.Increment(ref retriedWrites);
            diagnostics.Record(new(
                "serial.scheduler.write.retry",
                GatewayDiagnosticSeverity.Warning,
                null,
                transport.PortName,
                $"WorkId={request.WorkId} Priority={request.Priority} Attempt=1/1 Reason=transient-timeout",
                exception));
            await Task.Delay(TimeSpan.FromMilliseconds(100), timeProvider, cancellationToken).ConfigureAwait(false);
            await transport.WriteAsync(request.Payload, cancellationToken).ConfigureAwait(false);
        }
    }

    private static bool IsTransientWriteTimeout(Exception exception) =>
        exception is TimeoutException
        || exception is IOException && (exception.HResult & 0xffff) == 121;

    private PendingWrite? TakeNextWrite(bool safetyOnly)
    {
        lock (queueGate)
        {
            PendingWrite? pending = RemoveFirstLocked(SerialWorkPriority.Safety);
            if (pending is null && !safetyOnly)
            {
                for (var attempt = 0; attempt < FairSchedule.Length; attempt++)
                {
                    var priority = FairSchedule[fairScheduleIndex];
                    fairScheduleIndex = (fairScheduleIndex + 1) % FairSchedule.Length;
                    pending = RemoveFirstLocked(priority);
                    if (pending is not null)
                    {
                        break;
                    }
                }
            }

            if (pending is null)
            {
                return null;
            }

            queueDepth--;
            return pending;
        }
    }

    private async Task WaitForEligibleWriteAsync(
        SerialResponseFence? activeFence,
        CancellationToken cancellationToken)
    {
        while (writerWake.Reader.TryRead(out _))
        {
        }

        if (activeFence is null || activeFence.IsReleased)
        {
            lock (queueGate)
            {
                if (queueDepth > 0)
                {
                    return;
                }
            }

            await writerWake.Reader.ReadAsync(cancellationToken).ConfigureAwait(false);
            return;
        }

        lock (queueGate)
        {
            if (queues[(int)SerialWorkPriority.Safety].Count > 0)
            {
                return;
            }
        }

        using var wakeCancellation = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var wakeTask = writerWake.Reader.ReadAsync(wakeCancellation.Token).AsTask();
        var completed = await Task.WhenAny(activeFence.Released, wakeTask).ConfigureAwait(false);
        wakeCancellation.Cancel();
        if (completed == wakeTask)
        {
            await wakeTask.ConfigureAwait(false);
        }
    }

    private void SignalWriter() => writerWake.Writer.TryWrite(0);

    private PendingWrite? RemoveOldestLowerPriorityLocked()
    {
        foreach (var priority in new[]
        {
            SerialWorkPriority.Background,
            SerialWorkPriority.Telemetry,
            SerialWorkPriority.Interactive
        })
        {
            var pending = RemoveFirstLocked(priority);
            if (pending is null)
            {
                continue;
            }

            pendingWorkIds.Remove(pending.Request.WorkId);
            return pending;
        }

        return null;
    }

    private PendingWrite? RemoveFirstLocked(SerialWorkPriority priority)
    {
        var queue = queues[(int)priority];
        if (queue.First is null)
        {
            return null;
        }

        var value = queue.First.Value;
        queue.RemoveFirst();
        return value;
    }

    private void CancelQueuedWrites()
    {
        List<PendingWrite> pending;
        lock (queueGate)
        {
            pending = queues.SelectMany(queue => queue).ToList();
            foreach (var queue in queues)
            {
                queue.Clear();
            }

            pendingWorkIds.Clear();
            queueDepth = 0;
        }

        foreach (var item in pending)
        {
            item.Completion.TrySetResult(new(
                item.Request.WorkId,
                SerialWriteOutcome.Cancelled,
                timeProvider.GetUtcNow(),
                "Serial scheduler stopped before the queued write started"));
        }
    }

    private void CompleteWrite(PendingWrite pending, SerialWriteCompletion completion)
    {
        lock (queueGate)
        {
            pendingWorkIds.Remove(pending.Request.WorkId);
        }
        pending.Completion.TrySetResult(completion);
    }

    private async Task RecordFaultAndStopAsync(string eventName, Exception exception)
    {
        Interlocked.CompareExchange(ref lastFault, exception, null);
        diagnostics.Record(new(
            eventName,
            GatewayDiagnosticSeverity.Error,
            null,
            transport.PortName,
            "Serial duplex session stopped after an owned runtime fault",
            exception));
        Interlocked.Exchange(ref stopping, 1);
        lifetimeCancellation.Cancel();
        await CloseTransportOnceAsync().ConfigureAwait(false);
    }

    private async Task CloseTransportOnceAsync()
    {
        await closeGate.WaitAsync(CancellationToken.None).ConfigureAwait(false);
        try
        {
            if (Interlocked.Exchange(ref transportClosed, 1) == 0)
            {
                try
                {
                    await transport.CloseAsync(CancellationToken.None).ConfigureAwait(false);
                }
                catch (Exception exception)
                {
                    Interlocked.CompareExchange(ref lastFault, exception, null);
                    diagnostics.Record(new(
                        "serial.scheduler.close.failed",
                        GatewayDiagnosticSeverity.Warning,
                        null,
                        transport.PortName,
                        "Serial transport close failed during scheduler shutdown",
                        exception));
                }
            }
        }
        finally
        {
            closeGate.Release();
        }
    }

    private void ValidateRequest(SerialWriteRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.WorkId) || request.WorkId.Length > 128)
        {
            throw new ArgumentException("workId must contain 1-128 visible characters", nameof(request));
        }

        if (request.Payload.IsEmpty || request.Payload.Length > options.MaximumWriteBytes)
        {
            throw new ArgumentOutOfRangeException(nameof(request), "Serial payload length is outside the configured boundary");
        }

        if (!Enum.IsDefined(request.Priority))
        {
            throw new ArgumentOutOfRangeException(nameof(request), "Serial priority is invalid");
        }

        if (request.MaximumQueueDelay < TimeSpan.FromMilliseconds(10)
            || request.MaximumQueueDelay > TimeSpan.FromSeconds(30))
        {
            throw new ArgumentOutOfRangeException(nameof(request), "Maximum queue delay must be between 10 ms and 30 s");
        }
    }

    private static SerialWriteTicket Rejected(string workId, string reason) =>
        new(false, workId, null, reason);

    private sealed class PendingWrite(SerialWriteRequest request, long enqueuedTimestamp)
    {
        public SerialWriteRequest Request { get; } = request;
        public long EnqueuedTimestamp { get; } = enqueuedTimestamp;
        public TaskCompletionSource<SerialWriteCompletion> Completion { get; } =
            new(TaskCreationOptions.RunContinuationsAsynchronously);
    }
}
