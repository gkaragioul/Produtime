# Deep clean ProduTime - removes ALL cache, storage, and database files

$appData = [Environment]::GetFolderPath('ApplicationData')
$localAppData = [Environment]::GetFolderPath('LocalApplicationData')

Write-Host "Deep Cleaning ProduTime..." -ForegroundColor Yellow
Write-Host ""

# Remove all ProduTime/AtlianFlow directories
$dirsToRemove = @(
    (Join-Path $appData 'produtime'),
    (Join-Path $appData 'atlianflow'),
    (Join-Path $localAppData 'produtime'),
    (Join-Path $localAppData 'atlianflow')
)

foreach ($dir in $dirsToRemove) {
    if (Test-Path $dir) {
        Write-Host "Removing: $dir" -ForegroundColor Cyan
        Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "  Removed!" -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "Deep clean complete!" -ForegroundColor Green
Write-Host "All ProduTime data has been removed:" -ForegroundColor Cyan
Write-Host "  - AppData\Roaming\produtime" -ForegroundColor Gray
Write-Host "  - AppData\Roaming\atlianflow" -ForegroundColor Gray
Write-Host "  - AppData\Local\produtime" -ForegroundColor Gray
Write-Host "  - AppData\Local\atlianflow" -ForegroundColor Gray
Write-Host ""
Write-Host "ProduTime will create a fresh database on next launch" -ForegroundColor Yellow
Write-Host "License key will be required" -ForegroundColor Yellow

