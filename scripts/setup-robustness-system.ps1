# ============================================================================
# SETUP ROBUSTNESS SYSTEM
# ============================================================================
# This script sets up the complete robustness system for ProduTime workspace.
# Run this ONCE to activate all safety mechanisms.
# ============================================================================

$ErrorActionPreference = 'Continue'

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  🛡️  ROBUSTNESS SYSTEM SETUP" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "This will set up:" -ForegroundColor White
Write-Host "  ✅ Git hooks (pre-commit, pre-push)" -ForegroundColor Gray
Write-Host "  ✅ Automatic backups before builds" -ForegroundColor Gray
Write-Host "  ✅ TDD workflow enforcement" -ForegroundColor Gray
Write-Host "  ✅ Workspace cleanup automation" -ForegroundColor Gray
Write-Host "  ✅ Quality gates and testing" -ForegroundColor Gray
Write-Host ""

$startTime = Get-Date

# 1. Install Git hooks
Write-Host "📌 Step 1: Installing Git hooks..." -ForegroundColor Yellow
Write-Host ""

npm run prepare 2>&1 | Out-Null

if ($LASTEXITCODE -eq 0) {
    Write-Host "   Git hooks installed" -ForegroundColor Green

    # Make hooks executable (for Git Bash compatibility)
    if (Test-Path ".husky\pre-commit") {
        Write-Host "   pre-commit hook ready" -ForegroundColor Gray
    }
    if (Test-Path ".husky\pre-push") {
        Write-Host "   pre-push hook ready" -ForegroundColor Gray
    }
    if (Test-Path ".husky\commit-msg") {
        Write-Host "   commit-msg hook ready" -ForegroundColor Gray
    }
} else {
    Write-Host "   Git hooks installation had issues" -ForegroundColor Yellow
}
Write-Host ""

# 2. Verify PROTECTED_BACKUPS
Write-Host "📌 Step 2: Verifying backup system..." -ForegroundColor Yellow
Write-Host ""

if (Test-Path "PROTECTED_BACKUPS") {
    $backupCount = (Get-ChildItem "PROTECTED_BACKUPS" -Directory -ErrorAction SilentlyContinue).Count
    Write-Host "   PROTECTED_BACKUPS exists - $backupCount backups" -ForegroundColor Green
} else {
    Write-Host "   Creating PROTECTED_BACKUPS folder..." -ForegroundColor Gray
    New-Item -ItemType Directory -Path "PROTECTED_BACKUPS" -Force | Out-Null
    Write-Host "   PROTECTED_BACKUPS created" -ForegroundColor Green
}
Write-Host ""

# 3. Verify test infrastructure
Write-Host "📌 Step 3: Verifying test infrastructure..." -ForegroundColor Yellow
Write-Host ""

if (-not (Test-Path "src\__tests__\unit")) {
    Write-Host "   Creating test directories..." -ForegroundColor Gray
    New-Item -ItemType Directory -Path "src\__tests__\unit" -Force | Out-Null
    New-Item -ItemType Directory -Path "src\__tests__\integration" -Force | Out-Null
    Write-Host "   Test directories created" -ForegroundColor Green
} else {
    $testCount = (Get-ChildItem "src\__tests__" -Filter "*.test.ts" -Recurse -ErrorAction SilentlyContinue).Count
    Write-Host "   Test infrastructure ready - $testCount tests" -ForegroundColor Green
}
Write-Host ""

# 4. Run initial tests
Write-Host "📌 Step 4: Running initial tests..." -ForegroundColor Yellow
Write-Host ""

npm test -- --passWithNoTests

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "   All tests passed" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "   Some tests failed (this is OK for initial setup)" -ForegroundColor Yellow
}
Write-Host ""

# 5. Verify VS Code configuration
Write-Host "📌 Step 5: Verifying VS Code configuration..." -ForegroundColor Yellow
Write-Host ""

if (Test-Path ".vscode\tasks.json") {
    Write-Host "   VS Code tasks configured" -ForegroundColor Green
} else {
    Write-Host "   VS Code tasks.json missing" -ForegroundColor Yellow
}

if (Test-Path ".vscode\settings.json") {
    Write-Host "   VS Code settings configured" -ForegroundColor Green
} else {
    Write-Host "   VS Code settings.json missing" -ForegroundColor Yellow
}
Write-Host ""

# 6. Display available commands
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  📋 AVAILABLE COMMANDS" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Testing:" -ForegroundColor White
Write-Host "  npm test                    - Run all tests" -ForegroundColor Gray
Write-Host "  npm run test:watch          - Run tests in watch mode" -ForegroundColor Gray
Write-Host "  npm run tdd `"Feature`"       - Start TDD workflow" -ForegroundColor Gray
Write-Host ""
Write-Host "Building:" -ForegroundColor White
Write-Host "  npm run build               - Build app (auto-backup)" -ForegroundColor Gray
Write-Host "  npm start                   - Run built app" -ForegroundColor Gray
Write-Host ""
Write-Host "Version Control:" -ForegroundColor White
Write-Host "  npm run save:working        - Tag working version" -ForegroundColor Gray
Write-Host "  git tag -l `"working-*`"      - List working versions" -ForegroundColor Gray
Write-Host ""
Write-Host "Maintenance:" -ForegroundColor White
Write-Host "  npm run maintenance:weekly  - Run weekly maintenance" -ForegroundColor Gray
Write-Host "  npm run workspace:init      - Re-initialize workspace" -ForegroundColor Gray
Write-Host ""

# 7. Summary
$endTime = Get-Date
$duration = $endTime - $startTime

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  ✅ SETUP COMPLETE!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "The robustness system is now active!" -ForegroundColor White
Write-Host ""
Write-Host "What happens automatically:" -ForegroundColor Cyan
Write-Host "  - Tests run before every commit" -ForegroundColor Gray
Write-Host "  - Code is auto-formatted on commit" -ForegroundColor Gray
Write-Host "  - Backup created before every build" -ForegroundColor Gray
Write-Host "  - Workspace cleaned after build" -ForegroundColor Gray
Write-Host "  - Workspace initializes on VS Code open" -ForegroundColor Gray
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Read WORKSPACE_RULES.md" -ForegroundColor White
Write-Host "  2. Read CONTRIBUTING.md" -ForegroundColor White
Write-Host "  3. Try: npm run tdd `"TestFeature`"" -ForegroundColor White
Write-Host ""
Write-Host "Setup time: $([math]::Round($duration.TotalSeconds, 2)) seconds" -ForegroundColor Gray
Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
