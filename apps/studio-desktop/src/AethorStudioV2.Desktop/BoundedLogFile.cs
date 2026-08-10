using System.Text;

namespace AethorStudioV2.Desktop;

public sealed class BoundedLogFile
{
    private readonly string path;
    private readonly long maximumBytes;
    private readonly int retainedFiles;
    private readonly object gate = new();
    private readonly HashSet<string> secrets = new(StringComparer.Ordinal);

    public BoundedLogFile(string path, long maximumBytes = 5 * 1024 * 1024, int retainedFiles = 4)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(path);
        if (!Path.IsPathFullyQualified(path)) throw new ArgumentException("Log path must be absolute", nameof(path));
        if (maximumBytes < 1024) throw new ArgumentOutOfRangeException(nameof(maximumBytes), "Log size must be at least 1 KiB");
        if (retainedFiles is < 0 or > 20) throw new ArgumentOutOfRangeException(nameof(retainedFiles));
        this.path = Path.GetFullPath(path);
        this.maximumBytes = maximumBytes;
        this.retainedFiles = retainedFiles;
    }

    public void RegisterSecret(string value)
    {
        if (string.IsNullOrEmpty(value)) return;
        lock (gate) secrets.Add(value);
    }

    public void Write(string category, string message)
    {
        var safeCategory = Sanitize(category, 64);
        var safeMessage = Sanitize(message, 8192);
        lock (gate)
        {
            foreach (var secret in secrets) safeMessage = safeMessage.Replace(secret, "[REDACTED]", StringComparison.Ordinal);
            var line = $"{DateTimeOffset.UtcNow:O}\t{safeCategory}\t{safeMessage}{Environment.NewLine}";
            Directory.CreateDirectory(Path.GetDirectoryName(path) ?? throw new InvalidOperationException("Log path has no parent"));
            var bytes = Encoding.UTF8.GetByteCount(line);
            if (File.Exists(path) && new FileInfo(path).Length + bytes > maximumBytes) Rotate();
            File.AppendAllText(path, line, new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
        }
    }

    private void Rotate()
    {
        if (retainedFiles <= 0)
        {
            File.Delete(path);
            return;
        }
        var oldest = $"{path}.{retainedFiles}";
        if (File.Exists(oldest)) File.Delete(oldest);
        for (var index = retainedFiles - 1; index >= 1; index -= 1)
        {
            var source = $"{path}.{index}";
            if (File.Exists(source)) File.Move(source, $"{path}.{index + 1}");
        }
        File.Move(path, $"{path}.1");
    }

    private static string Sanitize(string value, int maximumLength)
    {
        var singleLine = value.Replace('\r', ' ').Replace('\n', ' ').Replace('\t', ' ');
        return singleLine.Length <= maximumLength ? singleLine : singleLine[..maximumLength] + "…";
    }
}
