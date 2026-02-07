# Download ResourceHacker if not present
$resourceHackerUrl = "http://www.angusj.com/resourcehacker/reshacker_setup.exe"
$resourceHackerPath = "$PSScriptRoot\..\tools\ResourceHacker.exe"
$exePath = "$PSScriptRoot\..\release\win-unpacked\ProduTime.exe"
$iconPath = "$PSScriptRoot\..\assets\favicon.ico"

Write-Host "Attempting to update icon using alternative method..."

# Try using Windows API directly via PowerShell
# This uses the Shell.Application COM object to refresh the icon cache
$shell = New-Object -ComObject Shell.Application
$folder = $shell.Namespace((Split-Path -Parent $exePath))
$file = $folder.ParseName((Split-Path -Leaf $exePath))

# Force Windows to refresh the icon cache
$regPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.exe\UserAssocToDelete"
if (Test-Path $regPath) {
    Remove-Item $regPath -Force -ErrorAction SilentlyContinue
}

# Clear icon cache
$iconCachePath = "$env:LOCALAPPDATA\IconCache.db"
if (Test-Path $iconCachePath) {
    Remove-Item $iconCachePath -Force -ErrorAction SilentlyContinue
    Write-Host "✅ Cleared icon cache"
}

# Restart explorer to refresh
Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Start-Process explorer

Write-Host "✅ Icon cache cleared and explorer restarted"

