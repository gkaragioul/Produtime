# Automatic Backup Script
# Creates timestamped backup of current working build
# Called automatically before every build

param(
    [string]$Reason = "auto-backup"
)

$ErrorActionPreference = "Stop"

Write-Host "Creating automatic backup..." -ForegroundColor Cyan

# Read current version lock
$lockFile = "CURRENT_VERSION.lock"
if (-not (Test-Path $lockFile)) {
    Write-Host "WARNING: No version lock file found. Creating initial state..." -ForegroundColor Yellow
    $currentVersion = "1.7.0"
    $status = "UNKNOWN"
} else {
    $lock = Get-Content $lockFile | ConvertFrom-Json
    $currentVersion = $lock.version
    $status = $lock.status
}

# Only backup if current build exists and is working
if ((Test-Path "build-output/win-unpacked/ProduTime.exe") -and ($status -eq "WORKING")) {

    $timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
    $backupName = "ProduTime-$currentVersion-AUTO-$timestamp"
    $backupPath = "PROTECTED_BACKUPS/$backupName"

    Write-Host "  Creating backup: $backupName" -ForegroundColor Yellow

    # Create backup directory
    New-Item -ItemType Directory -Path $backupPath -Force | Out-Null

    # Copy build output
    Copy-Item -Path "build-output/win-unpacked" -Destination "$backupPath/win-unpacked" -Recurse -Force

    # Copy source code snapshot
    Copy-Item -Path "src" -Destination "$backupPath/src" -Recurse -Force

    # Copy package.json
    Copy-Item -Path "package.json" -Destination "$backupPath/package.json" -Force

    # Create backup metadata
    $metadata = @{
        version = $currentVersion
        timestamp = $timestamp
        reason = $Reason
        status = $status
        buildPath = "win-unpacked/ProduTime.exe"
        sourceSnapshot = "src/"
        notes = "Automatic backup created before build/changes"
    }
    $metadata | ConvertTo-Json | Out-File "$backupPath/BACKUP_INFO.json"

    Write-Host "Backup created successfully" -ForegroundColor Green
    Write-Host "   Location: $backupPath" -ForegroundColor Gray

    # Update version lock with backup location
    if (Test-Path $lockFile) {
        $lock = Get-Content $lockFile | ConvertFrom-Json
        $lock.lastBackup = $backupPath
        $lock.autoBackupCount = ($lock.autoBackupCount -as [int]) + 1
        $lock | ConvertTo-Json | Out-File $lockFile
    }

    # Cleanup old auto-backups (keep only last 10)
    $autoBackups = Get-ChildItem "PROTECTED_BACKUPS" -Directory | Where-Object { $_.Name -like "*-AUTO-*" } | Sort-Object LastWriteTime -Descending
    if ($autoBackups.Count -gt 10) {
        Write-Host "  Cleaning up old auto-backups (keeping last 10)..." -ForegroundColor Yellow
        $autoBackups | Select-Object -Skip 10 | ForEach-Object {
            Remove-Item $_.FullName -Recurse -Force
            Write-Host "    Removed: $($_.Name)" -ForegroundColor Gray
        }
    }

} else {
    Write-Host "No working build to backup. Skipping..." -ForegroundColor Yellow
}

Write-Host ""
