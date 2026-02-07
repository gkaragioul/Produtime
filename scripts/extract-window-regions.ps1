# Extract Window Regions from Screenshots
# Detects rectangular regions that look like windows/dialogs

param(
    [string]$ScreenshotPath = "logs\screenshots-2025-11-15_19-17-27\fullscreen-12.2-s.png"
)

$ErrorActionPreference = "Continue"

Write-Host "=== WINDOW REGION EXTRACTION ===" -ForegroundColor Cyan
Write-Host "Analyzing: $ScreenshotPath" -ForegroundColor Gray

Add-Type -AssemblyName System.Drawing

try {
    $img = [System.Drawing.Image]::FromFile($ScreenshotPath)
    $bitmap = New-Object System.Drawing.Bitmap $img
    
    Write-Host "Image Size: $($img.Width)x$($img.Height)" -ForegroundColor Green
    
    # Create a brightness map
    Write-Host "Creating brightness map..." -ForegroundColor Cyan
    $brightnessMap = New-Object 'int[,]' $img.Width, $img.Height
    
    for ($y = 0; $y -lt $img.Height; $y++) {
        for ($x = 0; $x -lt $img.Width; $x++) {
            $pixel = $bitmap.GetPixel($x, $y)
            $brightness = [int](($pixel.R + $pixel.G + $pixel.B) / 3)
            $brightnessMap[$x, $y] = $brightness
        }
        
        if ($y % 100 -eq 0) {
            Write-Host "  Progress: $y / $($img.Height)" -ForegroundColor Gray
        }
    }
    
    Write-Host "Brightness map created" -ForegroundColor Green
    
    # Detect rectangular regions with high contrast edges
    Write-Host "Detecting window regions..." -ForegroundColor Cyan
    
    $regions = @()
    $gridSize = 50
    
    for ($gridY = 0; $gridY -lt $img.Height; $gridY += $gridSize) {
        for ($gridX = 0; $gridX -lt $img.Width; $gridX += $gridSize) {
            $endX = [math]::Min($gridX + $gridSize, $img.Width - 1)
            $endY = [math]::Min($gridY + $gridSize, $img.Height - 1)
            
            # Calculate average brightness in this grid cell
            $sum = 0
            $count = 0
            for ($y = $gridY; $y -lt $endY; $y++) {
                for ($x = $gridX; $x -lt $endX; $x++) {
                    $sum += $brightnessMap[$x, $y]
                    $count++
                }
            }
            $avgBrightness = $sum / $count
            
            if ($avgBrightness -gt 150) {
                $regions += [PSCustomObject]@{
                    X = $gridX
                    Y = $gridY
                    Width = $gridSize
                    Height = $gridSize
                    Brightness = [math]::Round($avgBrightness, 1)
                }
            }
        }
    }
    
    Write-Host "Found $($regions.Count) bright regions" -ForegroundColor Green
    
    # Merge adjacent regions
    Write-Host "Merging adjacent regions..." -ForegroundColor Cyan
    $mergedRegions = @()
    
    # Group by Y coordinate (rows)
    $rows = $regions | Group-Object Y | Sort-Object Name
    
    foreach ($row in $rows) {
        $rowRegions = $row.Group | Sort-Object X
        $currentRegion = $null
        
        foreach ($region in $rowRegions) {
            if ($null -eq $currentRegion) {
                $currentRegion = @{
                    X = $region.X
                    Y = $region.Y
                    Width = $region.Width
                    Height = $region.Height
                    MaxBrightness = $region.Brightness
                }
            } elseif ($region.X -le ($currentRegion.X + $currentRegion.Width + $gridSize)) {
                # Adjacent or overlapping - merge
                $currentRegion.Width = ($region.X + $region.Width) - $currentRegion.X
                $currentRegion.MaxBrightness = [math]::Max($currentRegion.MaxBrightness, $region.Brightness)
            } else {
                # Not adjacent - save current and start new
                $mergedRegions += [PSCustomObject]$currentRegion
                $currentRegion = @{
                    X = $region.X
                    Y = $region.Y
                    Width = $region.Width
                    Height = $region.Height
                    MaxBrightness = $region.Brightness
                }
            }
        }
        
        if ($null -ne $currentRegion) {
            $mergedRegions += [PSCustomObject]$currentRegion
        }
    }
    
    Write-Host "Merged into $($mergedRegions.Count) regions" -ForegroundColor Green
    
    # Find largest regions (likely windows)
    $largeRegions = $mergedRegions | Where-Object { $_.Width -gt 200 -and $_.Height -gt 100 } | Sort-Object { $_.Width * $_.Height } -Descending | Select-Object -First 10
    
    Write-Host ""
    Write-Host "=== DETECTED WINDOW REGIONS ===" -ForegroundColor Yellow
    foreach ($region in $largeRegions) {
        Write-Host "Region: X=$($region.X), Y=$($region.Y), Size=$($region.Width)x$($region.Height), Brightness=$($region.MaxBrightness)" -ForegroundColor White
        
        # Extract this region and save as separate image
        $regionBitmap = New-Object System.Drawing.Bitmap $region.Width, $region.Height
        $graphics = [System.Drawing.Graphics]::FromImage($regionBitmap)
        $srcRect = New-Object System.Drawing.Rectangle $region.X, $region.Y, $region.Width, $region.Height
        $destRect = New-Object System.Drawing.Rectangle 0, 0, $region.Width, $region.Height
        $graphics.DrawImage($img, $destRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
        $graphics.Dispose()
        
        $outputPath = $ScreenshotPath -replace '\.png$', "-region-$($region.X)-$($region.Y).png"
        $regionBitmap.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
        $regionBitmap.Dispose()
        
        Write-Host "  Saved to: $outputPath" -ForegroundColor Gray
    }
    
    $bitmap.Dispose()
    $img.Dispose()
    
} catch {
    Write-Host "ERROR: $_" -ForegroundColor Red
    Write-Host $_.ScriptStackTrace -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "=== EXTRACTION COMPLETE ===" -ForegroundColor Cyan

