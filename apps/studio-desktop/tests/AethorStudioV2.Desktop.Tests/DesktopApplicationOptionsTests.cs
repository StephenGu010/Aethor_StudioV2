namespace AethorStudioV2.Desktop.Tests;

public sealed class DesktopApplicationOptionsTests : IDisposable
{
    private readonly string root = Path.Combine(Path.GetTempPath(), "aethor-options-tests", Guid.NewGuid().ToString("N"));

    public DesktopApplicationOptionsTests()
    {
        Directory.CreateDirectory(Path.Combine(root, "web"));
        File.WriteAllText(Path.Combine(root, "web", "index.html"), "<!doctype html>");
    }

    [Fact]
    public void ParseUsesPackagedWebRootAndExplicitOfflineMode()
    {
        var options = DesktopApplicationOptions.Parse(["--offline"], root);

        Assert.Equal(Path.Combine(root, "web"), options.WebRoot);
        Assert.Null(options.GatewayExecutable);
        Assert.Equal(TimeSpan.FromSeconds(15), options.GatewayStartupTimeout);
        Assert.Equal(DesktopGatewayMode.Disabled, options.GatewayMode);
    }

    [Fact]
    public void ParseResolvesRelativeOverridesAgainstTheApplicationDirectory()
    {
        var alternateWeb = Path.Combine(root, "alternate-web");
        var gateway = Path.Combine(root, "tools", "gateway.exe");
        Directory.CreateDirectory(alternateWeb);
        Directory.CreateDirectory(Path.GetDirectoryName(gateway)!);
        File.WriteAllText(Path.Combine(alternateWeb, "index.html"), "<!doctype html>");
        File.WriteAllBytes(gateway, [0]);

        var options = DesktopApplicationOptions.Parse(
            ["--web-root", "alternate-web", "--gateway-path", "tools/gateway.exe", "--gateway-timeout-seconds", "7"],
            root);

        Assert.Equal(alternateWeb, options.WebRoot);
        Assert.Equal(gateway, options.GatewayExecutable);
        Assert.Equal(TimeSpan.FromSeconds(7), options.GatewayStartupTimeout);
        Assert.Equal(DesktopGatewayMode.Disabled, options.GatewayMode);
    }

    [Fact]
    public void ParseEnablesEngineeringOnlyWhenExplicitlyRequestedAndGatewayExists()
    {
        var gateway = Path.Combine(root, "gateway", "AethorStudioV2.Api.exe");
        Directory.CreateDirectory(Path.GetDirectoryName(gateway)!);
        File.WriteAllBytes(gateway, [0]);

        var options = DesktopApplicationOptions.Parse(["--engineering"], root);

        Assert.Equal(gateway, options.GatewayExecutable);
        Assert.Equal(DesktopGatewayMode.Engineering, options.GatewayMode);
    }

    [Theory]
    [InlineData("--unknown")]
    [InlineData("--offline", "--offline")]
    [InlineData("--web-root")]
    [InlineData("--gateway-timeout-seconds", "0")]
    [InlineData("--gateway-timeout-seconds", "61")]
    [InlineData("--gateway-timeout-seconds", "slow")]
    [InlineData("--offline", "--gateway-path", "gateway.exe")]
    [InlineData("--offline", "--engineering")]
    [InlineData("--engineering", "--engineering")]
    public void ParseRejectsAmbiguousOrInvalidArguments(params string[] args)
    {
        Assert.ThrowsAny<ArgumentException>(() => DesktopApplicationOptions.Parse(args, root));
    }

    [Fact]
    public void ParseRejectsAnExplicitMissingGateway()
    {
        Assert.Throws<FileNotFoundException>(() => DesktopApplicationOptions.Parse(
            ["--gateway-path", "missing.exe"],
            root));
    }

    [Fact]
    public void ParseFallsBackOfflineWhenThePackagedGatewayIsAbsent()
    {
        var options = DesktopApplicationOptions.Parse([], root);

        Assert.Null(options.GatewayExecutable);
        Assert.Equal(DesktopGatewayMode.Disabled, options.GatewayMode);
    }

    [Fact]
    public void ParseRejectsEngineeringWhenThePackagedGatewayIsAbsent()
    {
        Assert.Throws<FileNotFoundException>(() => DesktopApplicationOptions.Parse(["--engineering"], root));
    }

    public void Dispose()
    {
        if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
    }
}
