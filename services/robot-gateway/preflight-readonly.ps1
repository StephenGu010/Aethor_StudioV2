[CmdletBinding()]
param(
    [string]$PortName = $env:AETHOR_PREFLIGHT_PORT_NAME,

    [string]$ExpectedInstanceId = $env:AETHOR_PREFLIGHT_EXPECTED_INSTANCE_ID,

    [ValidateRange(1024, 65535)]
    [int]$GatewayPort = 5127
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($PortName) -or $PortName -notmatch '^COM[1-9][0-9]*$') {
    throw 'PortName must be a Windows COM name such as COM4. Pass -PortName or set AETHOR_PREFLIGHT_PORT_NAME.'
}

if ([string]::IsNullOrWhiteSpace($ExpectedInstanceId)) {
    throw 'ExpectedInstanceId is required. Pass -ExpectedInstanceId or set AETHOR_PREFLIGHT_EXPECTED_INSTANCE_ID.'
}

$checks = [System.Collections.Generic.List[object]]::new()

function Add-PreflightCheck {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,

        [Parameter(Mandatory = $true)]
        [bool]$Passed,

        [Parameter(Mandatory = $true)]
        [string]$Detail
    )

    $checks.Add([pscustomobject]@{
        name = $Name
        passed = $Passed
        detail = $Detail
    })
}

# CIM/PnP, process, and TCP listener inspection are enumeration-only operations.
# This script intentionally has no SerialPort instance and no gateway HTTP client.
$portDevices = @(
    Get-CimInstance Win32_PnPEntity |
        Where-Object { $_.Name -match '\(COM[1-9][0-9]*\)$' }
)
$matchingDevices = @(
    $portDevices |
        Where-Object { $_.Name -match "\($([Regex]::Escape($PortName))\)$" }
)

Add-PreflightCheck `
    -Name 'unique-port-device' `
    -Passed ($matchingDevices.Count -eq 1) `
    -Detail "Expected exactly one present PnP device for $PortName; found $($matchingDevices.Count)."

$actualDisplayName = $null
$actualInstanceId = $null
$actualStatus = $null

if ($matchingDevices.Count -eq 1) {
    $device = $matchingDevices[0]
    $actualDisplayName = [string]$device.Name
    $actualInstanceId = [string]$device.PNPDeviceID
    $actualStatus = [string]$device.Status

    Add-PreflightCheck `
        -Name 'pnp-status-ok' `
        -Passed ([string]::Equals($actualStatus, 'OK', [StringComparison]::OrdinalIgnoreCase)) `
        -Detail "PnP status is '$actualStatus'."

    Add-PreflightCheck `
        -Name 'instance-id-match' `
        -Passed ([string]::Equals($actualInstanceId, $ExpectedInstanceId, [StringComparison]::OrdinalIgnoreCase)) `
        -Detail "Expected '$ExpectedInstanceId'; observed '$actualInstanceId'."
}
else {
    Add-PreflightCheck -Name 'pnp-status-ok' -Passed $false -Detail 'PnP status is unavailable because the port identity is not unique.'
    Add-PreflightCheck -Name 'instance-id-match' -Passed $false -Detail 'Instance ID is unavailable because the port identity is not unique.'
}

$gatewayProcesses = @(
    Get-CimInstance Win32_Process |
        Where-Object {
            $_.ProcessId -ne $PID -and (
                $_.Name -eq 'AethorStudioV2.Api.exe' -or
                ($_.Name -eq 'dotnet.exe' -and $_.CommandLine -match 'AethorStudioV2\.Api')
            )
        } |
        Select-Object ProcessId, Name
)

Add-PreflightCheck `
    -Name 'gateway-process-absent' `
    -Passed ($gatewayProcesses.Count -eq 0) `
    -Detail "Found $($gatewayProcesses.Count) running Aethor gateway process(es)."

$gatewayListeners = @(
    Get-NetTCPConnection -State Listen -LocalPort $GatewayPort -ErrorAction SilentlyContinue |
        Select-Object LocalAddress, LocalPort, OwningProcess
)

Add-PreflightCheck `
    -Name 'gateway-listener-absent' `
    -Passed ($gatewayListeners.Count -eq 0) `
    -Detail "Found $($gatewayListeners.Count) listener(s) on local port $GatewayPort."

$passed = @($checks | Where-Object { -not $_.passed }).Count -eq 0
$result = [ordered]@{
    schemaVersion = 'aethor.phase4.preflight.v1'
    timestampUtc = [DateTimeOffset]::UtcNow.ToString('O')
    operation = 'enumeration-only'
    passed = $passed
    serialPortOpened = $false
    networkRequestSent = $false
    requestedPortName = $PortName
    expectedInstanceId = $ExpectedInstanceId
    observedDisplayName = $actualDisplayName
    observedInstanceId = $actualInstanceId
    observedStatus = $actualStatus
    gatewayPort = $GatewayPort
    gatewayProcesses = $gatewayProcesses
    gatewayListeners = $gatewayListeners
    checks = $checks
}

$result | ConvertTo-Json -Depth 6

if (-not $passed) {
    exit 2
}
