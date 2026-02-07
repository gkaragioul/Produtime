#!/usr/bin/env powershell
# LEGACY SCRIPT - DO NOT USE
# This export script has been superseded by the safe packaging commands.
Write-Host 'LEGACY SCRIPT - DO NOT USE' -ForegroundColor Red
Write-Host 'This script is kept for historical reference only.' -ForegroundColor Yellow
Write-Host 'Use the safe commands instead:' -ForegroundColor Yellow
Write-Host '  - npm run package:produtime' -ForegroundColor Yellow
Write-Host '  - npm run package:license-manager' -ForegroundColor Yellow
exit 1


# Export License Manager to Desktop

Write-Host "[*] Exporting License Manager to Desktop..." -ForegroundColor Cyan

$desktopPath = [Environment]::GetFolderPath("Desktop")
$exportFolder = Join-Path $desktopPath "ProduTime-License-Manager"

# Build latest app (no repackaging to avoid code-signing issues)
Write-Host "[*] Building latest app..." -ForegroundColor Cyan
Push-Location "license-manager"
try {
    npm run build | Out-Host
} finally {
    Pop-Location
}

# Remove old export if exists
if (Test-Path $exportFolder) {
    Write-Host "[*] Removing old export..." -ForegroundColor Yellow
    Remove-Item -Path $exportFolder -Recurse -Force
}

# Create export folder
Write-Host "[*] Creating export folder..." -ForegroundColor Green
New-Item -Path $exportFolder -ItemType Directory | Out-Null

# Copy the built app (prefer electron-builder output)
$sourceAppPrimary = "license-manager\release-vps\win-unpacked"
$sourceAppFallback = "license-manager\ProduTime License Manager-win32-x64"
$sourceApp = $null
if (Test-Path $sourceAppPrimary) { $sourceApp = $sourceAppPrimary }
elseif (Test-Path $sourceAppFallback) { $sourceApp = $sourceAppFallback }

if ($null -ne $sourceApp) {
    Write-Host "[*] Copying application files from: $sourceApp" -ForegroundColor Green
    Copy-Item -Path (Join-Path $sourceApp "*") -Destination $exportFolder -Recurse -Force
    Write-Host "[OK] Application files copied" -ForegroundColor Green

    # Repack app.asar with latest build (dist + package.json)
    $asarCmd = Join-Path $PSScriptRoot "license-manager\node_modules\.bin\asar.cmd"
    if (-not (Test-Path $asarCmd)) {
        Write-Host "[*] Installing @electron/asar locally..." -ForegroundColor Yellow
        Push-Location "license-manager"
        try { npm install --no-audit --no-fund --silent -D @electron/asar | Out-Host } finally { Pop-Location }
    }

    $tempApp = Join-Path $env:TEMP "license-manager-app-$(Get-Random)"
    if (Test-Path $tempApp) { Remove-Item -Path $tempApp -Recurse -Force }
    New-Item -Path $tempApp -ItemType Directory | Out-Null

    Copy-Item -Path "license-manager\dist" -Destination (Join-Path $tempApp "dist") -Recurse -Force
    Copy-Item -Path "license-manager\package.json" -Destination $tempApp -Force

    $exportAsar = Join-Path $exportFolder "resources\app.asar"
    if (Test-Path $exportAsar) { Remove-Item -Path $exportAsar -Force }

    Write-Host "[*] Packaging app.asar with latest build..." -ForegroundColor Cyan
    & $asarCmd pack $tempApp $exportAsar

    Remove-Item -Path $tempApp -Recurse -Force
    Write-Host "[OK] app.asar updated with latest build" -ForegroundColor Green
} else {
    Write-Host "[ERROR] No packaged app found. Ensure 'license-manager\\release-vps\\win-unpacked' exists." -ForegroundColor Red
    exit 1
}

# Create a README file
$readmePath = Join-Path $exportFolder "README.txt"
$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
$readmeContent = "ProduTime License Manager - Portable Version`r`n"
$readmeContent += "=============================================`r`n`r`n"
$readmeContent += "This is a portable version of the ProduTime License Manager.`r`n"
$readmeContent += "No installation required!`r`n`r`n"
$readmeContent += "HOW TO RUN:`r`n"
$readmeContent += "-----------`r`n"
$readmeContent += "1. Double-click ProduTime License Manager.exe`r`n"
$readmeContent += "2. The application will start`r`n"
$readmeContent += "3. It will connect to the VPS automatically (remote mode)`r`n`r`n"
$readmeContent += "FEATURES:`r`n"
$readmeContent += "---------`r`n"
$readmeContent += "- Generate and manage license keys`r`n"
$readmeContent += "- Upload and distribute updates`r`n"
$readmeContent += "- View system logs`r`n"
$readmeContent += "- Manage activations`r`n"
$readmeContent += "- Remote mode support (connect to VPS at http://146.190.233.122:3000)`r`n`r`n"
$readmeContent += "DATA STORAGE:`r`n"
$readmeContent += "-------------`r`n"
$readmeContent += "- Database: %APPDATA%\produtime-license-manager\licenses.db`r`n"
$readmeContent += "- Updates: %APPDATA%\produtime-license-manager\updates\`r`n"
$readmeContent += "- Logs: Stored in memory (view in Settings > System Logs)`r`n`r`n"
$readmeContent += "NOTES:`r`n"
$readmeContent += "------`r`n"
$readmeContent += "- Keep this entire folder together (do not move individual files)`r`n"
$readmeContent += "- The database and updates folder will be created on first run`r`n"
$readmeContent += "- You can move this entire folder to any location`r`n`r`n"
$readmeContent += "Generated: $timestamp"

Set-Content -Path $readmePath -Value $readmeContent

Write-Host ""
Write-Host "[OK] Export complete!" -ForegroundColor Green
Write-Host "[*] Location: $exportFolder" -ForegroundColor Cyan
Write-Host "[*] Run: ProduTime License Manager.exe" -ForegroundColor Cyan
Write-Host ""
Write-Host "[OK] All done! You can now run the License Manager from your desktop." -ForegroundColor Green
