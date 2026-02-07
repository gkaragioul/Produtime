# Convert Screenshot to ASCII Art
# Creates a text representation of the screenshot that AI can read

param(
    [string]$ScreenshotPath = "logs\screenshots-2025-11-15_19-17-27\fullscreen-12.2-s.png",
    [int]$Width = 120,
    [int]$Height = 60
)

$ErrorActionPreference = "Continue"

Write-Host "=== SCREENSHOT TO ASCII ===" -ForegroundColor Cyan

Add-Type -AssemblyName System.Drawing

try {
    $img = [System.Drawing.Image]::FromFile($ScreenshotPath)
    $bitmap = New-Object System.Drawing.Bitmap $img
    
    Write-Host "Original Size: $($img.Width)x$($img.Height)" -ForegroundColor Gray
    Write-Host "ASCII Size: $Width x $Height" -ForegroundColor Gray
    
    # ASCII characters from dark to bright
    $asciiChars = @(' ', '.', ':', '-', '=', '+', '*', '#', '%', '@')
    
    $scaleX = $img.Width / $Width
    $scaleY = $img.Height / $Height
    
    $output = ""
    
    for ($y = 0; $y -lt $Height; $y++) {
        $line = ""
        for ($x = 0; $x -lt $Width; $x++) {
            $srcX = [int]($x * $scaleX)
            $srcY = [int]($y * $scaleY)
            
            $pixel = $bitmap.GetPixel($srcX, $srcY)
            $brightness = ($pixel.R + $pixel.G + $pixel.B) / 3
            
            $charIndex = [math]::Floor($brightness / 255 * ($asciiChars.Length - 1))
            $char = $asciiChars[$charIndex]
            
            $line += $char
        }
        $output += $line + "`n"
        Write-Host $line -ForegroundColor Gray
    }
    
    # Save to file
    $outputPath = $ScreenshotPath -replace '\.png$', '-ascii.txt'
    Set-Content -Path $outputPath -Value $output
    Write-Host ""
    Write-Host "Saved to: $outputPath" -ForegroundColor Green
    
    $bitmap.Dispose()
    $img.Dispose()
    
} catch {
    Write-Host "ERROR: $_" -ForegroundColor Red
}

Write-Host "=== COMPLETE ===" -ForegroundColor Cyan

