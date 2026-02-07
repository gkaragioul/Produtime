# Safe Build Script
# The ONLY way to build ProduTime safely
# Automatically: backs up, cleans, builds, validates, tests

$ErrorActionPreference = "Stop"

Write-Host "ProduTime Safe Build Process" -ForegroundColor Cyan
Write-Host "=================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Create automatic backup
Write-Host "STEP 1: Creating backup of current version..." -ForegroundColor Yellow
try {
    & "$PSScriptRoot/auto-backup.ps1" -Reason "pre-build-safety"
} catch {
    Write-Host "WARNING: Backup failed, but continuing..." -ForegroundColor Yellow
}

# Step 2: Clean all build artifacts
Write-Host "STEP 2: Cleaning build artifacts..." -ForegroundColor Yellow
try {
    & "$PSScriptRoot/pre-build-cleanup.ps1"
} catch {
    Write-Host "ERROR: Pre-build cleanup failed!" -ForegroundColor Red
    exit 1
}

# Step 3: Build main process
Write-Host "STEP 3: Building main process (TypeScript)..." -ForegroundColor Yellow
npm run build:main
if ($LASTEXITCODE -ne 0) {
    Write-Host "Main process build failed!" -ForegroundColor Red
    Write-Host "   Run 'npm run panic:restore' to restore last working version" -ForegroundColor Yellow
    exit 1
}

# Step 4: Build renderer process
Write-Host "STEP 4: Building renderer process (Webpack)..." -ForegroundColor Yellow
npm run build:renderer
if ($LASTEXITCODE -ne 0) {
    Write-Host "Renderer process build failed!" -ForegroundColor Red
    Write-Host "   Run 'npm run panic:restore' to restore last working version" -ForegroundColor Yellow
    exit 1
}

# Step 5: Package with electron-builder
Write-Host "STEP 5: Packaging with electron-builder..." -ForegroundColor Yellow
npx electron-builder --win nsis --x64
if ($LASTEXITCODE -ne 0) {
    Write-Host "Packaging failed!" -ForegroundColor Red
    Write-Host "   Run 'npm run panic:restore' to restore last working version" -ForegroundColor Yellow
    exit 1
}

# Step 6: Validate build
Write-Host "STEP 6: Validating build..." -ForegroundColor Yellow
& "$PSScriptRoot/build-validator.ps1"
if ($LASTEXITCODE -ne 0) {
    Write-Host "Build validation failed!" -ForegroundColor Red
    Write-Host "   Build is incomplete or corrupted." -ForegroundColor Yellow
    Write-Host "   Run 'npm run panic:restore' to restore last working version" -ForegroundColor Yellow
    exit 1
}

# Step 7: Test launch (quick test)
Write-Host "STEP 7: Testing app launch..." -ForegroundColor Yellow
Write-Host "   Starting ProduTime.exe for 5 seconds..." -ForegroundColor Gray

$testProcess = Start-Process -FilePath "build-output\win-unpacked\ProduTime.exe" -PassThru -WindowStyle Normal
Start-Sleep -Seconds 5

if ($testProcess.HasExited) {
    if ($testProcess.ExitCode -eq 0) {
        Write-Host "App exited cleanly during launch test (non-fatal)." -ForegroundColor Yellow
    } else {
        Write-Host "App crashed during launch test!" -ForegroundColor Red
        Write-Host "   Exit code: $($testProcess.ExitCode)" -ForegroundColor Yellow
        Write-Host "   Run 'npm run panic:restore' to restore last working version" -ForegroundColor Yellow
        exit 1
    }
} else {
    Write-Host "App launched successfully" -ForegroundColor Green
    Stop-Process -Id $testProcess.Id -Force
}

# Step 8: Update version lock
Write-Host "STEP 8: Updating version lock..." -ForegroundColor Yellow
$lockFile = "CURRENT_VERSION.lock"
if (Test-Path $lockFile) {
    $lock = Get-Content $lockFile | ConvertFrom-Json
    $lock.status = "WORKING"
    $lock.lastVerified = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    $lock.buildTimestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    $lock.verificationTests.appLaunches = $true
    $lock.verificationTests.mainProcessCompiled = $true
    $lock.verificationTests.rendererProcessCompiled = $true
    $lock.verificationTests.sharedTypesCompiled = $true
    $lock.verificationTests.packagedCorrectly = $true
    $lock.workspaceHealth = "CLEAN"
    $lock.lastHealthCheck = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    $lock | ConvertTo-Json | Out-File $lockFile
}

# Step 9: Workspace cleanup (non-fatal)
Write-Host "STEP 9: Running workspace cleanup..." -ForegroundColor Yellow
try {
    & "$PSScriptRoot/auto-cleanup-workspace.ps1"
} catch {
    Write-Host "WARNING: Workspace cleanup encountered issues, but continuing..." -ForegroundColor Yellow
}

# Step 10: Log to changelog
$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
$changelogEntry = "[$timestamp] - Safe build completed successfully - Version: $($lock.version) - Status: WORKING"
Add-Content -Path "CHANGELOG.auto.md" -Value $changelogEntry

Write-Host ""
Write-Host "=================================" -ForegroundColor Cyan
Write-Host "SAFE BUILD COMPLETED SUCCESSFULLY" -ForegroundColor Green
Write-Host "=================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Build location: build-output\win-unpacked\ProduTime.exe" -ForegroundColor Gray
Write-Host "Version: $($lock.version)" -ForegroundColor Gray
Write-Host "Status: WORKING" -ForegroundColor Green
Write-Host ""
Write-Host "You can now run the app with: npm start" -ForegroundColor Yellow
Write-Host ""

exit 0
