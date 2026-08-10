using System.Text.Json;
using System.Text.Json.Serialization;
using AethorStudioV2.Api;
using AethorStudioV2.Application;
using AethorStudioV2.Domain;
using AethorStudioV2.Infrastructure;
using Microsoft.AspNetCore.Http.Json;

var builder = WebApplication.CreateBuilder(args);
builder.Configuration.AddEnvironmentVariables("AETHOR_GATEWAY_");
var hostOptions = GatewayHostOptions.FromConfiguration(builder.Configuration, builder.Environment);

builder.Logging.AddJsonConsole(options => options.IncludeScopes = true);
builder.Logging.AddFilter("Microsoft.AspNetCore.Hosting.Diagnostics", LogLevel.Warning);
builder.WebHost.ConfigureKestrel(options => options.ListenLocalhost(hostOptions.Port));

builder.Services.Configure<JsonOptions>(options => ConfigureJson(options.SerializerOptions));
builder.Services.AddSignalR().AddJsonProtocol(options => ConfigureJson(options.PayloadSerializerOptions));
builder.Services.AddCors(options => options.AddPolicy("development-loopback", policy =>
    policy.WithOrigins([.. hostOptions.DevelopmentOrigins])
        .WithMethods("GET", "POST")
        // The official SignalR browser client marks negotiate requests with
        // these two headers. Keep the allow-list explicit so arbitrary request
        // headers are still rejected at the loopback boundary.
        .WithHeaders(
            "Content-Type",
            "Authorization",
            "X-Requested-With",
            "X-SignalR-User-Agent",
            SessionTokenMiddleware.HeaderName)
        .AllowCredentials()));
builder.Services.AddSingleton(new SessionTokenValidator(hostOptions.SessionToken));
builder.Services.AddSingleton<ISerialPortCatalog, WindowsSerialPortCatalog>();
var commandOptions = new RobotGatewayOptions
{
    HardwareCommandsEnabled = hostOptions.CommandPolicy != GatewayCommandPolicy.Disabled,
    EngineeringCommandsEnabled = hostOptions.CommandPolicy == GatewayCommandPolicy.Engineering,
    JointGroupSpeedLimitDegS = hostOptions.JointGroupSpeedLimitDegS,
    JointGroupCompletion = hostOptions.JointGroupPositionToleranceDeg is { } tolerance
        && hostOptions.JointGroupSettledDurationMs is { } settledDuration
        && hostOptions.JointGroupCompletionTimeoutMs is { } completionTimeout
            ? new JointGroupCompletionPolicy(tolerance, settledDuration, completionTimeout)
            : null
};
builder.Services.AddSingleton<IAsciiTransportFactory>(_ => new SerialPortTransportFactory(
    hostOptions.CommandPolicy switch
    {
        GatewayCommandPolicy.Supervised => SerialPayloadAccess.Supervised,
        GatewayCommandPolicy.Engineering => SerialPayloadAccess.Engineering,
        _ => SerialPayloadAccess.ReadOnly
    },
    hostOptions.CommandPolicy == GatewayCommandPolicy.Engineering
        ? commandOptions.EngineeringJointSpeedMaxDegS
        : hostOptions.JointGroupSpeedLimitDegS));
builder.Services.AddSingleton<IRobotGatewayEventSink, SignalRGatewayEventSink>();
builder.Services.AddSingleton<IGatewayDiagnostics, LoggerGatewayDiagnostics>();
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton(sp => new RobotGateway(
    sp.GetRequiredService<IAsciiTransportFactory>(),
    sp.GetRequiredService<ISerialPortCatalog>(),
    sp.GetRequiredService<IRobotGatewayEventSink>(),
    sp.GetRequiredService<IGatewayDiagnostics>(),
    sp.GetRequiredService<TimeProvider>(),
    commandOptions));
builder.Services.AddHostedService<GatewayHostedLifecycle>();

var app = builder.Build();
GatewayLog.Starting(app.Logger, GatewayContractV1.Version, hostOptions.Port, hostOptions.TokenSource);

app.UseCors("development-loopback");
app.UseMiddleware<SessionTokenMiddleware>();

app.MapGet("/health/live", () => Results.Ok(new { status = "live", contractVersion = GatewayContractV1.Version }));
app.MapGet("/health/ready", () => Results.Ok(new { status = "ready", serialRequired = false }));

