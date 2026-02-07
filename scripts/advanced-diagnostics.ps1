# Advanced ProduTime Diagnostic System
# Captures error dialogs, monitors processes, and performs root cause analysis

param(
    [int]$MonitorSeconds = 30,
    [string]$AppPath = ".\desktop-export\win-unpacked\ProduTime.exe"
)

# Add Windows Forms for UI Automation
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

# Add Win32 API for window enumeration and text capture
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public class Win32 {
    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr FindWindowEx(IntPtr hwndParent, IntPtr hwndChildAfter, string lpszClass, string lpszWindow);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc enumProc, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool EnumChildWindows(IntPtr hwndParent, EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
}
"@

$script:DiagnosticData = @{
    ErrorDialogs = @()
    ProcessEvents = @()
    FileAccess = @()
    LogErrors = @()
    CrashDumps = @()
    WindowHistory = @()
}

$script:LogFile = "logs\advanced-diagnostics-$(Get-Date -Format 'yyyy-MM-dd_HH-mm-ss').log"
New-Item -ItemType Directory -Force -Path "logs" | Out-Null

function Write-DiagLog {
    param([string]$Message, [string]$Level = "INFO")
    $timestamp = Get-Date -Format "HH:mm:ss.fff"
    $logEntry = "[$timestamp] [$Level] $Message"
    Add-Content -Path $script:LogFile -Value $logEntry

    switch ($Level) {
        "ERROR" { Write-Host $logEntry -ForegroundColor Red }
        "WARN"  { Write-Host $logEntry -ForegroundColor Yellow }
        "SUCCESS" { Write-Host $logEntry -ForegroundColor Green }
        default { Write-Host $logEntry -ForegroundColor Gray }
    }
}

function Get-WindowText {
    param([IntPtr]$hWnd)
    $sb = New-Object System.Text.StringBuilder 1024
    [Win32]::GetWindowText($hWnd, $sb, $sb.Capacity) | Out-Null
    return $sb.ToString()
}

function Get-ClassName {
    param([IntPtr]$hWnd)
    $sb = New-Object System.Text.StringBuilder 256
    [Win32]::GetClassName($hWnd, $sb, $sb.Capacity) | Out-Null
    return $sb.ToString()
}

function Get-AllWindowsForProcess {
    param([int]$ProcessId)

    $windows = @()
    $callback = {
        param($hWnd, $lParam)

        $pid = 0
        [Win32]::GetWindowThreadProcessId($hWnd, [ref]$pid) | Out-Null

        if ($pid -eq $ProcessId -and [Win32]::IsWindowVisible($hWnd)) {
            $title = Get-WindowText -hWnd $hWnd
            $className = Get-ClassName -hWnd $hWnd

            $windows += @{
                Handle = $hWnd
                Title = $title
                ClassName = $className
                Children = @()
            }
        }
        return $true
    }

    [Win32]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null
    return $windows
}

function Capture-ErrorDialogContent {
    param([int]$ProcessId)

    Write-DiagLog "Scanning for error dialogs..." "INFO"

    $windows = Get-AllWindowsForProcess -ProcessId $ProcessId

    foreach ($window in $windows) {
        $title = $window.Title
        $className = $window.ClassName

        Write-DiagLog "Found window: Title='$title', Class='$className'" "INFO"

        # Check if this looks like an error dialog
        if ($title -match "error|exception|fatal|crash|problem" -or
            $className -match "#32770|Dialog") {

            Write-DiagLog "POTENTIAL ERROR DIALOG DETECTED!" "ERROR"
            Write-DiagLog "  Title: $title" "ERROR"
            Write-DiagLog "  Class: $className" "ERROR"

            # Try to enumerate child windows to get button/text content
            $childCallback = {
                param($hWndChild, $lParam)

                $childText = Get-WindowText -hWnd $hWndChild
                $childClass = Get-ClassName -hWnd $hWndChild

                if ($childText) {
                    Write-DiagLog "  Child: Class='$childClass', Text='$childText'" "ERROR"
                    $script:DiagnosticData.ErrorDialogs += @{
                        ParentTitle = $title
                        ChildClass = $childClass
                        ChildText = $childText
                    }
                }
                return $true
            }

            [Win32]::EnumChildWindows($window.Handle, $childCallback, [IntPtr]::Zero) | Out-Null
        }
    }
}

Write-Host ""
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "     Advanced ProduTime Diagnostic & Monitoring System" -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host ""

Write-DiagLog "Starting advanced diagnostics..." "INFO"
Write-DiagLog "Log file: $script:LogFile" "INFO"
Write-Host ""

# STEP 1: Pre-flight checks
Write-Host "STEP 1: Pre-flight System Checks" -ForegroundColor Cyan
Write-Host "----------------------------------------------------------------" -ForegroundColor Gray

# Resolve app path
$AppPath = Resolve-Path $AppPath -ErrorAction SilentlyContinue
if (-not $AppPath) {
    Write-DiagLog "App not found at specified path!" "ERROR"
    exit 1
}

Write-DiagLog "Target: $AppPath" "SUCCESS"

# Check for crash dumps
$crashDumpLocations = @(
    "$env:LOCALAPPDATA\CrashDumps",
    "$env:TEMP\ProduTime Crashes",
    ".\desktop-export\win-unpacked\crashes"
)

foreach ($loc in $crashDumpLocations) {
    if (Test-Path $loc) {
        $dumps = Get-ChildItem -Path $loc -Filter "*.dmp" -ErrorAction SilentlyContinue |
                 Where-Object { $_.LastWriteTime -gt (Get-Date).AddHours(-1) }
        if ($dumps) {
            Write-DiagLog "Recent crash dumps found in $loc" "WARN"
            $script:DiagnosticData.CrashDumps += $dumps
        }
    }
}

# Check file permissions
try {
    $acl = Get-Acl $AppPath
    Write-DiagLog "File permissions OK" "SUCCESS"
} catch {
    Write-DiagLog "Permission check failed: $_" "ERROR"
}

# Check dependencies
$appDir = Split-Path $AppPath
$requiredFiles = @("app.asar", "resources.pak", "chrome_100_percent.pak")
foreach ($file in $requiredFiles) {
    $filePath = Join-Path $appDir "resources\$file"
    if (Test-Path $filePath) {
        Write-DiagLog "Found: $file" "SUCCESS"
    } else {
        Write-DiagLog "Missing: $file" "ERROR"
    }
}

Write-Host ""

# STEP 2: Kill existing processes
Write-Host "STEP 2: Clean Process State" -ForegroundColor Cyan
Write-Host "----------------------------------------------------------------" -ForegroundColor Gray

$existing = Get-Process -Name "ProduTime" -ErrorAction SilentlyContinue
if ($existing) {
    Write-DiagLog "Killing existing ProduTime processes..." "WARN"
    $existing | Stop-Process -Force
    Start-Sleep -Seconds 2
}

Write-Host ""

# STEP 3: Start real-time log monitoring
Write-Host "STEP 3: Initialize Real-Time Log Monitoring" -ForegroundColor Cyan
Write-Host "----------------------------------------------------------------" -ForegroundColor Gray

$errorLogPath = Join-Path (Split-Path $AppPath) "error-desktop-export.log"
Write-DiagLog "Monitoring log: $errorLogPath" "INFO"

# Clear or backup old log
if (Test-Path $errorLogPath) {
    $backupPath = "$errorLogPath.backup-$(Get-Date -Format 'yyyy-MM-dd_HH-mm-ss')"
    Copy-Item $errorLogPath $backupPath
    Write-DiagLog "Backed up old log to: $backupPath" "INFO"
}

# Start log monitoring job
$logMonitorJob = Start-Job -ScriptBlock {
    param($logPath)

    $lastSize = 0
    while ($true) {
        Start-Sleep -Milliseconds 100

        if (Test-Path $logPath) {
            $currentSize = (Get-Item $logPath).Length
            if ($currentSize -gt $lastSize) {
                $content = Get-Content $logPath -Encoding Unicode -Raw
                $newContent = $content.Substring($lastSize)

                # Look for errors
                if ($newContent -match "ERROR|Exception|Fatal|Crash|failed") {
                    Write-Output "LOG_ERROR: $newContent"
                }

                $lastSize = $currentSize
            }
        }
    }
} -ArgumentList $errorLogPath

Write-Host ""

# STEP 4: Launch ProduTime
Write-Host "STEP 4: Launch ProduTime with Full Monitoring" -ForegroundColor Cyan
Write-Host "----------------------------------------------------------------" -ForegroundColor Gray

Write-DiagLog "Launching: $AppPath" "INFO"

$processStartTime = Get-Date
$process = Start-Process -FilePath $AppPath -PassThru -WindowStyle Normal

if (-not $process) {
    Write-DiagLog "Failed to start process!" "ERROR"
    Stop-Job $logMonitorJob
    Remove-Job $logMonitorJob
    exit 1
}

Write-DiagLog "Process started (PID: $($process.Id))" "SUCCESS"
$script:DiagnosticData.ProcessEvents += @{
    Time = $processStartTime
    Event = "ProcessStarted"
    PID = $process.Id
}

Write-Host ""

# STEP 5: Monitor startup sequence
Write-Host "STEP 5: Monitor Startup Sequence ($MonitorSeconds seconds)" -ForegroundColor Cyan
Write-Host "----------------------------------------------------------------" -ForegroundColor Gray

$windowDetected = $false
$errorDialogDetected = $false
$lastWindowTitle = ""

for ($i = 1; $i -le $MonitorSeconds; $i++) {
    Start-Sleep -Seconds 1

    # Check if process still exists
    $proc = Get-Process -Id $process.Id -ErrorAction SilentlyContinue

    if (-not $proc) {
        Write-DiagLog "Process terminated after $i seconds!" "ERROR"
        $script:DiagnosticData.ProcessEvents += @{
            Time = Get-Date
            Event = "ProcessTerminated"
            Duration = $i
            ExitCode = $process.ExitCode
        }
        break
    }

    # Check for windows
    if ($proc.MainWindowHandle -ne 0) {
        $currentTitle = $proc.MainWindowTitle

        if ($currentTitle -ne $lastWindowTitle) {
            Write-DiagLog "Window title changed: '$currentTitle'" "INFO"
            $lastWindowTitle = $currentTitle

            $script:DiagnosticData.WindowHistory += @{
                Time = Get-Date
                Title = $currentTitle
                Handle = $proc.MainWindowHandle
            }

            # Check if it's an error dialog
            if ($currentTitle -match "error|exception|fatal|problem" -or $currentTitle -eq "Error") {
                Write-DiagLog "ERROR DIALOG DETECTED!" "ERROR"
                $errorDialogDetected = $true

                # Capture dialog content
                Capture-ErrorDialogContent -ProcessId $process.Id
            }
        }

        if (-not $windowDetected) {
            $windowDetected = $true
            Write-DiagLog "First window appeared at $i seconds" "SUCCESS"
        }
    }

    # Check log monitoring job for errors
    $jobOutput = Receive-Job $logMonitorJob -ErrorAction SilentlyContinue
    if ($jobOutput) {
        foreach ($line in $jobOutput) {
            Write-DiagLog "Real-time log: $line" "ERROR"
            $script:DiagnosticData.LogErrors += $line
        }
    }

    # Progress indicator
    $progress = "[" + ("#" * $i) + (" " * ($MonitorSeconds - $i)) + "]"
    Write-Host "`r  $progress $i/$MonitorSeconds sec" -NoNewline
}

Write-Host ""
Write-Host ""

# Stop log monitoring
Stop-Job $logMonitorJob
Remove-Job $logMonitorJob

# STEP 6: Capture final state
Write-Host "STEP 6: Capture Final State" -ForegroundColor Cyan
Write-Host "----------------------------------------------------------------" -ForegroundColor Gray

$finalProc = Get-Process -Id $process.Id -ErrorAction SilentlyContinue
if ($finalProc) {
    Write-DiagLog "Process still running" "SUCCESS"
    Write-DiagLog "  Memory: $([math]::Round($finalProc.WorkingSet64 / 1MB, 2)) MB" "INFO"
    Write-DiagLog "  Threads: $($finalProc.Threads.Count)" "INFO"
    Write-DiagLog "  Window: $($finalProc.MainWindowTitle)" "INFO"
} else {
    Write-DiagLog "Process has terminated" "ERROR"
    Write-DiagLog "  Exit code: $($process.ExitCode)" "ERROR"
}

Write-Host ""

# STEP 7: Analyze error log
Write-Host "STEP 7: Analyze Error Log" -ForegroundColor Cyan
Write-Host "----------------------------------------------------------------" -ForegroundColor Gray

if (Test-Path $errorLogPath) {
    $logContent = Get-Content $errorLogPath -Encoding Unicode -Raw

    # Parse for specific error patterns
    $errorPatterns = @(
        "Exception",
        "ERROR",
        "Fatal",
        "Crash",
        "failed to",
        "cannot",
        "unable to",
        "not found",
        "missing"
    )

    foreach ($pattern in $errorPatterns) {
        if ($logContent -match $pattern) {
            Write-DiagLog "Found error pattern: $pattern" "WARN"
        }
    }

    # Extract last 20 lines for analysis
    $lastLines = Get-Content $errorLogPath -Encoding Unicode -Tail 20
    Write-DiagLog "Last 20 log lines:" "INFO"
    foreach ($line in $lastLines) {
        if ($line -match "ERROR|Exception|Fatal") {
            Write-Host "  $line" -ForegroundColor Red
        } else {
            Write-Host "  $line" -ForegroundColor Gray
        }
    }
}

Write-Host ""

# STEP 8: Root Cause Analysis
Write-Host "STEP 8: Automated Root Cause Analysis" -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host ""

$diagnosis = @{
    ErrorDialogDetected = $errorDialogDetected
    ProcessCrashed = (-not $finalProc)
    WindowAppeared = $windowDetected
    LogErrors = $script:DiagnosticData.LogErrors.Count
    CrashDumps = $script:DiagnosticData.CrashDumps.Count
}

Write-Host "DIAGNOSIS SUMMARY:" -ForegroundColor Yellow
Write-Host "  Error Dialog Detected: $($diagnosis.ErrorDialogDetected)" -ForegroundColor $(if ($diagnosis.ErrorDialogDetected) { "Red" } else { "Green" })
Write-Host "  Process Crashed: $($diagnosis.ProcessCrashed)" -ForegroundColor $(if ($diagnosis.ProcessCrashed) { "Red" } else { "Green" })
Write-Host "  Window Appeared: $($diagnosis.WindowAppeared)" -ForegroundColor $(if ($diagnosis.WindowAppeared) { "Green" } else { "Red" })
Write-Host "  Log Errors Found: $($diagnosis.LogErrors)" -ForegroundColor $(if ($diagnosis.LogErrors -gt 0) { "Yellow" } else { "Green" })
Write-Host "  Crash Dumps: $($diagnosis.CrashDumps)" -ForegroundColor $(if ($diagnosis.CrashDumps -gt 0) { "Red" } else { "Green" })
Write-Host ""

if ($script:DiagnosticData.ErrorDialogs.Count -gt 0) {
    Write-Host "ERROR DIALOG CONTENT CAPTURED:" -ForegroundColor Red
    foreach ($dialog in $script:DiagnosticData.ErrorDialogs) {
        Write-Host "  Parent: $($dialog.ParentTitle)" -ForegroundColor Red
        Write-Host "  Class: $($dialog.ChildClass)" -ForegroundColor Yellow
        Write-Host "  Text: $($dialog.ChildText)" -ForegroundColor White
        Write-Host ""
    }
}

Write-Host ""
Write-Host "Full diagnostic log saved to: $script:LogFile" -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
