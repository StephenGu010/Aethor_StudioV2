using System.Collections.Concurrent;
using System.Diagnostics;
using AethorStudioV2.Application;
using AethorStudioV2.Domain;

namespace AethorStudioV2.Tests;

public sealed class ActionProgramRunnerTests
{
    [Fact]
    public async Task ExecutesOneWaypointAtATimeAndWaitsOnlyAfterFeedbackConfirmation()
    {
        var port = new FakeActionProgramCommandPort();
        var delay = new RecordingActionProgramDelay();
        await using var runner = Runner(port, delay: delay);
        var plan = Plan(
            "sequential",
            Waypoint(1, mode: 1, waitMs: 250),
            Waypoint(2, mode: 1),
            Waypoint(3, mode: 2));

        var handle = runner.Start(plan);
        var result = await handle.Completion;

        Assert.True(handle.Accepted);
        Assert.Equal(ActionProgramRunStatus.Completed, result.Status);
        Assert.Equal(ActionProgramRunCode.Ok, result.Code);
        Assert.All(result.Waypoints, record => Assert.True(record.FeedbackConfirmed));
        Assert.Equal(
            ["mode:1", "joint:1", "joint:2", "mode:2", "joint:3"],
            port.Calls.ToArray());
        Assert.Equal([TimeSpan.FromMilliseconds(250)], delay.Durations.ToArray());
        Assert.Null(result.StopResult);
        Assert.Null(result.ResumeCheckpoint);
        Assert.Null(runner.ActiveRunId);
    }

    [Fact]
    public async Task DoesNotAdvanceWhenCompletedCommandLacksFeedbackEvidence()
    {
        var port = new FakeActionProgramCommandPort
        {
            JointGroupHandler = (command, _) => Task.FromResult(Result(
                command.CommandId,
                command.SessionId,
                RobotCommandKind.JointGroup,
                CommandStatus.Completed,
                CommandResultCode.Ok,
                CommandEvidence.DeviceAck))
        };
        await using var runner = Runner(port);

        var result = await runner.Start(Plan(
            "weak-evidence",
            Waypoint(1, mode: 1),
            Waypoint(2, mode: 2))).Completion;

        Assert.Equal(ActionProgramRunStatus.Failed, result.Status);
        Assert.Equal(ActionProgramRunCode.WaypointCommandFailed, result.Code);
        Assert.Equal(["mode:1", "joint:1", "stop"], port.Calls.ToArray());
        Assert.True(result.SafeStopConfirmed);
        Assert.Null(result.ResumeCheckpoint);
        Assert.Single(result.Waypoints);
        Assert.False(result.Waypoints[0].FeedbackConfirmed);
    }

    [Fact]
    public async Task OperatorStopDuringPostArrivalWaitStopsOnceAndCreatesCheckpoint()
    {
        var port = new FakeActionProgramCommandPort();
        var delay = new BlockingActionProgramDelay();
        await using var runner = Runner(port, delay: delay);
        var plan = Plan(
            "operator-stop",
            Waypoint(1, mode: 1, waitMs: 5_000),
            Waypoint(2, mode: 2));

        var handle = runner.Start(plan);
        await delay.Entered.Task.WaitAsync(TimeSpan.FromSeconds(1));
        Assert.True(runner.RequestStop(plan.RunId));
        var result = await handle.Completion.WaitAsync(TimeSpan.FromSeconds(2));

        Assert.Equal(ActionProgramRunStatus.Stopped, result.Status);
        Assert.Equal(ActionProgramRunCode.OperatorStopped, result.Code);
        Assert.True(result.SafeStopConfirmed);
        Assert.Equal(["mode:1", "joint:1", "stop"], port.Calls.ToArray());
        var checkpoint = Assert.IsType<ActionProgramResumeCheckpoint>(result.ResumeCheckpoint);
        Assert.Equal(0, checkpoint.LastConfirmedWaypointIndex);
        Assert.Equal(plan.Waypoints[0].WaypointId, checkpoint.LastConfirmedWaypointId);
    }

