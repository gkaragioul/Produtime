#!/usr/bin/env pwsh
# =============================================================================
# ProduTime Release Script (NSIS installer + electron-updater)
# Usage: .\scripts\release.ps1 -Version 1.1.0
#
# Code signing (optional):
#   $env:CSC_LINK = "C:\path\to\certificate.pfx"
#   $env:CSC_KEY_PASSWORD = "pfx-password"
#   .\scripts\release.ps1 -Version 1.1.0
#
# Preflight checks (fail-fast before a full rebuild):
#   - package.json "version" matches -Version (electron-builder uses package.json)
#   - git worktree is clean (no uncommitted changes) — -AllowDirty overrides
#   - target tag does not already exist on the releases repo
# =============================================================================

param(
    [Parameter(Mandatory = $true)]
    [string]$Version,

    [switch]$SkipBuild,
    [switch]$DryRun,
    [switch]$AllowDirty
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

# -- Preflight --------------------------------------------------------------------
$RepoRelease = "wotbyalice/WOT-Produtime-Releases"
$Tag = "v$Version"

Write-Host "[0/5] Preflight checks..." -ForegroundColor Yellow

# 1) package.json version matches the CLI arg. electron-builder reads the version
# from package.json, not this flag, so a mismatch ships the wrong version
# silently and clients never see the update.
$PackageJsonPath = Join-Path $RootDir "package.json"
$PackageJson = Get-Content $PackageJsonPath -Raw | ConvertFrom-Json
if ($PackageJson.version -ne $Version) {
    Write-Host "      [FAIL] package.json version is $($PackageJson.version) but -Version is $Version" -ForegroundColor Red
    Write-Host "             Update package.json to $Version and commit before releasing." -ForegroundColor DarkGray
    exit 1
}
Write-Host "      package.json version matches: $Version" -ForegroundColor Green

# 2) Worktree is clean — prevents releasing unsaved changes by accident.
Push-Location $RootDir
$DirtyStatus = git status --porcelain=v1 2>$null
Pop-Location
if ($DirtyStatus -and -not $AllowDirty) {
    Write-Host "      [FAIL] Working tree is dirty. Commit or stash first, or pass -AllowDirty." -ForegroundColor Red
    Write-Host $DirtyStatus -ForegroundColor DarkGray
    exit 1
}
if ($DirtyStatus -and $AllowDirty) {
    Write-Host "      WARN: Releasing with dirty tree (-AllowDirty)." -ForegroundColor Yellow
} else {
    Write-Host "      Working tree is clean." -ForegroundColor Green
}

# 3) Target tag doesn't already exist on the releases repo — otherwise
# gh release create would error after a full rebuild (wasted time).
# gh returns non-zero when the release is missing, which is the happy
# path here; suppress stderr and rely on the exit code.
$prev = $ErrorActionPreference
$ErrorActionPreference = "Continue"
gh release view $Tag --repo $RepoRelease --json tagName *> $null
$TagExists = ($LASTEXITCODE -eq 0)
$ErrorActionPreference = $prev
if ($TagExists) {
    Write-Host "      [FAIL] Release $Tag already exists on $RepoRelease." -ForegroundColor Red
    Write-Host "             Pick a higher version, or delete the existing release first." -ForegroundColor DarkGray
    exit 1
}
Write-Host "      Tag $Tag is unused on $RepoRelease." -ForegroundColor Green

# Code signing status
Write-Host ""
if ($env:CSC_LINK) {
    Write-Host "[SIGNING] Enabled (CSC_LINK detected)" -ForegroundColor Green
} else {
    Write-Host "[SIGNING] Disabled (CSC_LINK not set) - installer will be unsigned" -ForegroundColor Yellow
    Write-Host "          See CODE_SIGNING.md for how to enable" -ForegroundColor DarkGray
}
Write-Host ""

# -- Step 1: Build ---------------------------------------------------------------
if (-not $SkipBuild) {
    Write-Host "[1/5] Building..." -ForegroundColor Yellow
    Push-Location $RootDir
    npm run build:main
    if ($LASTEXITCODE -ne 0) { Write-Error "build:main failed"; exit 1 }
    npm run build:renderer
    if ($LASTEXITCODE -ne 0) { Write-Error "build:renderer failed"; exit 1 }
    Pop-Location
    Write-Host "      Build complete." -ForegroundColor Green
} else {
    Write-Host "[1/5] Build skipped (-SkipBuild)" -ForegroundColor DarkGray
}

# -- Step 2: Package NSIS installer ----------------------------------------------
Write-Host "[2/5] Packaging NSIS installer..." -ForegroundColor Yellow
Push-Location $RootDir
npx electron-builder --win nsis --x64
if ($LASTEXITCODE -ne 0) { Write-Error "electron-builder failed"; exit 1 }
Pop-Location

$OutDir = Join-Path $RootDir "build-output"

# Find the installer EXE — name is fixed so permanent GitHub latest link works
$InstallerFile = Get-Item -Path (Join-Path $OutDir "WOT-Produtime-Setup.exe") -ErrorAction SilentlyContinue
if (-not $InstallerFile) {
    Write-Error "WOT-Produtime-Setup.exe not found in $OutDir"
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
Write-Host "[3/5] Computing SHA256..." -ForegroundColor Yellow
$Hash = (Get-FileHash -Path $InstallerFile.FullName -Algorithm SHA256).Hash.ToLower()
Write-Host "      SHA256: $Hash" -ForegroundColor Green

# -- Step 4: GitHub Release -------------------------------------------------------
$ReleaseNotes = "ProduTime v$Version`n`nInstaller SHA256: $Hash`n`nDownload and run to install. Auto-updates enabled."

Write-Host "[4/5] Creating GitHub release $Tag on $RepoRelease..." -ForegroundColor Yellow

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

# -- Step 5: Verify every asset was uploaded -------------------------------------
if (-not $DryRun) {
    Write-Host "[5/5] Verifying uploaded assets..." -ForegroundColor Yellow
    $RequiredAssets = @($InstallerFile.Name, "latest.yml")
    if (Test-Path $BlockMap) { $RequiredAssets += (Split-Path $BlockMap -Leaf) }

    $ReleaseJson = gh release view $Tag --repo $RepoRelease --json assets 2>$null | ConvertFrom-Json
    $UploadedNames = @()
    if ($ReleaseJson -and $ReleaseJson.assets) {
        $UploadedNames = $ReleaseJson.assets | ForEach-Object { $_.name }
    }

    $Missing = @()
    foreach ($a in $RequiredAssets) {
        if ($UploadedNames -notcontains $a) { $Missing += $a }
    }

    if ($Missing.Count -gt 0) {
        Write-Host "      [FAIL] Release is missing assets: $($Missing -join ', ')" -ForegroundColor Red
        Write-Host "             Clients will not auto-update. Fix by re-running or uploading manually:" -ForegroundColor DarkGray
        Write-Host "             gh release upload $Tag --repo $RepoRelease <file>" -ForegroundColor DarkGray
        exit 1
    }
    Write-Host "      All $($RequiredAssets.Count) required assets present: $($RequiredAssets -join ', ')" -ForegroundColor Green
} else {
    Write-Host "[5/5] Asset verification skipped (-DryRun)" -ForegroundColor DarkGray
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
