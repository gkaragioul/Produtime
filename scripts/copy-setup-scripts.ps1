$desktop = [Environment]::GetFolderPath('Desktop')
$destFolder = Join-Path $desktop 'ProduTime-1.6.6-Clean'

Write-Host "Copying setup scripts to export folder..." -ForegroundColor Yellow

Copy-Item -Path 'ProduTime-Setup-Clean.ps1' -Destination $destFolder -Force
Copy-Item -Path 'ProduTime-Setup-Clean.bat' -Destination $destFolder -Force

Write-Host "Setup scripts copied!" -ForegroundColor Green
Write-Host ""
Write-Host "Files in export folder:" -ForegroundColor Cyan
Get-ChildItem $destFolder -Filter "ProduTime-Setup*" | ForEach-Object {
    Write-Host "  - $($_.Name)" -ForegroundColor Cyan
}

Write-Host ""
Write-Host "To use on another PC:" -ForegroundColor Yellow
Write-Host "1. Copy the entire ProduTime-1.6.6-Clean folder to the other PC" -ForegroundColor Cyan
Write-Host "2. Run ProduTime-Setup-Clean.bat (double-click it)" -ForegroundColor Cyan
Write-Host "3. It will clean all data and launch ProduTime" -ForegroundColor Cyan
Write-Host "4. License key will be required" -ForegroundColor Cyan

