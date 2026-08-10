[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$PackageRoot,

    [ValidateSet(0, 96, 120, 144, 192)]
    [int]$ExpectedDpi = 0,

    [switch]$KeepOpen
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$resolvedPackageRoot = (Resolve-Path -LiteralPath $PackageRoot).Path
$desktopExecutable = Join-Path $resolvedPackageRoot 'AethorStudioV2.Desktop.exe'
$webIndex = Join-Path $resolvedPackageRoot 'web\index.html'
foreach ($required in @($desktopExecutable, $webIndex)) {
    if (!(Test-Path -LiteralPath $required -PathType Leaf)) {
        throw "Required packaged desktop file is missing: $required"
    }
}

$existingDesktop = @(Get-Process -Name 'AethorStudioV2.Desktop' -ErrorAction SilentlyContinue)
$existingGateway = @(Get-Process -Name 'AethorStudioV2.Api' -ErrorAction SilentlyContinue)
if ($existingDesktop.Count -gt 0 -or $existingGateway.Count -gt 0) {
    throw 'DPI evidence requires no existing Aethor Studio desktop or gateway process.'
}

Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public sealed class AethorWindowDpiSnapshot
{
    public uint Dpi { get; set; }
    public bool IsPerMonitorV2 { get; set; }
    public bool IsMaximized { get; set; }
    public int WindowLeft { get; set; }
    public int WindowTop { get; set; }
    public int WindowRight { get; set; }
    public int WindowBottom { get; set; }
    public int ClientWidth { get; set; }
    public int ClientHeight { get; set; }
    public int MonitorLeft { get; set; }
    public int MonitorTop { get; set; }
    public int MonitorRight { get; set; }
    public int MonitorBottom { get; set; }
    public int WorkLeft { get; set; }
    public int WorkTop { get; set; }
    public int WorkRight { get; set; }
    public int WorkBottom { get; set; }
    public string MonitorDeviceName { get; set; }
}

public static class AethorWindowDpiInspection
{
    private static readonly IntPtr PerMonitorV2 = new IntPtr(-4);
    private const uint MonitorDefaultToNearest = 2;
    private const uint WindowClose = 0x0010;

    [StructLayout(LayoutKind.Sequential)]
    private struct Rect
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct MonitorInfo
    {
        public uint Size;
        public Rect Monitor;
        public Rect Work;
        public uint Flags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
        public string DeviceName;
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool GetWindowRect(IntPtr window, out Rect rect);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool GetClientRect(IntPtr window, out Rect rect);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint GetDpiForWindow(IntPtr window);

    [DllImport("user32.dll")]
    private static extern IntPtr GetWindowDpiAwarenessContext(IntPtr window);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool AreDpiAwarenessContextsEqual(IntPtr first, IntPtr second);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsZoomed(IntPtr window);

    [DllImport("user32.dll")]
    private static extern IntPtr MonitorFromWindow(IntPtr window, uint flags);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);

    public static AethorWindowDpiSnapshot Inspect(IntPtr window)
    {
        if (window == IntPtr.Zero) throw new ArgumentException("Window handle is required", "window");
        Rect windowRect;
        if (!GetWindowRect(window, out windowRect)) throw new Win32Exception(Marshal.GetLastWin32Error());
        Rect clientRect;
        if (!GetClientRect(window, out clientRect)) throw new Win32Exception(Marshal.GetLastWin32Error());
        var dpi = GetDpiForWindow(window);
        if (dpi == 0) throw new Win32Exception(Marshal.GetLastWin32Error());
        var monitor = MonitorFromWindow(window, MonitorDefaultToNearest);
        if (monitor == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
        var info = new MonitorInfo { Size = (uint)Marshal.SizeOf(typeof(MonitorInfo)), DeviceName = string.Empty };
        if (!GetMonitorInfo(monitor, ref info)) throw new Win32Exception(Marshal.GetLastWin32Error());

        return new AethorWindowDpiSnapshot
        {
            Dpi = dpi,
            IsPerMonitorV2 = AreDpiAwarenessContextsEqual(GetWindowDpiAwarenessContext(window), PerMonitorV2),
            IsMaximized = IsZoomed(window),
            WindowLeft = windowRect.Left,
            WindowTop = windowRect.Top,
            WindowRight = windowRect.Right,
            WindowBottom = windowRect.Bottom,
            ClientWidth = clientRect.Right - clientRect.Left,
            ClientHeight = clientRect.Bottom - clientRect.Top,
            MonitorLeft = info.Monitor.Left,
            MonitorTop = info.Monitor.Top,
            MonitorRight = info.Monitor.Right,
            MonitorBottom = info.Monitor.Bottom,
            WorkLeft = info.Work.Left,
            WorkTop = info.Work.Top,
            WorkRight = info.Work.Right,
            WorkBottom = info.Work.Bottom,
            MonitorDeviceName = info.DeviceName ?? string.Empty
        };
    }

    public static void RequestClose(IntPtr window)
    {
        if (window != IntPtr.Zero && !PostMessage(window, WindowClose, IntPtr.Zero, IntPtr.Zero))
        {
            throw new Win32Exception(Marshal.GetLastWin32Error());
        }
    }
}
'@

$desktopProcess = $null
$mainWindowHandle = [IntPtr]::Zero
$issues = [Collections.Generic.List[string]]::new()
$result = $null
try {
    $desktopProcess = Start-Process -FilePath $desktopExecutable -ArgumentList '--offline' -WorkingDirectory $resolvedPackageRoot -PassThru
    $deadline = [DateTimeOffset]::UtcNow.AddSeconds(30)
    while ([DateTimeOffset]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 200
        $desktopProcess.Refresh()
        if ($desktopProcess.HasExited) {
            throw "Packaged desktop exited before creating a window (exitCode=$($desktopProcess.ExitCode))."
        }
        if ($desktopProcess.MainWindowHandle -ne [IntPtr]::Zero) {
            $mainWindowHandle = $desktopProcess.MainWindowHandle
            break
        }
    }
    if ($mainWindowHandle -eq [IntPtr]::Zero) {
        throw 'Packaged desktop did not create a top-level window within 30 seconds.'
    }

    $snapshot = [AethorWindowDpiInspection]::Inspect($mainWindowHandle)
    $windowWidth = $snapshot.WindowRight - $snapshot.WindowLeft
    $windowHeight = $snapshot.WindowBottom - $snapshot.WindowTop
    $visibleWidth = [Math]::Max(0, [Math]::Min($snapshot.WindowRight, $snapshot.WorkRight) - [Math]::Max($snapshot.WindowLeft, $snapshot.WorkLeft))
    $visibleHeight = [Math]::Max(0, [Math]::Min($snapshot.WindowBottom, $snapshot.WorkBottom) - [Math]::Max($snapshot.WindowTop, $snapshot.WorkTop))
    $fullyInsideWorkArea = $snapshot.WindowLeft -ge $snapshot.WorkLeft `
        -and $snapshot.WindowTop -ge $snapshot.WorkTop `
        -and $snapshot.WindowRight -le $snapshot.WorkRight `
        -and $snapshot.WindowBottom -le $snapshot.WorkBottom

    if (!$snapshot.IsPerMonitorV2) { $issues.Add('Window DPI awareness is not Per-Monitor V2.') }
    if ($ExpectedDpi -ne 0 -and $snapshot.Dpi -ne $ExpectedDpi) {
        $issues.Add("Actual window DPI $($snapshot.Dpi) does not match expected DPI $ExpectedDpi.")
    }
    if ($windowWidth -le 0 -or $windowHeight -le 0 -or $snapshot.ClientWidth -le 0 -or $snapshot.ClientHeight -le 0) {
        $issues.Add('Window or client geometry is empty.')
    }
    if ($visibleWidth -lt [Math]::Min(320, $windowWidth) -or $visibleHeight -lt [Math]::Min(240, $windowHeight)) {
        $issues.Add('The restored window does not retain a usable visible area on the selected monitor.')
    }
    if (!$snapshot.IsMaximized -and !$fullyInsideWorkArea) {
        $issues.Add('The restored normal window is not fully contained by the selected monitor working area.')
    }

    $gatewayProcesses = @(Get-Process -Name 'AethorStudioV2.Api' -ErrorAction SilentlyContinue)
    if ($gatewayProcesses.Count -gt 0) {
        $issues.Add('Offline DPI evidence unexpectedly created a robot gateway process.')
    }

    $result = [ordered]@{
        succeeded = $issues.Count -eq 0
        packageRoot = $resolvedPackageRoot
        processId = $desktopProcess.Id
        windowTitle = $desktopProcess.MainWindowTitle
        deviceDpi = $snapshot.Dpi
        scalePercent = [Math]::Round($snapshot.Dpi * 100 / 96.0, 2)
        expectedDpi = if ($ExpectedDpi -eq 0) { $null } else { $ExpectedDpi }
        perMonitorV2 = $snapshot.IsPerMonitorV2
        monitor = [ordered]@{
            deviceName = $snapshot.MonitorDeviceName
            bounds = [ordered]@{ left = $snapshot.MonitorLeft; top = $snapshot.MonitorTop; right = $snapshot.MonitorRight; bottom = $snapshot.MonitorBottom }
            workingArea = [ordered]@{ left = $snapshot.WorkLeft; top = $snapshot.WorkTop; right = $snapshot.WorkRight; bottom = $snapshot.WorkBottom }
        }
        window = [ordered]@{
            bounds = [ordered]@{ left = $snapshot.WindowLeft; top = $snapshot.WindowTop; right = $snapshot.WindowRight; bottom = $snapshot.WindowBottom }
            clientWidth = $snapshot.ClientWidth
            clientHeight = $snapshot.ClientHeight
            visibleWidth = $visibleWidth
            visibleHeight = $visibleHeight
            maximized = $snapshot.IsMaximized
            fullyInsideWorkingArea = $fullyInsideWorkArea
        }
        keepOpen = [bool]$KeepOpen
        gatewayProcessCount = $gatewayProcesses.Count
        serialPortOpened = $false
        hardwareCommandSent = $false
        issues = @($issues)
    }
    $result | ConvertTo-Json -Depth 6
    if ($issues.Count -gt 0) {
        throw "DPI evidence failed with $($issues.Count) issue(s)."
    }
}
finally {
    if (!$KeepOpen -and $null -ne $desktopProcess -and !$desktopProcess.HasExited) {
        try { [AethorWindowDpiInspection]::RequestClose($mainWindowHandle) } catch { }
        if (!$desktopProcess.WaitForExit(10000)) {
            # The script owns an explicitly offline process with no gateway or
            # serial path. Kill is only a bounded cleanup fallback for that PID.
            $desktopProcess.Kill($true)
            $desktopProcess.WaitForExit(5000) | Out-Null
        }
    }
    if (!$KeepOpen) {
        $remainingDesktop = @(Get-Process -Name 'AethorStudioV2.Desktop' -ErrorAction SilentlyContinue)
        $remainingGateway = @(Get-Process -Name 'AethorStudioV2.Api' -ErrorAction SilentlyContinue)
        if ($remainingDesktop.Count -gt 0 -or $remainingGateway.Count -gt 0) {
            throw 'DPI evidence cleanup left an Aethor Studio desktop or gateway process running.'
        }
    }
}
