#!/usr/bin/env pwsh
# =============================================================================
# ProduTime Release Script (NSIS installer + electron-updater)
# Usage: .\scripts\release.ps1 -Version 1.1.0
#
# Code signing (optional):
#   $env:CSC_LINK = "C:\path\to\certificate.pfx"
#   $env:CSC_KEY_PASSWORD = "pfx-password"
#   .\scripts\release.ps1 -Version 1.1.0
# =============================================================================

param(
    [Parameter(Mandatory = $true)]
    [string]$Version,

    [switch]$SkipBuild,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir   = Split-Path -Parent $ScriptDir

if ($Version -notmatch '^\d+\.\d+\.\d+$') {
    Write-Error "Version must be in X.Y.Z format (e.g. 1.1.0)"
    exit 1
}

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  ProduTime Release Script v$Version" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# Code signing status
if ($env:CSC_LINK) {
    Write-Host "[SIGNING] Enabled (CSC_LINK detected)" -ForegroundColor Green
} else {
    Write-Host "[SIGNING] Disabled (CSC_LINK not set) - installer will be unsigned" -ForegroundColor Yellow
    Write-Host "          See CODE_SIGNING.md for how to enable" -ForegroundColor DarkGray
}
Write-Host ""

# -- Step 1: Build ---------------------------------------------------------------
if (-not $SkipBuild) {
    Write-Host "[1/4] Building..." -ForegroundColor Yellow
    Push-Location $RootDir
    npm run build:main
    if ($LASTEXITCODE -ne 0) { Write-Error "build:main failed"; exit 1 }
    npm run build:renderer
    if ($LASTEXITCODE -ne 0) { Write-Error "build:renderer failed"; exit 1 }
    Pop-Location
    Write-Host "      Build complete." -ForegroundColor Green
} else {
    Write-Host "[1/4] Build skipped (-SkipBuild)" -ForegroundColor DarkGray
}

# -- Step 2: Package NSIS installer ----------------------------------------------
Write-Host "[2/4] Packaging NSIS installer..." -ForegroundColor Yellow
Push-Location $RootDir
npx electron-builder --win nsis --x64
if ($LASTEXITCODE -ne 0) { Write-Error "electron-builder failed"; exit 1 }
Pop-Location

$OutDir = Join-Path $RootDir "build-output"

# Find the installer EXE (NSIS default naming)
$InstallerFile = Get-ChildItem -Path $OutDir -Filter "*Setup*.exe" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $InstallerFile) {
    $InstallerFile = Get-ChildItem -Path $OutDir -Filter "*.exe" | Where-Object { $_.Name -notlike "*portable*" } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
}
if (-not $InstallerFile) {
    Write-Error "No installer EXE found in $OutDir"
    exit 1
}

# electron-updater needs latest.yml + blockmap to serve updates
$LatestYml = Join-Path $OutDir "latest.yml"
$BlockMap = Join-Path $OutDir "$($InstallerFile.BaseName).exe.blockmap"

if (-not (Test-Path $LatestYml)) {
    Write-Error "latest.yml not found at $LatestYml - electron-updater requires this file"
    exit 1
}

Write-Host "      Installer: $($InstallerFile.Name)" -ForegroundColor Green
Write-Host "      latest.yml: found" -ForegroundColor Green
if (Test-Path $BlockMap) {
    Write-Host "      blockmap: found (enables diff updates)" -ForegroundColor Green
}

# -- Step 3: SHA256 ---------------------------------------------------------------
Write-Host "[3/4] Computing SHA256..." -ForegroundColor Yellow
$Hash = (Get-FileHash -Path $InstallerFile.FullName -Algorithm SHA256).Hash.ToLower()
Write-Host "      SHA256: $Hash" -ForegroundColor Green

# -- Step 4: GitHub Release -------------------------------------------------------
$Tag = "v$Version"
$RepoRelease = "wotbyalice/WOT-Produtime-Releases"
$ReleaseNotes = "ProduTime v$Version`n`nInstaller SHA256: $Hash`n`nDownload and run to install. Auto-updates enabled."

Write-Host "[4/4] Creating GitHub release $Tag on $RepoRelease..." -ForegroundColor Yellow

if ($DryRun) {
    Write-Host "      DRY RUN -- skipping GitHub release creation" -ForegroundColor DarkGray
} else {
    # Build asset list — installer + latest.yml are required; blockmap is optional
    $Assets = @($InstallerFile.FullName, $LatestYml)
    if (Test-Path $BlockMap) { $Assets += $BlockMap }

    gh release create $Tag `
        --repo $RepoRelease `
        --title "ProduTime v$Version" `
        --notes $ReleaseNotes `
        @Assets

    if ($LASTEXITCODE -ne 0) { Write-Error "gh release create failed"; exit 1 }
    Write-Host "      Release published: https://github.com/$RepoRelease/releases/tag/$Tag" -ForegroundColor Green
}

# -- Summary ----------------------------------------------------------------------
Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  Release v$Version complete!" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  Installer : $($InstallerFile.Name)" -ForegroundColor White
Write-Host "  SHA256    : $Hash" -ForegroundColor White
Write-Host "  GitHub    : https://github.com/$RepoRelease/releases/tag/$Tag" -ForegroundColor White
Write-Host ""
