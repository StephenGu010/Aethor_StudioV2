using System.ComponentModel;
using System.Diagnostics;

namespace AethorStudioV2.Desktop;

public sealed record OfflineRestartRequest(string ExecutablePath, string WebRoot);

public static class OfflineRestartLauncher
{
    public static ProcessStartInfo BuildStartInfo(OfflineRestartRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (!Path.IsPathFullyQualified(request.ExecutablePath))
        {
            throw new ArgumentException("Restart executable path must be absolute", nameof(request));
        }
        if (!Path.IsPathFullyQualified(request.WebRoot))
        {
            throw new ArgumentException("Restart web root must be absolute", nameof(request));
        }

        var executablePath = Path.GetFullPath(request.ExecutablePath);
        var webRoot = Path.GetFullPath(request.WebRoot);
        var startInfo = new ProcessStartInfo
        {
            FileName = executablePath,
            WorkingDirectory = Path.GetDirectoryName(executablePath)
                ?? throw new ArgumentException("Restart executable has no parent directory", nameof(request)),
            UseShellExecute = true
        };
        startInfo.ArgumentList.Add("--offline");
        startInfo.ArgumentList.Add("--web-root");
        startInfo.ArgumentList.Add(webRoot);
        return startInfo;
    }

    public static bool TryStart(OfflineRestartRequest request, out string? failure)
    {
        try
        {
            var process = Process.Start(BuildStartInfo(request));
            if (process is null)
            {
                failure = "Windows 未创建新的桌面进程。";
                return false;
            }
            process.Dispose();
            failure = null;
            return true;
        }
        catch (Exception exception) when (exception is Win32Exception or InvalidOperationException or ArgumentException)
        {
            failure = $"{exception.GetType().Name}: {exception.Message}";
            return false;
        }
    }
}
