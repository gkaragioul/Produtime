# ============================================================================
# AUTO-BACKUP BEFORE BUILD
# ============================================================================
# This script automatically creates a backup of the current build before
# starting a new build. This ensures you never lose a working version.
# ============================================================================

$ErrorActionPreference = 'Continue'

$timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$backupName = "ProduTime-PreBuild-$timestamp"
$backupPath = "PROTECTED_BACKUPS\$backupName"

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  AUTO-BACKUP BEFORE BUILD" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Determine source build folder (support both old and new locations)
$sourcePath = $null
if (Test-Path "release\win-unpacked\ProduTime.exe") {
    $sourcePath = "release\win-unpacked"
} elseif (Test-Path "build-output\win-unpacked\ProduTime.exe") {
    $sourcePath = "build-output\win-unpacked"
}

# Check if current build exists
if ($sourcePath) {
    Write-Host "📦 Creating automatic backup..." -ForegroundColor Yellow
    Write-Host "   Source: $sourcePath" -ForegroundColor Gray
    Write-Host "   Destination: $backupPath" -ForegroundColor Gray
    Write-Host ""

    try {
        # Create backup directory
        New-Item -ItemType Directory -Path $backupPath -Force | Out-Null

        # Copy current build
        Copy-Item -Path "$sourcePath\*" -Destination $backupPath -Recurse -Force -ErrorAction Stop

        $backupSize = (Get-ChildItem -Path $backupPath -Recurse | Measure-Object -Property Length -Sum).Sum / 1MB

        Write-Host "✅ Backup created successfully!" -ForegroundColor Green
        Write-Host "   Size: $([math]::Round($backupSize, 2)) MB" -ForegroundColor Gray
        Write-Host ""

        # Keep only last 5 pre-build backups (cleanup old ones)
        Write-Host "🧹 Cleaning up old backups..." -ForegroundColor Yellow

        $oldBackups = Get-ChildItem "PROTECTED_BACKUPS" -Directory -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -like "ProduTime-PreBuild-*" } |
            Sort-Object Name -Descending |
            Select-Object -Skip 5

        if ($oldBackups) {
            foreach ($old in $oldBackups) {
                Remove-Item $old.FullName -Recurse -Force -ErrorAction SilentlyContinue
                Write-Host "   Removed: $($old.Name)" -ForegroundColor Gray
            }
            Write-Host ""
        }

        Write-Host "✅ Backup system ready!" -ForegroundColor Green

    } catch {
        Write-Host "⚠️  Warning: Could not create backup" -ForegroundColor Yellow
        Write-Host "   Error: $($_.Exception.Message)" -ForegroundColor Gray
        Write-Host "   Continuing with build..." -ForegroundColor Yellow
    }

} else {
    Write-Host "ℹ️  No existing build found to backup" -ForegroundColor Cyan
    Write-Host "   This appears to be a fresh build" -ForegroundColor Gray
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
