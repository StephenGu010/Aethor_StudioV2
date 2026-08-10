namespace AethorStudioV2.Domain;

public static class GatewayContractV1
{
    public const string Version = "1.2";
    public const string DummyProfileId = "dummy-6dof";
    public const string DummyProtocolAdapterId = "dummy-ascii-v1";
}

public static class DummyJointLimits
{
    public static readonly IReadOnlyList<JointLimit> All =
    [
        new(-179.91, 179.91),
        new(-74.48, 124.90),
        new(-93.39, 91.67),
        new(-179.91, 179.91),
        new(-100.84, 100.84),
        new(-179.91, 179.91)
    ];
}

public sealed record JointLimit(double LowerDeg, double UpperDeg);

public enum DataSource
{
    Showcase,
    Measured,
    Commanded,
    Computed,
    Unavailable
}

public enum Validity
{
    Valid,
    Stale,
    Invalid,
    Unavailable
}

public enum ConnectionState
{
    Offline,
    Connecting,
    Connected,
    Reconnecting,
    Disconnecting,
    Faulted
}

public enum MotorState
{
    Unknown,
    Disabled,
    Enabled
}

public sealed record RobotSessionSnapshot(
    string SessionId,
    string ProfileId,
    ConnectionState ConnectionState,
    MotorState MotorState,
    int? ControlMode,
    DateTimeOffset TimestampUtc,
    DataSource Source,
    Validity Validity);

public sealed record JointStateFrame(
    long Sequence,
    string ProfileId,
    DateTimeOffset TimestampUtc,
    IReadOnlyList<double> PositionsDeg,
    DataSource Source,
    Validity Validity);

public enum ProtocolDirection
{
    Tx,
    Rx,
    Error
}

public sealed record ProtocolFrame(
    string Id,
    DateTimeOffset TimestampUtc,
    ProtocolDirection Direction,
    string Raw,
    string ParsedKind,
    DataSource Source,
    string? CorrelationId = null);

public sealed record SerialPortDescriptor(
    string PortName,
    string? HardwareId,
    string? DisplayName);

public sealed record RobotConnectRequest(string PortName, string ProfileId);

public enum GatewayCommandPolicy
{
    Disabled,
    Supervised,
    Engineering
}

public enum RobotCommandKind
{
    Enable,
    StopAndDisable,
    Home,
    Reset,
    SetMode,
    JointGroup
}

public enum CommandStatus
{
    Unsupported,
    Rejected,
    Accepted,
    Completed,
    Failed,
    TimedOut,
    Cancelled,
    Unconfirmed
}

public enum CommandEvidence
{
    None,
    GatewayAccepted,
    DeviceQueued,
    DeviceAck,
    FeedbackConfirmed
}

public enum CommandResultCode
{
    Ok,
    CommandsDisabled,
    InvalidRequest,
    SessionMismatch,
    NotConnected,
    FeedbackStale,
    MotorNotEnabled,
    InvalidTarget,
    SpeedUnverified,
    SpeedOutOfRange,
    SafetyInterlockLatched,
    CommandInFlight,
    CommandIdConflict,
    DeviceRejected,
    DeviceUnconfirmed,
    TransportError,
    Timeout,
    Cancelled
}

public sealed record RobotGatewayCapabilities(
    string ContractVersion,
    string ProtocolAdapterId,
    bool SerialEnumeration,
    bool ReadOnlyConnection,
    bool LiveTelemetry,
    bool HardwareCommands,
    bool DirectCommand,
    GatewayCommandPolicy CommandPolicy,
    IReadOnlyList<string> AllowedQueries,
    IReadOnlyList<RobotCommandKind> SupportedCommands,
    double? JointGroupSpeedLimitDegS,
    JointGroupCompletionPolicy? JointGroupCompletion,
    double? EngineeringJointSpeedMaxDegS);

public sealed record JointGroupCompletionPolicy(
    double PositionToleranceDeg,
    int SettledDurationMs,
    int TimeoutMs);

public sealed record SimpleRobotCommand(
    string CommandId,
    string SessionId,
    string ProfileId);

public sealed record SetModeCommand(
    string CommandId,
    string SessionId,
    string ProfileId,
    int Mode);

public sealed record JointGroupCommand(
    string CommandId,
    string SessionId,
    string ProfileId,
    IReadOnlyList<double> PositionsDeg,
    double? SpeedDegS = null);

public sealed record DirectCommandRequest(
    string RequestId,
    string SessionId,
    string ProfileId,
    string Line);

public enum DirectCommandStatus
{
    Replied,
    Queued,
    Rejected,
    TimedOut,
    Failed
}

public sealed record DirectCommandResult(
    string RequestId,
    string SessionId,
    DirectCommandStatus Status,
    CommandEvidence Evidence,
    string NormalizedLine,
    string Message,
    DateTimeOffset TimestampUtc,
    string? DeviceReply = null);

public sealed record CommandResult(
    string CommandId,
    string SessionId,
    RobotCommandKind CommandKind,
    CommandStatus Status,
    CommandResultCode Code,
    CommandEvidence Evidence,
    string Message,
    DateTimeOffset TimestampUtc,
    string? DeviceReply = null);

public sealed record CommandAuditRecord(
    string CommandId,
    string SessionId,
    string ProfileId,
    RobotCommandKind CommandKind,
    DateTimeOffset AcceptedAtUtc,
    RobotCommandRequestSnapshot Request,
    IReadOnlyList<string> TransmittedPayloads,
    bool TransmissionLogTruncated,
    CommandResult Result);

public sealed record RobotCommandRequestSnapshot(
    RobotCommandKind CommandKind,
    string RequestFingerprintSha256,
    int? Mode,
    IReadOnlyList<double>? PositionsDeg,
    int? PositionsCount,
    double? SpeedDegS,
    bool PayloadTruncated);
