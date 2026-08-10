[CmdletBinding()]
param(
    [string]$PortName = $env:AETHOR_PREFLIGHT_PORT_NAME,

    [string]$ExpectedInstanceId = $env:AETHOR_PREFLIGHT_EXPECTED_INSTANCE_ID,

    [ValidateRange(1024, 65535)]
    [int]$GatewayPort = 5127,

    [string]$DevelopmentOrigin = 'http://127.0.0.1:5174'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($PortName) -or $PortName -notmatch '^COM[1-9][0-9]*$') {
    throw 'PortName must be a Windows COM name such as COM4.'
}
if ([string]::IsNullOrWhiteSpace($ExpectedInstanceId)) {
    throw 'ExpectedInstanceId is required and must be verified by the operator.'
}

$originUri = $null
if (-not [Uri]::TryCreate($DevelopmentOrigin, [UriKind]::Absolute, [ref]$originUri) -or
    $originUri.Scheme -notin @('http', 'https') -or
    $originUri.AbsolutePath -ne '/') {
    throw 'DevelopmentOrigin must be a loopback HTTP(S) origin without a path.'
}
$originAddress = $null
$isLoopbackHost =
    [string]::Equals($originUri.Host, 'localhost', [StringComparison]::OrdinalIgnoreCase) -or
    ([Net.IPAddress]::TryParse($originUri.Host, [ref]$originAddress) -and
        [Net.IPAddress]::IsLoopback($originAddress))
if (-not $isLoopbackHost) {
    throw 'DevelopmentOrigin must use localhost or a loopback IP address.'
}

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$preflightScript = Join-Path $PSScriptRoot 'preflight-readonly.ps1'
$gatewayAssembly = Join-Path $PSScriptRoot 'src\AethorStudioV2.Api\bin\Release\net10.0\AethorStudioV2.Api.dll'
$projectLocalDotnet = Join-Path $repositoryRoot '.tools\dotnet\dotnet.exe'
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

if (-not (Test-Path -LiteralPath $gatewayAssembly -PathType Leaf)) {
    throw 'Release gateway assembly is missing. Run pnpm gateway:build before the offline smoke.'
}

