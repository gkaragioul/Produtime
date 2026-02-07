# ============================================================================
# ProduTime - License Manager Safe Build and Package Script
# WARNING TO AI ASSISTANTS:
#   - Do NOT modify this script without explicit user approval.
#   - Use this via: npm run package:license-manager
#   - Do NOT reintroduce raw electron-builder calls in package.json
# ============================================================================

$ErrorActionPreference = 'Stop'

Write-Host '========================================='
Write-Host 'ProduTime - License Manager Safe Package' -ForegroundColor Cyan
Write-Host '========================================='
Write-Host ''

# STEP 1: Run License Manager safe build
Write-Host 'STEP 1: Running License Manager safe build...' -ForegroundColor Cyan

$lmScript = Join-Path $PSScriptRoot '..\license-manager\scripts\safe-build.ps1'

if (-not (Test-Path $lmScript)) {
    Write-Host ('ERROR: License Manager safe-build script not found at ' + $lmScript) -ForegroundColor Red
    exit 1
}

& $lmScript
if ($LASTEXITCODE -ne 0) {
    Write-Host 'ERROR: License Manager safe build failed. Aborting packaging.' -ForegroundColor Red
    exit 1
}

# STEP 2: Package to desktop zip
Write-Host 'STEP 2: Packaging License Manager portable zip...' -ForegroundColor Cyan

$src = 'license-manager\release-vps\win-unpacked'
if (-not (Test-Path $src)) {
    Write-Host ('ERROR: Expected folder not found after safe build: ' + $src) -ForegroundColor Red
    exit 1
}

$desktop = [Environment]::GetFolderPath('Desktop')
$dest = Join-Path $desktop 'ProduTime-LicenseManager-x64-Portable.zip'

if (Test-Path $dest) {
    Remove-Item -Path $dest -Force
}

Compress-Archive -Path (Join-Path $src '*') -DestinationPath $dest -CompressionLevel Optimal

Write-Host 'License Manager package created:' -ForegroundColor Green
Write-Host ('  ' + $dest) -ForegroundColor Gray
Write-Host ''
Write-Host 'License Manager safe build and packaging completed successfully.' -ForegroundColor Green

exit 0

