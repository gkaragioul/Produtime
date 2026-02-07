$ErrorActionPreference = 'Stop'

$root = Get-Location
$docsRoot = Join-Path $root 'docs-root'
$guidesDir = Join-Path $docsRoot 'GUIDES'
$docsRootRoot = Join-Path $docsRoot '_root'
$archiveDir = Join-Path $root 'archive'
$archiveBackups = Join-Path $archiveDir 'backups'
$scriptsDir = Join-Path $root 'scripts'

Write-Host "Tidying project root from: $root" -ForegroundColor Cyan

# Ensure key target directories exist (without changing overall structure)
foreach ($dir in @($docsRoot, $guidesDir, $docsRootRoot, $archiveDir, $archiveBackups, $scriptsDir)) {
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir | Out-Null
        Write-Host "Created directory: $dir" -ForegroundColor Yellow
    }
}

# 1) Move AI bootstrap checklist into docs-root/GUIDES
$bootstrapSrc = Join-Path $root 'AI_PROJECT_BOOTSTRAP_CHECKLIST.md'
if (Test-Path $bootstrapSrc) {
    $bootstrapDest = Join-Path $guidesDir 'AI_PROJECT_BOOTSTRAP_CHECKLIST.md'
    Move-Item -Path $bootstrapSrc -Destination $bootstrapDest -Force
    Write-Host "Moved AI_PROJECT_BOOTSTRAP_CHECKLIST.md -> $bootstrapDest" -ForegroundColor Green
}

# 2) Move ROBUSTNESS_SYSTEM.md into docs-root/archive (legacy documentation)
$robustnessSrc = Join-Path $root 'ROBUSTNESS_SYSTEM.md'
$docsArchiveDir = Join-Path $docsRoot 'archive'
if (Test-Path $robustnessSrc) {
    if (-not (Test-Path $docsArchiveDir)) {
        New-Item -ItemType Directory -Path $docsArchiveDir | Out-Null
        Write-Host "Created directory: $docsArchiveDir" -ForegroundColor Yellow
    }
    $robustnessDest = Join-Path $docsArchiveDir 'ROBUSTNESS_SYSTEM.md'
    Move-Item -Path $robustnessSrc -Destination $robustnessDest -Force
    Write-Host "Moved ROBUSTNESS_SYSTEM.md -> $robustnessDest" -ForegroundColor Green
}

# 3) Move root-level locked-folder helper BAT files into scripts/
$deleteLocked = Join-Path $root 'DELETE_LOCKED_FOLDERS.bat'
$removeLocked = Join-Path $root 'REMOVE_LOCKED_FOLDERS.bat'
if (Test-Path $deleteLocked) {
    $dest = Join-Path $scriptsDir 'DELETE_LOCKED_FOLDERS.bat'
    Move-Item -Path $deleteLocked -Destination $dest -Force
    Write-Host "Moved DELETE_LOCKED_FOLDERS.bat -> $dest" -ForegroundColor Green
}
if (Test-Path $removeLocked) {
    $dest = Join-Path $scriptsDir 'REMOVE_LOCKED_FOLDERS.bat'
    Move-Item -Path $removeLocked -Destination $dest -Force
    Write-Host "Moved REMOVE_LOCKED_FOLDERS.bat -> $dest" -ForegroundColor Green
}

# 4) Move stray %D% folder into archive as a historical artifact
$dDir = Join-Path $root '%D%'
if (Test-Path $dDir) {
    $dDest = Join-Path $archiveDir '%D%_MOVED_2025-11-17'
    Move-Item -LiteralPath $dDir -Destination $dDest -Force
    Write-Host "Moved %D% -> $dDest" -ForegroundColor Green
}

# 5) Move old src backup into archive/backups
$srcBackup = Join-Path $root 'src.backup.2025-11-16_19-05-17'
if (Test-Path $srcBackup) {
    $srcBackupDest = Join-Path $archiveBackups 'src.backup.2025-11-16_19-05-17'
    Move-Item -Path $srcBackup -Destination $srcBackupDest -Force
    Write-Host "Moved src.backup.2025-11-16_19-05-17 -> $srcBackupDest" -ForegroundColor Green
}

Write-Host "Root tidy complete. MASTER_AI_INSTRUCTIONS.md and core build artifacts left in place." -ForegroundColor Cyan