    [Fact]
    public async Task UnconfirmedStopNeverReportsStopped()
    {
        var port = new FakeActionProgramCommandPort
        {
            StopHandler = (command, _) => Task.FromResult(Result(
                command.CommandId,
                command.SessionId,
                RobotCommandKind.StopAndDisable,
                CommandStatus.Unconfirmed,
                CommandResultCode.Timeout,
                CommandEvidence.None))
        };
        var delay = new BlockingActionProgramDelay();
        await using var runner = Runner(port, delay: delay);
        var plan = Plan("stop-unknown", Waypoint(1, waitMs: 5_000));

        var handle = runner.Start(plan);
        await delay.Entered.Task.WaitAsync(TimeSpan.FromSeconds(1));
        Assert.True(runner.RequestStop(plan.RunId));
        var result = await handle.Completion.WaitAsync(TimeSpan.FromSeconds(2));

        Assert.Equal(ActionProgramRunStatus.Failed, result.Status);
        Assert.Equal(ActionProgramRunCode.StopUnconfirmed, result.Code);
        Assert.False(result.SafeStopConfirmed);
        Assert.Contains("物理急停", result.Message, StringComparison.Ordinal);
        Assert.Equal(1, port.Calls.Count(call => call == "stop"));
    }

    [Fact]
    public async Task ResumeRequiresSameRevisionSessionAndPlanFingerprint()
    {
        var firstPort = new FakeActionProgramCommandPort();
        var blockingDelay = new BlockingActionProgramDelay();
        ActionProgramRunResult stopped;
        var originalPlan = Plan(
            "resume-origin",
            Waypoint(1, mode: 1, waitMs: 5_000),
            Waypoint(2, mode: 2));
        await using (var firstRunner = Runner(firstPort, delay: blockingDelay))
        {
            var firstHandle = firstRunner.Start(originalPlan);
            await blockingDelay.Entered.Task.WaitAsync(TimeSpan.FromSeconds(1));
            Assert.True(firstRunner.RequestStop(originalPlan.RunId));
            stopped = await firstHandle.Completion.WaitAsync(TimeSpan.FromSeconds(2));
        }

        var checkpoint = Assert.IsType<ActionProgramResumeCheckpoint>(stopped.ResumeCheckpoint);
        var resumePort = new FakeActionProgramCommandPort();
        await using var resumeRunner = Runner(resumePort);
        var resumePlan = originalPlan with { RunId = "resume-next" };
        var resumed = await resumeRunner.Start(resumePlan, checkpoint).Completion;

        Assert.Equal(ActionProgramRunStatus.Completed, resumed.Status);
        Assert.Equal(["mode:2", "joint:2"], resumePort.Calls.ToArray());
        var mismatched = resumePlan with { RunId = "resume-wrong", SessionId = "other-session" };
        var rejected = resumeRunner.Start(mismatched, checkpoint);
        Assert.False(rejected.Accepted);
        Assert.Equal(ActionProgramRunCode.InvalidPlan, (await rejected.Completion).Code);
        Assert.Equal(["mode:2", "joint:2"], resumePort.Calls.ToArray());
    }

    [Fact]
    public async Task RejectsConcurrentRunWithoutSendingItsCommands()
    {
        var modeEntered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var blockedMode = new TaskCompletionSource<CommandResult>(TaskCreationOptions.RunContinuationsAsynchronously);
        var port = new FakeActionProgramCommandPort
        {
            SetModeHandler = (_, _) =>
            {
                modeEntered.TrySetResult();
                return blockedMode.Task;
            }
        };
        await using var runner = Runner(port);
        var firstPlan = Plan("busy-first", Waypoint(1));

        var first = runner.Start(firstPlan);
        await modeEntered.Task.WaitAsync(TimeSpan.FromSeconds(1));
        var second = runner.Start(firstPlan with { RunId = "busy-second" });

        Assert.False(second.Accepted);
        Assert.Equal(ActionProgramRunCode.RunnerBusy, (await second.Completion).Code);
        Assert.True(runner.RequestStop(firstPlan.RunId));
        var stopped = await first.Completion.WaitAsync(TimeSpan.FromSeconds(2));
        Assert.Equal(ActionProgramRunStatus.Stopped, stopped.Status);
        Assert.Equal(["mode:1", "stop"], port.Calls.ToArray());
        blockedMode.TrySetResult(Confirmed("late", SessionId, RobotCommandKind.SetMode));
    }

    [Fact]
    public async Task StopRequestedAsModeCompletesPreventsJointPortCall()
    {
        ActionProgramRunner? runner = null;
        var plan = Plan("stop-after-mode", Waypoint(1));
        var port = new FakeActionProgramCommandPort
        {
            SetModeHandler = (command, _) =>
            {
                Assert.True(runner!.RequestStop(plan.RunId));
                return Task.FromResult(Confirmed(
                    command.CommandId,
                    command.SessionId,
                    RobotCommandKind.SetMode));
            }
        };
        await using (runner = Runner(port))
        {
            var result = await runner.Start(plan).Completion;

            Assert.Equal(ActionProgramRunStatus.Stopped, result.Status);
            Assert.Equal(["mode:1", "stop"], port.Calls.ToArray());
            Assert.DoesNotContain(port.Calls, call => call.StartsWith("joint:", StringComparison.Ordinal));
        }
    }

