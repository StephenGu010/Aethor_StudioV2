using AethorStudioV2.Domain;

namespace AethorStudioV2.Application;

public sealed record EngineeringActionProgramRunHandle(
    ActionProgramRunSnapshot InitialSnapshot,
    Task<ActionProgramRunSnapshot> Completion);

public sealed class EngineeringActionProgramRuntime : IAsyncDisposable
{
    private const int MaximumWaypoints = 256;
    private const int MaximumPostDispatchWaitMs = 600_000;
    private readonly object stateGate = new();
    private readonly object publishGate = new();
    private readonly IEngineeringActionProgramCommandPort commandPort;
    private readonly IActionProgramDelay delay;
    private readonly IActionProgramRunEventSink eventSink;
    private readonly TimeProvider timeProvider;
    private ActiveRun? activeRun;
    private ActionProgramRunSnapshot? latestSnapshot;
    private ActionProgramRunSnapshot? pendingPublication;
    private bool publicationPumpRunning;
    private bool disposed;

    public EngineeringActionProgramRuntime(
        IEngineeringActionProgramCommandPort commandPort,
        IActionProgramRunEventSink? eventSink = null,
        TimeProvider? timeProvider = null,
        IActionProgramDelay? delay = null)
    {
        this.commandPort = commandPort;
        this.eventSink = eventSink ?? new NullActionProgramRunEventSink();
        this.timeProvider = timeProvider ?? TimeProvider.System;
        this.delay = delay ?? new SystemActionProgramDelay(this.timeProvider);
        this.commandPort.SessionTerminated += HandleSessionTerminated;
    }

    public ActionProgramRunSnapshot? GetSnapshot()
    {
        lock (stateGate)
        {
            return latestSnapshot;
        }
    }

    public bool IsActive
    {
        get
        {
            lock (stateGate) return activeRun is not null;
        }
    }

    public EngineeringActionProgramRunHandle Start(ActionProgramRunStartRequest request)
    {
        ValidateRequestShape(request);
        var snapshotRequest = SnapshotRequest(request);

        lock (stateGate)
        {
            ObjectDisposedException.ThrowIf(disposed, this);
            if (activeRun is not null) throw new GatewayConflictException("已有动作程序正在运行");

            var validationError = ValidateRuntimePreconditions(snapshotRequest, out var initialPositionsDeg);
            if (validationError is not null)
            {
                return RejectedHandleLocked(snapshotRequest, validationError);
            }

            if (!commandPort.TryBeginActionRun(snapshotRequest.RunId, snapshotRequest.SessionId))
            {
                return RejectedHandleLocked(snapshotRequest, "串口命令所有权已被其他任务占用");
            }

            var now = NextSnapshotTimestampLocked();
            var initial = CreateSnapshot(
                snapshotRequest,
                ActionProgramRuntimeState.Starting,
                null,
                0,
                null,
                CommandEvidence.None,
                "动作程序已交给网关；尚未写入首个点位",
                now,
                now,
                null);
            var run = new ActiveRun(
                snapshotRequest,
                initial,
                initialPositionsDeg,
                Guid.NewGuid().ToString("N"));
            activeRun = run;
            latestSnapshot = initial;
            QueuePublication(initial);
            run.Runner = RunAsync(run);
            return new(initial, run.Completion.Task);
        }
    }

    public async Task<ActionProgramRunSnapshot> StopAsync(string reason)
    {
        ActiveRun run;
        lock (stateGate)
        {
            ObjectDisposedException.ThrowIf(disposed, this);
            run = activeRun ?? throw new GatewayConflictException("没有正在运行的动作程序");
            UpdateSnapshotLocked(run, run.Snapshot with
            {
                State = ActionProgramRuntimeState.Stopping,
                Message = string.IsNullOrWhiteSpace(reason) ? "操作员请求停止" : $"操作员请求停止：{reason}",
                UpdatedAtUtc = timeProvider.GetUtcNow()
            });
            run.Cancellation.Cancel();
        }

        return await run.Completion.Task.ConfigureAwait(false);
    }

