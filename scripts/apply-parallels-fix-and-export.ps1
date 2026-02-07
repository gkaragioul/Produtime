# Apply Parallels --no-sandbox fix to both apps and export to Desktop
$ErrorActionPreference = 'Stop'

Write-Host "=== Applying Parallels Fix and Exporting to Desktop ===" -ForegroundColor Cyan

$desktop = [Environment]::GetFolderPath("Desktop")
$username = $env:USERNAME

# Source folders
$ptSrc = "C:\Users\$username\Documents\PT-1.6.9-x64"
$lmSrc = "C:\Users\$username\Documents\PT-LicenseManager-Test"

# Destination folders on Desktop
$ptDest = Join-Path $desktop "ProduTime-1.6.9-Portable"
$lmDest = Join-Path $desktop "ProduTime-LicenseManager-Portable"

# === ProduTime ===
if (Test-Path $ptSrc) {
  Write-Host "`n1. Copying ProduTime to Desktop..." -ForegroundColor Yellow
  if (Test-Path $ptDest) {
    Remove-Item -Path $ptDest -Recurse -Force
  }
  Copy-Item -Path $ptSrc -Destination $ptDest -Recurse -Force
  
  # Create launcher with --no-sandbox fix
  $ptLauncher = Join-Path $ptDest "Start-ProduTime-Parallels.vbs"
  $ptLauncherContent = @"
Option Explicit
' ProduTime launcher with Parallels/Network Share compatibility
' Adds --no-sandbox flag (required for Electron apps on network shares)
' See: https://github.com/electron/electron/issues/27356

Dim shell, fso, exe, scriptDir
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' Get the directory where this script is located
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
exe = fso.BuildPath(scriptDir, "ProduTime.exe")

If fso.FileExists(exe) Then
  ' 1 = normal window, False = do not wait
  ' --no-sandbox is REQUIRED for network/Parallels shared folders
  shell.Run """" & exe & """ --no-sandbox --disable-gpu --disable-gpu-sandbox", 1, False
Else
  shell.Popup "ProduTime.exe not found at:" & vbCrLf & exe, 6, "ProduTime launcher", 48
End If
"@
  Set-Content -Path $ptLauncher -Value $ptLauncherContent -Encoding ASCII
  
  $ptSize = [math]::Round((Get-ChildItem $ptDest -Recurse -File | Measure-Object -Property Length -Sum).Sum / 1MB, 2)
  Write-Host "  ProduTime exported: $ptDest ($ptSize MB)" -ForegroundColor Green
  Write-Host "  Launcher created: Start-ProduTime-Parallels.vbs" -ForegroundColor Green
} else {
  Write-Host "  ProduTime source not found: $ptSrc" -ForegroundColor Red
}

# === License Manager ===
if (Test-Path $lmSrc) {
  Write-Host "`n2. Copying License Manager to Desktop..." -ForegroundColor Yellow
  if (Test-Path $lmDest) {
    Remove-Item -Path $lmDest -Recurse -Force
  }
  Copy-Item -Path $lmSrc -Destination $lmDest -Recurse -Force
  
  # Create launcher with --no-sandbox fix
  $lmLauncher = Join-Path $lmDest "Start-LicenseManager-Parallels.vbs"
  $lmLauncherContent = @"
Option Explicit
' License Manager launcher with Parallels/Network Share compatibility
' Adds --no-sandbox flag (required for Electron apps on network shares)
' See: https://github.com/electron/electron/issues/27356

Dim shell, fso, exe, scriptDir
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' Get the directory where this script is located
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
exe = fso.BuildPath(scriptDir, "ProduTime License Manager.exe")

If fso.FileExists(exe) Then
  ' 1 = normal window, False = do not wait
  ' --no-sandbox is REQUIRED for network/Parallels shared folders
  shell.Run """" & exe & """ --no-sandbox --disable-gpu", 1, False
Else
  shell.Popup "License Manager not found at:" & vbCrLf & exe, 6, "License Manager launcher", 48
End If
"@
  Set-Content -Path $lmLauncher -Value $lmLauncherContent -Encoding ASCII
  
  $lmSize = [math]::Round((Get-ChildItem $lmDest -Recurse -File | Measure-Object -Property Length -Sum).Sum / 1MB, 2)
  Write-Host "  License Manager exported: $lmDest ($lmSize MB)" -ForegroundColor Green
  Write-Host "  Launcher created: Start-LicenseManager-Parallels.vbs" -ForegroundColor Green
} else {
  Write-Host "  License Manager source not found: $lmSrc" -ForegroundColor Red
}

Write-Host "`n=== Export Complete ===" -ForegroundColor Cyan
Write-Host "Both apps are now on your Desktop with Parallels compatibility fix applied." -ForegroundColor Green
Write-Host "`nTo launch from Desktop (Parallels shared folder):" -ForegroundColor Yellow
Write-Host "  - Double-click: Start-ProduTime-Parallels.vbs" -ForegroundColor White
Write-Host "  - Double-click: Start-LicenseManager-Parallels.vbs" -ForegroundColor White
Write-Host "`nThese launchers work from ANY location (local or network/Parallels)." -ForegroundColor DarkGray

