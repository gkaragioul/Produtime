@echo off
REM ProduTime Remote Configuration Script
REM Run this on the remote PC before launching ProduTime
REM This configures ProduTime to connect to the License Manager on GeorgeK-PC

setlocal enabledelayedexpansion

cls
echo.
echo ════════════════════════════════════════════════════════════════
echo          ProduTime Remote License Manager Configuration
echo ════════════════════════════════════════════════════════════════
echo.

REM License Manager Details
set LICENSE_MANAGER_IP=146.190.233.122
set LICENSE_MANAGER_PORT=3000
set ACTIVATION_URL=http://!LICENSE_MANAGER_IP!:!LICENSE_MANAGER_PORT!/activate
set VALIDATION_URL=http://!LICENSE_MANAGER_IP!:!LICENSE_MANAGER_PORT!/validate

echo License Manager Configuration:
echo    PC Name: GeorgeK-PC
echo    Public IP: !LICENSE_MANAGER_IP!
echo    Port: !LICENSE_MANAGER_PORT!
echo.

echo URLs:
echo    Activation: !ACTIVATION_URL!
echo    Validation: !VALIDATION_URL!
echo.

REM Test connectivity
echo Testing connectivity...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "try { $r = Invoke-WebRequest -Uri 'http://!LICENSE_MANAGER_IP!:!LICENSE_MANAGER_PORT!/health' -UseBasicParsing -TimeoutSec 5; if ($r.StatusCode -eq 200) { Write-Host '✓ License Manager is reachable!' -ForegroundColor Green } } catch { Write-Host '✗ Cannot reach License Manager' -ForegroundColor Red }"
echo.

REM Set environment variables
echo Setting environment variables...
set ACTIVATION_SERVER_URL=!ACTIVATION_URL!
set VALIDATION_SERVER_URL=!VALIDATION_URL!

echo ✓ Environment variables set:
echo    ACTIVATION_SERVER_URL=!ACTIVATION_SERVER_URL!
echo    VALIDATION_SERVER_URL=!VALIDATION_SERVER_URL!
echo.

REM Find ProduTime executable
echo Looking for ProduTime.exe...

if exist "ProduTime.exe" (
    set PRODUTIME_EXE=ProduTime.exe
    echo ✓ Found in current directory
) else if exist "%USERPROFILE%\Desktop\ProduTime-1.6.6-Clean\ProduTime.exe" (
    set PRODUTIME_EXE=%USERPROFILE%\Desktop\ProduTime-1.6.6-Clean\ProduTime.exe
    echo ✓ Found on Desktop
) else if exist "C:\Program Files\ProduTime\ProduTime.exe" (
    set PRODUTIME_EXE=C:\Program Files\ProduTime\ProduTime.exe
    echo ✓ Found in Program Files
) else (
    echo ✗ ProduTime.exe not found
    echo.
    echo Please specify the path to ProduTime.exe:
    set /p PRODUTIME_EXE="Path: "
    
    if not exist "!PRODUTIME_EXE!" (
        echo ✗ File not found: !PRODUTIME_EXE!
        pause
        exit /b 1
    )
)

echo.
echo Launching ProduTime...
echo    Executable: !PRODUTIME_EXE!
echo.

REM Launch ProduTime with environment variables
start "" "!PRODUTIME_EXE!"

if errorlevel 1 (
    echo ✗ Failed to launch ProduTime
    pause
    exit /b 1
)

echo.
echo ✓ ProduTime launched successfully!
echo.
echo Notes:
echo    • ProduTime will validate with License Manager every 2 minutes
echo    • If license is deleted, app will lock within 2 minutes
echo    • Check ProduTime logs for any connection issues
echo.
echo You can close this window.
pause

