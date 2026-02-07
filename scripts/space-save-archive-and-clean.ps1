param(
  [string]$Root = ".",
  [string]$DestRoot = "",
  [switch]$SkipGitGC
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $Root

function Ensure-Dir([string]$p){ if(-not(Test-Path -LiteralPath $p)){ New-Item -ItemType Directory -Path $p | Out-Null } }
function DirSizeMB([string]$p){ $s=(Get-ChildItem -LiteralPath $p -Recurse -Force -ErrorAction SilentlyContinue|Measure-Object -Property Length -Sum).Sum; if($null -eq $s){0}else{[math]::Round($s/1MB,2)} }
function FileCount([string]$p){ (Get-ChildItem -LiteralPath $p -Recurse -Force -File -ErrorAction SilentlyContinue).Count }

# Resolve destination archive root (Windows local Documents by default)
if([string]::IsNullOrWhiteSpace($DestRoot)){
  $docs = [Environment]::GetFolderPath('MyDocuments')
  if([string]::IsNullOrWhiteSpace($docs)){ throw 'Could not resolve user Documents folder for archive destination.' }
  $DestRoot = Join-Path $docs 'PT-ARCHIVE'
}
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$destSession = Join-Path $DestRoot ("Timeport-"+$timestamp)
Ensure-Dir $destSession

Write-Host "Archive destination: $destSession" -ForegroundColor Cyan

function Archive-Dir([string]$relPath,[string]$zipName,[switch]$DeleteAfter){
  $full = Join-Path (Get-Location) $relPath
  if(-not (Test-Path -LiteralPath $full)){ Write-Host "Skip: $relPath (not found)" -ForegroundColor Yellow; return [pscustomobject]@{Path=$relPath; Archived=$false; Deleted=$false; BeforeMB=0; AfterMB=0; SavedMB=0}
  }
  $beforeMB = DirSizeMB $full
  $count = FileCount $full
  $zipPath = Join-Path $destSession $zipName
  Write-Host "Compressing $relPath ($beforeMB MB, $count files) -> $zipPath"
  try {
    Compress-Archive -Path (Join-Path $full '*') -DestinationPath $zipPath -CompressionLevel Optimal -Force -ErrorAction Stop
  } catch {
    throw ("Compression failed for {0}: {1}" -f $relPath, $_.Exception.Message)
  }
  # simple verification: zip exists and non-zero length
  if(-not(Test-Path -LiteralPath $zipPath)){
    throw ("Zip not found after compression: {0}" -f $zipPath)
  }
  if((Get-Item $zipPath).Length -le 0){ throw "Zip has zero size: $zipPath" }
  $deleted=$false
  if($DeleteAfter){
    try{
      Remove-Item -LiteralPath $full -Recurse -Force -ErrorAction Stop
      $deleted=$true
    }catch{
      Write-Warning "Could not delete $relPath (in use?). Error: $($_.Exception.Message)"
    }
  }
  $afterMB = 0
  if (Test-Path -LiteralPath $full) {
    $afterMB = DirSizeMB $full
  }
  $saved = [math]::Round($beforeMB - $afterMB,2)
  return [pscustomobject]@{Path=$relPath; Archived=$true; Deleted=$deleted; BeforeMB=$beforeMB; AfterMB=$afterMB; SavedMB=$saved; Zip=$zipPath}
}

# Gracefully stop any app launched from this workspace to avoid locks
$ws = (Get-Location).Path
Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path -like "$ws*" } | ForEach-Object {
  Write-Host "Stopping process using workspace files: $($_.ProcessName) ($($_.Id))" -ForegroundColor Yellow
  try { Stop-Process -Id $_.Id -Force -ErrorAction Stop } catch { Write-Warning "Failed to stop PID $($_.Id): $($_.Exception.Message)" }
}

$results = @()

# Stage A: Archive selected big folders (retain originals for non-derivable backups)
# 1) PROTECTED_BACKUPS golden builds (archive only, keep originals)
if(Test-Path -LiteralPath 'PROTECTED_BACKUPS'){
  Get-ChildItem -LiteralPath 'PROTECTED_BACKUPS' -Directory | Where-Object { $_.Name -like 'ProduTime-1.6.9-GOLDEN*' } | ForEach-Object {
    $rel = Join-Path 'PROTECTED_BACKUPS' $_.Name
    $zip = ("PROTECTED_BACKUPS_"+$_.Name+"_"+$timestamp+".zip") -replace '[^A-Za-z0-9._-]','_'
    try {
      $results += Archive-Dir -relPath $rel -zipName $zip
    } catch {
      Write-Warning ("Skipping archive of {0}: {1}" -f $rel, $_.Exception.Message)
    }
  }
}

# 2) desktop-export/win-unpacked (archive + delete)
try { $results += Archive-Dir -relPath 'desktop-export\win-unpacked' -zipName ("desktop-export_win-unpacked_"+$timestamp+".zip") -DeleteAfter } catch { Write-Warning ("Skipping {0}: {1}" -f 'desktop-export\\win-unpacked', $_.Exception.Message) }

# 3) license-manager/release-vps/win-unpacked (archive + delete)
try { $results += Archive-Dir -relPath 'license-manager\release-vps\win-unpacked' -zipName ("license-manager_win-unpacked_"+$timestamp+".zip") -DeleteAfter } catch { Write-Warning ("Skipping {0}: {1}" -f 'license-manager\\release-vps\\win-unpacked', $_.Exception.Message) }

# 4) ProduTime-Local (archive + delete)
try { $results += Archive-Dir -relPath 'ProduTime-Local' -zipName ("ProduTime-Local_"+$timestamp+".zip") -DeleteAfter } catch { Write-Warning ("Skipping {0}: {1}" -f 'ProduTime-Local', $_.Exception.Message) }

# 5) version-backups (archive whole + delete)
try { $results += Archive-Dir -relPath 'version-backups' -zipName ("version-backups_"+$timestamp+".zip") -DeleteAfter } catch { Write-Warning ("Skipping {0}: {1}" -f 'version-backups', $_.Exception.Message) }

# 6) archive/version-backups (archive whole + delete)
try { $results += Archive-Dir -relPath 'archive\version-backups' -zipName ("archive_version-backups_"+$timestamp+".zip") -DeleteAfter } catch { Write-Warning ("Skipping {0}: {1}" -f 'archive\\version-backups', $_.Exception.Message) }

# Summary
Write-Host "`n=== Archive/Clean Summary ===" -ForegroundColor Cyan
$results | ForEach-Object { Write-Host ("{0,-40} | Archived:{1,-5} Deleted:{2,-5} Before:{3,8}MB After:{4,8}MB Saved:{5,8}MB" -f $_.Path, $_.Archived, $_.Deleted, $_.BeforeMB, $_.AfterMB, $_.SavedMB) }
$totalSaved = [math]::Round(($results | Measure-Object -Property SavedMB -Sum).Sum,2)
Write-Host ("Total potential space saved (on workspace): {0} MB" -f $totalSaved) -ForegroundColor Green

# Stage D: Optional git maintenance
if(-not $SkipGitGC){
  Write-Host "`nRunning git gc (safe repository maintenance)..." -ForegroundColor Cyan
  try { git --version | Out-Null; git gc } catch { Write-Warning "git gc failed: $($_.Exception.Message)" }
}

Write-Host "`nDone. Archives stored at: $destSession" -ForegroundColor Cyan

