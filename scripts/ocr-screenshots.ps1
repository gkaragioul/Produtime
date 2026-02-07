# OCR Screenshots using Windows OCR
# Extracts text from screenshots so AI can read what's displayed

param(
    [string]$ScreenshotDir = "logs\screenshots-2025-11-15_19-17-27"
)

$ErrorActionPreference = "Continue"

Write-Host "=== OCR SCREENSHOT ANALYSIS ===" -ForegroundColor Cyan

# Load required assemblies
Add-Type -AssemblyName System.Runtime.WindowsRuntime
Add-Type -AssemblyName System.Drawing

# Load WinRT types
[Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime] | Out-Null
[Windows.Foundation.IAsyncOperation`1,Windows.Foundation,ContentType=WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder,Windows.Foundation,ContentType=WindowsRuntime] | Out-Null
[Windows.Storage.StorageFile,Windows.Foundation,ContentType=WindowsRuntime] | Out-Null
[Windows.Storage.Streams.RandomAccessStream,Windows.Foundation,ContentType=WindowsRuntime] | Out-Null

# Helper function to await async operations
function Await {
    param($AsyncTask, $ResultType)
    $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { 
        $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' 
    })[0]
    $asTaskGeneric = $asTask.MakeGenericMethod($ResultType)
    $task = $asTaskGeneric.Invoke($null, @($AsyncTask))
    $task.Wait(-1) | Out-Null
    return $task.Result
}

try {
    # Get OCR engine for English
    $ocrEngine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new("en-US"))
    
    if ($null -eq $ocrEngine) {
        Write-Host "ERROR: Could not create OCR engine. Installing language pack..." -ForegroundColor Red
        Write-Host "Please install English language pack in Windows Settings > Time & Language > Language" -ForegroundColor Yellow
        exit 1
    }
    
    Write-Host "OCR Engine ready: $($ocrEngine.RecognizerLanguage.DisplayName)" -ForegroundColor Green
    
} catch {
    Write-Host "ERROR: Failed to initialize OCR: $_" -ForegroundColor Red
    Write-Host "Falling back to pixel-based text detection..." -ForegroundColor Yellow
}

$screenshots = Get-ChildItem $ScreenshotDir -Filter "fullscreen-*.png" | Sort-Object Name

foreach ($screenshot in $screenshots) {
    Write-Host ""
    Write-Host "=== $($screenshot.Name) ===" -ForegroundColor Yellow
    
    try {
        if ($null -ne $ocrEngine) {
            # Use Windows OCR
            $fileTask = [Windows.Storage.StorageFile]::GetFileFromPathAsync($screenshot.FullName)
            $file = Await $fileTask ([Windows.Storage.StorageFile])
            
            $streamTask = $file.OpenAsync([Windows.Storage.FileAccessMode]::Read)
            $stream = Await $streamTask ([Windows.Storage.Streams.IRandomAccessStream])
            
            $decoderTask = [Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)
            $decoder = Await $decoderTask ([Windows.Graphics.Imaging.BitmapDecoder])
            
            $bitmapTask = $decoder.GetSoftwareBitmapAsync()
            $bitmap = Await $bitmapTask ([Windows.Graphics.Imaging.SoftwareBitmap])
            
            $ocrResultTask = $ocrEngine.RecognizeAsync($bitmap)
            $ocrResult = Await $ocrResultTask ([Windows.Media.Ocr.OcrResult])
            
            $text = $ocrResult.Text
            
            if ($text.Trim().Length -gt 0) {
                Write-Host "TEXT FOUND:" -ForegroundColor Green
                Write-Host $text -ForegroundColor White
                
                # Save to file
                $textFile = $screenshot.FullName -replace '\.png$', '-ocr.txt'
                Set-Content -Path $textFile -Value $text
                Write-Host "Saved to: $textFile" -ForegroundColor Gray
            } else {
                Write-Host "No text detected" -ForegroundColor Gray
            }
            
            $stream.Dispose()
            
        } else {
            Write-Host "OCR not available - skipping" -ForegroundColor Gray
        }
        
    } catch {
        Write-Host "ERROR: $_" -ForegroundColor Red
        Write-Host "Stack: $($_.ScriptStackTrace)" -ForegroundColor DarkGray
    }
}

Write-Host ""
Write-Host "=== OCR COMPLETE ===" -ForegroundColor Cyan

# Summary
Write-Host ""
Write-Host "=== SUMMARY ===" -ForegroundColor Cyan
$ocrFiles = Get-ChildItem $ScreenshotDir -Filter "*-ocr.txt"
if ($ocrFiles.Count -gt 0) {
    Write-Host "Found text in $($ocrFiles.Count) screenshots" -ForegroundColor Green
    foreach ($file in $ocrFiles) {
        $content = Get-Content $file.FullName -Raw
        if ($content.Trim().Length -gt 0) {
            Write-Host ""
            Write-Host "--- $($file.Name) ---" -ForegroundColor Yellow
            Write-Host $content -ForegroundColor White
        }
    }
} else {
    Write-Host "No text found in any screenshots" -ForegroundColor Yellow
}

