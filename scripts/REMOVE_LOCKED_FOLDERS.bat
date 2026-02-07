@echo off
echo ========================================
echo  Removing Locked Folders
echo ========================================
echo.
echo This script will remove folders that are currently locked by Windows.
echo Please close any File Explorer windows and wait a moment before running this.
echo.
pause

echo.
echo Removing %D% folder...
rmdir /s /q "%D%" 2>nul
if exist "%D%" (
    echo [FAILED] %D% is still locked - please close all programs and try again
) else (
    echo [SUCCESS] Removed %D%
)

echo.
echo Removing license-manager duplicate folders...
rmdir /s /q "license-manager\release-vps" 2>nul
if exist "license-manager\release-vps" (
    echo [FAILED] license-manager\release-vps is still locked
) else (
    echo [SUCCESS] Removed license-manager\release-vps
)

rmdir /s /q "license-manager\release-vps-fixed" 2>nul
if exist "license-manager\release-vps-fixed" (
    echo [FAILED] license-manager\release-vps-fixed is still locked
) else (
    echo [SUCCESS] Removed license-manager\release-vps-fixed
)

rmdir /s /q "license-manager\release-vps-new" 2>nul
if exist "license-manager\release-vps-new" (
    echo [FAILED] license-manager\release-vps-new is still locked
) else (
    echo [SUCCESS] Removed license-manager\release-vps-new
)

echo.
echo ========================================
echo  Cleanup Complete
echo ========================================
echo.
pause

