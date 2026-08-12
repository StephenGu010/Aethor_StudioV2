using System.Collections.Concurrent;
using System.Text;
using AethorStudioV2.Application;

namespace AethorStudioV2.Tests;

public sealed class SerialDuplexSchedulerTests
{
    [Fact]
    public async Task InteractiveWriteCompletesWithoutWaitingForReceiveData()
    {
        var transport = new FakeAsciiTransport((_, _) => []);
        await transport.OpenAsync(CancellationToken.None);
        await using var scheduler = CreateScheduler(transport);

        var ticket = scheduler.QueueWrite(Request("terminal-1", "#GETMODE\n", SerialWorkPriority.Interactive));

        Assert.True(ticket.Accepted);
        var completion = await ticket.Completion!.WaitAsync(TimeSpan.FromSeconds(1));
        Assert.Equal(SerialWriteOutcome.Written, completion.Outcome);
        Assert.Equal(["#GETMODE"], transport.Writes);
        Assert.Equal(0, scheduler.GetProbeSnapshot().ReceivedChunks);
    }

    [Fact]
    public async Task ContinuousReaderIsUniqueAndDispatchesBoundedChunks()
    {
        var received = new ConcurrentQueue<string>();
        var transport = new FakeAsciiTransport((_, _) => []);
        await transport.OpenAsync(CancellationToken.None);
        await using var scheduler = new SerialDuplexScheduler(
            transport,
            (chunk, _) =>
            {
                received.Enqueue(Encoding.ASCII.GetString(chunk.Span));
                return ValueTask.CompletedTask;
            });

        transport.PushInbound("ok 1 2 3 4 5 6\n");
        transport.PushInbound("ok 2 INT_POINT\n");

        await TestWait.UntilAsync(() => received.Count == 2);
        var probe = scheduler.GetProbeSnapshot();
        Assert.Equal(2, probe.ReceivedChunks);
        Assert.True(probe.ReceivedBytes > 0);
        Assert.False(probe.Faulted);
    }

    [Fact]
    public async Task SafetyWorkRunsBeforeQueuedInteractiveAndTelemetryWork()
    {
        var transport = new FakeAsciiTransport((_, _) => [])
        {
            BlockWritesUntilClose = true
        };
        await transport.OpenAsync(CancellationToken.None);
        var scheduler = CreateScheduler(transport);

        var active = scheduler.QueueWrite(Request("active", "#GETJPOS\n", SerialWorkPriority.Telemetry));
        await transport.WriteStarted.WaitAsync(TimeSpan.FromSeconds(1));
        var interactive = scheduler.QueueWrite(Request("interactive", "!START\n", SerialWorkPriority.Interactive));
        var telemetry = scheduler.QueueWrite(Request("telemetry", "#GETMODE\n", SerialWorkPriority.Telemetry));
        var safety = scheduler.QueueWrite(Request("safety", "!STOP\n", SerialWorkPriority.Safety));

        transport.ReleaseWrites();
        await TestWait.UntilAsync(() => transport.Writes.Count == 4);

        Assert.True(active.Accepted);
        Assert.True(interactive.Accepted);
        Assert.True(telemetry.Accepted);
        Assert.True(safety.Accepted);
        Assert.Equal(SerialWriteOutcome.Written, (await active.Completion!).Outcome);
        Assert.Equal(SerialWriteOutcome.Written, (await safety.Completion!).Outcome);
        Assert.Equal(SerialWriteOutcome.Written, (await interactive.Completion!).Outcome);
        Assert.Equal(SerialWriteOutcome.Written, (await telemetry.Completion!).Outcome);
        Assert.Equal(["#GETJPOS", "!STOP", "!START", "#GETMODE"], transport.Writes);
        await scheduler.DisposeAsync();
    }

