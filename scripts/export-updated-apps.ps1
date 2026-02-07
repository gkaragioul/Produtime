# LEGACY SCRIPT - DO NOT USE
# This export script has been superseded by the safe packaging commands.
Write-Host 'LEGACY SCRIPT - DO NOT USE' -ForegroundColor Red
Write-Host 'This script is kept for historical reference only.' -ForegroundColor Yellow
Write-Host 'Use the safe commands instead:' -ForegroundColor Yellow
Write-Host '  - npm run package:produtime' -ForegroundColor Yellow
Write-Host '  - npm run package:license-manager' -ForegroundColor Yellow
exit 1


# Export Updated License Manager and ProduTime 1.6.8
# This script exports both applications to the desktop

Write-Host "╔════════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║     Exporting Updated License Manager & ProduTime 1.6.8       ║" -ForegroundColor Cyan
Write-Host "╚════════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

$desktop = [Environment]::GetFolderPath("Desktop")
$timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"

# ============================================================================
# EXPORT LICENSE MANAGER
# ============================================================================

Write-Host "📦 Exporting License Manager..." -ForegroundColor Yellow
Write-Host ""

$licenseManagerSource = "license-manager\dist\main"
$licenseManagerDest = "$desktop\LicenseManager-Updated"

# Remove old export if exists
if (Test-Path $licenseManagerDest) {
    Write-Host "   Removing old export..." -ForegroundColor Gray
    Remove-Item -Path $licenseManagerDest -Recurse -Force
}

# Create destination
New-Item -ItemType Directory -Path $licenseManagerDest -Force | Out-Null

# Copy License Manager files
Write-Host "   Copying License Manager files..." -ForegroundColor Gray
Copy-Item -Path "$licenseManagerSource\*" -Destination $licenseManagerDest -Recurse -Force

# Copy package.json and node_modules
Write-Host "   Copying dependencies..." -ForegroundColor Gray
Copy-Item -Path "license-manager\package.json" -Destination $licenseManagerDest -Force
Copy-Item -Path "license-manager\node_modules" -Destination "$licenseManagerDest\node_modules" -Recurse -Force

# Create shortcut
Write-Host "   Creating shortcut..." -ForegroundColor Gray
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut("$desktop\LicenseManager-Updated.lnk")
$shortcut.TargetPath = "$licenseManagerDest\main.js"
$shortcut.WorkingDirectory = $licenseManagerDest
$shortcut.Description = "ProduTime License Manager - Updated with Revocation Support"
$shortcut.Save()

Write-Host "   ✅ License Manager exported!" -ForegroundColor Green
Write-Host "      Location: $licenseManagerDest" -ForegroundColor Gray
Write-Host "      Shortcut: LicenseManager-Updated.lnk" -ForegroundColor Gray
Write-Host ""

# ============================================================================
# EXPORT PRODUTIME 1.6.8
# ============================================================================

Write-Host "📦 Exporting ProduTime 1.6.8..." -ForegroundColor Yellow
Write-Host ""

$produTimeSource = "dist\win-unpacked"
$produTimeDest = "$desktop\ProduTime-1.6.8-Updated"

# Remove old export if exists
if (Test-Path $produTimeDest) {
    Write-Host "   Removing old export..." -ForegroundColor Gray
    Remove-Item -Path $produTimeDest -Recurse -Force
}

# Create destination
New-Item -ItemType Directory -Path $produTimeDest -Force | Out-Null

# Copy ProduTime files
Write-Host "   Copying ProduTime files..." -ForegroundColor Gray
Copy-Item -Path "$produTimeSource\*" -Destination $produTimeDest -Recurse -Force

# Create shortcut
Write-Host "   Creating shortcut..." -ForegroundColor Gray
$shortcut = $shell.CreateShortcut("$desktop\ProduTime-1.6.8-Updated.lnk")
$shortcut.TargetPath = "$produTimeDest\ProduTime.exe"
$shortcut.WorkingDirectory = $produTimeDest
$shortcut.Description = "ProduTime 1.6.8 - Updated with Remote Revocation Support"
$shortcut.Save()

Write-Host "   ✅ ProduTime exported!" -ForegroundColor Green
Write-Host "      Location: $produTimeDest" -ForegroundColor Gray
Write-Host "      Shortcut: ProduTime-1.6.8-Updated.lnk" -ForegroundColor Gray
Write-Host ""

# ============================================================================
# CREATE CONFIGURATION GUIDE
# ============================================================================

Write-Host "📝 Creating configuration guide..." -ForegroundColor Yellow
Write-Host ""

$configGuide = @"
# ProduTime Remote Revocation - Configuration Guide

## What's New

✅ License Manager
- Remote license revocation support
- Revocation timestamp tracking
- 410 status detection
- Worldwide accessible (when deployed to cloud)

✅ ProduTime 1.6.8
- Detects revoked licenses (410 status)
- Automatic app locking on revocation
- Fallback to local validation
- Periodic validation every 2 minutes

## Setup for Remote PC

### Option 1: Using Environment Variables (Recommended)

