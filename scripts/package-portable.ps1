[CmdletBinding()]
param(
    [string] $OutputDirectory
)

$ErrorActionPreference = 'Stop'

function Get-FullPath([string] $Path) {
    $fullPath = [System.IO.Path]::GetFullPath($Path)
    $pathRoot = [System.IO.Path]::GetPathRoot($fullPath)
    if ($fullPath.Length -gt $pathRoot.Length) {
        return $fullPath.TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
    }
    return $fullPath
}

function Assert-ChildPath([string] $Child, [string] $Parent, [string] $Purpose) {
    $prefix = $Parent.TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
    if (-not $Child.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "$Purpose must be inside '$Parent'. Resolved path: '$Child'."
    }
}

if ($env:OS -ne 'Windows_NT') {
    throw 'The portable package is currently built for Windows x64 only.'
}

$repositoryRoot = Get-FullPath (Join-Path $PSScriptRoot '..')
$packageJsonPath = Join-Path $repositoryRoot 'package.json'
$tauriConfigPath = Join-Path $repositoryRoot 'src-tauri\tauri.conf.json'

if (-not (Test-Path -LiteralPath $packageJsonPath -PathType Leaf)) {
    throw "Could not find package.json at '$packageJsonPath'."
}
if (-not (Test-Path -LiteralPath $tauriConfigPath -PathType Leaf)) {
    throw "Could not find Tauri configuration at '$tauriConfigPath'."
}

$package = Get-Content -LiteralPath $packageJsonPath -Raw | ConvertFrom-Json
$tauri = Get-Content -LiteralPath $tauriConfigPath -Raw | ConvertFrom-Json
if ([string]::IsNullOrWhiteSpace($package.version) -or $package.version -ne $tauri.version) {
    throw 'package.json and src-tauri/tauri.conf.json must have the same non-empty version.'
}
if ($tauri.bundle.resources) {
    throw 'Tauri bundle resources are configured. Review and add their verified runtime files to this portable package script before building.'
}

if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $OutputDirectory = Join-Path $repositoryRoot 'out\portable'
} elseif (-not [System.IO.Path]::IsPathRooted($OutputDirectory)) {
    $OutputDirectory = Join-Path $repositoryRoot $OutputDirectory
}
$outputRoot = Get-FullPath $OutputDirectory
$archiveName = "Shorthand-Writer-v$($package.version)-win-x64.zip"
$archivePath = Get-FullPath (Join-Path $outputRoot $archiveName)
$checksumPath = "$archivePath.sha256"
Assert-ChildPath $archivePath $outputRoot 'Archive output'

if ((Test-Path -LiteralPath $outputRoot) -and -not (Test-Path -LiteralPath $outputRoot -PathType Container)) {
    throw "Output path exists and is not a directory: '$outputRoot'."
}
if ((Test-Path -LiteralPath $archivePath) -or (Test-Path -LiteralPath $checksumPath)) {
    throw "Refusing to overwrite an existing package or checksum in '$outputRoot'. Choose another output directory or move the old files yourself."
}

$releaseExecutable = Get-FullPath (Join-Path $repositoryRoot 'src-tauri\target\release\shorthand-writer.exe')
$expectedReleaseRoot = Get-FullPath (Join-Path $repositoryRoot 'src-tauri\target\release')
Assert-ChildPath $releaseExecutable $expectedReleaseRoot 'Release executable'

Write-Host "Building Shorthand Writer v$($package.version) for Windows x64..."
npm run desktop:build -- --no-bundle
if ($LASTEXITCODE -ne 0) {
    throw "The Tauri release build failed with exit code $LASTEXITCODE."
}
if (-not (Test-Path -LiteralPath $releaseExecutable -PathType Leaf)) {
    throw "The release executable was not produced at '$releaseExecutable'."
}
$executableBytes = [System.IO.File]::ReadAllBytes($releaseExecutable)
$executableText = [System.Text.Encoding]::ASCII.GetString($executableBytes)
if (-not $executableText.Contains('portable-data-v1')) {
    throw "The release executable does not contain the portable-data-v1 runtime contract. Refusing to package an app that would ignore portable.mode."
}

