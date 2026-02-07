# ============================================================================
# TAG WORKING VERSION
# ============================================================================
# This script tags the current state as a working version in Git.
# Use this after confirming a build works correctly.
# ============================================================================

param(
    [string]$Message = "Working version"
)

$ErrorActionPreference = 'Stop'

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  TAG WORKING VERSION" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

try {
    # Check if we're in a git repository
    $gitCheck = git rev-parse --git-dir 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "⚠️  Not a Git repository" -ForegroundColor Yellow
        Write-Host "   Skipping Git tagging" -ForegroundColor Gray
        Write-Host ""
        exit 0
    }
    
    # Check if there are uncommitted changes
    $status = git status --porcelain
    
    if ($status) {
        Write-Host "📝 Uncommitted changes detected" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "Do you want to commit these changes? (y/n): " -ForegroundColor Cyan -NoNewline
        $response = Read-Host
        
        if ($response -eq 'y' -or $response -eq 'Y') {
            # Stage all changes
            Write-Host ""
            Write-Host "📦 Staging changes..." -ForegroundColor Yellow
            git add -A
            
            # Create commit
            $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
            $commitMessage = "💾 $Message - $timestamp"
            
            Write-Host "💾 Creating commit..." -ForegroundColor Yellow
            git commit -m $commitMessage -m "Auto-saved working version"
            
            Write-Host "   ✓ Committed successfully" -ForegroundColor Green
            Write-Host ""
        } else {
            Write-Host ""
            Write-Host "⚠️  Tagging current state without committing changes" -ForegroundColor Yellow
            Write-Host ""
        }
    }
    
    # Create tag
    $timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
    $tag = "working-$timestamp"
    
    Write-Host "🏷️  Creating tag: $tag" -ForegroundColor Cyan
    git tag -a $tag -m "$Message - $timestamp"
    
    Write-Host ""
    Write-Host "✅ Tagged successfully!" -ForegroundColor Green
    Write-Host ""
    Write-Host "📋 Tag Details:" -ForegroundColor Cyan
    Write-Host "   Tag: $tag" -ForegroundColor White
    Write-Host "   Message: $Message" -ForegroundColor White
    Write-Host ""
    Write-Host "🔄 To rollback to this version:" -ForegroundColor Yellow
    Write-Host "   git checkout $tag" -ForegroundColor White
    Write-Host ""
    Write-Host "📜 To list all working versions:" -ForegroundColor Yellow
    Write-Host "   git tag -l `"working-*`"" -ForegroundColor White
    Write-Host ""
    
} catch {
    Write-Host "❌ Error: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ""
    exit 1
}

Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

