using System.Buffers.Binary;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using AethorStudioV2.Domain;

namespace AethorStudioV2.Application;

public sealed record ActionProgramRunnerOptions
{
    public TimeSpan CommandAwaitTimeout { get; init; } = TimeSpan.FromSeconds(130);
    public TimeSpan StopAwaitTimeout { get; init; } = TimeSpan.FromSeconds(10);

    public void Validate()
    {
        if (CommandAwaitTimeout < TimeSpan.FromMilliseconds(100)
            || CommandAwaitTimeout > TimeSpan.FromMinutes(3))
        {
            throw new ArgumentOutOfRangeException(
                nameof(CommandAwaitTimeout),
                "Command await timeout must be between 100 ms and 3 minutes");
        }

        if (StopAwaitTimeout < TimeSpan.FromMilliseconds(100)
            || StopAwaitTimeout > TimeSpan.FromSeconds(30))
        {
            throw new ArgumentOutOfRangeException(
                nameof(StopAwaitTimeout),
                "Stop await timeout must be between 100 ms and 30 seconds");
        }
    }
}

public sealed record ActionProgramRunHandle(
    string RunId,
    bool Accepted,
    IReadOnlyList<string> Errors,
    Task<ActionProgramRunResult> Completion);

public sealed partial class ActionProgramRunner : IAsyncDisposable
{
    private const int MaximumWaypointCount = 256;
    private const int MaximumPostArrivalWaitMs = 600_000;
    private readonly object stateGate = new();
    private readonly IActionProgramCommandPort commandPort;
    private readonly IActionProgramDelay delay;
    private readonly ActionProgramRunnerOptions options;
    private readonly TimeProvider timeProvider;
    private ActiveRun? activeRun;
    private bool disposed;

    public ActionProgramRunner(
        IActionProgramCommandPort commandPort,
        ActionProgramRunnerOptions options,
        TimeProvider? timeProvider = null,
        IActionProgramDelay? delay = null)
    {
        ArgumentNullException.ThrowIfNull(commandPort);
        ArgumentNullException.ThrowIfNull(options);
        options.Validate();
        this.commandPort = commandPort;
        this.options = options;
        this.timeProvider = timeProvider ?? TimeProvider.System;
        this.delay = delay ?? new SystemActionProgramDelay(this.timeProvider);
    }

    public string? ActiveRunId
    {
        get
        {
            lock (stateGate)
            {
                return activeRun?.RunId;
            }
        }
    }

    public ActionProgramRunHandle Start(
        ActionProgramExecutionPlan plan,
        ActionProgramResumeCheckpoint? resumeCheckpoint = null)
    {
        ObjectDisposedException.ThrowIf(disposed, this);
        ArgumentNullException.ThrowIfNull(plan);

        var executionPlan = SnapshotPlan(plan);
        var fingerprint = ComputePlanFingerprint(executionPlan);
        var validationErrors = ValidatePlan(executionPlan, fingerprint, resumeCheckpoint);
        if (validationErrors.Count > 0)
        {
            return RejectedHandle(executionPlan, ActionProgramRunCode.InvalidPlan, validationErrors);
        }

        ActiveRun ownedRun;
        lock (stateGate)
        {
            ObjectDisposedException.ThrowIf(disposed, this);
            if (activeRun is not null)
            {
                return RejectedHandle(
                    plan,
                    ActionProgramRunCode.RunnerBusy,
                    ["已有动作运行持有执行器；并发运行被拒绝。"]);
            }

            ownedRun = new ActiveRun(executionPlan.RunId);
            activeRun = ownedRun;
        }

        _ = RunOwnedAsync(ownedRun, executionPlan, fingerprint, resumeCheckpoint);
        return new(executionPlan.RunId, true, [], ownedRun.Completion.Task);
    }

    public bool RequestStop(string runId)
    {
        if (string.IsNullOrWhiteSpace(runId))
        {
            return false;
        }

        lock (stateGate)
        {
            if (activeRun is null || !string.Equals(activeRun.RunId, runId, StringComparison.Ordinal))
            {
                return false;
            }

            activeRun.StopCancellation.Cancel();
            return true;
        }
    }

    public async ValueTask DisposeAsync()
    {
        ActiveRun? run;
        lock (stateGate)
        {
            if (disposed)
            {
                return;
            }

            disposed = true;
            run = activeRun;
            run?.StopCancellation.Cancel();
        }

        if (run is not null)
        {
            await run.Completion.Task.ConfigureAwait(false);
        }
    }