Before running ProduTime, set these environment variables:

```batch
set ACTIVATION_SERVER_URL=http://YOUR_LICENSE_MANAGER_IP:3000/activate
set VALIDATION_SERVER_URL=http://YOUR_LICENSE_MANAGER_IP:3000/validate
ProduTime.exe
```

### Option 2: Using Batch File

Create a file named `run-produtime.bat`:

```batch
@echo off
set ACTIVATION_SERVER_URL=http://YOUR_LICENSE_MANAGER_IP:3000/activate
set VALIDATION_SERVER_URL=http://YOUR_LICENSE_MANAGER_IP:3000/validate
start "" "ProduTime.exe"
```

Then double-click the batch file to run ProduTime.

## Testing License Revocation

1. Activate a license on the remote PC
2. Delete the license in License Manager
3. Wait 2 minutes (ProduTime validates every 2 minutes)
4. ProduTime should lock and show: "Your license has been revoked"

## Important Notes

- License Manager must be accessible from the remote PC
- For worldwide access, deploy License Manager to cloud (DigitalOcean, AWS, etc.)
- ProduTime validates every 2 minutes
- Maximum delay from revocation to lock: 2 minutes
- If server unreachable, ProduTime falls back to local validation

## Files Included

- LicenseManager-Updated: Updated License Manager with revocation support
- ProduTime-1.6.8-Updated: ProduTime with remote revocation detection

## Support

For detailed setup instructions, see:
- REMOTE_PC_CONFIGURATION.md
- WORLDWIDE_ACCESS_SOLUTION.md
- CLOUD_DEPLOYMENT_GUIDE.md
"@

$configGuide | Out-File -FilePath "$desktop\SETUP_GUIDE.txt" -Encoding UTF8

Write-Host "   ✅ Configuration guide created!" -ForegroundColor Green
Write-Host "      File: SETUP_GUIDE.txt" -ForegroundColor Gray
Write-Host ""

# ============================================================================
# SUMMARY
# ============================================================================

Write-Host "╔════════════════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║                    ✅ EXPORT COMPLETE!                        ║" -ForegroundColor Green
Write-Host "╚════════════════════════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""

Write-Host "📁 Files on Desktop:" -ForegroundColor Yellow
Write-Host "   ✅ LicenseManager-Updated (folder)" -ForegroundColor Green
Write-Host "   ✅ LicenseManager-Updated.lnk (shortcut)" -ForegroundColor Green
Write-Host "   ✅ ProduTime-1.6.8-Updated (folder)" -ForegroundColor Green
Write-Host "   ✅ ProduTime-1.6.8-Updated.lnk (shortcut)" -ForegroundColor Green
Write-Host "   ✅ SETUP_GUIDE.txt (configuration guide)" -ForegroundColor Green
Write-Host ""

Write-Host "🚀 How to Use:" -ForegroundColor Yellow
Write-Host ""
Write-Host "   1. License Manager:" -ForegroundColor Cyan
Write-Host "      - Double-click: LicenseManager-Updated.lnk" -ForegroundColor Gray
Write-Host "      - Or run: LicenseManager-Updated\main.js" -ForegroundColor Gray
Write-Host ""
Write-Host "   2. ProduTime on Remote PC:" -ForegroundColor Cyan
Write-Host "      - Copy ProduTime-1.6.8-Updated folder to remote PC" -ForegroundColor Gray
Write-Host "      - Set environment variables with License Manager IP" -ForegroundColor Gray
Write-Host "      - Run: ProduTime.exe" -ForegroundColor Gray
Write-Host ""

Write-Host "📝 Configuration:" -ForegroundColor Yellow
Write-Host ""
Write-Host "   Before running ProduTime on remote PC, set:" -ForegroundColor Cyan
Write-Host "   set ACTIVATION_SERVER_URL=http://YOUR_IP:3000/activate" -ForegroundColor Gray
Write-Host "   set VALIDATION_SERVER_URL=http://YOUR_IP:3000/validate" -ForegroundColor Gray
Write-Host ""

Write-Host "✨ Features:" -ForegroundColor Yellow
Write-Host "   ✅ Remote license revocation" -ForegroundColor Green
Write-Host "   ✅ Automatic app locking" -ForegroundColor Green
Write-Host "   ✅ Periodic validation (every 2 minutes)" -ForegroundColor Green
Write-Host "   ✅ Fallback to local validation" -ForegroundColor Green
Write-Host "   ✅ Audit trail with revocation timestamps" -ForegroundColor Green
Write-Host ""

Write-Host "📚 Documentation:" -ForegroundColor Yellow
Write-Host "   - SETUP_GUIDE.txt (on desktop)" -ForegroundColor Gray
Write-Host "   - REMOTE_PC_CONFIGURATION.md" -ForegroundColor Gray
Write-Host "   - WORLDWIDE_ACCESS_SOLUTION.md" -ForegroundColor Gray
Write-Host "   - CLOUD_DEPLOYMENT_GUIDE.md" -ForegroundColor Gray
Write-Host ""

Write-Host "Done! ✅" -ForegroundColor Green
