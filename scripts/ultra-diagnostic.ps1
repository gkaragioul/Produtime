# Ultra-Comprehensive ProduTime Diagnostic
# Captures EVERYTHING: screenshots, window content, logs, process state, console output

param(
    [int]$MonitorSeconds = 30
)

$ErrorActionPreference = "Continue"

# Setup
$timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$logsDir = "logs"
if (-not (Test-Path $logsDir)) { New-Item -ItemType Directory -Path $logsDir | Out-Null }

$diagLog = Join-Path $logsDir "ultra-diagnostic-$timestamp.txt"
$screenshotDir = Join-Path $logsDir "screenshots-$timestamp"
New-Item -ItemType Directory -Path $screenshotDir -Force | Out-Null

function Write-Log {
    param([string]$Message, [string]$Color = "White")
    $time = Get-Date -Format "HH:mm:ss.fff"
    $logMsg = "[$time] $Message"
    Add-Content -Path $diagLog -Value $logMsg
    Write-Host $logMsg -ForegroundColor $Color
}

Write-Log "=== ULTRA-DIAGNOSTIC STARTED ===" "Cyan"
Write-Log "Monitor Duration: $MonitorSeconds seconds" "Gray"
Write-Log "Log File: $diagLog" "Gray"
Write-Log "Screenshot Dir: $screenshotDir" "Gray"

# Load assemblies
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

# Win32 API
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class WinAPI {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Auto)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc enumProc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint nFlags);
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
"@

# Kill existing ProduTime processes
Write-Log "Killing existing ProduTime processes..." "Yellow"
Get-Process -Name "ProduTime" -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Log "  Killing PID $($_.Id)" "Yellow"
    Stop-Process -Id $_.Id -Force
}
Start-Sleep -Seconds 2

# Start log monitoring job
Write-Log "Starting log file monitor..." "Cyan"
$logPath = "desktop-export\win-unpacked\error-desktop-export.log"
$logMonitorJob = Start-Job -ScriptBlock {
    param($logPath, $duration)
    $endTime = (Get-Date).AddSeconds($duration)
    $lastSize = 0
    $output = @()

    while ((Get-Date) -lt $endTime) {
        if (Test-Path $logPath) {
            $currentSize = (Get-Item $logPath).Length
            if ($currentSize -gt $lastSize) {
                try {
                    $content = Get-Content $logPath -Encoding Unicode -Raw -ErrorAction SilentlyContinue
                    if ($content) {
                        $newContent = $content.Substring([Math]::Min($lastSize, $content.Length))
                        $output += "NEW_LOG: $newContent"
                    }
                } catch {
                    try {
                        $content = Get-Content $logPath -Raw -ErrorAction SilentlyContinue
                        if ($content) {
                            $newContent = $content.Substring([Math]::Min($lastSize, $content.Length))
                            $output += "NEW_LOG: $newContent"
                        }
                    } catch {}
                }
                $lastSize = $currentSize
            }
        }
        Start-Sleep -Milliseconds 200
    }
    return $output
} -ArgumentList $logPath, $MonitorSeconds

# Launch ProduTime
Write-Log "Launching ProduTime..." "Green"
$exePath = "desktop-export\win-unpacked\ProduTime.exe"
Write-Log "  Path: $exePath" "Gray"

$startInfo = New-Object System.Diagnostics.ProcessStartInfo
$startInfo.FileName = $exePath
$startInfo.WorkingDirectory = Split-Path $exePath
$startInfo.UseShellExecute = $false
$startInfo.RedirectStandardOutput = $true
$startInfo.RedirectStandardError = $true
$startInfo.CreateNoWindow = $false

try {
    $process = [System.Diagnostics.Process]::Start($startInfo)
    Write-Log "Process started! PID: $($process.Id)" "Green"

    # Start output capture
    $outputJob = Start-Job -ScriptBlock {
        param($pid)
        $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
        if ($proc) {
            return $proc.StandardOutput.ReadToEnd()
        }
    } -ArgumentList $process.Id

    $errorJob = Start-Job -ScriptBlock {
        param($pid)
        $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
        if ($proc) {
            return $proc.StandardError.ReadToEnd()
        }
    } -ArgumentList $process.Id

} catch {
    Write-Log "FAILED TO START: $_" "Red"
    exit 1
}

Write-Log "Monitoring for $MonitorSeconds seconds..." "Cyan"

$startTime = Get-Date
$endTime = $startTime.AddSeconds($MonitorSeconds)
$screenshotCount = 0
$windowsFound = @()

