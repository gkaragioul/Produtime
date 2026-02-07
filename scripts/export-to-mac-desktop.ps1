# LEGACY SCRIPT - DO NOT USE
# This export script has been superseded by the safe packaging commands.
Write-Host 'LEGACY SCRIPT - DO NOT USE' -ForegroundColor Red
Write-Host 'This script is kept for historical reference only.' -ForegroundColor Yellow
Write-Host 'Use the safe commands instead:' -ForegroundColor Yellow
Write-Host '  - npm run package:produtime' -ForegroundColor Yellow
Write-Host '  - npm run package:license-manager' -ForegroundColor Yellow
exit 1


# Export ProduTime and License Manager as ZIP files to Mac Desktop (Parallels shared folder)
$ErrorActionPreference = 'Stop'

Write-Host "=== Exporting ProduTime & License Manager to Desktop ===" -ForegroundColor Cyan
Write-Host ""

# Use Mac Desktop path directly
$desktop = "C:\Mac\Home\Desktop"
Write-Host "Desktop: $desktop" -ForegroundColor Gray
Write-Host ""

# Stop any running processes
Write-Host "Stopping running processes..." -ForegroundColor Yellow
Get-Process -Name "ProduTime" -ErrorAction SilentlyContinue | Stop-Process -Force
Get-Process -Name "ProduTime License Manager" -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 3
Write-Host ""

# ProduTime
$ptSrc = "C:\Users\$env:USERNAME\Documents\PT-1.6.9-x64"
$ptZip = Join-Path $desktop "ProduTime-v1.6.9-x64-Portable.zip"

Write-Host "Packaging ProduTime..." -ForegroundColor Cyan
Write-Host "  Source: $ptSrc" -ForegroundColor Gray
Write-Host "  Output: $ptZip" -ForegroundColor Gray

if (Test-Path $ptSrc) {
    if (Test-Path $ptZip) {
        Write-Host "  Removing old ZIP..." -ForegroundColor Gray
        Remove-Item $ptZip -Force
    }

    Write-Host "  Creating ZIP archive..." -ForegroundColor Gray
    Compress-Archive -Path "$ptSrc\*" -DestinationPath $ptZip -CompressionLevel Optimal

    $ptSize = [math]::Round((Get-Item $ptZip).Length / 1MB, 2)
    Write-Host "  SUCCESS: Created $ptZip" -ForegroundColor Green
    Write-Host "  Size: $ptSize MB" -ForegroundColor Green
} else {
    Write-Host "  ERROR: Source not found: $ptSrc" -ForegroundColor Red
}

Write-Host ""

# License Manager
$lmSrc = "C:\Users\$env:USERNAME\Documents\PT-LicenseManager-Test"
$lmZip = Join-Path $desktop "ProduTime-LicenseManager-x64-Portable.zip"

Write-Host "Packaging License Manager..." -ForegroundColor Cyan
Write-Host "  Source: $lmSrc" -ForegroundColor Gray
Write-Host "  Output: $lmZip" -ForegroundColor Gray

if (Test-Path $lmSrc) {
    if (Test-Path $lmZip) {
        Write-Host "  Removing old ZIP..." -ForegroundColor Gray
        Remove-Item $lmZip -Force
    }

    Write-Host "  Creating ZIP archive..." -ForegroundColor Gray
    Compress-Archive -Path "$lmSrc\*" -DestinationPath $lmZip -CompressionLevel Optimal

    $lmSize = [math]::Round((Get-Item $lmZip).Length / 1MB, 2)
    Write-Host "  SUCCESS: Created $lmZip" -ForegroundColor Green
    Write-Host "  Size: $lmSize MB" -ForegroundColor Green
} else {
    Write-Host "  ERROR: Source not found: $lmSrc" -ForegroundColor Red
}

Write-Host ""
Write-Host "=== Export Complete ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "ZIP files created on Desktop:" -ForegroundColor Green
Write-Host "  - ProduTime-v1.6.9-x64-Portable.zip" -ForegroundColor White
Write-Host "  - ProduTime-LicenseManager-x64-Portable.zip" -ForegroundColor White
Write-Host ""
Write-Host "To distribute to other PCs:" -ForegroundColor Yellow
Write-Host "  1. Extract ZIP to a LOCAL folder (e.g., C:\Apps or Desktop)" -ForegroundColor Gray
Write-Host "  2. Do NOT run from network shares or cloud-synced folders" -ForegroundColor Gray
Write-Host "  3. Double-click the .exe to run" -ForegroundColor Gray
Write-Host ""
Write-Host "Compatibility:" -ForegroundColor Yellow
Write-Host "  - Windows x64 (Intel/AMD) - Native performance" -ForegroundColor Gray
Write-Host "  - Windows ARM64 - Via x64 emulation (works fine)" -ForegroundColor Gray
Write-Host ""
