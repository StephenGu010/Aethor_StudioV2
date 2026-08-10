namespace AethorStudioV2.Desktop;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        ApplicationConfiguration.Initialize();
        var restartRequest = RunApplication(args);
        if (restartRequest is null) return;

        if (!OfflineRestartLauncher.TryStart(restartRequest, out var failure))
        {
            MessageBox.Show(
                "无法以离线模式重新启动 Aethor Studio V2。\r\n\r\n" + failure,
                "Aethor Studio V2",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        }
    }

    private static OfflineRestartRequest? RunApplication(string[] args)
    {
        using var singleInstance = new SingleInstanceCoordinator();
        if (!singleInstance.IsPrimary) return null;

        ApplicationDataPaths? paths = null;
        BoundedLogFile? log = null;
        GatewayProcessSupervisor? supervisor = null;
        OfflineRestartRequest? restartRequest = null;
        try
        {
            paths = ApplicationDataPaths.CreateDefault();
            paths.Initialize();
            log = new BoundedLogFile(Path.Combine(paths.Logs, "desktop.log"));
            var options = DesktopApplicationOptions.Parse(args, AppContext.BaseDirectory);
            supervisor = options.GatewayExecutable is null
                ? null
                : new GatewayProcessSupervisor(
                    options.GatewayExecutable,
                    options.GatewayStartupTimeout,
                    log,
                    options.GatewayMode);
            using var form = new DesktopMainForm(options, paths, supervisor, log);
            singleInstance.Attach(form);
            Application.Run(form);
            if (form.OfflineRestartRequested && Environment.ProcessPath is { } executablePath)
            {
                restartRequest = new(executablePath, options.WebRoot);
            }
        }
        catch (Exception exception)
        {
            log?.Write("desktop", $"Fatal desktop error: {exception.GetType().Name}: {exception.Message}");
            MessageBox.Show(
                "Aethor Studio V2 无法启动。\r\n\r\n" + exception.Message
                    + (paths is null ? string.Empty : "\r\n\r\n日志目录：" + paths.Logs),
                "Aethor Studio V2",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        }
        finally
        {
            if (supervisor is not null) supervisor.DisposeAsync().AsTask().GetAwaiter().GetResult();
        }
        return restartRequest;
    }
}
