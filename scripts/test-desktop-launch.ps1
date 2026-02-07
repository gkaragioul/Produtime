# Test launching ProduTime from Desktop with full diagnostics
$ErrorActionPreference = 'Continue'

Write-Host "=== Testing ProduTime Launch from Desktop ===" -ForegroundColor Cyan

$desktopExe = "C:\Mac\Home\Desktop\ProduTime-1.6.9-Portable\ProduTime.exe"

if (-not (Test-Path $desktopExe)) {
  Write-Host "ERROR: ProduTime not found at: $desktopExe" -ForegroundColor Red
  exit 1
}

Write-Host "Found: $desktopExe" -ForegroundColor Green

# Set diagnostic environment variables
$env:ELECTRON_ENABLE_LOGGING = "1"
$env:ELECTRON_ENABLE_STACK_DUMPING = "1"

# Create log directory
$logDir = Join-Path $env:TEMP "produtime-desktop-test"
if (-not (Test-Path $logDir)) {
  New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}

$chromeLog = Join-Path $logDir "chrome_debug.log"
$env:CHROME_LOG_FILE = $chromeLog

Write-Host "`nLaunching with diagnostics..." -ForegroundColor Yellow
Write-Host "Log file: $chromeLog" -ForegroundColor Gray

# Launch with full diagnostics
$proc = Start-Process -FilePath $desktopExe -ArgumentList @(
  "--no-sandbox",
  "--disable-gpu",
  "--enable-logging",
  "--v=1"
) -PassThru

Write-Host "Process started: PID $($proc.Id)" -ForegroundColor Green

# Wait and check
Start-Sleep -Seconds 5

$running = Get-Process -Id $proc.Id -ErrorAction SilentlyContinue
if ($running) {
  Write-Host "Process still running: $($running.ProcessName) (PID $($running.Id))" -ForegroundColor Green
  Write-Host "Main window: $($running.MainWindowTitle)" -ForegroundColor Gray
} else {
  Write-Host "Process EXITED (crashed or failed to start)" -ForegroundColor Red
}

# Check for log file
if (Test-Path $chromeLog) {
  Write-Host "`n=== Chrome Debug Log (last 50 lines) ===" -ForegroundColor Cyan
  Get-Content -Path $chromeLog -Tail 50
} else {
  Write-Host "`nNo log file created at: $chromeLog" -ForegroundColor Yellow
}

# Check AppData logs
$appDataLog = Join-Path $env:APPDATA "ProduTime\logs"
if (Test-Path $appDataLog) {
  Write-Host "`n=== ProduTime AppData Logs ===" -ForegroundColor Cyan
  Get-ChildItem $appDataLog -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1 | ForEach-Object {
    Write-Host "Latest log: $($_.Name)" -ForegroundColor Gray
    Get-Content -Path $_.FullName -Tail 30
  }
}

