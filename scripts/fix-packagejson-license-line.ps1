# ============================================================================
# One-time cleanup script: remove stray license-manager packaging line
# created during automated edits. Safe to run multiple times.
# ============================================================================

$ErrorActionPreference = 'Stop'

$path = Join-Path $PSScriptRoot '..\package.json'
Write-Host ('Cleaning stray license-manager packaging line in ' + $path) -ForegroundColor Cyan

if (-not (Test-Path -LiteralPath $path)) {
    Write-Host ('package.json not found at: ' + $path) -ForegroundColor Red
    exit 1
}

$lines = Get-Content -LiteralPath $path

# Matches the extra line that starts with "& { $src = 'license-manager\\release-vps\\win-unpacked';
$pattern = '*\"& { $src = ''license-manager\\release-vps\\win-unpacked''*'

$removed = $false
$filtered = @()

foreach ($line in $lines) {
    if ($line -like $pattern) {
        $removed = $true
        continue
    }
    $filtered += $line
}

if (-not $removed) {
    Write-Host 'No stray line matched; package.json left unchanged.' -ForegroundColor Yellow
} else {
    $filtered | Set-Content -LiteralPath $path -Encoding UTF8
    Write-Host 'Stray license-manager packaging line removed from package.json.' -ForegroundColor Green
}