while ((Get-Date) -lt $endTime) {
    $elapsed = [math]::Round(((Get-Date) - $startTime).TotalSeconds, 1)

    # Check if process still exists
    $proc = Get-Process -Id $process.Id -ErrorAction SilentlyContinue

    if (-not $proc) {
        Write-Log "[$elapsed s] PROCESS EXITED!" "Red"
        $exitCode = $process.ExitCode
        Write-Log "  Exit Code: $exitCode" "Red"
        break
    }

    # Get process details
    $memoryMB = [math]::Round($proc.WorkingSet64 / 1MB, 2)
    $threads = $proc.Threads.Count
    $handles = $proc.HandleCount

    Write-Log "[$elapsed s] PID $($proc.Id): Memory=$memoryMB MB, Threads=$threads, Handles=$handles" "Gray"

    # Find ALL windows for this process
    $foundWindows = @()
    [WinAPI]::EnumWindows({
        param($hwnd, $lParam)
        $procId = 0
        [WinAPI]::GetWindowThreadProcessId($hwnd, [ref]$procId) | Out-Null

        if ($procId -eq $process.Id) {
            $title = New-Object System.Text.StringBuilder 256
            [WinAPI]::GetWindowText($hwnd, $title, 256) | Out-Null
            $titleStr = $title.ToString()

            $rect = New-Object WinAPI+RECT
            [WinAPI]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
            $width = $rect.Right - $rect.Left
            $height = $rect.Bottom - $rect.Top
            $visible = [WinAPI]::IsWindowVisible($hwnd)

            $foundWindows += [PSCustomObject]@{
                Handle = $hwnd
                Title = $titleStr
                Width = $width
                Height = $height
                Visible = $visible
            }
        }
        return $true
    }, [IntPtr]::Zero) | Out-Null

    # Log new windows
    foreach ($win in $foundWindows) {
        $key = "$($win.Handle)-$($win.Title)"
        if ($key -notin $windowsFound) {
            Write-Log "[$elapsed s] NEW WINDOW DETECTED!" "Yellow"
            Write-Log "  Handle: $($win.Handle)" "Yellow"
            Write-Log "  Title: '$($win.Title)'" "Yellow"
            Write-Log "  Size: $($win.Width)x$($win.Height)" "Yellow"
            Write-Log "  Visible: $($win.Visible)" "Yellow"
            $windowsFound += $key

            # Take screenshot of this window
            if ($win.Visible -and $win.Width -gt 0 -and $win.Height -gt 0) {
                try {
                    $screenshotCount++
                    $bitmap = New-Object System.Drawing.Bitmap $win.Width, $win.Height
                    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
                    $hdcDest = $graphics.GetHdc()

                    [WinAPI]::PrintWindow($win.Handle, $hdcDest, 0) | Out-Null

                    $graphics.ReleaseHdc($hdcDest)
                    $graphics.Dispose()

                    $screenshotPath = Join-Path $screenshotDir "window-$screenshotCount-$elapsed-s.png"
                    $bitmap.Save($screenshotPath, [System.Drawing.Imaging.ImageFormat]::Png)
                    $bitmap.Dispose()

                    Write-Log "  Screenshot saved: $screenshotPath" "Green"
                } catch {
                    Write-Log "  Screenshot failed: $_" "Red"
                }
            }
        }
    }

    # Also capture full screen every 2 seconds
    if ($elapsed % 2 -lt 0.5) {
        try {
            $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
            $bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
            $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
            $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
            $graphics.Dispose()

            $screenshotPath = Join-Path $screenshotDir "fullscreen-$elapsed-s.png"
            $bitmap.Save($screenshotPath, [System.Drawing.Imaging.ImageFormat]::Png)
            $bitmap.Dispose()

            Write-Log "[$elapsed s] Full screen captured: $screenshotPath" "Cyan"
        } catch {
            Write-Log "[$elapsed s] Full screen capture failed: $_" "Red"
        }
    }

    Start-Sleep -Milliseconds 500
}

Write-Log "=== MONITORING COMPLETE ===" "Cyan"

# Get log output
Write-Log "Retrieving log file changes..." "Cyan"
$logOutput = Receive-Job -Job $logMonitorJob -Wait
Remove-Job -Job $logMonitorJob

if ($logOutput) {
    Write-Log "=== LOG FILE OUTPUT ===" "Yellow"
    foreach ($line in $logOutput) {
        Write-Log $line "Gray"
    }
} else {
    Write-Log "No log file changes detected" "Yellow"
}

# Final process check
$finalProc = Get-Process -Id $process.Id -ErrorAction SilentlyContinue
if ($finalProc) {
    Write-Log "Process is STILL RUNNING (PID $($finalProc.Id))" "Green"
    Write-Log "  Window Title: '$($finalProc.MainWindowTitle)'" "Green"
    Write-Log "  Memory: $([math]::Round($finalProc.WorkingSet64 / 1MB, 2)) MB" "Green"
} else {
    Write-Log "Process has EXITED" "Red"
    Write-Log "  Exit Code: $($process.ExitCode)" "Red"
    Write-Log "  Exit Time: $($process.ExitTime)" "Red"
}

Write-Log "=== DIAGNOSTIC COMPLETE ===" "Cyan"
Write-Log "Results saved to: $diagLog" "Cyan"
Write-Log "Screenshots saved to: $screenshotDir" "Cyan"
Write-Log "Total screenshots: $screenshotCount" "Cyan"
