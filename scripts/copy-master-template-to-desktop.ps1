$ErrorActionPreference = 'Stop'

$root = Get-Location
$src = Join-Path $root 'MASTER_AI_INSTRUCTIONS_TEMPLATE.md'
$destDir = 'C:\Mac\Home\Desktop'

if (-not (Test-Path $src)) {
    Write-Host "ERROR: Template not found at $src" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $destDir)) {
    Write-Host "ERROR: Desktop path not found: $destDir" -ForegroundColor Red
    exit 1
}

$dest = Join-Path $destDir 'MASTER_AI_INSTRUCTIONS_TEMPLATE.md'

Copy-Item -Path $src -Destination $dest -Force

Write-Host "Template copied to desktop: $dest" -ForegroundColor Green

