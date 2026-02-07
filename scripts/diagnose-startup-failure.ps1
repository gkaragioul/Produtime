# ProduTime Startup Failure Diagnostic Tool
# Analyzes logs and system state to diagnose why ProduTime failed to start

param(
    [string]$AppPath = ".\desktop-export\win-unpacked"
)

$ErrorActionPreference = "Continue"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "ProduTime Startup Failure Diagnostics" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 1. Check for error logs
Write-Host "1. CHECKING ERROR LOGS" -ForegroundColor Yellow
Write-Host "----------------------------------------"

$errorLogs = @(
    "$AppPath\error-desktop-export.log",
    "$AppPath\error.log",
    ".\logs\error.log",
    "$env:APPDATA\ProduTime\error.log",
    "$env:LOCALAPPDATA\ProduTime\error.log",
    "$env:USERPROFILE\AppData\Roaming\ProduTime\error.log"
)

$foundErrors = $false
foreach ($log in $errorLogs) {
    if (Test-Path $log) {
        $content = Get-Content $log -ErrorAction SilentlyContinue
        if ($content) {
            Write-Host "📄 Found: $log" -ForegroundColor Green
            Write-Host "   Last modified: $((Get-Item $log).LastWriteTime)" -ForegroundColor Gray
            Write-Host "   Content (last 15 lines):" -ForegroundColor Gray
            $content | Select-Object -Last 15 | ForEach-Object { Write-Host "   $_" -ForegroundColor White }
            Write-Host ""
            $foundErrors = $true
        }
    }
}

if (-not $foundErrors) {
    Write-Host "✅ No error logs found" -ForegroundColor Green
}
Write-Host ""

# 2. Check Windows Event Log
Write-Host "2. CHECKING WINDOWS EVENT LOG" -ForegroundColor Yellow
Write-Host "----------------------------------------"

try {
    $appErrors = Get-WinEvent -FilterHashtable @{
        LogName = 'Application'
        ProviderName = 'Application Error'
        StartTime = (Get-Date).AddHours(-1)
    } -MaxEvents 10 -ErrorAction SilentlyContinue | Where-Object { $_.Message -like "*ProduTime*" }
    
    if ($appErrors) {
        Write-Host "⚠️  Found Windows Application Errors:" -ForegroundColor Red
        foreach ($error in $appErrors) {
            Write-Host "   Time: $($error.TimeCreated)" -ForegroundColor Gray
            Write-Host "   Message: $($error.Message)" -ForegroundColor White
            Write-Host ""
        }
    } else {
        Write-Host "✅ No recent Windows errors for ProduTime" -ForegroundColor Green
    }
} catch {
    Write-Host "⚠️  Could not access Windows Event Log" -ForegroundColor Yellow
}
Write-Host ""

# 3. Check for missing dependencies
Write-Host "3. CHECKING DEPENDENCIES" -ForegroundColor Yellow
Write-Host "----------------------------------------"

$requiredFiles = @(
    "$AppPath\ProduTime.exe",
    "$AppPath\resources\app.asar",
    "$AppPath\ffmpeg.dll",
    "$AppPath\libEGL.dll",
    "$AppPath\libGLESv2.dll"
)

foreach ($file in $requiredFiles) {
    if (Test-Path $file) {
        $size = [math]::Round((Get-Item $file).Length / 1KB, 2)
        Write-Host "✅ $file ($size KB)" -ForegroundColor Green
    } else {
        Write-Host "❌ MISSING: $file" -ForegroundColor Red
    }
}
Write-Host ""

# 4. Check database integrity
Write-Host "4. CHECKING DATABASE" -ForegroundColor Yellow
Write-Host "----------------------------------------"

$dbLocations = @(
    "$env:APPDATA\ProduTime\timeport.db",
    "$env:LOCALAPPDATA\ProduTime\timeport.db",
    ".\data\production\timeport.db",
    ".\data\development\timeport.db"
)

foreach ($db in $dbLocations) {
    if (Test-Path $db) {
        $dbInfo = Get-Item $db
        Write-Host "📊 Found database: $db" -ForegroundColor Green
        Write-Host "   Size: $([math]::Round($dbInfo.Length / 1KB, 2)) KB" -ForegroundColor Gray
        Write-Host "   Last modified: $($dbInfo.LastWriteTime)" -ForegroundColor Gray
        
        # Check for lock files
        $lockFile = "$db-wal"
        if (Test-Path $lockFile) {
            Write-Host "   ⚠️  WAL file exists: $lockFile" -ForegroundColor Yellow
        }
    }
}
Write-Host ""

# 5. Check for port conflicts
Write-Host "5. CHECKING PORT AVAILABILITY" -ForegroundColor Yellow
Write-Host "----------------------------------------"

$commonPorts = @(3000, 3001, 8080, 8081)
foreach ($port in $commonPorts) {
    $connection = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
    if ($connection) {
        Write-Host "⚠️  Port $port is in use by PID $($connection.OwningProcess)" -ForegroundColor Yellow
    } else {
        Write-Host "✅ Port $port is available" -ForegroundColor Green
    }
}
Write-Host ""

# 6. Check system resources
Write-Host "6. CHECKING SYSTEM RESOURCES" -ForegroundColor Yellow
Write-Host "----------------------------------------"

$os = Get-CimInstance Win32_OperatingSystem
$freeMemoryGB = [math]::Round($os.FreePhysicalMemory / 1MB, 2)
$totalMemoryGB = [math]::Round($os.TotalVisibleMemorySize / 1MB, 2)
$memoryUsagePercent = [math]::Round((($totalMemoryGB - $freeMemoryGB) / $totalMemoryGB) * 100, 2)

Write-Host "Memory: $freeMemoryGB GB free / $totalMemoryGB GB total ($memoryUsagePercent% used)" -ForegroundColor Gray

if ($freeMemoryGB -lt 0.5) {
    Write-Host "⚠️  WARNING: Low memory available" -ForegroundColor Red
} else {
    Write-Host "✅ Sufficient memory available" -ForegroundColor Green
}
Write-Host ""

# 7. Suggest solutions
Write-Host "7. DIAGNOSTIC SUMMARY & RECOMMENDATIONS" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Cyan

if ($foundErrors) {
    Write-Host "❌ Error logs detected - review the logs above for specific errors" -ForegroundColor Red
    Write-Host ""
    Write-Host "Common solutions:" -ForegroundColor Yellow
    Write-Host "  1. Check if app.asar is corrupted - rebuild the app" -ForegroundColor White
    Write-Host "  2. Check database integrity - may need to reset database" -ForegroundColor White
    Write-Host "  3. Check for missing DLL dependencies" -ForegroundColor White
    Write-Host "  4. Try running from a different build location" -ForegroundColor White
} else {
    Write-Host "✅ No obvious errors detected" -ForegroundColor Green
    Write-Host ""
    Write-Host "Possible issues:" -ForegroundColor Yellow
    Write-Host "  1. App may be starting but window is hidden/minimized" -ForegroundColor White
    Write-Host "  2. App may be waiting for user input (check system tray)" -ForegroundColor White
    Write-Host "  3. Antivirus may be blocking the app" -ForegroundColor White
    Write-Host "  4. App may need to be rebuilt with latest code" -ForegroundColor White
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan

