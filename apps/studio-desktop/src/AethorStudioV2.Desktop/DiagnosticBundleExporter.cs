using System.IO.Compression;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace AethorStudioV2.Desktop;

public sealed record DiagnosticBundleContext(
    DateTimeOffset CreatedUtc,
    string ProductVersion,
    string DesktopMode,
    string? UserProfilePath);

public sealed record DiagnosticBundleExportResult(
    long BundleBytes,
    int LogFileCount,
    long UncompressedLogBytes);

public static class DiagnosticBundleExporter
{
    public const string SchemaVersion = "aethor.diagnostics.bundle.v1";
    public const long MaximumLogFileBytes = 6 * 1024 * 1024;
    public const long MaximumTotalLogBytes = 30 * 1024 * 1024;
    public const int MaximumLogFiles = 5;

    private static readonly string[] LogFileOrder =
        ["desktop.log", "desktop.log.1", "desktop.log.2", "desktop.log.3", "desktop.log.4"];
    private static readonly HashSet<string> AllowedLogFileNames = new(LogFileOrder, StringComparer.OrdinalIgnoreCase);
    private static readonly UTF8Encoding Utf8WithoutBom = new(encoderShouldEmitUTF8Identifier: false);
    private static readonly JsonSerializerOptions ManifestJsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true
    };
    private static readonly Regex[] SecretPatterns =
    [
        CreateSecretPattern("(\\\"sessionToken\\\"\\s*:\\s*\\\")[^\\\"]*(\\\")"),
        CreateSecretPattern("(\\\\\\\"sessionToken\\\\\\\"\\s*:\\s*\\\\\\\")[^\\\\]*(\\\\\\\")"),
        CreateSecretPattern("(\\baccess_token\\s*[=:]\\s*)[^&\\s\\\"'\\\\]+()"),
        CreateSecretPattern("(\\bAuthorization\\s*[:=]\\s*Bearer\\s+)[^\\s\\\"',;]+()"),
        CreateSecretPattern("(\\bX-Aethor-Session\\s*[:=]\\s*)[^\\s\\\"',;]+()"),
        CreateSecretPattern("(\\bAETHOR_GATEWAY_SESSION_TOKEN\\s*=\\s*)[^\\s\\\"',;]+()")
    ];

    public static DiagnosticBundleExportResult Export(
        string destinationPath,
        IReadOnlyList<BoundedLogSnapshotFile> snapshot,
        DiagnosticBundleContext context,
        bool overwrite,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(destinationPath);
        ArgumentNullException.ThrowIfNull(snapshot);
        ArgumentNullException.ThrowIfNull(context);
        if (!Path.IsPathFullyQualified(destinationPath))
        {
            throw new ArgumentException("Diagnostic bundle destination must be absolute", nameof(destinationPath));
        }
        if (!Path.GetExtension(destinationPath).Equals(".zip", StringComparison.OrdinalIgnoreCase))
        {
            throw new ArgumentException("Diagnostic bundle destination must use the .zip extension", nameof(destinationPath));
        }
        ValidateContext(context);
        cancellationToken.ThrowIfCancellationRequested();

        var destination = Path.GetFullPath(destinationPath);
        var parent = Path.GetDirectoryName(destination)
            ?? throw new ArgumentException("Diagnostic bundle destination has no parent", nameof(destinationPath));
        if (!Directory.Exists(parent))
        {
            throw new DirectoryNotFoundException("Diagnostic bundle destination directory does not exist");
        }
        if (!overwrite && File.Exists(destination))
        {
            throw new IOException("Diagnostic bundle destination already exists");
        }

        var logs = PrepareLogs(snapshot, context.UserProfilePath, cancellationToken);
        var createdUtc = NormalizeZipTimestamp(context.CreatedUtc);
        var manifest = BuildManifest(context, logs);
        var temporary = Path.Combine(
            parent,
            $".{Path.GetFileName(destination)}.{Guid.NewGuid():N}.tmp");
        var moved = false;
        try
        {
            using (var stream = new FileStream(
                temporary,
                FileMode.CreateNew,
                FileAccess.ReadWrite,
                FileShare.None,
                64 * 1024,
                FileOptions.SequentialScan))
            {
                using (var archive = new ZipArchive(stream, ZipArchiveMode.Create, leaveOpen: true, Utf8WithoutBom))
                {
                    WriteTextEntry(archive, "README.txt", BuildReadme(), createdUtc, cancellationToken);
                    WriteBytesEntry(archive, "manifest.json", manifest, createdUtc, cancellationToken);
                    foreach (var log in logs)
                    {
                        WriteBytesEntry(archive, log.ArchivePath, log.Content, createdUtc, cancellationToken);
                    }
                }
                stream.Flush(flushToDisk: true);
            }

            cancellationToken.ThrowIfCancellationRequested();
            File.Move(temporary, destination, overwrite);
            moved = true;
            return new(
                new FileInfo(destination).Length,
                logs.Length,
                logs.Sum(log => (long)log.Content.Length));
        }
        finally
        {
            if (!moved && File.Exists(temporary)) File.Delete(temporary);
        }
    }

    private static PreparedLog[] PrepareLogs(
        IReadOnlyList<BoundedLogSnapshotFile> snapshot,
        string? userProfilePath,
        CancellationToken cancellationToken)
    {
        if (snapshot.Count > MaximumLogFiles)
        {
            throw new InvalidDataException($"Diagnostic snapshot cannot contain more than {MaximumLogFiles} log files");
        }

        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var logs = new List<PreparedLog>(snapshot.Count);
        long totalBytes = 0;
        foreach (var file in snapshot)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (!AllowedLogFileNames.Contains(file.Name)
                || file.Name.Contains('/')
                || file.Name.Contains('\\'))
            {
                throw new InvalidDataException($"Unexpected diagnostic log name: {file.Name}");
            }
            if (!seen.Add(file.Name))
            {
                throw new InvalidDataException($"Duplicate diagnostic log name: {file.Name}");
            }
            if (file.Content.LongLength > MaximumLogFileBytes)
            {
                throw new InvalidDataException($"Diagnostic log exceeds {MaximumLogFileBytes} bytes: {file.Name}");
            }

            var redacted = Redact(file.Content, userProfilePath);
            totalBytes = checked(totalBytes + redacted.LongLength);
            if (totalBytes > MaximumTotalLogBytes)
            {
                throw new InvalidDataException($"Diagnostic logs exceed {MaximumTotalLogBytes} bytes in total");
            }
            logs.Add(new(
                $"logs/{file.Name.ToLowerInvariant()}",
                redacted,
                Convert.ToHexString(SHA256.HashData(redacted))));
        }

        return logs
            .OrderBy(log => Array.IndexOf(LogFileOrder, Path.GetFileName(log.ArchivePath)))
            .ToArray();
    }

    private static byte[] Redact(byte[] content, string? userProfilePath)
    {
        var value = Encoding.UTF8.GetString(content);
        if (!string.IsNullOrWhiteSpace(userProfilePath))
        {
            var normalized = Path.GetFullPath(userProfilePath);
            value = ReplaceIgnoreCase(value, normalized, "[USER_PROFILE]");
            value = ReplaceIgnoreCase(value, normalized.Replace('\\', '/'), "[USER_PROFILE]");
            value = ReplaceIgnoreCase(value, normalized.Replace("\\", "\\\\", StringComparison.Ordinal), "[USER_PROFILE]");
        }
        foreach (var pattern in SecretPatterns)
        {
            value = pattern.Replace(value, "$1[REDACTED]$2");
        }
        return Utf8WithoutBom.GetBytes(value);
    }

    private static byte[] BuildManifest(DiagnosticBundleContext context, IReadOnlyList<PreparedLog> logs)
    {
        var manifest = new
        {
            schemaVersion = SchemaVersion,
            createdUtc = context.CreatedUtc.ToUniversalTime(),
            product = new { name = "Aethor Studio V2", version = context.ProductVersion },
            runtime = new
            {
                desktopMode = context.DesktopMode,
                osDescription = RuntimeInformation.OSDescription,
                osArchitecture = RuntimeInformation.OSArchitecture.ToString(),
                processArchitecture = RuntimeInformation.ProcessArchitecture.ToString(),
                frameworkDescription = RuntimeInformation.FrameworkDescription
            },
            contents = new
            {
                includes = new[] { "redacted bounded desktop/gateway/WebView logs", "runtime summary" },
                excludes = new[]
                {
                    "serial terminal and protocol history",
                    "command audit and joint targets",
                    "robot profiles and model assets",
                    "session tokens and user paths"
                }
            },
            logs = logs.Select(log => new
            {
                path = log.ArchivePath,
                bytes = log.Content.Length,
                sha256 = log.Sha256
            })
        };
        return JsonSerializer.SerializeToUtf8Bytes(manifest, ManifestJsonOptions);
    }

    private static string BuildReadme() =>
        "Aethor Studio V2 diagnostic bundle\r\n"
        + "\r\n"
        + "This archive contains a redacted snapshot of bounded Desktop, WebView2, and Gateway logs, plus a runtime summary.\r\n"
        + "It does not include terminal/protocol exports, command audit, joint targets, robot profiles, model assets, or WebView user data.\r\n"
        + "The archive is diagnostic evidence only; it does not prove that a robot command completed or that hardware was in a particular state.\r\n";

    private static void WriteTextEntry(
        ZipArchive archive,
        string path,
        string value,
        DateTimeOffset timestamp,
        CancellationToken cancellationToken) =>
        WriteBytesEntry(archive, path, Utf8WithoutBom.GetBytes(value), timestamp, cancellationToken);

    private static void WriteBytesEntry(
        ZipArchive archive,
        string path,
        byte[] content,
        DateTimeOffset timestamp,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var entry = archive.CreateEntry(path, CompressionLevel.Fastest);
        entry.LastWriteTime = timestamp;
        using var output = entry.Open();
        output.Write(content);
    }

    private static DateTimeOffset NormalizeZipTimestamp(DateTimeOffset value)
    {
        var utc = value.ToUniversalTime();
        var minimum = new DateTimeOffset(1980, 1, 1, 0, 0, 0, TimeSpan.Zero);
        var maximum = new DateTimeOffset(2107, 12, 31, 23, 59, 58, TimeSpan.Zero);
        return utc < minimum ? minimum : utc > maximum ? maximum : utc;
    }

    private static void ValidateContext(DiagnosticBundleContext context)
    {
        if (string.IsNullOrWhiteSpace(context.ProductVersion) || context.ProductVersion.Length > 64)
        {
            throw new ArgumentException("Diagnostic product version must contain 1 through 64 characters", nameof(context));
        }
        if (context.DesktopMode is not ("offline" or "disabled" or "engineering"))
        {
            throw new ArgumentException("Diagnostic desktop mode is invalid", nameof(context));
        }
    }

    private static Regex CreateSecretPattern(string pattern) => new(
        pattern,
        RegexOptions.Compiled | RegexOptions.CultureInvariant | RegexOptions.IgnoreCase,
        TimeSpan.FromMilliseconds(100));

    private static string ReplaceIgnoreCase(string value, string search, string replacement) =>
        string.IsNullOrEmpty(search) ? value : value.Replace(search, replacement, StringComparison.OrdinalIgnoreCase);

    private sealed record PreparedLog(string ArchivePath, byte[] Content, string Sha256);
}
