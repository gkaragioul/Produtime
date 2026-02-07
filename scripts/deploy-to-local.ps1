# Deploy built apps to local Windows test folders
# This script copies the compiled code from the Parallels shared folder to local Windows paths
# to avoid Electron crashes caused by running from network shares

$ErrorActionPreference = 'Stop'

Write-Host "=== ProduTime & License Manager - Deploy to Local Test Folders ===" -ForegroundColor Cyan
Write-Host ""

# Define paths
$workspaceRoot = Split-Path -Parent $PSScriptRoot
$produtimeSource = Join-Path $workspaceRoot "desktop-export\win-unpacked"
$licenseManagerSource = Join-Path $workspaceRoot "license-manager\release-vps\win-unpacked"

$produtimeTarget = "C:\Users\$env:USERNAME\Documents\PT-Test"
$licenseManagerTarget = "C:\Users\$env:USERNAME\Documents\PT-LicenseManager-Test"

# Function to deploy an app
function Deploy-App {
    param(
        [string]$AppName,
        [string]$SourcePath,
        [string]$TargetPath
    )
    
    Write-Host "Deploying $AppName..." -ForegroundColor Yellow
    
    if (-not (Test-Path $SourcePath)) {
        Write-Host "  ❌ Source not found: $SourcePath" -ForegroundColor Red
        Write-Host "  Run 'npm run dist:x64' first to build the app" -ForegroundColor Red
        return $false
    }
    
    # Create target directory if it doesn't exist
    if (-not (Test-Path $TargetPath)) {
        Write-Host "  Creating target directory: $TargetPath" -ForegroundColor Gray
        New-Item -ItemType Directory -Path $TargetPath -Force | Out-Null
    }
    
    # Copy files
    Write-Host "  Copying files from:" -ForegroundColor Gray
    Write-Host "    $SourcePath" -ForegroundColor Gray
    Write-Host "  To:" -ForegroundColor Gray
    Write-Host "    $TargetPath" -ForegroundColor Gray
    
    try {
        # Remove old files
        if (Test-Path $TargetPath) {
            Get-ChildItem -Path $TargetPath -Recurse | Remove-Item -Force -Recurse -ErrorAction SilentlyContinue
        }
        
        # Copy new files
        Copy-Item -Path "$SourcePath\*" -Destination $TargetPath -Recurse -Force
        
        Write-Host "  ✅ $AppName deployed successfully" -ForegroundColor Green
        Write-Host "  Location: $TargetPath" -ForegroundColor Gray
        return $true
    }
    catch {
        Write-Host "  ❌ Failed to deploy $AppName" -ForegroundColor Red
        Write-Host "  Error: $_" -ForegroundColor Red
        return $false
    }
}

# Deploy ProduTime
Write-Host ""
$produtimeSuccess = Deploy-App -AppName "ProduTime" -SourcePath $produtimeSource -TargetPath $produtimeTarget

# Deploy License Manager
Write-Host ""
$licenseManagerSuccess = Deploy-App -AppName "License Manager" -SourcePath $licenseManagerSource -TargetPath $licenseManagerTarget

# Summary
Write-Host ""
Write-Host "=== Deployment Summary ===" -ForegroundColor Cyan
if ($produtimeSuccess) {
    Write-Host "  ✅ ProduTime: $produtimeTarget" -ForegroundColor Green
} else {
    Write-Host "  ❌ ProduTime: Failed" -ForegroundColor Red
}

if ($licenseManagerSuccess) {
    Write-Host "  ✅ License Manager: $licenseManagerTarget" -ForegroundColor Green
} else {
    Write-Host "  ❌ License Manager: Failed" -ForegroundColor Red
}

Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  - Run 'npm run test:produtime' to launch ProduTime with logging" -ForegroundColor Gray
Write-Host "  - Run 'npm run test:license-manager' to launch License Manager with logging" -ForegroundColor Gray
Write-Host ""

