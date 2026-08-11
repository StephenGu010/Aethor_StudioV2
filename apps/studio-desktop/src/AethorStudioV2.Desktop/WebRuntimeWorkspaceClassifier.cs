namespace AethorStudioV2.Desktop;

public enum WebRuntimeWorkspace
{
    Unknown,
    Console,
    Scope,
    Terminal,
    Devices,
    Actions
}

public static class WebRuntimeWorkspaceClassifier
{
    public static WebRuntimeWorkspace Classify(string? source)
    {
        if (!Uri.TryCreate(source, UriKind.Absolute, out var uri)
            || uri.Scheme != Uri.UriSchemeHttp
            || !uri.Host.Equals("localhost", StringComparison.OrdinalIgnoreCase)
            || !uri.IsDefaultPort
            || !string.IsNullOrEmpty(uri.UserInfo)
            || (!uri.AbsolutePath.Equals("/", StringComparison.Ordinal)
                && !uri.AbsolutePath.Equals("/index.html", StringComparison.Ordinal)))
        {
            return WebRuntimeWorkspace.Unknown;
        }

        var route = uri.Fragment;
        var queryIndex = route.IndexOf('?', StringComparison.Ordinal);
        if (queryIndex >= 0) route = route[..queryIndex];
        if (route.Length > 2 && route[^1] == '/') route = route[..^1];

        return route switch
        {
            "#/console" or "#/twin" => WebRuntimeWorkspace.Console,
            "#/scope" => WebRuntimeWorkspace.Scope,
            "#/terminal" => WebRuntimeWorkspace.Terminal,
            "#/devices" => WebRuntimeWorkspace.Devices,
            "#/actions" => WebRuntimeWorkspace.Actions,
            _ => WebRuntimeWorkspace.Unknown
        };
    }

    public static bool TryGetLogValue(WebRuntimeWorkspace workspace, out string? value)
    {
        value = workspace switch
        {
            WebRuntimeWorkspace.Unknown => "unknown",
            WebRuntimeWorkspace.Console => "console",
            WebRuntimeWorkspace.Scope => "scope",
            WebRuntimeWorkspace.Terminal => "terminal",
            WebRuntimeWorkspace.Devices => "devices",
            WebRuntimeWorkspace.Actions => "actions",
            _ => null
        };
        return value is not null;
    }
}
