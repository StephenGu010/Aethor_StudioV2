using System.ComponentModel;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace AethorStudioV2.Desktop;

public sealed class DesktopMainForm : Form
{
    private const string AppHost = "localhost";
    private const int WindowNcHitTest = 0x0084;
    private const int HitClient = 1;
    private const int HitLeft = 10;
    private const int HitRight = 11;
    private const int HitTop = 12;
    private const int HitTopLeft = 13;
    private const int HitTopRight = 14;
    private const int HitBottom = 15;
    private const int HitBottomLeft = 16;
    private const int HitBottomRight = 17;
    private readonly DesktopApplicationOptions options;
    private readonly ApplicationDataPaths paths;
    private readonly GatewayProcessSupervisor? gatewaySupervisor;
    private readonly GatewayRecoveryPolicy gatewayRecovery = new();
    private readonly BoundedLogFile log;
    private readonly CancellationTokenSource lifetimeCancellation = new();
    private readonly CancellationToken lifetimeToken;
    private readonly WebView2 webView = new() { Dock = DockStyle.Fill, Visible = false, AllowExternalDrop = false };
    private readonly Panel statusPanel = new() { Dock = DockStyle.Fill, BackColor = Color.FromArgb(10, 12, 14) };
    private readonly TableLayoutPanel statusLayout = new()
    {
        Dock = DockStyle.Fill,
        BackColor = Color.Transparent,
        ColumnCount = 1,
        RowCount = 5
    };
    private readonly PictureBox statusMark = new()
    {
        Dock = DockStyle.Fill,
        SizeMode = PictureBoxSizeMode.Zoom,
        Margin = new Padding(24, 0, 24, 0)
    };
    private readonly Label statusLabel = new()
    {
        AutoSize = false,
        Dock = DockStyle.Fill,
        ForeColor = Color.FromArgb(188, 194, 199),
        Font = new Font("Segoe UI Variable Text", 11F, FontStyle.Regular, GraphicsUnit.Point),
        TextAlign = ContentAlignment.MiddleCenter,
        Padding = new Padding(24)
    };
    private readonly Button recoveryButton = new()
    {
        AutoSize = true,
        Anchor = AnchorStyles.None,
        BackColor = Color.FromArgb(238, 240, 242),
        ForeColor = Color.FromArgb(17, 20, 23),
        FlatStyle = FlatStyle.Flat,
        Font = new Font("Segoe UI Variable Text", 10F, FontStyle.Bold, GraphicsUnit.Point),
        Padding = new Padding(22, 8, 22, 8),
        Text = "以离线模式重新启动",
        Visible = false,
        UseVisualStyleBackColor = false
    };
    private readonly Button failureCloseButton = new()
    {
        AutoSize = true,
        BackColor = Color.FromArgb(35, 39, 43),
        ForeColor = Color.FromArgb(220, 224, 227),
        FlatStyle = FlatStyle.Flat,
        Font = new Font("Segoe UI Variable Text", 10F, FontStyle.Bold, GraphicsUnit.Point),
        Margin = new Padding(8, 0, 8, 0),
        Padding = new Padding(22, 8, 22, 8),
        Text = "安全关闭应用",
        Visible = false,
        UseVisualStyleBackColor = false
    };
    private readonly FlowLayoutPanel statusActions = new()
    {
        Anchor = AnchorStyles.None,
        AutoSize = true,
        AutoSizeMode = AutoSizeMode.GrowAndShrink,
        BackColor = Color.Transparent,
        FlowDirection = FlowDirection.LeftToRight,
        WrapContents = false
    };
    private bool shutdownApproved;
    private bool closePreparationRunning;
    private bool restoreMaximized;
    private bool lifetimeDisposed;
    private bool webViewStartupCompleted;
    private Image? splashImage;
    private CoreWebView2DevToolsProtocolEventReceiver? exceptionReceiver;
    private CoreWebView2DevToolsProtocolEventReceiver? logReceiver;

