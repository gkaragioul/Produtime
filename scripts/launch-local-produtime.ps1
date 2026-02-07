# Launch ProduTime from a LOCAL Windows path with diagnostic logging
# Never run from Parallels shared folders (C:\Mac\Home or \\Mac\Home)

param(
  [switch]$Diagnostics
)


$ErrorActionPreference = 'Stop'

Write-Host "=== Launching ProduTime (Local Test) ===" -ForegroundColor Cyan
Write-Host ""

# Preferred test path (from deploy:local)
$primaryPath = "C:\Users\$env:USERNAME\Documents\PT-Test\ProduTime.exe"
# Known working installed build (fallback)
$fallbackPath = "C:\Users\$env:USERNAME\Documents\PT-1.6.9-x64\ProduTime.exe"

# Resolve app path
if (Test-Path $primaryPath) {
  $appPath = $primaryPath
  Write-Host "Using test build at: $appPath" -ForegroundColor Gray
} elseif (Test-Path $fallbackPath) {
  $appPath = $fallbackPath
  Write-Host "Using installed build at: $appPath" -ForegroundColor Gray
  Write-Host "(Tip: Run 'npm run deploy:local' later to populate PT-Test)" -ForegroundColor DarkYellow
} else {
  Write-Host "❌ ProduTime not found at either path:" -ForegroundColor Red
  Write-Host "   $primaryPath" -ForegroundColor Red
  Write-Host "   $fallbackPath" -ForegroundColor Red
  Write-Host ""; Write-Host "Fix: copy or deploy a local build (npm run deploy:local)." -ForegroundColor Yellow
  exit 1
}

# Safety: refuse to launch from Parallels shared folders
if ($appPath -like "C:\\Mac\\Home*" -or $appPath -like "\\\\Mac\\Home*") {
  Write-Host "❌ Refusing to launch from a Parallels shared folder: $appPath" -ForegroundColor Red
  Write-Host "Move the app to C:\\Users\\$env:USERNAME\\Documents or run 'npm run deploy:local'." -ForegroundColor Yellow
  exit 1
}

$logsDir = "$env:APPDATA\ProduTime\logs"
$chromeLogFile = Join-Path $logsDir "chrome-debug.log"

# Ensure logs directory exists
if (-not (Test-Path $logsDir)) { New-Item -ItemType Directory -Path $logsDir -Force | Out-Null }

# Set environment variables (diagnostics mode only)
if ($Diagnostics) {
  $env:ELECTRON_ENABLE_LOGGING = "1"
  $env:ELECTRON_ENABLE_STACK_DUMPING = "1"
  $env:CHROME_LOG_FILE = $chromeLogFile
  $env:DIAGNOSTIC_SKIP_AUTOUPDATE = "1"
} else {
  Remove-Item Env:\ELECTRON_ENABLE_LOGGING -ErrorAction SilentlyContinue
  Remove-Item Env:\ELECTRON_ENABLE_STACK_DUMPING -ErrorAction SilentlyContinue
  Remove-Item Env:\CHROME_LOG_FILE -ErrorAction SilentlyContinue
  Remove-Item Env:\DIAGNOSTIC_SKIP_AUTOUPDATE -ErrorAction SilentlyContinue
}

# Help Electron resolve native modules if present in app.asar.unpacked\node_modules
$resourcesDir = Join-Path (Split-Path -Parent $appPath) 'resources'
$unpackedNodeModules = Join-Path $resourcesDir 'app.asar.unpacked\node_modules'
if (Test-Path $unpackedNodeModules) {
  $env:NODE_PATH = $unpackedNodeModules
  Write-Host "NODE_PATH set to: $env:NODE_PATH" -ForegroundColor DarkGray
} else {
  Write-Host "Note: $unpackedNodeModules not found (native modules may be missing)" -ForegroundColor DarkYellow
}

Write-Host "App location: $appPath" -ForegroundColor Gray
Write-Host "Logs directory: $logsDir" -ForegroundColor Gray
Write-Host "Chrome log: $chromeLogFile" -ForegroundColor Gray
Write-Host ""
Write-Host "Launching with flags:" -ForegroundColor Yellow
Write-Host "  --disable-gpu" -ForegroundColor Gray
Write-Host "  --no-sandbox" -ForegroundColor Gray
Write-Host "  --disable-gpu-sandbox" -ForegroundColor Gray
Write-Host "  --disable-features=CalculateNativeWinOcclusion,UseAngle" -ForegroundColor Gray
Write-Host "  --use-angle=swiftshader" -ForegroundColor Gray
if ($Diagnostics) {
  Write-Host "  --enable-logging" -ForegroundColor Gray
  Write-Host "  --v=1" -ForegroundColor Gray
}
Write-Host ""

# Kill any existing ProduTime processes
$existingProcesses = Get-Process -Name "ProduTime" -ErrorAction SilentlyContinue
if ($existingProcesses) {
  Write-Host "Stopping existing ProduTime processes..." -ForegroundColor Yellow
  $existingProcesses | Stop-Process -Force
  Start-Sleep -Seconds 2
}

# Launch the app
Write-Host "Starting ProduTime..." -ForegroundColor Green
Write-Host ""

try {
  $launchArgs = @(
    "--disable-gpu",
    "--no-sandbox",
    "--disable-gpu-sandbox",
    "--disable-features=CalculateNativeWinOcclusion,UseAngle",
    "--use-angle=swiftshader"
  )
  if ($Diagnostics) {
    $launchArgs += @("--enable-logging","--v=1")
  }
  Start-Process -FilePath $appPath -ArgumentList $launchArgs
  Write-Host "✅ ProduTime launched successfully" -ForegroundColor Green
  Write-Host ""; Write-Host "Monitor logs at:" -ForegroundColor Yellow
  Write-Host "  Main log: $logsDir\atlianflow-*.log" -ForegroundColor Gray
  Write-Host "  Chrome log: $chromeLogFile" -ForegroundColor Gray
  Write-Host ""; Write-Host "To view latest main log:" -ForegroundColor Yellow
  Write-Host "  Get-ChildItem '$logsDir\atlianflow-*.log' | Sort-Object LastWriteTime -Descending | Select-Object -First 1 | Get-Content" -ForegroundColor Gray
  Write-Host ""
}
catch {
  Write-Host "❌ Failed to launch ProduTime" -ForegroundColor Red
  Write-Host "Error: $_" -ForegroundColor Red
  exit 1
}
