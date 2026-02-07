# ProduTime Launch and Monitor Script
# Comprehensive logging and monitoring system for automatic diagnostics

param(
    [string]$ExePath = ".\desktop-export\win-unpacked\ProduTime.exe",
    [int]$MonitorDurationSeconds = 10,
    [string]$LogOutputPath = ".\logs\launch-monitor.log"
)

$ErrorActionPreference = "Continue"
$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

# Ensure logs directory exists
$logsDir = Split-Path -Parent $LogOutputPath
if (-not (Test-Path $logsDir)) {
    New-Item -ItemType Directory -Path $logsDir -Force | Out-Null
}

# Initialize log file
function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $logMessage = "[$timestamp] [$Level] $Message"
    Write-Host $logMessage
    Add-Content -Path $LogOutputPath -Value $logMessage
}

Write-Log "========================================" "HEADER"
Write-Log "ProduTime Launch & Monitor System" "HEADER"
Write-Log "========================================" "HEADER"
Write-Log "Executable: $ExePath"
Write-Log "Monitor Duration: $MonitorDurationSeconds seconds"
Write-Log ""

# Step 1: Pre-launch validation
Write-Log "STEP 1: PRE-LAUNCH VALIDATION" "INFO"
Write-Log "----------------------------------------"

if (-not (Test-Path $ExePath)) {
    Write-Log "❌ FATAL: Executable not found at: $ExePath" "ERROR"
    Write-Log "Available ProduTime.exe locations:" "INFO"
    Get-ChildItem -Path "." -Recurse -Filter "ProduTime.exe" -ErrorAction SilentlyContinue | 
        Where-Object { $_.FullName -notlike "*archive*" -and $_.FullName -notlike "*node_modules*" } |
        ForEach-Object { Write-Log "  - $($_.FullName)" "INFO" }
    exit 1
}

Write-Log "✅ Executable found: $ExePath" "SUCCESS"

# Get file info
$fileInfo = Get-Item $ExePath
Write-Log "  Size: $([math]::Round($fileInfo.Length / 1MB, 2)) MB" "INFO"
Write-Log "  Last Modified: $($fileInfo.LastWriteTime)" "INFO"
Write-Log ""

# Step 2: Check for existing processes
Write-Log "STEP 2: CHECKING FOR EXISTING PROCESSES" "INFO"
Write-Log "----------------------------------------"

$existingProcesses = Get-Process -Name "ProduTime" -ErrorAction SilentlyContinue
if ($existingProcesses) {
    Write-Log "⚠️  Found $($existingProcesses.Count) existing ProduTime process(es)" "WARN"
    foreach ($proc in $existingProcesses) {
        Write-Log "  PID: $($proc.Id) | Path: $($proc.Path) | Started: $($proc.StartTime)" "INFO"
    }
    Write-Log "  Terminating existing processes..." "INFO"
    $existingProcesses | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    Write-Log "✅ Existing processes terminated" "SUCCESS"
} else {
    Write-Log "✅ No existing ProduTime processes found" "SUCCESS"
}
Write-Log ""

# Step 3: Check for error logs from previous runs
Write-Log "STEP 3: CHECKING FOR PREVIOUS ERROR LOGS" "INFO"
Write-Log "----------------------------------------"

$errorLogLocations = @(
    ".\desktop-export\win-unpacked\error-desktop-export.log",
    ".\release\win-unpacked\error.log",
    ".\logs\error.log",
    "$env:APPDATA\ProduTime\error.log",
    "$env:LOCALAPPDATA\ProduTime\error.log"
)

foreach ($logPath in $errorLogLocations) {
    if (Test-Path $logPath) {
        $logContent = Get-Content $logPath -Tail 20 -ErrorAction SilentlyContinue
        if ($logContent) {
            Write-Log "📄 Found error log: $logPath" "INFO"
            Write-Log "  Last 5 lines:" "INFO"
            $logContent | Select-Object -Last 5 | ForEach-Object { Write-Log "    $_" "INFO" }
        }
    }
}
Write-Log ""

