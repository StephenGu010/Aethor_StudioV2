using AethorStudioV2.Application;
using AethorStudioV2.Domain;
using System.Globalization;

namespace AethorStudioV2.Tests;

public sealed class EngineeringActionProgramRuntimeTests
{
    [Fact]
    public async Task FiniteRunPreservesMeasuredAnglesAndFinishesAsUnconfirmedAfterTransportWrites()
    {
        var port = new RecordingEngineeringActionPort();
        var delay = new RecordingEngineeringActionDelay();
        await using var runtime = new EngineeringActionProgramRuntime(port, delay: delay);
        var request = Request(
            loopEnabled: false,
            Waypoint("point-1", [181, 95, -45, 200, -150, 900], postDispatchWaitMs: 500),
            Waypoint("point-2", [10, 20, 30, 40, 50, 60]));

        var handle = runtime.Start(request);
        var result = await handle.Completion;

        Assert.Equal(ActionProgramRuntimeState.FinishedUnconfirmed, result.State);
        Assert.False(result.PhysicalCompletionConfirmed);
        Assert.Equal(1, result.CompletedCycles);
        Assert.Collection(
            port.Lines,
            line => Assert.Equal(">181,95,-45,200,-150,900,20", line),
            line => Assert.Equal(">10,20,30,40,50,60,20", line));
        Assert.Equal([TimeSpan.FromMilliseconds(45_000 + 500), TimeSpan.FromMilliseconds(42_000)], delay.Durations);
    }

    [Fact]
    public async Task QueuedResultDoesNotAdvanceToTheNextWaypoint()
    {
        var port = new RecordingEngineeringActionPort
        {
            SendHandler = (_, _, _) => Task.FromResult(new DirectCommandResult(
                "request-queued", "session-1", DirectCommandStatus.Queued,
                CommandEvidence.GatewayAccepted, ">1,2,3,4,5,6,20", "queued",
                DateTimeOffset.Parse("2026-08-19T00:00:00Z", CultureInfo.InvariantCulture)))
        };
        await using var runtime = new EngineeringActionProgramRuntime(port, delay: new RecordingEngineeringActionDelay());

        var result = await runtime.Start(Request(false,
            Waypoint("point-1", [1, 2, 3, 4, 5, 6]),
            Waypoint("point-2", [2, 3, 4, 5, 6, 7]))).Completion;

        Assert.Equal(ActionProgramRuntimeState.Failed, result.State);
        Assert.Equal([
            ">1,2,3,4,5,6,20",
            "!STOP",
            "!DISABLE"
        ], port.Lines);
    }

    [Fact]
    public async Task LoopRepeatsUntilOperatorStopAndCancelsFutureWaypoints()
    {
        var port = new RecordingEngineeringActionPort();
        var delay = new BlockingEngineeringActionDelay();
        await using var runtime = new EngineeringActionProgramRuntime(port, delay: delay);
        var handle = runtime.Start(Request(true, Waypoint("point-1", [1, 2, 3, 4, 5, 6])));
        await delay.Entered.Task.WaitAsync(TimeSpan.FromSeconds(1));

        var stopped = await runtime.StopAsync("operator");
        var completed = await handle.Completion;

        Assert.Equal(ActionProgramRuntimeState.StoppedUnconfirmed, stopped.State);
        Assert.Equal(stopped, completed);
        Assert.Equal([
            ">1,2,3,4,5,6,20",
            "!STOP",
            "!DISABLE"
        ], port.Lines);
        Assert.False(stopped.PhysicalCompletionConfirmed);
    }

    [Fact]
    public async Task RejectsSessionOrModeMismatchBeforeAcquiringTheSerialOwner()
    {
        var port = new RecordingEngineeringActionPort();
        await using var runtime = new EngineeringActionProgramRuntime(port);

        var wrongSession = await runtime.Start(Request(false, Waypoint("point-1", [1, 2, 3, 4, 5, 6])) with
        {
            SessionId = "stale-session"
        }).Completion;
        var wrongMode = await runtime.Start(Request(false, Waypoint("point-1", [1, 2, 3, 4, 5, 6]) with { Mode = 3 })).Completion;

        Assert.Equal(ActionProgramRuntimeState.Rejected, wrongSession.State);
        Assert.Equal(ActionProgramRuntimeState.Rejected, wrongMode.State);
        Assert.Equal(0, port.BeginCount);
        Assert.Empty(port.Lines);
    }

