$ErrorActionPreference = 'Stop'

function EnsureDir([string]$p) {
  if (-not (Test-Path -LiteralPath $p)) {
    New-Item -ItemType Directory -Path $p | Out-Null
  }
}

# Prepare archive root
$archiveRoot = 'archive'
EnsureDir $archiveRoot
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'

Write-Host "Tidying workspace...`n"

# 1) Remove duplicates/stray
if (Test-Path -LiteralPath 'desktop-export2') {
  Write-Host "Removing desktop-export2/"
  try {
    Remove-Item -LiteralPath 'desktop-export2' -Recurse -Force -ErrorAction Stop
  } catch {
    Write-Warning "desktop-export2 appears to be in use. Skipping removal. Close any running app from desktop-export2 and re-run."
  }
}
if (Test-Path -LiteralPath '%USERPROFILE%') {
  Write-Host "Removing stray %USERPROFILE%/"
  try {
    Remove-Item -LiteralPath '%USERPROFILE%' -Recurse -Force -ErrorAction Stop
  } catch {
    Write-Warning "Stray %USERPROFILE% folder appears to be in use. Skipping removal. Close any running app and re-run."
  }
}
if (Test-Path -LiteralPath 'build.log') {
  Write-Host "Removing build.log"
  Remove-Item -LiteralPath 'build.log' -Force
}

# 2) Archive Test User (generated output)
if (Test-Path -LiteralPath 'Test User') {
  $dest = Join-Path $archiveRoot ("Test User-" + $timestamp)
  Write-Host "Archiving 'Test User' -> $dest"
  Move-Item -LiteralPath 'Test User' -Destination $dest -Force
}

# 3) Move scripts to scripts/
EnsureDir 'scripts'
$scripts = @(
  'ProduTime-Setup-Clean.bat',
  'ProduTime-Setup-Clean.ps1',
  'run-produtime-remote.bat',
  'run-produtime-remote.ps1',
  'copy-setup-scripts.ps1',
  'create-shortcut.ps1',
  'export-clean-produtime-final.ps1',
  'export-clean.ps1',
  'export-license-manager-correct.ps1',
  'export-license-manager.ps1',
  'export-produtime-clean.ps1',
  'export-updated-apps.ps1',
  'deep-clean-produtime.ps1',
  'deploy-clients.ps1',
  'check-and-clean-db.ps1'
)
foreach ($f in $scripts) {
  if (Test-Path -LiteralPath $f) {
    Write-Host "Moving script $f -> scripts/"
    Move-Item -LiteralPath $f -Destination 'scripts' -Force
  }
}

# 4) Move root docs to docs-root/_root
$docsDest = 'docs-root\_root'
EnsureDir $docsDest
$docs = @(
  # Previously listed doc names (if they exist)
  'ANSWER_DO_YOU_NEED_CHANGES.md',
  'CHANGES_ALREADY_MADE_TO_PRODUTIME.md',
  'CLOUD_DEPLOYMENT_GUIDE.md',
  'DISTANCE_CAPABILITIES_INVESTIGATION.md',
  'EXPORT_SETUP_GUIDE.md',
  'LICENSE_REVOCATION_INVESTIGATION.md',
  'LICENSE_TUNNEL.md',
  'QUICK_REFERENCE_REMOTE_REVOCATION.md',
  'README_REMOTE_REVOCATION.md',
  'REMOTE_PC_CONFIGURATION.md',
  'REMOTE_REVOCATION_SUMMARY.md',
  'SETUP_COMPLETE_SUMMARY.md',
  'TECHNICAL_NETWORK_DETAILS.md',
  'WORLDWIDE_ACCESS_SOLUTION.md',
  'WORLDWIDE_ACCESS_SUMMARY.md',
  'QUICK_START_CARD.txt',
  # Root docs to declutter
  'AI-CHECKLIST.md',
  'AI-INSTRUCTIONS.md',
  'ARM_PARALLELS_ADJUSTMENTS.md',
  'BUILD_ARM64_GUIDE.md',
  'DESKTOP_BUILDS_SUMMARY.md',
  'DEVELOPMENT.md',
  'SETUP-COMPLETE.md',
  'SETUP_COMPLETE.md',
  'START-HERE.md'
)
foreach ($f in $docs) {
  if (Test-Path -LiteralPath $f) {
    Write-Host "Moving doc $f -> $docsDest"
    Move-Item -LiteralPath $f -Destination $docsDest -Force
  }
}

Write-Host "`nCleanup complete."
