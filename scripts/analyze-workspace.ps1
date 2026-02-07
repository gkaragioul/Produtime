# Analyze workspace sizes and largest files (read-only)
param(
  [string]$Root = ".",
  [int]$TopFiles = 50
)

$ErrorActionPreference = 'SilentlyContinue'
Set-Location -LiteralPath $Root

function Get-DirSizeMB([string]$Path) {
  $sum = (Get-ChildItem -LiteralPath $Path -Recurse -Force -ErrorAction SilentlyContinue |
          Measure-Object -Property Length -Sum).Sum
  if ($null -eq $sum) { return 0 }
  return [math]::Round($sum / 1MB, 2)
}

Write-Host "=== Top-level directory sizes (MB) ===" -ForegroundColor Cyan
Get-ChildItem -LiteralPath . -Force |
  Where-Object { $_.PSIsContainer } |
  ForEach-Object {
    [pscustomobject]@{ Name = $_.Name; SizeMB = Get-DirSizeMB $_.FullName }
  } |
  Sort-Object SizeMB -Descending |
  Format-Table -AutoSize

Write-Host ""; Write-Host "=== Largest files (top $TopFiles) ===" -ForegroundColor Cyan
Get-ChildItem -Path . -Recurse -File -Force -ErrorAction SilentlyContinue |
  Sort-Object Length -Descending |
  Select-Object -First $TopFiles @{N='SizeMB';E={[math]::Round($_.Length/1MB,2)}}, LastWriteTime, FullName |
  Format-Table -AutoSize

