# Launch ProduTime development version silently without console window
# This script is called by start-produtime-dev-silent.vbs

$ErrorActionPreference = 'SilentlyContinue'

# Get the workspace root (parent of scripts directory)
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$workspaceRoot = Split-Path -Parent $scriptDir

# Set environment for production mode (uses built files)
$env:NODE_ENV = "production"

# Kill any existing Electron processes
Get-Process -Name "electron" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process -Name "ProduTime" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

# Wait a moment for processes to terminate
Start-Sleep -Milliseconds 500

# Launch Electron silently
$electronCmd = Join-Path $workspaceRoot "node_modules\.bin\electron.cmd"
if (Test-Path $electronCmd) {
    Start-Process -FilePath $electronCmd -ArgumentList "." -WorkingDirectory $workspaceRoot -WindowStyle Hidden -ErrorAction SilentlyContinue
}

