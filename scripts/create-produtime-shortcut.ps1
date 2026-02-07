# Create Desktop Shortcut for ProduTime

$WshShell = New-Object -ComObject WScript.Shell
$DesktopPath = [System.Environment]::GetFolderPath('Desktop')
$ShortcutPath = Join-Path $DesktopPath "ProduTime 1.6.8.lnk"
$TargetPath = Join-Path $DesktopPath "ProduTime 1.6.8\ProduTime.exe"

$Shortcut = $WshShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = $TargetPath
$Shortcut.WorkingDirectory = Join-Path $DesktopPath "ProduTime 1.6.8"
$Shortcut.Description = "ProduTime 1.6.8 - VPS Connected"
$Shortcut.Save()

Write-Host "Shortcut created successfully!" -ForegroundColor Green
Write-Host "Location: $ShortcutPath" -ForegroundColor Cyan

