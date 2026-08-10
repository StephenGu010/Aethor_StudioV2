using System.Net.Sockets;

namespace AethorStudioV2.Desktop.Tests;

public sealed class GatewayProcessSupervisorTests : IDisposable
{
    private readonly string root = Path.Combine(Path.GetTempPath(), "aethor-supervisor-tests", Guid.NewGuid().ToString("N"));

    [Fact]
    public void BuildStartInfoUsesASecretSafeProductionLoopbackConfiguration()
    {
        var executable = Path.Combine(root, "gateway.exe");
        const string token = "abcdefghijklmnopqrstuvwxyzABCDEFGH123456789";

        var startInfo = GatewayProcessSupervisor.BuildStartInfo(executable, 54321, token);

        Assert.Equal(Path.GetFullPath(executable), startInfo.FileName);
        Assert.False(startInfo.UseShellExecute);
        Assert.True(startInfo.CreateNoWindow);
        Assert.True(startInfo.RedirectStandardOutput);
        Assert.True(startInfo.RedirectStandardError);
        Assert.Equal(string.Empty, startInfo.Arguments);
        Assert.Equal("Production", startInfo.Environment["ASPNETCORE_ENVIRONMENT"]);
        Assert.Equal("54321", startInfo.Environment["AETHOR_GATEWAY_PORT"]);
        Assert.Equal(token, startInfo.Environment["AETHOR_GATEWAY_SESSION_TOKEN"]);
        Assert.Equal("desktop", startInfo.Environment["AETHOR_GATEWAY_TOKEN_SOURCE"]);
        Assert.Equal("disabled", startInfo.Environment["AETHOR_GATEWAY_COMMAND_POLICY"]);
        Assert.Equal("http://localhost", startInfo.Environment["AETHOR_GATEWAY_DEV_ORIGINS"]);
        Assert.DoesNotContain(token, startInfo.Arguments, StringComparison.Ordinal);
        Assert.False(startInfo.Environment.ContainsKey("HTTP_PROXY"));
        Assert.False(startInfo.Environment.ContainsKey("AETHOR_GATEWAY_JOINT_GROUP_SPEED_LIMIT_DEG_S"));
    }

    [Fact]
    public void BuildStartInfoUsesAnExplicitDevelopmentEngineeringConfiguration()
    {
        var executable = Path.Combine(root, "gateway.exe");
        const string token = "abcdefghijklmnopqrstuvwxyzABCDEFGH123456789";

        var startInfo = GatewayProcessSupervisor.BuildStartInfo(
            executable,
            54321,
            token,
            DesktopGatewayMode.Engineering);

        Assert.Equal("Development", startInfo.Environment["ASPNETCORE_ENVIRONMENT"]);
        Assert.Equal("development", startInfo.Environment["AETHOR_GATEWAY_TOKEN_SOURCE"]);
        Assert.Equal("engineering", startInfo.Environment["AETHOR_GATEWAY_COMMAND_POLICY"]);
        Assert.DoesNotContain(token, startInfo.Arguments, StringComparison.Ordinal);
        Assert.False(startInfo.Environment.ContainsKey("HTTP_PROXY"));
    }

    [Fact]
    public void LoopbackLifecycleRequestsNeverUseEnvironmentOrSystemProxies()
    {
        using var handler = GatewayProcessSupervisor.BuildLoopbackHttpHandler();

        Assert.False(handler.UseProxy);
        Assert.False(handler.AllowAutoRedirect);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(1023)]
    [InlineData(65536)]
    public void BuildStartInfoRejectsNonApplicationPorts(int port)
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => GatewayProcessSupervisor.BuildStartInfo(
            Path.Combine(root, "gateway.exe"),
            port,
            new string('x', 43)));
    }

    [Fact]
    public async Task TryStartReturnsExplicitOfflineFailureWhenGatewayIsMissing()
    {
        var log = new BoundedLogFile(Path.Combine(root, "desktop.log"));
        await using var supervisor = new GatewayProcessSupervisor(
            Path.Combine(root, "missing.exe"),
            TimeSpan.FromSeconds(1),
            log);

        var result = await supervisor.TryStartAsync(CancellationToken.None);

        Assert.False(result.Started);
        Assert.Null(result.Session);
        Assert.Contains("离线", result.Failure, StringComparison.Ordinal);
    }

    [Fact]
    public void LoopbackPortAllocatorReturnsAPortThatCanBeReboundLocally()
    {
        var port = LoopbackPortAllocator.GetAvailablePort();
        using var listener = new TcpListener(System.Net.IPAddress.Loopback, port);

        listener.Start();

        Assert.Equal(port, ((System.Net.IPEndPoint)listener.LocalEndpoint).Port);
    }

    public void Dispose()
    {
        if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
    }
}
