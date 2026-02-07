# Cleanup workspace root - Move documentation and test files to appropriate folders

Write-Host "🧹 Cleaning up workspace root..." -ForegroundColor Cyan

# Create archive folder for old documentation if it doesn't exist
$archiveDocsPath = "archive\old-documentation"
New-Item -ItemType Directory -Path $archiveDocsPath -Force | Out-Null

# Files to move to archive/old-documentation
$docsToArchive = @(
    "COMPLETE_FIX_SUMMARY.txt",
    "DEPLOYMENT_SUMMARY.md",
    "Desktop-README.txt",
    "FIXES_APPLIED_SUMMARY.md",
    "IMPORTANT_BEFORE_BUILDING.txt",
    "LICENSE_MANAGER_AUDIT_REPORT.md",
    "LICENSE_MANAGER_DEPLOYMENT.md",
    "LICENSE_MANAGER_TIMEOUT_FIX.txt",
    "PRODUTIME_1.6.9_CHANGES.md",
    "PUBLIC_KEY_FIX_SUMMARY.txt",
    "ProduTime-README.txt",
    "QUICK_START.md",
    "README_START_HERE.md",
    "SETUP_ICONS_FOR_1.6.9.md",
    "SYSTEM_VERIFICATION_REPORT.md"
)

foreach ($file in $docsToArchive) {
    if (Test-Path $file) {
        Move-Item -Path $file -Destination $archiveDocsPath -Force
        Write-Host "  ✅ Moved $file to archive" -ForegroundColor Green
    }
}

# Move deployment scripts to scripts folder
$scriptsToMove = @(
    "configure-nginx.ps1",
    "create-produtime-shortcut.ps1",
    "deploy-license-server.ps1",
    "deploy-license-server.py",
    "deploy-server.ps1",
    "deploy_server.py",
    "export-license-manager.ps1"
)

foreach ($script in $scriptsToMove) {
    if (Test-Path $script) {
        Move-Item -Path $script -Destination "scripts\" -Force
        Write-Host "  ✅ Moved $script to scripts/" -ForegroundColor Green
    }
}

# Move SSH keys to archive (sensitive files)
if (Test-Path "vps_ed25519") {
    Move-Item -Path "vps_ed25519" -Destination "archive\" -Force
    Write-Host "  ✅ Moved vps_ed25519 to archive" -ForegroundColor Green
}
if (Test-Path "vps_ed25519.pub") {
    Move-Item -Path "vps_ed25519.pub" -Destination "archive\" -Force
    Write-Host "  ✅ Moved vps_ed25519.pub to archive" -ForegroundColor Green
}

# Move Beacon folder to archive
if (Test-Path "Beacon") {
    Move-Item -Path "Beacon" -Destination "archive\" -Force
    Write-Host "  ✅ Moved Beacon to archive" -ForegroundColor Green
}

# Move Test User folder to test-analytics-data
if (Test-Path "Test User") {
    Move-Item -Path "Test User" -Destination "test-analytics-data\" -Force
    Write-Host "  ✅ Moved 'Test User' to test-analytics-data/" -ForegroundColor Green
}

Write-Host ""
Write-Host "✅ Workspace root cleanup complete!" -ForegroundColor Green
Write-Host ""
Write-Host "📁 Current workspace structure:" -ForegroundColor Cyan
Write-Host "  - PROTECTED_BACKUPS/     ← 🔒 GOLDEN 1.6.9 backups (DO NOT DELETE)"
Write-Host "  - src/                   ← Source code"
Write-Host "  - scripts/               ← Build and deployment scripts"
Write-Host "  - assets/                ← Icons and images"
Write-Host "  - license-manager/       ← License Manager application"
Write-Host "  - docs-root/             ← Documentation"
Write-Host "  - archive/               ← Old files and backups"
Write-Host "  - dist/                  ← Build output"
Write-Host "  - release/               ← Packaged application"
Write-Host ""

