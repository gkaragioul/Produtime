# Development Run with Full Monitoring
# Runs ProduTime in development mode with automated error detection and screen capture

param(
    [int]$MonitorSeconds = 60
)

$ErrorActionPreference = "Continue"

Write-Host "=== PRODUTIME DEVELOPMENT RUN WITH MONITORING ===" -ForegroundColor Cyan
Write-Host ""

# Setup logging
$timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$logsDir = "logs"
if (-not (Test-Path $logsDir)) { New-Item -ItemType Directory -Path $logsDir | Out-Null }

$runLog = Join-Path $logsDir "dev-run-$timestamp.txt"
$screenshotDir = Join-Path $logsDir "dev-screenshots-$timestamp"
New-Item -ItemType Directory -Path $screenshotDir -Force | Out-Null

function Write-Log {
    param([string]$Message, [string]$Color = "White")
    $time = Get-Date -Format "HH:mm:ss.fff"
    $logMsg = "[$time] $Message"
    Add-Content -Path $runLog -Value $logMsg -ErrorAction SilentlyContinue
    Write-Host $logMsg -ForegroundColor $Color
}

Write-Log "=== STARTING DEVELOPMENT RUN ===" "Cyan"
Write-Log "Log file: $runLog" "Gray"
Write-Log "Screenshots: $screenshotDir" "Gray"

# Kill existing Electron processes
Write-Log "Killing existing Electron/ProduTime processes..." "Yellow"
Get-Process | Where-Object { $_.ProcessName -match "electron|ProduTime" } | ForEach-Object {
    Write-Log "  Killing: $($_.ProcessName) (PID $($_.Id))" "Yellow"
    Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 2

# Load assemblies for screenshots
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

# Win32 API for window detection
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class WinAPI {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll", CharSet = CharSet.Auto)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc enumProc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
"@

# Start Electron in production mode (using built files)
Write-Log "Starting Electron in production mode..." "Green"
Write-Log "Command: node_modules\.bin\electron.cmd ." "Gray"

$electronCmd = Join-Path $PWD "node_modules\.bin\electron.cmd"
$env:NODE_ENV = "production"
$electronProcess = Start-Process -FilePath $electronCmd -ArgumentList "." -PassThru -RedirectStandardOutput "$logsDir\electron-stdout-$timestamp.txt" -RedirectStandardError "$logsDir\electron-stderr-$timestamp.txt" -WorkingDirectory $PWD -WindowStyle Hidden

if ($null -eq $electronProcess) {
    Write-Log "ERROR: Failed to start Electron process!" "Red"
    exit 1
}

Write-Log "Electron process started: PID $($electronProcess.Id)" "Green"
Start-Sleep -Seconds 2

# Monitor the process
$startTime = Get-Date
$endTime = $startTime.AddSeconds($MonitorSeconds)
$screenshotCount = 0
$windowsDetected = @()
$lastScreenshot = $startTime

Write-Log "Monitoring for $MonitorSeconds seconds..." "Cyan"
Write-Log ""

while ((Get-Date) -lt $endTime) {
    $elapsed = [math]::Round(((Get-Date) - $startTime).TotalSeconds, 1)

    # Check if process still exists
    $proc = Get-Process -Id $electronProcess.Id -ErrorAction SilentlyContinue

    if (-not $proc) {
        Write-Log "[$elapsed s] ELECTRON PROCESS EXITED!" "Red"
        $exitCode = $electronProcess.ExitCode
        Write-Log "  Exit Code: $exitCode" "Red"

        # Read error output
        if (Test-Path "$logsDir\electron-stderr-$timestamp.txt") {
            $errors = Get-Content "$logsDir\electron-stderr-$timestamp.txt" -Raw
            if ($errors.Trim().Length -gt 0) {
                Write-Log "=== STDERR OUTPUT ===" "Red"
                Write-Log $errors "Red"
            }
        }
        break
    }

    # Get all Electron processes (main + renderer)
    $allElectronProcs = Get-Process | Where-Object { $_.ProcessName -match "electron" -or $_.MainModule.FileName -like "*electron*" } -ErrorAction SilentlyContinue

    if ($allElectronProcs) {
        $totalMemory = ($allElectronProcs | Measure-Object -Property WorkingSet64 -Sum).Sum / 1MB
        $totalThreads = ($allElectronProcs | Measure-Object -Property Threads.Count -Sum).Sum
        Write-Log "[$elapsed s] Electron: $($allElectronProcs.Count) processes, Memory=$([math]::Round($totalMemory, 2)) MB, Threads=$totalThreads" "Gray"

        # Find windows
        $foundWindows = @()
        foreach ($p in $allElectronProcs) {
            [WinAPI]::EnumWindows({
                param($hwnd, $lParam)
                $procId = 0
                [WinAPI]::GetWindowThreadProcessId($hwnd, [ref]$procId) | Out-Null

                if ($procId -eq $p.Id) {
                    $title = New-Object System.Text.StringBuilder 256
                    [WinAPI]::GetWindowText($hwnd, $title, 256) | Out-Null
                    $titleStr = $title.ToString()

                    if ($titleStr.Length -gt 0) {
                        $rect = New-Object WinAPI+RECT
                        [WinAPI]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
                        $width = $rect.Right - $rect.Left
                        $height = $rect.Bottom - $rect.Top
                        $visible = [WinAPI]::IsWindowVisible($hwnd)

                        if ($visible -and $width -gt 100 -and $height -gt 100) {
                            $foundWindows += [PSCustomObject]@{
                                PID = $p.Id
                                Handle = $hwnd
                                Title = $titleStr
                                Width = $width
                                Height = $height
                            }
                        }
                    }
                }
                return $true
            }, [IntPtr]::Zero) | Out-Null
        }

        # Log new windows
        foreach ($win in $foundWindows) {
            $key = "$($win.Handle)-$($win.Title)"
            if ($key -notin $windowsDetected) {
                Write-Log "[$elapsed s] WINDOW DETECTED!" "Green"
                Write-Log "  Title: '$($win.Title)'" "Green"
                Write-Log "  Size: $($win.Width)x$($win.Height)" "Green"
                Write-Log "  PID: $($win.PID)" "Green"
                $windowsDetected += $key
            }
        }
    }

    # Take screenshot every 5 seconds
    $timeSinceLastScreenshot = ((Get-Date) - $lastScreenshot).TotalSeconds
    if ($timeSinceLastScreenshot -ge 5) {
        try {
            $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
            $bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
            $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
            $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
            $graphics.Dispose()

            $screenshotPath = Join-Path $screenshotDir "screen-$elapsed-s.png"
            $bitmap.Save($screenshotPath, [System.Drawing.Imaging.ImageFormat]::Png)
            $bitmap.Dispose()
            $screenshotCount++

            Write-Log "[$elapsed s] Screenshot captured" "Cyan"
            $lastScreenshot = Get-Date
        } catch {
            Write-Log "[$elapsed s] Screenshot failed: $_" "Red"
        }
    }

    Start-Sleep -Milliseconds 1000
}

Write-Log ""
Write-Log "=== MONITORING COMPLETE ===" "Cyan"
Write-Log "Total screenshots: $screenshotCount" "Cyan"
Write-Log "Windows detected: $($windowsDetected.Count)" "Cyan"
Write-Log ""
Write-Log "Log file: $runLog" "Green"
Write-Log "Screenshots: $screenshotDir" "Green"
