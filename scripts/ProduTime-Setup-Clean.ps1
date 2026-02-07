# ProduTime 1.6.6 Clean Setup Script
# Run this on any PC to ensure a clean installation with no license

Write-Host "ProduTime 1.6.6 - Clean Setup" -ForegroundColor Cyan
Write-Host "==============================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Deep clean all ProduTime data
Write-Host "Step 1: Deep cleaning all ProduTime data..." -ForegroundColor Yellow

$appData = [Environment]::GetFolderPath('ApplicationData')
$localAppData = [Environment]::GetFolderPath('LocalApplicationData')

$dirsToRemove = @(
    (Join-Path $appData 'produtime'),
    (Join-Path $appData 'atlianflow'),
    (Join-Path $localAppData 'produtime'),
    (Join-Path $localAppData 'atlianflow')
)

foreach ($dir in $dirsToRemove) {
    if (Test-Path $dir) {
        Write-Host "  Removing: $dir" -ForegroundColor Cyan
        Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Host "  All data cleaned!" -ForegroundColor Green
Write-Host ""

# Step 2: Get the ProduTime executable location
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$exePath = Join-Path $scriptDir 'ProduTime.exe'

if (-not (Test-Path $exePath)) {
    Write-Host "ERROR: ProduTime.exe not found in $scriptDir" -ForegroundColor Red
    Write-Host "Make sure this script is in the same folder as ProduTime.exe" -ForegroundColor Red
    exit 1
}

Write-Host "Step 2: Starting ProduTime..." -ForegroundColor Yellow
Write-Host "  Executable: $exePath" -ForegroundColor Cyan
Write-Host ""

# Step 3: Launch ProduTime
Write-Host "ProduTime will now launch and request a license key" -ForegroundColor Green
Write-Host ""

& $exePath

Write-Host ""
Write-Host "Setup complete!" -ForegroundColor Green

