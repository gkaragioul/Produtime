# LEGACY SCRIPT - DO NOT USE
# This export script has been superseded by the safe packaging commands.
Write-Host 'LEGACY SCRIPT - DO NOT USE' -ForegroundColor Red
Write-Host 'This script is kept for historical reference only.' -ForegroundColor Yellow
Write-Host 'Use the safe commands instead:' -ForegroundColor Yellow
Write-Host '  - npm run package:produtime' -ForegroundColor Yellow
Write-Host '  - npm run package:license-manager' -ForegroundColor Yellow
exit 1


param(
  [string]$App = "ProduTime",
  [string]$FromDir = "./release",
  [string]$Pattern = "*portable*x64*.exe"
)

Write-Host "📦 Exporting artifact to Desktop..." -ForegroundColor Cyan
Write-Host "  App     : $App"
Write-Host "  FromDir : $FromDir"
Write-Host "  Pattern : $Pattern"

# Resolve paths
$from = Resolve-Path -Path $FromDir -ErrorAction SilentlyContinue
if (-not $from) {
  Write-Host "❌ Source folder not found: $FromDir" -ForegroundColor Red
  exit 1
}

$desktop = [Environment]::GetFolderPath("Desktop")
if (-not (Test-Path $desktop)) {
  Write-Host "❌ Desktop folder not found: $desktop" -ForegroundColor Red
  exit 1
}

# Find newest matching artifact
$artifact = Get-ChildItem -Path $from -Recurse -File -Filter $Pattern |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (-not $artifact) {
  Write-Host "No artifact matching pattern found: $Pattern" -ForegroundColor Red
  exit 1
}

$destPath = Join-Path $desktop $artifact.Name

Write-Host "Copying:`n  $($artifact.FullName)`n  -> $destPath" -ForegroundColor Yellow
try {
  Copy-Item -Path $artifact.FullName -Destination $destPath -Force
  Write-Host "Exported to Desktop: $destPath" -ForegroundColor Green
}
catch {
  Write-Host "Copy failed: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}

# Optional: advise about Parallels network share quirks
Write-Host 'Note: Running Electron apps directly from a network/shared Desktop can crash on some VMs.' -ForegroundColor DarkYellow
Write-Host 'If that happens, copy the file from Desktop to a local folder and run it there.' -ForegroundColor DarkYellow