    [Fact]
    public async Task MalformedRunRequestFailsAsValidationInsteadOfCreatingAnInvalidSnapshot()
    {
        var port = new RecordingEngineeringActionPort();
        await using var runtime = new EngineeringActionProgramRuntime(port);

        Assert.Throws<GatewayValidationException>(() => runtime.Start(Request(false)));
        Assert.Throws<GatewayValidationException>(() => runtime.Start(
            Request(false, Waypoint("point-1", [1, 2, 3, 4, 5, 6])) with { SpeedDegS = 0 }));
        Assert.Throws<GatewayValidationException>(() => runtime.Start(
            Request(false, Waypoint("point-1", [1, 2, 3, 4, 5, 6])) with { Waypoints = null! }));

        Assert.Null(runtime.GetSnapshot());
        Assert.Equal(0, port.BeginCount);
    }

    [Fact]
    public async Task SnapshotsWaypointArraysBeforeTheRunStartsWriting()
    {
        var firstWriteEntered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var releaseFirstWrite = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var sendCount = 0;
        var port = new RecordingEngineeringActionPort
        {
            SendHandler = async (_, request, cancellationToken) =>
            {
                if (Interlocked.Increment(ref sendCount) == 1)
                {
                    firstWriteEntered.TrySetResult();
                    await releaseFirstWrite.Task.WaitAsync(cancellationToken);
                }
                return Written(request);
            }
        };
        var secondPositions = new double[] { 10, 20, 30, 40, 50, 60 };
        await using var runtime = new EngineeringActionProgramRuntime(port, delay: new RecordingEngineeringActionDelay());

        var handle = runtime.Start(Request(false,
            Waypoint("point-1", [1, 2, 3, 4, 5, 6]),
            Waypoint("point-2", secondPositions)));
        await firstWriteEntered.Task.WaitAsync(TimeSpan.FromSeconds(1));
        secondPositions[0] = 999;
        releaseFirstWrite.TrySetResult();
        await handle.Completion;

        Assert.Equal(">10,20,30,40,50,60,20", port.Lines[1]);
    }

    [Fact]
    public async Task StopTransportFailureStillAttemptsDisableAndReleasesTheRun()
    {
        var delay = new BlockingEngineeringActionDelay();
        var port = new RecordingEngineeringActionPort
        {
            SendHandler = (_, request, _) => request.Line.StartsWith('!')
                ? Task.FromException<DirectCommandResult>(new IOException("transport unavailable"))
                : Task.FromResult(Written(request))
        };
        var runtime = new EngineeringActionProgramRuntime(port, delay: delay);
        var handle = runtime.Start(Request(true, Waypoint("point-1", [1, 2, 3, 4, 5, 6])));
        await delay.Entered.Task.WaitAsync(TimeSpan.FromSeconds(1));

        var result = await runtime.StopAsync("operator").WaitAsync(TimeSpan.FromSeconds(1));

        Assert.Equal(ActionProgramRuntimeState.Failed, result.State);
        Assert.Equal([">1,2,3,4,5,6,20", "!STOP", "!DISABLE"], port.Lines);
        Assert.Equal(1, port.EndCount);
        Assert.False(runtime.IsActive);
        Assert.Equal(result, await handle.Completion);
    }

    [Fact]
    public async Task ConcurrentStartIsAConflictAndCannotReplaceTheActiveSnapshot()
    {
        var delay = new BlockingEngineeringActionDelay();
        var port = new RecordingEngineeringActionPort();
        await using var runtime = new EngineeringActionProgramRuntime(port, delay: delay);
        var active = runtime.Start(Request(true, Waypoint("point-1", [1, 2, 3, 4, 5, 6])));
        await delay.Entered.Task.WaitAsync(TimeSpan.FromSeconds(1));

        var exception = Assert.Throws<GatewayConflictException>(() => runtime.Start(
            Request(false, Waypoint("other-point", [2, 3, 4, 5, 6, 7])) with { RunId = "run-2" }));

        Assert.Contains("正在运行", exception.Message, StringComparison.Ordinal);
        Assert.Equal("run-1", runtime.GetSnapshot()?.RunId);
        await runtime.StopAsync("cleanup");
        await active.Completion;
    }