    [Fact]
    public async Task CommandAwaitTimeoutIsBoundedAndTriggersSafeStop()
    {
        var blockedMode = new TaskCompletionSource<CommandResult>(TaskCreationOptions.RunContinuationsAsynchronously);
        var port = new FakeActionProgramCommandPort { SetModeHandler = (_, _) => blockedMode.Task };
        var options = new ActionProgramRunnerOptions
        {
            CommandAwaitTimeout = TimeSpan.FromMilliseconds(120),
            StopAwaitTimeout = TimeSpan.FromSeconds(1)
        };
        await using var runner = Runner(port, options);
        var stopwatch = Stopwatch.StartNew();

        var result = await runner.Start(Plan("bounded-timeout", Waypoint(1)))
            .Completion.WaitAsync(TimeSpan.FromSeconds(2));

        stopwatch.Stop();
        Assert.Equal(ActionProgramRunStatus.Failed, result.Status);
        Assert.Equal(ActionProgramRunCode.CommandAwaitTimedOut, result.Code);
        Assert.True(result.SafeStopConfirmed);
        Assert.True(stopwatch.Elapsed < TimeSpan.FromSeconds(2));
        Assert.Equal(["mode:1", "stop"], port.Calls.ToArray());
        blockedMode.TrySetResult(Confirmed("late", SessionId, RobotCommandKind.SetMode));
    }

    [Fact]
    public async Task InternalDelayFailurePreservesLastConfirmedCheckpointAndStops()
    {
        var port = new FakeActionProgramCommandPort();
        await using var runner = Runner(port, delay: new ThrowingActionProgramDelay());
        var plan = Plan(
            "delay-failure",
            Waypoint(1, waitMs: 100),
            Waypoint(2));

        var result = await runner.Start(plan).Completion;

        Assert.Equal(ActionProgramRunStatus.Failed, result.Status);
        Assert.Equal(ActionProgramRunCode.CommandTransportFailure, result.Code);
        Assert.True(result.SafeStopConfirmed);
        Assert.Equal(["mode:1", "joint:1", "stop"], port.Calls.ToArray());
        Assert.Equal(0, Assert.IsType<ActionProgramResumeCheckpoint>(result.ResumeCheckpoint).LastConfirmedWaypointIndex);
    }

    [Fact]
    public async Task RejectsShowcaseAethorAndOutOfLimitPlansBeforePortOwnership()
    {
        var port = new FakeActionProgramCommandPort();
        await using var runner = Runner(port);
        var showcase = Plan("showcase", Waypoint(1)) with { Source = ActionProgramSource.ShowcaseExample };
        var aethor = Plan("aethor", Waypoint(1)) with { ProfileId = "aethor-robo-dual-7dof" };
        var invalidWaypoint = Waypoint(1) with { PositionsDeg = [180, 0, 0, 0, 0, 0] };
        var invalidLimit = Plan("invalid-limit", invalidWaypoint);

        foreach (var plan in new[] { showcase, aethor, invalidLimit })
        {
            var handle = runner.Start(plan);
            Assert.False(handle.Accepted);
            Assert.Equal(ActionProgramRunStatus.Rejected, (await handle.Completion).Status);
        }

        Assert.Empty(port.Calls);
    }

    [Fact]
    public async Task DisposeRequestsTheSameBoundedStopPath()
    {
        var port = new FakeActionProgramCommandPort();
        var delay = new BlockingActionProgramDelay();
        var runner = Runner(port, delay: delay);
        var plan = Plan("dispose-stop", Waypoint(1, waitMs: 5_000));
        var handle = runner.Start(plan);
        await delay.Entered.Task.WaitAsync(TimeSpan.FromSeconds(1));

        await runner.DisposeAsync();
        var result = await handle.Completion;

        Assert.Equal(ActionProgramRunStatus.Stopped, result.Status);
        Assert.True(result.SafeStopConfirmed);
        Assert.Equal(["mode:1", "joint:1", "stop"], port.Calls.ToArray());
    }

