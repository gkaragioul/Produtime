# Start ProduTime App - Clean Launch
# No extra windows, just the app

$ErrorActionPreference = "Continue"

# Kill existing Electron processes
Get-Process | Where-Object { $_.ProcessName -match "electron|ProduTime" } | ForEach-Object {
    Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 1

# Setup logging
$timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$logsDir = "logs"
if (-not (Test-Path $logsDir)) { New-Item -ItemType Directory -Path $logsDir | Out-Null }

# Start Electron in production mode (hidden console window)
$electronCmd = Join-Path $PWD "node_modules\.bin\electron.cmd"
$env:NODE_ENV = "production"

Start-Process -FilePath $electronCmd -ArgumentList "." `
    -RedirectStandardOutput "$logsDir\electron-stdout-$timestamp.txt" `
    -RedirectStandardError "$logsDir\electron-stderr-$timestamp.txt" `
    -WorkingDirectory $PWD `
    -WindowStyle Hidden

Write-Host "ProduTime started successfully!" -ForegroundColor Green
Write-Host "Logs: $logsDir\electron-stdout-$timestamp.txt" -ForegroundColor Gray

