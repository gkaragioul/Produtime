# Pre-build cleanup script
# Removes ALL build artifacts to ensure clean builds
Write-Host "Cleaning up build artifacts..." -ForegroundColor Cyan

# Remove dist directory (compiled TypeScript and webpack bundles)
if (Test-Path "dist") {
    Remove-Item "dist" -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "Removed dist directory" -ForegroundColor Green
}

# Remove build-output directory (electron-builder output)
if (Test-Path "build-output") {
    Remove-Item "build-output" -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "Removed build-output directory" -ForegroundColor Green
}

# Remove build directory (legacy) unless it contains NSIS config
if (Test-Path "build") {
    $installerConfig = Join-Path "build" "installer.nsh"
    if (Test-Path $installerConfig) {
        Write-Host "Preserving build/installer.nsh for NSIS packaging" -ForegroundColor Yellow
    } else {
        Remove-Item "build" -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "Removed build directory" -ForegroundColor Green
    }
}

# Remove release directory (legacy)
if (Test-Path "release") {
    Remove-Item "release" -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "Removed release directory" -ForegroundColor Green
}

# Remove desktop-export directory (legacy deployment artifacts)
if (Test-Path "desktop-export") {
    Remove-Item "desktop-export" -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "Removed desktop-export directory" -ForegroundColor Green
}

Write-Host "Pre-build cleanup complete" -ForegroundColor Green
Write-Host "   All build artifacts removed. Ready for clean build." -ForegroundColor Cyan
