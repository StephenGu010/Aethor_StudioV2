namespace AethorStudioV2.Domain;

public static class GatewayContractV1
{
    public const string Version = "1.0";
    public const string DummyProfileId = "dummy-6dof";
    public const string DummyProtocolAdapterId = "dummy-ascii-v1";
}

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

public sealed record ReadOnlyConnectRequest(string PortName, string ProfileId);

public sealed record ReadOnlyGatewayCapabilities(
    string ContractVersion,
    string ProtocolAdapterId,
    bool SerialEnumeration,
    bool ReadOnlyConnection,
    bool LiveTelemetry,
    bool HardwareCommands,
    IReadOnlyList<string> AllowedQueries);