var api = app.MapGroup("/api/v1");
api.MapGet("/gateway/capabilities", (RobotGateway gateway) => gateway.Capabilities);
api.MapGet("/serial/ports", async (RobotGateway gateway, CancellationToken cancellationToken) =>
{
    try
    {
        return Results.Ok(await gateway.ListPortsAsync(cancellationToken).ConfigureAwait(false));
    }
    catch (Exception exception)
    {
        GatewayLog.SerialEnumerationFailed(app.Logger, exception);
        return Results.Problem(
            statusCode: StatusCodes.Status503ServiceUnavailable,
            title: "Serial port enumeration failed",
            type: "https://aethor.local/problems/serial-enumeration");
    }
});
api.MapGet("/session", (RobotGateway gateway) => gateway.GetSession());
api.MapGet("/joint-state", (RobotGateway gateway) => gateway.GetJointState());
api.MapGet("/protocol-frames", (RobotGateway gateway, int? limit) =>
{
    try
    {
        return Results.Ok(gateway.GetProtocolFrames(limit ?? 100));
    }
    catch (GatewayValidationException exception)
    {
        return Problem(StatusCodes.Status400BadRequest, "Invalid protocol frame query", exception.Message);
    }
});
api.MapGet("/commands", (RobotGateway gateway, int? limit) =>
{
    try
    {
        return Results.Ok(gateway.GetCommandHistory(limit ?? 50));
    }
    catch (GatewayValidationException exception)
    {
        return Problem(StatusCodes.Status400BadRequest, "Invalid command history query", exception.Message);
    }
});
api.MapGet("/commands/{commandId}", (string commandId, RobotGateway gateway) =>
{
    try
    {
        var command = gateway.GetCommand(commandId);
        return command is null ? Results.NotFound() : Results.Ok(command);
    }
    catch (GatewayValidationException exception)
    {
        return Problem(StatusCodes.Status400BadRequest, "Invalid command query", exception.Message);
    }
});
api.MapPost("/session/connect", async (
    RobotConnectRequest request,
    RobotGateway gateway,
    CancellationToken cancellationToken) =>
{
    try
    {
        return Results.Ok(await gateway.ConnectAsync(request, cancellationToken).ConfigureAwait(false));
    }
    catch (GatewayValidationException exception)
    {
        return Problem(StatusCodes.Status400BadRequest, "Connection request rejected", exception.Message);
    }
    catch (GatewayConflictException exception)
    {
        return Problem(StatusCodes.Status409Conflict, "A serial session is already active", exception.Message);
    }
    catch (GatewayDependencyException exception)
    {
        GatewayLog.SerialConnectionFailed(app.Logger, exception.InnerException);
        return Problem(StatusCodes.Status503ServiceUnavailable, "Serial connection failed", exception.Message);
    }
});
api.MapPost("/session/disconnect", async (RobotGateway gateway, CancellationToken cancellationToken) =>
{
    try
    {
        return Results.Ok(await gateway.DisconnectAsync(cancellationToken).ConfigureAwait(false));
    }
    catch (GatewayConflictException exception)
    {
        return Problem(StatusCodes.Status409Conflict, "Serial release rejected", exception.Message);
    }
});
api.MapPost("/commands/enable", async (SimpleRobotCommand command, RobotGateway gateway, CancellationToken cancellationToken) =>
    Results.Ok(await gateway.EnableAsync(command, cancellationToken).ConfigureAwait(false)));
api.MapPost("/commands/stop-and-disable", async (SimpleRobotCommand command, RobotGateway gateway, CancellationToken cancellationToken) =>
    Results.Ok(await gateway.StopAndDisableAsync(command, cancellationToken).ConfigureAwait(false)));
api.MapPost("/commands/home", async (SimpleRobotCommand command, RobotGateway gateway, CancellationToken cancellationToken) =>
    Results.Ok(await gateway.HomeAsync(command, cancellationToken).ConfigureAwait(false)));
api.MapPost("/commands/reset", async (SimpleRobotCommand command, RobotGateway gateway, CancellationToken cancellationToken) =>
    Results.Ok(await gateway.ResetAsync(command, cancellationToken).ConfigureAwait(false)));
api.MapPost("/commands/set-mode", async (SetModeCommand command, RobotGateway gateway, CancellationToken cancellationToken) =>
    Results.Ok(await gateway.SetModeAsync(command, cancellationToken).ConfigureAwait(false)));
api.MapPost("/commands/joint-group", async (JointGroupCommand command, RobotGateway gateway, CancellationToken cancellationToken) =>
    Results.Ok(await gateway.SendJointGroupAsync(command, cancellationToken).ConfigureAwait(false)));
api.MapPost("/engineering/direct-command", async (DirectCommandRequest command, RobotGateway gateway, CancellationToken cancellationToken) =>
    Results.Ok(await gateway.SendDirectAsync(command, cancellationToken).ConfigureAwait(false)));
api.MapPost("/host/shutdown", (RobotGateway gateway, IHostApplicationLifetime lifetime, HttpContext context) =>
{
    var session = gateway.GetSession();
    if (!GatewayHostShutdownPolicy.CanShutdown(session))
    {
        return Problem(StatusCodes.Status409Conflict, "Gateway shutdown rejected", "The device must be confirmed disabled before the desktop shell can stop the gateway");
    }

    context.Response.OnCompleted(() =>
    {
        lifetime.StopApplication();
        return Task.CompletedTask;
    });
    return Results.Accepted();
});

app.MapHub<RobotGatewayHub>("/hubs/robot-v1");
app.Run();

static IResult Problem(int status, string title, string detail) => Results.Problem(
    statusCode: status,
    title: title,
    detail: detail,
    type: "https://aethor.local/problems/gateway-operation");

static void ConfigureJson(JsonSerializerOptions options)
{
    options.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
    options.DictionaryKeyPolicy = JsonNamingPolicy.CamelCase;
    options.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase));
}

public partial class Program;