    [Fact]
    public async Task SafetyReserveRejectsNormalWorkBeforeTotalCapacityIsConsumed()
    {
        var transport = new FakeAsciiTransport((_, _) => [])
        {
            BlockWritesUntilClose = true
        };
        await transport.OpenAsync(CancellationToken.None);
        var scheduler = CreateScheduler(transport, new()
        {
            WriteQueueCapacity = 8,
            ReservedSafetySlots = 2
        });

        scheduler.QueueWrite(Request("active", "#GETJPOS\n", SerialWorkPriority.Telemetry));
        await transport.WriteStarted.WaitAsync(TimeSpan.FromSeconds(1));
        var accepted = Enumerable.Range(0, 6)
            .Select(index => scheduler.QueueWrite(Request($"normal-{index}", "#GETMODE\n", SerialWorkPriority.Interactive)))
            .ToArray();
        var rejected = scheduler.QueueWrite(Request("normal-overflow", "#GETMODE\n", SerialWorkPriority.Interactive));
        var safety = scheduler.QueueWrite(Request("safety", "!STOP\n", SerialWorkPriority.Safety));

        Assert.All(accepted, ticket => Assert.True(ticket.Accepted));
        Assert.False(rejected.Accepted);
        Assert.Contains("safety", rejected.RejectionReason!, StringComparison.OrdinalIgnoreCase);
        Assert.True(safety.Accepted);
        Assert.Equal(7, scheduler.GetProbeSnapshot().QueueDepth);

        await scheduler.DisposeAsync();
    }

    [Fact]
    public async Task SafetyWorkSupersedesOldestLowerPriorityItemAtTotalCapacity()
    {
        var transport = new FakeAsciiTransport((_, _) => [])
        {
            BlockWritesUntilClose = true
        };
        await transport.OpenAsync(CancellationToken.None);
        var scheduler = CreateScheduler(transport, new()
        {
            WriteQueueCapacity = 8,
            ReservedSafetySlots = 1
        });

        scheduler.QueueWrite(Request("active", "#GETJPOS\n", SerialWorkPriority.Telemetry));
        await transport.WriteStarted.WaitAsync(TimeSpan.FromSeconds(1));
        var background = scheduler.QueueWrite(Request("background", "#GETENABLE\n", SerialWorkPriority.Background));
        for (var index = 0; index < 6; index++)
        {
            scheduler.QueueWrite(Request($"safety-{index}", "!STOP\n", SerialWorkPriority.Safety));
        }
        var fill = scheduler.QueueWrite(Request("safety-fill", "!STOP\n", SerialWorkPriority.Safety));
        var replacement = scheduler.QueueWrite(Request("safety-replacement", "!STOP\n", SerialWorkPriority.Safety));

        Assert.True(fill.Accepted);
        Assert.True(replacement.Accepted);
        Assert.Equal(SerialWriteOutcome.Superseded, (await background.Completion!).Outcome);
        Assert.Equal(1, scheduler.GetProbeSnapshot().SupersededWrites);

        await scheduler.DisposeAsync();
    }

    [Fact]
    public async Task QueuedWorkExpiresBeforeItCanReachTheTransport()
    {
        var diagnostics = new RecordingGatewayDiagnostics();
        var transport = new FakeAsciiTransport((_, _) => [])
        {
            BlockWritesUntilClose = true
        };
        await transport.OpenAsync(CancellationToken.None);
        var scheduler = new SerialDuplexScheduler(
            transport,
            (_, _) => ValueTask.CompletedTask,
            diagnostics);

        var active = scheduler.QueueWrite(Request("active", "#GETJPOS\n", SerialWorkPriority.Telemetry));
        await transport.WriteStarted.WaitAsync(TimeSpan.FromSeconds(1));
        var expiring = scheduler.QueueWrite(new(
            "expiring",
            Encoding.ASCII.GetBytes("#GETMODE\n"),
            SerialWorkPriority.Interactive,
            TimeSpan.FromMilliseconds(20)));

        await Task.Delay(60);
        transport.ReleaseWrites();

        Assert.Equal(SerialWriteOutcome.Written, (await active.Completion!).Outcome);
        Assert.Equal(SerialWriteOutcome.Expired, (await expiring.Completion!).Outcome);
        Assert.DoesNotContain("#GETMODE", transport.Writes);
        Assert.Equal(1, scheduler.GetProbeSnapshot().ExpiredWrites);
        Assert.Contains(diagnostics.Events, item => item.EventName == "serial.scheduler.write.expired");
        await scheduler.DisposeAsync();
    }

    [Fact]
    public async Task WorkIdRemainsUniqueWhileThePhysicalWriteIsInFlight()
    {
        var transport = new FakeAsciiTransport((_, _) => [])
        {
            BlockWritesUntilClose = true
        };
        await transport.OpenAsync(CancellationToken.None);
        var scheduler = CreateScheduler(transport);

        var active = scheduler.QueueWrite(Request("same-id", "#GETJPOS\n", SerialWorkPriority.Telemetry));
        await transport.WriteStarted.WaitAsync(TimeSpan.FromSeconds(1));
        var duplicate = scheduler.QueueWrite(Request("same-id", "#GETMODE\n", SerialWorkPriority.Interactive));

        Assert.True(active.Accepted);
        Assert.False(duplicate.Accepted);
        Assert.Contains("already", duplicate.RejectionReason!, StringComparison.OrdinalIgnoreCase);

        transport.ReleaseWrites();
        Assert.Equal(SerialWriteOutcome.Written, (await active.Completion!).Outcome);
        await scheduler.DisposeAsync();
    }