    public bool OfflineRestartRequested =>
        gatewayRecovery.State == GatewayRecoveryState.OfflineRestartRequested;

    public DesktopMainForm(
        DesktopApplicationOptions options,
        ApplicationDataPaths paths,
        GatewayProcessSupervisor? gatewaySupervisor,
        BoundedLogFile log)
    {
        this.options = options;
        this.paths = paths;
        this.gatewaySupervisor = gatewaySupervisor;
        this.log = log;
        lifetimeToken = lifetimeCancellation.Token;

        Text = "Aethor Studio V2";
        FormBorderStyle = FormBorderStyle.None;
        BackColor = Color.FromArgb(10, 12, 14);
        AutoScaleMode = AutoScaleMode.Dpi;
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(1600, 940);
        MinimumSize = new Size(1120, 720);
        RestoreWindowPlacement();
        statusLabel.Text = "AETHOR STUDIO V2\r\n\r\n正在启动本机工作台…";
        statusLayout.RowStyles.Add(new(SizeType.Percent, 50));
        statusLayout.RowStyles.Add(new(SizeType.Absolute, 144));
        statusLayout.RowStyles.Add(new(SizeType.Absolute, 128));
        statusLayout.RowStyles.Add(new(SizeType.Absolute, 64));
        statusLayout.RowStyles.Add(new(SizeType.Percent, 50));
        statusLayout.Controls.Add(statusMark, 0, 1);
        statusLayout.Controls.Add(statusLabel, 0, 2);
        statusActions.Controls.Add(recoveryButton);
        statusActions.Controls.Add(failureCloseButton);
        statusLayout.Controls.Add(statusActions, 0, 3);
        statusPanel.Controls.Add(statusLayout);
        LoadSplashImage();
        Controls.Add(webView);
        Controls.Add(statusPanel);
        recoveryButton.FlatAppearance.BorderSize = 0;
        failureCloseButton.FlatAppearance.BorderColor = Color.FromArgb(72, 78, 84);
        failureCloseButton.FlatAppearance.BorderSize = 1;
        recoveryButton.Click += HandleOfflineRestartClick;
        failureCloseButton.Click += HandleFailureCloseClick;

        Shown += async (_, _) =>
        {
            if (restoreMaximized) WindowState = FormWindowState.Maximized;
            await StartAsync().ConfigureAwait(true);
        };
        FormClosing += HandleFormClosing;
        FormClosed += (_, _) => SaveWindowPlacement();
        if (gatewaySupervisor is not null)
        {
            gatewaySupervisor.UnexpectedExit += HandleGatewayUnexpectedExit;
        }
        DpiChanged += (_, eventArgs) => log.Write(
            "desktop",
            $"Window DPI changed from {eventArgs.DeviceDpiOld} to {eventArgs.DeviceDpiNew}");
    }

