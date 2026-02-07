$appData = [Environment]::GetFolderPath('ApplicationData')
$produtimeDir = Join-Path $appData 'produtime'
$atlianflowDir = Join-Path $appData 'atlianflow'

Write-Host "Checking for database files..." -ForegroundColor Yellow
Write-Host ""

if (Test-Path $produtimeDir) {
    Write-Host "ProduTime directory found: $produtimeDir" -ForegroundColor Cyan
    Get-ChildItem $produtimeDir -Recurse | ForEach-Object {
        Write-Host "  $($_.FullName)" -ForegroundColor Gray
    }
    Write-Host ""
    Write-Host "Removing ProduTime directory..." -ForegroundColor Yellow
    Remove-Item $produtimeDir -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "Removed!" -ForegroundColor Green
}

if (Test-Path $atlianflowDir) {
    Write-Host "AtlianFlow directory found: $atlianflowDir" -ForegroundColor Cyan
    Get-ChildItem $atlianflowDir -Recurse | ForEach-Object {
        Write-Host "  $($_.FullName)" -ForegroundColor Gray
    }
    Write-Host ""
    Write-Host "Removing AtlianFlow directory..." -ForegroundColor Yellow
    Remove-Item $atlianflowDir -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "Removed!" -ForegroundColor Green
}

Write-Host ""
Write-Host "All database files cleaned!" -ForegroundColor Green
Write-Host "ProduTime will create a fresh database on next launch" -ForegroundColor Cyan