    [Fact]
    public async Task FairScheduleLetsBackgroundWorkProgressUnderInteractiveLoad()
    {
        var transport = new FakeAsciiTransport((_, _) => [])
        {
            BlockWritesUntilClose = true
        };
        await transport.OpenAsync(CancellationToken.None);
        var scheduler = CreateScheduler(transport);

        var active = scheduler.QueueWrite(Request("active", "#GETJPOS\n", SerialWorkPriority.Telemetry));
        await transport.WriteStarted.WaitAsync(TimeSpan.FromSeconds(1));
        var background = scheduler.QueueWrite(Request("background", "#GETENABLE\n", SerialWorkPriority.Background));
        var interactive = Enumerable.Range(0, 6)
            .Select(index => scheduler.QueueWrite(Request(
                $"interactive-{index}",
                $"!MODE{index + 1}\n",
                SerialWorkPriority.Interactive)))
            .ToArray();

        transport.ReleaseWrites();
        await Task.WhenAll(interactive.Select(ticket => ticket.Completion!));
        Assert.Equal(SerialWriteOutcome.Written, (await active.Completion!).Outcome);
        Assert.Equal(SerialWriteOutcome.Written, (await background.Completion!).Outcome);

        var writes = transport.Writes.ToArray();
        Assert.True(
            Array.IndexOf(writes, "#GETENABLE") < Array.IndexOf(writes, "!MODE6"),
            "Background work should make bounded progress before the interactive queue drains");
        await scheduler.DisposeAsync();
    }

    [Fact]
    public async Task DisposeClosesTransportToReleaseUncancellableIoAndCancelsQueue()
    {
        var transport = new FakeAsciiTransport((_, _) => [])
        {
            BlockWritesUntilClose = true,
            IgnoreWriteCancellation = true,
            IgnoreReadCancellation = true
        };
        await transport.OpenAsync(CancellationToken.None);
        var scheduler = CreateScheduler(transport);
        var active = scheduler.QueueWrite(Request("active", "#GETJPOS\n", SerialWorkPriority.Telemetry));
        var queued = scheduler.QueueWrite(Request("queued", "#GETMODE\n", SerialWorkPriority.Interactive));
        await transport.WriteStarted.WaitAsync(TimeSpan.FromSeconds(1));

        await scheduler.DisposeAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(2));

        Assert.Equal(1, transport.CloseCount);
        Assert.Equal(1, transport.DisposeCount);
        Assert.Equal(SerialWriteOutcome.Cancelled, (await active.Completion!).Outcome);
        Assert.Equal(SerialWriteOutcome.Cancelled, (await queued.Completion!).Outcome);
        Assert.False(scheduler.GetProbeSnapshot().Running);
    }

    [Fact]
    public async Task TransportFaultIsObservableAndReleasesEveryQueuedWriter()
    {
        var diagnostics = new RecordingGatewayDiagnostics();
        var transport = new FakeAsciiTransport((_, _) => []);
        await transport.OpenAsync(CancellationToken.None);
        var scheduler = new SerialDuplexScheduler(
            transport,
            (_, _) => ValueTask.CompletedTask,
            diagnostics);

        transport.SimulateUnplug();
        await scheduler.Completion.WaitAsync(TimeSpan.FromSeconds(2));

        var probe = scheduler.GetProbeSnapshot();
        Assert.True(probe.Faulted);
        Assert.False(probe.Running);
        Assert.Contains(diagnostics.Events, item => item.EventName == "serial.scheduler.read.failed");
        await scheduler.DisposeAsync();
    }

    private static SerialDuplexScheduler CreateScheduler(
        FakeAsciiTransport transport,
        SerialDuplexSchedulerOptions? options = null) =>
        new(transport, (_, _) => ValueTask.CompletedTask, options: options);

    private static SerialWriteRequest Request(string id, string line, SerialWorkPriority priority) =>
        new(id, Encoding.ASCII.GetBytes(line), priority, TimeSpan.FromSeconds(2));
}
