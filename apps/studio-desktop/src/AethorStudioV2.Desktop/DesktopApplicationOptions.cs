namespace AethorStudioV2.Desktop;

public enum DesktopGatewayMode
{
    Disabled,
    Engineering
}

public sealed record DesktopApplicationOptions(
    string WebRoot,
    string? GatewayExecutable,
    TimeSpan GatewayStartupTimeout,
    DesktopGatewayMode GatewayMode)
{
    public static DesktopApplicationOptions Parse(string[] args, string baseDirectory)
    {
        ArgumentNullException.ThrowIfNull(args);
        ArgumentException.ThrowIfNullOrWhiteSpace(baseDirectory);
        var parsed = ParseArguments(args);
        var root = Path.GetFullPath(baseDirectory);
        var explicitWebRoot = parsed.Values.GetValueOrDefault("--web-root");
        var explicitGateway = parsed.Values.GetValueOrDefault("--gateway-path");
        if (parsed.Offline && explicitGateway is not null)
        {
            throw new ArgumentException("--offline cannot be combined with --gateway-path");
        }
        if (parsed.Offline && parsed.Engineering)
        {
            throw new ArgumentException("--offline cannot be combined with --engineering");
        }
        var timeoutText = parsed.Values.GetValueOrDefault("--gateway-timeout-seconds");
        var timeoutSeconds = 15;
        if (timeoutText is not null
            && (!int.TryParse(
                    timeoutText,
                    System.Globalization.NumberStyles.None,
                    System.Globalization.CultureInfo.InvariantCulture,
                    out timeoutSeconds)
                || timeoutSeconds is < 1 or > 60))
        {
            throw new ArgumentException(
                "--gateway-timeout-seconds must be an integer from 1 through 60 seconds",
                nameof(args));
        }

        var webRoot = ResolveDirectory(ResolvePath(explicitWebRoot ?? "web", root), "web root");
        var gatewayCandidate = ResolvePath(explicitGateway ?? Path.Combine("gateway", "AethorStudioV2.Api.exe"), root);
        string? gateway = parsed.Offline
            ? null
            : File.Exists(gatewayCandidate)
                ? gatewayCandidate
                : explicitGateway is not null
                    ? throw new FileNotFoundException("The explicit gateway executable does not exist", gatewayCandidate)
                    : null;
        if (parsed.Engineering && gateway is null)
        {
            throw new FileNotFoundException(
                "--engineering requires the packaged gateway executable",
                gatewayCandidate);
        }

        return new(
            webRoot,
            gateway,
            TimeSpan.FromSeconds(timeoutSeconds),
            parsed.Engineering ? DesktopGatewayMode.Engineering : DesktopGatewayMode.Disabled);
    }

    private static string ResolveDirectory(string path, string description)
    {
        var resolved = Path.GetFullPath(path);
        if (!Directory.Exists(resolved) || !File.Exists(Path.Combine(resolved, "index.html")))
        {
            throw new DirectoryNotFoundException($"The {description} must exist and contain index.html: {resolved}");
        }
        return resolved;
    }

    private static string ResolvePath(string path, string baseDirectory) =>
        Path.GetFullPath(Path.IsPathFullyQualified(path) ? path : Path.Combine(baseDirectory, path));

    private static ParsedArguments ParseArguments(string[] args)
    {
        var values = new Dictionary<string, string>(StringComparer.Ordinal);
        var offline = false;
        var engineering = false;
        for (var index = 0; index < args.Length; index += 1)
        {
            var name = args[index];
            if (name == "--offline")
            {
                if (offline) throw new ArgumentException("Duplicate option: --offline");
                offline = true;
                continue;
            }
            if (name == "--engineering")
            {
                if (engineering) throw new ArgumentException("Duplicate option: --engineering");
                engineering = true;
                continue;
            }

            if (name is not ("--web-root" or "--gateway-path" or "--gateway-timeout-seconds"))
            {
                throw new ArgumentException($"Unknown option: {name}");
            }
            if (values.ContainsKey(name)) throw new ArgumentException($"Duplicate option: {name}");
            if (index + 1 >= args.Length || args[index + 1].StartsWith("--", StringComparison.Ordinal))
            {
                throw new ArgumentException($"Missing value for {name}");
            }
            values[name] = args[index + 1];
            index += 1;
        }
        return new(values, offline, engineering);
    }

    private sealed record ParsedArguments(
        IReadOnlyDictionary<string, string> Values,
        bool Offline,
        bool Engineering);
}