    private async Task RunOwnedAsync(
        ActiveRun ownedRun,
        ActionProgramExecutionPlan plan,
        string fingerprint,
        ActionProgramResumeCheckpoint? resumeCheckpoint)
    {
        ActionProgramRunResult result;
        try
        {
            result = await RunCoreAsync(
                plan,
                fingerprint,
                resumeCheckpoint,
                ownedRun.StopCancellation.Token).ConfigureAwait(false);
        }
        catch (Exception)
        {
            var now = timeProvider.GetUtcNow();
            result = new(
                plan.RunId,
                plan.ProgramId,
                plan.Revision,
                plan.SessionId,
                plan.ProfileId,
                ActionProgramRunStatus.Failed,
                ActionProgramRunCode.CommandTransportFailure,
                "动作执行内核发生未预期故障；物理结果未知，必须现场复核。",
                now,
                now,
                [],
                null,
                null,
                false);
        }

        lock (stateGate)
        {
            if (ReferenceEquals(activeRun, ownedRun))
            {
                activeRun = null;
            }
        }

        ownedRun.StopCancellation.Dispose();
        ownedRun.Completion.TrySetResult(result);
    }

    private async Task<ActionProgramRunResult> RunCoreAsync(
        ActionProgramExecutionPlan plan,
        string fingerprint,
        ActionProgramResumeCheckpoint? resumeCheckpoint,
        CancellationToken stopToken)
    {
        var startedAt = timeProvider.GetUtcNow();
        var records = new List<ActionWaypointExecutionRecord>(plan.Waypoints.Count);
        var firstWaypointIndex = resumeCheckpoint is null
            ? 0
            : resumeCheckpoint.LastConfirmedWaypointIndex + 1;
        var lastConfirmedWaypointIndex = firstWaypointIndex - 1;
        int? confirmedMode = null;
        var commandOwnershipStarted = false;

        try
        {
            for (var index = firstWaypointIndex; index < plan.Waypoints.Count; index += 1)
            {
                stopToken.ThrowIfCancellationRequested();
                var waypoint = plan.Waypoints[index];
                records.Add(new(index, waypoint.WaypointId, null, null, null, null, false, null));
                var recordIndex = records.Count - 1;

                if (confirmedMode != waypoint.Mode)
                {
                    var commandId = CommandId(plan.RunId, index, "mode");
                    records[recordIndex] = records[recordIndex] with { ModeCommandId = commandId };
                    commandOwnershipStarted = true;
                    var modeResult = await ExecuteCommandAsync(
                        commandId,
                        plan.SessionId,
                        RobotCommandKind.SetMode,
                        cancellationToken => commandPort.SetModeAsync(
                            new(commandId, plan.SessionId, plan.ProfileId, waypoint.Mode),
                            cancellationToken),
                        stopToken).ConfigureAwait(false);
                    records[recordIndex] = records[recordIndex] with { ModeResult = modeResult };
                    if (!IsFeedbackConfirmed(modeResult, commandId, plan.SessionId, RobotCommandKind.SetMode))
                    {
                        return await FailAndStopAsync(
                            plan,
                            fingerprint,
                            startedAt,
                            records,
                            lastConfirmedWaypointIndex,
                            FailureCode(modeResult),
                            $"点位 {index + 1} 的模式确认失败；未发送该点关节目标。",
                            commandOwnershipStarted).ConfigureAwait(false);
                    }

                    stopToken.ThrowIfCancellationRequested();
                    confirmedMode = waypoint.Mode;
                }

                var jointCommandId = CommandId(plan.RunId, index, "joint");
                records[recordIndex] = records[recordIndex] with { JointGroupCommandId = jointCommandId };
                commandOwnershipStarted = true;
                var jointResult = await ExecuteCommandAsync(
                    jointCommandId,
                    plan.SessionId,
                    RobotCommandKind.JointGroup,
                    cancellationToken => commandPort.SendJointGroupAsync(
                        new(
                            jointCommandId,
                            plan.SessionId,
                            plan.ProfileId,
                            waypoint.PositionsDeg,
                            plan.SpeedDegS),
                        cancellationToken),
                    stopToken).ConfigureAwait(false);
                records[recordIndex] = records[recordIndex] with { JointGroupResult = jointResult };
                if (!IsFeedbackConfirmed(jointResult, jointCommandId, plan.SessionId, RobotCommandKind.JointGroup))
                {
                    return await FailAndStopAsync(
                        plan,
                        fingerprint,
                        startedAt,
                        records,
                        lastConfirmedWaypointIndex,
                        FailureCode(jointResult),
                        $"点位 {index + 1} 未取得 completed + feedbackConfirmed；序列已终止。",
                        commandOwnershipStarted).ConfigureAwait(false);
                }

                var confirmedAt = timeProvider.GetUtcNow();
                records[recordIndex] = records[recordIndex] with
                {
                    FeedbackConfirmed = true,
                    ConfirmedAtUtc = confirmedAt
                };
                lastConfirmedWaypointIndex = index;

                if (waypoint.PostArrivalWaitMs > 0)
                {
                    await delay.DelayAsync(
                        TimeSpan.FromMilliseconds(waypoint.PostArrivalWaitMs),
                        stopToken).ConfigureAwait(false);
                }
            }

            stopToken.ThrowIfCancellationRequested();
            return CreateResult(
                plan,
                fingerprint,
                startedAt,
                ActionProgramRunStatus.Completed,
                ActionProgramRunCode.Ok,
                "所有点位均已逐点取得实测到位确认。",
                records,
                lastConfirmedWaypointIndex,
                null,
                null);
        }
        catch (OperationCanceledException) when (stopToken.IsCancellationRequested)
        {
            if (!commandOwnershipStarted)
            {
                return CreateResult(
                    plan,
                    fingerprint,
                    startedAt,
                    ActionProgramRunStatus.Stopped,
                    ActionProgramRunCode.OperatorStopped,
                    "动作在任何网关命令接管前停止；未发送停止命令。",
                    records,
                    lastConfirmedWaypointIndex,
                    null,
                    null);
            }

            var stopResult = await TryStopAsync(plan).ConfigureAwait(false);
            var stopConfirmed = IsFeedbackConfirmed(
                stopResult,
                StopCommandId(plan.RunId),
                plan.SessionId,
                RobotCommandKind.StopAndDisable);
            return CreateResult(
                plan,
                fingerprint,
                startedAt,
                stopConfirmed ? ActionProgramRunStatus.Stopped : ActionProgramRunStatus.Failed,
                stopConfirmed ? ActionProgramRunCode.OperatorStopped : ActionProgramRunCode.StopUnconfirmed,
                stopConfirmed
                    ? "操作者停止已取得 stop-and-disable 实测确认。"
                    : "停止结果未确认；必须立即使用物理急停并现场复核。",
                records,
                lastConfirmedWaypointIndex,
                stopResult,
                stopConfirmed);
        }
        catch (Exception)
        {
            return await FailAndStopAsync(
                plan,
                fingerprint,
                startedAt,
                records,
                lastConfirmedWaypointIndex,
                ActionProgramRunCode.CommandTransportFailure,
                "动作执行内部步骤失败；序列已终止。",
                commandOwnershipStarted).ConfigureAwait(false);
        }
    }

