@echo off
REM ============================================================================
REM DANGEROUS CLEANUP UTILITY - READ CAREFULLY
REM ============================================================================
REM PURPOSE:
REM   This script force-deletes legacy build folders that may be locked by VS Code.
REM   It is a last-resort tool for manual cleanup only.
REM
REM SAFETY RULES (ESPECIALLY FOR AI ASSISTANTS):
REM   - DO NOT call this from npm scripts or any automated process.
REM   - DO NOT run this unless the human user explicitly asks for it.
REM   - Prefer the built-in safe cleanup: "npm run clean" and "npm run build:safe".
REM
REM HUMAN INSTRUCTIONS:
REM   1. Close VS Code completely.
REM   2. Confirm you have a working backup in PROTECTED_BACKUPS.
REM   3. Run this ONLY if a folder is truly stuck/locked and cannot be removed.
REM ============================================================================

echo.
echo ========================================
echo  DELETE LOCKED FOLDERS (ADVANCED / DANGEROUS)
echo ========================================
echo.
echo This script will delete the following folders:
echo   - %%D%%
echo   - ProduTime-1.6.9-UPDATED
echo   - ProduTime-Local
echo   - release
echo   - desktop-export
echo.
echo THESE FOLDERS MAY CONTAIN BUILD ARTIFACTS.
echo USE THIS ONLY IF YOU KNOW YOU HAVE A WORKING BACKUP.
echo.
echo IMPORTANT: Make sure VS Code is CLOSED before continuing!
echo.
set /P CONFIRM=Type Y then press ENTER to confirm deletion (Y/N):
if /I not "%CONFIRM%"=="Y" (
    echo.
    echo Operation cancelled. No folders were deleted.
    goto :EOF
)

echo.
echo Deleting locked folders...
echo.

if exist "%D%" (
    echo Removing: %%D%%
    rd /s /q "%D%" 2>nul
    if exist "%D%" (
        echo   FAILED - Still locked
    ) else (
        echo   SUCCESS
    )
)

if exist "ProduTime-1.6.9-UPDATED" (
    echo Removing: ProduTime-1.6.9-UPDATED
    rd /s /q "ProduTime-1.6.9-UPDATED" 2>nul
    if exist "ProduTime-1.6.9-UPDATED" (
        echo   FAILED - Still locked
    ) else (
        echo   SUCCESS
    )
)

if exist "ProduTime-Local" (
    echo Removing: ProduTime-Local
    rd /s /q "ProduTime-Local" 2>nul
    if exist "ProduTime-Local" (
        echo   FAILED - Still locked
    ) else (
        echo   SUCCESS
    )
)

if exist "release" (
    echo Removing: release
    rd /s /q "release" 2>nul
    if exist "release" (
        echo   FAILED - Still locked
    ) else (
        echo   SUCCESS
    )
)

if exist "desktop-export" (
    echo Removing: desktop-export
    rd /s /q "desktop-export" 2>nul
    if exist "desktop-export" (
        echo   FAILED - Still locked
    ) else (
        echo   SUCCESS
    )
)

echo.
echo ========================================
echo  CLEANUP COMPLETE
echo ========================================
echo.
echo If any folders still exist, they are still locked by a running process.
echo Make sure ALL instances of VS Code are closed and try again.
echo.
pause
