[CmdletBinding()]
param(
    [ValidateSet('win-x64', 'win-arm64')]
    [string]$Runtime = 'win-x64',

    [string]$OutputDirectory,

    [switch]$AllowDirty,

    [string]$SignToolPath,

    [string]$CertificateThumbprint,

    [string]$ExpectedPublisherSubject,

    [uri]$TimestampUrl,

    [ValidateSet('CurrentUser', 'LocalMachine')]
    [string]$CertificateStoreLocation = 'CurrentUser'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$packageJsonPath = Join-Path $repositoryRoot 'package.json'
$packageJson = Get-Content -Raw -Encoding UTF8 -LiteralPath $packageJsonPath | ConvertFrom-Json
$version = [string]$packageJson.version
if ($version -notmatch '^\d+\.\d+\.\d+([-.][0-9A-Za-z.-]+)?$') {
    throw "Root package version is invalid: $version"
}

$signingParameterCount = @(
    $SignToolPath,
    $CertificateThumbprint,
    $ExpectedPublisherSubject,
    $(if ($null -eq $TimestampUrl) { $null } else { $TimestampUrl.AbsoluteUri })
).Where({ ![string]::IsNullOrWhiteSpace($_) }).Count
if ($signingParameterCount -notin @(0, 4)) {
    throw 'Signing requires SignToolPath, CertificateThumbprint, ExpectedPublisherSubject, and TimestampUrl together.'
}
$signingEnabled = $signingParameterCount -eq 4
$resolvedSignTool = $null
$normalizedThumbprint = $null
if ($signingEnabled) {
    if (!$TimestampUrl.IsAbsoluteUri -or $TimestampUrl.Scheme -ne [Uri]::UriSchemeHttps) {
        throw 'TimestampUrl must be an absolute HTTPS URI.'
    }
    $resolvedSignTool = (Resolve-Path -LiteralPath $SignToolPath).Path
    if (!(Test-Path -LiteralPath $resolvedSignTool -PathType Leaf)) {
        throw 'SignToolPath must reference an existing file.'
    }
    $normalizedThumbprint = [regex]::Replace($CertificateThumbprint, '\s', '').ToUpperInvariant()
    if ($normalizedThumbprint -notmatch '^[0-9A-F]{40}$') {
        throw 'CertificateThumbprint must be a 40-character SHA-1 certificate thumbprint.'
    }
}

$defaultOutputParent = Join-Path $repositoryRoot 'artifacts\windows'
$outputParent = if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $defaultOutputParent
} else {
    [IO.Path]::GetFullPath($(if ([IO.Path]::IsPathRooted($OutputDirectory)) {
        $OutputDirectory
    } else {
        Join-Path $repositoryRoot $OutputDirectory
    }))
}
$packageName = "AethorStudioV2-$version-$Runtime"
$finalRoot = Join-Path $outputParent $packageName
$stagingRoot = Join-Path $outputParent ".staging-$packageName-$([Guid]::NewGuid().ToString('N'))"
$dotnetArtifactsRoot = Join-Path $stagingRoot '.dotnet-artifacts'
$buildLockPath = Join-Path $outputParent ".$packageName.build.lock"

