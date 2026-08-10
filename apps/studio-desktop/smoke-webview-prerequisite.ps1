[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$PackageRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$resolvedPackageRoot = (Resolve-Path -LiteralPath $PackageRoot).Path
$desktopExecutable = [IO.Path]::GetFullPath((Join-Path $resolvedPackageRoot 'AethorStudioV2.Desktop.exe'))
$gatewayExecutable = [IO.Path]::GetFullPath((Join-Path $resolvedPackageRoot 'gateway\AethorStudioV2.Api.exe'))
foreach ($required in @($desktopExecutable, $gatewayExecutable)) {
    if (!(Test-Path -LiteralPath $required -PathType Leaf)) {
        throw "Required package executable is missing: $required"
    }
}

function Get-PackageOwnedProcesses {
    Get-CimInstance Win32_Process | Where-Object {
        ![string]::IsNullOrWhiteSpace($_.ExecutablePath) -and
        ($_.ExecutablePath.Equals($desktopExecutable, [StringComparison]::OrdinalIgnoreCase) -or
         $_.ExecutablePath.Equals($gatewayExecutable, [StringComparison]::OrdinalIgnoreCase))
    }
}

$existing = @(Get-PackageOwnedProcesses)
if ($existing.Count -ne 0) {
    throw "Package smoke requires zero existing package-owned desktop/gateway processes; found $($existing.Count)."
}

$logPath = Join-Path $env:LOCALAPPDATA 'Aethor Studio V2\Logs\desktop.log'
$startedAt = [DateTimeOffset]::UtcNow
$desktopProcess = $null
$gatewayObserved = $false
$failureEvidence = $null

try {
    $startInfo = [Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $desktopExecutable
    $startInfo.WorkingDirectory = $resolvedPackageRoot
    $startInfo.UseShellExecute = $false

    # The SDK documents WEBVIEW2_RELEASE_CHANNELS as an override. Beta-only is
    # used here so the production Stable-only policy must fail before starting
    # the gateway whether Beta is missing or installed on the test machine.
    $startInfo.Environment.Remove('WEBVIEW2_BROWSER_EXECUTABLE_FOLDER') | Out-Null
    $startInfo.Environment.Remove('WEBVIEW2_CHANNEL_SEARCH_KIND') | Out-Null
    $startInfo.Environment['WEBVIEW2_RELEASE_CHANNELS'] = '1'

    $desktopProcess = [Diagnostics.Process]::Start($startInfo)
    if ($null -eq $desktopProcess) { throw 'Packaged desktop process did not start.' }

    $deadline = [DateTimeOffset]::UtcNow.AddSeconds(15)
    while ([DateTimeOffset]::UtcNow -lt $deadline -and !$desktopProcess.HasExited) {
        $owned = @(Get-PackageOwnedProcesses)
        if ($owned | Where-Object { $_.ExecutablePath.Equals($gatewayExecutable, [StringComparison]::OrdinalIgnoreCase) }) {
            $gatewayObserved = $true
            break
        }

        if (Test-Path -LiteralPath $logPath -PathType Leaf) {
            foreach ($line in Get-Content -LiteralPath $logPath -Encoding UTF8 -Tail 200) {
                $parts = $line -split "`t", 3
                if ($parts.Count -ne 3) { continue }
                $timestamp = [DateTimeOffset]::MinValue
                if (![DateTimeOffset]::TryParse($parts[0], [ref]$timestamp)) { continue }
                if ($timestamp -ge $startedAt -and
                    $parts[1] -eq 'desktop' -and
                    $parts[2].StartsWith('WebView2 Stable Runtime unavailable:', [StringComparison]::Ordinal)) {
                    $failureEvidence = $parts[2]
                    break
                }
            }
        }
        if ($null -ne $failureEvidence) { break }
        Start-Sleep -Milliseconds 100
    }

    if ($gatewayObserved) {
        throw 'Gateway started before the Stable WebView2 prerequisite was accepted.'
    }
    if ($null -eq $failureEvidence) {
        throw 'Packaged desktop did not report the Stable WebView2 prerequisite failure.'
    }
    if ($desktopProcess.HasExited) {
        throw 'Packaged desktop exited instead of keeping the native prerequisite panel available.'
    }

    [ordered]@{
        succeeded = $true
        packageRoot = $resolvedPackageRoot
        stableRuntimeRequired = $true
        prerequisitePanelActive = $true
        desktopStayedOpen = $true
        gatewayStarted = $false
        serialPortOpened = $false
        hardwareCommandSent = $false
    } | ConvertTo-Json
}
finally {
    if ($desktopProcess -and !$desktopProcess.HasExited) {
        $observedDesktop = Get-CimInstance Win32_Process -Filter "ProcessId = $($desktopProcess.Id)" -ErrorAction SilentlyContinue
        if ($observedDesktop -and
            $observedDesktop.ExecutablePath.Equals($desktopExecutable, [StringComparison]::OrdinalIgnoreCase)) {
            Stop-Process -Id $desktopProcess.Id -Force
            $desktopProcess.WaitForExit(5000) | Out-Null
        }
    }
}
