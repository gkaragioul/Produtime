# Workspace Startup Script
# Runs automatically when workspace opens
# Performs health checks and environment setup

$ErrorActionPreference = "Continue"

Write-Host ""
Write-Host "ProduTime Workspace Startup" -ForegroundColor Cyan
Write-Host "============================" -ForegroundColor Cyan
Write-Host ""

# Check 1: Version lock exists
Write-Host "Checking workspace health..." -ForegroundColor Yellow
$lockFile = "CURRENT_VERSION.lock"
if (Test-Path $lockFile) {
    $lock = Get-Content $lockFile | ConvertFrom-Json
    Write-Host "  OK Version: $($lock.version)" -ForegroundColor Green
    Write-Host "  OK Status: $($lock.status)" -ForegroundColor $(if ($lock.status -eq "WORKING") { "Green" } else { "Yellow" })
    Write-Host "  OK Last verified: $($lock.lastVerified)" -ForegroundColor Gray
} else {
    Write-Host "  WARNING No version lock file found" -ForegroundColor Yellow
    Write-Host "     Creating initial version lock..." -ForegroundColor Gray

    $lock = @{
        version = "1.7.0"
        status = "UNKNOWN"
        lastVerified = (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss') + 'Z'
        lastBackup = ""
        buildHash = "unknown"
        architecture = "x64"
        platform = "win32"
        buildTimestamp = ""
        verificationTests = @{
            appLaunches = $false
            mainProcessCompiled = $false
            rendererProcessCompiled = $false
            sharedTypesCompiled = $false
            packagedCorrectly = $false
        }
        autoBackupCount = 0
        maxAutoBackups = 10
        workspaceHealth = "UNKNOWN"
        lastHealthCheck = (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss') + 'Z'
        notes = "Initial version lock created on workspace startup"
    }

    $lock | ConvertTo-Json | Out-File $lockFile
    Write-Host "     OK Version lock created" -ForegroundColor Green
}

Write-Host ""

# Check 2: Duplicate build folders
Write-Host "Checking for duplicate build folders..." -ForegroundColor Yellow
$duplicates = @()
if (Test-Path "release") { $duplicates += "release/" }
if (Test-Path "desktop-export") { $duplicates += "desktop-export/" }
if (Test-Path "build") { $duplicates += "build/" }

if ($duplicates.Count -gt 0) {
    Write-Host "  WARNING Found duplicate build folders:" -ForegroundColor Yellow
    $duplicates | ForEach-Object { Write-Host "     - $_" -ForegroundColor Gray }
    Write-Host "     Consider running: npm run clean" -ForegroundColor Gray
} else {
    Write-Host "  OK No duplicate build folders" -ForegroundColor Green
}

Write-Host ""

# Check 3: Current build exists
Write-Host "Checking current build..." -ForegroundColor Yellow
if (Test-Path "build-output/win-unpacked/ProduTime.exe") {
    $exeSize = (Get-Item "build-output/win-unpacked/ProduTime.exe").Length / 1MB
    Write-Host "  OK Build exists ($([math]::Round($exeSize, 1)) MB)" -ForegroundColor Green

    # Quick validation
    $hasMain = Test-Path "build-output/win-unpacked/resources/app/dist/main"
    $hasRenderer = Test-Path "build-output/win-unpacked/resources/app/dist/renderer"
    $hasShared = Test-Path "build-output/win-unpacked/resources/app/dist/shared"

    if ($hasMain -and $hasRenderer -and $hasShared) {
        Write-Host "  OK Build appears complete (main, renderer, shared present)" -ForegroundColor Green
    } else {
        Write-Host "  WARNING Build may be incomplete:" -ForegroundColor Yellow
        if (-not $hasMain) { Write-Host "     - Missing dist/main" -ForegroundColor Red }
        if (-not $hasRenderer) { Write-Host "     - Missing dist/renderer" -ForegroundColor Red }
        if (-not $hasShared) { Write-Host "     - Missing dist/shared" -ForegroundColor Red }
        Write-Host "     Consider running: npm run build:safe" -ForegroundColor Gray
    }
} else {
    Write-Host "  WARNING No build found" -ForegroundColor Yellow
    Write-Host "     Run 'npm run build:safe' to create a build" -ForegroundColor Gray
}

Write-Host ""

# Check 4: Protected backups
Write-Host "Checking backups..." -ForegroundColor Yellow
if (Test-Path "PROTECTED_BACKUPS") {
    $backups = Get-ChildItem "PROTECTED_BACKUPS" -Directory
    $autoBackups = $backups | Where-Object { $_.Name -like "*-AUTO-*" }
    $manualBackups = $backups | Where-Object { $_.Name -notlike "*-AUTO-*" }

    Write-Host "  OK Total backups: $($backups.Count)" -ForegroundColor Green
    Write-Host "     - Manual/Golden: $($manualBackups.Count)" -ForegroundColor Gray
    Write-Host "     - Automatic: $($autoBackups.Count)" -ForegroundColor Gray
} else {
    Write-Host "  WARNING No backups directory found" -ForegroundColor Yellow
}

Write-Host ""

# Check 5: Master AI Instructions
Write-Host "Checking Master AI instructions..." -ForegroundColor Yellow
if (Test-Path "MASTER_AI_INSTRUCTIONS.md") {
    Write-Host "  OK MASTER_AI_INSTRUCTIONS.md present" -ForegroundColor Green
} else {
    Write-Host "  WARNING MASTER_AI_INSTRUCTIONS.md missing" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "============================" -ForegroundColor Cyan
Write-Host "Quick Commands:" -ForegroundColor Cyan
Write-Host "  npm run build:safe   - Safe build with auto-backup and validation" -ForegroundColor Gray
Write-Host "  npm start            - Run the current build" -ForegroundColor Gray
Write-Host "  npm run status       - Check current version status" -ForegroundColor Gray
Write-Host "  npm run panic:restore - Restore last working version" -ForegroundColor Gray
Write-Host "============================" -ForegroundColor Cyan
Write-Host ""

# Run workspace cleanup (non-fatal)
Write-Host "Running workspace cleanup..." -ForegroundColor Yellow
try {
    & "$PSScriptRoot/auto-cleanup-workspace.ps1"
} catch {
    Write-Host "WARNING: Workspace cleanup encountered issues" -ForegroundColor Yellow
}


# Update health check timestamp
if (Test-Path $lockFile) {
    $lock = Get-Content $lockFile | ConvertFrom-Json
    $timestamp = (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss') + 'Z'
    $lock.lastHealthCheck = $timestamp
    $lock | ConvertTo-Json | Out-File $lockFile
}

exit 0
