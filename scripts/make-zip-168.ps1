$zipPath = Join-Path $env:USERPROFILE 'Desktop\ProduTime 1.6.8.zip'
$src = Join-Path $env:USERPROFILE 'Desktop\ProduTime-1.6.8-export\win-unpacked\*'

if (Test-Path -LiteralPath $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}

Compress-Archive -Path $src -DestinationPath $zipPath -Force

if (Test-Path -LiteralPath $zipPath) {
  Write-Host "ZIPPED: $zipPath"
} else {
  Write-Error "ZIP failed at: $zipPath"
}

