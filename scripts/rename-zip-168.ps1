$src = Join-Path $env:USERPROFILE 'Desktop\ProduTime 1.6.8.zip'
$dst = Join-Path $env:USERPROFILE 'Desktop\ProduTime-1.6.8.zip'

if (Test-Path -LiteralPath $src) {
  if (Test-Path -LiteralPath $dst) {
    Remove-Item -LiteralPath $dst -Force
  }
  Rename-Item -LiteralPath $src -NewName (Split-Path -Leaf $dst)
  Write-Host "RENAMED: $dst"
} else {
  Write-Error "Source zip not found: $src"
}

