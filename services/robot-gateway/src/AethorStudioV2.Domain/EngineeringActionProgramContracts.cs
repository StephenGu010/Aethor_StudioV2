namespace AethorStudioV2.Domain;

public static class ActionProgramRunContractV1
{
    public const string Version = "1.0";
}

public sealed record ActionProgramRunWaypoint(
    string WaypointId,
    string Name,
    IReadOnlyList<double> PositionsDeg,
    int Mode,
    int PostDispatchWaitMs,
    ActionWaypointSource Source);

public sealed record ActionProgramRunStartRequest(
    string ContractVersion,
    string RunId,
    string ProgramId,
    int Revision,
    string SessionId,
    string ProfileId,
    ActionProgramSource Source,
    double SpeedDegS,
    bool LoopEnabled,
    IReadOnlyList<ActionProgramRunWaypoint> Waypoints);

public enum ActionProgramRuntimeState
{
    Starting,
    Running,
    Stopping,
    FinishedUnconfirmed,
    StoppedUnconfirmed,
    Failed,
    Rejected
}

public sealed record ActionProgramRunSnapshot(
    string ContractVersion,
    string RunId,
    string ProgramId,
    int Revision,
    string SessionId,
    string ProfileId,
    ActionProgramRuntimeState State,
    int? CurrentWaypointIndex,
    int WaypointCount,
    int CompletedCycles,
    bool LoopEnabled,
    double SpeedDegS,
    string? LastRequestId,
    CommandEvidence LastEvidence,
    bool PhysicalCompletionConfirmed,
    string Message,
    DateTimeOffset StartedAtUtc,
    DateTimeOffset UpdatedAtUtc,
    DateTimeOffset? FinishedAtUtc);