    public async ValueTask DisposeAsync()
    {
        commandPort.SessionTerminated -= HandleSessionTerminated;
        ActiveRun? run;
        lock (stateGate)
        {
            if (disposed) return;
            disposed = true;
            run = activeRun;
            run?.Cancellation.Cancel();
        }

        if (run is not null)
        {
            await run.Completion.Task.ConfigureAwait(false);
        }
    }

    private async Task RunAsync(ActiveRun run)
    {
        ActionProgramRunSnapshot terminal;
        try
        {
            terminal = await RunCoreAsync(run).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (run.Cancellation.IsCancellationRequested)
        {
            terminal = await StopTransportAsync(
                run,
                run.CancellationTerminalMessage ?? "动作程序已停止；未确认物理停止或去使能").ConfigureAwait(false);
        }
        catch (Exception exception)
        {
            terminal = await StopTransportAsync(run, $"动作程序失败：{SafeMessage(exception)}").ConfigureAwait(false);
            if (terminal.State == ActionProgramRuntimeState.StoppedUnconfirmed)
            {
                terminal = terminal with
                {
                    State = ActionProgramRuntimeState.Failed,
                    Message = $"动作程序失败并已写入停止链；物理状态未确认：{SafeMessage(exception)}"
                };
            }
        }
        try
        {
            commandPort.EndActionRun(run.Request.RunId);
        }
        catch (Exception exception)
        {
            terminal = terminal with
            {
                State = ActionProgramRuntimeState.Failed,
                PhysicalCompletionConfirmed = false,
                Message = $"{terminal.Message}；网关未能释放动作运行所有权：{SafeMessage(exception)}",
                UpdatedAtUtc = timeProvider.GetUtcNow(),
                FinishedAtUtc = terminal.FinishedAtUtc ?? timeProvider.GetUtcNow()
            };
        }

        lock (stateGate)
        {
            UpdateSnapshotLocked(run, terminal);
            terminal = run.Snapshot;
            if (ReferenceEquals(activeRun, run)) activeRun = null;
        }
        run.Cancellation.Dispose();
        run.Completion.TrySetResult(terminal);
    }

    private async Task<ActionProgramRunSnapshot> RunCoreAsync(ActiveRun run)
    {
        var previousPositions = run.InitialPositionsDeg.ToArray();
        var completedCycles = 0;
        UpdateSnapshot(run, run.Snapshot with
        {
            State = ActionProgramRuntimeState.Running,
            Message = "动作程序正在运行；进度只表示串口写入与估算等待",
            UpdatedAtUtc = timeProvider.GetUtcNow()
        });

        while (true)
        {
            for (var index = 0; index < run.Request.Waypoints.Count; index++)
            {
                run.Cancellation.Token.ThrowIfCancellationRequested();
                var waypoint = run.Request.Waypoints[index];
                var requestId = $"{run.Request.RunId}-{run.ExecutionNonce}-p{index}-c{completedCycles}";
                UpdateSnapshot(run, run.Snapshot with
                {
                    State = ActionProgramRuntimeState.Running,
                    CurrentWaypointIndex = index,
                    LastRequestId = requestId,
                    LastEvidence = CommandEvidence.None,
                    Message = $"正在写入点位 {index + 1}/{run.Request.Waypoints.Count}",
                    UpdatedAtUtc = timeProvider.GetUtcNow()
                });

                var line = DummyAsciiProtocol.FormatJointGroup(waypoint.PositionsDeg, run.Request.SpeedDegS);
                var result = await commandPort.SendActionDirectAndAwaitTerminalAsync(
                    run.Request.RunId,
                    new DirectCommandRequest(
                        requestId,
                        run.Request.SessionId,
                        run.Request.ProfileId,
                        line),
                    run.Cancellation.Token).ConfigureAwait(false);
                if (result.Status != DirectCommandStatus.Sent
                    || result.Evidence != CommandEvidence.TransportWritten)
                {
                    throw new IOException($"点位 {index + 1} 未写入串口：{result.Status}");
                }

                var travelMs = EstimateTravelMilliseconds(previousPositions, waypoint.PositionsDeg, run.Request.SpeedDegS);
                var wait = TimeSpan.FromMilliseconds(travelMs + waypoint.PostDispatchWaitMs);
                UpdateSnapshot(run, run.Snapshot with
                {
                    LastRequestId = requestId,
                    LastEvidence = CommandEvidence.TransportWritten,
                    Message = $"点位 {index + 1} 已写入串口；等待 {wait.TotalMilliseconds:0} ms 后调度下一点，未确认到位",
                    UpdatedAtUtc = timeProvider.GetUtcNow()
                });
                await delay.DelayAsync(wait, run.Cancellation.Token).ConfigureAwait(false);
                previousPositions = waypoint.PositionsDeg.ToArray();
            }

            if (completedCycles == int.MaxValue)
            {
                throw new IOException("动作程序循环计数达到契约上限");
            }
            completedCycles += 1;
            UpdateSnapshot(run, run.Snapshot with
            {
                CompletedCycles = completedCycles,
                UpdatedAtUtc = timeProvider.GetUtcNow()
            });
            if (!run.Request.LoopEnabled)
            {
                var finishedAt = timeProvider.GetUtcNow();
                return run.Snapshot with
                {
                    State = ActionProgramRuntimeState.FinishedUnconfirmed,
                    CompletedCycles = completedCycles,
                    PhysicalCompletionConfirmed = false,
                    Message = "全部点位已写入串口；未等待固件队列号、最终 ok 或物理到位确认",
                    UpdatedAtUtc = finishedAt,
                    FinishedAtUtc = finishedAt
                };
            }
        }
    }

    private async Task<ActionProgramRunSnapshot> StopTransportAsync(ActiveRun run, string message)
    {
        var stop = await TrySendSafetyLineAsync(run, "stop", "!STOP").ConfigureAwait(false);
        var disable = await TrySendSafetyLineAsync(run, "disable", "!DISABLE").ConfigureAwait(false);
        var finishedAt = timeProvider.GetUtcNow();
        var transportWritten = stop.Status == DirectCommandStatus.Sent
            && stop.Evidence == CommandEvidence.TransportWritten
            && disable.Status == DirectCommandStatus.Sent
            && disable.Evidence == CommandEvidence.TransportWritten;
        return run.Snapshot with
        {
            State = transportWritten
                ? ActionProgramRuntimeState.StoppedUnconfirmed
                : ActionProgramRuntimeState.Failed,
            LastRequestId = disable.RequestId,
            LastEvidence = disable.Evidence,
            PhysicalCompletionConfirmed = false,
            Message = transportWritten
                ? message
                : $"{message}；停止链未全部写入串口",
            UpdatedAtUtc = finishedAt,
            FinishedAtUtc = finishedAt
        };
    }

    private Task<DirectCommandResult> SendSafetyLineAsync(ActiveRun run, string suffix, string line) =>
        commandPort.SendActionDirectAndAwaitTerminalAsync(
            run.Request.RunId,
            new DirectCommandRequest(
                $"{run.Request.RunId}-{run.ExecutionNonce}-{suffix}",
                run.Request.SessionId,
                run.Request.ProfileId,
                line),
            CancellationToken.None);

    private async Task<DirectCommandResult> TrySendSafetyLineAsync(ActiveRun run, string suffix, string line)
    {
        try
        {
            return await SendSafetyLineAsync(run, suffix, line).ConfigureAwait(false);
        }
        catch (Exception exception)
        {
            return new DirectCommandResult(
                $"{run.Request.RunId}-{suffix}",
                run.Request.SessionId,
                DirectCommandStatus.Failed,
                CommandEvidence.None,
                line,
                $"停止链串口写入失败：{SafeMessage(exception)}",
                timeProvider.GetUtcNow());
        }
    }

    private static void ValidateRequestShape(ActionProgramRunStartRequest request)
    {
        if (request.ContractVersion != ActionProgramRunContractV1.Version)
            throw new GatewayValidationException("不支持的动作运行契约版本");
        if (!ValidIdentifier(request.RunId, 64)
            || !ValidIdentifier(request.ProgramId, 128)
            || !ValidIdentifier(request.SessionId, 128))
            throw new GatewayValidationException("runId、programId 或 sessionId 非法");
        if (request.Revision < 1) throw new GatewayValidationException("revision 必须大于零");
        if (request.ProfileId != GatewayContractV1.DummyProfileId)
            throw new GatewayValidationException("engineering 动作运行只支持 dummy-6dof");
        if (request.Source != ActionProgramSource.Authored)
            throw new GatewayValidationException("动作运行请求必须来自 authored 文档");
        if (!double.IsFinite(request.SpeedDegS) || request.SpeedDegS <= 0 || request.SpeedDegS > 100)
            throw new GatewayValidationException("速度必须位于 0-100 deg/s");
        if (request.Waypoints is null || request.Waypoints.Count is < 1 or > MaximumWaypoints)
            throw new GatewayValidationException("动作程序必须包含 1-256 个点位");

        foreach (var waypoint in request.Waypoints)
        {
            if (waypoint is null
                || !ValidIdentifier(waypoint.WaypointId, 128)
                || string.IsNullOrWhiteSpace(waypoint.Name)
                || waypoint.Name.Length > 80)
                throw new GatewayValidationException("点位标识或名称非法");
            if (waypoint.Source is not (ActionWaypointSource.Manual or ActionWaypointSource.MeasuredCapture))
                throw new GatewayValidationException("动作运行请求不能包含 SHOWCASE 点位");
            if (waypoint.PositionsDeg is null
                || waypoint.PositionsDeg.Count != DummyAsciiProtocol.JointCount
                || waypoint.PositionsDeg.Any(value => !double.IsFinite(value)))
                throw new GatewayValidationException("每个点位必须包含六个有限设备角");
            if (waypoint.Mode is not (1 or 2 or 3))
                throw new GatewayValidationException("点位模式必须为 1、2 或 3");
            if (waypoint.PostDispatchWaitMs is < 0 or > MaximumPostDispatchWaitMs)
                throw new GatewayValidationException("点位附加等待必须位于 0-600000 ms");
        }
    }

    private string? ValidateRuntimePreconditions(ActionProgramRunStartRequest request, out double[] initialPositionsDeg)
    {
        initialPositionsDeg = [];
        if (request.SpeedDegS > commandPort.MaximumSpeedDegS)
            return $"速度必须位于 0-{commandPort.MaximumSpeedDegS:0.###} deg/s";

        var session = commandPort.GetSession();
        if (session.SessionId != request.SessionId || session.ProfileId != request.ProfileId) return "动作程序会话与当前连接不匹配";
        if (session.ConnectionState != ConnectionState.Connected || session.Validity != Validity.Valid) return "当前串口会话不是新鲜有效连接";
        if (session.MotorState != MotorState.Enabled) return "电机尚未确认使能";
        if (session.ControlMode is not (1 or 2 or 3)) return "当前控制模式不可用";

        var measured = commandPort.GetJointState();
        if (measured.ProfileId != request.ProfileId
            || measured.Source != DataSource.Measured
            || measured.Validity != Validity.Valid
            || measured.PositionsDeg.Count != DummyAsciiProtocol.JointCount
            || measured.PositionsDeg.Any(value => !double.IsFinite(value)))
            return "缺少新鲜有效的六轴 #GETJPOS 起始角";
        initialPositionsDeg = measured.PositionsDeg.ToArray();

        IReadOnlyList<double> previousPositionsDeg = initialPositionsDeg;
        for (var index = 0; index < request.Waypoints.Count; index++)
        {
            var waypoint = request.Waypoints[index];
            if (waypoint.Mode != session.ControlMode) return "全部点位模式必须与当前设备模式一致；使能状态下不会自动切换模式";
            try
            {
                _ = DummyAsciiProtocol.FormatJointGroup(waypoint.PositionsDeg, request.SpeedDegS);
            }
            catch (ArgumentException exception)
            {
                return $"点位 {index + 1} 无法编码：{exception.Message}";
            }
            if (!CanRepresentPacingWait(
                    previousPositionsDeg,
                    waypoint.PositionsDeg,
                    request.SpeedDegS,
                    waypoint.PostDispatchWaitMs))
            {
                return $"点位 {index + 1} 的调度等待时间超出运行器可表示范围";
            }
            previousPositionsDeg = waypoint.PositionsDeg;
        }
        return null;
    }

    private EngineeringActionProgramRunHandle RejectedHandleLocked(ActionProgramRunStartRequest request, string message)
    {
        var now = NextSnapshotTimestampLocked();
        var snapshot = CreateSnapshot(
            request,
            ActionProgramRuntimeState.Rejected,
            null,
            0,
            null,
            CommandEvidence.None,
            message,
            now,
            now,
            now);
        latestSnapshot = snapshot;
        QueuePublication(snapshot);
        return new(snapshot, Task.FromResult(snapshot));
    }

    private DateTimeOffset NextSnapshotTimestampLocked()
    {
        var now = timeProvider.GetUtcNow();
        if (latestSnapshot is null || now > latestSnapshot.UpdatedAtUtc) return now;
        return latestSnapshot.UpdatedAtUtc == DateTimeOffset.MaxValue
            ? DateTimeOffset.MaxValue
            : latestSnapshot.UpdatedAtUtc.AddTicks(1);
    }

    private void HandleSessionTerminated(string reason)
    {
        lock (stateGate)
        {
            if (disposed || activeRun is not { } run) return;
            UpdateSnapshotLocked(run, run.Snapshot with
            {
                State = ActionProgramRuntimeState.Stopping,
                Message = $"串口会话结束，正在停止动作程序：{reason}",
                UpdatedAtUtc = timeProvider.GetUtcNow()
            });
            run.CancellationTerminalMessage = $"串口会话结束，动作程序已停止：{reason}；未确认物理停止或去使能";
            run.Cancellation.Cancel();
        }
    }

    private void UpdateSnapshot(ActiveRun run, ActionProgramRunSnapshot snapshot)
    {
        lock (stateGate) UpdateSnapshotLocked(run, snapshot);
    }

    private void UpdateSnapshotLocked(ActiveRun run, ActionProgramRunSnapshot snapshot)
    {
        if (snapshot.UpdatedAtUtc <= run.Snapshot.UpdatedAtUtc)
        {
            var nextTimestamp = run.Snapshot.UpdatedAtUtc.AddTicks(1);
            snapshot = snapshot with
            {
                UpdatedAtUtc = nextTimestamp,
                FinishedAtUtc = snapshot.FinishedAtUtc is null ? null : nextTimestamp
            };
        }
        run.Snapshot = snapshot;
        latestSnapshot = snapshot;
        QueuePublication(snapshot);
    }

    private void QueuePublication(ActionProgramRunSnapshot snapshot)
    {
        var startPump = false;
        lock (publishGate)
        {
            pendingPublication = snapshot;
            if (!publicationPumpRunning)
            {
                publicationPumpRunning = true;
                startPump = true;
            }
        }

        if (startPump) _ = PublishLoopAsync();
    }

    private async Task PublishLoopAsync()
    {
        while (true)
        {
            ActionProgramRunSnapshot? snapshot;
            lock (publishGate)
            {
                snapshot = pendingPublication;
                pendingPublication = null;
                if (snapshot is null)
                {
                    publicationPumpRunning = false;
                    return;
                }
            }

            try
            {
                await eventSink.PublishActionProgramRunAsync(snapshot, CancellationToken.None).ConfigureAwait(false);
            }
            catch
            {
                // Runtime ownership and serial progress must not depend on a UI event subscriber.
            }
        }
    }

    private static long EstimateTravelMilliseconds(
        IReadOnlyList<double> from,
        IReadOnlyList<double> to,
        double speedDegS)
    {
        var maximumDelta = from.Zip(to, (left, right) => Math.Abs(right - left)).Max();
        return (long)Math.Ceiling(maximumDelta / speedDegS * 1000d);
    }

    private static bool CanRepresentPacingWait(
        IReadOnlyList<double> from,
        IReadOnlyList<double> to,
        double speedDegS,
        int postDispatchWaitMs)
    {
        var maximumDelta = from.Zip(to, (left, right) => Math.Abs(right - left)).Max();
        var travelMilliseconds = maximumDelta / speedDegS * 1000d;
        return double.IsFinite(travelMilliseconds)
            && travelMilliseconds >= 0
            && travelMilliseconds <= TimeSpan.MaxValue.TotalMilliseconds - postDispatchWaitMs;
    }

    private static ActionProgramRunStartRequest SnapshotRequest(ActionProgramRunStartRequest request) =>
        request with
        {
            Waypoints = request.Waypoints.Select(waypoint => waypoint with
            {
                PositionsDeg = waypoint.PositionsDeg.ToArray()
            }).ToArray()
        };

    private static bool ValidIdentifier(string value, int maximumLength) =>
        !string.IsNullOrWhiteSpace(value) && value.Length <= maximumLength && !value.Any(char.IsControl);

    private static string SafeMessage(Exception exception) => exception switch
    {
        IOException => exception.Message,
        TimeoutException => "串口写入超时",
        _ => "动作运行器发生未预期错误"
    };

    private static ActionProgramRunSnapshot CreateSnapshot(
        ActionProgramRunStartRequest request,
        ActionProgramRuntimeState state,
        int? currentWaypointIndex,
        int completedCycles,
        string? lastRequestId,
        CommandEvidence lastEvidence,
        string message,
        DateTimeOffset startedAt,
        DateTimeOffset updatedAt,
        DateTimeOffset? finishedAt) => new(
            ActionProgramRunContractV1.Version,
            request.RunId,
            request.ProgramId,
            request.Revision,
            request.SessionId,
            request.ProfileId,
            state,
            currentWaypointIndex,
            request.Waypoints.Count,
            completedCycles,
            request.LoopEnabled,
            request.SpeedDegS,
            lastRequestId,
            lastEvidence,
            false,
            message,
            startedAt,
            updatedAt,
            finishedAt);

    private sealed class ActiveRun(
        ActionProgramRunStartRequest request,
        ActionProgramRunSnapshot snapshot,
        IReadOnlyList<double> initialPositionsDeg,
        string executionNonce)
    {
        public ActionProgramRunStartRequest Request { get; } = request;
        public IReadOnlyList<double> InitialPositionsDeg { get; } = initialPositionsDeg.ToArray();
        public string ExecutionNonce { get; } = executionNonce;
        public CancellationTokenSource Cancellation { get; } = new();
        public TaskCompletionSource<ActionProgramRunSnapshot> Completion { get; } =
            new(TaskCreationOptions.RunContinuationsAsynchronously);
        public ActionProgramRunSnapshot Snapshot { get; set; } = snapshot;
        public string? CancellationTerminalMessage { get; set; }
        public Task? Runner { get; set; }
    }

    private sealed class SystemActionProgramDelay(TimeProvider timeProvider) : IActionProgramDelay
    {
        public Task DelayAsync(TimeSpan duration, CancellationToken cancellationToken) =>
            Task.Delay(duration, timeProvider, cancellationToken);
    }
}
