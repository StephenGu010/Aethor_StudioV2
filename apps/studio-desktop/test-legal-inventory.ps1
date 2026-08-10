Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if ($null -ne $nodeCommand) {
    $nodeExecutable = $nodeCommand.Source
}
else {
    $pnpmExecutable = (Get-Command pnpm -ErrorAction Stop).Source
    $nodeExecutable = [IO.Path]::GetFullPath(
        (Join-Path (Split-Path $pnpmExecutable) '..\..\node\bin\node.exe'))
    if (!(Test-Path -LiteralPath $nodeExecutable -PathType Leaf)) {
        throw 'Node.js is required to test the third-party inventory generator.'
    }
}

& $nodeExecutable --test (Join-Path $PSScriptRoot 'scripts\third-party-inventory.test.mjs')
exit $LASTEXITCODE
