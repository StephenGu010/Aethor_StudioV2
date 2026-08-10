[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$PackageRoot,

    [switch]$EngineeringOffline
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$resolvedPackageRoot = (Resolve-Path -LiteralPath $PackageRoot).Path
$manifestPath = Join-Path $resolvedPackageRoot 'release-manifest.json'
$manifest = Get-Content -Raw -Encoding UTF8 -LiteralPath $manifestPath | ConvertFrom-Json
if ($manifest.schemaVersion -ne 'aethor.windows-portable.v1') {
    throw 'Unsupported release manifest.'
}

$prefix = $resolvedPackageRoot.TrimEnd('\') + '\'
$manifestPaths = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
foreach ($file in @($manifest.files)) {
    $relativePath = ([string]$file.path).Replace('\', '/')
    if (!$manifestPaths.Add($relativePath)) {
        throw "Manifest path is duplicated: $relativePath"
    }
    $candidate = [IO.Path]::GetFullPath((Join-Path $resolvedPackageRoot $relativePath))
    if (!$candidate.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Manifest path escapes the package: $relativePath"
    }
    if (!(Test-Path -LiteralPath $candidate -PathType Leaf)) {
        throw "Manifest file is missing: $relativePath"
    }
    $actualLength = (Get-Item -LiteralPath $candidate).Length
    if ($actualLength -ne [long]$file.length) {
        throw "Manifest length mismatch: $relativePath"
    }
    $actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $candidate).Hash.ToLowerInvariant()
    if ($actualHash -ne ([string]$file.sha256).ToLowerInvariant()) {
        throw "Manifest hash mismatch: $relativePath"
    }
}

$actualFiles = @(Get-ChildItem -LiteralPath $resolvedPackageRoot -Recurse -File |
    Where-Object { $_.FullName -ne $manifestPath } |
    ForEach-Object { $_.FullName.Substring($resolvedPackageRoot.Length + 1).Replace('\', '/') })
foreach ($actualFile in $actualFiles) {
    if (!$manifestPaths.Contains($actualFile)) {
        throw "Package contains an unmanifested file: $actualFile"
    }
}
if ($actualFiles.Count -ne $manifestPaths.Count) {
    throw 'Package file count does not match the manifest.'
}

$requiredPackageFiles = @(
    'gateway\AethorStudioV2.Api.exe',
    'AethorStudioV2.Desktop.exe',
    'web\index.html',
    'RELEASE-NOTES.md',
    'Legal\dummy-6dof-NOTICE.md',
    'Legal\aethor-robo-dual-7dof-NOTICE.md',
    'Legal\aethor-robo-dual-7dof-provenance.json',
    'Legal\THIRD-PARTY-INVENTORY.spdx.json',
    'Legal\THIRD-PARTY-SUMMARY.json',
    'Legal\THIRD-PARTY-NOTICES.md',
    'Legal\ThirdParty\NPM-LICENSE-TEXTS.md'
)
foreach ($relativePath in $requiredPackageFiles) {
    $required = Join-Path $resolvedPackageRoot $relativePath
    if (!(Test-Path -LiteralPath $required -PathType Leaf)) { throw "Required package file is missing: $required" }
    $manifestRelativePath = $relativePath.Replace('\', '/')
    if (!$manifestPaths.Contains($manifestRelativePath)) {
        throw "Required package file is absent from the manifest: $manifestRelativePath"
    }
}

$spdxPath = Join-Path $resolvedPackageRoot 'Legal\THIRD-PARTY-INVENTORY.spdx.json'
$thirdPartySummaryPath = Join-Path $resolvedPackageRoot 'Legal\THIRD-PARTY-SUMMARY.json'
try {
    $spdx = Get-Content -Raw -Encoding UTF8 -LiteralPath $spdxPath | ConvertFrom-Json
    $thirdPartySummary = Get-Content -Raw -Encoding UTF8 -LiteralPath $thirdPartySummaryPath | ConvertFrom-Json
}
catch {
    throw 'The third-party inventory or summary is not valid JSON.'
}
if ([string]$spdx.spdxVersion -ne 'SPDX-2.3' -or [string]$spdx.dataLicense -ne 'CC0-1.0' -or
    [string]$spdx.SPDXID -ne 'SPDXRef-DOCUMENT') {
    throw 'The third-party inventory does not identify an SPDX 2.3 document.'
}
if ([string]$thirdPartySummary.schemaVersion -ne 'aethor.third-party-inventory-summary.v1') {
    throw 'The third-party inventory summary schema is unsupported.'
}
if ([string]$thirdPartySummary.productVersion -ne [string]$manifest.version -or
    [string]$thirdPartySummary.sourceCommit -ne [string]$manifest.commit -or
    [string]$thirdPartySummary.generatedAtUtc -ne [string]$manifest.generatedAtUtc) {
    throw 'The third-party inventory summary is not bound to this packaged build.'
}
$spdxIds = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
$purls = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
$npmComponentCount = 0
$dotnetComponentCount = 0
$rootPackageCount = 0
foreach ($package in @($spdx.packages)) {
    $spdxId = [string]$package.SPDXID
    if ([string]::IsNullOrWhiteSpace($spdxId) -or !$spdxIds.Add($spdxId)) {
        throw "SPDX package ID is empty or duplicated: $spdxId"
    }
    if ($spdxId -eq 'SPDXRef-AethorStudioV2') {
        $rootPackageCount += 1
        continue
    }
    if ([bool]$package.filesAnalyzed -or [string]::IsNullOrWhiteSpace([string]$package.licenseDeclared)) {
        throw "SPDX dependency package metadata is incomplete: $spdxId"
    }
    $packagePurls = @($package.externalRefs | Where-Object {
        [string]$_.referenceCategory -eq 'PACKAGE-MANAGER' -and [string]$_.referenceType -eq 'purl'
    })
    if ($packagePurls.Count -ne 1) { throw "SPDX dependency must have one package purl: $spdxId" }
    $purl = [string]$packagePurls[0].referenceLocator
    if (!$purls.Add($purl)) { throw "SPDX package purl is duplicated: $purl" }
    if ($purl.StartsWith('pkg:npm/', [StringComparison]::Ordinal)) {
        $npmComponentCount += 1
    }
    elseif ($purl.StartsWith('pkg:nuget/', [StringComparison]::Ordinal)) {
        $dotnetComponentCount += 1
    }
    else {
        throw "Unsupported SPDX package ecosystem: $purl"
    }
}
$dependencyComponentCount = $spdxIds.Count - $rootPackageCount
if ($rootPackageCount -ne 1 -or
    $dependencyComponentCount -ne [int]$thirdPartySummary.componentCount -or
    $npmComponentCount -ne [int]$thirdPartySummary.npmComponentCount -or
    $dotnetComponentCount -ne [int]$thirdPartySummary.dotnetComponentCount -or
    $npmComponentCount -le 0 -or $dotnetComponentCount -le 0) {
    throw 'The SPDX inventory component counts do not match the third-party summary.'
}
$missingLicenseTexts = @($thirdPartySummary.missingLicenseTexts)
if ($missingLicenseTexts.Count -ne [int]$thirdPartySummary.missingLicenseTextCount) {
    throw 'The third-party missing-license count is inconsistent.'
}
$calculatedReleaseReady = $missingLicenseTexts.Count -eq 0
if ([bool]$thirdPartySummary.releaseReady -ne $calculatedReleaseReady) {
    throw 'The third-party release-ready flag is inconsistent with its license-text gaps.'
}
if (@($spdx.relationships).Count -ne $dependencyComponentCount) {
    throw 'The SPDX dependency relationship count is incomplete.'
}
$legalArtifactPaths = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
foreach ($relativePathValue in @($thirdPartySummary.legalArtifacts)) {
    $relativePath = ([string]$relativePathValue).Replace('\', '/')
    if (!$relativePath.StartsWith('Legal/ThirdParty/', [StringComparison]::Ordinal) -or
        !$legalArtifactPaths.Add($relativePath)) {
        throw "Third-party legal artifact path is unsafe or duplicated: $relativePath"
    }
    $candidate = [IO.Path]::GetFullPath((Join-Path $resolvedPackageRoot $relativePath.Replace('/', '\')))
    if (!$candidate.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) -or
        !(Test-Path -LiteralPath $candidate -PathType Leaf) -or
        !$manifestPaths.Contains($relativePath)) {
        throw "Third-party legal artifact is missing from the verified package manifest: $relativePath"
    }
}
if (!$legalArtifactPaths.Contains('Legal/ThirdParty/NPM-LICENSE-TEXTS.md')) {
    throw 'The npm production license-text bundle is absent from the third-party summary.'
}

$gatewayExecutable = Join-Path $resolvedPackageRoot 'gateway\AethorStudioV2.Api.exe'
$desktopExecutable = Join-Path $resolvedPackageRoot 'AethorStudioV2.Desktop.exe'
$webIndex = Join-Path $resolvedPackageRoot 'web\index.html'

$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$listener.Start()
$port = ([Net.IPEndPoint]$listener.LocalEndpoint).Port
$listener.Stop()
$tokenBytes = New-Object byte[] 32
$tokenGenerator = [Security.Cryptography.RandomNumberGenerator]::Create()
try { $tokenGenerator.GetBytes($tokenBytes) } finally { $tokenGenerator.Dispose() }
$token = [Convert]::ToBase64String($tokenBytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
$stdout = Join-Path ([IO.Path]::GetTempPath()) "aethor-gateway-$([Guid]::NewGuid().ToString('N')).stdout.log"
$stderr = Join-Path ([IO.Path]::GetTempPath()) "aethor-gateway-$([Guid]::NewGuid().ToString('N')).stderr.log"
$gatewayProcess = $null

try {
    $env:ASPNETCORE_ENVIRONMENT = if ($EngineeringOffline) { 'Development' } else { 'Production' }
    $env:AETHOR_GATEWAY_PORT = $port.ToString([Globalization.CultureInfo]::InvariantCulture)
    $env:AETHOR_GATEWAY_SESSION_TOKEN = $token
    $env:AETHOR_GATEWAY_TOKEN_SOURCE = if ($EngineeringOffline) { 'development' } else { 'desktop' }
    $env:AETHOR_GATEWAY_COMMAND_POLICY = if ($EngineeringOffline) { 'engineering' } else { 'disabled' }
    $env:AETHOR_GATEWAY_DEV_ORIGINS = 'http://localhost'
    $gatewayProcess = Start-Process -FilePath $gatewayExecutable -WorkingDirectory (Split-Path $gatewayExecutable) `
        -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    $baseUrl = "http://127.0.0.1:$port"
    $ready = $false
    $deadline = [DateTimeOffset]::UtcNow.AddSeconds(20)
    while ([DateTimeOffset]::UtcNow -lt $deadline -and !$gatewayProcess.HasExited) {
        try {
            $response = Invoke-WebRequest "$baseUrl/health/ready" -UseBasicParsing -TimeoutSec 1
            if ($response.StatusCode -eq 200) { $ready = $true; break }
        } catch { }
        Start-Sleep -Milliseconds 100
    }
    if (!$ready) { throw 'Packaged gateway did not become ready.' }

    $headers = @{ 'X-Aethor-Session' = $token }
    $session = Invoke-RestMethod "$baseUrl/api/v1/session" -Headers $headers -TimeoutSec 2
    $capabilities = Invoke-RestMethod "$baseUrl/api/v1/gateway/capabilities" -Headers $headers -TimeoutSec 2
    if ($session.connectionState -ne 'offline' -or $session.motorState -ne 'unknown') {
        throw 'Packaged gateway did not start in the explicit offline state.'
    }
    if ($EngineeringOffline) {
        if ($capabilities.commandPolicy -ne 'engineering' -or
            $capabilities.hardwareCommands -ne $true -or
            $capabilities.directCommand -ne $true) {
            throw 'Packaged gateway did not expose the explicit offline engineering capabilities.'
        }
    }
    elseif ($capabilities.hardwareCommands -ne $false -or
        $capabilities.directCommand -ne $false -or
        $capabilities.commandPolicy -ne 'disabled') {
        throw 'Packaged gateway unexpectedly enabled hardware commands.'
    }

    $shutdown = Invoke-WebRequest "$baseUrl/api/v1/host/shutdown" -Method Post -Headers $headers `
        -UseBasicParsing -TimeoutSec 3
    if ($shutdown.StatusCode -ne 202) { throw "Gateway shutdown returned HTTP $($shutdown.StatusCode)." }
    if (!$gatewayProcess.WaitForExit(10000)) { throw 'Packaged gateway did not exit after accepted shutdown.' }

    [ordered]@{
        succeeded = $true
        packageRoot = $resolvedPackageRoot
        manifestFilesVerified = $manifestPaths.Count
        packageFilesVerified = $actualFiles.Count + 1
        gatewayReady = $true
        sessionState = 'offline'
        commandPolicy = [string]$capabilities.commandPolicy
        directCommand = [bool]$capabilities.directCommand
        engineeringOffline = [bool]$EngineeringOffline
        thirdPartyComponentsVerified = $dependencyComponentCount
        thirdPartyMissingLicenseTexts = $missingLicenseTexts.Count
        thirdPartyReleaseReady = [bool]$thirdPartySummary.releaseReady
        shutdownAccepted = $true
        gatewayExited = $true
        serialPortOpened = $false
        hardwareCommandSent = $false
    } | ConvertTo-Json
}
finally {
    if ($gatewayProcess -and !$gatewayProcess.HasExited) {
        Stop-Process -Id $gatewayProcess.Id -Force
        $gatewayProcess.WaitForExit(5000) | Out-Null
    }
    foreach ($name in @(
        'ASPNETCORE_ENVIRONMENT',
        'AETHOR_GATEWAY_PORT',
        'AETHOR_GATEWAY_SESSION_TOKEN',
        'AETHOR_GATEWAY_TOKEN_SOURCE',
        'AETHOR_GATEWAY_COMMAND_POLICY',
        'AETHOR_GATEWAY_DEV_ORIGINS')) {
        Remove-Item "Env:$name" -ErrorAction SilentlyContinue
    }
    Remove-Item -LiteralPath $stdout, $stderr -Force -ErrorAction SilentlyContinue
}
