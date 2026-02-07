# Export ProduTime 1.6.6 with NO license (clean slate)

$desktop = [Environment]::GetFolderPath('Desktop')
$destFolder = Join-Path $desktop 'ProduTime-1.6.6-Clean'
$appData = [Environment]::GetFolderPath('ApplicationData')

Write-Host "Step 1: Removing old export..." -ForegroundColor Yellow
if (Test-Path $destFolder) {
    Remove-Item $destFolder -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "Step 2: Copying application files..." -ForegroundColor Yellow
New-Item -ItemType Directory -Path $destFolder -Force | Out-Null
Copy-Item -Path 'desktop-export\win-unpacked\*' -Destination $destFolder -Recurse -Force

Write-Host "Step 3: Cleaning license data from AppData..." -ForegroundColor Yellow
$produtimeDir = Join-Path $appData 'produtime'
$atlianflowDir = Join-Path $appData 'atlianflow'

# Remove all database files
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
$shortcutPath = Join-Path $desktop 'ProduTime-1.6.6-Clean.lnk'

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $appPath
$shortcut.WorkingDirectory = $destFolder
$shortcut.Description = 'ProduTime 1.6.6 - Clean (No License)'
$shortcut.Save()

Write-Host ""
Write-Host "SUCCESS! Clean export created" -ForegroundColor Green
Write-Host "Folder: $destFolder" -ForegroundColor Cyan
Write-Host "Shortcut: ProduTime-1.6.6-Clean.lnk" -ForegroundColor Cyan
Write-Host ""
Write-Host "The app will request a license key on first launch" -ForegroundColor Green

