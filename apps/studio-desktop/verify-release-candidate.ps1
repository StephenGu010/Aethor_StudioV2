[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$PackageRoot,

    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$ExpectedPublisherSubject
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$resolvedPackageRoot = (Resolve-Path -LiteralPath $PackageRoot).Path
$manifestPath = Join-Path $resolvedPackageRoot 'release-manifest.json'
$issues = [System.Collections.Generic.List[object]]::new()

function Add-ReleaseIssue {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Code,

        [Parameter(Mandatory = $true)]
        [string]$Detail
    )

    $issues.Add([ordered]@{ code = $Code; detail = $Detail })
}

function Test-PackageChildPath {
    param([string]$RelativePath)

    if ([string]::IsNullOrWhiteSpace($RelativePath) -or [IO.Path]::IsPathRooted($RelativePath)) {
        return $null
    }
    try {
        $candidate = [IO.Path]::GetFullPath((Join-Path $resolvedPackageRoot $RelativePath.Replace('/', '\')))
        $prefix = $resolvedPackageRoot.TrimEnd('\') + '\'
        if (!$candidate.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { return $null }
        return $candidate
    }
    catch {
        return $null
    }
}

if (!(Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    Add-ReleaseIssue -Code 'manifest-missing' -Detail 'release-manifest.json is missing.'
    $manifest = $null
}
else {
    try {
        $manifest = Get-Content -Raw -Encoding UTF8 -LiteralPath $manifestPath | ConvertFrom-Json
    }
    catch {
        Add-ReleaseIssue -Code 'manifest-invalid-json' -Detail 'release-manifest.json is not valid JSON.'
        $manifest = $null
    }
}

$packageJson = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $repositoryRoot 'package.json') |
    ConvertFrom-Json
$expectedVersion = [string]$packageJson.version
if ($expectedVersion -notmatch '^\d+\.\d+\.\d+$') {
    Add-ReleaseIssue -Code 'version-not-stable' -Detail 'Root package version must be stable major.minor.patch.'
}

$gitCommit = (& git -C $repositoryRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) {
    Add-ReleaseIssue -Code 'git-head-unavailable' -Detail 'Unable to resolve the repository HEAD.'
}
$gitStatus = @(& git -C $repositoryRoot status --porcelain=v1)
if ($LASTEXITCODE -ne 0) {
    Add-ReleaseIssue -Code 'git-status-unavailable' -Detail 'Unable to inspect the repository worktree.'
}
elseif ($gitStatus.Count -gt 0) {
    Add-ReleaseIssue -Code 'worktree-dirty' -Detail 'A release candidate must be verified from a clean worktree.'
}

$manifestPaths = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
$verifiedFileCount = 0
if ($null -ne $manifest) {
    if ([string]$manifest.schemaVersion -ne 'aethor.windows-portable.v1') {
        Add-ReleaseIssue -Code 'manifest-schema' -Detail 'Unsupported release manifest schema.'
    }
    if ([string]$manifest.product -ne 'Aethor Studio V2') {
        Add-ReleaseIssue -Code 'manifest-product' -Detail 'Release manifest product identity does not match.'
    }
    if ([string]$manifest.version -ne $expectedVersion) {
        Add-ReleaseIssue -Code 'manifest-version' -Detail 'Release manifest version does not match package.json.'
    }
    if ([string]$manifest.commit -ne $gitCommit) {
        Add-ReleaseIssue -Code 'manifest-commit' -Detail 'Release manifest commit does not match repository HEAD.'
    }
    if ([bool]$manifest.worktreeDirty) {
        Add-ReleaseIssue -Code 'manifest-dirty' -Detail 'Release manifest records a dirty worktree.'
    }
    if ([string]$manifest.releaseQualification -ne 'release-candidate') {
        Add-ReleaseIssue -Code 'manifest-qualification' -Detail 'Package is not marked release-candidate.'
    }
    if (!($manifest.PSObject.Properties.Name -contains 'signing') -or ![bool]$manifest.signing.applied) {
        Add-ReleaseIssue -Code 'manifest-signing' -Detail 'Release manifest does not record an applied signing stage.'
    }
    elseif (![string]::Equals(
            [string]$manifest.signing.publisherSubject,
            $ExpectedPublisherSubject,
            [StringComparison]::Ordinal)) {
        Add-ReleaseIssue -Code 'manifest-signing-publisher' -Detail 'Release manifest publisher does not match the approved publisher.'
    }

    foreach ($file in @($manifest.files)) {
        $relativePath = [string]$file.path
        $candidate = Test-PackageChildPath -RelativePath $relativePath
        if ($null -eq $candidate) {
            Add-ReleaseIssue -Code 'manifest-path-unsafe' -Detail "Manifest path is unsafe: $relativePath"
            continue
        }
        if (!$manifestPaths.Add($relativePath.Replace('\', '/'))) {
            Add-ReleaseIssue -Code 'manifest-path-duplicate' -Detail "Manifest path is duplicated: $relativePath"
            continue
        }
        if (!(Test-Path -LiteralPath $candidate -PathType Leaf)) {
            Add-ReleaseIssue -Code 'manifest-file-missing' -Detail "Manifest file is missing: $relativePath"
            continue
        }
        $actualLength = (Get-Item -LiteralPath $candidate).Length
        if ($actualLength -ne [long]$file.length) {
            Add-ReleaseIssue -Code 'manifest-length' -Detail "Manifest length mismatch: $relativePath"
            continue
        }
        $actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $candidate).Hash.ToLowerInvariant()
        if ($actualHash -ne ([string]$file.sha256).ToLowerInvariant()) {
            Add-ReleaseIssue -Code 'manifest-hash' -Detail "Manifest hash mismatch: $relativePath"
            continue
        }
        $verifiedFileCount += 1
    }

    $actualFiles = Get-ChildItem -LiteralPath $resolvedPackageRoot -Recurse -File |
        Where-Object { $_.FullName -ne $manifestPath } |
        ForEach-Object { $_.FullName.Substring($resolvedPackageRoot.Length + 1).Replace('\', '/') }
    foreach ($actualFile in $actualFiles) {
        if (!$manifestPaths.Contains($actualFile)) {
            Add-ReleaseIssue -Code 'package-file-unexpected' -Detail "Package contains an unmanifested file: $actualFile"
        }
    }
    if (@($actualFiles).Count -ne $manifestPaths.Count) {
        Add-ReleaseIssue -Code 'package-file-count' -Detail 'Package file count does not match the manifest.'
    }

    $requiredLegalFiles = @(
        'RELEASE-NOTES.md',
        'Legal/dummy-6dof-NOTICE.md',
        'Legal/aethor-robo-dual-7dof-NOTICE.md',
        'Legal/aethor-robo-dual-7dof-provenance.json',
        'Legal/MODEL-REDISTRIBUTION-STATUS.json',
        'Legal/THIRD-PARTY-INVENTORY.spdx.json',
        'Legal/THIRD-PARTY-SUMMARY.json',
        'Legal/THIRD-PARTY-NOTICES.md',
        'Legal/ThirdParty/NPM-LICENSE-TEXTS.md'
    )
    foreach ($relativePath in $requiredLegalFiles) {
        $candidate = Test-PackageChildPath -RelativePath $relativePath
        if (($null -eq $candidate) -or
            (!(Test-Path -LiteralPath $candidate -PathType Leaf)) -or
            (!$manifestPaths.Contains($relativePath))) {
            Add-ReleaseIssue -Code 'legal-asset-missing' -Detail "Required legal or provenance file is missing from the package manifest: $relativePath"
        }
    }

    $spdxPath = Test-PackageChildPath -RelativePath 'Legal/THIRD-PARTY-INVENTORY.spdx.json'
    $thirdPartySummaryPath = Test-PackageChildPath -RelativePath 'Legal/THIRD-PARTY-SUMMARY.json'
    $spdx = $null
    $thirdPartySummary = $null
    if ($null -ne $spdxPath -and $null -ne $thirdPartySummaryPath -and
        (Test-Path -LiteralPath $spdxPath -PathType Leaf) -and
        (Test-Path -LiteralPath $thirdPartySummaryPath -PathType Leaf)) {
        try {
            $spdx = Get-Content -Raw -Encoding UTF8 -LiteralPath $spdxPath | ConvertFrom-Json
            $thirdPartySummary = Get-Content -Raw -Encoding UTF8 -LiteralPath $thirdPartySummaryPath | ConvertFrom-Json
        }
        catch {
            Add-ReleaseIssue -Code 'third-party-inventory-invalid' -Detail 'The SPDX inventory or third-party summary is not valid JSON.'
        }
    }
    if ($null -ne $spdx -and $null -ne $thirdPartySummary) {
        if ([string]$spdx.spdxVersion -ne 'SPDX-2.3' -or
            [string]$spdx.dataLicense -ne 'CC0-1.0' -or
            [string]$spdx.SPDXID -ne 'SPDXRef-DOCUMENT' -or
            [string]$thirdPartySummary.schemaVersion -ne 'aethor.third-party-inventory-summary.v2') {
            Add-ReleaseIssue -Code 'third-party-inventory-schema' -Detail 'The package does not contain the supported SPDX 2.3 inventory and summary schemas.'
        }
        if ([string]$thirdPartySummary.productVersion -ne [string]$manifest.version -or
            [string]$thirdPartySummary.sourceCommit -ne [string]$manifest.commit -or
            [string]$thirdPartySummary.generatedAtUtc -ne [string]$manifest.generatedAtUtc) {
            Add-ReleaseIssue -Code 'third-party-inventory-binding' -Detail 'The third-party inventory summary is not bound to this package version, commit, and build timestamp.'
        }

        $spdxIds = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
        $purls = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
        $rootPackageCount = 0
        $npmComponentCount = 0
        $dotnetComponentCount = 0
        foreach ($package in @($spdx.packages)) {
            $spdxId = [string]$package.SPDXID
            if ([string]::IsNullOrWhiteSpace($spdxId) -or !$spdxIds.Add($spdxId)) {
                Add-ReleaseIssue -Code 'third-party-inventory-duplicate' -Detail "SPDX package ID is empty or duplicated: $spdxId"
                continue
            }
            if ($spdxId -eq 'SPDXRef-AethorStudioV2') {
                $rootPackageCount += 1
                continue
            }
            $packagePurls = @($package.externalRefs | Where-Object {
                [string]$_.referenceCategory -eq 'PACKAGE-MANAGER' -and [string]$_.referenceType -eq 'purl'
            })
            if ([bool]$package.filesAnalyzed -or
                [string]::IsNullOrWhiteSpace([string]$package.licenseDeclared) -or
                $packagePurls.Count -ne 1) {
                Add-ReleaseIssue -Code 'third-party-package-metadata' -Detail "SPDX dependency metadata is incomplete: $spdxId"
                continue
            }
            $purl = [string]$packagePurls[0].referenceLocator
            if (!$purls.Add($purl)) {
                Add-ReleaseIssue -Code 'third-party-inventory-duplicate' -Detail "SPDX package purl is duplicated: $purl"
            }
            elseif ($purl.StartsWith('pkg:npm/', [StringComparison]::Ordinal)) {
                $npmComponentCount += 1
            }
            elseif ($purl.StartsWith('pkg:nuget/', [StringComparison]::Ordinal)) {
                $dotnetComponentCount += 1
            }
            else {
                Add-ReleaseIssue -Code 'third-party-package-ecosystem' -Detail "Unsupported SPDX package ecosystem: $purl"
            }
        }
        $dependencyComponentCount = $spdxIds.Count - $rootPackageCount
        if ($rootPackageCount -ne 1 -or
            $dependencyComponentCount -ne [int]$thirdPartySummary.componentCount -or
            $npmComponentCount -ne [int]$thirdPartySummary.npmComponentCount -or
            $dotnetComponentCount -ne [int]$thirdPartySummary.dotnetComponentCount -or
            @($spdx.relationships).Count -ne $dependencyComponentCount) {
            Add-ReleaseIssue -Code 'third-party-inventory-count' -Detail 'SPDX package, ecosystem, relationship, and summary counts do not agree.'
        }

        $missingLicenseTexts = @($thirdPartySummary.missingLicenseTexts)
        $calculatedDependencyReady = $missingLicenseTexts.Count -eq 0
        $incompleteModelRedistributions = @($thirdPartySummary.incompleteModelRedistributions)
        $calculatedModelReady = $incompleteModelRedistributions.Count -eq 0
        $calculatedReleaseReady = $calculatedDependencyReady -and $calculatedModelReady
        if ($missingLicenseTexts.Count -ne [int]$thirdPartySummary.missingLicenseTextCount -or
            $incompleteModelRedistributions.Count -ne [int]$thirdPartySummary.incompleteModelRedistributionCount -or
            [bool]$thirdPartySummary.dependencyLicenseTextReady -ne $calculatedDependencyReady -or
            [bool]$thirdPartySummary.modelRedistributionReady -ne $calculatedModelReady -or
            [bool]$thirdPartySummary.releaseReady -ne $calculatedReleaseReady) {
            Add-ReleaseIssue -Code 'third-party-summary-inconsistent' -Detail 'The dependency/model legal gap counts and release-ready flags do not agree.'
        }
        else {
          if (!$calculatedDependencyReady) {
            $missingNames = @($missingLicenseTexts | ForEach-Object { "$($_.name)@$($_.version)" }) -join ', '
            Add-ReleaseIssue -Code 'third-party-license-incomplete' -Detail "Dependency license text is unresolved for $($missingLicenseTexts.Count) component(s): $missingNames"
          }
          if (!$calculatedModelReady) {
            $missingModels = @($incompleteModelRedistributions | ForEach-Object { [string]$_.profileId }) -join ', '
            Add-ReleaseIssue -Code 'model-redistribution-incomplete' -Detail "Redistribution terms are unresolved for $($incompleteModelRedistributions.Count) model profile(s): $missingModels"
          }
        }

        $legalArtifactPaths = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
        foreach ($relativePathValue in @($thirdPartySummary.legalArtifacts)) {
            $relativePath = ([string]$relativePathValue).Replace('\', '/')
            $candidate = Test-PackageChildPath -RelativePath $relativePath
            if (!$relativePath.StartsWith('Legal/ThirdParty/', [StringComparison]::Ordinal) -or
                !$legalArtifactPaths.Add($relativePath) -or
                $null -eq $candidate -or
                !(Test-Path -LiteralPath $candidate -PathType Leaf) -or
                !$manifestPaths.Contains($relativePath)) {
                Add-ReleaseIssue -Code 'legal-asset-missing' -Detail "Third-party legal artifact is unsafe, duplicated, or missing from the manifest: $relativePath"
            }
        }
        if (!$legalArtifactPaths.Contains('Legal/ThirdParty/NPM-LICENSE-TEXTS.md')) {
            Add-ReleaseIssue -Code 'legal-asset-missing' -Detail 'The npm production license-text bundle is absent from the third-party summary.'
        }

        $curatedKeys = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
        $curatedLicenseSources = @($thirdPartySummary.curatedLicenseSources)
        if ($curatedLicenseSources.Count -ne [int]$thirdPartySummary.curatedLicenseSourceCount) {
            Add-ReleaseIssue -Code 'curated-license-inconsistent' -Detail 'The curated license source count is inconsistent.'
        }
        foreach ($source in $curatedLicenseSources) {
            $key = "$([string]$source.ecosystem):$([string]$source.name)@$([string]$source.version)"
            $artifact = ([string]$source.artifact).Replace('\', '/')
            $candidate = Test-PackageChildPath -RelativePath $artifact
            if (!$curatedKeys.Add($key) -or
                !$legalArtifactPaths.Contains($artifact) -or
                $null -eq $candidate -or
                !(Test-Path -LiteralPath $candidate -PathType Leaf)) {
                Add-ReleaseIssue -Code 'curated-license-inconsistent' -Detail "Curated license identity or artifact is invalid: $key"
                continue
            }
            $actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $candidate).Hash.ToLowerInvariant()
            if ($actualHash -ne ([string]$source.textSha256).ToLowerInvariant() -or
                [string]$source.upstream.revision -notmatch '^[a-f0-9]{40}$' -or
                [string]$source.upstream.blobSha -notmatch '^[a-f0-9]{40}$' -or
                [string]$source.upstream.contentSha256 -notmatch '^[a-f0-9]{64}$' -or
                [string]::IsNullOrWhiteSpace([string]$source.packageEvidence.integrity)) {
                Add-ReleaseIssue -Code 'curated-license-inconsistent' -Detail "Curated license provenance is incomplete or changed: $key"
            }
        }

        $modelArtifactPaths = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
        foreach ($relativePathValue in @($thirdPartySummary.modelLegalArtifacts)) {
            $relativePath = ([string]$relativePathValue).Replace('\', '/')
            $candidate = Test-PackageChildPath -RelativePath $relativePath
            if (!$relativePath.StartsWith('Legal/', [StringComparison]::Ordinal) -or
                !$modelArtifactPaths.Add($relativePath) -or
                $null -eq $candidate -or
                !(Test-Path -LiteralPath $candidate -PathType Leaf) -or
                !$manifestPaths.Contains($relativePath)) {
                Add-ReleaseIssue -Code 'model-legal-asset-missing' -Detail "Model legal artifact is unsafe, duplicated, or absent: $relativePath"
            }
        }
        foreach ($requiredModelArtifact in @(
            'Legal/MODEL-REDISTRIBUTION-STATUS.json',
            'Legal/dummy-6dof-NOTICE.md',
            'Legal/aethor-robo-dual-7dof-NOTICE.md',
            'Legal/aethor-robo-dual-7dof-provenance.json')) {
            if (!$modelArtifactPaths.Contains($requiredModelArtifact)) {
                Add-ReleaseIssue -Code 'model-legal-asset-missing' -Detail "Required model legal artifact is absent from the summary: $requiredModelArtifact"
            }
        }
        $modelProfileIds = @($thirdPartySummary.modelRedistributionStatuses | ForEach-Object { [string]$_.profileId } | Sort-Object)
        if (($modelProfileIds -join ',') -ne 'aethor-robo-dual-7dof,dummy-6dof') {
            Add-ReleaseIssue -Code 'model-redistribution-inconsistent' -Detail 'The model redistribution gate does not cover exactly the two built-in profiles.'
        }
        $modelStatusPath = Test-PackageChildPath -RelativePath 'Legal/MODEL-REDISTRIBUTION-STATUS.json'
        if ($null -ne $modelStatusPath -and (Test-Path -LiteralPath $modelStatusPath -PathType Leaf)) {
            try {
                $modelStatus = Get-Content -Raw -Encoding UTF8 -LiteralPath $modelStatusPath | ConvertFrom-Json
                if ([string]$modelStatus.schemaVersion -ne 'aethor.model-redistribution-status.v1') {
                    Add-ReleaseIssue -Code 'model-redistribution-inconsistent' -Detail 'The packaged model redistribution status schema is unsupported.'
                }
                foreach ($profile in @($modelStatus.profiles)) {
                    $summaryProfiles = @($thirdPartySummary.modelRedistributionStatuses | Where-Object {
                        [string]$_.profileId -eq [string]$profile.profileId
                    })
                    if ($summaryProfiles.Count -ne 1 -or
                        [string]$summaryProfiles[0].declaredLicense -ne [string]$profile.declaredLicense -or
                        [bool]$summaryProfiles[0].redistributionTermsComplete -ne [bool]$profile.redistributionTermsComplete -or
                        [string]$summaryProfiles[0].unresolvedReason -ne [string]$profile.unresolvedReason) {
                        Add-ReleaseIssue -Code 'model-redistribution-inconsistent' -Detail "Packaged model status and legal summary disagree: $([string]$profile.profileId)"
                        continue
                    }
                    foreach ($evidence in @($summaryProfiles[0].evidence)) {
                        $artifact = ([string]$evidence.packagedPath).Replace('\', '/')
                        $candidate = Test-PackageChildPath -RelativePath $artifact
                        if (!$modelArtifactPaths.Contains($artifact) -or $null -eq $candidate -or !(Test-Path -LiteralPath $candidate -PathType Leaf)) {
                            Add-ReleaseIssue -Code 'model-legal-asset-missing' -Detail "Model evidence is missing: $artifact"
                            continue
                        }
                        $actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $candidate).Hash.ToLowerInvariant()
                        if ($actualHash -ne ([string]$evidence.sourceSha256).ToLowerInvariant()) {
                            Add-ReleaseIssue -Code 'model-redistribution-inconsistent' -Detail "Model evidence hash does not match its source record: $artifact"
                        }
                    }
                }
            }
            catch {
                Add-ReleaseIssue -Code 'model-redistribution-inconsistent' -Detail 'The packaged model redistribution status is not valid JSON.'
            }
        }
    }
}

$ownedSignedFiles = @(
    'AethorStudioV2.Desktop.exe',
    'AethorStudioV2.Desktop.dll',
    'gateway/AethorStudioV2.Api.exe',
    'gateway/AethorStudioV2.Api.dll',
    'gateway/AethorStudioV2.Application.dll',
    'gateway/AethorStudioV2.Domain.dll',
    'gateway/AethorStudioV2.Infrastructure.dll'
)
$validSignatureCount = 0
foreach ($relativePath in $ownedSignedFiles) {
    $candidate = Test-PackageChildPath -RelativePath $relativePath
    if ($null -eq $candidate -or !(Test-Path -LiteralPath $candidate -PathType Leaf)) {
        Add-ReleaseIssue -Code 'signed-file-missing' -Detail "Owned release file is missing: $relativePath"
        continue
    }
    $signature = Get-AuthenticodeSignature -LiteralPath $candidate
    if ($signature.Status -ne [Management.Automation.SignatureStatus]::Valid -or $null -eq $signature.SignerCertificate) {
        Add-ReleaseIssue -Code 'signature-invalid' -Detail "Owned release file is not validly signed: $relativePath ($($signature.Status))"
        continue
    }
    if (![string]::Equals(
            $signature.SignerCertificate.Subject,
            $ExpectedPublisherSubject,
            [StringComparison]::Ordinal)) {
        Add-ReleaseIssue -Code 'signature-publisher' -Detail "Signer subject does not match the approved publisher: $relativePath"
        continue
    }
    if ($null -eq $signature.TimeStamperCertificate) {
        Add-ReleaseIssue -Code 'signature-timestamp' -Detail "Owned release file has no trusted timestamp: $relativePath"
        continue
    }
    $validSignatureCount += 1
}

$passed = $issues.Count -eq 0
[ordered]@{
    schemaVersion = 'aethor.windows-release-verification.v1'
    timestampUtc = [DateTimeOffset]::UtcNow.ToString('O', [Globalization.CultureInfo]::InvariantCulture)
    passed = $passed
    packageRoot = $resolvedPackageRoot
    expectedVersion = $expectedVersion
    expectedCommit = $gitCommit
    expectedPublisherSubject = $ExpectedPublisherSubject
    manifestFilesVerified = $verifiedFileCount
    ownedSignaturesVerified = $validSignatureCount
    issueCount = $issues.Count
    issues = $issues
    filesystemMutationPerformed = $false
    networkRequestSent = $false
    serialPortOpened = $false
    hardwareCommandSent = $false
} | ConvertTo-Json -Depth 6

if (!$passed) { exit 2 }
