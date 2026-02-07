# Capture Error Content from Running ProduTime Process
# Uses screenshots, UI Automation, and text extraction

param(
    [int]$ProcessId = 0
)

# Load required assemblies
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

# Create logs directory
$logsDir = "logs"
if (-not (Test-Path $logsDir)) {
    New-Item -ItemType Directory -Path $logsDir | Out-Null
}

$timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$screenshotPath = Join-Path $logsDir "error-screenshot-$timestamp.png"
$textCapturePath = Join-Path $logsDir "error-text-capture-$timestamp.txt"
$uiTreePath = Join-Path $logsDir "ui-tree-$timestamp.txt"

Write-Host "`n=== ProduTime Error Content Capture ===" -ForegroundColor Cyan
Write-Host "Timestamp: $timestamp`n" -ForegroundColor Gray

# Enhanced Win32 API
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public class Win32Enhanced {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
    public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc enumProc, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool EnumChildWindows(IntPtr hwndParent, EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, StringBuilder lParam);

    [DllImport("user32.dll")]
    public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

    public const uint WM_GETTEXT = 0x000D;
    public const uint WM_GETTEXTLENGTH = 0x000E;

    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }
}
"@

# Find ProduTime process
if ($ProcessId -eq 0) {
    $process = Get-Process -Name "ProduTime" -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $process) {
        Write-Host "[ERROR] ProduTime process not found!" -ForegroundColor Red
        exit 1
    }
    $ProcessId = $process.Id
}

Write-Host "[1/6] Found ProduTime process: PID $ProcessId" -ForegroundColor Green

# Function to get window handle for process
function Get-MainWindowHandle {
    param([int]$PID)

    $handle = [IntPtr]::Zero
    $callback = {
        param($hWnd, $lParam)
        $pid = 0
        [Win32Enhanced]::GetWindowThreadProcessId($hWnd, [ref]$pid) | Out-Null

        if ($pid -eq $PID -and [Win32Enhanced]::IsWindowVisible($hWnd)) {
            $script:foundHandle = $hWnd
            return $false  # Stop enumeration
        }
        return $true
    }

    $script:foundHandle = [IntPtr]::Zero
    [Win32Enhanced]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null
    return $script:foundHandle
}

# Get main window handle
$mainWindow = Get-MainWindowHandle -PID $ProcessId
if ($mainWindow -eq [IntPtr]::Zero) {
    Write-Host "[ERROR] Could not find window for process $ProcessId" -ForegroundColor Red
    exit 1
}

$sb = New-Object System.Text.StringBuilder 1024
[Win32Enhanced]::GetWindowText($mainWindow, $sb, $sb.Capacity) | Out-Null
$windowTitle = $sb.ToString()

Write-Host "[2/6] Found window: '$windowTitle' (Handle: $mainWindow)" -ForegroundColor Green

# Bring window to foreground
[Win32Enhanced]::SetForegroundWindow($mainWindow) | Out-Null
Start-Sleep -Milliseconds 500

# Get window rectangle
$rect = New-Object Win32Enhanced+RECT
[Win32Enhanced]::GetWindowRect($mainWindow, [ref]$rect) | Out-Null
$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top

Write-Host "[3/6] Window position: ($($rect.Left), $($rect.Top)) Size: ${width}x${height}" -ForegroundColor Green

# STEP 1: Take screenshot
try {
    $bitmap = New-Object System.Drawing.Bitmap $width, $height
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bitmap.Size)
    $bitmap.Save($screenshotPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $graphics.Dispose()
    $bitmap.Dispose()
    Write-Host "[4/6] Screenshot saved: $screenshotPath" -ForegroundColor Green
} catch {
    Write-Host "[4/6] Screenshot failed: $_" -ForegroundColor Red
}

# STEP 2: Extract text using SendMessage WM_GETTEXT on all child windows
$allText = @()
$allText += "=== WINDOW TEXT EXTRACTION ==="
$allText += "Main Window: '$windowTitle'"
$allText += ""

function Extract-ChildWindowText {
    param([IntPtr]$parentHandle)

    $childTexts = @()
    $callback = {
        param($hWnd, $lParam)

        if ([Win32Enhanced]::IsWindowVisible($hWnd)) {
            # Get window class
            $classSb = New-Object System.Text.StringBuilder 256
            [Win32Enhanced]::GetClassName($hWnd, $classSb, $classSb.Capacity) | Out-Null
            $className = $classSb.ToString()

            # Get text length
            $textLength = [Win32Enhanced]::SendMessage($hWnd, [Win32Enhanced]::WM_GETTEXTLENGTH, [IntPtr]::Zero, [IntPtr]::Zero)

            if ($textLength -gt 0) {
                # Get text using SendMessage
                $textSb = New-Object System.Text.StringBuilder ($textLength + 1)
                [Win32Enhanced]::SendMessage($hWnd, [Win32Enhanced]::WM_GETTEXT, [IntPtr]($textLength + 1), $textSb) | Out-Null
                $text = $textSb.ToString()

                if ($text.Trim() -ne "") {
                    $script:childTexts += "  [$className] $text"
                }
            }
        }
        return $true
    }

    $script:childTexts = @()
    [Win32Enhanced]::EnumChildWindows($parentHandle, $callback, [IntPtr]::Zero) | Out-Null
    return $script:childTexts
}

