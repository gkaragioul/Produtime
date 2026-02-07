$ErrorActionPreference = 'Stop'

$root = Get-Location
$src = Join-Path $root 'AI_PROJECT_BOOTSTRAP_CHECKLIST.md'
$destDir = 'C:\Mac\Home\Desktop'

if (-not (Test-Path $src)) {
    Write-Host "ERROR: Checklist not found at $src" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $destDir)) {
    Write-Host "ERROR: Desktop path not found: $destDir" -ForegroundColor Red
    exit 1
}

$dest = Join-Path $destDir 'AI_PROJECT_BOOTSTRAP_CHECKLIST.md'

Copy-Item -Path $src -Destination $dest -Force

Write-Host "Checklist copied to desktop: $dest" -ForegroundColor Green

