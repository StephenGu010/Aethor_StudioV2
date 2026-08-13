[CmdletBinding()]
param(
    [int]$GatewayPort = 5127,
    [int]$FrontendPort = 5173
)

$ErrorActionPreference = 'Stop'
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$frontendRoot = Join-Path $repoRoot 'apps\studio-web'
$environmentFile = Join-Path $frontendRoot '.env.local'
$artifactDirectory = Join-Path $repoRoot 'artifacts\dev'

function Read-LocalSetting([string]$Name) {
    foreach ($line in Get-Content -LiteralPath $environmentFile -Encoding UTF8) {
        if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
        $key, $value = $line -split '=', 2
        if ($key.Trim() -eq $Name) { return $value.Trim().Trim('"').Trim("'") }
    }
    return $null
}

function Get-LoopbackListener([int]$Port) {
    return Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -First 1
}

if (-not (Test-Path -LiteralPath $environmentFile -PathType Leaf)) {
    throw 'apps/studio-web/.env.local is required. Copy .env.example and use one random 32-256 character local token.'
}

$gatewayUrl = Read-LocalSetting 'VITE_AETHOR_GATEWAY_URL'
$sessionToken = Read-LocalSetting 'VITE_AETHOR_GATEWAY_SESSION_TOKEN'
$expectedGatewayUrl = "http://127.0.0.1:$GatewayPort"
if ($gatewayUrl -ne $expectedGatewayUrl) {
    throw "VITE_AETHOR_GATEWAY_URL must be $expectedGatewayUrl for this development entry point."
}
if ([string]::IsNullOrWhiteSpace($sessionToken) -or $sessionToken.Length -lt 32 -or $sessionToken.Length -gt 256) {
    throw 'VITE_AETHOR_GATEWAY_SESSION_TOKEN must contain 32-256 characters.'
}
if (Get-LoopbackListener $GatewayPort) {
    throw "Loopback port $GatewayPort is already in use. Stop the existing gateway explicitly before starting another owner."
}

$dotnet = Join-Path $repoRoot '.tools\dotnet\dotnet.exe'
$gatewayAssembly = Join-Path $repoRoot 'services\robot-gateway\src\AethorStudioV2.Api\bin\Release\net10.0\AethorStudioV2.Api.dll'
$node = (Get-Command node -ErrorAction Stop).Source
$vite = Join-Path $frontendRoot 'node_modules\vite\bin\vite.js'
foreach ($requiredFile in @($dotnet, $gatewayAssembly, $node, $vite)) {
    if (-not (Test-Path -LiteralPath $requiredFile -PathType Leaf)) { throw "Required development runtime is missing: $requiredFile" }
}

New-Item -ItemType Directory -Force -Path $artifactDirectory | Out-Null
$env:ASPNETCORE_ENVIRONMENT = 'Development'
$env:ASPNETCORE_URLS = $expectedGatewayUrl
$env:AETHOR_GATEWAY_SESSION_TOKEN = $sessionToken
$env:AETHOR_GATEWAY_TOKEN_SOURCE = 'development'
$env:AETHOR_GATEWAY_COMMAND_POLICY = 'engineering'
$env:NO_PROXY = '127.0.0.1,localhost'

$gateway = Start-Process -FilePath $dotnet -ArgumentList @($gatewayAssembly) -WorkingDirectory $repoRoot `
    -WindowStyle Hidden -RedirectStandardOutput (Join-Path $artifactDirectory 'gateway-engineering.stdout.log') `
    -RedirectStandardError (Join-Path $artifactDirectory 'gateway-engineering.stderr.log') -PassThru
Set-Content -LiteralPath (Join-Path $artifactDirectory 'gateway-engineering.pid') -Value $gateway.Id -Encoding ASCII

$frontendListener = Get-LoopbackListener $FrontendPort
if (-not $frontendListener) {
    $frontend = Start-Process -FilePath $node -ArgumentList @($vite, '--host', '127.0.0.1', '--port', "$FrontendPort", '--strictPort') `
        -WorkingDirectory $frontendRoot -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $artifactDirectory 'frontend.stdout.log') `
        -RedirectStandardError (Join-Path $artifactDirectory 'frontend.stderr.log') -PassThru
    Set-Content -LiteralPath (Join-Path $artifactDirectory 'frontend.pid') -Value $frontend.Id -Encoding ASCII
}

$headers = @{ 'X-Aethor-Session' = $sessionToken }
$capabilities = $null
for ($attempt = 0; $attempt -lt 40; $attempt++) {
    try {
        $capabilities = Invoke-RestMethod -Uri "$expectedGatewayUrl/api/v1/gateway/capabilities" -Headers $headers -TimeoutSec 2
        break
    } catch {
        Start-Sleep -Milliseconds 250
    }
}
if (-not $capabilities) { throw 'Engineering gateway did not become ready. Inspect artifacts/dev/gateway-engineering.stderr.log.' }

$session = Invoke-RestMethod -Uri "$expectedGatewayUrl/api/v1/session" -Headers $headers -TimeoutSec 2
if ($capabilities.contractVersion -ne '1.4' -or $capabilities.commandPolicy -ne 'engineering' -or -not $capabilities.directCommand) {
    throw 'Gateway started without the required RobotGatewayV1.3 engineering direct capability.'
}
if ($session.connectionState -ne 'offline') {
    throw "Gateway startup must not auto-connect a serial port; observed $($session.connectionState)."
}

$frontendReady = $false
for ($attempt = 0; $attempt -lt 40; $attempt++) {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$FrontendPort/console" -TimeoutSec 2
        $frontendReady = $response.StatusCode -eq 200
        if ($frontendReady) { break }
    } catch {
        Start-Sleep -Milliseconds 250
    }
}
if (-not $frontendReady) { throw 'Frontend did not become ready. Inspect artifacts/dev/frontend.stderr.log.' }

[pscustomobject]@{
    gatewayPid = $gateway.Id
    frontendPid = (Get-LoopbackListener $FrontendPort).OwningProcess
    contractVersion = $capabilities.contractVersion
    commandPolicy = $capabilities.commandPolicy
    directCommand = $capabilities.directCommand
    sessionState = $session.connectionState
    frontendUrl = "http://127.0.0.1:$FrontendPort/console"
}
