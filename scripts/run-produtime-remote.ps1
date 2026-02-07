# ProduTime Remote Configuration Script
# Run this on the remote PC before launching ProduTime
# This configures ProduTime to connect to the License Manager on GeorgeK-PC

Write-Host "╔════════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║         ProduTime Remote License Manager Configuration         ║" -ForegroundColor Cyan
Write-Host "╚════════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# License Manager Details
$licenseManagerIP = "146.190.233.122"
$licenseManagerPort = "3000"
$activationURL = "http://$licenseManagerIP`:$licenseManagerPort/activate"
$validationURL = "http://$licenseManagerIP`:$licenseManagerPort/validate"

Write-Host "📋 License Manager Configuration:" -ForegroundColor Yellow
Write-Host "   PC Name: GeorgeK-PC" -ForegroundColor Gray
Write-Host "   Public IP: $licenseManagerIP" -ForegroundColor Gray
Write-Host "   Port: $licenseManagerPort" -ForegroundColor Gray
Write-Host ""

Write-Host "🔗 URLs:" -ForegroundColor Yellow
Write-Host "   Activation: $activationURL" -ForegroundColor Gray
Write-Host "   Validation: $validationURL" -ForegroundColor Gray
Write-Host ""

# Test connectivity
Write-Host "🧪 Testing connectivity..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://$licenseManagerIP`:$licenseManagerPort/health" `
        -UseBasicParsing -TimeoutSec 5
    
    if ($response.StatusCode -eq 200) {
        Write-Host "✅ License Manager is reachable!" -ForegroundColor Green
        Write-Host "   Response: $($response.Content)" -ForegroundColor Gray
    } else {
        Write-Host "⚠️  License Manager responded with status $($response.StatusCode)" -ForegroundColor Yellow
    }
} catch {
    Write-Host "❌ Cannot reach License Manager at $licenseManagerIP`:$licenseManagerPort" -ForegroundColor Red
    Write-Host "   Error: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ""
    Write-Host "Troubleshooting:" -ForegroundColor Yellow
    Write-Host "   1. Check if License Manager is running on GeorgeK-PC" -ForegroundColor Gray
    Write-Host "   2. Check firewall allows port 3000" -ForegroundColor Gray
    Write-Host "   3. Check network connectivity" -ForegroundColor Gray
    Write-Host "   4. Verify IP address is correct: $licenseManagerIP" -ForegroundColor Gray
    Write-Host ""
    $continue = Read-Host "Continue anyway? (y/n)"
    if ($continue -ne "y") {
        exit 1
    }
}

Write-Host ""
Write-Host "⚙️  Setting environment variables..." -ForegroundColor Yellow

# Set environment variables for this session
$env:ACTIVATION_SERVER_URL = $activationURL
$env:VALIDATION_SERVER_URL = $validationURL

Write-Host "✅ Environment variables set:" -ForegroundColor Green
Write-Host "   ACTIVATION_SERVER_URL=$($env:ACTIVATION_SERVER_URL)" -ForegroundColor Gray
Write-Host "   VALIDATION_SERVER_URL=$($env:VALIDATION_SERVER_URL)" -ForegroundColor Gray
Write-Host ""

# Find ProduTime executable
Write-Host "🔍 Looking for ProduTime.exe..." -ForegroundColor Yellow

$produTimeExe = $null

# Check current directory
if (Test-Path ".\ProduTime.exe") {
    $produTimeExe = ".\ProduTime.exe"
    Write-Host "✅ Found in current directory" -ForegroundColor Green
}
# Check Desktop
elseif (Test-Path "$env:USERPROFILE\Desktop\ProduTime-1.6.6-Clean\ProduTime.exe") {
    $produTimeExe = "$env:USERPROFILE\Desktop\ProduTime-1.6.6-Clean\ProduTime.exe"
    Write-Host "✅ Found on Desktop" -ForegroundColor Green
}
# Check Program Files
elseif (Test-Path "C:\Program Files\ProduTime\ProduTime.exe") {
    $produTimeExe = "C:\Program Files\ProduTime\ProduTime.exe"
    Write-Host "✅ Found in Program Files" -ForegroundColor Green
}
else {
    Write-Host "❌ ProduTime.exe not found" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please specify the path to ProduTime.exe:" -ForegroundColor Yellow
    $produTimeExe = Read-Host "Path"
    
    if (-not (Test-Path $produTimeExe)) {
        Write-Host "❌ File not found: $produTimeExe" -ForegroundColor Red
        exit 1
    }
}

Write-Host ""
Write-Host "🚀 Launching ProduTime..." -ForegroundColor Yellow
Write-Host "   Executable: $produTimeExe" -ForegroundColor Gray
Write-Host ""

# Launch ProduTime with environment variables
try {
    & $produTimeExe
} catch {
    Write-Host "❌ Failed to launch ProduTime" -ForegroundColor Red
    Write-Host "   Error: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "✅ ProduTime launched successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "📝 Notes:" -ForegroundColor Yellow
Write-Host "   • ProduTime will validate with License Manager every 2 minutes" -ForegroundColor Gray
Write-Host "   • If license is deleted, app will lock within 2 minutes" -ForegroundColor Gray
Write-Host "   • Check ProduTime logs for any connection issues" -ForegroundColor Gray
Write-Host ""