$childTexts = Extract-ChildWindowText -parentHandle $mainWindow
if ($childTexts.Count -gt 0) {
    $allText += "Child Window Texts:"
    $allText += $childTexts
} else {
    $allText += "No child window text found (might be Electron/Chromium rendering)"
}

Write-Host "[5/6] Extracted text from $($childTexts.Count) child windows" -ForegroundColor Green

# STEP 3: Use UI Automation to read the entire UI tree
$allText += ""
$allText += "=== UI AUTOMATION TREE ==="

try {
    $automation = New-Object -ComObject UIAutomationClient.CUIAutomation
    $element = $automation.ElementFromHandle($mainWindow)

    function Get-UIElementTree {
        param($element, $indent = 0)

        $results = @()
        $indentStr = "  " * $indent

        try {
            $name = $element.CurrentName
            $className = $element.CurrentClassName
            $controlType = $element.CurrentControlType

            if ($name -or $className) {
                $results += "${indentStr}[$controlType] $className : $name"
            }

            # Get all children
            $condition = $automation.CreateTrueCondition()
            $children = $element.FindAll(1, $condition)  # 1 = TreeScope_Children

            for ($i = 0; $i -lt $children.Length; $i++) {
                $child = $children.GetElement($i)
                $results += Get-UIElementTree -element $child -indent ($indent + 1)
            }
        } catch {
            # Silently skip elements that can't be accessed
        }

        return $results
    }

    $uiTree = Get-UIElementTree -element $element
    $allText += $uiTree
    Write-Host "[6/6] UI Automation tree captured ($($uiTree.Count) elements)" -ForegroundColor Green
} catch {
    $allText += "UI Automation failed: $_"
    Write-Host "[6/6] UI Automation failed: $_" -ForegroundColor Yellow
}

# Save all captured text
$allText | Out-File -FilePath $textCapturePath -Encoding UTF8

# STEP 4: Check Electron renderer logs
$allText += ""
$allText += "=== ELECTRON LOGS ==="

$appDataPath = [Environment]::GetFolderPath('ApplicationData')
$electronLogPaths = @(
    "desktop-export\win-unpacked\error-desktop-export.log",
    "$appDataPath\produtime\logs\main.log",
    "$appDataPath\produtime\logs\renderer.log",
    "$env:TEMP\produtime-crashes"
)

foreach ($logPath in $electronLogPaths) {
    if (Test-Path $logPath) {
        $allText += "Found log: $logPath"
        try {
            $logContent = Get-Content $logPath -Encoding Unicode -Tail 50 -ErrorAction SilentlyContinue
            if ($logContent) {
                $allText += $logContent
            }
        } catch {
            try {
                $logContent = Get-Content $logPath -Tail 50 -ErrorAction SilentlyContinue
                if ($logContent) {
                    $allText += $logContent
                }
            } catch {
                $allText += "Could not read log file"
            }
        }
    }
}

# Save final output
$allText | Out-File -FilePath $textCapturePath -Encoding UTF8

# Display summary
Write-Host "`n=== CAPTURE COMPLETE ===" -ForegroundColor Cyan
Write-Host "Screenshot: $screenshotPath" -ForegroundColor White
Write-Host "Text Capture: $textCapturePath" -ForegroundColor White
Write-Host "`nAnalyzing captured content..." -ForegroundColor Yellow

# Analyze for error patterns
$errorPatterns = @(
    "error", "exception", "fatal", "crash", "failed", "cannot", "unable",
    "not found", "missing", "invalid", "denied", "timeout"
)

$foundErrors = @()
foreach ($line in $allText) {
    foreach ($pattern in $errorPatterns) {
        if ($line -match $pattern) {
            $foundErrors += $line
            break
        }
    }
}

if ($foundErrors.Count -gt 0) {
    Write-Host "`n=== DETECTED ERRORS ===" -ForegroundColor Red
    $foundErrors | ForEach-Object { Write-Host $_ -ForegroundColor Red }
} else {
    Write-Host "`nNo obvious error patterns detected in captured text." -ForegroundColor Yellow
}

Write-Host "`nPlease check the screenshot and text capture files for details." -ForegroundColor Cyan
