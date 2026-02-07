# Package existing local installations for distribution
# This script packages the working local installations instead of building from source
# Use this when you have working installations and want to create distribution packages

$ErrorActionPreference = 'Stop'

Write-Host "=== Package Existing Installations for Distribution ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "This script packages your existing local installations" -ForegroundColor Yellow
Write-Host ""

# Kill any running instances to avoid file locks
Write-Host "Stopping any running ProduTime and License Manager processes..." -ForegroundColor Yellow
$produtimeProcesses = Get-Process -Name "ProduTime" -ErrorAction SilentlyContinue
$licenseManagerProcesses = Get-Process -Name "ProduTime License Manager" -ErrorAction SilentlyContinue

if ($produtimeProcesses) {
    $produtimeProcesses | Stop-Process -Force
    Write-Host "  Stopped ProduTime processes" -ForegroundColor Gray
}

if ($licenseManagerProcesses) {
    $licenseManagerProcesses | Stop-Process -Force
    Write-Host "  Stopped License Manager processes" -ForegroundColor Gray
}

if ($produtimeProcesses -or $licenseManagerProcesses) {
    Write-Host "  Waiting for processes to fully terminate..." -ForegroundColor Gray
    Start-Sleep -Seconds 3
}

Write-Host ""

# Define paths
$desktopPath = [Environment]::GetFolderPath("Desktop")

$produtimeSource = "C:\Users\$env:USERNAME\Documents\PT-1.7.0-x64"
$licenseManagerSource = "C:\Users\$env:USERNAME\Documents\PT-LicenseManager-x64"

$produtimeZip = Join-Path $desktopPath "ProduTime-v1.7.0-x64-Portable.zip"
$licenseManagerZip = Join-Path $desktopPath "ProduTime-LicenseManager-x64-Portable.zip"

# Function to create a distribution package
function Package-App {
    param(
        [string]$AppName,
        [string]$SourcePath,
        [string]$ZipPath
    )

    Write-Host "Packaging $AppName..." -ForegroundColor Yellow

    if (-not (Test-Path $SourcePath)) {
        Write-Host "  ❌ Source not found: $SourcePath" -ForegroundColor Red
        return $false
    }

    Write-Host "  Source: $SourcePath" -ForegroundColor Gray
    Write-Host "  Output: $ZipPath" -ForegroundColor Gray

    try {
        # Remove old zip if it exists
        if (Test-Path $ZipPath) {
            Write-Host "  Removing old package..." -ForegroundColor Gray
            Remove-Item $ZipPath -Force
        }

        # Create zip archive
        Write-Host "  Creating zip archive..." -ForegroundColor Gray
        Compress-Archive -Path "$SourcePath\*" -DestinationPath $ZipPath -CompressionLevel Optimal

        # Get file size
        $zipSize = (Get-Item $ZipPath).Length / 1MB
        $zipSizeFormatted = "{0:N2} MB" -f $zipSize

        Write-Host "  ✅ Package created successfully" -ForegroundColor Green
        Write-Host "  Size: $zipSizeFormatted" -ForegroundColor Gray
        Write-Host "  Location: $ZipPath" -ForegroundColor Gray
        return $true
    }
    catch {
        Write-Host "  ❌ Failed to package $AppName" -ForegroundColor Red
        Write-Host "  Error: $_" -ForegroundColor Red
        return $false
    }
}

# Package ProduTime
Write-Host ""
$produtimeSuccess = Package-App -AppName "ProduTime" -SourcePath $produtimeSource -ZipPath $produtimeZip

# Package License Manager
Write-Host ""
$licenseManagerSuccess = Package-App -AppName "License Manager" -SourcePath $licenseManagerSource -ZipPath $licenseManagerZip

# Summary
Write-Host ""
Write-Host "=== Packaging Summary ===" -ForegroundColor Cyan

if ($produtimeSuccess) {
    Write-Host "  ✅ ProduTime: $produtimeZip" -ForegroundColor Green
} else {
    Write-Host "  ❌ ProduTime: Failed" -ForegroundColor Red
}

if ($licenseManagerSuccess) {
    Write-Host "  ✅ License Manager: $licenseManagerZip" -ForegroundColor Green
} else {
    Write-Host "  ❌ License Manager: Failed" -ForegroundColor Red
}

Write-Host ""

if ($produtimeSuccess -or $licenseManagerSuccess) {
    Write-Host "Distribution packages are ready on your Desktop!" -ForegroundColor Green
    Write-Host ""
    Write-Host "User Instructions:" -ForegroundColor Yellow
    Write-Host "  1. Extract the .zip to a local folder (e.g., C:\Apps or Desktop)" -ForegroundColor Gray
    Write-Host "  2. Do NOT run from network shares or cloud-synced folders" -ForegroundColor Gray
    Write-Host "  3. On first run, Windows may show SmartScreen warning" -ForegroundColor Gray
    Write-Host "     Click 'More info' → 'Run anyway'" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Supported Systems:" -ForegroundColor Yellow
    Write-Host "  - Windows x64 (native)" -ForegroundColor Gray
    Write-Host "  - Windows on ARM (via x64 emulation)" -ForegroundColor Gray
    Write-Host ""
}
