$ErrorActionPreference='Stop'
$base = 'C:\Mac\Home\Documents\PT-ARCHIVE'
if (-not (Test-Path -LiteralPath $base)) { Write-Output 'No PT-ARCHIVE base found'; exit 0 }
$latest = Get-ChildItem -LiteralPath $base -Directory | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $latest) { Write-Output 'No PT-ARCHIVE sessions'; exit 0 }
Write-Output ("Latest session: {0}" -f $latest.FullName)
Get-ChildItem -LiteralPath $latest.FullName -File | Select-Object Name, @{N='SizeMB';E={[math]::Round($_.Length/1MB,2)}} | Format-Table -AutoSize

