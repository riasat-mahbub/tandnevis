[CmdletBinding()]
param()

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

$outputRoot = Get-FullPath (Join-Path $repositoryRoot 'out\latest')
$applicationName = 'Shorthand Writer.exe'
$installedExecutable = Join-Path $outputRoot $applicationName
$archiveName = 'Shorthand-Writer-latest-win-x64.zip'
$archivePath = Get-FullPath (Join-Path $outputRoot $archiveName)
$checksumPath = "$archivePath.sha256"
Assert-ChildPath $archivePath $outputRoot 'Archive output'

if ((Test-Path -LiteralPath $outputRoot) -and -not (Test-Path -LiteralPath $outputRoot -PathType Container)) {
    throw "Output path exists and is not a directory: '$outputRoot'."
}
foreach ($process in @(Get-Process -Name 'Shorthand Writer' -ErrorAction SilentlyContinue)) {
    if ($process.Path -and $process.Path.Equals($installedExecutable, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'Save your project and close Shorthand Writer before updating out/latest.'
    }
}

$releaseExecutable = Get-FullPath (Join-Path $repositoryRoot 'src-tauri\target\release\shorthand-writer.exe')
$expectedReleaseRoot = Get-FullPath (Join-Path $repositoryRoot 'src-tauri\target\release')
Assert-ChildPath $releaseExecutable $expectedReleaseRoot 'Release executable'

Write-Host "Building Shorthand Writer v$($package.version) for Windows x64..."
Push-Location -LiteralPath $repositoryRoot
try {
    npm run desktop:build -- --no-bundle
    if ($LASTEXITCODE -ne 0) {
        throw "The Tauri release build failed with exit code $LASTEXITCODE."
    }
} finally {
    Pop-Location
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
    $appStage = Join-Path $stage 'app'
    New-Item -ItemType Directory -Path $appStage | Out-Null
    Copy-Item -LiteralPath $releaseExecutable -Destination (Join-Path $appStage $applicationName)

    # Runtime storage code recognizes this marker and creates a writable data folder
    # beside the application. Story projects remain separately chosen .shorthand files.
    Set-Content -LiteralPath (Join-Path $appStage 'portable.mode') -Encoding Ascii -Value 'portable-data-v1'

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

This is the latest build. Future packaging updates this same application folder.
To update, close the app after saving. Keep the data directory and your separately
saved projects. Launch the extracted executable, not the copy inside the ZIP.
"@
    Set-Content -LiteralPath (Join-Path $appStage 'README.txt') -Encoding UTF8 -Value $portableReadme

    if (-not (Test-Path -LiteralPath (Join-Path $appStage $applicationName) -PathType Leaf) -or
        -not (Test-Path -LiteralPath (Join-Path $appStage 'portable.mode') -PathType Leaf) -or
        -not (Test-Path -LiteralPath (Join-Path $appStage 'README.txt') -PathType Leaf)) {
        throw 'Package staging is incomplete; refusing to create an archive.'
    }

    $stagedArchive = Join-Path $stage $archiveName
    Compress-Archive -Path (Join-Path $appStage '*') -DestinationPath $stagedArchive -CompressionLevel Optimal

    if (-not (Test-Path -LiteralPath $stagedArchive -PathType Leaf)) {
        throw 'The archive command completed without producing the expected ZIP.'
    }
    $archiveHash = (Get-FileHash -LiteralPath $stagedArchive -Algorithm SHA256).Hash.ToLowerInvariant()
    New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
    # Update only release files. Never copy or delete the existing data folder.
    foreach ($name in @($applicationName, 'portable.mode', 'README.txt')) {
        Copy-Item -LiteralPath (Join-Path $appStage $name) -Destination (Join-Path $outputRoot $name) -Force
    }
    Copy-Item -LiteralPath $stagedArchive -Destination $archivePath -Force
    Set-Content -LiteralPath $checksumPath -Encoding Ascii -Value "$archiveHash  $archiveName"

    Write-Host "Latest app: $installedExecutable"
    Write-Host "Portable archive: $archivePath"
    Write-Host "SHA-256: $checksumPath"
} finally {
    $resolvedStage = Get-FullPath $stage
    Assert-ChildPath $resolvedStage $tempRoot 'Temporary cleanup path'
    if (Test-Path -LiteralPath $resolvedStage -PathType Container) {
        Remove-Item -LiteralPath $resolvedStage -Recurse -Force
    }
}
