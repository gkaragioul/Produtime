# ============================================================================
# TDD WORKFLOW HELPER
# ============================================================================
# This script helps enforce Test-Driven Development workflow.
# It guides you through the TDD cycle: Red → Green → Refactor
# ============================================================================

param(
    [Parameter(Mandatory=$false)]
    [string]$Feature = ""
)

$ErrorActionPreference = 'Continue'

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  🧪 TDD WORKFLOW" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

if ($Feature) {
    Write-Host "Feature: $Feature" -ForegroundColor White
    Write-Host ""
}

Write-Host "📋 TDD Cycle (Red → Green → Refactor):" -ForegroundColor Cyan
Write-Host ""
Write-Host "  1️⃣  Write a failing test (RED)" -ForegroundColor Red
Write-Host "      → Create test in src/__tests__/" -ForegroundColor Gray
Write-Host "      → Test should fail initially" -ForegroundColor Gray
Write-Host ""
Write-Host "  2️⃣  Write minimal code to pass (GREEN)" -ForegroundColor Green
Write-Host "      → Implement just enough to pass the test" -ForegroundColor Gray
Write-Host "      → Don't over-engineer" -ForegroundColor Gray
Write-Host ""
Write-Host "  3️⃣  Refactor and improve (REFACTOR)" -ForegroundColor Yellow
Write-Host "      → Clean up code" -ForegroundColor Gray
Write-Host "      → Ensure tests still pass" -ForegroundColor Gray
Write-Host ""
Write-Host "  4️⃣  Repeat for next feature" -ForegroundColor Cyan
Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Check if test directory exists
if (-not (Test-Path "src\__tests__")) {
    Write-Host "⚠️  Test directory not found!" -ForegroundColor Yellow
    Write-Host "   Creating src\__tests__\unit\" -ForegroundColor Gray
    New-Item -ItemType Directory -Path "src\__tests__\unit" -Force | Out-Null
    Write-Host "   ✓ Created" -ForegroundColor Green
    Write-Host ""
}

# Offer to create a test file
if ($Feature) {
    $testFileName = $Feature -replace '[^a-zA-Z0-9]', '-'
    $testFileName = $testFileName.ToLower()
    $testPath = "src\__tests__\unit\$testFileName.test.ts"
    
    if (-not (Test-Path $testPath)) {
        Write-Host "📝 Create test file for '$Feature'? (y/n): " -ForegroundColor Cyan -NoNewline
        $response = Read-Host
        
        if ($response -eq 'y' -or $response -eq 'Y') {
            $template = @"
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';

describe('$Feature', () => {
  beforeEach(() => {
    // Setup before each test
  });

  afterEach(() => {
    // Cleanup after each test
  });

  it('should exist', () => {
    // TODO: Replace with actual test
    expect(true).toBe(true);
  });

  // TODO: Add more tests following TDD:
  // 1. Write test (it should fail - RED)
  // 2. Write minimal code to pass (GREEN)
  // 3. Refactor (keep tests passing)
});
"@
            
            New-Item -Path $testPath -Value $template -Force | Out-Null
            Write-Host ""
            Write-Host "✅ Test file created: $testPath" -ForegroundColor Green
            Write-Host ""
        }
    }
}

Write-Host "🚀 Starting test watcher..." -ForegroundColor Cyan
Write-Host "   Press Ctrl+C to exit" -ForegroundColor Gray
Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Start Jest in watch mode
npm run test:watch

