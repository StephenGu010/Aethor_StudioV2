using AethorStudioV2.Api;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging.Abstractions;

namespace AethorStudioV2.Tests;

public sealed class GatewaySecurityTests
{
    private const string ValidToken = "0123456789abcdef0123456789abcdef";

    [Fact]
    public void TokenValidationUsesExactOpaqueValue()
    {
        var validator = new SessionTokenValidator(ValidToken);
        Assert.True(validator.IsValid(ValidToken));
        Assert.False(validator.IsValid(null));
        Assert.False(validator.IsValid(ValidToken + "x"));
        Assert.False(validator.IsValid("1123456789abcdef0123456789abcdef"));
    }

    [Fact]
    public void HostOptionsAcceptOnlyLoopbackDevelopmentOrigins()
    {
        new GatewayHostOptions(5127, ValidToken, "development", ["http://127.0.0.1:5173", "http://localhost:5173"])
            .Validate(isDevelopment: true);

        Assert.Throws<InvalidOperationException>(() =>
            new GatewayHostOptions(5127, ValidToken, "development", ["http://192.168.1.5:5173"])
                .Validate(isDevelopment: true));
        Assert.Throws<InvalidOperationException>(() =>
            new GatewayHostOptions(5127, ValidToken, "development", ["http://localhost:5173/path"])
                .Validate(isDevelopment: true));
    }

    [Fact]
    public void DevelopmentTokenCannotStartProductionGateway()
    {
        Assert.Throws<InvalidOperationException>(() =>
            new GatewayHostOptions(5127, ValidToken, "development", []).Validate(isDevelopment: false));
        new GatewayHostOptions(5127, ValidToken, "desktop", []).Validate(isDevelopment: false);
    }

    [Fact]
    public void SupervisedCommandsRequireDesktopTokenAndCompleteMotionEnvelopeWhenConfigured()
    {
        Assert.Throws<InvalidOperationException>(() =>
            new GatewayHostOptions(5127, ValidToken, "development", [], AethorStudioV2.Domain.GatewayCommandPolicy.Supervised)
                .Validate(isDevelopment: true));

        new GatewayHostOptions(5127, ValidToken, "desktop", [], AethorStudioV2.Domain.GatewayCommandPolicy.Supervised, 20, 0.25, 250, 10_000)
            .Validate(isDevelopment: true);

        Assert.Throws<InvalidOperationException>(() =>
            new GatewayHostOptions(5127, ValidToken, "desktop", [], AethorStudioV2.Domain.GatewayCommandPolicy.Supervised, 20)
                .Validate(isDevelopment: true));
        Assert.Throws<InvalidOperationException>(() =>
            new GatewayHostOptions(5127, ValidToken, "desktop", [], AethorStudioV2.Domain.GatewayCommandPolicy.Supervised, double.NaN, 0.25, 250, 10_000)
                .Validate(isDevelopment: true));
    }

    [Fact]
    public void EngineeringCommandsRequireDevelopmentEnvironmentAndDevelopmentToken()
    {
        new GatewayHostOptions(
            5127,
            ValidToken,
            "development",
            [],
            AethorStudioV2.Domain.GatewayCommandPolicy.Engineering)
            .Validate(isDevelopment: true);

        Assert.Throws<InvalidOperationException>(() =>
            new GatewayHostOptions(
                5127,
                ValidToken,
                "desktop",
                [],
                AethorStudioV2.Domain.GatewayCommandPolicy.Engineering)
                .Validate(isDevelopment: true));
        Assert.Throws<InvalidOperationException>(() =>
            new GatewayHostOptions(
                5127,
                ValidToken,
                "development",
                [],
                AethorStudioV2.Domain.GatewayCommandPolicy.Engineering)
                .Validate(isDevelopment: false));
    }

    [Theory]
    [InlineData(1023)]
    [InlineData(65536)]
    public void InvalidListenPortIsRejected(int port)
    {
        Assert.Throws<InvalidOperationException>(() =>
            new GatewayHostOptions(port, ValidToken, "development", []).Validate(isDevelopment: true));
    }

    [Fact]
    public async Task ProtectedApiRejectsMissingTokenWithoutCallingTheEndpoint()
    {
        var called = false;
        var middleware = CreateMiddleware(_ =>
        {
            called = true;
            return Task.CompletedTask;
        });
        var context = new DefaultHttpContext();
        context.Request.Path = "/api/v1/session";
        context.Response.Body = new MemoryStream();

        await middleware.InvokeAsync(context);

        Assert.False(called);
        Assert.Equal(StatusCodes.Status401Unauthorized, context.Response.StatusCode);
    }

    [Theory]
    [InlineData("header")]
    [InlineData("bearer")]
    [InlineData("query")]
    public async Task RestHeaderAndSignalRTokenTransportsUseTheSameOpaqueSessionToken(string transport)
    {
        var called = false;
        var middleware = CreateMiddleware(_ =>
        {
            called = true;
            return Task.CompletedTask;
        });
        var context = new DefaultHttpContext();
        if (transport == "header")
        {
            context.Request.Path = "/api/v1/session";
            context.Request.Headers[SessionTokenMiddleware.HeaderName] = ValidToken;
        }
        else
        {
            context.Request.Path = "/hubs/robot-v1/negotiate";
            if (transport == "bearer") context.Request.Headers.Authorization = $"Bearer {ValidToken}";
            else context.Request.QueryString = new QueryString($"?access_token={ValidToken}");
        }

        await middleware.InvokeAsync(context);

        Assert.True(called);
    }

    private static SessionTokenMiddleware CreateMiddleware(RequestDelegate next) => new(
        next,
        new SessionTokenValidator(ValidToken),
        NullLogger<SessionTokenMiddleware>.Instance);
}
