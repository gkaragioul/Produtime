# =============================================================================
# ProduTime Release Script
# Usage: .\scripts\release.ps1 -Version 0.5.2
#
# What it does:
#   1. Builds main + renderer
#   2. Packages NSIS installer via electron-builder
#   3. Creates a GitHub release on wotbyalice/WOT-Produtime-Releases
#   4. Uploads installer EXE + latest.yml (required by electron-updater)
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

# Validate version format
if ($Version -notmatch '^\d+\.\d+\.\d+$') {
    Write-Error "Version must be in X.Y.Z format (e.g. 0.5.2)"
    exit 1
}

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  ProduTime Release Script v$Version" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
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

# Find the output EXE and latest.yml
$OutDir = Join-Path $RootDir "build-output"
$ExeFile = Get-ChildItem -Path $OutDir -Filter "*.exe" -Recurse | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$YmlFile = Join-Path $OutDir "latest.yml"

if (-not $ExeFile) {
    Write-Error "No EXE found in $OutDir after packaging"
    exit 1
}
if (-not (Test-Path $YmlFile)) {
    Write-Error "latest.yml not found in $OutDir -- electron-updater requires this file"
    exit 1
}
Write-Host "      Installer: $($ExeFile.FullName)" -ForegroundColor Green
Write-Host "      Manifest:  $YmlFile" -ForegroundColor Green

# -- Step 3: SHA256 ---------------------------------------------------------------
Write-Host "[3/4] Computing SHA256..." -ForegroundColor Yellow
$Hash = (Get-FileHash -Path $ExeFile.FullName -Algorithm SHA256).Hash.ToLower()
Write-Host "      SHA256: $Hash" -ForegroundColor Green

# -- Step 4: GitHub Release -------------------------------------------------------
$Tag         = "v$Version"
$RepoRelease = "wotbyalice/WOT-Produtime-Releases"
$ReleaseNotes = "ProduTime v$Version`n`nSHA256: $Hash"

Write-Host "[4/4] Creating GitHub release $Tag on $RepoRelease..." -ForegroundColor Yellow

if ($DryRun) {
    Write-Host "      DRY RUN -- skipping GitHub release creation" -ForegroundColor DarkGray
} else {
    # Create the release and upload BOTH the installer EXE and latest.yml
    gh release create $Tag `
        --repo $RepoRelease `
        --title "ProduTime v$Version" `
        --notes $ReleaseNotes `
        $ExeFile.FullName `
        $YmlFile

    if ($LASTEXITCODE -ne 0) { Write-Error "gh release create failed"; exit 1 }
    Write-Host "      Release published: https://github.com/$RepoRelease/releases/tag/$Tag" -ForegroundColor Green
}

# -- Summary ----------------------------------------------------------------------
Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  Release v$Version complete!" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  Installer : $($ExeFile.Name)" -ForegroundColor White
Write-Host "  SHA256    : $Hash" -ForegroundColor White
Write-Host "  GitHub    : https://github.com/$RepoRelease/releases/tag/$Tag" -ForegroundColor White
Write-Host ""
