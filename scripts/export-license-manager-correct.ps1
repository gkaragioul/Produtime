# LEGACY SCRIPT - DO NOT USE
# This export script has been superseded by the safe packaging commands.
Write-Host 'LEGACY SCRIPT - DO NOT USE' -ForegroundColor Red
Write-Host 'This script is kept for historical reference only.' -ForegroundColor Yellow
Write-Host 'Use the safe commands instead:' -ForegroundColor Yellow
Write-Host '  - npm run package:produtime' -ForegroundColor Yellow
Write-Host '  - npm run package:license-manager' -ForegroundColor Yellow
exit 1


$desktop = [Environment]::GetFolderPath('Desktop')
$destFolder = Join-Path $desktop 'LicenseManager-Updated'

Write-Host "Step 1: Removing old export..." -ForegroundColor Yellow
if (Test-Path $destFolder) {
    Remove-Item $destFolder -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "Step 2: Copying License Manager (latest build)..." -ForegroundColor Yellow
New-Item -ItemType Directory -Path $destFolder -Force | Out-Null
# Copy from electron-builder --dir output
Copy-Item -Path 'license-manager\release\win-unpacked\*' -Destination $destFolder -Recurse -Force

Write-Host "Step 3: Creating desktop shortcut..." -ForegroundColor Yellow
$appPath = Join-Path $destFolder 'ProduTime License Manager.exe'
$shortcutPath = Join-Path $desktop 'LicenseManager-Updated.lnk'

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $appPath
$shortcut.WorkingDirectory = $destFolder
$shortcut.Description = 'ProduTime License Manager - Updated (latest build)'
$shortcut.Save()

Write-Host ""
Write-Host "SUCCESS! Updated License Manager exported" -ForegroundColor Green
Write-Host "Folder: $destFolder" -ForegroundColor Cyan
Write-Host "Executable: ProduTime License Manager.exe" -ForegroundColor Cyan
Write-Host "Shortcut: LicenseManager-Updated.lnk" -ForegroundColor Cyan
Write-Host ""
Write-Host "Changes Included:" -ForegroundColor Green
Write-Host "  1. Name required to generate license" -ForegroundColor Cyan
Write-Host "  2. Expiry optional (empty = perpetual) + enforced on validation" -ForegroundColor Cyan
Write-Host "  3. Seat limit enforced on activation" -ForegroundColor Cyan
