[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$PackageRoot,

    [string]$ShortcutPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$resolvedPackageRoot = (Resolve-Path -LiteralPath $PackageRoot).Path
$executable = Join-Path $resolvedPackageRoot 'AethorStudioV2.Desktop.exe'
if (!(Test-Path -LiteralPath $executable -PathType Leaf)) {
    throw "The packaged desktop executable is missing: $executable"
}

$desktop = [Environment]::GetFolderPath([Environment+SpecialFolder]::DesktopDirectory)
$resolvedShortcut = [IO.Path]::GetFullPath($(if ([string]::IsNullOrWhiteSpace($ShortcutPath)) {
    Join-Path $desktop 'Aethor Studio V2.lnk'
} else {
    $ShortcutPath
}))
$desktopPrefix = [IO.Path]::GetFullPath($desktop).TrimEnd('\') + '\'
if (!$resolvedShortcut.StartsWith($desktopPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "The shortcut must be created inside the current user's Desktop directory: $resolvedShortcut"
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($resolvedShortcut)
$shortcut.TargetPath = $executable
$shortcut.Arguments = '--engineering'
$shortcut.WorkingDirectory = $resolvedPackageRoot
$shortcut.IconLocation = "$executable,0"
$shortcut.Description = 'Aethor Studio V2 — Dummy engineering console'
$shortcut.Save()

$verified = $shell.CreateShortcut($resolvedShortcut)
if (!([string]::Equals($verified.TargetPath, $executable, [StringComparison]::OrdinalIgnoreCase)) -or
    $verified.Arguments -ne '--engineering' -or
    !([string]::Equals($verified.WorkingDirectory, $resolvedPackageRoot, [StringComparison]::OrdinalIgnoreCase))) {
    throw 'The saved desktop shortcut failed verification.'
}

[ordered]@{
    shortcut = $resolvedShortcut
    target = $verified.TargetPath
    arguments = $verified.Arguments
    workingDirectory = $verified.WorkingDirectory
    icon = $verified.IconLocation
} | ConvertTo-Json
