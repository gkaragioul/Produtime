# Clean stale License Manager release folders
# This script is SAFE: it only removes old release folders that are no longer used
# by the safe build pipeline. It does NOT touch PROTECTED_BACKUPS.

$ErrorActionPreference = 'Stop'

$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDirectory
$licenseManagerRoot = Join-Path $repoRoot 'license-manager'

Write-Host 'CLEAN STALE LICENSE MANAGER FOLDERS' -ForegroundColor Cyan
Write-Host '====================================' -ForegroundColor Cyan
Write-Host ''

if (-not (Test-Path $licenseManagerRoot)) {
    Write-Host ('ERROR: license-manager folder not found at: ' + $licenseManagerRoot) -ForegroundColor Red
    exit 1
}

$targets = @(
    'release-final',
    'release-vps-fixed',
    'release-vps-new',
    'release-vps/win-arm64-unpacked'
)

$existing = @()
foreach ($relPath in $targets) {
    $fullPath = Join-Path $licenseManagerRoot $relPath
    if (Test-Path $fullPath) {
        $existing += $fullPath
    }
}

if ($existing.Count -eq 0) {
    Write-Host 'No stale License Manager release folders found. Nothing to clean.' -ForegroundColor Green
    exit 0
}

Write-Host 'The following stale folders were found:' -ForegroundColor Yellow
foreach ($path in $existing) {
    $size = 0
    try {
        $size = (Get-ChildItem -Path $path -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
    } catch {
        $size = $null
    }
    if ($size -ne $null) {
        $mb = [math]::Round($size / 1MB, 2)
        Write-Host ('  - ' + $path + ' (' + $mb + ' MB)') -ForegroundColor Gray
    } else {
        Write-Host ('  - ' + $path) -ForegroundColor Gray
    }
}

Write-Host ''
Write-Host 'These are old release folders. The safe pipeline only uses:' -ForegroundColor Yellow
Write-Host '  - license-manager/dist' -ForegroundColor Yellow
Write-Host '  - license-manager/release-vps/win-unpacked' -ForegroundColor Yellow
Write-Host ''

$answer = Read-Host 'Do you want to delete ALL of the stale folders listed above? (Y/N)'
if ($answer -ne 'Y' -and $answer -ne 'y') {
    Write-Host 'Aborted. No folders were removed.' -ForegroundColor Yellow
    exit 0
}

Write-Host ''
Write-Host 'Deleting stale folders...' -ForegroundColor Cyan
foreach ($path in $existing) {
    Write-Host ('  Removing: ' + $path) -ForegroundColor Gray
    try {
        Remove-Item -Path $path -Recurse -Force -ErrorAction Stop
        Write-Host '    OK' -ForegroundColor Green
    } catch {
        Write-Host ('    FAILED: ' + $_.Exception.Message) -ForegroundColor Red
    }
}

Write-Host ''
Write-Host 'Cleanup complete. Safe License Manager build folders are untouched.' -ForegroundColor Green
Write-Host ''

exit 0