    private const string SessionId = "session-action-test";

    private static ActionProgramRunner Runner(
        FakeActionProgramCommandPort port,
        ActionProgramRunnerOptions? options = null,
        IActionProgramDelay? delay = null) =>
        new(
            port,
            options ?? new()
            {
                CommandAwaitTimeout = TimeSpan.FromSeconds(1),
                StopAwaitTimeout = TimeSpan.FromSeconds(1)
            },
            delay: delay);

    private static ActionProgramExecutionPlan Plan(
        string runId,
        params ActionProgramExecutionWaypoint[] waypoints) =>
        new(
            runId,
            "11111111-1111-1111-1111-111111111111",
            3,
            SessionId,
            GatewayContractV1.DummyProfileId,
            ActionProgramSource.Authored,
            5,
            waypoints);

    private static ActionProgramExecutionWaypoint Waypoint(
        int index,
        int mode = 1,
        int waitMs = 0) =>
        new(
            $"00000000-0000-0000-0000-{index:D12}",
            $"Point {index}",
            [index, 0, 0, 0, 0, 0],
            mode,
            waitMs,
            ActionWaypointSource.Manual);

    private static CommandResult Confirmed(string commandId, string sessionId, RobotCommandKind kind) =>
        Result(
            commandId,
            sessionId,
            kind,
            CommandStatus.Completed,
            CommandResultCode.Ok,
            CommandEvidence.FeedbackConfirmed);

    private static CommandResult Result(
        string commandId,
        string sessionId,
        RobotCommandKind kind,
        CommandStatus status,
        CommandResultCode code,
        CommandEvidence evidence) =>
        new(commandId, sessionId, kind, status, code, evidence, "fake", DateTimeOffset.UtcNow);

    private sealed class FakeActionProgramCommandPort : IActionProgramCommandPort
    {
        public ConcurrentQueue<string> Calls { get; } = new();
        public Func<SetModeCommand, CancellationToken, Task<CommandResult>>? SetModeHandler { get; init; }
        public Func<JointGroupCommand, CancellationToken, Task<CommandResult>>? JointGroupHandler { get; init; }
        public Func<SimpleRobotCommand, CancellationToken, Task<CommandResult>>? StopHandler { get; init; }

        public Task<CommandResult> SetModeAsync(SetModeCommand command, CancellationToken cancellationToken)
        {
            Calls.Enqueue($"mode:{command.Mode}");
            return SetModeHandler?.Invoke(command, cancellationToken)
                ?? Task.FromResult(Confirmed(command.CommandId, command.SessionId, RobotCommandKind.SetMode));
        }

        public Task<CommandResult> SendJointGroupAsync(
            JointGroupCommand command,
            CancellationToken cancellationToken)
        {
            var index = int.Parse(
                command.CommandId.AsSpan(command.CommandId.IndexOf("-wp-", StringComparison.Ordinal) + 4, 3),
                System.Globalization.CultureInfo.InvariantCulture);
            Calls.Enqueue($"joint:{index}");
            return JointGroupHandler?.Invoke(command, cancellationToken)
                ?? Task.FromResult(Confirmed(command.CommandId, command.SessionId, RobotCommandKind.JointGroup));
        }

        public Task<CommandResult> StopAndDisableAsync(
            SimpleRobotCommand command,
            CancellationToken cancellationToken)
        {
            Calls.Enqueue("stop");
            return StopHandler?.Invoke(command, cancellationToken)
                ?? Task.FromResult(Confirmed(command.CommandId, command.SessionId, RobotCommandKind.StopAndDisable));
        }
    }

    private sealed class RecordingActionProgramDelay : IActionProgramDelay
    {
        public ConcurrentQueue<TimeSpan> Durations { get; } = new();

        public Task DelayAsync(TimeSpan duration, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            Durations.Enqueue(duration);
            return Task.CompletedTask;
        }
    }

    private sealed class BlockingActionProgramDelay : IActionProgramDelay
    {
        public TaskCompletionSource Entered { get; } =
            new(TaskCreationOptions.RunContinuationsAsynchronously);

        public async Task DelayAsync(TimeSpan duration, CancellationToken cancellationToken)
        {
            Entered.TrySetResult();
            await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
        }
    }

    private sealed class ThrowingActionProgramDelay : IActionProgramDelay
    {
        public Task DelayAsync(TimeSpan duration, CancellationToken cancellationToken) =>
            Task.FromException(new InvalidOperationException("fake delay failure"));
    }
}
