# ============================================================================
# POST-BUILD CLEANUP (SIMPLE)
# ============================================================================
# This script cleans up the workspace after a successful build.
# It is intentionally simple and avoids complex control flow so it is robust
# on all PowerShell versions.
# ============================================================================

$ErrorActionPreference = 'Continue'

Write-Host "" 
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  POST-BUILD CLEANUP" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "" 

# 1. Remove temporary files
$cleanedCount = 0

$tempPatterns = @(
    "*.tmp",
    "*.cache",
    "npm-debug.log*",
    "yarn-debug.log*",
    "yarn-error.log*"
)

foreach ($pattern in $tempPatterns) {
    $files = Get-ChildItem -Path . -Filter $pattern -Recurse -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -notmatch "node_modules" -and $_.FullName -notmatch "PROTECTED_BACKUPS" }

    foreach ($file in $files) {
        $path = $file.FullName
        Remove-Item $path -Force -ErrorAction SilentlyContinue
        if (-not (Test-Path $path)) {
            $cleanedCount++
        }
    }
}

Write-Host "   Removed $cleanedCount temporary files" -ForegroundColor Gray
Write-Host "" 

# 2. Clean up .build-tmp directory
if (Test-Path ".build-tmp") {
    Write-Host "Cleaning .build-tmp directory..." -ForegroundColor Yellow
    Remove-Item -Path ".build-tmp" -Recurse -Force -ErrorAction SilentlyContinue
}

# 3. Clean up old archives (keep last 10)
if (Test-Path "archive") {
    Write-Host "Organizing archive directory..." -ForegroundColor Yellow

    $archives = Get-ChildItem "archive" -Directory -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending

    if ($archives.Count -gt 10) {
        $oldArchives = $archives | Select-Object -Skip 10
        foreach ($old in $oldArchives) {
            $oldPath = $old.FullName
            Remove-Item $oldPath -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

# 4. Remove source maps from production build (optional security measure)
if (Test-Path "dist\renderer") {
    Write-Host "Removing source maps from production..." -ForegroundColor Yellow

    $sourceMaps = Get-ChildItem "dist\renderer" -Filter "*.map" -Recurse -ErrorAction SilentlyContinue

    foreach ($map in $sourceMaps) {
        Remove-Item $map.FullName -Force -ErrorAction SilentlyContinue
    }
}

# 5. Display workspace status
Write-Host "Workspace Status:" -ForegroundColor Cyan
Write-Host "" 

if (Test-Path "release\win-unpacked\ProduTime.exe") {
    $buildSizeBytes = (Get-ChildItem -Path "release\win-unpacked" -Recurse | Measure-Object -Property Length -Sum).Sum
    $buildSizeMB = [math]::Round($buildSizeBytes / 1MB, 2)
    Write-Host "   Build: release\win-unpacked\ProduTime.exe" -ForegroundColor Green
    Write-Host "      Size: $buildSizeMB MB" -ForegroundColor Gray
}

$backupCount = 0
if (Test-Path "PROTECTED_BACKUPS") {
    $backupCount = (Get-ChildItem "PROTECTED_BACKUPS" -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -like "ProduTime-*" }).Count
}

Write-Host "   Backups: $backupCount versions in PROTECTED_BACKUPS" -ForegroundColor Cyan
Write-Host "" 
Write-Host "Cleanup complete!" -ForegroundColor Green
Write-Host "" 
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "" 

