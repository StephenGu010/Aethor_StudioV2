using AethorStudioV2.Domain;

namespace AethorStudioV2.Application;

public interface IAsciiTransport : IAsyncDisposable
{
    string PortName { get; }
    bool IsOpen { get; }
    ValueTask OpenAsync(CancellationToken cancellationToken);
    ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken);
    ValueTask WriteAsync(ReadOnlyMemory<byte> payload, CancellationToken cancellationToken);
    ValueTask CloseAsync(CancellationToken cancellationToken);
}

public interface IAsciiTransportFactory
{
    IAsciiTransport Create(string portName, int baudRate);
}

public interface ISerialPortCatalog
{
    ValueTask<IReadOnlyList<SerialPortDescriptor>> ListAsync(CancellationToken cancellationToken);
}

public interface IRobotGatewayEventSink
{
    ValueTask PublishSessionAsync(RobotSessionSnapshot snapshot, CancellationToken cancellationToken);
    ValueTask PublishJointStateAsync(JointStateFrame frame, CancellationToken cancellationToken);
    ValueTask PublishProtocolFrameAsync(ProtocolFrame frame, CancellationToken cancellationToken);
    ValueTask PublishCommandResultAsync(CommandResult result, CancellationToken cancellationToken);
    ValueTask PublishDirectCommandResultAsync(DirectCommandResult result, CancellationToken cancellationToken);
}

public interface IActionProgramCommandPort
{
    Task<CommandResult> SetModeAsync(SetModeCommand command, CancellationToken cancellationToken);
    Task<CommandResult> SendJointGroupAsync(JointGroupCommand command, CancellationToken cancellationToken);
    Task<CommandResult> StopAndDisableAsync(SimpleRobotCommand command, CancellationToken cancellationToken);
}

public interface IActionProgramDelay
{
    Task DelayAsync(TimeSpan duration, CancellationToken cancellationToken);
}

public enum GatewayDiagnosticSeverity
{
    Information,
    Warning,
    Error
}

public sealed record GatewayDiagnosticEvent(
    string EventName,
    GatewayDiagnosticSeverity Severity,
    string? SessionId,
    string? PortName,
    string Detail,
    Exception? Exception = null);

public interface IGatewayDiagnostics
{
    void Record(GatewayDiagnosticEvent diagnosticEvent);
}

public sealed class NullGatewayEventSink : IRobotGatewayEventSink
{
    public ValueTask PublishSessionAsync(RobotSessionSnapshot snapshot, CancellationToken cancellationToken) =>
        ValueTask.CompletedTask;

    public ValueTask PublishJointStateAsync(JointStateFrame frame, CancellationToken cancellationToken) =>
        ValueTask.CompletedTask;

    public ValueTask PublishProtocolFrameAsync(ProtocolFrame frame, CancellationToken cancellationToken) =>
        ValueTask.CompletedTask;

    public ValueTask PublishCommandResultAsync(CommandResult result, CancellationToken cancellationToken) =>
        ValueTask.CompletedTask;

    public ValueTask PublishDirectCommandResultAsync(DirectCommandResult result, CancellationToken cancellationToken) =>
        ValueTask.CompletedTask;
}

public sealed class NullGatewayDiagnostics : IGatewayDiagnostics
{
    public void Record(GatewayDiagnosticEvent diagnosticEvent)
    {
    }
}