function Assert-ChildPath {
    param([string]$Candidate, [string]$Parent)
    $fullCandidate = [IO.Path]::GetFullPath($Candidate)
    $fullParent = [IO.Path]::GetFullPath($Parent).TrimEnd('\') + '\'
    if (!$fullCandidate.StartsWith($fullParent, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing filesystem mutation outside the intended output root: $fullCandidate"
    }
}

Assert-ChildPath -Candidate $outputParent -Parent $repositoryRoot
Assert-ChildPath -Candidate $finalRoot -Parent $outputParent
Assert-ChildPath -Candidate $stagingRoot -Parent $outputParent
Assert-ChildPath -Candidate $dotnetArtifactsRoot -Parent $stagingRoot
Assert-ChildPath -Candidate $buildLockPath -Parent $outputParent

$gitStatus = @(& git -C $repositoryRoot status --porcelain=v1)
if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect Git status.' }
$isDirty = $gitStatus.Count -gt 0
if ($isDirty -and !$AllowDirty) {
    throw 'The worktree is dirty. Commit the verified phase or pass -AllowDirty for a development-only package.'
}
if ($isDirty -and $signingEnabled) {
    throw 'Refusing to sign a package built from a dirty worktree.'
}
$commit = (& git -C $repositoryRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Unable to resolve the Git commit.' }

$projectLocalDotnet = Join-Path $repositoryRoot '.tools\dotnet\dotnet.exe'
$dotnetExecutable = if (Test-Path -LiteralPath $projectLocalDotnet -PathType Leaf) {
    $projectLocalDotnet
} else {
    (Get-Command dotnet -ErrorAction Stop).Source
}
$pnpmExecutable = (Get-Command pnpm -ErrorAction Stop).Source
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if ($null -ne $nodeCommand) {
    $nodeExecutable = $nodeCommand.Source
}
else {
    # Codex Desktop's bundled pnpm wrapper can launch itself without exposing
    # node.exe to child package scripts. Resolve that layout without baking an
    # account-specific path into the project.
    $bundledNode = [IO.Path]::GetFullPath((Join-Path (Split-Path $pnpmExecutable) '..\..\node\bin\node.exe'))
    if (!(Test-Path -LiteralPath $bundledNode -PathType Leaf)) {
        throw 'Node.js is required to build the packaged frontend.'
    }
    $nodeExecutable = $bundledNode
    $env:PATH = (Split-Path $bundledNode) + ';' + $env:PATH
}
$frontendOutput = Join-Path $repositoryRoot 'apps\studio-web\dist'
$gatewayProject = Join-Path $repositoryRoot 'services\robot-gateway\src\AethorStudioV2.Api\AethorStudioV2.Api.csproj'
$desktopProject = Join-Path $repositoryRoot 'apps\studio-desktop\src\AethorStudioV2.Desktop\AethorStudioV2.Desktop.csproj'
$iconBuilder = Join-Path $repositoryRoot 'apps\studio-desktop\scripts\build-app-icon.ps1'

& $iconBuilder | Out-Null

New-Item -ItemType Directory -Force -Path $outputParent | Out-Null
$buildLock = $null
try {
    $buildLock = [IO.File]::Open(
        $buildLockPath,
        [IO.FileMode]::OpenOrCreate,
        [IO.FileAccess]::ReadWrite,
        [IO.FileShare]::None)
}
catch [IO.IOException] {
    throw "Another build already owns the package output: $packageName"
}

try {
    New-Item -ItemType Directory -Force -Path $stagingRoot | Out-Null

    & $pnpmExecutable --dir $repositoryRoot build:web
    if ($LASTEXITCODE -ne 0) { throw 'Frontend production build failed.' }

    $gatewayOutput = Join-Path $stagingRoot 'gateway'
    & $dotnetExecutable publish $gatewayProject --configuration Release --runtime $Runtime `
        --self-contained true --output $gatewayOutput `
        --artifacts-path $dotnetArtifactsRoot `
        -p:Version=$version -p:DebugType=None -p:DebugSymbols=false
    if ($LASTEXITCODE -ne 0) { throw 'Gateway publish failed.' }

    & $dotnetExecutable publish $desktopProject --configuration Release --runtime $Runtime `
        --self-contained true --output $stagingRoot `
        --artifacts-path $dotnetArtifactsRoot `
        -p:Version=$version -p:DebugType=None -p:DebugSymbols=false
    if ($LASTEXITCODE -ne 0) { throw 'Desktop publish failed.' }

    if (Test-Path -LiteralPath $dotnetArtifactsRoot) {
        Remove-Item -LiteralPath $dotnetArtifactsRoot -Recurse -Force
    }

    $webOutput = Join-Path $stagingRoot 'web'
    New-Item -ItemType Directory -Force -Path $webOutput | Out-Null
    Copy-Item -Path (Join-Path $frontendOutput '*') -Destination $webOutput -Recurse -Force

    $legalOutput = Join-Path $stagingRoot 'Legal'
    New-Item -ItemType Directory -Force -Path $legalOutput | Out-Null
    $modelLegalAssets = [ordered]@{
        'dummy-6dof-NOTICE.md' = 'shared\robot-profiles\BuiltIn\dummy-6dof\NOTICE.md'
        'aethor-robo-dual-7dof-NOTICE.md' = 'shared\robot-profiles\BuiltIn\aethor-robo-dual-7dof\NOTICE.md'
        'aethor-robo-dual-7dof-provenance.json' = 'shared\robot-profiles\BuiltIn\aethor-robo-dual-7dof\provenance.json'
    }
    foreach ($entry in $modelLegalAssets.GetEnumerator()) {
        $source = Join-Path $repositoryRoot $entry.Value
        if (!(Test-Path -LiteralPath $source -PathType Leaf)) {
            throw "Required model legal asset is missing: $($entry.Value)"
        }
        Copy-Item -LiteralPath $source -Destination (Join-Path $legalOutput $entry.Key)
    }

    $pnpmLicenseInput = Join-Path $stagingRoot '.pnpm-production-licenses.json'
    $pnpmLicenseLines = @(& $pnpmExecutable --dir $repositoryRoot licenses list --json --prod)
    if ($LASTEXITCODE -ne 0) { throw 'Unable to enumerate the installed pnpm production dependency graph.' }
    [IO.File]::WriteAllText(
        $pnpmLicenseInput,
        ($pnpmLicenseLines -join [Environment]::NewLine),
        (New-Object Text.UTF8Encoding($false)))
    $nugetRoot = if (![string]::IsNullOrWhiteSpace($env:NUGET_PACKAGES)) {
        [IO.Path]::GetFullPath($env:NUGET_PACKAGES)
    }
    else {
        Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile)) '.nuget\packages'
    }
    if (!(Test-Path -LiteralPath $nugetRoot -PathType Container)) {
        throw "The restored NuGet package root is unavailable: $nugetRoot"
    }
    $generatedAtUtc = [DateTime]::UtcNow.ToString(
        "yyyy-MM-dd'T'HH:mm:ss.fff'Z'",
        [Globalization.CultureInfo]::InvariantCulture)
    & $nodeExecutable (Join-Path $PSScriptRoot 'scripts\third-party-inventory.mjs') `
        --pnpm-license-path $pnpmLicenseInput `
        --desktop-deps-path (Join-Path $stagingRoot 'AethorStudioV2.Desktop.deps.json') `
        --gateway-deps-path (Join-Path $gatewayOutput 'AethorStudioV2.Api.deps.json') `
        --nuget-root $nugetRoot `
        --output-directory $legalOutput `
        --product-version $version `
        --source-commit $commit `
        --created-at $generatedAtUtc
    if ($LASTEXITCODE -ne 0) { throw 'Third-party inventory generation failed.' }
    Remove-Item -LiteralPath $pnpmLicenseInput -Force

    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'RELEASE-NOTES.md') `
        -Destination (Join-Path $stagingRoot 'RELEASE-NOTES.md')

    $ownedSignedFiles = @(
        'AethorStudioV2.Desktop.exe',
        'AethorStudioV2.Desktop.dll',
        'gateway/AethorStudioV2.Api.exe',
        'gateway/AethorStudioV2.Api.dll',
        'gateway/AethorStudioV2.Application.dll',
        'gateway/AethorStudioV2.Domain.dll',
        'gateway/AethorStudioV2.Infrastructure.dll'
    )
    if ($signingEnabled) {
        foreach ($relativePath in $ownedSignedFiles) {
            $candidate = Join-Path $stagingRoot $relativePath.Replace('/', '\')
            if (!(Test-Path -LiteralPath $candidate -PathType Leaf)) {
                throw "Owned signing target is missing: $relativePath"
            }
            $signToolArguments = @(
                'sign',
                '/sha1', $normalizedThumbprint,
                '/fd', 'SHA256',
                '/tr', $TimestampUrl.AbsoluteUri,
                '/td', 'SHA256'
            )
            if ($CertificateStoreLocation -eq 'LocalMachine') { $signToolArguments += '/sm' }
            $signToolArguments += $candidate
            & $resolvedSignTool @signToolArguments
            if ($LASTEXITCODE -ne 0) { throw "SignTool failed for $relativePath." }

            $signature = Get-AuthenticodeSignature -LiteralPath $candidate
            $hasValidSignature = $signature.Status -eq [Management.Automation.SignatureStatus]::Valid
            $hasExpectedPublisher = $null -ne $signature.SignerCertificate -and [string]::Equals(
                $signature.SignerCertificate.Subject,
                $ExpectedPublisherSubject,
                [StringComparison]::Ordinal)
            $hasTimestamp = $null -ne $signature.TimeStamperCertificate
            if (!$hasValidSignature -or !$hasExpectedPublisher -or !$hasTimestamp) {
                throw "Signed file failed publisher/timestamp verification: $relativePath"
            }
        }
    }

    $files = Get-ChildItem -LiteralPath $stagingRoot -Recurse -File |
        Sort-Object FullName |
        ForEach-Object {
            [ordered]@{
                path = $_.FullName.Substring($stagingRoot.Length + 1).Replace('\', '/')
                length = $_.Length
                sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash.ToLowerInvariant()
            }
        }
    $manifest = [ordered]@{
        schemaVersion = 'aethor.windows-portable.v1'
        product = 'Aethor Studio V2'
        version = $version
        runtime = $Runtime
        commit = $commit
        worktreeDirty = $isDirty
        releaseQualification = if ($isDirty) {
            'development-dirty'
        } elseif (!$signingEnabled) {
            'development-unsigned'
        } else {
            'release-candidate'
        }
        signing = [ordered]@{
            applied = $signingEnabled
            publisherSubject = if ($signingEnabled) { $ExpectedPublisherSubject } else { $null }
            timestampUrl = if ($signingEnabled) { $TimestampUrl.AbsoluteUri } else { $null }
            certificateStore = if ($signingEnabled) { $CertificateStoreLocation } else { $null }
            ownedFiles = $ownedSignedFiles
        }
        generatedAtUtc = $generatedAtUtc
        files = @($files)
    }
    $manifest | ConvertTo-Json -Depth 6 |
        Set-Content -Encoding UTF8 -LiteralPath (Join-Path $stagingRoot 'release-manifest.json')

    if (Test-Path -LiteralPath $finalRoot) {
        Remove-Item -LiteralPath $finalRoot -Recurse -Force
    }
    [IO.Directory]::Move($stagingRoot, $finalRoot)
    [ordered]@{
        succeeded = $true
        packageRoot = $finalRoot
        qualification = $manifest.releaseQualification
        fileCount = $files.Count + 1
        signingApplied = $signingEnabled
        networkRequestSent = $signingEnabled
        serialPortOpened = $false
        hardwareCommandSent = $false
    } | ConvertTo-Json
}
finally {
    if (Test-Path -LiteralPath $stagingRoot) {
        Remove-Item -LiteralPath $stagingRoot -Recurse -Force
    }
    if ($null -ne $buildLock) {
        $buildLock.Dispose()
    }
}
