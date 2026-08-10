namespace AethorStudioV2.Desktop.Tests;

public sealed class OfflineRestartLauncherTests
{
    [Fact]
    public void RestartAlwaysUsesExplicitOfflineModeAndPreservesThePackagedWebRoot()
    {
        var executable = Path.GetFullPath(Path.Combine("package", "AethorStudioV2.Desktop.exe"));
        var webRoot = Path.GetFullPath(Path.Combine("package", "web"));

        var startInfo = OfflineRestartLauncher.BuildStartInfo(new(executable, webRoot));

        Assert.Equal(executable, startInfo.FileName);
        Assert.Equal(Path.GetDirectoryName(executable), startInfo.WorkingDirectory);
        Assert.True(startInfo.UseShellExecute);
        Assert.Equal(new[] { "--offline", "--web-root", webRoot }, startInfo.ArgumentList);
        Assert.DoesNotContain("--gateway-path", startInfo.ArgumentList);
    }

    [Theory]
    [InlineData("relative.exe", "C:\\web")]
    [InlineData("C:\\app.exe", "relative-web")]
    public void RestartRejectsRelativeTrustBoundaryPaths(string executable, string webRoot)
    {
        Assert.Throws<ArgumentException>(() => OfflineRestartLauncher.BuildStartInfo(new(executable, webRoot)));
    }
}
