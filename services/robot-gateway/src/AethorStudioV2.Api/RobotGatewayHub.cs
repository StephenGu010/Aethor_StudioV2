using AethorStudioV2.Application;
using AethorStudioV2.Domain;
using Microsoft.AspNetCore.SignalR;

namespace AethorStudioV2.Api;

public sealed class RobotGatewayHub : Hub
{
}

public static class RobotGatewayHubEvents
{
    public const string SessionSnapshot = "sessionSnapshot";
    public const string JointStateFrame = "jointStateFrame";
    public const string ProtocolFrame = "protocolFrame";
    public const string CommandResult = "commandResult";
    public const string DirectCommandResult = "directCommandResult";
    public const string ActionProgramRunSnapshot = "actionProgramRunSnapshot";
}

public sealed class SignalRGatewayEventSink(IHubContext<RobotGatewayHub> hubContext) :
    IRobotGatewayEventSink,
    IActionProgramRunEventSink
{
    public ValueTask PublishSessionAsync(RobotSessionSnapshot snapshot, CancellationToken cancellationToken) =>
        new(hubContext.Clients.All.SendAsync(RobotGatewayHubEvents.SessionSnapshot, snapshot, cancellationToken));

    public ValueTask PublishJointStateAsync(JointStateFrame frame, CancellationToken cancellationToken) =>
        new(hubContext.Clients.All.SendAsync(RobotGatewayHubEvents.JointStateFrame, frame, cancellationToken));

    public ValueTask PublishProtocolFrameAsync(ProtocolFrame frame, CancellationToken cancellationToken) =>
        new(hubContext.Clients.All.SendAsync(RobotGatewayHubEvents.ProtocolFrame, frame, cancellationToken));

    public ValueTask PublishCommandResultAsync(CommandResult result, CancellationToken cancellationToken) =>
        new(hubContext.Clients.All.SendAsync(RobotGatewayHubEvents.CommandResult, result, cancellationToken));

    public ValueTask PublishDirectCommandResultAsync(DirectCommandResult result, CancellationToken cancellationToken) =>
        new(hubContext.Clients.All.SendAsync(RobotGatewayHubEvents.DirectCommandResult, result, cancellationToken));

    public ValueTask PublishActionProgramRunAsync(ActionProgramRunSnapshot snapshot, CancellationToken cancellationToken) =>
        new(hubContext.Clients.All.SendAsync(RobotGatewayHubEvents.ActionProgramRunSnapshot, snapshot, cancellationToken));
}

public sealed class LoggerGatewayDiagnostics(ILogger<LoggerGatewayDiagnostics> logger) : IGatewayDiagnostics
{
    public void Record(GatewayDiagnosticEvent diagnosticEvent)
    {
        switch (diagnosticEvent.Severity)
        {
            case GatewayDiagnosticSeverity.Information:
                GatewayLog.DiagnosticInformation(logger, diagnosticEvent.Exception, diagnosticEvent.EventName, diagnosticEvent.SessionId, diagnosticEvent.PortName, diagnosticEvent.Detail);
                break;
            case GatewayDiagnosticSeverity.Warning:
                GatewayLog.DiagnosticWarning(logger, diagnosticEvent.Exception, diagnosticEvent.EventName, diagnosticEvent.SessionId, diagnosticEvent.PortName, diagnosticEvent.Detail);
                break;
            case GatewayDiagnosticSeverity.Error:
                GatewayLog.DiagnosticError(logger, diagnosticEvent.Exception, diagnosticEvent.EventName, diagnosticEvent.SessionId, diagnosticEvent.PortName, diagnosticEvent.Detail);
                break;
        }
    }
}
