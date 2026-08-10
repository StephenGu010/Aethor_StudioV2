[CmdletBinding()]
param(
    [string]$SourcePath,
    [string]$OutputDirectory
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

$SourcePath = if ([string]::IsNullOrWhiteSpace($SourcePath)) {
    Join-Path $PSScriptRoot '..\..\studio-web\public\brand\aethor-mark.png'
} else { $SourcePath }
$OutputDirectory = if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    Join-Path $PSScriptRoot '..\assets'
} else { $OutputDirectory }

$resolvedSource = (Resolve-Path -LiteralPath $SourcePath).Path
$resolvedOutput = [IO.Path]::GetFullPath($OutputDirectory)
$desktopRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (!$resolvedOutput.StartsWith($desktopRoot.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw "Icon output must remain inside the desktop project: $resolvedOutput"
}
New-Item -ItemType Directory -Force -Path $resolvedOutput | Out-Null

function New-RoundedLogoPng {
    param(
        [Drawing.Image]$Source,
        [int]$Size
    )

    $bitmap = New-Object Drawing.Bitmap($Size, $Size, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $bitmap.SetResolution(96, 96)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    $path = New-Object Drawing.Drawing2D.GraphicsPath
    try {
        $graphics.Clear([Drawing.Color]::Transparent)
        $graphics.CompositingMode = [Drawing.Drawing2D.CompositingMode]::SourceOver
        $graphics.CompositingQuality = [Drawing.Drawing2D.CompositingQuality]::HighQuality
        $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias

        $radius = [single]($Size * 0.22)
        $diameter = [single]($radius * 2)
        $edge = [single]($Size - 1)
        $path.AddArc(0, 0, $diameter, $diameter, 180, 90)
        $path.AddArc($edge - $diameter, 0, $diameter, $diameter, 270, 90)
        $path.AddArc($edge - $diameter, $edge - $diameter, $diameter, $diameter, 0, 90)
        $path.AddArc(0, $edge - $diameter, $diameter, $diameter, 90, 90)
        $path.CloseFigure()
        $graphics.SetClip($path)
        $graphics.DrawImage($Source, 0, 0, $Size, $Size)

        $stream = New-Object IO.MemoryStream
        $bitmap.Save($stream, [Drawing.Imaging.ImageFormat]::Png)
        Write-Output -NoEnumerate ([byte[]]$stream.ToArray())
    }
    finally {
        $path.Dispose()
        $graphics.Dispose()
        $bitmap.Dispose()
    }
}

$source = [Drawing.Image]::FromFile($resolvedSource)
try {
    $preview = New-RoundedLogoPng -Source $source -Size 512
    [IO.File]::WriteAllBytes((Join-Path $resolvedOutput 'aethor-studio-v2-rounded.png'), $preview)

    $sizes = @(16, 24, 32, 48, 64, 128, 256)
    $images = @($sizes | ForEach-Object { New-RoundedLogoPng -Source $source -Size $_ })
    $icoPath = Join-Path $resolvedOutput 'aethor-studio-v2.ico'
    $stream = [IO.File]::Open($icoPath, [IO.FileMode]::Create, [IO.FileAccess]::Write, [IO.FileShare]::None)
    $writer = New-Object IO.BinaryWriter($stream)
    try {
        $writer.Write([uint16]0)
        $writer.Write([uint16]1)
        $writer.Write([uint16]$sizes.Count)
        $offset = 6 + (16 * $sizes.Count)
        for ($index = 0; $index -lt $sizes.Count; $index += 1) {
            $size = $sizes[$index]
            $writer.Write([byte]$(if ($size -eq 256) { 0 } else { $size }))
            $writer.Write([byte]$(if ($size -eq 256) { 0 } else { $size }))
            $writer.Write([byte]0)
            $writer.Write([byte]0)
            $writer.Write([uint16]1)
            $writer.Write([uint16]32)
            $writer.Write([uint32]$images[$index].Length)
            $writer.Write([uint32]$offset)
            $offset += $images[$index].Length
        }
        foreach ($image in $images) {
            $writer.Write($image)
        }
    }
    finally {
        $writer.Dispose()
        $stream.Dispose()
    }

    [ordered]@{
        source = $resolvedSource
        preview = Join-Path $resolvedOutput 'aethor-studio-v2-rounded.png'
        icon = $icoPath
        sizes = $sizes
    } | ConvertTo-Json -Compress
}
finally {
    $source.Dispose()
}
