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
        .WithHeaders("Content-Type", "Authorization", SessionTokenMiddleware.HeaderName)
        .AllowCredentials()));
builder.Services.AddSingleton(new SessionTokenValidator(hostOptions.SessionToken));
builder.Services.AddSingleton<ISerialPortCatalog, WindowsSerialPortCatalog>();
builder.Services.AddSingleton<IAsciiTransportFactory, SerialPortTransportFactory>();
builder.Services.AddSingleton<IReadOnlyGatewayEventSink, SignalRGatewayEventSink>();
builder.Services.AddSingleton<IGatewayDiagnostics, LoggerGatewayDiagnostics>();
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton(sp => new ReadOnlyRobotGateway(
    sp.GetRequiredService<IAsciiTransportFactory>(),
    sp.GetRequiredService<ISerialPortCatalog>(),
    sp.GetRequiredService<IReadOnlyGatewayEventSink>(),
    sp.GetRequiredService<IGatewayDiagnostics>(),
    sp.GetRequiredService<TimeProvider>()));
builder.Services.AddHostedService<GatewayHostedLifecycle>();

var app = builder.Build();
GatewayLog.Starting(app.Logger, GatewayContractV1.Version, hostOptions.Port, hostOptions.TokenSource);

app.UseCors("development-loopback");
app.UseMiddleware<SessionTokenMiddleware>();

app.MapGet("/health/live", () => Results.Ok(new { status = "live", contractVersion = GatewayContractV1.Version }));
app.MapGet("/health/ready", () => Results.Ok(new { status = "ready", serialRequired = false }));

var api = app.MapGroup("/api/v1");
api.MapGet("/gateway/capabilities", (ReadOnlyRobotGateway gateway) => gateway.Capabilities);
api.MapGet("/serial/ports", async (ReadOnlyRobotGateway gateway, CancellationToken cancellationToken) =>
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
api.MapGet("/session", (ReadOnlyRobotGateway gateway) => gateway.GetSession());
api.MapGet("/joint-state", (ReadOnlyRobotGateway gateway) => gateway.GetJointState());
api.MapGet("/protocol-frames", (ReadOnlyRobotGateway gateway, int? limit) =>
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
api.MapPost("/session/connect", async (
    ReadOnlyConnectRequest request,
    ReadOnlyRobotGateway gateway,
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
api.MapPost("/session/disconnect", async (ReadOnlyRobotGateway gateway, CancellationToken cancellationToken) =>
    Results.Ok(await gateway.DisconnectAsync(cancellationToken).ConfigureAwait(false)));

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
