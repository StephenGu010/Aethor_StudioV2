[CmdletBinding()]
param(
    [string]$PortName = $env:AETHOR_PREFLIGHT_PORT_NAME,

    [string]$ExpectedInstanceId = $env:AETHOR_PREFLIGHT_EXPECTED_INSTANCE_ID,

    [ValidateRange(1024, 65535)]
    [int]$GatewayPort = 5127,

    [ValidateRange(60, 14400)]
    [int]$DurationSeconds = 600,

    [ValidateRange(1, 10)]
    [int]$SampleIntervalSeconds = 5,

    [string]$Operator,

    [string]$AuthorizationId,

    [string]$AuthorizationPhrase,

    [switch]$WorkspaceClear,

    [switch]$PhysicalEmergencyStopReachable,

    [switch]$RobotStationary,

    [switch]$MotorDisabledExpected,

    [switch]$AcknowledgeReadOnlyQueries,

    [switch]$ValidateOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$profileId = 'dummy-6dof'
$requiredAuthorizationPhrase = 'AUTHORIZE DUMMY READ-ONLY SOAK'
$allowedQueries = @('#GETJPOS', '#GETMODE', '#GETENABLE')
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$preflightScript = Join-Path $PSScriptRoot 'preflight-readonly.ps1'
$gatewayAssembly = Join-Path $PSScriptRoot 'src\AethorStudioV2.Api\bin\Release\net10.0\AethorStudioV2.Api.dll'
$projectLocalDotnet = Join-Path $repositoryRoot '.tools\dotnet\dotnet.exe'

if ([string]::IsNullOrWhiteSpace($PortName) -or $PortName -notmatch '^COM[1-9][0-9]*$') {
    throw 'PortName must be a Windows COM name such as COM4.'
}
if ([string]::IsNullOrWhiteSpace($ExpectedInstanceId)) {
    throw 'ExpectedInstanceId is required and must come from the current enumeration-only preflight.'
}
if (-not (Test-Path -LiteralPath $preflightScript -PathType Leaf)) {
    throw 'The enumeration-only preflight script is missing.'
}
if (-not (Test-Path -LiteralPath $gatewayAssembly -PathType Leaf)) {
    throw 'Release gateway assembly is missing. Run pnpm gateway:build before validation or a supervised soak.'
}

if ($ValidateOnly) {
    [ordered]@{
        schemaVersion = 'aethor.phase7b.readonly-soak-validation.v1'
        timestampUtc = [DateTimeOffset]::UtcNow.ToString('O')
        operation = 'validation-only'
        passed = $true
        profileId = $profileId
        durationSeconds = $DurationSeconds
        sampleIntervalSeconds = $SampleIntervalSeconds
        allowedQueries = $allowedQueries
        gatewayStarted = $false
        serialPortOpened = $false
        networkRequestSent = $false
        hardwareCommandSent = $false
        filesystemMutationPerformed = $false
    } | ConvertTo-Json -Depth 4
    return
}

if ([string]::IsNullOrWhiteSpace($Operator) -or
    $Operator.Length -gt 80 -or
    $Operator.IndexOfAny([char[]]@(0x0a, 0x0d, 0x00)) -ge 0) {
    throw 'Operator is required, must be at most 80 characters, and cannot contain control characters.'
}
if ([string]::IsNullOrWhiteSpace($AuthorizationId) -or
    $AuthorizationId -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{3,63}$') {
    throw 'AuthorizationId must be 4-64 characters using letters, digits, dot, underscore, or hyphen.'
}
if (-not [string]::Equals($AuthorizationPhrase, $requiredAuthorizationPhrase, [StringComparison]::Ordinal)) {
    throw "AuthorizationPhrase must exactly equal '$requiredAuthorizationPhrase'."
}

$missingConfirmations = @(
    if (-not $WorkspaceClear) { 'WorkspaceClear' }
    if (-not $PhysicalEmergencyStopReachable) { 'PhysicalEmergencyStopReachable' }
    if (-not $RobotStationary) { 'RobotStationary' }
    if (-not $MotorDisabledExpected) { 'MotorDisabledExpected' }
    if (-not $AcknowledgeReadOnlyQueries) { 'AcknowledgeReadOnlyQueries' }
)
if ($missingConfirmations.Count -gt 0) {
    throw "Supervised read-only soak confirmations are incomplete: $($missingConfirmations -join ', ')."
}

$dotnetExecutable = if (Test-Path -LiteralPath $projectLocalDotnet -PathType Leaf) {
    $projectLocalDotnet
}
else {
    $dotnetCommand = Get-Command dotnet -ErrorAction SilentlyContinue
    if ($null -eq $dotnetCommand) {
        throw '.NET 10 runtime is required. Install it or place a non-admin installation in .tools\dotnet.'
    }
    $dotnetCommand.Source
}

$runId = [DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssZ')
$evidenceRoot = Join-Path $repositoryRoot "TestResults\phase-07b-readonly-soak\$runId"
New-Item -ItemType Directory -Path $evidenceRoot -ErrorAction Stop | Out-Null
$samplesPath = Join-Path $evidenceRoot 'samples.ndjson'
$gatewayStdout = Join-Path $evidenceRoot 'gateway.stdout.log'
$gatewayStderr = Join-Path $evidenceRoot 'gateway.stderr.log'
$summaryPath = Join-Path $evidenceRoot 'summary.json'
$utf8NoBom = [Text.UTF8Encoding]::new($false)

$gatewayProcess = $null
$sessionToken = $null
$connected = $false
$failure = $null
$protocolFrameIds = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
$protocolErrorIds = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
$txViolationIds = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
$firstWorkingSetBytes = $null
$lastWorkingSetBytes = $null
$peakWorkingSetBytes = 0L
$firstPrivateMemoryBytes = $null
$lastPrivateMemoryBytes = $null
$peakPrivateMemoryBytes = 0L
$firstHandleCount = $null
$lastHandleCount = $null
$peakHandleCount = 0
$firstSequence = $null
$lastSequence = $null
$sampleCount = 0
$sessionId = $null
$sampleStartedUtc = $null
$sampleEndedUtc = $null
$cleanupSessionState = $null
$hostShutdownStatus = $null
$gatewayExited = $false
$tokenLeakDetected = $null
$postCleanupPreflightPassed = $false

$environmentNames = @(
    'ASPNETCORE_ENVIRONMENT',
    'AETHOR_GATEWAY_SESSION_TOKEN',
    'AETHOR_GATEWAY_TOKEN_SOURCE',
    'AETHOR_GATEWAY_PORT',
    'AETHOR_GATEWAY_DEV_ORIGINS',
    'AETHOR_GATEWAY_COMMAND_POLICY',
    'AETHOR_GATEWAY_JOINT_GROUP_SPEED_LIMIT_DEG_S',
    'AETHOR_GATEWAY_JOINT_GROUP_POSITION_TOLERANCE_DEG',
    'AETHOR_GATEWAY_JOINT_GROUP_SETTLED_DURATION_MS',
    'AETHOR_GATEWAY_JOINT_GROUP_COMPLETION_TIMEOUT_MS',
    'NO_PROXY'
)
$environmentBackup = @{}
foreach ($name in $environmentNames) {
    $environmentBackup[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}

$summary = [ordered]@{
    schemaVersion = 'aethor.phase7b.readonly-soak.v1'
    runId = $runId
    timestampUtc = [DateTimeOffset]::UtcNow.ToString('O')
    evidenceRoot = $evidenceRoot
    operator = $Operator
    authorizationId = $AuthorizationId
    profileId = $profileId
    requestedPortName = $PortName
    expectedInstanceId = $ExpectedInstanceId
    durationSeconds = $DurationSeconds
    sampleIntervalSeconds = $SampleIntervalSeconds
    allowedQueries = $allowedQueries
    hardwareAccessAuthorized = $true
    commandPolicy = 'disabled'
    gatewayStarted = $false
    gatewayPid = $null
    serialConnectRequested = $false
    serialPortOpened = $false
    networkRequestSent = $false
    hardwareCommandSent = $false
    initialPreflightPassed = $false
    capabilitiesVerified = $false
    enumeratedPortVerified = $false
    initialMeasuredStateVerified = $false
    sampleCount = 0
    firstSequence = $null
    lastSequence = $null
    sequenceDelta = $null
    observedSequenceRateHz = $null
    uniqueProtocolFrameCount = 0
    protocolErrorFrameCount = 0
    txViolationCount = 0
    workingSetStartBytes = $null
    workingSetEndBytes = $null
    workingSetPeakBytes = $null
    workingSetGrowthBytes = $null
    privateMemoryStartBytes = $null
    privateMemoryEndBytes = $null
    privateMemoryPeakBytes = $null
    privateMemoryGrowthBytes = $null
    handleCountStart = $null
    handleCountEnd = $null
    handleCountPeak = $null
    handleCountGrowth = $null
    cleanupSessionState = $null
    hostShutdownStatus = $null
    gatewayExited = $false
    postCleanupPreflightPassed = $false
    tokenLeakDetected = $null
    resourceAcceptanceEvaluated = $false
    browserHeapCaptured = $false
    hardwareFaultInjectionPerformed = $false
    phase7bCompleted = $false
    evidenceCollectionPassed = $false
}

function New-SessionToken {
    $bytes = New-Object byte[] 32
    $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $generator.GetBytes($bytes)
    }
    finally {
        $generator.Dispose()
    }

    return -join ($bytes | ForEach-Object { $_.ToString('x2') })
}

function Invoke-PreflightCapture {
    param(
        [Parameter(Mandatory = $true)]
        [string]$OutputPath
    )

    $json = & powershell -NoProfile -ExecutionPolicy Bypass `
        -File $preflightScript `
        -PortName $PortName `
        -ExpectedInstanceId $ExpectedInstanceId `
        -GatewayPort $GatewayPort
    $exitCode = $LASTEXITCODE
    $json | Set-Content -LiteralPath $OutputPath -Encoding UTF8
    return [pscustomobject]@{
        ExitCode = $exitCode
        Result = $json | ConvertFrom-Json
    }
}

function Wait-ForGatewayReady {
    param(
        [Parameter(Mandatory = $true)]
        [string]$BaseUrl
    )

    $deadline = [DateTimeOffset]::UtcNow.AddSeconds(30)
    do {
        if ($gatewayProcess.HasExited) {
            throw "Gateway exited before readiness succeeded (exit $($gatewayProcess.ExitCode))."
        }

        try {
            $ready = Invoke-RestMethod "$BaseUrl/health/ready" -TimeoutSec 2
            $summary.networkRequestSent = $true
            if ($ready.status -eq 'ready') {
                return $ready
            }
        }
        catch {
            Start-Sleep -Milliseconds 200
        }
    } while ([DateTimeOffset]::UtcNow -lt $deadline)

    throw 'Gateway did not become ready within 30 seconds.'
}

function ConvertTo-ResponseArray {
    param(
        [AllowNull()]
        [object]$Response
    )

    if ($null -eq $Response) {
        return @()
    }
    if ($Response.PSObject.Properties.Name -contains 'value') {
        return @($Response.value)
    }
    return @($Response)
}

function Test-FiniteJointState {
    param(
        [Parameter(Mandatory = $true)]
        [object]$JointState
    )

    $positions = @($JointState.positionsDeg)
    if ($JointState.profileId -ne $profileId -or
        $JointState.source -ne 'measured' -or
        $JointState.validity -ne 'valid' -or
        $positions.Count -ne 6) {
        return $false
    }

    foreach ($position in $positions) {
        if (-not [double]::IsFinite([double]$position)) {
            return $false
        }
    }
    return $true
}

function Assert-ReadOnlyFrames {
    param(
        [Parameter(Mandatory = $true)]
        [object[]]$Frames
    )

    foreach ($frame in $Frames) {
        if ([string]::IsNullOrWhiteSpace([string]$frame.id)) {
            throw 'Protocol evidence contained a frame without a stable ID.'
        }
        $protocolFrameIds.Add([string]$frame.id) | Out-Null
        if ($frame.direction -eq 'error') {
            $protocolErrorIds.Add([string]$frame.id) | Out-Null
        }
        if ($frame.direction -eq 'tx' -and $allowedQueries -notcontains [string]$frame.raw) {
            $txViolationIds.Add([string]$frame.id) | Out-Null
        }
    }

    if ($txViolationIds.Count -gt 0) {
        throw 'Observed a TX frame outside the exact read-only query allow-list.'
    }
    if ($protocolErrorIds.Count -gt 0) {
        throw 'Observed protocol error frames during the clean read-only soak.'
    }
}

function Write-Sample {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Value
    )

    $line = $Value | ConvertTo-Json -Depth 6 -Compress
    [IO.File]::AppendAllText($samplesPath, $line + [Environment]::NewLine, $utf8NoBom)
}

try {
    $initialPreflight = Invoke-PreflightCapture (Join-Path $evidenceRoot '01-preflight.json')
    if ($initialPreflight.ExitCode -ne 0 -or
        -not $initialPreflight.Result.passed -or
        $initialPreflight.Result.serialPortOpened -or
        $initialPreflight.Result.networkRequestSent) {
        throw "Initial enumeration-only preflight failed (exit $($initialPreflight.ExitCode))."
    }
    $summary.initialPreflightPassed = $true

    $sessionToken = New-SessionToken
    $env:ASPNETCORE_ENVIRONMENT = 'Development'
    $env:AETHOR_GATEWAY_SESSION_TOKEN = $sessionToken
    $env:AETHOR_GATEWAY_TOKEN_SOURCE = 'development'
    $env:AETHOR_GATEWAY_PORT = [string]$GatewayPort
    $env:AETHOR_GATEWAY_DEV_ORIGINS = 'http://127.0.0.1:5174'
    $env:AETHOR_GATEWAY_COMMAND_POLICY = 'disabled'
    $env:NO_PROXY = '127.0.0.1,localhost'
    Remove-Item Env:AETHOR_GATEWAY_JOINT_GROUP_SPEED_LIMIT_DEG_S -ErrorAction SilentlyContinue
    Remove-Item Env:AETHOR_GATEWAY_JOINT_GROUP_POSITION_TOLERANCE_DEG -ErrorAction SilentlyContinue
    Remove-Item Env:AETHOR_GATEWAY_JOINT_GROUP_SETTLED_DURATION_MS -ErrorAction SilentlyContinue
    Remove-Item Env:AETHOR_GATEWAY_JOINT_GROUP_COMPLETION_TIMEOUT_MS -ErrorAction SilentlyContinue

    $gatewayProcess = Start-Process `
        -FilePath $dotnetExecutable `
        -ArgumentList @($gatewayAssembly) `
        -WorkingDirectory (Split-Path -Parent $gatewayAssembly) `
        -RedirectStandardOutput $gatewayStdout `
        -RedirectStandardError $gatewayStderr `
        -WindowStyle Hidden `
        -PassThru
    $summary.gatewayStarted = $true
    $summary.gatewayPid = $gatewayProcess.Id

    $baseUrl = "http://127.0.0.1:$GatewayPort"
    $ready = Wait-ForGatewayReady $baseUrl
    $ready | ConvertTo-Json -Depth 4 |
        Set-Content -LiteralPath (Join-Path $evidenceRoot '02-ready.json') -Encoding UTF8

    $headers = @{ 'X-Aethor-Session' = $sessionToken }
    $capabilities = Invoke-RestMethod "$baseUrl/api/v1/gateway/capabilities" -Headers $headers -TimeoutSec 5
    $portsResponse = Invoke-RestMethod "$baseUrl/api/v1/serial/ports" -Headers $headers -TimeoutSec 5
    [object[]]$ports = @(ConvertTo-ResponseArray $portsResponse)
    $summary.networkRequestSent = $true
    [ordered]@{ capabilities = $capabilities; ports = $ports } | ConvertTo-Json -Depth 8 |
        Set-Content -LiteralPath (Join-Path $evidenceRoot '03-capabilities-and-ports.json') -Encoding UTF8

    if ($capabilities.hardwareCommands -ne $false -or
        $capabilities.commandPolicy -ne 'disabled' -or
        $capabilities.readOnlyConnection -ne $true -or
        @($capabilities.supportedCommands).Count -ne 0 -or
        (@($capabilities.allowedQueries) -join ',') -ne ($allowedQueries -join ',')) {
        throw 'Gateway capabilities are not the exact read-only contract.'
    }
    $summary.capabilitiesVerified = $true

    if (@($ports | Where-Object { $_.portName -eq $PortName }).Count -ne 1) {
        throw "$PortName was not present exactly once in the gateway serial catalog."
    }
    $summary.enumeratedPortVerified = $true

    $summary.serialConnectRequested = $true
    $connectBody = @{ portName = $PortName; profileId = $profileId } | ConvertTo-Json
    $connectedSession = Invoke-RestMethod `
        "$baseUrl/api/v1/session/connect" `
        -Method Post `
        -Headers $headers `
        -ContentType 'application/json' `
        -Body $connectBody `
        -TimeoutSec 15
    $connected = $connectedSession.connectionState -eq 'connected'
    $summary.serialPortOpened = $connected
    if (-not $connected -or $connectedSession.profileId -ne $profileId) {
        throw 'Gateway did not establish the expected Dummy read-only session.'
    }
    $sessionId = [string]$connectedSession.sessionId

    $initialStateDeadline = [DateTimeOffset]::UtcNow.AddSeconds(15)
    $initialSession = $null
    $initialJointState = $null
    do {
        $initialSession = Invoke-RestMethod "$baseUrl/api/v1/session" -Headers $headers -TimeoutSec 5
        $initialJointState = Invoke-RestMethod "$baseUrl/api/v1/joint-state" -Headers $headers -TimeoutSec 5
        if ($initialSession.connectionState -eq 'faulted') {
            throw 'Dummy session faulted before the initial measured state became valid.'
        }
        if ($initialSession.validity -eq 'valid' -and (Test-FiniteJointState $initialJointState)) {
            break
        }
        Start-Sleep -Milliseconds 200
    } while ([DateTimeOffset]::UtcNow -lt $initialStateDeadline)

    if ($initialSession.connectionState -ne 'connected' -or
        $initialSession.sessionId -ne $sessionId -or
        $initialSession.motorState -ne 'disabled' -or
        $initialSession.controlMode -notin @(1, 2, 3) -or
        -not (Test-FiniteJointState $initialJointState)) {
        throw 'Initial measured state was not connected, valid, disabled, mode 1-3, and finite within 15 seconds.'
    }
    $summary.initialMeasuredStateVerified = $true
    [ordered]@{ session = $initialSession; jointState = $initialJointState } | ConvertTo-Json -Depth 8 |
        Set-Content -LiteralPath (Join-Path $evidenceRoot '04-initial-measured-state.json') -Encoding UTF8

    $sampleStartedUtc = [DateTimeOffset]::UtcNow
    $sampleDeadline = $sampleStartedUtc.AddSeconds($DurationSeconds)
    do {
        $session = Invoke-RestMethod "$baseUrl/api/v1/session" -Headers $headers -TimeoutSec 5
        $jointState = Invoke-RestMethod "$baseUrl/api/v1/joint-state" -Headers $headers -TimeoutSec 5
        $framesResponse = Invoke-RestMethod "$baseUrl/api/v1/protocol-frames?limit=500" -Headers $headers -TimeoutSec 5
        [object[]]$frames = @(ConvertTo-ResponseArray $framesResponse)
        $process = Get-Process -Id $gatewayProcess.Id -ErrorAction Stop
        $process.Refresh()

        if ($session.sessionId -ne $sessionId -or
            $session.profileId -ne $profileId -or
            $session.connectionState -ne 'connected' -or
            $session.motorState -ne 'disabled' -or
            $session.validity -ne 'valid' -or
            -not (Test-FiniteJointState $jointState)) {
            throw 'Read-only soak observed a stale, faulted, enabled, mismatched, or invalid measured state.'
        }
        if ($null -ne $lastSequence -and [long]$jointState.sequence -le [long]$lastSequence) {
            throw 'Joint-state sequence did not advance between bounded soak samples.'
        }

        Assert-ReadOnlyFrames $frames

        $workingSetBytes = [long]$process.WorkingSet64
        $privateMemoryBytes = [long]$process.PrivateMemorySize64
        $handleCount = [int]$process.HandleCount
        $sequence = [long]$jointState.sequence
        if ($null -eq $firstWorkingSetBytes) { $firstWorkingSetBytes = $workingSetBytes }
        if ($null -eq $firstPrivateMemoryBytes) { $firstPrivateMemoryBytes = $privateMemoryBytes }
        if ($null -eq $firstHandleCount) { $firstHandleCount = $handleCount }
        if ($null -eq $firstSequence) { $firstSequence = $sequence }
        $lastWorkingSetBytes = $workingSetBytes
        $lastPrivateMemoryBytes = $privateMemoryBytes
        $lastHandleCount = $handleCount
        $lastSequence = $sequence
        $peakWorkingSetBytes = [Math]::Max($peakWorkingSetBytes, $workingSetBytes)
        $peakPrivateMemoryBytes = [Math]::Max($peakPrivateMemoryBytes, $privateMemoryBytes)
        $peakHandleCount = [Math]::Max($peakHandleCount, $handleCount)
        $sampleCount++

        Write-Sample ([ordered]@{
            timestampUtc = [DateTimeOffset]::UtcNow.ToString('O')
            sessionId = $sessionId
            connectionState = $session.connectionState
            motorState = $session.motorState
            controlMode = $session.controlMode
            validity = $session.validity
            jointSequence = $sequence
            jointTimestampUtc = $jointState.timestampUtc
            positionsDeg = @($jointState.positionsDeg)
            protocolFrameCount = $frames.Count
            uniqueProtocolFrameCount = $protocolFrameIds.Count
            workingSetBytes = $workingSetBytes
            privateMemoryBytes = $privateMemoryBytes
            handleCount = $handleCount
            totalProcessorTimeMs = [Math]::Round($process.TotalProcessorTime.TotalMilliseconds, 3)
        })

        $remaining = $sampleDeadline - [DateTimeOffset]::UtcNow
        if ($remaining.TotalMilliseconds -gt 0) {
            Start-Sleep -Milliseconds ([int][Math]::Min($remaining.TotalMilliseconds, $SampleIntervalSeconds * 1000))
        }
    } while ([DateTimeOffset]::UtcNow -lt $sampleDeadline)
    $sampleEndedUtc = [DateTimeOffset]::UtcNow

    $finalSession = Invoke-RestMethod "$baseUrl/api/v1/session" -Headers $headers -TimeoutSec 5
    $finalJointState = Invoke-RestMethod "$baseUrl/api/v1/joint-state" -Headers $headers -TimeoutSec 5
    $finalFramesResponse = Invoke-RestMethod "$baseUrl/api/v1/protocol-frames?limit=500" -Headers $headers -TimeoutSec 5
    [object[]]$finalFrames = @(ConvertTo-ResponseArray $finalFramesResponse)
    Assert-ReadOnlyFrames $finalFrames
    [ordered]@{ session = $finalSession; jointState = $finalJointState; protocolFrames = $finalFrames } |
        ConvertTo-Json -Depth 8 |
        Set-Content -LiteralPath (Join-Path $evidenceRoot '05-final-snapshots.json') -Encoding UTF8
}
catch {
    $failure = $_
}
finally {
    try {
        if ($gatewayProcess -and -not $gatewayProcess.HasExited -and $sessionToken) {
            $baseUrl = "http://127.0.0.1:$GatewayPort"
            $headers = @{ 'X-Aethor-Session' = $sessionToken }
            if ($connected) {
                $disconnectResult = Invoke-RestMethod `
                    "$baseUrl/api/v1/session/disconnect" `
                    -Method Post `
                    -Headers $headers `
                    -TimeoutSec 15
                $cleanupSessionState = [string]$disconnectResult.connectionState
                $disconnectResult | ConvertTo-Json -Depth 6 |
                    Set-Content -LiteralPath (Join-Path $evidenceRoot '06-disconnect.json') -Encoding UTF8
                $connected = $false
            }

            $shutdownResponse = Invoke-WebRequest `
                "$baseUrl/api/v1/host/shutdown" `
                -Method Post `
                -Headers $headers `
                -UseBasicParsing `
                -TimeoutSec 10
            $hostShutdownStatus = [int]$shutdownResponse.StatusCode
            $gatewayProcess.WaitForExit(10000) | Out-Null
        }
    }
    catch {
        if (-not $failure) {
            $failure = $_
        }
    }

    try {
        if ($gatewayProcess -and -not $gatewayProcess.HasExited) {
            Stop-Process -Id $gatewayProcess.Id -Force
            $gatewayProcess.WaitForExit(10000) | Out-Null
        }
        $gatewayExited = $null -eq $gatewayProcess -or $gatewayProcess.HasExited
    }
    catch {
        if (-not $failure) {
            $failure = $_
        }
    }

    if ($sessionToken) {
        $logText = ''
        foreach ($logPath in @($gatewayStdout, $gatewayStderr)) {
            if (Test-Path -LiteralPath $logPath) {
                $logText += [IO.File]::ReadAllText($logPath)
            }
        }
        $tokenLeakDetected =
            $logText.Contains($sessionToken) -or
            $logText.IndexOf('access_token=', [StringComparison]::OrdinalIgnoreCase) -ge 0
    }

    foreach ($name in $environmentNames) {
        $originalValue = $environmentBackup[$name]
        if ($null -eq $originalValue) {
            Remove-Item -Path "Env:$name" -ErrorAction SilentlyContinue
        }
        else {
            Set-Item -Path "Env:$name" -Value $originalValue
        }
    }

    try {
        $postCleanup = Invoke-PreflightCapture (Join-Path $evidenceRoot '07-post-cleanup.json')
        $postCleanupPreflightPassed =
            $postCleanup.ExitCode -eq 0 -and
            $postCleanup.Result.passed -and
            -not $postCleanup.Result.serialPortOpened -and
            -not $postCleanup.Result.networkRequestSent
    }
    catch {
        if (-not $failure) {
            $failure = $_
        }
    }

    $elapsedSeconds = if ($sampleStartedUtc -and $sampleEndedUtc) {
        [Math]::Max(0.001, ($sampleEndedUtc - $sampleStartedUtc).TotalSeconds)
    }
    else {
        $null
    }
    $sequenceDelta = if ($null -ne $firstSequence -and $null -ne $lastSequence) {
        [long]$lastSequence - [long]$firstSequence
    }
    else {
        $null
    }

    $summary.sampleCount = $sampleCount
    $summary.firstSequence = $firstSequence
    $summary.lastSequence = $lastSequence
    $summary.sequenceDelta = $sequenceDelta
    $summary.observedSequenceRateHz = if ($null -ne $sequenceDelta -and $elapsedSeconds) {
        [Math]::Round($sequenceDelta / $elapsedSeconds, 4)
    }
    else { $null }
    $summary.uniqueProtocolFrameCount = $protocolFrameIds.Count
    $summary.protocolErrorFrameCount = $protocolErrorIds.Count
    $summary.txViolationCount = $txViolationIds.Count
    $summary.workingSetStartBytes = $firstWorkingSetBytes
    $summary.workingSetEndBytes = $lastWorkingSetBytes
    $summary.workingSetPeakBytes = if ($sampleCount -gt 0) { $peakWorkingSetBytes } else { $null }
    $summary.workingSetGrowthBytes = if ($null -ne $firstWorkingSetBytes -and $null -ne $lastWorkingSetBytes) {
        [long]$lastWorkingSetBytes - [long]$firstWorkingSetBytes
    }
    else { $null }
    $summary.privateMemoryStartBytes = $firstPrivateMemoryBytes
    $summary.privateMemoryEndBytes = $lastPrivateMemoryBytes
    $summary.privateMemoryPeakBytes = if ($sampleCount -gt 0) { $peakPrivateMemoryBytes } else { $null }
    $summary.privateMemoryGrowthBytes = if ($null -ne $firstPrivateMemoryBytes -and $null -ne $lastPrivateMemoryBytes) {
        [long]$lastPrivateMemoryBytes - [long]$firstPrivateMemoryBytes
    }
    else { $null }
    $summary.handleCountStart = $firstHandleCount
    $summary.handleCountEnd = $lastHandleCount
    $summary.handleCountPeak = if ($sampleCount -gt 0) { $peakHandleCount } else { $null }
    $summary.handleCountGrowth = if ($null -ne $firstHandleCount -and $null -ne $lastHandleCount) {
        [int]$lastHandleCount - [int]$firstHandleCount
    }
    else { $null }
    $summary.cleanupSessionState = $cleanupSessionState
    $summary.hostShutdownStatus = $hostShutdownStatus
    $summary.gatewayExited = $gatewayExited
    $summary.postCleanupPreflightPassed = $postCleanupPreflightPassed
    $summary.tokenLeakDetected = $tokenLeakDetected
    $summary.evidenceCollectionPassed =
        -not $failure -and
        $summary.initialPreflightPassed -and
        $summary.capabilitiesVerified -and
        $summary.enumeratedPortVerified -and
        $summary.initialMeasuredStateVerified -and
        $sampleCount -gt 0 -and
        $protocolErrorIds.Count -eq 0 -and
        $txViolationIds.Count -eq 0 -and
        $cleanupSessionState -eq 'offline' -and
        $hostShutdownStatus -eq 202 -and
        $gatewayExited -and
        $postCleanupPreflightPassed -and
        -not $tokenLeakDetected
    $summary | ConvertTo-Json -Depth 6 |
        Set-Content -LiteralPath $summaryPath -Encoding UTF8
}

if (-not $summary.evidenceCollectionPassed -and -not $failure) {
    $failure = [InvalidOperationException]::new('Read-only soak did not satisfy every cleanup and evidence gate.')
}
if ($failure) {
    throw $failure
}

$summary | ConvertTo-Json -Depth 6
