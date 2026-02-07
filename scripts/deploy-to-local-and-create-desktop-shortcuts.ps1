# Deploy apps to LOCAL Windows paths and create Desktop shortcuts
# This is the ONLY way to run Electron apps with native modules in Parallels
$ErrorActionPreference = 'Stop'

Write-Host "=== Deploying Apps to Local Windows Paths ===" -ForegroundColor Cyan
Write-Host "Native modules cannot load from Parallels shared folders." -ForegroundColor Yellow
Write-Host "Solution: Apps run from local paths, shortcuts on Desktop.`n" -ForegroundColor Yellow

$username = $env:USERNAME
$desktop = [Environment]::GetFolderPath("Desktop")

# Source folders (existing working installations)
$ptSrc = "C:\Users\$username\Documents\PT-1.6.9-x64"
$lmSrc = "C:\Users\$username\Documents\PT-LicenseManager-Test"

# Verify sources exist
if (-not (Test-Path $ptSrc)) {
  Write-Host "ERROR: ProduTime source not found: $ptSrc" -ForegroundColor Red
  exit 1
}
if (-not (Test-Path $lmSrc)) {
  Write-Host "ERROR: License Manager source not found: $lmSrc" -ForegroundColor Red
  exit 1
}

Write-Host "OK ProduTime source: $ptSrc" -ForegroundColor Green
Write-Host "OK License Manager source: $lmSrc`n" -ForegroundColor Green

# === Create Desktop Shortcuts ===

Write-Host "Creating Desktop shortcuts..." -ForegroundColor Yellow

# ProduTime shortcut
$ptExe = Join-Path $ptSrc "ProduTime.exe"
$ptShortcut = Join-Path $desktop "ProduTime.lnk"
$ptArgs = "--no-sandbox --disable-gpu"

$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut($ptShortcut)
$Shortcut.TargetPath = $ptExe
$Shortcut.Arguments = $ptArgs
$Shortcut.WorkingDirectory = $ptSrc
$Shortcut.Description = "ProduTime Time Tracker"
$Shortcut.Save()

Write-Host "OK Created: ProduTime.lnk" -ForegroundColor Green

# License Manager shortcut
$lmExe = Join-Path $lmSrc "ProduTime License Manager.exe"
$lmShortcut = Join-Path $desktop "ProduTime License Manager.lnk"
$lmArgs = "--no-sandbox --disable-gpu"

$Shortcut = $WshShell.CreateShortcut($lmShortcut)
$Shortcut.TargetPath = $lmExe
$Shortcut.Arguments = $lmArgs
$Shortcut.WorkingDirectory = $lmSrc
$Shortcut.Description = "ProduTime License Manager"
$Shortcut.Save()

Write-Host "OK Created: ProduTime License Manager.lnk`n" -ForegroundColor Green

# === Summary ===

Write-Host "=== Deployment Complete ===" -ForegroundColor Cyan
Write-Host "`nDesktop shortcuts created:" -ForegroundColor Green
Write-Host "  - ProduTime.lnk" -ForegroundColor White
Write-Host "  - ProduTime License Manager.lnk" -ForegroundColor White
Write-Host "`nThese shortcuts point to LOCAL Windows paths:" -ForegroundColor Yellow
Write-Host "  - $ptSrc" -ForegroundColor Gray
Write-Host "  - $lmSrc" -ForegroundColor Gray
Write-Host "`nBoth shortcuts include --no-sandbox flag for Parallels compatibility." -ForegroundColor DarkGray
Write-Host "`nTo launch: Double-click the shortcuts on your Desktop!" -ForegroundColor Cyan