$runId = [DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssZ')
$evidenceRoot = Join-Path $repositoryRoot "TestResults\phase-04-runbook-smoke\$runId"
New-Item -ItemType Directory -Force -Path $evidenceRoot | Out-Null

$gatewayProcess = $null
$gatewayStdout = Join-Path $evidenceRoot 'gateway.stdout.log'
$gatewayStderr = Join-Path $evidenceRoot 'gateway.stderr.log'
$sessionToken = $null
$failure = $null
$environmentNames = @(
    'ASPNETCORE_ENVIRONMENT',
    'AETHOR_GATEWAY_SESSION_TOKEN',
    'AETHOR_GATEWAY_TOKEN_SOURCE',
    'AETHOR_GATEWAY_PORT',
    'AETHOR_GATEWAY_DEV_ORIGINS',
    'NO_PROXY'
)
$environmentBackup = @{}
foreach ($name in $environmentNames) {
    $environmentBackup[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
$summary = [ordered]@{
    schemaVersion = 'aethor.phase4.offline-smoke.v1'
    runId = $runId
    evidenceRoot = $evidenceRoot
    serialConnectRequested = $false
    initialPreflightPassed = $false
    livenessStatus = $null
    unauthenticatedStatus = $null
    signalRPreflightStatus = $null
    signalRPreflightAllowsClientHeaders = $false
    hardwareCommands = $null
    readOnlyConnection = $null
    comPortEnumerated = $false
    sessionConnectionState = $null
    sessionSource = $null
    sessionValidity = $null
    activePreflightExitCode = $null
    activePreflightPassed = $null
    postCleanupPreflightPassed = $false
    tokenLeakDetected = $null
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
    $json | Set-Content -Encoding UTF8 -LiteralPath $OutputPath

    return [pscustomobject]@{
        ExitCode = $exitCode
        Result = $json | ConvertFrom-Json
    }
}

function Wait-ForGatewayLive {
    param(
        [Parameter(Mandatory = $true)]
        [string]$BaseUrl
    )

    $deadline = [DateTimeOffset]::UtcNow.AddSeconds(30)
    do {
        if ($gatewayProcess.HasExited) {
            throw "Gateway exited before liveness succeeded (exit $($gatewayProcess.ExitCode))."
        }

        try {
            return Invoke-RestMethod "$BaseUrl/health/live" -TimeoutSec 2
        }
        catch {
            Start-Sleep -Milliseconds 200
        }
    } while ([DateTimeOffset]::UtcNow -lt $deadline)

    throw 'Gateway did not become live within 30 seconds.'
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

try {
    $initial = Invoke-PreflightCapture (Join-Path $evidenceRoot '01-preflight.json')
    if ($initial.ExitCode -ne 0 -or
        -not $initial.Result.passed -or
        $initial.Result.serialPortOpened -or
        $initial.Result.networkRequestSent) {
        throw "Initial enumeration-only preflight failed (exit $($initial.ExitCode))."
    }
    $summary.initialPreflightPassed = $true

    $sessionToken = New-SessionToken
    $env:ASPNETCORE_ENVIRONMENT = 'Development'
    $env:AETHOR_GATEWAY_SESSION_TOKEN = $sessionToken
    $env:AETHOR_GATEWAY_TOKEN_SOURCE = 'development'
    $env:AETHOR_GATEWAY_PORT = [string]$GatewayPort
    $env:AETHOR_GATEWAY_DEV_ORIGINS = $DevelopmentOrigin
    $env:NO_PROXY = '127.0.0.1,localhost'

    $gatewayProcess = Start-Process `
        -FilePath $dotnetExecutable `
        -ArgumentList @($gatewayAssembly) `
        -WorkingDirectory (Split-Path -Parent $gatewayAssembly) `
        -RedirectStandardOutput $gatewayStdout `
        -RedirectStandardError $gatewayStderr `
        -WindowStyle Hidden `
        -PassThru

    $baseUrl = "http://127.0.0.1:$GatewayPort"
    $health = Wait-ForGatewayLive $baseUrl
    $health | ConvertTo-Json -Depth 4 |
        Set-Content -Encoding UTF8 -LiteralPath (Join-Path $evidenceRoot '02-health.json')
    if ($health.status -ne 'live') {
        throw "Unexpected liveness status '$($health.status)'."
    }
    $summary.livenessStatus = $health.status

    try {
        Invoke-RestMethod "$baseUrl/api/v1/session" -TimeoutSec 5 | Out-Null
        throw 'Unauthenticated session request unexpectedly succeeded.'
    }
    catch {
        if ($_.Exception.Message -eq 'Unauthenticated session request unexpectedly succeeded.') {
            throw
        }

        if (-not $_.Exception.Response -or [int]$_.Exception.Response.StatusCode -ne 401) {
            throw "Unable to prove unauthenticated 401: $($_.Exception.Message)"
        }
        $summary.unauthenticatedStatus = 401
    }
    @{ status = $summary.unauthenticatedStatus } | ConvertTo-Json |
        Set-Content -Encoding UTF8 -LiteralPath (Join-Path $evidenceRoot '03-unauthenticated.json')

    $preflightHeaders = @{
        Origin = $DevelopmentOrigin
        'Access-Control-Request-Method' = 'POST'
        'Access-Control-Request-Headers' = 'authorization,x-requested-with,x-signalr-user-agent'
    }
    $signalRPreflight = Invoke-WebRequest `
        "$baseUrl/hubs/robot-v1/negotiate?negotiateVersion=1" `
        -Method Options `
        -Headers $preflightHeaders `
        -UseBasicParsing `
        -TimeoutSec 5
    $allowedHeaders = [string]$signalRPreflight.Headers['Access-Control-Allow-Headers']
    $allowedHeaderNames = @(
        $allowedHeaders.Split(',') |
            ForEach-Object { $_.Trim().ToLowerInvariant() } |
            Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    )
    $summary.signalRPreflightStatus = [int]$signalRPreflight.StatusCode
    $summary.signalRPreflightAllowsClientHeaders =
        $allowedHeaderNames -contains 'x-requested-with' -and
        $allowedHeaderNames -contains 'x-signalr-user-agent'
    if ($summary.signalRPreflightStatus -ne 204 -or
        -not $summary.signalRPreflightAllowsClientHeaders -or
        [string]$signalRPreflight.Headers['Access-Control-Allow-Origin'] -ne $DevelopmentOrigin) {
        throw 'SignalR negotiate CORS preflight did not allow the exact loopback origin and client headers.'
    }
    [ordered]@{
        status = $summary.signalRPreflightStatus
        allowOrigin = [string]$signalRPreflight.Headers['Access-Control-Allow-Origin']
        allowHeaders = $allowedHeaderNames
    } | ConvertTo-Json -Depth 4 |
        Set-Content -Encoding UTF8 -LiteralPath (Join-Path $evidenceRoot '04-signalr-preflight.json')

    $headers = @{ 'X-Aethor-Session' = $sessionToken }
    $capabilities = Invoke-RestMethod "$baseUrl/api/v1/gateway/capabilities" -Headers $headers -TimeoutSec 5
    # Windows PowerShell 5.1 may represent a top-level JSON array as a PSObject
    # with value/Count properties. Normalize that adapter shape before evidence.
    $portsResponse = Invoke-RestMethod "$baseUrl/api/v1/serial/ports" -Headers $headers -TimeoutSec 5
    [object[]]$ports = @(
        if ($portsResponse.PSObject.Properties.Name -contains 'value') {
            $portsResponse.value
        }
        else {
            $portsResponse
        }
    )
    $session = Invoke-RestMethod "$baseUrl/api/v1/session" -Headers $headers -TimeoutSec 5
    [ordered]@{
        capabilities = $capabilities
        ports = $ports
        session = $session
    } | ConvertTo-Json -Depth 8 |
        Set-Content -Encoding UTF8 -LiteralPath (Join-Path $evidenceRoot '05-offline-gateway.json')

    $allowedQueries = @($capabilities.allowedQueries)
    if ($capabilities.hardwareCommands -ne $false -or
        $capabilities.readOnlyConnection -ne $true -or
        ($allowedQueries -join ',') -ne '#GETJPOS,#GETMODE,#GETENABLE') {
        throw 'Gateway capabilities are not the exact Phase 4 read-only contract.'
    }

    $portEnumerated = @($ports | Where-Object { $_.portName -eq $PortName }).Count -eq 1
    if (-not $portEnumerated) {
        throw "$PortName was not present exactly once in the enumeration-only catalog."
    }

    if ($session.connectionState -ne 'offline' -or
        $session.source -ne 'unavailable' -or
        $session.validity -ne 'unavailable') {
        throw "Offline session mismatch: $($session.connectionState)/$($session.source)/$($session.validity)."
    }

    $summary.hardwareCommands = $capabilities.hardwareCommands
    $summary.readOnlyConnection = $capabilities.readOnlyConnection
    $summary.comPortEnumerated = $portEnumerated
    $summary.sessionConnectionState = $session.connectionState
    $summary.sessionSource = $session.source
    $summary.sessionValidity = $session.validity

    $active = Invoke-PreflightCapture (Join-Path $evidenceRoot '06-active-preflight.json')
    $summary.activePreflightExitCode = $active.ExitCode
    $summary.activePreflightPassed = $active.Result.passed
    $resourceFailures = @(
        $active.Result.checks |
            Where-Object {
                $_.name -in @('gateway-process-absent', 'gateway-listener-absent') -and
                -not $_.passed
            }
    )
    if ($active.ExitCode -ne 2 -or
        $active.Result.passed -or
        $active.Result.serialPortOpened -or
        $active.Result.networkRequestSent -or
        $resourceFailures.Count -lt 1) {
        throw 'Active preflight did not fail closed on the running gateway resource.'
    }
}
catch {
    $failure = $_
}
finally {
    try {
        if ($gatewayProcess -and -not $gatewayProcess.HasExited) {
            Stop-Process -Id $gatewayProcess.Id -Force
            $gatewayProcess.WaitForExit(10000) | Out-Null
        }
    }
    catch {
        if (-not $failure) {
            $failure = $_
        }
    }

    $cleanupDeadline = [DateTimeOffset]::UtcNow.AddSeconds(10)
    do {
        $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $GatewayPort -ErrorAction SilentlyContinue)
        if ($listeners.Count -gt 0) {
            Start-Sleep -Milliseconds 200
        }
    } while ($listeners.Count -gt 0 -and [DateTimeOffset]::UtcNow -lt $cleanupDeadline)

    if ($sessionToken) {
        $logText = ''
        foreach ($logPath in @($gatewayStdout, $gatewayStderr)) {
            if (Test-Path -LiteralPath $logPath) {
                $logText += [IO.File]::ReadAllText($logPath)
            }
        }
        $summary.tokenLeakDetected =
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
        $summary.postCleanupPreflightPassed =
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

    $summary | ConvertTo-Json -Depth 5 |
        Set-Content -Encoding UTF8 -LiteralPath (Join-Path $evidenceRoot 'summary.json')
}

if (-not $summary.postCleanupPreflightPassed -and -not $failure) {
    $failure = [InvalidOperationException]::new('Post-cleanup enumeration-only preflight failed.')
}
if ($summary.tokenLeakDetected -and -not $failure) {
    $failure = [InvalidOperationException]::new('Gateway logs contained the session token or access_token query.')
}
if ($failure) {
    throw $failure
}

$summary | ConvertTo-Json -Depth 5