    protected override void WndProc(ref Message m)
    {
        base.WndProc(ref m);
        if (m.Msg != WindowNcHitTest || WindowState == FormWindowState.Maximized || (int)m.Result != HitClient) return;

        var cursor = PointToClient(Cursor.Position);
        var border = DesktopDpiPolicy.GetResizeBorderPixels(DeviceDpi);
        var left = cursor.X <= border;
        var right = cursor.X >= ClientSize.Width - border;
        var top = cursor.Y <= border;
        var bottom = cursor.Y >= ClientSize.Height - border;
        m.Result = (nint)(top && left ? HitTopLeft
            : top && right ? HitTopRight
            : bottom && left ? HitBottomLeft
            : bottom && right ? HitBottomRight
            : left ? HitLeft
            : right ? HitRight
            : top ? HitTop
            : bottom ? HitBottom
            : HitClient);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            if (!lifetimeDisposed)
            {
                lifetimeDisposed = true;
                if (!lifetimeCancellation.IsCancellationRequested) lifetimeCancellation.Cancel();
                lifetimeCancellation.Dispose();
            }
            statusMark.Image = null;
            splashImage?.Dispose();
            recoveryButton.Click -= HandleOfflineRestartClick;
            failureCloseButton.Click -= HandleFailureCloseClick;
            if (gatewaySupervisor is not null) gatewaySupervisor.UnexpectedExit -= HandleGatewayUnexpectedExit;
        }
        base.Dispose(disposing);
    }

    private async Task StartAsync()
    {
        GatewayRuntimeSession? gateway = null;
        try
        {
            statusLabel.Text = "AETHOR STUDIO V2\r\n\r\n正在检查 WebView2 Stable Runtime…";
            var environmentOptions = WebView2RuntimePolicy.CreateStableEnvironmentOptions();
            var runtime = WebView2RuntimePolicy.Probe(() =>
                CoreWebView2Environment.GetAvailableBrowserVersionString(null, environmentOptions));
            if (!runtime.IsAvailable)
            {
                ShowWebView2RuntimeFailure(runtime);
                return;
            }

            log.Write("desktop", $"WebView2 Stable Runtime detected: {runtime.Version}");
            statusLabel.Text = "AETHOR STUDIO V2\r\n\r\n正在初始化 WebView2…";
            var environment = await CoreWebView2Environment.CreateAsync(
                null,
                paths.WebView2,
                environmentOptions).ConfigureAwait(true);
            lifetimeToken.ThrowIfCancellationRequested();
            var createdRuntime = WebView2RuntimePolicy.EvaluateVersionString(environment.BrowserVersionString);
            if (!createdRuntime.IsAvailable)
            {
                ShowWebView2RuntimeFailure(createdRuntime);
                return;
            }
            await webView.EnsureCoreWebView2Async(environment).ConfigureAwait(true);
            lifetimeToken.ThrowIfCancellationRequested();

            if (gatewaySupervisor is not null)
            {
                statusLabel.Text = "AETHOR STUDIO V2\r\n\r\n正在启动本机机器人网关…";
                var result = await gatewaySupervisor.TryStartAsync(lifetimeToken).ConfigureAwait(true);
                gateway = result.Session;
                if (!result.Started) log.Write("desktop", result.Failure ?? "Gateway unavailable; offline showcase mode selected");
            }

            await ConfigureWebViewAsync(gateway).ConfigureAwait(true);
            webViewStartupCompleted = true;
            if (gatewayRecovery.State != GatewayRecoveryState.Normal)
            {
                ShowGatewayFailure();
                return;
            }
            webView.Visible = true;
            statusPanel.Visible = false;
            log.Write("desktop", gateway is null
                ? "WebView started in explicit offline showcase mode"
                : $"WebView started with gateway pid={gateway.ProcessId}");
        }
        catch (OperationCanceledException) when (lifetimeToken.IsCancellationRequested)
        {
            log.Write("desktop", "Desktop startup cancelled during shutdown");
        }
        catch (WebView2RuntimeNotFoundException exception)
        {
            ShowWebView2RuntimeFailure(new(
                WebView2RuntimeProbeStatus.Missing,
                null,
                exception.Message));
        }
        catch (Exception exception)
        {
            log.Write("desktop", $"Desktop startup failed: {exception.GetType().Name}: {exception.Message}");
            statusLabel.Text = "AETHOR STUDIO V2\r\n\r\n桌面工作台启动失败\r\n" + exception.Message
                + "\r\n\r\n诊断日志：" + paths.Logs;
            statusPanel.Visible = true;
            statusPanel.BringToFront();
            failureCloseButton.Visible = true;
        }
    }

    private void ShowWebView2RuntimeFailure(WebView2RuntimeProbeResult result)
    {
        log.Write(
            "desktop",
            $"WebView2 Stable Runtime unavailable: status={result.Status}; version={result.Version ?? "none"}; detail={result.Detail ?? "none"}");
        statusLabel.Text = "AETHOR STUDIO V2\r\n\r\nMicrosoft Edge WebView2 Stable Runtime 不可用"
            + "\r\n请安装经发布负责人批准的 Evergreen Runtime，或使用未来签名的离线前置包。"
            + "\r\n应用不会自动下载组件，也没有启动机器人网关。"
            + "\r\n\r\n诊断日志：" + paths.Logs;
        webView.Visible = false;
        recoveryButton.Visible = false;
        failureCloseButton.Visible = true;
        statusPanel.Visible = true;
        statusPanel.BringToFront();
    }

    private async Task ConfigureWebViewAsync(GatewayRuntimeSession? gateway)
    {
        var core = webView.CoreWebView2 ?? throw new InvalidOperationException("WebView2 core is unavailable");
        core.Settings.AreDevToolsEnabled = false;
        core.Settings.AreDefaultContextMenusEnabled = false;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.IsZoomControlEnabled = false;
        core.Settings.IsPasswordAutosaveEnabled = false;
        core.Settings.IsGeneralAutofillEnabled = false;
        await EnableWebDiagnosticsAsync(core).ConfigureAwait(true);
        core.PermissionRequested += (_, eventArgs) =>
        {
            eventArgs.State = CoreWebView2PermissionState.Deny;
            eventArgs.Handled = true;
            log.Write("desktop", $"Denied packaged web permission request: {eventArgs.PermissionKind}");
        };
        core.SetVirtualHostNameToFolderMapping(AppHost, options.WebRoot, CoreWebView2HostResourceAccessKind.DenyCors);
        await core.AddScriptToExecuteOnDocumentCreatedAsync(
            DesktopBridgeProtocol.BuildBootstrapScript(gateway)).ConfigureAwait(true);
        core.WebMessageReceived += async (_, eventArgs) => await HandleBridgeMessageAsync(eventArgs).ConfigureAwait(true);
        core.NavigationStarting += (_, eventArgs) =>
        {
            if (IsTrustedAppUri(eventArgs.Uri)) return;
            eventArgs.Cancel = true;
            log.Write("desktop", $"Blocked WebView navigation outside the packaged app origin: {eventArgs.Uri}");
        };
        core.NewWindowRequested += (_, eventArgs) =>
        {
            eventArgs.Handled = true;
            log.Write("desktop", "Blocked WebView new-window request");
        };
        core.ProcessFailed += (_, eventArgs) =>
        {
            log.Write("desktop", $"WebView2 process failed: {eventArgs.ProcessFailedKind}");
            statusLabel.Text = "AETHOR STUDIO V2\r\n\r\nWebView2 进程异常，请重新启动应用。";
            failureCloseButton.Visible = true;
            statusPanel.Visible = true;
            statusPanel.BringToFront();
        };
        core.NavigationCompleted += (_, eventArgs) =>
        {
            if (eventArgs.IsSuccess)
            {
                log.Write("desktop", $"Packaged UI navigation completed: {core.Source}");
                return;
            }
            log.Write("desktop", $"Packaged UI navigation failed: {eventArgs.WebErrorStatus}");
            statusLabel.Text = "AETHOR STUDIO V2\r\n\r\n本地界面加载失败\r\n" + eventArgs.WebErrorStatus;
            failureCloseButton.Visible = true;
            statusPanel.Visible = true;
            statusPanel.BringToFront();
        };
        core.DOMContentLoaded += async (_, _) =>
        {
            try
            {
                var summary = await core.ExecuteScriptAsync(
                    "JSON.stringify({readyState:document.readyState,title:document.title,rootChildren:document.getElementById('root')?.childElementCount??-1,bodyChildren:document.body?.childElementCount??-1})").ConfigureAwait(true);
                log.Write("web.runtime", summary);
            }
            catch (Exception exception)
            {
                log.Write("web.runtime", $"DOM diagnostic failed: {exception.GetType().Name}: {exception.Message}");
            }
        };
        webView.Source = new Uri("http://localhost/index.html#/console", UriKind.Absolute);
    }

    private async Task EnableWebDiagnosticsAsync(CoreWebView2 core)
    {
        exceptionReceiver = core.GetDevToolsProtocolEventReceiver("Runtime.exceptionThrown");
        exceptionReceiver.DevToolsProtocolEventReceived += (_, eventArgs) =>
            log.Write("web.exception", eventArgs.ParameterObjectAsJson);
        logReceiver = core.GetDevToolsProtocolEventReceiver("Log.entryAdded");
        logReceiver.DevToolsProtocolEventReceived += (_, eventArgs) =>
            log.Write("web.console", eventArgs.ParameterObjectAsJson);
        await core.CallDevToolsProtocolMethodAsync("Runtime.enable", "{}").ConfigureAwait(true);
        await core.CallDevToolsProtocolMethodAsync("Log.enable", "{}").ConfigureAwait(true);
    }

    private async Task HandleBridgeMessageAsync(CoreWebView2WebMessageReceivedEventArgs eventArgs)
    {
        string requestJson;
        try
        {
            requestJson = eventArgs.WebMessageAsJson;
        }
        catch (Exception exception)
        {
            log.Write("desktop", $"Rejected unreadable desktop bridge message: {exception.GetType().Name}");
            return;
        }
        if (!IsTrustedAppUri(eventArgs.Source)
            || !DesktopBridgeProtocol.TryParseRequest(requestJson, out var request)
            || request is null)
        {
            log.Write("desktop", "Rejected invalid or untrusted desktop bridge message");
            return;
        }

        var ok = true;
        DesktopBridgeErrorCode? error = null;
        try
        {
            switch (request.Action)
            {
                case DesktopBridgeAction.Minimize:
                    WindowState = FormWindowState.Minimized;
                    break;
                case DesktopBridgeAction.ToggleMaximize:
                    WindowState = WindowState == FormWindowState.Maximized ? FormWindowState.Normal : FormWindowState.Maximized;
                    break;
                case DesktopBridgeAction.BeginDrag:
                    NativeWindowCommands.BeginDrag(Handle);
                    break;
                case DesktopBridgeAction.Close:
                    ok = await PrepareCloseAsync().ConfigureAwait(true);
                    if (!ok) error = DesktopBridgeErrorCode.HostFailure;
                    break;
                default:
                    ok = false;
                    error = DesktopBridgeErrorCode.Unsupported;
                    break;
            }
        }
        catch (Exception exception)
        {
            ok = false;
            error = DesktopBridgeErrorCode.HostFailure;
            log.Write("desktop", $"Desktop bridge operation failed: {exception.GetType().Name}: {exception.Message}");
        }

        webView.CoreWebView2?.PostWebMessageAsJson(DesktopBridgeProtocol.SerializeResponse(
            new(DesktopBridgeProtocol.ContractVersion, request.RequestId, ok, error)));
        if (request.Action == DesktopBridgeAction.Close && ok)
        {
            shutdownApproved = true;
            lifetimeCancellation.Cancel();
            BeginInvoke(Close);
        }
    }

    private async void HandleFormClosing(object? sender, FormClosingEventArgs eventArgs)
    {
        if (shutdownApproved)
        {
            lifetimeCancellation.Cancel();
            return;
        }
        eventArgs.Cancel = true;
        if (closePreparationRunning) return;
        if (await PrepareCloseAsync().ConfigureAwait(true))
        {
            shutdownApproved = true;
            lifetimeCancellation.Cancel();
            Close();
        }
        else
        {
            MessageBox.Show(
                this,
                "网关未确认设备处于可安全退出状态。请先执行“停止并去使能”，确认物理急停可用后再关闭。",
                "Aethor Studio V2",
                MessageBoxButtons.OK,
                MessageBoxIcon.Warning);
        }
    }

    private async Task<bool> PrepareCloseAsync()
    {
        if (shutdownApproved || gatewaySupervisor is null) return true;
        if (closePreparationRunning) return false;
        closePreparationRunning = true;
        try
        {
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(8));
            return await gatewaySupervisor.TryShutdownAsync(timeout.Token).ConfigureAwait(true);
        }
        catch (OperationCanceledException)
        {
            log.Write("desktop", "Gateway shutdown confirmation timed out; close remains blocked");
            return false;
        }
        finally
        {
            closePreparationRunning = false;
        }
    }

    private void HandleGatewayUnexpectedExit(object? sender, EventArgs eventArgs)
    {
        gatewayRecovery.ObserveUnexpectedExit();
        if (IsDisposed || Disposing) return;
        try
        {
            BeginInvoke(ShowGatewayFailure);
        }
        catch (InvalidOperationException)
        {
            // The window is already closing; process ownership cleanup remains
            // with the supervisor and its job object.
        }
    }

    private void ShowGatewayFailure()
    {
        if (IsDisposed || Disposing) return;
        log.Write("desktop", "Gateway exit blocked the workspace; only an explicit offline restart is available");
        statusLabel.Text = "AETHOR STUDIO V2\r\n\r\n机器人网关意外退出，设备状态未知。"
            + "\r\n系统不会自动重连或恢复控制。请先确认物理急停与机械臂状态。";
        webView.Visible = false;
        if (webViewStartupCompleted && !webView.IsDisposed) webView.Dispose();
        recoveryButton.Visible = true;
        failureCloseButton.Visible = false;
        statusPanel.Visible = true;
        statusPanel.BringToFront();
    }

    private void HandleOfflineRestartClick(object? sender, EventArgs eventArgs)
    {
        if (!gatewayRecovery.TryRequestOfflineRestart())
        {
            log.Write("desktop", "Rejected offline restart request outside the gateway-failure recovery state");
            return;
        }
        shutdownApproved = true;
        if (!lifetimeCancellation.IsCancellationRequested) lifetimeCancellation.Cancel();
        Close();
    }

    private async void HandleFailureCloseClick(object? sender, EventArgs eventArgs)
    {
        failureCloseButton.Enabled = false;
        try
        {
            if (!await PrepareCloseAsync().ConfigureAwait(true))
            {
                MessageBox.Show(
                    this,
                    "网关未确认设备处于可安全退出状态。请先使用物理急停处理未知设备状态。",
                    "Aethor Studio V2",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Warning);
                return;
            }

            shutdownApproved = true;
            if (!lifetimeCancellation.IsCancellationRequested) lifetimeCancellation.Cancel();
            Close();
        }
        finally
        {
            if (!IsDisposed && !Disposing) failureCloseButton.Enabled = true;
        }
    }

    private static bool IsTrustedAppUri(string value) =>
        Uri.TryCreate(value, UriKind.Absolute, out var uri)
        && uri.Scheme == Uri.UriSchemeHttp
        && uri.Host.Equals(AppHost, StringComparison.OrdinalIgnoreCase)
        && uri.IsDefaultPort
        && string.IsNullOrEmpty(uri.UserInfo);

    private void RestoreWindowPlacement()
    {
        var workingAreas = Screen.AllScreens.Select(screen => screen.WorkingArea).ToArray();
        if (!WindowPlacementStore.TryLoad(
                paths.WindowPlacement,
                workingAreas,
                MinimumSize,
                out var restoredBounds,
                out restoreMaximized))
        {
            return;
        }
        StartPosition = FormStartPosition.Manual;
        Bounds = restoredBounds;
    }

    private void SaveWindowPlacement()
    {
        try
        {
            var bounds = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
            WindowPlacementStore.Save(
                paths.WindowPlacement,
                bounds,
                WindowState == FormWindowState.Maximized);
        }
        catch (Exception exception)
        {
            log.Write("desktop", $"Window placement save failed: {exception.GetType().Name}: {exception.Message}");
        }
    }

    private void LoadSplashImage()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "Assets", "aethor-mark.png");
        if (!File.Exists(path)) return;
        try
        {
            using var stream = File.OpenRead(path);
            using var source = Image.FromStream(stream);
            splashImage = new Bitmap(source);
            statusMark.Image = splashImage;
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or ArgumentException)
        {
            log.Write("desktop", $"Startup mark could not be loaded: {exception.GetType().Name}: {exception.Message}");
        }
    }
}
