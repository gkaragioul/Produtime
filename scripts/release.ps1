# =============================================================================
# ProduTime Release Script
# Usage: .\scripts\release.ps1 -Version 0.5.2
#
# What it does:
#   1. Builds main + renderer
#   2. Packages portable x64 EXE via electron-builder
#   3. Computes SHA256 of the installer
#   4. Creates a GitHub release on wotbyalice/WOT-Produtime-Releases
#   5. Uploads the EXE to the release
#   6. Publishes the update manifest to Railway (wot-produtime-production.up.railway.app)
# =============================================================================

param(
    [Parameter(Mandatory = $true)]
    [string]$Version,

    [string]$AdminUrl = "https://wot-produtime-production.up.railway.app",

    [string]$AdminPassword = $env:PRODUTIME_ADMIN_PASSWORD,

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

# ── Step 1: Build ──────────────────────────────────────────────────────────────
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

# ── Step 2: Package ────────────────────────────────────────────────────────────
Write-Host "[2/5] Packaging portable x64 EXE..." -ForegroundColor Yellow
Push-Location $RootDir
npx electron-builder --win portable --x64
if ($LASTEXITCODE -ne 0) { Write-Error "electron-builder failed"; exit 1 }
Pop-Location

# Find the output EXE
$OutDir = Join-Path $RootDir "build-output"
$ExeFile = Get-ChildItem -Path $OutDir -Filter "*.exe" -Recurse | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $ExeFile) {
    Write-Error "No EXE found in $OutDir after packaging"
    exit 1
}
Write-Host "      Packaged: $($ExeFile.FullName)" -ForegroundColor Green

# ── Step 3: SHA256 ─────────────────────────────────────────────────────────────
Write-Host "[3/5] Computing SHA256..." -ForegroundColor Yellow
$Hash = (Get-FileHash -Path $ExeFile.FullName -Algorithm SHA256).Hash.ToLower()
Write-Host "      SHA256: $Hash" -ForegroundColor Green

# ── Step 4: GitHub Release ────────────────────────────────────────────────────
$Tag         = "v$Version"
$RepoRelease = "wotbyalice/WOT-Produtime-Releases"
$ReleaseNotes = "ProduTime v$Version`n`nSHA256: $Hash"

Write-Host "[4/5] Creating GitHub release $Tag on $RepoRelease..." -ForegroundColor Yellow

if ($DryRun) {
    Write-Host "      DRY RUN — skipping GitHub release creation" -ForegroundColor DarkGray
} else {
    # Create the release and upload EXE
    gh release create $Tag `
        --repo $RepoRelease `
        --title "ProduTime v$Version" `
        --notes $ReleaseNotes `
        $ExeFile.FullName

    if ($LASTEXITCODE -ne 0) { Write-Error "gh release create failed"; exit 1 }
    Write-Host "      Release published: https://github.com/$RepoRelease/releases/tag/$Tag" -ForegroundColor Green
}

# Build download URL
$ExeName    = $ExeFile.Name
$DownloadUrl = "https://github.com/$RepoRelease/releases/download/$Tag/$ExeName"
$ReleaseNotesUrl = "https://github.com/$RepoRelease/releases/tag/$Tag"

# ── Step 5: Publish manifest to Railway ───────────────────────────────────────
Write-Host "[5/5] Publishing update manifest to Railway..." -ForegroundColor Yellow

if (-not $AdminPassword) {
    Write-Warning "PRODUTIME_ADMIN_PASSWORD not set — prompting..."
    $SecurePass = Read-Host "Admin password" -AsSecureString
    $AdminPassword = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto(
        [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecurePass)
    )
}

if ($DryRun) {
    Write-Host "      DRY RUN — skipping manifest publish" -ForegroundColor DarkGray
    Write-Host "      Would POST to: $AdminUrl/api/updates/publish" -ForegroundColor DarkGray
    Write-Host "      Payload: version=$Version, url=$DownloadUrl" -ForegroundColor DarkGray
} else {
    # Authenticate
    $LoginBody = @{ password = $AdminPassword } | ConvertTo-Json
    $LoginResp = Invoke-RestMethod -Uri "$AdminUrl/api/auth/login" `
        -Method POST -ContentType "application/json" -Body $LoginBody
    if (-not $LoginResp.success) {
        Write-Error "Admin login failed: $($LoginResp.error)"
        exit 1
    }
    $Token = $LoginResp.token

    # Publish manifest
    $PublishBody = @{
        version        = $Version
        url            = $DownloadUrl
        releaseNotesUrl = $ReleaseNotesUrl
        sha256         = $Hash
        mandatory      = $false
    } | ConvertTo-Json

    $PublishResp = Invoke-RestMethod -Uri "$AdminUrl/api/updates/publish" `
        -Method POST -ContentType "application/json" -Body $PublishBody `
        -Headers @{ Authorization = "Bearer $Token" }

    if (-not $PublishResp.success) {
        Write-Error "Manifest publish failed"
        exit 1
    }
    Write-Host "      Manifest live at: $AdminUrl/updates/latest.json" -ForegroundColor Green
}

# ── Summary ───────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  Release v$Version complete!" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  Installer : $($ExeFile.Name)" -ForegroundColor White
Write-Host "  SHA256    : $Hash" -ForegroundColor White
Write-Host "  GitHub    : https://github.com/$RepoRelease/releases/tag/$Tag" -ForegroundColor White
Write-Host "  Manifest  : $AdminUrl/updates/latest.json" -ForegroundColor White
Write-Host ""
