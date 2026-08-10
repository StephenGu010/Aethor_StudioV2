namespace AethorStudioV2.Desktop.Tests;

public sealed class ApplicationDataPathsTests : IDisposable
{
    private readonly string root = Path.Combine(Path.GetTempPath(), "aethor-desktop-tests", Guid.NewGuid().ToString("N"));

    [Fact]
    public void InitializeCreatesVersionedOwnedDirectoriesAndIsIdempotent()
    {
        var paths = ApplicationDataPaths.Create(root);

        paths.Initialize();
        paths.Initialize();

        Assert.All(
            new[] { paths.Root, paths.Logs, paths.WebView2, paths.RobotProfiles, paths.CrashDumps, paths.Temp },
            path => Assert.True(Directory.Exists(path), path));
        Assert.Equal(
            ApplicationDataPaths.CurrentLayoutVersion.ToString(System.Globalization.CultureInfo.InvariantCulture),
            File.ReadAllText(Path.Combine(root, "data-layout.version")).Trim());
    }

    [Fact]
    public void InitializeFailsClosedForAnUnknownLayoutVersion()
    {
        Directory.CreateDirectory(root);
        File.WriteAllText(Path.Combine(root, "data-layout.version"), "999");
        var paths = ApplicationDataPaths.Create(root);

        var error = Assert.Throws<InvalidOperationException>(paths.Initialize);

        Assert.Contains("999", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void CreateRejectsRelativeRoots()
    {
        Assert.Throws<ArgumentException>(() => ApplicationDataPaths.Create("relative-data"));
    }

    public void Dispose()
    {
        if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
    }
}
