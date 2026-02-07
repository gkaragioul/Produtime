# Robust build script
Write-Host "🔨 Building ProduTime..." -ForegroundColor Cyan
Write-Host ""

# Step 1: Pre-build cleanup (skip for now - causes issues with electron-builder)
# Write-Host "📋 Step 1: Pre-build cleanup" -ForegroundColor Yellow
# & powershell -NoProfile -ExecutionPolicy Bypass -File ./scripts/pre-build-cleanup.ps1
# if ($LASTEXITCODE -ne 0) {
#     Write-Host "❌ Pre-build cleanup failed" -ForegroundColor Red
#     exit 1
# }

# Step 2: Build main process
Write-Host ""
Write-Host "📋 Step 2: Building main process..." -ForegroundColor Yellow
npm run build:main
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Main process build failed" -ForegroundColor Red
    exit 1
}
Write-Host "✅ Main process built successfully" -ForegroundColor Green

# Step 3: Build renderer
Write-Host ""
Write-Host "📋 Step 3: Building renderer..." -ForegroundColor Yellow
npm run build:renderer
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Renderer build failed" -ForegroundColor Red
    exit 1
}
Write-Host "✅ Renderer built successfully" -ForegroundColor Green

Write-Host ""
Write-Host "✅ Build complete!" -ForegroundColor Green

