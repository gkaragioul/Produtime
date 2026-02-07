# Auto Cleanup Script
# Safe workspace tidying with logging

param()

$ErrorActionPreference = "Continue"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$docsRoot = Join-Path $root "docs-root"
$logDir = Join-Path $docsRoot "cleanup-logs"

if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir | Out-Null
}

$timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$logFile = Join-Path $logDir ("cleanup-" + $timestamp + ".log")

function Write-Log {
    param(
        [string]$Message,
        [string]$Color = "Gray"
    )

    $time = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "[$time] $Message"
    Write-Host $line -ForegroundColor $Color
    Add-Content -Path $logFile -Value $line
}

Write-Log "Starting workspace auto-cleanup..." "Cyan"

# Section 1: Root-level documentation files
Write-Log "Scanning root-level documentation files..." "Yellow"

$allowedRootDocs = @(
    "README.md",
    "CHANGELOG.auto.md",
    "MASTER_AI_INSTRUCTIONS.md"
)

$rootDocs = Get-ChildItem -Path $root -File -Include *.md,*.txt | Where-Object {
    $allowedRootDocs -notcontains $_.Name
}

foreach ($file in $rootDocs) {
    try {
        $targetDir = Join-Path $docsRoot "_root"
        if (-not (Test-Path $targetDir)) {
            New-Item -ItemType Directory -Path $targetDir | Out-Null
        }
        $targetPath = Join-Path $targetDir $file.Name
        Write-Log "Moving root doc '$($file.Name)' to '$targetPath'" "Gray"
        Move-Item -Path $file.FullName -Destination $targetPath -Force
    } catch {
        Write-Log "WARNING: Failed to move '$($file.FullName)': $($_.Exception.Message)" "Yellow"
    }
}

# Section 2: License Manager stale build folders
Write-Log "Checking for stale License Manager build folders..." "Yellow"

$lmPaths = @(
    "license-manager\release-final",
    "license-manager\release-vps-fixed",
    "license-manager\release-vps-new",
    "license-manager\release-vps\win-arm64-unpacked"
)

foreach ($path in $lmPaths) {
    $fullPath = Join-Path $root $path
    if (Test-Path $fullPath) {
        try {
            Write-Log "Removing stale folder '$fullPath'..." "Gray"
            Remove-Item -Path $fullPath -Recurse -Force
            Write-Log "Removed '$fullPath'" "Green"
        } catch {
            Write-Log "WARNING: Could not remove '$fullPath' (likely in use): $($_.Exception.Message)" "Yellow"
        }
    }
}

Write-Log "Workspace auto-cleanup complete." "Green"

