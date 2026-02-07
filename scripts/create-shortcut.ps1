$desktop = [Environment]::GetFolderPath('Desktop')
$appPath = Join-Path $PSScriptRoot 'desktop-export\win-unpacked\ProduTime.exe'
if (-not (Test-Path $appPath)) { $appPath = Read-Host 'Enter path to ProduTime.exe' }
$shortcutPath = Join-Path $desktop 'ProduTime.lnk'

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $appPath
$shortcut.WorkingDirectory = Split-Path $appPath
$shortcut.Description = 'ProduTime - Time Tracking Application'
$shortcut.Save()

Write-Host "Shortcut created on Desktop" -ForegroundColor Green
Write-Host "Shortcut: ProduTime.lnk" -ForegroundColor Cyan
Write-Host "App Path: $appPath" -ForegroundColor Cyan

