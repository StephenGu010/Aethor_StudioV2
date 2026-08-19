using System.Net;
using System.Text;
using AethorStudioV2.Api;
using AethorStudioV2.Application;
using AethorStudioV2.Domain;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Json;
using Microsoft.Extensions.DependencyInjection;

namespace AethorStudioV2.Tests;

public sealed class GatewayJsonBindingTests
{
    [Fact]
    public async Task StopEndpointReturnsConflictWhenTheRunAlreadyTerminalized()
    {
        await using var runtime = new EngineeringActionProgramRuntime(new EmptyEngineeringActionPort());

        var result = await ActionProgramRunEndpoints.StopAsync(runtime, CancellationToken.None);

        Assert.Equal(StatusCodes.Status409Conflict, Assert.IsAssignableFrom<IStatusCodeHttpResult>(result).StatusCode);
    }

    [Fact]
    public async Task MinimalHttpBindingAcceptsTheCompleteStringEnumRequest()
    {
        await using var app = await StartBindingAppAsync();
        using var client = CreateClient(app);

        using var response = await client.PostAsync("/run", Json(ValidRequestJson()));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Theory]
    [InlineData("missingSource")]
    [InlineData("numericEnum")]
    [InlineData("unknownProperty")]
    public async Task MinimalHttpBindingRejectsRequestsOutsideThePublishedSchema(string mutation)
    {
        await using var app = await StartBindingAppAsync();
        using var client = CreateClient(app);
        var json = mutation switch
        {
            "missingSource" => ValidRequestJson().Replace("\"source\":\"authored\",", "", StringComparison.Ordinal),
            "numericEnum" => ValidRequestJson().Replace("\"source\":\"authored\"", "\"source\":0", StringComparison.Ordinal),
            "unknownProperty" => ValidRequestJson().Replace("\"loopEnabled\":false", "\"loopEnabled\":false,\"unexpected\":true", StringComparison.Ordinal),
            _ => throw new ArgumentOutOfRangeException(nameof(mutation), mutation, null)
        };

        using var response = await client.PostAsync("/run", Json(json));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    private static async Task<WebApplication> StartBindingAppAsync()
    {
        var builder = WebApplication.CreateSlimBuilder();
        builder.WebHost.UseKestrel().UseUrls("http://127.0.0.1:0");
        builder.Services.Configure<JsonOptions>(options => GatewayJson.Configure(options.SerializerOptions));
        var app = builder.Build();
        app.MapPost("/run", (ActionProgramRunStartRequest request) => Results.Ok(request));
        await app.StartAsync();
        return app;
    }

    private static HttpClient CreateClient(WebApplication app)
    {
        var server = app.Services.GetRequiredService<IServer>();
        var addresses = server.Features.Get<IServerAddressesFeature>()
            ?? throw new InvalidOperationException("Kestrel addresses are unavailable");
        return new HttpClient { BaseAddress = new Uri(addresses.Addresses.Single(), UriKind.Absolute) };
    }

    private static StringContent Json(string value) =>
        new(value, Encoding.UTF8, "application/json");

    private static string ValidRequestJson() => """
        {
          "contractVersion":"1.0",
          "runId":"run-http",
          "programId":"program-http",
          "revision":1,
          "sessionId":"session-http",
          "profileId":"dummy-6dof",
          "source":"authored",
          "speedDegS":20,
          "loopEnabled":false,
          "waypoints":[{
            "waypointId":"point-1",
            "name":"Point 1",
            "positionsDeg":[0,0,0,0,0,0],
            "mode":2,
            "postDispatchWaitMs":0,
            "source":"manual"
          }]
        }
        """;

    private sealed class EmptyEngineeringActionPort : IEngineeringActionProgramCommandPort
    {
        public event Action<string>? SessionTerminated { add { } remove { } }
        public double MaximumSpeedDegS => 100;
        public RobotSessionSnapshot GetSession() => throw new NotSupportedException();
        public JointStateFrame GetJointState() => throw new NotSupportedException();
        public bool TryBeginActionRun(string runId, string sessionId) => false;
        public void EndActionRun(string runId) { }
        public Task<DirectCommandResult> SendActionDirectAndAwaitTerminalAsync(
            string runId,
            DirectCommandRequest request,
            CancellationToken cancellationToken) => throw new NotSupportedException();
    }
}
