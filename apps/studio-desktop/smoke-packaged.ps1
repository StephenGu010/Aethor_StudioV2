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
    'Legal\MODEL-REDISTRIBUTION-STATUS.json',
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
if ([string]$thirdPartySummary.schemaVersion -ne 'aethor.third-party-inventory-summary.v2') {
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
$calculatedDependencyReady = $missingLicenseTexts.Count -eq 0
$incompleteModelRedistributions = @($thirdPartySummary.incompleteModelRedistributions)
if ($incompleteModelRedistributions.Count -ne [int]$thirdPartySummary.incompleteModelRedistributionCount) {
    throw 'The model redistribution gap count is inconsistent.'
}
$calculatedModelReady = $incompleteModelRedistributions.Count -eq 0
$calculatedReleaseReady = $calculatedDependencyReady -and $calculatedModelReady
if ([bool]$thirdPartySummary.dependencyLicenseTextReady -ne $calculatedDependencyReady -or
    [bool]$thirdPartySummary.modelRedistributionReady -ne $calculatedModelReady) {
    throw 'The dependency or model legal readiness flag is inconsistent.'
}
if ([bool]$thirdPartySummary.releaseReady -ne $calculatedReleaseReady) {
    throw 'The release-ready flag is inconsistent with dependency and model legal gaps.'
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

$curatedKeys = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
$curatedLicenseSources = @($thirdPartySummary.curatedLicenseSources)
if ($curatedLicenseSources.Count -ne [int]$thirdPartySummary.curatedLicenseSourceCount) {
    throw 'The curated license source count is inconsistent.'
}
foreach ($source in $curatedLicenseSources) {
    $key = "$([string]$source.ecosystem):$([string]$source.name)@$([string]$source.version)"
    $artifact = ([string]$source.artifact).Replace('\', '/')
    if (!$curatedKeys.Add($key) -or !$legalArtifactPaths.Contains($artifact)) {
        throw "Curated license identity or artifact is duplicated or absent: $key"
    }
    $candidate = [IO.Path]::GetFullPath((Join-Path $resolvedPackageRoot $artifact.Replace('/', '\')))
    $actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $candidate).Hash.ToLowerInvariant()
    if ($actualHash -ne ([string]$source.textSha256).ToLowerInvariant() -or
        [string]$source.upstream.revision -notmatch '^[a-f0-9]{40}$' -or
        [string]$source.upstream.blobSha -notmatch '^[a-f0-9]{40}$' -or
        [string]$source.upstream.contentSha256 -notmatch '^[a-f0-9]{64}$' -or
        [string]::IsNullOrWhiteSpace([string]$source.packageEvidence.integrity)) {
        throw "Curated license provenance is incomplete or changed: $key"
    }
}

$modelArtifactPaths = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
foreach ($relativePathValue in @($thirdPartySummary.modelLegalArtifacts)) {
    $relativePath = ([string]$relativePathValue).Replace('\', '/')
    $candidate = [IO.Path]::GetFullPath((Join-Path $resolvedPackageRoot $relativePath.Replace('/', '\')))
    if (!$relativePath.StartsWith('Legal/', [StringComparison]::Ordinal) -or
        !$modelArtifactPaths.Add($relativePath) -or
        !$candidate.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) -or
        !(Test-Path -LiteralPath $candidate -PathType Leaf) -or
        !$manifestPaths.Contains($relativePath)) {
        throw "Model legal artifact is unsafe, duplicated, or missing from the manifest: $relativePath"
    }
}
foreach ($requiredModelArtifact in @(
    'Legal/MODEL-REDISTRIBUTION-STATUS.json',
    'Legal/dummy-6dof-NOTICE.md',
    'Legal/aethor-robo-dual-7dof-NOTICE.md',
    'Legal/aethor-robo-dual-7dof-provenance.json')) {
    if (!$modelArtifactPaths.Contains($requiredModelArtifact)) {
        throw "Required model legal artifact is absent from the summary: $requiredModelArtifact"
    }
}
$modelProfileIds = @($thirdPartySummary.modelRedistributionStatuses | ForEach-Object { [string]$_.profileId } | Sort-Object)
if (($modelProfileIds -join ',') -ne 'aethor-robo-dual-7dof,dummy-6dof') {
    throw 'The model redistribution gate does not cover exactly the two built-in profiles.'
}
$modelStatusPath = Join-Path $resolvedPackageRoot 'Legal\MODEL-REDISTRIBUTION-STATUS.json'
$modelStatus = Get-Content -Raw -Encoding UTF8 -LiteralPath $modelStatusPath | ConvertFrom-Json
if ([string]$modelStatus.schemaVersion -ne 'aethor.model-redistribution-status.v1') {
    throw 'The packaged model redistribution status schema is unsupported.'
}
foreach ($profile in @($modelStatus.profiles)) {
    $summaryProfiles = @($thirdPartySummary.modelRedistributionStatuses | Where-Object {
        [string]$_.profileId -eq [string]$profile.profileId
    })
    if ($summaryProfiles.Count -ne 1 -or
        [string]$summaryProfiles[0].declaredLicense -ne [string]$profile.declaredLicense -or
        [bool]$summaryProfiles[0].redistributionTermsComplete -ne [bool]$profile.redistributionTermsComplete -or
        [string]$summaryProfiles[0].unresolvedReason -ne [string]$profile.unresolvedReason) {
        throw "Packaged model status and legal summary disagree: $([string]$profile.profileId)"
    }
    foreach ($evidence in @($summaryProfiles[0].evidence)) {
        $artifact = ([string]$evidence.packagedPath).Replace('\', '/')
        if (!$modelArtifactPaths.Contains($artifact)) {
            throw "Model evidence is not declared as a packaged legal artifact: $artifact"
        }
        $candidate = Join-Path $resolvedPackageRoot $artifact.Replace('/', '\')
        $actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $candidate).Hash.ToLowerInvariant()
        if ($actualHash -ne ([string]$evidence.sourceSha256).ToLowerInvariant()) {
            throw "Model evidence hash does not match its source record: $artifact"
        }
    }
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

    $operationId = [Guid]::NewGuid().ToString('D')
    $preflightHeaders = @{
        Origin = 'http://localhost'
        'Access-Control-Request-Method' = 'GET'
        'Access-Control-Request-Headers' = 'x-aethor-session,x-aethor-operation'
    }
    $serialPreflight = Invoke-WebRequest "$baseUrl/api/v1/serial/ports" -Method Options `
        -Headers $preflightHeaders -UseBasicParsing -TimeoutSec 2
    if ($serialPreflight.StatusCode -ne 204 -or
        [string]$serialPreflight.Headers['Access-Control-Allow-Origin'] -ne 'http://localhost') {
        throw 'Packaged gateway did not accept the desktop serial-catalog preflight.'
    }

    $headers = @{ 'X-Aethor-Session' = $token; 'X-Aethor-Operation' = $operationId }
    $session = Invoke-RestMethod "$baseUrl/api/v1/session" -Headers $headers -TimeoutSec 2
    $capabilities = Invoke-RestMethod "$baseUrl/api/v1/gateway/capabilities" -Headers $headers -TimeoutSec 2
    $actionProgramRun = Invoke-WebRequest "$baseUrl/api/v1/engineering/action-program/run" `
        -Headers $headers -UseBasicParsing -TimeoutSec 2
    $serialPortsResponse = Invoke-RestMethod "$baseUrl/api/v1/serial/ports" -Headers $headers -TimeoutSec 2
    [object[]]$serialPorts = @(
        if ($serialPortsResponse.PSObject.Properties.Name -contains 'value') {
            $serialPortsResponse.value
        }
        else {
            $serialPortsResponse
        }
    )
    if ($session.connectionState -ne 'offline' -or $session.motorState -ne 'unknown') {
        throw 'Packaged gateway did not start in the explicit offline state.'
    }
    if ($actionProgramRun.StatusCode -ne 200 -or
        [string]$actionProgramRun.Headers['Content-Type'] -notlike 'application/json*' -or
        $actionProgramRun.Content.Trim() -ne 'null') {
        throw 'Packaged gateway did not serialize an empty action-program run as a JSON null document.'
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

    # Exercise only the validation boundary: the unsupported profile is
    # rejected before port catalog lookup or transport creation. This proves
    # connect probe correlation without opening any enumerated COM port.
    $sessionOperationId = [Guid]::NewGuid().ToString('D')
    $sessionOperationHeaders = @{
        'X-Aethor-Session' = $token
        'X-Aethor-Operation' = $sessionOperationId
    }
    $invalidConnectStatus = $null
    try {
        Invoke-WebRequest "$baseUrl/api/v1/session/connect" -Method Post `
            -Headers $sessionOperationHeaders -ContentType 'application/json' `
            -Body '{"portName":"COM4","profileId":"probe-unsupported"}' `
            -UseBasicParsing -TimeoutSec 3 | Out-Null
        throw 'Invalid Profile connect probe unexpectedly succeeded.'
    }
    catch {
        if ($_.Exception.Message -eq 'Invalid Profile connect probe unexpectedly succeeded.') { throw }
        if (-not $_.Exception.Response) {
            throw "Unable to prove invalid connect rejection: $($_.Exception.Message)"
        }
        $invalidConnectStatus = [int]$_.Exception.Response.StatusCode
    }
    if ($invalidConnectStatus -ne 400) {
        throw "Invalid Profile connect probe returned HTTP $invalidConnectStatus instead of 400."
    }

    $shutdown = Invoke-WebRequest "$baseUrl/api/v1/host/shutdown" -Method Post -Headers $headers `
        -UseBasicParsing -TimeoutSec 3
    if ($shutdown.StatusCode -ne 202) { throw "Gateway shutdown returned HTTP $($shutdown.StatusCode)." }
    if (!$gatewayProcess.WaitForExit(10000)) { throw 'Packaged gateway did not exit after accepted shutdown.' }
    $gatewayLog = [IO.File]::ReadAllText($stdout)
    $sessionProbeCorrelated =
        $gatewayLog.Contains($sessionOperationId) -and
        $gatewayLog.Contains('serial.session.started') -and
        $gatewayLog.Contains('serial.session.failed') -and
        $gatewayLog.Contains('FailureCategory=validation')
    if (-not $sessionProbeCorrelated -or $gatewayLog.Contains('serial.opened')) {
        throw 'Packaged gateway session probe was not correlated or crossed the transport-open boundary.'
    }

    [ordered]@{
        succeeded = $true
        packageRoot = $resolvedPackageRoot
        manifestFilesVerified = $manifestPaths.Count
        packageFilesVerified = $actualFiles.Count + 1
        gatewayReady = $true
        serialCatalogPreflight = $true
        serialPortsEnumerated = $serialPorts.Count
        serialPortNames = @($serialPorts | ForEach-Object { [string]$_.portName })
        sessionState = 'offline'
        emptyActionProgramRunJson = $true
        serialSessionProbeStatus = $invalidConnectStatus
        serialSessionProbeCorrelated = $sessionProbeCorrelated
        commandPolicy = [string]$capabilities.commandPolicy
        directCommand = [bool]$capabilities.directCommand
        engineeringOffline = [bool]$EngineeringOffline
        thirdPartyComponentsVerified = $dependencyComponentCount
        curatedLicenseSourcesVerified = $curatedLicenseSources.Count
        thirdPartyMissingLicenseTexts = $missingLicenseTexts.Count
        incompleteModelRedistributions = $incompleteModelRedistributions.Count
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
