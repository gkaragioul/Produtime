# Find where the apps were exported
$ErrorActionPreference = 'Continue'

Write-Host "=== Finding Desktop Apps ===" -ForegroundColor Cyan

# Try different Desktop paths
$desktopPaths = @(
  [Environment]::GetFolderPath("Desktop"),
  "C:\Mac\Home\Desktop",
  "$env:USERPROFILE\Desktop",
  "C:\Users\$env:USERNAME\Desktop"
)

foreach ($path in $desktopPaths) {
  Write-Host "`nChecking: $path" -ForegroundColor Yellow
  if (Test-Path $path) {
    Write-Host "  EXISTS" -ForegroundColor Green
    $items = Get-ChildItem $path -ErrorAction SilentlyContinue
    if ($items) {
      $items | Select-Object Name,Length | Format-Table -Auto
    } else {
      Write-Host "  (empty or no access)" -ForegroundColor Gray
    }
  } else {
    Write-Host "  NOT FOUND" -ForegroundColor Red
  }
}

# Check if apps exist in Documents
Write-Host "`n=== Checking Documents Folder ===" -ForegroundColor Cyan
$docsPT = "C:\Users\$env:USERNAME\Documents\PT-1.6.9-x64"
$docsLM = "C:\Users\$env:USERNAME\Documents\PT-LicenseManager-Test"

if (Test-Path $docsPT) {
  Write-Host "ProduTime found: $docsPT" -ForegroundColor Green
} else {
  Write-Host "ProduTime NOT found: $docsPT" -ForegroundColor Red
}

if (Test-Path $docsLM) {
  Write-Host "License Manager found: $docsLM" -ForegroundColor Green
} else {
  Write-Host "License Manager NOT found: $docsLM" -ForegroundColor Red
}

