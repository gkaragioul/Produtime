# Save ProduTime Logo to Assets Folder
# This script helps you save the ProduTime logo to the correct location

param(
    [string]$SourcePath = ""
)

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  ProduTime Logo Setup for Version 1.6.9" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# Get the workspace root (parent of scripts folder)
$WorkspaceRoot = Split-Path -Parent $PSScriptRoot
$AssetsFolder = Join-Path $WorkspaceRoot "assets"

# Ensure assets folder exists
if (-not (Test-Path $AssetsFolder)) {
    New-Item -ItemType Directory -Path $AssetsFolder -Force | Out-Null
    Write-Host "✓ Created assets folder" -ForegroundColor Green
}

# If no source path provided, prompt user
if ([string]::IsNullOrWhiteSpace($SourcePath)) {
    Write-Host "Please provide the path to the ProduTime logo PNG file:" -ForegroundColor Yellow
    Write-Host "(The logo should be the one with transparent background)" -ForegroundColor Gray
    Write-Host ""
    
    # Check common locations
    $DesktopLogo = Join-Path $env:USERPROFILE "Desktop\produtime-logo.png"
    $DownloadsLogo = Join-Path $env:USERPROFILE "Downloads\produtime-logo.png"
    
    if (Test-Path $DesktopLogo) {
        Write-Host "Found logo on Desktop: $DesktopLogo" -ForegroundColor Green
        $UseDesktop = Read-Host "Use this file? (Y/N)"
        if ($UseDesktop -eq "Y" -or $UseDesktop -eq "y") {
            $SourcePath = $DesktopLogo
        }
    }
    
    if ([string]::IsNullOrWhiteSpace($SourcePath) -and (Test-Path $DownloadsLogo)) {
        Write-Host "Found logo in Downloads: $DownloadsLogo" -ForegroundColor Green
        $UseDownloads = Read-Host "Use this file? (Y/N)"
        if ($UseDownloads -eq "Y" -or $UseDownloads -eq "y") {
            $SourcePath = $DownloadsLogo
        }
    }
    
    if ([string]::IsNullOrWhiteSpace($SourcePath)) {
        $SourcePath = Read-Host "Enter full path to logo PNG file"
    }
}

# Validate source file
if (-not (Test-Path $SourcePath)) {
    Write-Host "✗ Error: File not found: $SourcePath" -ForegroundColor Red
    exit 1
}

if (-not ($SourcePath -match '\.png$')) {
    Write-Host "⚠ Warning: File is not a PNG. ProduTime logo should be PNG with transparent background." -ForegroundColor Yellow
    $Continue = Read-Host "Continue anyway? (Y/N)"
    if ($Continue -ne "Y" -and $Continue -ne "y") {
        exit 0
    }
}

# Copy to assets folder
$DestPath = Join-Path $AssetsFolder "icon.png"

try {
    Copy-Item -Path $SourcePath -Destination $DestPath -Force
    Write-Host ""
    Write-Host "✓ Logo saved to: $DestPath" -ForegroundColor Green
    Write-Host ""
    
    # Check file size
    $FileInfo = Get-Item $DestPath
    $FileSizeKB = [math]::Round($FileInfo.Length / 1KB, 2)
    Write-Host "  File size: $FileSizeKB KB" -ForegroundColor Gray
    
    # Try to get image dimensions using .NET
    try {
        Add-Type -AssemblyName System.Drawing
        $Image = [System.Drawing.Image]::FromFile($DestPath)
        $Width = $Image.Width
        $Height = $Image.Height
        $Image.Dispose()
        
        Write-Host "  Dimensions: ${Width}x${Height} pixels" -ForegroundColor Gray
        
        if ($Width -lt 256 -or $Height -lt 256) {
            Write-Host ""
            Write-Host "⚠ Warning: Image is smaller than recommended 256x256 pixels" -ForegroundColor Yellow
            Write-Host "  For best quality, use a larger image (512x512 or higher)" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "  (Could not determine image dimensions)" -ForegroundColor Gray
    }
    
    Write-Host ""
    Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host "  Next Steps:" -ForegroundColor Cyan
    Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "1. Convert icon.png to icon.ico for Windows:" -ForegroundColor White
    Write-Host "   - Go to: https://www.icoconverter.com/" -ForegroundColor Gray
    Write-Host "   - Upload: $DestPath" -ForegroundColor Gray
    Write-Host "   - Select multi-size ICO (16, 32, 48, 64, 128, 256)" -ForegroundColor Gray
    Write-Host "   - Download and save as: $(Join-Path $AssetsFolder 'icon.ico')" -ForegroundColor Gray
    Write-Host ""
    Write-Host "2. (Optional) Convert to icon.icns for macOS" -ForegroundColor White
    Write-Host ""
    Write-Host "3. Build ProduTime 1.6.9:" -ForegroundColor White
    Write-Host "   npm run build" -ForegroundColor Gray
    Write-Host ""
    
} catch {
    Write-Host "✗ Error copying file: $_" -ForegroundColor Red
    exit 1
}

