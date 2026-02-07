$desktop = [Environment]::GetFolderPath('Desktop')
$exportFolder = Join-Path $desktop 'ProduTime-1.6.7-export'
$src = Join-Path $exportFolder 'win-unpacked\*'
$zipPath = Join-Path $desktop 'ProduTime-1.6.7.zip'

Write-Host "Creating ZIP from: $src" -ForegroundColor Yellow

try {
  if (Test-Path -LiteralPath $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue
  }
  Compress-Archive -Path $src -DestinationPath $zipPath -Force
  if (Test-Path -LiteralPath $zipPath) {
    Write-Host "ZIPPED: $zipPath" -ForegroundColor Green
    exit 0
  } else {
    Write-Error "ZIP failed"
    exit 1
  }
} catch {
  Write-Error $_
  exit 1
}