# Step 4: Launch the application
Write-Log "STEP 4: LAUNCHING APPLICATION" "INFO"
Write-Log "----------------------------------------"

try {
    Write-Log "🚀 Starting ProduTime..." "INFO"
    $process = Start-Process -FilePath $ExePath -PassThru -ErrorAction Stop
    Write-Log "✅ Process started with PID: $($process.Id)" "SUCCESS"
    Write-Log ""
} catch {
    Write-Log "❌ FATAL: Failed to start process" "ERROR"
    Write-Log "  Error: $($_.Exception.Message)" "ERROR"
    exit 1
}

# Step 5: Monitor the process
Write-Log "STEP 5: MONITORING PROCESS (${MonitorDurationSeconds}s)" "INFO"
Write-Log "----------------------------------------"

$monitorStart = Get-Date
$processAlive = $true
$windowDetected = $false

for ($i = 0; $i -lt $MonitorDurationSeconds; $i++) {
    Start-Sleep -Seconds 1
    
    # Check if process is still running
    $currentProcess = Get-Process -Id $process.Id -ErrorAction SilentlyContinue
    
    if (-not $currentProcess) {
        $processAlive = $false
        Write-Log "❌ CRITICAL: Process terminated unexpectedly after $i seconds" "ERROR"
        Write-Log "  Exit Code: $($process.ExitCode)" "ERROR"
        break
    }
    
    # Check for window
    if (-not $windowDetected -and $currentProcess.MainWindowHandle -ne 0) {
        $windowDetected = $true
        Write-Log "✅ Window detected: $($currentProcess.MainWindowTitle)" "SUCCESS"
        Write-Log "  Window Handle: $($currentProcess.MainWindowHandle)" "INFO"
    }
    
    # Progress indicator
    if ($i % 2 -eq 0) {
        Write-Log "  ⏱️  Monitoring... ${i}s elapsed" "INFO"
    }
}

Write-Log ""

# Step 6: Final status report
Write-Log "STEP 6: FINAL STATUS REPORT" "INFO"
Write-Log "========================================" "HEADER"

if ($processAlive) {
    $finalProcess = Get-Process -Id $process.Id -ErrorAction SilentlyContinue
    Write-Log "✅ SUCCESS: ProduTime is running" "SUCCESS"
    Write-Log "  PID: $($finalProcess.Id)" "INFO"
    Write-Log "  Memory Usage: $([math]::Round($finalProcess.WorkingSet64 / 1MB, 2)) MB" "INFO"
    Write-Log "  CPU Time: $($finalProcess.TotalProcessorTime)" "INFO"
    Write-Log "  Threads: $($finalProcess.Threads.Count)" "INFO"
    
    if ($windowDetected) {
        Write-Log "  Window Title: $($finalProcess.MainWindowTitle)" "INFO"
        Write-Log "  Window Visible: YES" "SUCCESS"
    } else {
        Write-Log "  ⚠️  WARNING: No window detected (may be minimized to tray)" "WARN"
    }
} else {
    Write-Log "❌ FAILURE: ProduTime failed to start or crashed" "ERROR"
    Write-Log "  Checking for crash logs..." "INFO"
    
    # Check error logs again
    foreach ($logPath in $errorLogLocations) {
        if (Test-Path $logPath) {
            $logModified = (Get-Item $logPath).LastWriteTime
            if ($logModified -gt $monitorStart) {
                Write-Log "📄 NEW ERROR LOG DETECTED: $logPath" "ERROR"
                $newErrors = Get-Content $logPath -Tail 10
                Write-Log "  Recent errors:" "ERROR"
                $newErrors | ForEach-Object { Write-Log "    $_" "ERROR" }
            }
        }
    }
}

Write-Log ""
Write-Log "========================================" "HEADER"
Write-Log "Monitoring complete. Log saved to: $LogOutputPath" "INFO"
Write-Log "========================================" "HEADER"

# Return exit code
if ($processAlive) { exit 0 } else { exit 1 }

