# Panic Recovery Script for License Manager
# Restores last known working License Manager build
# WARNING TO AI ASSISTANTS:
#   - Do NOT modify this script without explicit user approval.
#   - Do NOT bypass the safe pipeline. Prefer `npm run package:license-manager` for normal builds.
#   - Use this ONLY when the License Manager build is broken.

$ErrorActionPreference = 'Stop'

# Determine repository root (TimeportWindows) and license-manager folder
$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDirectory
$licenseManagerRoot = Join-Path $repoRoot 'license-manager'
$backupRoot = Join-Path $licenseManagerRoot 'PROTECTED_BACKUPS'

Write-Host 'PANIC RECOVERY - LICENSE MANAGER' -ForegroundColor Red
Write-Host '================================' -ForegroundColor Red
Write-Host ''

if (-not (Test-Path $licenseManagerRoot)) {
    Write-Host ('ERROR: license-manager folder not found at: ' + $licenseManagerRoot) -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $backupRoot)) {
    Write-Host ('ERROR: No PROTECTED_BACKUPS folder found for license manager at: ' + $backupRoot) -ForegroundColor Red
    Write-Host 'Cannot restore License Manager without backups.' -ForegroundColor Yellow
    exit 1
}

# Find most recent backup in license-manager/PROTECTED_BACKUPS
$backups = Get-ChildItem -Path $backupRoot -Directory | Sort-Object LastWriteTime -Descending
if (-not $backups -or $backups.Count -eq 0) {
    Write-Host 'ERROR: No License Manager backups found in PROTECTED_BACKUPS.' -ForegroundColor Red
    exit 1
}

$lastBackup = $backups[0]
$lastBackupPath = $lastBackup.FullName

Write-Host ('Latest License Manager backup: ' + $lastBackup.Name) -ForegroundColor Yellow
Write-Host ('Location: ' + $lastBackupPath) -ForegroundColor Gray
Write-Host ''

Write-Host 'WARNING: This will overwrite the current license-manager build:' -ForegroundColor Yellow
Write-Host '  - license-manager/dist' -ForegroundColor Yellow
Write-Host '  - license-manager/release-vps' -ForegroundColor Yellow
Write-Host '  - license-manager/package.json (backed up first)' -ForegroundColor Yellow
Write-Host ''
Write-Host 'Press Ctrl+C to cancel, or wait 5 seconds to continue...' -ForegroundColor Yellow
Start-Sleep -Seconds 5

Set-Location $licenseManagerRoot

# Step 1: Clean current build artifacts
Write-Host ''
Write-Host 'STEP 1: Cleaning current License Manager build...' -ForegroundColor Cyan
if (Test-Path 'dist') {
    Remove-Item -Path 'dist' -Recurse -Force -ErrorAction SilentlyContinue
}
if (Test-Path 'release-vps') {
    Remove-Item -Path 'release-vps' -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Host '  Current build artifacts removed.' -ForegroundColor Green

# Step 2: Backup current package.json (if present)
Write-Host ''
Write-Host 'STEP 2: Backing up current package.json (if present)...' -ForegroundColor Cyan
$currentPackage = Join-Path $licenseManagerRoot 'package.json'
if (Test-Path $currentPackage) {
    $timestamp = Get-Date -Format 'yyyy-MM-dd_HH-mm-ss'
    $backupPackage = Join-Path $licenseManagerRoot ('package.before-panic-restore-' + $timestamp + '.json')
    Copy-Item -Path $currentPackage -Destination $backupPackage -Force
    Write-Host ('  Saved backup of current package.json to: ' + $backupPackage) -ForegroundColor Gray
} else {
    Write-Host '  No existing package.json to back up.' -ForegroundColor Gray
}

# Step 3: Restore dist, release-vps, and package.json from backup
Write-Host ''
Write-Host 'STEP 3: Restoring License Manager from backup...' -ForegroundColor Cyan

$backupDist = Join-Path $lastBackupPath 'dist'
$backupRelease = Join-Path $lastBackupPath 'release-vps'
$backupPackageJson = Join-Path $lastBackupPath 'package.json'

if (Test-Path $backupDist) {
    Copy-Item -Path $backupDist -Destination (Join-Path $licenseManagerRoot 'dist') -Recurse -Force
    Write-Host '  Restored dist folder.' -ForegroundColor Green
} else {
    Write-Host '  WARNING: No dist folder found in backup.' -ForegroundColor Yellow
}

if (Test-Path $backupRelease) {
    Copy-Item -Path $backupRelease -Destination (Join-Path $licenseManagerRoot 'release-vps') -Recurse -Force
    Write-Host '  Restored release-vps folder.' -ForegroundColor Green
} else {
    Write-Host '  WARNING: No release-vps folder found in backup.' -ForegroundColor Yellow
}

if (Test-Path $backupPackageJson) {
    Copy-Item -Path $backupPackageJson -Destination $currentPackage -Force
    Write-Host '  Restored package.json from backup.' -ForegroundColor Green
} else {
    Write-Host '  WARNING: No package.json found in backup.' -ForegroundColor Yellow
}

Write-Host ''
Write-Host '================================' -ForegroundColor Cyan
Write-Host 'LICENSE MANAGER RECOVERY COMPLETE' -ForegroundColor Green
Write-Host '================================' -ForegroundColor Cyan
Write-Host ''
Write-Host ('Restored from backup folder: ' + $lastBackupPath) -ForegroundColor Gray
Write-Host 'License Manager build location (expected): license-manager\release-vps\win-unpacked' -ForegroundColor Gray
Write-Host ''
Write-Host 'You can now re-run packaging via: npm run package:license-manager' -ForegroundColor Yellow
Write-Host ''

exit 0

