namespace AethorStudioV2.Domain;

public enum ActionProgramSource
{
    Authored,
    ShowcaseExample
}

public enum ActionWaypointSource
{
    Manual,
    MeasuredCapture,
    ShowcaseExample
}

public sealed record ActionProgramExecutionWaypoint(
    string WaypointId,
    string Name,
    IReadOnlyList<double> PositionsDeg,
    int Mode,
    int PostArrivalWaitMs,
    ActionWaypointSource Source);

public sealed record ActionProgramExecutionPlan(
    string RunId,
    string ProgramId,
    int Revision,
    string SessionId,
    string ProfileId,
    ActionProgramSource Source,
    double SpeedDegS,
    IReadOnlyList<ActionProgramExecutionWaypoint> Waypoints);

public sealed record ActionProgramResumeCheckpoint(
    string ProgramId,
    int Revision,
    string SessionId,
    string ProfileId,
    string PlanFingerprintSha256,
    int LastConfirmedWaypointIndex,
    string LastConfirmedWaypointId);

public enum ActionProgramRunStatus
{
    Completed,
    Stopped,
    Failed,
    Rejected
}

public enum ActionProgramRunCode
{
    Ok,
    InvalidPlan,
    RunnerBusy,
    OperatorStopped,
    WaypointCommandFailed,
    CommandAwaitTimedOut,
    CommandTransportFailure,
    StopUnconfirmed
}

public sealed record ActionWaypointExecutionRecord(
    int WaypointIndex,
    string WaypointId,
    string? ModeCommandId,
    CommandResult? ModeResult,
    string? JointGroupCommandId,
    CommandResult? JointGroupResult,
    bool FeedbackConfirmed,
    DateTimeOffset? ConfirmedAtUtc);

public sealed record ActionProgramRunResult(
    string RunId,
    string ProgramId,
    int Revision,
    string SessionId,
    string ProfileId,
    ActionProgramRunStatus Status,
    ActionProgramRunCode Code,
    string Message,
    DateTimeOffset StartedAtUtc,
    DateTimeOffset FinishedAtUtc,
    IReadOnlyList<ActionWaypointExecutionRecord> Waypoints,
    ActionProgramResumeCheckpoint? ResumeCheckpoint,
    CommandResult? StopResult,
    bool? SafeStopConfirmed);
