$arguments = @($args)
if ($arguments.Count -lt 3) {
    Write-Error 'Usage: dotnet-isolated.ps1 <gateway|desktop> <build|test> <solution-or-project> [dotnet arguments]'
    exit 2
}

$scopeName = [string]$arguments[0]
$scopeCode = switch ($scopeName) {
    'gateway' { 'gw' }
    'desktop' { 'dt' }
    default {
        Write-Error "Unsupported isolated .NET scope: $scopeName"
        exit 2
    }
}
$verb = [string]$arguments[1]
if ($verb -notin @('build', 'test')) {
    Write-Error "Isolated .NET execution supports build/test only, not: $verb"
    exit 2
}

$dotnetArguments = @($arguments[1..($arguments.Count - 1)])
if ($dotnetArguments | Where-Object {
    $_ -match '^(--artifacts-path|-p:ArtifactsPath)(=|$)'
}) {
    Write-Error 'The isolated wrapper owns --artifacts-path; callers cannot override it.'
    exit 2
}

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$artifactParent = Join-Path $repositoryRoot 'artifacts\validation\dotnet'
$runName = ".run-$scopeCode-$PID-$([Guid]::NewGuid().ToString('N'))"
$runRoot = Join-Path $artifactParent $runName
$dotnetScript = Join-Path $PSScriptRoot 'dotnet.ps1'

function Assert-OwnedRunPath {
    param([string]$Candidate, [string]$Parent)

    $fullCandidate = [IO.Path]::GetFullPath($Candidate)
    $fullParent = [IO.Path]::GetFullPath($Parent).TrimEnd('\') + '\'
    if (!$fullCandidate.StartsWith($fullParent, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing isolated artifact mutation outside the repository validation root: $fullCandidate"
    }
    if ([IO.Path]::GetFileName($fullCandidate) -notmatch '^\.run-(gw|dt)-\d+-[0-9a-f]{32}$') {
        throw "Refusing isolated artifact mutation for an unexpected run name: $fullCandidate"
    }
    return $fullCandidate
}

function Remove-OwnedRunDirectory {
    param([string]$Candidate, [string]$Parent)

    $ownedPath = Assert-OwnedRunPath $Candidate $Parent
    if (!(Test-Path -LiteralPath $ownedPath)) { return }
    $extendedPath = if ($ownedPath.StartsWith('\\?\', [StringComparison]::Ordinal)) {
        $ownedPath
    } else {
        '\\?\' + $ownedPath
    }
    [IO.Directory]::Delete($extendedPath, $true)
    if (Test-Path -LiteralPath $ownedPath) {
        throw "Isolated artifact cleanup did not remove its exact run directory: $ownedPath"
    }
}

$runRoot = Assert-OwnedRunPath $runRoot $artifactParent
New-Item -ItemType Directory -Path $artifactParent -Force | Out-Null
$dotnetExitCode = 1
$cleanupFailure = $null
Push-Location $repositoryRoot
try {
    & powershell -NoProfile -ExecutionPolicy Bypass -File $dotnetScript `
        @dotnetArguments `
        --artifacts-path $runRoot
    $dotnetExitCode = $LASTEXITCODE
} finally {
    Pop-Location
    try {
        Remove-OwnedRunDirectory $runRoot $artifactParent
    } catch {
        $cleanupFailure = $_.Exception.Message
    }
}

if ($null -ne $cleanupFailure) {
    Write-Error $cleanupFailure
    exit 1
}

[ordered]@{
    scope = $scopeName
    verb = $verb
    exitCode = $dotnetExitCode
    artifactsCleaned = $true
    serialPortOpened = $false
    hardwareCommandSent = $false
} | ConvertTo-Json -Compress
exit $dotnetExitCode
