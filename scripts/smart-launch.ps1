# Smart Launch - Intelligent ProduTime launcher with automatic diagnostics
# This script launches ProduTime and automatically diagnoses any issues

param(
    [string]$BuildLocation = "desktop-export\win-unpacked",
    [int]$MonitorSeconds = 8
)

$ErrorActionPreference = "Continue"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$workspaceRoot = Split-Path -Parent $scriptDir

Write-Host ""
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "         ProduTime Smart Launch & Monitor System            " -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Determine which build to use
Write-Host "STEP 1: Locating ProduTime Build" -ForegroundColor Yellow
Write-Host "----------------------------------------------------------------"

$exePath = Join-Path $workspaceRoot "$BuildLocation\ProduTime.exe"

if (-not (Test-Path $exePath)) {
    Write-Host "[ERROR] Build not found at: $exePath" -ForegroundColor Red
    Write-Host ""
    Write-Host "Searching for available builds..." -ForegroundColor Yellow

    $availableBuilds = Get-ChildItem -Path $workspaceRoot -Recurse -Filter "ProduTime.exe" -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -notlike "*archive*" -and $_.FullName -notlike "*node_modules*" } |
        Sort-Object LastWriteTime -Descending

    if ($availableBuilds) {
        Write-Host ""
        Write-Host "Available builds:" -ForegroundColor Green
        for ($i = 0; $i -lt $availableBuilds.Count; $i++) {
            $build = $availableBuilds[$i]
            $relPath = $build.FullName.Replace($workspaceRoot, ".")
            $size = [math]::Round($build.Length / 1MB, 2)
            Write-Host "  [$i] $relPath" -ForegroundColor White
            Write-Host "      Size: $size MB | Modified: $($build.LastWriteTime)" -ForegroundColor Gray
        }

        # Use the most recent build
        $exePath = $availableBuilds[0].FullName
        Write-Host ""
        Write-Host "[OK] Using most recent build: $exePath" -ForegroundColor Green
    } else {
        Write-Host "[ERROR] No ProduTime builds found in workspace!" -ForegroundColor Red
        Write-Host "   Please run 'npm run build' first." -ForegroundColor Yellow
        exit 1
    }
}

Write-Host "[OK] Target: $exePath" -ForegroundColor Green
$appDir = Split-Path -Parent $exePath
Write-Host ""

# Step 2: Pre-flight checks
Write-Host "STEP 2: Pre-flight Checks" -ForegroundColor Yellow
Write-Host "----------------------------------------------------------------"

# Kill existing processes
$existing = Get-Process -Name "ProduTime" -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "[WARN] Terminating $($existing.Count) existing ProduTime process(es)..." -ForegroundColor Yellow
    $existing | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    Write-Host "[OK] Cleanup complete" -ForegroundColor Green
}

# Check for app.asar
$asarPath = Join-Path $appDir "resources\app.asar"
if (Test-Path $asarPath) {
    $asarSize = [math]::Round((Get-Item $asarPath).Length / 1MB, 2)
    Write-Host "[OK] app.asar found ($asarSize MB)" -ForegroundColor Green
} else {
    Write-Host "[ERROR] app.asar not found at: $asarPath" -ForegroundColor Red
    Write-Host "   Build may be incomplete!" -ForegroundColor Yellow
}

Write-Host ""

# Step 3: Launch with monitoring
Write-Host "STEP 3: Launching ProduTime" -ForegroundColor Yellow
Write-Host "----------------------------------------------------------------"

try {
    $process = Start-Process -FilePath $exePath -PassThru -ErrorAction Stop
    Write-Host "[OK] Process started (PID: $($process.Id))" -ForegroundColor Green
    Write-Host ""

    # Monitor for specified duration
    $monitorMsg = "STEP 4: Monitoring Startup (" + $MonitorSeconds + " seconds)"
    Write-Host $monitorMsg -ForegroundColor Yellow
    Write-Host "----------------------------------------------------------------"

    $success = $false
    $windowFound = $false

    for ($i = 1; $i -le $MonitorSeconds; $i++) {
        Start-Sleep -Seconds 1

        $proc = Get-Process -Id $process.Id -ErrorAction SilentlyContinue

        if (-not $proc) {
            Write-Host "[ERROR] Process terminated after $i seconds!" -ForegroundColor Red
            Write-Host "   Exit code: $($process.ExitCode)" -ForegroundColor Red
            break
        }

        # Check for window
        if ($proc.MainWindowHandle -ne 0 -and -not $windowFound) {
            $windowFound = $true
            Write-Host "[OK] Window detected!" -ForegroundColor Green
            Write-Host "   Title: $($proc.MainWindowTitle)" -ForegroundColor Gray
            Write-Host "   Handle: $($proc.MainWindowHandle)" -ForegroundColor Gray
        }

        # Progress
        $bar = "#" * $i + "." * ($MonitorSeconds - $i)
        $progressMsg = "   [$bar] $i/$MonitorSeconds sec"
        Write-Host "`r$progressMsg" -NoNewline -ForegroundColor Cyan

        if ($i -eq $MonitorSeconds) {
            $success = $true
        }
    }

    Write-Host ""
    Write-Host ""

    # Final status
    Write-Host "STEP 5: Final Status" -ForegroundColor Yellow
    Write-Host "----------------------------------------------------------------"

    $finalProc = Get-Process -Id $process.Id -ErrorAction SilentlyContinue

    if ($finalProc) {
        Write-Host "[SUCCESS] ProduTime is running!" -ForegroundColor Green
        Write-Host ""
        Write-Host "Process Details:" -ForegroundColor White
        Write-Host "  PID: $($finalProc.Id)" -ForegroundColor Gray
        Write-Host "  Memory: $([math]::Round($finalProc.WorkingSet64 / 1MB, 2)) MB" -ForegroundColor Gray
        Write-Host "  Threads: $($finalProc.Threads.Count)" -ForegroundColor Gray
        Write-Host "  CPU Time: $($finalProc.TotalProcessorTime.TotalSeconds) sec" -ForegroundColor Gray

        if ($windowFound) {
            Write-Host "  Window: VISIBLE [OK]" -ForegroundColor Green
        } else {
            Write-Host "  Window: Not detected (may be in system tray) [WARN]" -ForegroundColor Yellow
        }

        Write-Host ""
        Write-Host "================================================================" -ForegroundColor Green
        Write-Host "                    LAUNCH SUCCESSFUL                     " -ForegroundColor Green
        Write-Host "================================================================" -ForegroundColor Green

        exit 0
    } else {
        Write-Host "[FAILURE] ProduTime crashed or failed to start" -ForegroundColor Red
        Write-Host ""

        # Run diagnostics
        Write-Host "Running automatic diagnostics..." -ForegroundColor Yellow
        Write-Host ""

        $diagScript = Join-Path $scriptDir "diagnose-startup-failure.ps1"
        & $diagScript -AppPath $appDir

        exit 1
    }

} catch {
    Write-Host "[FATAL ERROR] Failed to launch process" -ForegroundColor Red
    Write-Host "   Error: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ""

    # Run diagnostics
    Write-Host "Running automatic diagnostics..." -ForegroundColor Yellow
    Write-Host ""

    $diagScript = Join-Path $scriptDir "diagnose-startup-failure.ps1"
    & $diagScript -AppPath $appDir

    exit 1
}
