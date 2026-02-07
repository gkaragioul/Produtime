$ErrorActionPreference = 'Stop'

function EnsureDir([string]$p) {
  if (-not (Test-Path -LiteralPath $p)) {
    New-Item -ItemType Directory -Path $p | Out-Null
  }
}

$root = (Get-Location).Path
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$archiveRoot = Join-Path $root 'archive'
$archiveDir = Join-Path $archiveRoot 'removed-backups'
EnsureDir $archiveDir

$desktopExport2 = Join-Path $root 'desktop-export2'
$strayUserProfile = Join-Path $root '%USERPROFILE%'

Write-Host "Finalizing removal of locked folders...`n"

# 1) Stop only processes started from those folders
try {
  $procs = Get-CimInstance Win32_Process | Where-Object {
    $_.ExecutablePath -and (
      $_.ExecutablePath -like (Join-Path $desktopExport2 '*') -or
      $_.ExecutablePath -like (Join-Path $strayUserProfile '*')
    )
  }
  foreach ($p in $procs) {
    try {
      Write-Host ("Stopping PID {0} : {1}" -f $p.ProcessId, $p.ExecutablePath)
      Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop
    } catch {
      Write-Warning "Failed to stop PID $($p.ProcessId): $($_.Exception.Message)"
    }
  }
} catch {
  Write-Warning "Process inspection failed: $($_.Exception.Message)"
}

# Fallback: stop all ProduTime processes just in case
try {
  $pt = Get-Process -Name 'ProduTime' -ErrorAction SilentlyContinue
  if ($pt) {
    foreach ($p in $pt) {
      Write-Host ("Stopping ProduTime PID {0}" -f $p.Id)
      Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
    }
  }
} catch {}
Start-Sleep -Milliseconds 800

# Helper to archive (zip) then delete; fallback to move if zip fails
function ArchiveAndRemoveFolder([string]$folderPath) {
  if (-not (Test-Path -LiteralPath $folderPath)) { return }
  $name = Split-Path $folderPath -Leaf
  $zipPath = Join-Path $archiveDir ("$name-$timestamp.zip")
  try {
    Write-Host "Archiving $name -> $zipPath"
    Compress-Archive -Path $folderPath -DestinationPath $zipPath -Force
    Write-Host "Removing $name"
    Remove-Item -LiteralPath $folderPath -Recurse -Force
  } catch {
    Write-Warning "Zip removal failed for $($name): $($_.Exception.Message). Falling back to move."
    $dest = Join-Path $archiveDir ("$name-$timestamp")
    try {
      Move-Item -LiteralPath $folderPath -Destination $dest -Force
    } catch {
      Write-Warning "Move failed for $($name): $($_.Exception.Message)"
    }
  }
}
# Fallback: copy everything except app.asar to archive, then remove what we can
function PartialArchiveExcludeAsar([string]$folderPath) {
  if (-not (Test-Path -LiteralPath $folderPath)) { return }
  $name = Split-Path $folderPath -Leaf
  $partialDest = Join-Path $archiveDir ("$name-$timestamp-partial")
  EnsureDir $partialDest
  try {
    Write-Warning "Attempting partial archive (excluding app.asar) for $name"
    $robolog = Join-Path $archiveDir ("robocopy-$name-$timestamp.log")
    $src = $folderPath
    $dst = $partialDest
    $cmd = "robocopy `"$src`" `"$dst`" /E /NFL /NDL /NJH /NJS /NP /XF app.asar"
    cmd /c $cmd | Out-File -FilePath $robolog -Append -Encoding UTF8
  } catch {
    Write-Warning "Robocopy failed for $($name): $($_.Exception.Message)"
  }
  try {
    Get-ChildItem -LiteralPath $folderPath -Recurse -Force -ErrorAction SilentlyContinue |
      Where-Object { $_.PSIsContainer -or $_.Name -ne 'app.asar' } |
      Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
  } catch {}
  # If folder still exists, tag it as LOCKED
  try {
    if (Test-Path -LiteralPath $folderPath) {
      $lockedName = "$folderPath-LOCKED"
      if (-not (Test-Path -LiteralPath $lockedName)) { Rename-Item -LiteralPath $folderPath -NewName (Split-Path $lockedName -Leaf) -ErrorAction SilentlyContinue }
    }
  } catch {}
}

ArchiveAndRemoveFolder $desktopExport2
ArchiveAndRemoveFolder $strayUserProfile

# If the folders still exist, do partial archive and cleanup
if (Test-Path -LiteralPath $desktopExport2) { PartialArchiveExcludeAsar $desktopExport2 }
if (Test-Path -LiteralPath $strayUserProfile) { PartialArchiveExcludeAsar $strayUserProfile }

Write-Host "`nFinalize complete."
