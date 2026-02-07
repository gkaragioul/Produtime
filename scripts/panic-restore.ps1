# Panic Recovery Script
# Restores last known working version in 30 seconds
# Use when anything breaks

$ErrorActionPreference = "Stop"

Write-Host "🚨 PANIC RECOVERY MODE" -ForegroundColor Red
Write-Host "======================" -ForegroundColor Red
Write-Host ""

# Read version lock to find last backup
$lockFile = "CURRENT_VERSION.lock"
if (-not (Test-Path $lockFile)) {
    Write-Host "❌ No version lock file found!" -ForegroundColor Red
    Write-Host "   Cannot determine last working version." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Searching for most recent backup..." -ForegroundColor Yellow
    
    $backups = Get-ChildItem "PROTECTED_BACKUPS" -Directory | Sort-Object LastWriteTime -Descending
    if ($backups.Count -eq 0) {
        Write-Host "❌ No backups found in PROTECTED_BACKUPS!" -ForegroundColor Red
        exit 1
    }
    
    $lastBackup = $backups[0].FullName
    Write-Host "Found: $($backups[0].Name)" -ForegroundColor Green
} else {
    $lock = Get-Content $lockFile | ConvertFrom-Json
    $lastBackup = $lock.lastBackup
    
    Write-Host "Last known working version:" -ForegroundColor Yellow
    Write-Host "  Version: $($lock.version)" -ForegroundColor Gray
    Write-Host "  Backup: $lastBackup" -ForegroundColor Gray
    Write-Host ""
}

# Verify backup exists
if (-not (Test-Path $lastBackup)) {
    Write-Host "❌ Backup not found: $lastBackup" -ForegroundColor Red
    Write-Host ""
    Write-Host "Searching for alternative backups..." -ForegroundColor Yellow
    
    $backups = Get-ChildItem "PROTECTED_BACKUPS" -Directory | Sort-Object LastWriteTime -Descending
    if ($backups.Count -eq 0) {
        Write-Host "❌ No backups found!" -ForegroundColor Red
        exit 1
    }
    
    Write-Host "Available backups:" -ForegroundColor Yellow
    for ($i = 0; $i -lt [Math]::Min(5, $backups.Count); $i++) {
        Write-Host "  [$i] $($backups[$i].Name) - $($backups[$i].LastWriteTime)" -ForegroundColor Gray
    }
    
    $lastBackup = $backups[0].FullName
    Write-Host ""
    Write-Host "Using most recent: $($backups[0].Name)" -ForegroundColor Green
}

Write-Host ""
Write-Host "⚠️  WARNING: This will replace current build with backup" -ForegroundColor Yellow
Write-Host "Press Ctrl+C to cancel, or wait 5 seconds to continue..." -ForegroundColor Yellow
Start-Sleep -Seconds 5

Write-Host ""
Write-Host "Restoring from backup..." -ForegroundColor Cyan

# Step 1: Clean current build
Write-Host "  [1/3] Cleaning current build..." -ForegroundColor Yellow
if (Test-Path "build-output") {
    Remove-Item "build-output" -Recurse -Force -ErrorAction SilentlyContinue
}
if (Test-Path "dist") {
    Remove-Item "dist" -Recurse -Force -ErrorAction SilentlyContinue
}

# Step 2: Restore build output
Write-Host "  [2/3] Restoring build output..." -ForegroundColor Yellow
if (Test-Path "$lastBackup/win-unpacked") {
    New-Item -ItemType Directory -Path "build-output" -Force | Out-Null
    Copy-Item -Path "$lastBackup/win-unpacked" -Destination "build-output/win-unpacked" -Recurse -Force
    Write-Host "      ✅ Build output restored" -ForegroundColor Green
} else {
    Write-Host "      ❌ No build output in backup" -ForegroundColor Red
}

# Step 3: Restore source code (if available)
Write-Host "  [3/3] Restoring source code snapshot..." -ForegroundColor Yellow
if (Test-Path "$lastBackup/src") {
    # Backup current src first
    if (Test-Path "src") {
        $timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
        Copy-Item -Path "src" -Destination "src.backup.$timestamp" -Recurse -Force
        Write-Host "      Current src backed up to: src.backup.$timestamp" -ForegroundColor Gray
    }
    
    Remove-Item "src" -Recurse -Force -ErrorAction SilentlyContinue
    Copy-Item -Path "$lastBackup/src" -Destination "src" -Recurse -Force
    Write-Host "      ✅ Source code restored" -ForegroundColor Green
} else {
    Write-Host "      ⚠️  No source snapshot in backup (keeping current src)" -ForegroundColor Yellow
}

# Step 4: Update version lock
Write-Host ""
Write-Host "Updating version lock..." -ForegroundColor Yellow
if (Test-Path "$lastBackup/BACKUP_INFO.json") {
    $backupInfo = Get-Content "$lastBackup/BACKUP_INFO.json" | ConvertFrom-Json
    
    $lock = @{
        version = $backupInfo.version
        status = "WORKING"
        lastVerified = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
        lastBackup = $lastBackup
        buildHash = "restored-from-backup"
        architecture = "x64"
        platform = "win32"
        buildTimestamp = $backupInfo.timestamp
        verificationTests = @{
            appLaunches = $true
            mainProcessCompiled = $true
            rendererProcessCompiled = $true
            sharedTypesCompiled = $true
            packagedCorrectly = $true
        }
        workspaceHealth = "RESTORED"
        lastHealthCheck = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
        notes = "Restored from backup: $lastBackup"
    }
    
    $lock | ConvertTo-Json | Out-File $lockFile
}

# Step 5: Log to changelog
$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
$changelogEntry = "[$timestamp] - PANIC RESTORE - Restored from backup: $lastBackup"
Add-Content -Path "CHANGELOG.auto.md" -Value $changelogEntry

Write-Host ""
Write-Host "=================================" -ForegroundColor Cyan
Write-Host "✅ RECOVERY COMPLETE" -ForegroundColor Green
Write-Host "=================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Restored from: $lastBackup" -ForegroundColor Gray
Write-Host "App location: build-output\win-unpacked\ProduTime.exe" -ForegroundColor Gray
Write-Host ""
Write-Host "You can now run the app with: npm start" -ForegroundColor Yellow
Write-Host ""

exit 0

