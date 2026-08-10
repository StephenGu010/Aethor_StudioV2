[CmdletBinding()]
param(
    [string]$PortName = $env:AETHOR_PREFLIGHT_PORT_NAME,

    [string]$ExpectedInstanceId = $env:AETHOR_PREFLIGHT_EXPECTED_INSTANCE_ID,

    [ValidateRange(1024, 65535)]
    [int]$GatewayPort = 5127
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$readonlyPreflight = Join-Path $PSScriptRoot 'preflight-readonly.ps1'
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$releaseArtifactRelativePaths = @(
    'services/robot-gateway/src/AethorStudioV2.Domain/bin/Release/net10.0/AethorStudioV2.Domain.dll',
    'services/robot-gateway/src/AethorStudioV2.Application/bin/Release/net10.0/AethorStudioV2.Application.dll',
    'services/robot-gateway/src/AethorStudioV2.Infrastructure/bin/Release/net10.0/AethorStudioV2.Infrastructure.dll',
    'services/robot-gateway/src/AethorStudioV2.Api/bin/Release/net10.0/AethorStudioV2.Api.dll'
)
$gatewayAssembly = Join-Path $repositoryRoot ($releaseArtifactRelativePaths[-1].Replace('/', '\'))
$checks = [System.Collections.Generic.List[object]]::new()

function Add-ControlPreflightCheck {
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

# Reuse the reviewed enumeration-only identity/resource inspection. This child
# process cannot open a serial port or call the gateway because the delegated
# script contains neither capability.
$readonlyJson = & powershell -NoProfile -ExecutionPolicy Bypass `
    -File $readonlyPreflight `
    -PortName $PortName `
    -ExpectedInstanceId $ExpectedInstanceId `
    -GatewayPort $GatewayPort
$readonlyExitCode = $LASTEXITCODE

$readonlyResult = $null
try {
    $readonlyResult = $readonlyJson | ConvertFrom-Json
}
catch {
    Add-ControlPreflightCheck `
        -Name 'readonly-preflight-json' `
        -Passed $false `
        -Detail "Enumeration-only preflight did not return valid JSON: $($_.Exception.Message)"
}

$readonlyPassed =
    $null -ne $readonlyResult -and
    $readonlyExitCode -eq 0 -and
    $readonlyResult.passed -eq $true -and
    $readonlyResult.serialPortOpened -eq $false -and
    $readonlyResult.networkRequestSent -eq $false
Add-ControlPreflightCheck `
    -Name 'readonly-identity-and-resource-gate' `
    -Passed $readonlyPassed `
    -Detail "Enumeration-only preflight exit code was $readonlyExitCode."

$commandPolicy = [Environment]::GetEnvironmentVariable('AETHOR_GATEWAY_COMMAND_POLICY', 'Process')
$tokenSource = [Environment]::GetEnvironmentVariable('AETHOR_GATEWAY_TOKEN_SOURCE', 'Process')
$sessionToken = [Environment]::GetEnvironmentVariable('AETHOR_GATEWAY_SESSION_TOKEN', 'Process')
$jointGroupSpeedLimit = [Environment]::GetEnvironmentVariable(
    'AETHOR_GATEWAY_JOINT_GROUP_SPEED_LIMIT_DEG_S',
    'Process')
$jointGroupPositionTolerance = [Environment]::GetEnvironmentVariable(
    'AETHOR_GATEWAY_JOINT_GROUP_POSITION_TOLERANCE_DEG',
    'Process')
$jointGroupSettledDuration = [Environment]::GetEnvironmentVariable(
    'AETHOR_GATEWAY_JOINT_GROUP_SETTLED_DURATION_MS',
    'Process')
$jointGroupCompletionTimeout = [Environment]::GetEnvironmentVariable(
    'AETHOR_GATEWAY_JOINT_GROUP_COMPLETION_TIMEOUT_MS',
    'Process')

$commandPolicySafe =
    [string]::IsNullOrWhiteSpace($commandPolicy) -or
    [string]::Equals($commandPolicy, 'disabled', [StringComparison]::OrdinalIgnoreCase)
Add-ControlPreflightCheck `
    -Name 'supervised-policy-not-armed' `
    -Passed $commandPolicySafe `
    -Detail 'AETHOR_GATEWAY_COMMAND_POLICY must be absent or disabled before the operator authorization gate.'

$tokenSourceSafe =
    [string]::IsNullOrWhiteSpace($tokenSource) -or
    [string]::Equals($tokenSource, 'development', [StringComparison]::OrdinalIgnoreCase)
Add-ControlPreflightCheck `
    -Name 'desktop-token-source-not-armed' `
    -Passed $tokenSourceSafe `
    -Detail 'AETHOR_GATEWAY_TOKEN_SOURCE must be absent or development before the operator authorization gate.'

$sessionTokenAbsent = [string]::IsNullOrEmpty($sessionToken)
Add-ControlPreflightCheck `
    -Name 'session-token-not-reused' `
    -Passed $sessionTokenAbsent `
    -Detail 'AETHOR_GATEWAY_SESSION_TOKEN must be absent so the supervised run creates a fresh process-scoped token.'

$speedLimitAbsent = [string]::IsNullOrWhiteSpace($jointGroupSpeedLimit)
Add-ControlPreflightCheck `
    -Name 'unverified-speed-not-armed' `
    -Passed $speedLimitAbsent `
    -Detail 'AETHOR_GATEWAY_JOINT_GROUP_SPEED_LIMIT_DEG_S must remain absent until approved evidence is attached.'

$positionToleranceAbsent = [string]::IsNullOrWhiteSpace($jointGroupPositionTolerance)
$settledDurationAbsent = [string]::IsNullOrWhiteSpace($jointGroupSettledDuration)
$completionTimeoutAbsent = [string]::IsNullOrWhiteSpace($jointGroupCompletionTimeout)
$completionPolicyAbsent =
    $positionToleranceAbsent -and
    $settledDurationAbsent -and
    $completionTimeoutAbsent
Add-ControlPreflightCheck `
    -Name 'unverified-completion-policy-not-armed' `
    -Passed $completionPolicyAbsent `
    -Detail 'Joint-group tolerance, settled duration, and completion timeout must remain absent until approved evidence is attached.'

$releaseArtifacts = @(
    foreach ($relativePath in $releaseArtifactRelativePaths) {
        $absolutePath = Join-Path $repositoryRoot ($relativePath.Replace('/', '\'))
        $exists = Test-Path -LiteralPath $absolutePath -PathType Leaf
        [ordered]@{
            path = $relativePath
            sha256 = if ($exists) {
                (Get-FileHash -Algorithm SHA256 -LiteralPath $absolutePath).Hash.ToLowerInvariant()
            }
            else {
                $null
            }
        }
    }
)
$assemblyExists = @($releaseArtifacts | Where-Object { [string]::IsNullOrWhiteSpace($_.sha256) }).Count -eq 0
Add-ControlPreflightCheck `
    -Name 'release-gateway-built' `
    -Passed $assemblyExists `
    -Detail 'All four owned Release gateway assemblies must exist for this supervised run.'

$assemblyHash = if ($assemblyExists) {
    (Get-FileHash -Algorithm SHA256 -LiteralPath $gatewayAssembly).Hash.ToLowerInvariant()
}
else {
    $null
}
$artifactManifestHash = if ($assemblyExists) {
    $canonicalManifest = ($releaseArtifacts | ForEach-Object { "$($_.path)=$($_.sha256)" }) -join "`n"
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        $manifestBytes = [System.Text.Encoding]::UTF8.GetBytes($canonicalManifest)
        ([BitConverter]::ToString($sha256.ComputeHash($manifestBytes))).Replace('-', '').ToLowerInvariant()
    }
    finally {
        $sha256.Dispose()
    }
}
else {
    $null
}

$passed = @($checks | Where-Object { -not $_.passed }).Count -eq 0
$result = [ordered]@{
    schemaVersion = 'aethor.phase5.control-preflight.v1'
    timestampUtc = [DateTimeOffset]::UtcNow.ToString('O')
    operation = 'enumeration-and-config-inspection-only'
    passed = $passed
    hardwareAccessAuthorized = $false
    gatewayStarted = $false
    serialPortOpened = $false
    networkRequestSent = $false
    requestedPortName = $PortName
    expectedInstanceId = $ExpectedInstanceId
    gatewayPort = $GatewayPort
    commandPolicyObserved = if ([string]::IsNullOrWhiteSpace($commandPolicy)) { $null } else { $commandPolicy }
    tokenSourceObserved = if ([string]::IsNullOrWhiteSpace($tokenSource)) { $null } else { $tokenSource }
    sessionTokenPresent = -not $sessionTokenAbsent
    jointGroupSpeedLimitPresent = -not $speedLimitAbsent
    jointGroupPositionTolerancePresent = -not $positionToleranceAbsent
    jointGroupSettledDurationPresent = -not $settledDurationAbsent
    jointGroupCompletionTimeoutPresent = -not $completionTimeoutAbsent
    releaseAssembly = $gatewayAssembly.Substring($repositoryRoot.Length).TrimStart('\')
    releaseAssemblySha256 = $assemblyHash
    releaseArtifacts = $releaseArtifacts
    releaseArtifactManifestSha256 = $artifactManifestHash
    readonlyPreflight = $readonlyResult
    checks = $checks
}

$result | ConvertTo-Json -Depth 10

if (-not $passed) {
    exit 2
}
