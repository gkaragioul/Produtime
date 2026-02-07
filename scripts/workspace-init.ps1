# ============================================================================
# WORKSPACE INITIALIZATION
# ============================================================================
# This script runs automatically when VS Code opens the workspace.
# It ensures all safety mechanisms are in place.
# ============================================================================

$ErrorActionPreference = 'Continue'

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  🚀 PRODUTIME WORKSPACE INIT" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

$issuesFound = $false

# 1. Check Git hooks installation
Write-Host "🔍 Checking Git hooks..." -ForegroundColor Yellow

if (Test-Path ".husky\_\husky.sh") {
    Write-Host "   ✅ Git hooks installed" -ForegroundColor Green
} else {
    Write-Host "   ⚠️  Git hooks not installed" -ForegroundColor Yellow
    Write-Host "   Installing now..." -ForegroundColor Gray
    
    try {
        npm run prepare 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) {
            Write-Host "   ✅ Git hooks installed successfully" -ForegroundColor Green
        } else {
            Write-Host "   ⚠️  Could not install Git hooks" -ForegroundColor Yellow
            $issuesFound = $true
        }
    } catch {
        Write-Host "   ⚠️  Could not install Git hooks" -ForegroundColor Yellow
        $issuesFound = $true
    }
}
Write-Host ""

# 2. Verify PROTECTED_BACKUPS folder
Write-Host "🔍 Checking backup system..." -ForegroundColor Yellow

if (Test-Path "PROTECTED_BACKUPS") {
    $backupCount = (Get-ChildItem "PROTECTED_BACKUPS" -Directory -ErrorAction SilentlyContinue).Count
    Write-Host "   ✅ PROTECTED_BACKUPS exists ($backupCount backups)" -ForegroundColor Green
} else {
    Write-Host "   ⚠️  PROTECTED_BACKUPS folder missing!" -ForegroundColor Red
    Write-Host "   Creating folder..." -ForegroundColor Gray
    New-Item -ItemType Directory -Path "PROTECTED_BACKUPS" -Force | Out-Null
    Write-Host "   ✅ Created PROTECTED_BACKUPS" -ForegroundColor Green
    $issuesFound = $true
}
Write-Host ""

# 3. Check test setup
Write-Host "🔍 Checking test infrastructure..." -ForegroundColor Yellow

if (Test-Path "src\__tests__") {
    $testCount = (Get-ChildItem "src\__tests__" -Filter "*.test.ts" -Recurse -ErrorAction SilentlyContinue).Count
    Write-Host "   ✅ Test directory exists ($testCount tests)" -ForegroundColor Green
} else {
    Write-Host "   ⚠️  Test directory missing" -ForegroundColor Yellow
    Write-Host "   Creating src\__tests__\unit\" -ForegroundColor Gray
    New-Item -ItemType Directory -Path "src\__tests__\unit" -Force | Out-Null
    New-Item -ItemType Directory -Path "src\__tests__\integration" -Force | Out-Null
    Write-Host "   ✅ Created test directories" -ForegroundColor Green
    $issuesFound = $true
}
Write-Host ""

# 4. Verify workspace rules documentation
Write-Host "🔍 Checking documentation..." -ForegroundColor Yellow

if (Test-Path "WORKSPACE_RULES.md") {
    Write-Host "   ✅ WORKSPACE_RULES.md exists" -ForegroundColor Green
} else {
    Write-Host "   ⚠️  WORKSPACE_RULES.md missing" -ForegroundColor Yellow
    $issuesFound = $true
}

if (Test-Path "CONTRIBUTING.md") {
    Write-Host "   ✅ CONTRIBUTING.md exists" -ForegroundColor Green
} else {
    Write-Host "   ⚠️  CONTRIBUTING.md missing" -ForegroundColor Yellow
    $issuesFound = $true
}
Write-Host ""

# 5. Display workspace rules
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  📋 WORKSPACE RULES (ALWAYS FOLLOW)" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  ✅ Write tests FIRST (TDD)" -ForegroundColor White
Write-Host "     → npm run tdd `"FeatureName`"" -ForegroundColor Gray
Write-Host ""
Write-Host "  ✅ Run tests before committing" -ForegroundColor White
Write-Host "     → npm test (auto-runs on commit)" -ForegroundColor Gray
Write-Host ""
Write-Host "  ✅ Automatic backup before build" -ForegroundColor White
Write-Host "     → Saved to PROTECTED_BACKUPS/" -ForegroundColor Gray
Write-Host ""
Write-Host "  ✅ Never edit dist/ or release/" -ForegroundColor White
Write-Host "     → Only edit src/ directory" -ForegroundColor Gray
Write-Host ""
Write-Host "  ✅ Tag working versions" -ForegroundColor White
Write-Host "     → npm run save:working" -ForegroundColor Gray
Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

if ($issuesFound) {
    Write-Host "⚠️  Some issues were found and fixed" -ForegroundColor Yellow
    Write-Host "   Please review the output above" -ForegroundColor Gray
    Write-Host ""
} else {
    Write-Host "✅ Workspace is ready!" -ForegroundColor Green
    Write-Host ""
}

Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

