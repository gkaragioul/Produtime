# ============================================================================
# FORCE DELETE LOCKED FOLDERS
# ============================================================================
# This script forcefully removes folders that are locked by VS Code
# Run this script OUTSIDE of VS Code (from PowerShell or Windows Terminal)
# ============================================================================

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " FORCE DELETE LOCKED FOLDERS" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Change to workspace directory
$workspaceRoot = "c:\WindowsApps\TimeportWindows"
Set-Location $workspaceRoot

Write-Host "Workspace: $workspaceRoot" -ForegroundColor Gray
Write-Host ""

# Folders to remove
$foldersToRemove = @(
    '%D%',
    'ProduTime-1.6.9-UPDATED',
    'ProduTime-Local',
    'release',
    'desktop-export'
)

Write-Host "The following folders will be deleted:" -ForegroundColor Yellow
foreach ($folder in $foldersToRemove) {
    if (Test-Path $folder) {
        $size = (Get-ChildItem -Path $folder -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum / 1MB
        Write-Host "  - $folder ($([math]::Round($size, 2)) MB)" -ForegroundColor Yellow
    } else {
        Write-Host "  - $folder (already removed)" -ForegroundColor Gray
    }
}

Write-Host ""
Write-Host "WARNING: Make sure VS Code is CLOSED before continuing!" -ForegroundColor Red
Write-Host ""
$confirm = Read-Host "Continue? (Y/N)"

if ($confirm -ne 'Y' -and $confirm -ne 'y') {
    Write-Host "Cancelled." -ForegroundColor Yellow
    exit
}

Write-Host ""
Write-Host "Checking for VS Code processes..." -ForegroundColor Yellow
$vscodeProcesses = Get-Process | Where-Object { $_.ProcessName -like "*Code*" }

if ($vscodeProcesses) {
    Write-Host "WARNING: VS Code is still running!" -ForegroundColor Red
    Write-Host "Found $($vscodeProcesses.Count) VS Code processes" -ForegroundColor Red
    Write-Host ""
    Write-Host "Do you want to terminate VS Code processes? (Y/N)" -ForegroundColor Yellow
    $killConfirm = Read-Host
    
    if ($killConfirm -eq 'Y' -or $killConfirm -eq 'y') {
        Write-Host "Terminating VS Code processes..." -ForegroundColor Red
        $vscodeProcesses | ForEach-Object {
            Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
        }
        Write-Host "Waiting for processes to terminate..." -ForegroundColor Yellow
        Start-Sleep -Seconds 3
        Write-Host "✓ Processes terminated" -ForegroundColor Green
    } else {
        Write-Host "Please close VS Code manually and run this script again." -ForegroundColor Yellow
        exit
    }
}

Write-Host ""
Write-Host "Deleting locked folders..." -ForegroundColor Cyan
Write-Host ""

$success = @()
$failed = @()

foreach ($folder in $foldersToRemove) {
    if (Test-Path $folder) {
        Write-Host "Processing: $folder" -ForegroundColor Yellow
        
        try {
            # Method 1: Direct removal
            Remove-Item -Path $folder -Recurse -Force -ErrorAction Stop
            
            if (-not (Test-Path $folder)) {
                Write-Host "  ✓ Removed successfully" -ForegroundColor Green
                $success += $folder
            } else {
                throw "Folder still exists"
            }
        } catch {
            Write-Host "  Method 1 failed, trying Method 2..." -ForegroundColor Yellow
            
            # Method 2: Robocopy mirror
            $emptyDir = "temp_empty_$(Get-Random)"
            New-Item -ItemType Directory -Path $emptyDir -Force | Out-Null
            robocopy $emptyDir $folder /MIR /R:0 /W:0 /NFL /NDL /NJH /NJS | Out-Null
            Remove-Item -Path $emptyDir -Force -ErrorAction SilentlyContinue
            Start-Sleep -Milliseconds 500
            
            Remove-Item -Path $folder -Recurse -Force -ErrorAction SilentlyContinue
            
            if (-not (Test-Path $folder)) {
                Write-Host "  ✓ Removed with Method 2" -ForegroundColor Green
                $success += $folder
            } else {
                Write-Host "  ✗ Failed to remove" -ForegroundColor Red
                $failed += $folder
            }
        }
    } else {
        Write-Host "Already removed: $folder" -ForegroundColor Gray
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " SUMMARY" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Successfully removed: $($success.Count)" -ForegroundColor Green
Write-Host "Failed: $($failed.Count)" -ForegroundColor $(if ($failed.Count -gt 0) { 'Red' } else { 'Green' })

if ($success.Count -gt 0) {
    Write-Host ""
    Write-Host "Removed folders:" -ForegroundColor Green
    $success | ForEach-Object { Write-Host "  ✓ $_" -ForegroundColor Green }
}

if ($failed.Count -gt 0) {
    Write-Host ""
    Write-Host "Failed to remove:" -ForegroundColor Red
    $failed | ForEach-Object { Write-Host "  ✗ $_" -ForegroundColor Red }
    Write-Host ""
    Write-Host "These folders may still be locked. Try:" -ForegroundColor Yellow
    Write-Host "  1. Restart your computer" -ForegroundColor Yellow
    Write-Host "  2. Run this script again" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Press any key to exit..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")

