param(
    [string]$ExePath = "$PSScriptRoot\..\release\win-unpacked\ProduTime.exe",
    [string]$IconPath = "$PSScriptRoot\..\assets\favicon.ico"
)

Write-Host "Fixing ProduTime.exe icon..."
Write-Host "EXE: $ExePath"
Write-Host "Icon: $IconPath"

# Check if files exist
if (-not (Test-Path $ExePath)) {
    Write-Error "EXE not found: $ExePath"
    exit 1
}

if (-not (Test-Path $IconPath)) {
    Write-Error "Icon not found: $IconPath"
    exit 1
}

# Try using rcedit from electron-winstaller
$rceditPath = "$PSScriptRoot\..\node_modules\electron-winstaller\vendor\rcedit.exe"

if (Test-Path $rceditPath) {
    Write-Host "Using rcedit: $rceditPath"
    & $rceditPath "$ExePath" --set-icon "$IconPath"
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Icon updated with rcedit"
    } else {
        Write-Host "⚠️  rcedit returned exit code: $LASTEXITCODE"
    }
} else {
    Write-Host "❌ rcedit not found at: $rceditPath"
    exit 1
}

# Clear Windows icon cache
Write-Host "Clearing Windows icon cache..."
$iconCachePath = "$env:LOCALAPPDATA\IconCache.db"
if (Test-Path $iconCachePath) {
    Remove-Item $iconCachePath -Force -ErrorAction SilentlyContinue
    Write-Host "✅ Icon cache cleared"
}

# Restart explorer
Write-Host "Restarting Windows Explorer..."
Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Start-Process explorer

Write-Host "✅ Done! Icon should now be updated."