$tempRoot = Get-FullPath ([System.IO.Path]::GetTempPath())
if (-not (Test-Path -LiteralPath $tempRoot -PathType Container)) {
    throw "The temporary directory is unavailable: '$tempRoot'."
}
$stage = Get-FullPath (Join-Path $tempRoot "shorthand-portable-$($package.version)-$PID")
Assert-ChildPath $stage $tempRoot 'Temporary staging directory'
if (Test-Path -LiteralPath $stage) {
    throw "Temporary staging path already exists; refusing to reuse it: '$stage'."
}
if ($stage.Equals($outputRoot, [System.StringComparison]::OrdinalIgnoreCase) -or
    $stage.StartsWith($outputRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase) -or
    $outputRoot.StartsWith($stage.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Output '$outputRoot' must not overlap temporary staging '$stage'."
}

try {
    New-Item -ItemType Directory -Path $stage | Out-Null
    $applicationName = 'Shorthand Writer.exe'
    Copy-Item -LiteralPath $releaseExecutable -Destination (Join-Path $stage $applicationName)

    # Runtime storage code recognizes this marker and creates a writable data folder
    # beside the application. Story projects remain separately chosen .shorthand files.
    Set-Content -LiteralPath (Join-Path $stage 'portable.mode') -Encoding Ascii -Value 'portable-data-v1'

    $portableReadme = @"
Shorthand Writer v$($package.version) - Windows x64 portable app

Run $applicationName from a writable folder extracted from this archive. Do not run
the app directly from inside the ZIP. This app requires the Microsoft Edge WebView2
Evergreen Runtime. If the app reports that WebView2 is missing, install the Evergreen
Runtime from Microsoft's official WebView2 download page:
https://developer.microsoft.com/en-us/microsoft-edge/webview2

Portable settings and recovery data are stored in the data folder beside the app.
Project files are ordinary .shorthand SQLite files: save them in the location you
choose, and back them up separately from this application folder.

ChatGPT credentials are protected by the current Windows user account. Copying this
folder to another computer or Windows user does not copy a working sign-in; reconnect
from Settings on that account.

To update, close the app after saving, then replace only the application files from
the newer ZIP. Keep this folder's data directory and your separately saved projects.
"@
    Set-Content -LiteralPath (Join-Path $stage 'README.txt') -Encoding UTF8 -Value $portableReadme

    if (-not (Test-Path -LiteralPath (Join-Path $stage $applicationName) -PathType Leaf) -or
        -not (Test-Path -LiteralPath (Join-Path $stage 'portable.mode') -PathType Leaf) -or
        -not (Test-Path -LiteralPath (Join-Path $stage 'README.txt') -PathType Leaf)) {
        throw 'Package staging is incomplete; refusing to create an archive.'
    }

    New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
    Assert-ChildPath (Get-FullPath $archivePath) $outputRoot 'Archive output'
    Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $archivePath -CompressionLevel Optimal

    if (-not (Test-Path -LiteralPath $archivePath -PathType Leaf)) {
        throw 'The archive command completed without producing the expected ZIP.'
    }
    $archiveHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
    Set-Content -LiteralPath $checksumPath -Encoding Ascii -Value "$archiveHash  $archiveName"

    Write-Host "Portable archive: $archivePath"
    Write-Host "SHA-256: $checksumPath"
} finally {
    $resolvedStage = Get-FullPath $stage
    Assert-ChildPath $resolvedStage $tempRoot 'Temporary cleanup path'
    if (Test-Path -LiteralPath $resolvedStage -PathType Container) {
        Remove-Item -LiteralPath $resolvedStage -Recurse -Force
    }
}
