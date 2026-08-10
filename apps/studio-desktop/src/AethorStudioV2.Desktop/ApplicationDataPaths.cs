namespace AethorStudioV2.Desktop;

public sealed record ApplicationDataPaths(
    string Root,
    string Logs,
    string WebView2,
    string RobotProfiles,
    string CrashDumps,
    string Temp)
{
    public const int CurrentLayoutVersion = 1;
    public string WindowPlacement => Path.Combine(Root, "window-placement.v1.json");

    public static ApplicationDataPaths CreateDefault() => Create(Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Aethor Studio V2"));

    public static ApplicationDataPaths Create(string root)
    {
        if (!Path.IsPathFullyQualified(root))
        {
            throw new ArgumentException("Application data root must be absolute", nameof(root));
        }

        var fullRoot = Path.GetFullPath(root);
        return new(
            fullRoot,
            Path.Combine(fullRoot, "Logs"),
            Path.Combine(fullRoot, "WebView2"),
            Path.Combine(fullRoot, "RobotProfiles"),
            Path.Combine(fullRoot, "CrashDumps"),
            Path.Combine(fullRoot, "Temp"));
    }

    public void Initialize()
    {
        foreach (var path in new[] { Root, Logs, WebView2, RobotProfiles, CrashDumps, Temp })
        {
            Directory.CreateDirectory(path);
        }

        var marker = Path.Combine(Root, "data-layout.version");
        if (File.Exists(marker))
        {
            var existing = File.ReadAllText(marker).Trim();
            if (!string.Equals(
                    existing,
                    CurrentLayoutVersion.ToString(System.Globalization.CultureInfo.InvariantCulture),
                    StringComparison.Ordinal))
            {
                throw new InvalidOperationException($"Unsupported application data layout version: {existing}");
            }
            return;
        }

        File.WriteAllText(
            marker,
            CurrentLayoutVersion.ToString(System.Globalization.CultureInfo.InvariantCulture) + Environment.NewLine);
    }
}
