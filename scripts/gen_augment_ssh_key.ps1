$ErrorActionPreference = 'Stop'

$dir = Join-Path (Get-Location) '.ssh'
if (-not (Test-Path $dir)) {
  New-Item -ItemType Directory -Path $dir | Out-Null
}

$key = Join-Path $dir 'produtime_vps'
$pub = "$key.pub"

if (-not (Test-Path $pub)) {
  Write-Host "Generating ed25519 key at $key"
  & ssh-keygen -t ed25519 -C 'augment@produtime' -f $key -N '' -q
} else {
  Write-Host "Key already exists at $key"
}

Write-Host "---PUBLIC KEY---"
Get-Content $pub -Raw

