# Deploy Admin Console Update
# Builds and releases the Admin Console to GitHub
# Requires 'gh' CLI to be authenticated

$ErrorActionPreference = 'Stop'
$version = (Get-Content "admin-console/package.json" | ConvertFrom-Json).version

Write-Host "=== Releasing Admin Console v$version ===" -ForegroundColor Cyan

# 1. Build
Write-Host "Building Admin Console..." -ForegroundColor Yellow
Set-Location "admin-console"
try {
    npm install
    npm run dist
} catch {
    Write-Host "Build failed" -ForegroundColor Red
    exit 1
}
Set-Location ..

# 2. Check for existing release
$releaseExists = $false
try {
    gh release view "v$version" --repo georgekgr12/produtime-admin-releases 2>$null
    $releaseExists = $true
} catch {
    $releaseExists = $false
}

# 3. Create Release & Upload
$installerPath = "admin-console/build-output/ProduTime-AdminConsole-$version-x64.exe"
$greenYml = "admin-console/build-output/latest.yml"

if (-not (Test-Path $installerPath)) {
    Write-Host "Installer not found at $installerPath" -ForegroundColor Red
    exit 1
}

if ($releaseExists) {
    Write-Host "Release v$version already exists. Uploading missing assets..." -ForegroundColor Yellow
    gh release upload "v$version" "$installerPath" "$greenYml" --clobber --repo georgekgr12/produtime-admin-releases
} else {
    Write-Host "Creating new release v$version..." -ForegroundColor Green
    gh release create "v$version" "$installerPath" "$greenYml" --title "v$version" --notes "Auto-generated release" --repo georgekgr12/produtime-admin-releases
}

Write-Host "✅ Release v$version hosted successfully!" -ForegroundColor Green
Write-Host "Updates will now be picked up by clients." -ForegroundColor Gray
