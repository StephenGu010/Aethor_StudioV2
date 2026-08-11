namespace AethorStudioV2.Desktop.Tests;

public sealed class BoundedLogFileTests : IDisposable
{
    private readonly string root = Path.Combine(Path.GetTempPath(), "aethor-log-tests", Guid.NewGuid().ToString("N"));

    [Fact]
    public void WriteRedactsRegisteredSecretsAndFlattensUntrustedText()
    {
        var path = Path.Combine(root, "desktop.log");
        const string secret = "this-is-a-session-secret-value";
        var log = new BoundedLogFile(path);
        log.RegisterSecret(secret);

        log.Write("gateway\nstdout", $"token={secret}\r\nnext");
        var content = File.ReadAllText(path);

        Assert.DoesNotContain(secret, content, StringComparison.Ordinal);
        Assert.Contains("[REDACTED]", content, StringComparison.Ordinal);
        Assert.DoesNotContain("gateway\nstdout", content, StringComparison.Ordinal);
        Assert.DoesNotContain("\r\nnext", content, StringComparison.Ordinal);
    }

    [Fact]
    public void WriteRotatesWithinTheConfiguredFileBound()
    {
        var path = Path.Combine(root, "desktop.log");
        var log = new BoundedLogFile(path, maximumBytes: 1024, retainedFiles: 2);

        for (var index = 0; index < 60; index += 1) log.Write("test", new string('x', 100));

        Assert.True(File.Exists(path));
        Assert.True(File.Exists(path + ".1"));
        Assert.True(File.Exists(path + ".2"));
        Assert.False(File.Exists(path + ".3"));
        Assert.True(new FileInfo(path).Length <= 1200);
    }

    [Fact]
    public void CaptureSnapshotUsesAStableRotationOrderAndRedactsSecretsRegisteredAfterWrite()
    {
        var path = Path.Combine(root, "desktop.log");
        const string secret = "late-registered-secret-value";
        var log = new BoundedLogFile(path, maximumBytes: 1024, retainedFiles: 2);
        log.Write("test", secret);
        for (var index = 0; index < 30; index += 1) log.Write("test", $"line-{index}-{new string('x', 80)}");
        File.AppendAllText(path + ".2", secret);
        log.RegisterSecret(secret);

        var snapshot = log.CaptureSnapshot();

        Assert.Equal(["desktop.log", "desktop.log.1", "desktop.log.2"], snapshot.Select(file => file.Name));
        Assert.DoesNotContain(secret, string.Concat(snapshot.Select(file => System.Text.Encoding.UTF8.GetString(file.Content))), StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(0, 1)]
    [InlineData(1023, 1)]
    [InlineData(1024, -1)]
    [InlineData(1024, 21)]
    public void ConstructorRejectsUnsafeBounds(long maximumBytes, int retainedFiles)
    {
        Assert.ThrowsAny<ArgumentOutOfRangeException>(() => new BoundedLogFile(
            Path.Combine(root, "desktop.log"),
            maximumBytes,
            retainedFiles));
    }

    public void Dispose()
    {
        if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
    }
}
