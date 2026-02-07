# Build Validation Script
# Automatically verifies that build completed successfully
# Called after every build

$ErrorActionPreference = "Stop"

Write-Host "Validating build..." -ForegroundColor Cyan
Write-Host ""

$allPassed = $true
$results = @()

# Test 1: dist/main exists with files
Write-Host "  [1/7] Checking dist/main..." -NoNewline
if (Test-Path "dist/main") {
    $mainFiles = (Get-ChildItem "dist/main" -Recurse -File).Count
    if ($mainFiles -gt 50) {
        Write-Host " OK ($mainFiles files)" -ForegroundColor Green
        $results += @{ test = "dist/main"; passed = $true; details = "$mainFiles files" }
    } else {
        Write-Host " FAIL (only $mainFiles files, expected 50+)" -ForegroundColor Red
        $results += @{ test = "dist/main"; passed = $false; details = "Insufficient files" }
        $allPassed = $false
    }
} else {
    Write-Host " FAIL (missing)" -ForegroundColor Red
    $results += @{ test = "dist/main"; passed = $false; details = "Directory missing" }
    $allPassed = $false
}

# Test 2: dist/renderer/bundle.js exists
Write-Host "  [2/7] Checking dist/renderer/bundle.js..." -NoNewline
if (Test-Path "dist/renderer/bundle.js") {
    $bundleSize = (Get-Item "dist/renderer/bundle.js").Length / 1KB
    Write-Host " OK ($([math]::Round($bundleSize, 0)) KB)" -ForegroundColor Green
    $results += @{ test = "dist/renderer/bundle.js"; passed = $true; details = "$([math]::Round($bundleSize, 0)) KB" }
} else {
    Write-Host " FAIL (missing)" -ForegroundColor Red
    $results += @{ test = "dist/renderer/bundle.js"; passed = $false; details = "File missing" }
    $allPassed = $false
}

# Test 3: dist/shared/types.js exists
Write-Host "  [3/7] Checking dist/shared/types.js..." -NoNewline
if (Test-Path "dist/shared/types.js") {
    Write-Host " OK" -ForegroundColor Green
    $results += @{ test = "dist/shared/types.js"; passed = $true; details = "OK" }
} else {
    Write-Host " FAIL (missing)" -ForegroundColor Red
    $results += @{ test = "dist/shared/types.js"; passed = $false; details = "File missing" }
    $allPassed = $false
}

# Test 4: build-output/win-unpacked/ProduTime.exe exists
Write-Host "  [4/7] Checking build-output/win-unpacked/ProduTime.exe..." -NoNewline
if (Test-Path "build-output/win-unpacked/ProduTime.exe") {
    $exeSize = (Get-Item "build-output/win-unpacked/ProduTime.exe").Length / 1MB
    Write-Host " OK ($([math]::Round($exeSize, 1)) MB)" -ForegroundColor Green
    $results += @{ test = "ProduTime.exe"; passed = $true; details = "$([math]::Round($exeSize, 1)) MB" }
} else {
    Write-Host " FAIL (missing)" -ForegroundColor Red
    $results += @{ test = "ProduTime.exe"; passed = $false; details = "File missing" }
    $allPassed = $false
}

# Test 5: Packaged app has dist/main
Write-Host "  [5/7] Checking packaged app dist/main..." -NoNewline
if (Test-Path "build-output/win-unpacked/resources/app/dist/main") {
    $packagedMainFiles = (Get-ChildItem "build-output/win-unpacked/resources/app/dist/main" -Recurse -File).Count
    if ($packagedMainFiles -gt 50) {
        Write-Host " OK ($packagedMainFiles files)" -ForegroundColor Green
        $results += @{ test = "packaged dist/main"; passed = $true; details = "$packagedMainFiles files" }
    } else {
        Write-Host " FAIL (only $packagedMainFiles files)" -ForegroundColor Red
        $results += @{ test = "packaged dist/main"; passed = $false; details = "Insufficient files" }
        $allPassed = $false
    }
} else {
    Write-Host " FAIL (missing)" -ForegroundColor Red
    $results += @{ test = "packaged dist/main"; passed = $false; details = "Directory missing" }
    $allPassed = $false
}

# Test 6: Packaged app has dist/renderer
Write-Host "  [6/7] Checking packaged app dist/renderer..." -NoNewline
if (Test-Path "build-output/win-unpacked/resources/app/dist/renderer/bundle.js") {
    Write-Host " OK" -ForegroundColor Green
    $results += @{ test = "packaged dist/renderer"; passed = $true; details = "OK" }
} else {
    Write-Host " FAIL (missing)" -ForegroundColor Red
    $results += @{ test = "packaged dist/renderer"; passed = $false; details = "File missing" }
    $allPassed = $false
}

# Test 7: Packaged app has dist/shared
Write-Host "  [7/7] Checking packaged app dist/shared..." -NoNewline
if (Test-Path "build-output/win-unpacked/resources/app/dist/shared/types.js") {
    Write-Host " OK" -ForegroundColor Green
    $results += @{ test = "packaged dist/shared"; passed = $true; details = "OK" }
} else {
    Write-Host " FAIL (missing)" -ForegroundColor Red
    $results += @{ test = "packaged dist/shared"; passed = $false; details = "File missing" }
    $allPassed = $false
}

Write-Host ""

# Final result
if ($allPassed) {
    Write-Host "BUILD VALIDATION PASSED" -ForegroundColor Green
    Write-Host "   All checks passed. Build is complete and ready." -ForegroundColor Gray
    exit 0
} else {
    Write-Host "BUILD VALIDATION FAILED" -ForegroundColor Red
    Write-Host "   Some checks failed. Build is incomplete or corrupted." -ForegroundColor Gray
    Write-Host ""
    Write-Host "Failed tests:" -ForegroundColor Yellow
    $results | Where-Object { -not $_.passed } | ForEach-Object {
        Write-Host "  - $($_.test): $($_.details)" -ForegroundColor Red
    }
    exit 1
}
