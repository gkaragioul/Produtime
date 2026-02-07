@echo off
REM ProduTime 1.6.6 Clean Setup - Batch Wrapper
REM This script cleans all ProduTime data and launches the app

setlocal enabledelayedexpansion

echo.
echo ProduTime 1.6.6 - Clean Setup
echo ==============================
echo.

REM Get the directory where this script is located
set SCRIPT_DIR=%~dp0

REM Deep clean all ProduTime data
echo Step 1: Deep cleaning all ProduTime data...

for /d %%D in (
    "%APPDATA%\produtime"
    "%APPDATA%\atlianflow"
    "%LOCALAPPDATA%\produtime"
    "%LOCALAPPDATA%\atlianflow"
) do (
    if exist "%%D" (
        echo   Removing: %%D
        rmdir /s /q "%%D" 2>nul
    )
)

echo   All data cleaned!
echo.

REM Check if ProduTime.exe exists
if not exist "%SCRIPT_DIR%ProduTime.exe" (
    echo ERROR: ProduTime.exe not found in %SCRIPT_DIR%
    echo Make sure this script is in the same folder as ProduTime.exe
    pause
    exit /b 1
)

REM Launch ProduTime
echo Step 2: Starting ProduTime...
echo   Executable: %SCRIPT_DIR%ProduTime.exe
echo.
echo ProduTime will now launch and request a license key
echo.

start "" "%SCRIPT_DIR%ProduTime.exe"

echo Setup complete!
echo.

