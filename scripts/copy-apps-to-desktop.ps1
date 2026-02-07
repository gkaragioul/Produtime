# LEGACY SCRIPT - DO NOT USE
# This export script has been superseded by the safe packaging commands.
Write-Host 'LEGACY SCRIPT - DO NOT USE' -ForegroundColor Red
Write-Host 'This script is kept for historical reference only.' -ForegroundColor Yellow
Write-Host 'Use the safe commands instead:' -ForegroundColor Yellow
Write-Host '  - npm run package:produtime' -ForegroundColor Yellow
Write-Host '  - npm run package:license-manager' -ForegroundColor Yellow
exit 1


# Copy ProduTime and License Manager to Desktop as portable folders
$ErrorActionPreference = 'Stop'

$desktop = [Environment]::GetFolderPath("Desktop")
Write-Host "=== Exporting Apps to Desktop ===" -ForegroundColor Cyan
Write-Host "Desktop: $desktop`n"

# ProduTime
$ptSrc = "C:\Users\$env:USERNAME\Documents\PT-1.6.9-x64"
$ptDest = Join-Path $desktop "ProduTime-1.6.9-Portable"

if (Test-Path $ptSrc) {
  Write-Host "Copying ProduTime..." -ForegroundColor Yellow
  if (Test-Path $ptDest) {
    Remove-Item -Path $ptDest -Recurse -Force
  }
  Copy-Item -Path $ptSrc -Destination $ptDest -Recurse -Force
  $ptSize = [math]::Round((Get-ChildItem $ptDest -Recurse -File | Measure-Object -Property Length -Sum).Sum / 1MB, 2)
  Write-Host "  ProduTime exported: $ptDest ($ptSize MB)" -ForegroundColor Green
} else {
  Write-Host "  ProduTime source not found: $ptSrc" -ForegroundColor Red
}

# License Manager
$lmSrc = "C:\Users\$env:USERNAME\Documents\PT-LicenseManager-Test"
$lmDest = Join-Path $desktop "ProduTime-LicenseManager-Portable"

if (Test-Path $lmSrc) {
  Write-Host "`nCopying License Manager..." -ForegroundColor Yellow
  if (Test-Path $lmDest) {
    Remove-Item -Path $lmDest -Recurse -Force
  }
  Copy-Item -Path $lmSrc -Destination $lmDest -Recurse -Force
  $lmSize = [math]::Round((Get-ChildItem $lmDest -Recurse -File | Measure-Object -Property Length -Sum).Sum / 1MB, 2)
  Write-Host "  License Manager exported: $lmDest ($lmSize MB)" -ForegroundColor Green
} else {
  Write-Host "  License Manager source not found: $lmSrc" -ForegroundColor Red
}

Write-Host "`nDone! Both apps exported to Desktop." -ForegroundColor Cyan
Write-Host "Note: Running apps from network/shared Desktop may crash on some VMs." -ForegroundColor DarkYellow
Write-Host "If that happens, copy to a local folder first." -ForegroundColor DarkYellow