    [Fact]
    public async Task RejectedStartRacingWithAnotherStartCannotReplaceTheActiveSnapshot()
    {
        var firstSessionReadEntered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var releaseFirstSessionRead = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var sessionReadCount = 0;
        var delay = new BlockingEngineeringActionDelay();
        var port = new RecordingEngineeringActionPort
        {
            SessionProvider = () =>
            {
                if (Interlocked.Increment(ref sessionReadCount) == 1)
                {
                    firstSessionReadEntered.TrySetResult();
                    releaseFirstSessionRead.Task.GetAwaiter().GetResult();
                }
                return ConnectedSession();
            }
        };
        await using var runtime = new EngineeringActionProgramRuntime(port, delay: delay);

        var rejectedStart = Task.Run(() => runtime.Start(
            Request(false, Waypoint("stale-point", [1, 2, 3, 4, 5, 6])) with
            {
                RunId = "run-stale",
                SessionId = "stale-session"
            }));
        await firstSessionReadEntered.Task.WaitAsync(TimeSpan.FromSeconds(1));
        var activeStart = Task.Run(() => runtime.Start(
            Request(true, Waypoint("active-point", [2, 3, 4, 5, 6, 7])) with { RunId = "run-active" }));

        await Task.Delay(20);
        releaseFirstSessionRead.TrySetResult();
        var rejected = await (await rejectedStart).Completion;
        var active = await activeStart;
        await delay.Entered.Task.WaitAsync(TimeSpan.FromSeconds(1));

        Assert.Equal(ActionProgramRuntimeState.Rejected, rejected.State);
        Assert.Equal("run-active", runtime.GetSnapshot()?.RunId);
        await runtime.StopAsync("cleanup");
        await active.Completion;
    }

