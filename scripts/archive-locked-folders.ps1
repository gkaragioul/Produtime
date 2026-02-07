param(
  [switch]$SkipExplorerRestart
)

$ErrorActionPreference = 'SilentlyContinue'
Write-Host 'Preparing system for archive pass (closing apps)...' -ForegroundColor Cyan

# Stop ProduTime and License Manager if running
foreach($n in @('ProduTime','ProduTime License Manager')){
  Get-Process -Name $n -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host ("Stopping {0} ({1})" -f $_.ProcessName, $_.Id)
    try { Stop-Process -Id $_.Id -Force -ErrorAction Stop } catch { }
  }
}
Start-Sleep -Milliseconds 800

# Restart Explorer to release file locks, unless skipped
if(-not $SkipExplorerRestart){
  if(Get-Process -Name 'explorer' -ErrorAction SilentlyContinue){
    Write-Host 'Restarting Windows Explorer to release file locks...' -ForegroundColor Yellow
    try { Stop-Process -Name explorer -Force -ErrorAction Stop } catch { }
    Start-Sleep -Seconds 2
  } else {
    Write-Host 'Explorer not running or already stopped.' -ForegroundColor Yellow
  }
}

# Run the archive/clean script (no git gc for speed)
Write-Host 'Running archive-and-clean script...' -ForegroundColor Cyan
try {
  & "$PSScriptRoot\space-save-archive-and-clean.ps1" -Root (Resolve-Path '..' | Select-Object -ExpandProperty Path) -SkipGitGC
} catch {
  Write-Warning ("Archive script failed: {0}" -f $_.Exception.Message)
}

# Start Explorer again if it was stopped
if(-not $SkipExplorerRestart){
  Write-Host 'Starting Windows Explorer...' -ForegroundColor Yellow
  try { Start-Process explorer.exe } catch { }
}

Write-Host 'Archive pass complete.' -ForegroundColor Green