    private async Task<ActionProgramRunResult> FailAndStopAsync(
        ActionProgramExecutionPlan plan,
        string fingerprint,
        DateTimeOffset startedAt,
        IReadOnlyList<ActionWaypointExecutionRecord> records,
        int lastConfirmedWaypointIndex,
        ActionProgramRunCode code,
        string message,
        bool commandOwnershipStarted)
    {
        var stopResult = commandOwnershipStarted ? await TryStopAsync(plan).ConfigureAwait(false) : null;
        bool? stopConfirmed = stopResult is null
            ? null
            : IsFeedbackConfirmed(
                stopResult,
                StopCommandId(plan.RunId),
                plan.SessionId,
                RobotCommandKind.StopAndDisable);
        return CreateResult(
            plan,
            fingerprint,
            startedAt,
            ActionProgramRunStatus.Failed,
            code,
            stopConfirmed is false
                ? $"{message} 自动停止未确认；必须使用物理急停并现场复核。"
                : message,
            records,
            lastConfirmedWaypointIndex,
            stopResult,
            stopConfirmed);
    }

    private async Task<CommandResult> ExecuteCommandAsync(
        string commandId,
        string sessionId,
        RobotCommandKind commandKind,
        Func<CancellationToken, Task<CommandResult>> execute,
        CancellationToken cancellationToken)
    {
        try
        {
            var result = await execute(cancellationToken)
                .WaitAsync(options.CommandAwaitTimeout, cancellationToken)
                .ConfigureAwait(false);
            return HasExpectedIdentity(result, commandId, sessionId, commandKind)
                ? result
                : SyntheticResult(
                    commandId,
                    sessionId,
                    commandKind,
                    CommandStatus.Unconfirmed,
                    CommandResultCode.TransportError,
                    "网关结果身份与执行请求不一致；物理结果未知。");
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (TimeoutException)
        {
            return SyntheticResult(
                commandId,
                sessionId,
                commandKind,
                CommandStatus.TimedOut,
                CommandResultCode.Timeout,
                "等待网关命令终态超时；物理结果未知。");
        }
        catch (Exception)
        {
            return SyntheticResult(
                commandId,
                sessionId,
                commandKind,
                CommandStatus.Unconfirmed,
                CommandResultCode.TransportError,
                "网关命令调用失败；物理结果未知。");
        }
    }

    private async Task<CommandResult> TryStopAsync(ActionProgramExecutionPlan plan)
    {
        var commandId = StopCommandId(plan.RunId);
        using var stopCancellation = new CancellationTokenSource(options.StopAwaitTimeout);
        try
        {
            var result = await commandPort.StopAndDisableAsync(
                    new(commandId, plan.SessionId, plan.ProfileId),
                    stopCancellation.Token)
                .WaitAsync(options.StopAwaitTimeout, CancellationToken.None)
                .ConfigureAwait(false);
            return HasExpectedIdentity(result, commandId, plan.SessionId, RobotCommandKind.StopAndDisable)
                ? result
                : SyntheticResult(
                    commandId,
                    plan.SessionId,
                    RobotCommandKind.StopAndDisable,
                    CommandStatus.Unconfirmed,
                    CommandResultCode.TransportError,
                    "停止结果身份不匹配；物理停止状态未知。");
        }
        catch (TimeoutException)
        {
            return SyntheticResult(
                commandId,
                plan.SessionId,
                RobotCommandKind.StopAndDisable,
                CommandStatus.Unconfirmed,
                CommandResultCode.Timeout,
                "等待停止终态超时；必须使用物理急停。");
        }
        catch (OperationCanceledException) when (stopCancellation.IsCancellationRequested)
        {
            return SyntheticResult(
                commandId,
                plan.SessionId,
                RobotCommandKind.StopAndDisable,
                CommandStatus.Unconfirmed,
                CommandResultCode.Timeout,
                "等待停止终态超时；必须使用物理急停。");
        }
        catch (Exception)
        {
            return SyntheticResult(
                commandId,
                plan.SessionId,
                RobotCommandKind.StopAndDisable,
                CommandStatus.Unconfirmed,
                CommandResultCode.TransportError,
                "停止调用失败；必须使用物理急停。");
        }
    }

    private CommandResult SyntheticResult(
        string commandId,
        string sessionId,
        RobotCommandKind commandKind,
        CommandStatus status,
        CommandResultCode code,
        string message) =>
        new(
            commandId,
            sessionId,
            commandKind,
            status,
            code,
            CommandEvidence.None,
            message,
            timeProvider.GetUtcNow());

    private ActionProgramRunResult CreateResult(
        ActionProgramExecutionPlan plan,
        string fingerprint,
        DateTimeOffset startedAt,
        ActionProgramRunStatus status,
        ActionProgramRunCode code,
        string message,
        IReadOnlyList<ActionWaypointExecutionRecord> records,
        int lastConfirmedWaypointIndex,
        CommandResult? stopResult,
        bool? safeStopConfirmed)
    {
        ActionProgramResumeCheckpoint? checkpoint = null;
        if (status != ActionProgramRunStatus.Completed && lastConfirmedWaypointIndex >= 0)
        {
            var waypoint = plan.Waypoints[lastConfirmedWaypointIndex];
            checkpoint = new(
                plan.ProgramId,
                plan.Revision,
                plan.SessionId,
                plan.ProfileId,
                fingerprint,
                lastConfirmedWaypointIndex,
                waypoint.WaypointId);
        }

        return new(
            plan.RunId,
            plan.ProgramId,
            plan.Revision,
            plan.SessionId,
            plan.ProfileId,
            status,
            code,
            message,
            startedAt,
            timeProvider.GetUtcNow(),
            [.. records],
            checkpoint,
            stopResult,
            safeStopConfirmed);
    }

    private ActionProgramRunHandle RejectedHandle(
        ActionProgramExecutionPlan plan,
        ActionProgramRunCode code,
        IReadOnlyList<string> errors)
    {
        var now = timeProvider.GetUtcNow();
        var result = new ActionProgramRunResult(
            plan.RunId,
            plan.ProgramId,
            plan.Revision,
            plan.SessionId,
            plan.ProfileId,
            ActionProgramRunStatus.Rejected,
            code,
            string.Join(" ", errors),
            now,
            now,
            [],
            null,
            null,
            null);
        return new(plan.RunId, false, errors, Task.FromResult(result));
    }

    private static List<string> ValidatePlan(
        ActionProgramExecutionPlan plan,
        string fingerprint,
        ActionProgramResumeCheckpoint? checkpoint)
    {
        var errors = new List<string>();
        if (!RunIdPattern().IsMatch(plan.RunId))
        {
            errors.Add("runId 必须为 1–64 个字母、数字、点、下划线或连字符，并以字母或数字开头。");
        }

        if (!Guid.TryParse(plan.ProgramId, out _))
        {
            errors.Add("programId 必须为 UUID。");
        }

        if (plan.Revision < 1)
        {
            errors.Add("revision 必须大于等于 1。");
        }

        if (string.IsNullOrWhiteSpace(plan.SessionId)
            || plan.SessionId.Length > 128
            || plan.SessionId.Any(char.IsControl))
        {
            errors.Add("sessionId 必须为 1–128 个非控制字符。");
        }

        if (!string.Equals(plan.ProfileId, GatewayContractV1.DummyProfileId, StringComparison.Ordinal))
        {
            errors.Add("当前执行内核只接受 dummy-6dof；Aethor_robo 协议尚未定义。");
        }

        if (plan.Source == ActionProgramSource.ShowcaseExample)
        {
            errors.Add("SHOWCASE 动作程序不可执行。");
        }

        if (!double.IsFinite(plan.SpeedDegS) || plan.SpeedDegS <= 0)
        {
            errors.Add("speedDegS 必须为显式有限正数；上限仍由网关 capability 重复校验。");
        }

        if (plan.Waypoints.Count is < 1 or > MaximumWaypointCount)
        {
            errors.Add($"动作运行必须包含 1–{MaximumWaypointCount} 个点位。");
        }

        var waypointIds = new HashSet<string>(StringComparer.Ordinal);
        for (var index = 0; index < plan.Waypoints.Count; index += 1)
        {
            var waypoint = plan.Waypoints[index];
            if (!Guid.TryParse(waypoint.WaypointId, out _) || !waypointIds.Add(waypoint.WaypointId))
            {
                errors.Add($"点位 {index + 1} 的 waypointId 必须为唯一 UUID。");
            }

            if (string.IsNullOrWhiteSpace(waypoint.Name) || waypoint.Name.Length > 80)
            {
                errors.Add($"点位 {index + 1} 名称必须为 1–80 个字符。");
            }

            if (waypoint.Source == ActionWaypointSource.ShowcaseExample)
            {
                errors.Add($"点位 {index + 1} 为 SHOWCASE 来源，不可执行。");
            }

            if (waypoint.Mode is < 1 or > 3)
            {
                errors.Add($"点位 {index + 1} 的模式必须为 1–3。");
            }

            if (waypoint.PostArrivalWaitMs is < 0 or > MaximumPostArrivalWaitMs)
            {
                errors.Add($"点位 {index + 1} 的到位后等待必须为 0–{MaximumPostArrivalWaitMs} ms。");
            }

            if (waypoint.PositionsDeg.Count != DummyJointLimits.All.Count)
            {
                errors.Add($"点位 {index + 1} 必须包含恰好六个关节角。");
                continue;
            }

            for (var jointIndex = 0; jointIndex < waypoint.PositionsDeg.Count; jointIndex += 1)
            {
                var value = waypoint.PositionsDeg[jointIndex];
                if (!double.IsFinite(value))
                {
                    errors.Add($"点位 {index + 1} 的 J{jointIndex + 1} 必须是有限设备角。");
                }
            }
        }

        if (checkpoint is not null)
        {
            var checkpointMatches = string.Equals(checkpoint.ProgramId, plan.ProgramId, StringComparison.Ordinal)
                && checkpoint.Revision == plan.Revision
                && string.Equals(checkpoint.SessionId, plan.SessionId, StringComparison.Ordinal)
                && string.Equals(checkpoint.ProfileId, plan.ProfileId, StringComparison.Ordinal)
                && string.Equals(checkpoint.PlanFingerprintSha256, fingerprint, StringComparison.Ordinal)
                && checkpoint.LastConfirmedWaypointIndex >= 0
                && checkpoint.LastConfirmedWaypointIndex < plan.Waypoints.Count
                && string.Equals(
                    checkpoint.LastConfirmedWaypointId,
                    plan.Waypoints[checkpoint.LastConfirmedWaypointIndex].WaypointId,
                    StringComparison.Ordinal);
            if (!checkpointMatches)
            {
                errors.Add("恢复 checkpoint 与当前 program revision、session 或执行计划指纹不一致。");
            }
        }

        return errors;
    }

    private static ActionProgramRunCode FailureCode(CommandResult result) => result switch
    {
        { Status: CommandStatus.TimedOut } => ActionProgramRunCode.CommandAwaitTimedOut,
        { Status: CommandStatus.Unconfirmed, Code: CommandResultCode.TransportError } =>
            ActionProgramRunCode.CommandTransportFailure,
        _ => ActionProgramRunCode.WaypointCommandFailed
    };

    private static bool IsFeedbackConfirmed(
        CommandResult result,
        string commandId,
        string sessionId,
        RobotCommandKind commandKind) =>
        HasExpectedIdentity(result, commandId, sessionId, commandKind)
        && result.Status == CommandStatus.Completed
        && result.Code == CommandResultCode.Ok
        && result.Evidence == CommandEvidence.FeedbackConfirmed;

    private static bool HasExpectedIdentity(
        CommandResult result,
        string commandId,
        string sessionId,
        RobotCommandKind commandKind) =>
        string.Equals(result.CommandId, commandId, StringComparison.Ordinal)
        && string.Equals(result.SessionId, sessionId, StringComparison.Ordinal)
        && result.CommandKind == commandKind;

    private static string CommandId(string runId, int waypointIndex, string operation) =>
        $"action-{runId}-wp-{waypointIndex + 1:D3}-{operation}";

    private static string StopCommandId(string runId) => $"action-{runId}-stop";

    private static ActionProgramExecutionPlan SnapshotPlan(ActionProgramExecutionPlan plan) =>
        plan with
        {
            Waypoints = plan.Waypoints
                .Select(waypoint => waypoint with { PositionsDeg = [.. waypoint.PositionsDeg] })
                .ToArray()
        };

    private static string ComputePlanFingerprint(ActionProgramExecutionPlan plan)
    {
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        AppendHashValue(hash, plan.ProgramId);
        AppendHashValue(hash, plan.Revision.ToString(CultureInfo.InvariantCulture));
        AppendHashValue(hash, plan.ProfileId);
        AppendHashValue(hash, plan.Source.ToString());
        AppendHashValue(hash, plan.SpeedDegS.ToString("R", CultureInfo.InvariantCulture));
        AppendHashValue(hash, plan.Waypoints.Count.ToString(CultureInfo.InvariantCulture));
        foreach (var waypoint in plan.Waypoints)
        {
            AppendHashValue(hash, waypoint.WaypointId);
            AppendHashValue(hash, waypoint.Name);
            AppendHashValue(hash, waypoint.Mode.ToString(CultureInfo.InvariantCulture));
            AppendHashValue(hash, waypoint.PostArrivalWaitMs.ToString(CultureInfo.InvariantCulture));
            AppendHashValue(hash, waypoint.Source.ToString());
            AppendHashValue(hash, waypoint.PositionsDeg.Count.ToString(CultureInfo.InvariantCulture));
            foreach (var position in waypoint.PositionsDeg)
            {
                AppendHashValue(hash, position.ToString("R", CultureInfo.InvariantCulture));
            }
        }

        return Convert.ToHexStringLower(hash.GetHashAndReset());
    }

    private static void AppendHashValue(IncrementalHash hash, string value)
    {
        var bytes = Encoding.UTF8.GetBytes(value);
        Span<byte> length = stackalloc byte[sizeof(int)];
        BinaryPrimitives.WriteInt32LittleEndian(length, bytes.Length);
        hash.AppendData(length);
        hash.AppendData(bytes);
    }

    [GeneratedRegex("^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$", RegexOptions.CultureInvariant)]
    private static partial Regex RunIdPattern();

    private sealed class ActiveRun(string runId)
    {
        public string RunId { get; } = runId;
        public CancellationTokenSource StopCancellation { get; } = new();
        public TaskCompletionSource<ActionProgramRunResult> Completion { get; } =
            new(TaskCreationOptions.RunContinuationsAsynchronously);
    }

    private sealed class SystemActionProgramDelay(TimeProvider timeProvider) : IActionProgramDelay
    {
        public Task DelayAsync(TimeSpan duration, CancellationToken cancellationToken) =>
            Task.Delay(duration, timeProvider, cancellationToken);
    }
}
