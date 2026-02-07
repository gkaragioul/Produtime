param(
    [string]$Version = "1.7.1"
)

$ErrorActionPreference = 'Stop'

Write-Host "=== Creating PROTECTED backup and distribution ZIP for ProduTime $Version ===" -ForegroundColor Cyan
Write-Host ""

# Resolve paths relative to workspace root (assumed current directory)
$root = Get-Location
$src = Join-Path $root 'build-output\win-unpacked'

if (-not (Test-Path $src)) {
    Write-Host "ERROR: Source folder not found: $src" -ForegroundColor Red
    exit 1
}

$backupRoot = Join-Path $root 'PROTECTED_BACKUPS'

$timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$backupName = "ProduTime-$Version-WORKING-$timestamp"
$backupPath = Join-Path $backupRoot $backupName

Write-Host "Creating PROTECTED backup at: $backupPath" -ForegroundColor Yellow

New-Item -ItemType Directory -Path $backupPath -Force | Out-Null
Copy-Item -Path (Join-Path $src '*') -Destination $backupPath -Recurse -Force

Write-Host "Backup created successfully." -ForegroundColor Green
Write-Host ""

# Create distribution ZIP on Mac Desktop
$desktop = 'C:\Mac\Home\Desktop'
$zipPath = Join-Path $desktop ("ProduTime-$Version-Distribution.zip")

Write-Host "Creating distribution ZIP at: $zipPath" -ForegroundColor Yellow

if (Test-Path $zipPath) {
    Write-Host "Existing ZIP found, overwriting: $zipPath" -ForegroundColor DarkYellow
    Remove-Item $zipPath -Force
}

Compress-Archive -Path (Join-Path $src '*') -DestinationPath $zipPath -CompressionLevel Optimal

$sizeMB = [Math]::Round((Get-Item $zipPath).Length / 1MB, 2)

$logTimestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
Write-Host "CHANGELOG_TIMESTAMP=$logTimestamp" -ForegroundColor Cyan

Write-Host ""
Write-Host "✅ Backup and ZIP completed successfully." -ForegroundColor Green
Write-Host "   Backup folder: $backupPath" -ForegroundColor Green
Write-Host "   ZIP file:      $zipPath ($sizeMB MB)" -ForegroundColor Green
Write-Host ""
