$desktop = [Environment]::GetFolderPath('Desktop')
$destFolder = Join-Path $desktop 'ProduTime-1.6.8-NoLicense'
$appData = [Environment]::GetFolderPath('ApplicationData')

Write-Host "Step 1: Removing old export..." -ForegroundColor Yellow
if (Test-Path $destFolder) {
    Remove-Item $destFolder -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "Step 2: Copying ProduTime application files..." -ForegroundColor Yellow
New-Item -ItemType Directory -Path $destFolder -Force | Out-Null
Copy-Item -Path 'desktop-export\win-unpacked\*' -Destination $destFolder -Recurse -Force

Write-Host "Step 3: Cleaning all license data from AppData..." -ForegroundColor Yellow
$produtimeDir = Join-Path $appData 'produtime'
$atlianflowDir = Join-Path $appData 'atlianflow'

# Remove all database files to ensure clean slate
if (Test-Path $produtimeDir) {
    Get-ChildItem $produtimeDir -Filter '*.db*' -ErrorAction SilentlyContinue | ForEach-Object {
        Write-Host "  Removing: $($_.Name)" -ForegroundColor Cyan
        Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue
    }
}

if (Test-Path $atlianflowDir) {
    Get-ChildItem $atlianflowDir -Filter '*.db*' -ErrorAction SilentlyContinue | ForEach-Object {
        Write-Host "  Removing: $($_.Name)" -ForegroundColor Cyan
        Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue
    }
}

Write-Host "Step 4: Creating desktop shortcut..." -ForegroundColor Yellow
$appPath = Join-Path $destFolder 'ProduTime.exe'
$shortcutPath = Join-Path $desktop 'ProduTime-1.6.8-NoLicense.lnk'

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $appPath
$shortcut.WorkingDirectory = $destFolder
$shortcut.Description = 'ProduTime 1.6.8 - Clean (Requires License Key)'
$shortcut.Save()

Write-Host ""
Write-Host "SUCCESS! Clean ProduTime 1.6.8 exported" -ForegroundColor Green
Write-Host "Folder: $destFolder" -ForegroundColor Cyan
Write-Host "Executable: ProduTime.exe" -ForegroundColor Cyan
Write-Host "Shortcut: ProduTime-1.6.8-NoLicense.lnk" -ForegroundColor Cyan
Write-Host ""
Write-Host "Status:" -ForegroundColor Green
Write-Host "  - No license activated" -ForegroundColor Cyan
Write-Host "  - All database files cleaned" -ForegroundColor Cyan
Write-Host "  - App will request license key on startup" -ForegroundColor Cyan
Write-Host ""
Write-Host "On first launch, you will see:" -ForegroundColor Yellow
Write-Host "  - License Activation Modal" -ForegroundColor Cyan
Write-Host "  - Option to enter license key" -ForegroundColor Cyan
Write-Host "  - Option to start 7-day trial" -ForegroundColor Cyan

