# 🔒 RECOVER GOLDEN VERSION 1.6.9
# This script recovers the protected GOLDEN version of ProduTime 1.6.9

param(
    [string]$Destination = "$env:USERPROFILE\Desktop\ProduTime-1.6.9"
)

Write-Host ""
Write-Host "🔒 RECOVERING GOLDEN VERSION - ProduTime 1.6.9" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

# Find the latest backup
$backupFolder = "PROTECTED_BACKUPS"
if (-not (Test-Path $backupFolder)) {
    Write-Error "❌ PROTECTED_BACKUPS folder not found!"
    Write-Host "The golden backup may have been deleted. Check archive folder." -ForegroundColor Red
    exit 1
}

$latestBackup = Get-ChildItem $backupFolder -Directory | 
    Where-Object { $_.Name -like "ProduTime-1.6.9-GOLDEN_*" } |
    Sort-Object Name -Descending | 
    Select-Object -First 1

if (-not $latestBackup) {
    Write-Error "❌ No GOLDEN backup found in PROTECTED_BACKUPS!"
    exit 1
}

Write-Host "📦 Found GOLDEN backup: $($latestBackup.Name)" -ForegroundColor Green
Write-Host "📅 Created: $($latestBackup.CreationTime)" -ForegroundColor Gray
Write-Host ""

# Ask for confirmation
Write-Host "📍 Destination: $Destination" -ForegroundColor Yellow
Write-Host ""
$confirm = Read-Host "Continue with recovery? (Y/N)"

if ($confirm -ne "Y" -and $confirm -ne "y") {
    Write-Host "❌ Recovery cancelled." -ForegroundColor Red
    exit 0
}

# Remove existing destination if it exists
if (Test-Path $Destination) {
    Write-Host "🗑️  Removing existing folder at destination..." -ForegroundColor Yellow
    Remove-Item -Path $Destination -Recurse -Force -ErrorAction SilentlyContinue
}

# Copy the backup
Write-Host "📋 Copying GOLDEN version to destination..." -ForegroundColor Cyan
Copy-Item -Path "$($latestBackup.FullName)\*" -Destination $Destination -Recurse -Force

if ($LASTEXITCODE -eq 0 -or (Test-Path "$Destination\ProduTime.exe")) {
    Write-Host ""
    Write-Host "✅ GOLDEN VERSION RECOVERED SUCCESSFULLY!" -ForegroundColor Green
    Write-Host ""
    Write-Host "📁 Location: $Destination" -ForegroundColor Cyan
    Write-Host "🚀 You can now run ProduTime.exe from this folder" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "📝 This is the production-ready version with:" -ForegroundColor Gray
    Write-Host "   ✅ Custom favicon.ico icon" -ForegroundColor Gray
    Write-Host "   ✅ Larger logo (76px)" -ForegroundColor Gray
    Write-Host "   ✅ Right-aligned tab buttons" -ForegroundColor Gray
    Write-Host "   ✅ Semi-transparent styling with backdrop blur" -ForegroundColor Gray
    Write-Host "   ✅ Fixed Windows notifications (ProduTime branding)" -ForegroundColor Gray
    Write-Host ""
} else {
    Write-Error "❌ Recovery failed!"
    exit 1
}

