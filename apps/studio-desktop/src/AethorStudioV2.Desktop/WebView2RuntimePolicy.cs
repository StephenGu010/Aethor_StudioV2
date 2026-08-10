using Microsoft.Web.WebView2.Core;

namespace AethorStudioV2.Desktop;

public enum WebView2RuntimeProbeStatus
{
    Available,
    Missing,
    UnsupportedChannel,
    InvalidVersion,
    ProbeFailed
}

public sealed record WebView2RuntimeProbeResult(
    WebView2RuntimeProbeStatus Status,
    string? Version,
    string? Detail)
{
    public bool IsAvailable => Status == WebView2RuntimeProbeStatus.Available;
}

public static class WebView2RuntimePolicy
{
    public static CoreWebView2EnvironmentOptions CreateStableEnvironmentOptions() => new()
    {
        ReleaseChannels = CoreWebView2ReleaseChannels.Stable,
        ChannelSearchKind = CoreWebView2ChannelSearchKind.MostStable
    };

    public static WebView2RuntimeProbeResult Probe(Func<string> readVersion)
    {
        ArgumentNullException.ThrowIfNull(readVersion);
        try
        {
            return EvaluateVersionString(readVersion());
        }
        catch (WebView2RuntimeNotFoundException exception)
        {
            return new(WebView2RuntimeProbeStatus.Missing, null, exception.Message);
        }
        catch (Exception exception)
        {
            return new(
                WebView2RuntimeProbeStatus.ProbeFailed,
                null,
                $"{exception.GetType().Name}: {exception.Message}");
        }
    }

    public static WebView2RuntimeProbeResult EvaluateVersionString(string? value)
    {
        var candidate = value?.Trim();
        if (string.IsNullOrEmpty(candidate))
        {
            return new(WebView2RuntimeProbeStatus.InvalidVersion, null, "Runtime returned an empty version string");
        }

        var versionParts = candidate.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (versionParts.Length != 1)
        {
            return new(
                WebView2RuntimeProbeStatus.UnsupportedChannel,
                candidate,
                "Only the stable WebView2 Runtime channel is permitted");
        }

        if (!Version.TryParse(candidate, out var parsed) || parsed.Major <= 0)
        {
            return new(WebView2RuntimeProbeStatus.InvalidVersion, candidate, "Runtime returned an invalid version string");
        }

        return new(WebView2RuntimeProbeStatus.Available, candidate, null);
    }
}