    [Fact]
    public async Task SessionTerminationCancelsPacingAndStopsTheRun()
    {
        var delay = new BlockingEngineeringActionDelay();
        var port = new RecordingEngineeringActionPort();
        await using var runtime = new EngineeringActionProgramRuntime(port, delay: delay);
        var handle = runtime.Start(Request(true, Waypoint("point-1", [1, 2, 3, 4, 5, 6])));
        await delay.Entered.Task.WaitAsync(TimeSpan.FromSeconds(1));

        port.RaiseSessionTerminated("serial polling faulted");
        var stopped = await handle.Completion.WaitAsync(TimeSpan.FromSeconds(1));

        Assert.Equal(ActionProgramRuntimeState.StoppedUnconfirmed, stopped.State);
        Assert.Equal([">1,2,3,4,5,6,20", "!STOP", "!DISABLE"], port.Lines);
        Assert.Contains("串口会话结束", stopped.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task UnrepresentablePacingDurationIsRejectedBeforeSerialOwnershipOrWrite()
    {
        var port = new RecordingEngineeringActionPort();
        await using var runtime = new EngineeringActionProgramRuntime(port);

        var result = await runtime.Start(Request(false,
            Waypoint("point-1", [1e18, 0, 0, 0, 0, 0]))).Completion;

        Assert.Equal(ActionProgramRuntimeState.Rejected, result.State);
        Assert.Contains("调度等待时间", result.Message, StringComparison.Ordinal);
        Assert.Equal(0, port.BeginCount);
        Assert.Empty(port.Lines);
    }

    [Fact]
    public async Task ReusingClientRunIdStillCreatesFreshInternalDirectRequestIds()
    {
        var port = new RecordingEngineeringActionPort();
        await using var runtime = new EngineeringActionProgramRuntime(
            port,
            delay: new RecordingEngineeringActionDelay());
        var request = Request(false, Waypoint("point-1", [1, 2, 3, 4, 5, 6]));

        await runtime.Start(request).Completion;
        await runtime.Start(request).Completion;

        Assert.Equal(2, port.RequestIds.Count);
        Assert.Equal(2, port.RequestIds.Distinct(StringComparer.Ordinal).Count());
        Assert.Equal([">1,2,3,4,5,6,20", ">1,2,3,4,5,6,20"], port.Lines);
    }

    [Fact]
    public async Task NewRunTimestampsStayNewerWhenTheWallClockMovesBackward()
    {
        var time = new MutableTimeProvider(DateTimeOffset.Parse(
            "2026-08-19T00:00:10Z", CultureInfo.InvariantCulture));
        await using var runtime = new EngineeringActionProgramRuntime(
            new RecordingEngineeringActionPort(),
            timeProvider: time,
            delay: new RecordingEngineeringActionDelay());

        var first = await runtime.Start(
            Request(false, Waypoint("point-1", [1, 2, 3, 4, 5, 6]))).Completion;
        time.UtcNow = DateTimeOffset.Parse("2026-08-19T00:00:00Z", CultureInfo.InvariantCulture);
        var secondHandle = runtime.Start(
            Request(false, Waypoint("point-2", [2, 3, 4, 5, 6, 7])) with { RunId = "run-2" });
        var second = await secondHandle.Completion;

        Assert.True(secondHandle.InitialSnapshot.UpdatedAtUtc > first.UpdatedAtUtc);
        Assert.True(second.UpdatedAtUtc > secondHandle.InitialSnapshot.UpdatedAtUtc);
    }

    [Fact]
    public async Task OverlongFirmwareQueueEntryIsRejectedBeforeSerialOwnershipOrWrite()
    {
        var port = new RecordingEngineeringActionPort();
        await using var runtime = new EngineeringActionProgramRuntime(port);

        var result = await runtime.Start(Request(false,
            Waypoint("point-1", [1.23456789012345d, 1.23456789012345d, 1.23456789012345d, 1.23456789012345d, 0, 0]))).Completion;

        Assert.Equal(ActionProgramRuntimeState.Rejected, result.State);
        Assert.Contains("63", result.Message, StringComparison.Ordinal);
        Assert.Equal(0, port.BeginCount);
        Assert.Empty(port.Lines);
    }

    [Fact]
    public async Task PublishedSnapshotsHaveStrictlyIncreasingTimestampsEvenWhenTheClockDoesNotAdvance()
    {
        var sink = new RecordingActionProgramRunSink();
        var frozenTime = new FrozenTimeProvider();
        await using var runtime = new EngineeringActionProgramRuntime(
            new RecordingEngineeringActionPort(),
            sink,
            frozenTime,
            new RecordingEngineeringActionDelay());

        var completed = await runtime.Start(Request(false, Waypoint("point-1", [1, 2, 3, 4, 5, 6]))).Completion;

        Assert.True(sink.Snapshots.Count >= 4);
        Assert.All(sink.Snapshots.Zip(sink.Snapshots.Skip(1)), pair =>
            Assert.True(pair.First.UpdatedAtUtc < pair.Second.UpdatedAtUtc));
        Assert.Equal(runtime.GetSnapshot(), completed);
    }

    [Fact]
    public async Task SlowEventSinkIsSingleFlightAndCoalescesIntermediateSnapshots()
    {
        var sink = new BlockingActionProgramRunSink();
        await using var runtime = new EngineeringActionProgramRuntime(
            new RecordingEngineeringActionPort(),
            sink,
            delay: new RecordingEngineeringActionDelay());

        var completed = await runtime.Start(
            Request(false, Waypoint("point-1", [1, 2, 3, 4, 5, 6]))).Completion;

        Assert.Equal(1, sink.CallCount);
        sink.Release.TrySetResult();
        var last = await sink.TerminalPublished.Task.WaitAsync(TimeSpan.FromSeconds(1));
        Assert.Equal(ActionProgramRuntimeState.FinishedUnconfirmed, last.State);
        Assert.Equal(completed, last);
        Assert.Equal(2, sink.CallCount);
    }

    private static ActionProgramRunStartRequest Request(
        bool loopEnabled,
        params ActionProgramRunWaypoint[] waypoints) => new(
            "1.0",
            "run-1",
            "program-1",
            1,
            "session-1",
            GatewayContractV1.DummyProfileId,
            ActionProgramSource.Authored,
            20,
            loopEnabled,
            waypoints);

    private static ActionProgramRunWaypoint Waypoint(
        string waypointId,
        double[] positionsDeg,
        int postDispatchWaitMs = 0) => new(
            waypointId,
            waypointId,
            positionsDeg,
            2,
            postDispatchWaitMs,
            ActionWaypointSource.MeasuredCapture);

    private static DirectCommandResult Written(DirectCommandRequest request) => new(
        request.RequestId, request.SessionId, DirectCommandStatus.Sent,
        CommandEvidence.TransportWritten, request.Line, "written",
        DateTimeOffset.Parse("2026-08-19T00:00:00Z", CultureInfo.InvariantCulture));

    private sealed class RecordingEngineeringActionPort : IEngineeringActionProgramCommandPort
    {
        public Func<string, DirectCommandRequest, CancellationToken, Task<DirectCommandResult>>? SendHandler { get; init; }
        public Func<RobotSessionSnapshot>? SessionProvider { get; init; }
        public List<string> Lines { get; } = [];
        public List<string> RequestIds { get; } = [];
        public int BeginCount { get; private set; }
        public int EndCount { get; private set; }
        public double MaximumSpeedDegS => 100;

        public event Action<string>? SessionTerminated;

        public RobotSessionSnapshot GetSession() => SessionProvider?.Invoke() ?? ConnectedSession();

        public void RaiseSessionTerminated(string reason) => SessionTerminated?.Invoke(reason);

        private static RobotSessionSnapshot ConnectedSession() => new(
            "session-1", GatewayContractV1.DummyProfileId, ConnectionState.Connected,
            MotorState.Enabled, 2, DateTimeOffset.Parse("2026-08-19T00:00:00Z", CultureInfo.InvariantCulture),
            DataSource.Measured, Validity.Valid);

        public JointStateFrame GetJointState() => new(
            1, GatewayContractV1.DummyProfileId, DateTimeOffset.Parse("2026-08-19T00:00:00Z", CultureInfo.InvariantCulture),
            [0, 0, 0, 0, 0, 0], DataSource.Measured, Validity.Valid);

        public bool TryBeginActionRun(string runId, string sessionId)
        {
            BeginCount += 1;
            return true;
        }

        public void EndActionRun(string runId)
        {
            EndCount += 1;
        }

        public Task<DirectCommandResult> SendActionDirectAndAwaitTerminalAsync(
            string runId,
            DirectCommandRequest request,
            CancellationToken cancellationToken)
        {
            Lines.Add(request.Line);
            RequestIds.Add(request.RequestId);
            if (SendHandler is not null) return SendHandler(runId, request, cancellationToken);
            return Task.FromResult(Written(request));
        }
    }

    private static RobotSessionSnapshot ConnectedSession() => new(
        "session-1", GatewayContractV1.DummyProfileId, ConnectionState.Connected,
        MotorState.Enabled, 2, DateTimeOffset.Parse("2026-08-19T00:00:00Z", CultureInfo.InvariantCulture),
        DataSource.Measured, Validity.Valid);

    private sealed class RecordingEngineeringActionDelay : IActionProgramDelay
    {
        public List<TimeSpan> Durations { get; } = [];

        public Task DelayAsync(TimeSpan duration, CancellationToken cancellationToken)
        {
            Durations.Add(duration);
            return Task.CompletedTask;
        }
    }

    private sealed class BlockingEngineeringActionDelay : IActionProgramDelay
    {
        public TaskCompletionSource Entered { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);

        public async Task DelayAsync(TimeSpan duration, CancellationToken cancellationToken)
        {
            Entered.TrySetResult();
            await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
        }
    }

    private sealed class RecordingActionProgramRunSink : IActionProgramRunEventSink
    {
        public List<ActionProgramRunSnapshot> Snapshots { get; } = [];

        public ValueTask PublishActionProgramRunAsync(
            ActionProgramRunSnapshot snapshot,
            CancellationToken cancellationToken)
        {
            Snapshots.Add(snapshot);
            return ValueTask.CompletedTask;
        }
    }

    private sealed class FrozenTimeProvider : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() =>
            DateTimeOffset.Parse("2026-08-19T00:00:00Z", CultureInfo.InvariantCulture);
    }

    private sealed class MutableTimeProvider(DateTimeOffset utcNow) : TimeProvider
    {
        public DateTimeOffset UtcNow { get; set; } = utcNow;
        public override DateTimeOffset GetUtcNow() => UtcNow;
    }

    private sealed class BlockingActionProgramRunSink : IActionProgramRunEventSink
    {
        private int callCount;
        public int CallCount => Volatile.Read(ref callCount);
        public TaskCompletionSource Release { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource<ActionProgramRunSnapshot> TerminalPublished { get; } =
            new(TaskCreationOptions.RunContinuationsAsynchronously);

        public async ValueTask PublishActionProgramRunAsync(
            ActionProgramRunSnapshot snapshot,
            CancellationToken cancellationToken)
        {
            var invocation = Interlocked.Increment(ref callCount);
            if (invocation == 1) await Release.Task.WaitAsync(cancellationToken);
            if (snapshot.State == ActionProgramRuntimeState.FinishedUnconfirmed)
            {
                TerminalPublished.TrySetResult(snapshot);
            }
        }
    }
}
