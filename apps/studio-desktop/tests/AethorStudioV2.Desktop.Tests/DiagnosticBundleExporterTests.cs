using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace AethorStudioV2.Desktop.Tests;

public sealed class DiagnosticBundleExporterTests : IDisposable
{
    private readonly string root = Path.Combine(Path.GetTempPath(), "aethor-diagnostic-tests", Guid.NewGuid().ToString("N"));
    private static readonly DateTimeOffset CreatedUtc = new(2026, 8, 11, 12, 34, 56, TimeSpan.Zero);

    public DiagnosticBundleExporterTests() => Directory.CreateDirectory(root);

    [Fact]
    public void ExportWritesTheExactRedactedBundleAndHashesExportedLogBytes()
    {
        const string tokenA = "secret-token-a";
        const string tokenB = "secret-token-b";
        const string tokenC = "secret-token-c";
        const string tokenD = "secret-token-d";
        const string tokenE = "secret-token-e";
        const string tokenF = "secret-token-f";
        const string operationId = "4854b1bb-813c-4a1c-96c0-9ae0b65558b8";
        const string userProfile = @"C:\Users\Example Operator";
        var destination = Path.Combine(root, "diagnostics.zip");
        var input = Encoding.UTF8.GetBytes(
            $"path={userProfile} json=\"sessionToken\":\"{tokenA}\" access_token={tokenB}&x=1 "
            + $"Authorization: Bearer {tokenC} X-Aethor-Session={tokenD} "
            + $"AETHOR_GATEWAY_SESSION_TOKEN={tokenE} escaped=\\\"sessionToken\\\":\\\"{tokenF}\\\" OperationId={operationId}");
        var snapshot = new[]
        {
            new BoundedLogSnapshotFile("desktop.log.1", Encoding.UTF8.GetBytes("older")),
            new BoundedLogSnapshotFile("desktop.log", input)
        };

        var result = DiagnosticBundleExporter.Export(
            destination,
            snapshot,
            new(CreatedUtc, "0.1.0", "engineering", userProfile),
            overwrite: false);

        Assert.True(result.BundleBytes > 0);
        Assert.Equal(2, result.LogFileCount);
        using var archive = ZipFile.OpenRead(destination);
        Assert.Equal(
            ["README.txt", "manifest.json", "logs/desktop.log", "logs/desktop.log.1"],
            archive.Entries.Select(entry => entry.FullName));
        var exportedLog = ReadBytes(archive, "logs/desktop.log");
        var exportedText = Encoding.UTF8.GetString(exportedLog);
        Assert.Contains("[USER_PROFILE]", exportedText, StringComparison.Ordinal);
        Assert.Contains("[REDACTED]", exportedText, StringComparison.Ordinal);
        Assert.Contains(operationId, exportedText, StringComparison.Ordinal);
        foreach (var secret in new[] { tokenA, tokenB, tokenC, tokenD, tokenE, tokenF, userProfile })
        {
            Assert.DoesNotContain(secret, exportedText, StringComparison.OrdinalIgnoreCase);
        }

        using var manifest = JsonDocument.Parse(ReadBytes(archive, "manifest.json"));
        var rootElement = manifest.RootElement;
        Assert.Equal(DiagnosticBundleExporter.SchemaVersion, rootElement.GetProperty("schemaVersion").GetString());
        Assert.Equal("engineering", rootElement.GetProperty("runtime").GetProperty("desktopMode").GetString());
        Assert.False(rootElement.TryGetProperty("destinationPath", out _));
        Assert.False(rootElement.TryGetProperty("userProfilePath", out _));
        var currentLog = rootElement.GetProperty("logs").EnumerateArray().First();
        Assert.Equal("logs/desktop.log", currentLog.GetProperty("path").GetString());
        Assert.Equal(exportedLog.Length, currentLog.GetProperty("bytes").GetInt32());
        Assert.Equal(Convert.ToHexString(SHA256.HashData(exportedLog)), currentLog.GetProperty("sha256").GetString());
    }

    [Theory]
    [InlineData("relative.zip")]
    [InlineData("diagnostics.txt")]
    public void ExportRejectsUnsafeDestinationShapes(string candidate)
    {
        var destination = Path.IsPathFullyQualified(candidate) ? candidate : candidate == "relative.zip"
            ? candidate
            : Path.Combine(root, candidate);

        Assert.Throws<ArgumentException>(() => DiagnosticBundleExporter.Export(
            destination,
            [],
            Context(),
            overwrite: false));
    }

    [Fact]
    public void ExportRejectsUnknownDuplicateAndOversizedLogInputs()
    {
        var destination = Path.Combine(root, "invalid.zip");
        Assert.Throws<InvalidDataException>(() => DiagnosticBundleExporter.Export(
            destination,
            [new("../desktop.log", [])],
            Context(),
            overwrite: false));
        Assert.Throws<InvalidDataException>(() => DiagnosticBundleExporter.Export(
            destination,
            [new("desktop.log", []), new("DESKTOP.LOG", [])],
            Context(),
            overwrite: false));
        Assert.Throws<InvalidDataException>(() => DiagnosticBundleExporter.Export(
            destination,
            [new("desktop.log", new byte[DiagnosticBundleExporter.MaximumLogFileBytes + 1])],
            Context(),
            overwrite: false));
        Assert.False(File.Exists(destination));
    }

    [Fact]
    public void ExportPreservesAnExistingTargetAndLeavesNoTemporaryFileOnFailureOrCancellation()
    {
        var destination = Path.Combine(root, "existing.zip");
        var original = Encoding.UTF8.GetBytes("existing bundle");
        File.WriteAllBytes(destination, original);

        Assert.Throws<IOException>(() => DiagnosticBundleExporter.Export(
            destination,
            [new("desktop.log", Encoding.UTF8.GetBytes("new"))],
            Context(),
            overwrite: false));
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();
        Assert.Throws<OperationCanceledException>(() => DiagnosticBundleExporter.Export(
            Path.Combine(root, "cancelled.zip"),
            [new("desktop.log", Encoding.UTF8.GetBytes("new"))],
            Context(),
            overwrite: false,
            cancellation.Token));

        Assert.Equal(original, File.ReadAllBytes(destination));
        Assert.False(File.Exists(Path.Combine(root, "cancelled.zip")));
        Assert.Empty(Directory.EnumerateFiles(root, ".*.tmp"));
    }

    [Fact]
    public void ExportReplacesAnExistingTargetOnlyWhenOverwriteIsExplicit()
    {
        var destination = Path.Combine(root, "replace.zip");
        File.WriteAllText(destination, "old");

        DiagnosticBundleExporter.Export(
            destination,
            [new("desktop.log", Encoding.UTF8.GetBytes("new"))],
            Context(),
            overwrite: true);

        using var archive = ZipFile.OpenRead(destination);
        Assert.Equal("new", Encoding.UTF8.GetString(ReadBytes(archive, "logs/desktop.log")));
    }

    private static DiagnosticBundleContext Context() => new(CreatedUtc, "0.1.0", "disabled", null);

    private static byte[] ReadBytes(ZipArchive archive, string path)
    {
        var entry = archive.GetEntry(path) ?? throw new InvalidDataException($"Missing archive entry: {path}");
        using var stream = entry.Open();
        using var output = new MemoryStream();
        stream.CopyTo(output);
        return output.ToArray();
    }

    public void Dispose()
    {
        if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
    }
}
