$dotnetArguments = @($args)

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$projectLocalDotnet = Join-Path $repositoryRoot '.tools\dotnet\dotnet.exe'
if (Test-Path -LiteralPath $projectLocalDotnet) {
    $dotnetExecutable = $projectLocalDotnet
} else {
    $dotnetCommand = Get-Command dotnet -ErrorAction SilentlyContinue
    if ($null -eq $dotnetCommand) {
        Write-Error '.NET 10 SDK is required. Install SDK 10.0.302 or place a non-admin installation in .tools\dotnet.'
        exit 1
    }
    $dotnetExecutable = $dotnetCommand.Source
}

$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
$env:DOTNET_NOLOGO = '1'
& $dotnetExecutable @dotnetArguments
exit $LASTEXITCODE
