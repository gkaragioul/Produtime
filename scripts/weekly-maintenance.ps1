# ============================================================================
# WEEKLY MAINTENANCE
# ============================================================================
# Run this script weekly to maintain workspace health.
# It checks dependencies, runs tests, and creates backups.
# ============================================================================

$ErrorActionPreference = 'Continue'

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  🔧 WEEKLY MAINTENANCE" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

$startTime = Get-Date

# 1. Check for dependency updates
Write-Host "📦 Checking for dependency updates..." -ForegroundColor Yellow
Write-Host ""

npm outdated

Write-Host ""
Write-Host "   ℹ️  Review updates above" -ForegroundColor Cyan
Write-Host "   To update: npm update" -ForegroundColor Gray
Write-Host ""

# 2. Run security audit
Write-Host "🔒 Running security audit..." -ForegroundColor Yellow
Write-Host ""

npm audit

Write-Host ""
$auditResult = $LASTEXITCODE
if ($auditResult -eq 0) {
    Write-Host "   ✅ No vulnerabilities found" -ForegroundColor Green
} else {
    Write-Host "   ⚠️  Vulnerabilities detected" -ForegroundColor Yellow
    Write-Host "   To fix: npm audit fix" -ForegroundColor Gray
}
Write-Host ""

# 3. Run full test suite
Write-Host "🧪 Running full test suite..." -ForegroundColor Yellow
Write-Host ""

npm test

Write-Host ""
$testResult = $LASTEXITCODE
if ($testResult -eq 0) {
    Write-Host "   ✅ All tests passed" -ForegroundColor Green
} else {
    Write-Host "   ❌ Some tests failed" -ForegroundColor Red
    Write-Host "   Please fix failing tests before continuing" -ForegroundColor Yellow
}
Write-Host ""

# 4. Check code quality
Write-Host "📝 Checking code quality..." -ForegroundColor Yellow
Write-Host ""

npm run lint

Write-Host ""
$lintResult = $LASTEXITCODE
if ($lintResult -eq 0) {
    Write-Host "   ✅ No linting issues" -ForegroundColor Green
} else {
    Write-Host "   ⚠️  Linting issues found" -ForegroundColor Yellow
    Write-Host "   To fix: npm run lint:fix" -ForegroundColor Gray
}
Write-Host ""

# 5. Create weekly backup
Write-Host "💾 Creating weekly backup..." -ForegroundColor Yellow

if (Test-Path "release\win-unpacked\ProduTime.exe") {
    $timestamp = Get-Date -Format "yyyy-MM-dd"
    $backupPath = "PROTECTED_BACKUPS\ProduTime-Weekly-$timestamp"
    
    if (-not (Test-Path $backupPath)) {
        try {
            Copy-Item -Path "release\win-unpacked" -Destination $backupPath -Recurse -Force -ErrorAction Stop
            $backupSize = (Get-ChildItem -Path $backupPath -Recurse | Measure-Object -Property Length -Sum).Sum / 1MB
            Write-Host "   ✅ Weekly backup created" -ForegroundColor Green
            Write-Host "      Location: $backupPath" -ForegroundColor Gray
            Write-Host "      Size: $([math]::Round($backupSize, 2)) MB" -ForegroundColor Gray
        } catch {
            Write-Host "   ⚠️  Could not create backup: $($_.Exception.Message)" -ForegroundColor Yellow
        }
    } else {
        Write-Host "   ℹ️  Weekly backup already exists for today" -ForegroundColor Cyan
    }
} else {
    Write-Host "   ⚠️  No build found to backup" -ForegroundColor Yellow
}
Write-Host ""

# 6. Clean up old weekly backups (keep last 4 weeks)
Write-Host "🧹 Cleaning up old weekly backups..." -ForegroundColor Yellow

$oldWeeklyBackups = Get-ChildItem "PROTECTED_BACKUPS" -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like "ProduTime-Weekly-*" } |
    Sort-Object Name -Descending |
    Select-Object -Skip 4

if ($oldWeeklyBackups) {
    foreach ($old in $oldWeeklyBackups) {
        try {
            Remove-Item $old.FullName -Recurse -Force -ErrorAction Stop
            Write-Host "   🗑️  Removed: $($old.Name)" -ForegroundColor Gray
        } catch {
            Write-Host "   ⚠️  Could not remove: $($old.Name)" -ForegroundColor Yellow
        }
    }
} else {
    Write-Host "   ✓ No old backups to clean" -ForegroundColor Gray
}
Write-Host ""

# 7. Summary
$endTime = Get-Date
$duration = $endTime - $startTime

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  📊 MAINTENANCE SUMMARY" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Tests: " -NoNewline
if ($testResult -eq 0) { Write-Host "PASSED ✅" -ForegroundColor Green } else { Write-Host "FAILED ❌" -ForegroundColor Red }
Write-Host "  Linting: " -NoNewline
if ($lintResult -eq 0) { Write-Host "PASSED ✅" -ForegroundColor Green } else { Write-Host "ISSUES ⚠️" -ForegroundColor Yellow }
Write-Host "  Security: " -NoNewline
if ($auditResult -eq 0) { Write-Host "CLEAN ✅" -ForegroundColor Green } else { Write-Host "VULNERABILITIES ⚠️" -ForegroundColor Yellow }
Write-Host ""
Write-Host "  Duration: $([math]::Round($duration.TotalMinutes, 2)) minutes" -ForegroundColor Gray
Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

