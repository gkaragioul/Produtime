# Analyze Screenshots - Extract visual information for AI analysis
# Converts screenshots to base64 and analyzes pixel patterns

param(
    [string]$ScreenshotDir = "logs\screenshots-2025-11-15_19-17-27"
)

$ErrorActionPreference = "Continue"

Write-Host "=== SCREENSHOT ANALYSIS ===" -ForegroundColor Cyan
Write-Host "Directory: $ScreenshotDir" -ForegroundColor Gray

if (-not (Test-Path $ScreenshotDir)) {
    Write-Host "ERROR: Screenshot directory not found!" -ForegroundColor Red
    exit 1
}

# Load System.Drawing
Add-Type -AssemblyName System.Drawing

$screenshots = Get-ChildItem $ScreenshotDir -Filter "*.png" | Sort-Object Name

Write-Host "Found $($screenshots.Count) screenshots" -ForegroundColor Green
Write-Host ""

foreach ($screenshot in $screenshots) {
    Write-Host "=== $($screenshot.Name) ===" -ForegroundColor Yellow
    
    try {
        # Load image
        $img = [System.Drawing.Image]::FromFile($screenshot.FullName)
        $bitmap = New-Object System.Drawing.Bitmap $img
        
        Write-Host "  Size: $($img.Width)x$($img.Height)" -ForegroundColor Gray
        
        # Analyze image content
        $totalPixels = $img.Width * $img.Height
        $colorCounts = @{}
        $brightPixels = 0
        $darkPixels = 0
        
        # Sample pixels (every 10th pixel to avoid processing millions)
        $sampleRate = 10
        $sampledPixels = 0
        
        for ($y = 0; $y -lt $img.Height; $y += $sampleRate) {
            for ($x = 0; $x -lt $img.Width; $x += $sampleRate) {
                $pixel = $bitmap.GetPixel($x, $y)
                $sampledPixels++
                
                # Calculate brightness
                $brightness = ($pixel.R + $pixel.G + $pixel.B) / 3
                
                if ($brightness -gt 200) {
                    $brightPixels++
                } elseif ($brightness -lt 50) {
                    $darkPixels++
                }
                
                # Categorize colors
                $colorKey = "R$($pixel.R -band 0xF0)-G$($pixel.G -band 0xF0)-B$($pixel.B -band 0xF0)"
                if ($colorCounts.ContainsKey($colorKey)) {
                    $colorCounts[$colorKey]++
                } else {
                    $colorCounts[$colorKey] = 1
                }
            }
        }
        
        # Calculate percentages
        $brightPercent = [math]::Round(($brightPixels / $sampledPixels) * 100, 1)
        $darkPercent = [math]::Round(($darkPixels / $sampledPixels) * 100, 1)
        
        Write-Host "  Sampled Pixels: $sampledPixels" -ForegroundColor Gray
        Write-Host "  Bright Pixels (>200): $brightPercent%" -ForegroundColor White
        Write-Host "  Dark Pixels (<50): $darkPercent%" -ForegroundColor White
        
        # Find dominant colors
        $topColors = $colorCounts.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 5
        Write-Host "  Top 5 Colors:" -ForegroundColor Cyan
        foreach ($color in $topColors) {
            $percent = [math]::Round(($color.Value / $sampledPixels) * 100, 1)
            Write-Host "    $($color.Key): $percent%" -ForegroundColor Gray
        }
        
        # Detect if image is mostly blank/white (likely no window visible)
        if ($brightPercent -gt 90) {
            Write-Host "  ANALYSIS: Mostly blank/white - likely no visible window" -ForegroundColor Red
        } elseif ($darkPercent -gt 80) {
            Write-Host "  ANALYSIS: Mostly dark - possible black screen or error" -ForegroundColor Red
        } else {
            Write-Host "  ANALYSIS: Mixed content - window likely visible" -ForegroundColor Green
        }
        
        # Check for error dialog patterns (small centered window)
        # Error dialogs are typically 400-600px wide, centered
        $centerX = $img.Width / 2
        $centerY = $img.Height / 2
        $checkRadius = 200
        
        $centerBrightPixels = 0
        $centerSampledPixels = 0
        
        for ($y = [math]::Max(0, $centerY - $checkRadius); $y -lt [math]::Min($img.Height, $centerY + $checkRadius); $y += 5) {
            for ($x = [math]::Max(0, $centerX - $checkRadius); $x -lt [math]::Min($img.Width, $centerX + $checkRadius); $x += 5) {
                $pixel = $bitmap.GetPixel($x, $y)
                $centerSampledPixels++
                $brightness = ($pixel.R + $pixel.G + $pixel.B) / 3
                if ($brightness -gt 200) {
                    $centerBrightPixels++
                }
            }
        }
        
        if ($centerSampledPixels -gt 0) {
            $centerBrightPercent = [math]::Round(($centerBrightPixels / $centerSampledPixels) * 100, 1)
            Write-Host "  Center Region Brightness: $centerBrightPercent%" -ForegroundColor Cyan
            
            if ($centerBrightPercent -gt 80 -and $brightPercent -lt 80) {
                Write-Host "  POSSIBLE ERROR DIALOG: Bright center region on darker background" -ForegroundColor Magenta
            }
        }
        
        # Convert to base64 for potential OCR or external analysis
        $ms = New-Object System.IO.MemoryStream
        $img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
        $base64 = [Convert]::ToBase64String($ms.ToArray())
        $ms.Dispose()
        
        Write-Host "  Base64 Length: $($base64.Length) chars" -ForegroundColor Gray
        
        # Save analysis to file
        $analysisFile = $screenshot.FullName -replace '\.png$', '-analysis.txt'
        $analysis = @"
Screenshot: $($screenshot.Name)
Size: $($img.Width)x$($img.Height)
Bright Pixels: $brightPercent%
Dark Pixels: $darkPercent%
Center Brightness: $centerBrightPercent%
Top Colors:
$($topColors | ForEach-Object { "  $($_.Key): $([math]::Round(($_.Value / $sampledPixels) * 100, 1))%" } | Out-String)
"@
        Set-Content -Path $analysisFile -Value $analysis
        
        $bitmap.Dispose()
        $img.Dispose()
        
    } catch {
        Write-Host "  ERROR: $_" -ForegroundColor Red
    }
    
    Write-Host ""
}

Write-Host "=== ANALYSIS COMPLETE ===" -ForegroundColor Cyan

