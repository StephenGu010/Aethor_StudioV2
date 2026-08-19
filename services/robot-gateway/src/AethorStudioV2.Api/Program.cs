using System.Diagnostics;
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
// Keep the desktop log probe-oriented. Framework request/CORS/endpoint success
// chatter previously wrote several JSON lines per refresh and obscured the
// stable gateway event IDs used for field diagnosis.
builder.Logging.AddFilter("Microsoft.AspNetCore", LogLevel.Warning);
builder.Logging.AddFilter("Microsoft.Hosting.Lifetime", LogLevel.Information);
builder.WebHost.ConfigureKestrel(options => options.ListenLocalhost(hostOptions.Port));

builder.Services.Configure<JsonOptions>(options => GatewayJson.Configure(options.SerializerOptions));
builder.Services.AddSignalR().AddJsonProtocol(options => GatewayJson.Configure(options.PayloadSerializerOptions));
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
            "X-Aethor-Operation",
            SessionTokenMiddleware.HeaderName)
        .AllowCredentials()));
builder.Services.AddSingleton(new SessionTokenValidator(hostOptions.SessionToken));
builder.Services.AddSingleton<ISerialPortCatalog, WindowsSerialPortCatalog>();
var commandOptions = new RobotGatewayOptions
{
    SerialOpenTimeout = TimeSpan.FromMilliseconds(hostOptions.SerialOpenTimeoutMs),
    JointPollInterval = TimeSpan.FromMilliseconds(hostOptions.JointPollIntervalMs),
    StatusPollInterval = TimeSpan.FromMilliseconds(hostOptions.StatusPollIntervalMs),
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
builder.Services.AddSingleton<SignalRGatewayEventSink>();
builder.Services.AddSingleton<IRobotGatewayEventSink>(sp => sp.GetRequiredService<SignalRGatewayEventSink>());
builder.Services.AddSingleton<IActionProgramRunEventSink>(sp => sp.GetRequiredService<SignalRGatewayEventSink>());
builder.Services.AddSingleton<IGatewayDiagnostics, LoggerGatewayDiagnostics>();
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton(sp => new RobotGateway(
    sp.GetRequiredService<IAsciiTransportFactory>(),
    sp.GetRequiredService<ISerialPortCatalog>(),
    sp.GetRequiredService<IRobotGatewayEventSink>(),
    sp.GetRequiredService<IGatewayDiagnostics>(),
    sp.GetRequiredService<TimeProvider>(),
    commandOptions));
builder.Services.AddSingleton(sp => new EngineeringActionProgramRuntime(
    sp.GetRequiredService<RobotGateway>(),
    sp.GetRequiredService<IActionProgramRunEventSink>(),
    sp.GetRequiredService<TimeProvider>()));
builder.Services.AddHostedService<GatewayHostedLifecycle>();

var app = builder.Build();
GatewayLog.Starting(app.Logger, GatewayContractV1.Version, hostOptions.Port, hostOptions.TokenSource);

app.UseCors("development-loopback");
app.UseMiddleware<SessionTokenMiddleware>();

app.MapGet("/health/live", () => Results.Ok(new { status = "live", contractVersion = GatewayContractV1.Version }));
app.MapGet("/health/ready", () => Results.Ok(new { status = "ready", serialRequired = false }));

var api = app.MapGroup("/api/v1");
api.MapGet("/gateway/capabilities", (RobotGateway gateway) => gateway.Capabilities);
api.MapGet("/serial/ports", async (HttpContext context, RobotGateway gateway, CancellationToken cancellationToken) =>
{
    var operationId = ReadOperationId(context);
    var stopwatch = Stopwatch.StartNew();
    GatewayLog.SerialEnumerationStarted(app.Logger, operationId);
    try
    {
        var ports = await gateway.ListPortsAsync(cancellationToken).ConfigureAwait(false);
        GatewayLog.SerialEnumerationCompleted(app.Logger, operationId, ports.Count, stopwatch.ElapsedMilliseconds);
        return Results.Ok(ports);
    }
    catch (Exception exception)
    {
        GatewayLog.SerialEnumerationFailed(
            app.Logger,
            exception,
            operationId,
            stopwatch.ElapsedMilliseconds,
            exception is OperationCanceledException ? "cancelled" : "dependency");
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
api.MapGet("/engineering/direct-commands", (RobotGateway gateway, int? limit) =>
{
    try
    {
        return Results.Ok(gateway.GetDirectCommandHistory(limit ?? 50));
    }
    catch (GatewayValidationException exception)
    {
        return Problem(StatusCodes.Status400BadRequest, "Invalid direct command history query", exception.Message);
    }
});
api.MapGet("/engineering/action-program/run", ActionProgramRunEndpoints.GetSnapshot);
api.MapPost("/session/connect", async (
    HttpContext context,
    RobotConnectRequest request,
    RobotGateway gateway,
    CancellationToken cancellationToken) =>
{
    const string operation = "connect";
    var operationId = ReadOperationId(context);
    var stopwatch = Stopwatch.StartNew();
    GatewayLog.SerialSessionStarted(app.Logger, operationId, operation);
    try
    {
        var snapshot = await gateway.ConnectAsync(request, cancellationToken).ConfigureAwait(false);
        GatewayLog.SerialSessionCompleted(app.Logger, operationId, operation, snapshot.ConnectionState.ToString().ToLowerInvariant(), stopwatch.ElapsedMilliseconds);
        return Results.Ok(snapshot);
    }
    catch (GatewayValidationException exception)
    {
        GatewayLog.SerialSessionFailed(app.Logger, null, operationId, operation, stopwatch.ElapsedMilliseconds, "validation");
        return Problem(StatusCodes.Status400BadRequest, "Connection request rejected", exception.Message);
    }
    catch (GatewayConflictException exception)
    {
        GatewayLog.SerialSessionFailed(app.Logger, null, operationId, operation, stopwatch.ElapsedMilliseconds, "conflict");
        return Problem(StatusCodes.Status409Conflict, "A serial session is already active", exception.Message);
    }
    catch (GatewayDependencyException exception)
    {
        GatewayLog.SerialSessionFailed(app.Logger, exception.InnerException, operationId, operation, stopwatch.ElapsedMilliseconds, "dependency");
        return Problem(StatusCodes.Status503ServiceUnavailable, "Serial connection failed", exception.Message);
    }
    catch (OperationCanceledException exception)
    {
        GatewayLog.SerialSessionFailed(app.Logger, exception, operationId, operation, stopwatch.ElapsedMilliseconds, "cancelled");
        throw;
    }
    catch (Exception exception)
    {
        GatewayLog.SerialSessionFailed(app.Logger, exception, operationId, operation, stopwatch.ElapsedMilliseconds, "unexpected");
        throw;
    }
});
api.MapPost("/session/disconnect", async (
    HttpContext context,
    RobotGateway gateway,
    EngineeringActionProgramRuntime actionRuntime,
    CancellationToken cancellationToken) =>
{
    const string operation = "disconnect";
    var operationId = ReadOperationId(context);
    var stopwatch = Stopwatch.StartNew();
    GatewayLog.SerialSessionStarted(app.Logger, operationId, operation);
    try
    {
        if (actionRuntime.IsActive)
        {
            await actionRuntime.StopAsync("串口断开请求").ConfigureAwait(false);
        }
        var snapshot = await gateway.DisconnectAsync(cancellationToken).ConfigureAwait(false);
        GatewayLog.SerialSessionCompleted(app.Logger, operationId, operation, snapshot.ConnectionState.ToString().ToLowerInvariant(), stopwatch.ElapsedMilliseconds);
        return Results.Ok(snapshot);
    }
    catch (GatewayConflictException exception)
    {
        GatewayLog.SerialSessionFailed(app.Logger, null, operationId, operation, stopwatch.ElapsedMilliseconds, "conflict");
        return Problem(StatusCodes.Status409Conflict, "Serial release rejected", exception.Message);
    }
    catch (OperationCanceledException exception)
    {
        GatewayLog.SerialSessionFailed(app.Logger, exception, operationId, operation, stopwatch.ElapsedMilliseconds, "cancelled");
        throw;
    }
    catch (Exception exception)
    {
        GatewayLog.SerialSessionFailed(app.Logger, exception, operationId, operation, stopwatch.ElapsedMilliseconds, "unexpected");
        throw;
    }
});
api.MapPost("/commands/enable", async (SimpleRobotCommand command, RobotGateway gateway, CancellationToken cancellationToken) =>
    Results.Ok(await gateway.EnableAsync(command, cancellationToken).ConfigureAwait(false)));
api.MapPost("/commands/stop-and-disable", async (
    SimpleRobotCommand command,
    RobotGateway gateway,
    EngineeringActionProgramRuntime actionRuntime,
    CancellationToken cancellationToken) =>
{
    await StopActionProgramIfActiveAsync(actionRuntime, "结构化停止并去使能请求").ConfigureAwait(false);
    return Results.Ok(await gateway.StopAndDisableAsync(command, cancellationToken).ConfigureAwait(false));
});
api.MapPost("/commands/home", async (SimpleRobotCommand command, RobotGateway gateway, CancellationToken cancellationToken) =>
    Results.Ok(await gateway.HomeAsync(command, cancellationToken).ConfigureAwait(false)));
api.MapPost("/commands/reset", async (SimpleRobotCommand command, RobotGateway gateway, CancellationToken cancellationToken) =>
    Results.Ok(await gateway.ResetAsync(command, cancellationToken).ConfigureAwait(false)));
api.MapPost("/commands/set-mode", async (SetModeCommand command, RobotGateway gateway, CancellationToken cancellationToken) =>
    Results.Ok(await gateway.SetModeAsync(command, cancellationToken).ConfigureAwait(false)));
api.MapPost("/commands/joint-group", async (JointGroupCommand command, RobotGateway gateway, CancellationToken cancellationToken) =>
    Results.Ok(await gateway.SendJointGroupAsync(command, cancellationToken).ConfigureAwait(false)));
api.MapPost("/engineering/direct-command", async (
    DirectCommandRequest command,
    RobotGateway gateway,
    EngineeringActionProgramRuntime actionRuntime,
    CancellationToken cancellationToken) =>
{
    if (command.Line?.Trim() is "!STOP" or "!DISABLE")
    {
        await StopActionProgramIfActiveAsync(actionRuntime, "串口终端停止请求").ConfigureAwait(false);
    }
    return Results.Ok(await gateway.SendDirectAsync(command, cancellationToken).ConfigureAwait(false));
});
api.MapPost("/engineering/action-program/run/start", (
    ActionProgramRunStartRequest request,
    EngineeringActionProgramRuntime runtime) =>
{
    try
    {
        return Results.Ok(runtime.Start(request).InitialSnapshot);
    }
    catch (GatewayConflictException exception)
    {
        return Problem(StatusCodes.Status409Conflict, "Action program start rejected", exception.Message);
    }
    catch (GatewayValidationException exception)
    {
        return Problem(StatusCodes.Status400BadRequest, "Invalid action program run", exception.Message);
    }
});
api.MapPost("/engineering/action-program/run/stop", ActionProgramRunEndpoints.StopAsync);
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

static async Task StopActionProgramIfActiveAsync(EngineeringActionProgramRuntime runtime, string reason)
{
    if (!runtime.IsActive) return;
    try
    {
        await runtime.StopAsync(reason).ConfigureAwait(false);
    }
    catch (GatewayConflictException)
    {
        // The run reached a terminal state between the observation and stop request.
    }
}

static string ReadOperationId(HttpContext context)
{
    var candidate = context.Request.Headers["X-Aethor-Operation"].FirstOrDefault();
    return Guid.TryParse(candidate, out var operationId)
        ? operationId.ToString("D")
        : context.TraceIdentifier;
}

public partial class Program;
