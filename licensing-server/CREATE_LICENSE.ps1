# ProduTime License Creation Script
# Usage: .\CREATE_LICENSE.ps1 -CustomerName "John Doe" -ExpiryDays 365
# For unlimited license: .\CREATE_LICENSE.ps1 -CustomerName "John Doe" -ExpiryDays 0

param(
    [Parameter(Mandatory=$true)]
    [string]$CustomerName,

    [Parameter(Mandatory=$false)]
    [int]$ExpiryDays = 365,

    [Parameter(Mandatory=$false)]
    [string]$Notes = ""
)

$ErrorActionPreference = "Stop"

$ServerUrl = "https://produtime-licensing-server-production.up.railway.app"
$AdminEmail = "admin@produtime.local"
$AdminPassword = "ProduTime2026!Admin"

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  ProduTime License Creation Tool" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Login
Write-Host "[1/3] Logging in to admin account..." -ForegroundColor Yellow

$loginBody = @{
    email = $AdminEmail
    password = $AdminPassword
} | ConvertTo-Json

try {
    $loginResponse = Invoke-RestMethod -Uri "$ServerUrl/v1/auth/login" `
        -Method Post `
        -ContentType "application/json" `
        -Body $loginBody

    $accessToken = $loginResponse.accessToken
    Write-Host "      Login successful!" -ForegroundColor Green
} catch {
    Write-Host "      Login failed: $_" -ForegroundColor Red
    exit 1
}

# Step 2: Create License
Write-Host ""
Write-Host "[2/3] Creating license for: $CustomerName" -ForegroundColor Yellow

$expiryDate = $null
if ($ExpiryDays -gt 0) {
    $expiryDate = (Get-Date).AddDays($ExpiryDays).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
}

$licenseBody = @{
    customerName = $CustomerName
    plan = "STANDARD"
    seats = 1
    expiryDate = $expiryDate
    notes = $Notes
} | ConvertTo-Json

try {
    $licenseResponse = Invoke-RestMethod -Uri "$ServerUrl/v1/licenses" `
        -Method Post `
        -Headers @{
            "Authorization" = "Bearer $accessToken"
            "Content-Type" = "application/json"
        } `
        -Body $licenseBody

    $licenseId = $licenseResponse.id
    Write-Host "      License created successfully!" -ForegroundColor Green
    Write-Host "      License ID: $licenseId" -ForegroundColor Gray
} catch {
    Write-Host "      Failed to create license: $_" -ForegroundColor Red
    exit 1
}

# Step 3: Generate License Key
Write-Host ""
Write-Host "[3/3] Generating license key..." -ForegroundColor Yellow

$keyBody = @{
    label = "Main Key for $CustomerName"
} | ConvertTo-Json

try {
    $keyResponse = Invoke-RestMethod -Uri "$ServerUrl/v1/licenses/$licenseId/keys" `
        -Method Post `
        -Headers @{
            "Authorization" = "Bearer $accessToken"
            "Content-Type" = "application/json"
        } `
        -Body $keyBody

    $licenseKey = $keyResponse.licenseKey
    Write-Host "      License key generated!" -ForegroundColor Green
} catch {
    Write-Host "      Failed to generate key: $_" -ForegroundColor Red
    exit 1
}

# Display Summary
Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  License Created Successfully!" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Customer:    $CustomerName" -ForegroundColor White
Write-Host "License ID:  $licenseId" -ForegroundColor Gray
if ($ExpiryDays -eq 0) {
    Write-Host "Expires:     Never (Unlimited)" -ForegroundColor Green
} else {
    Write-Host "Expires:     $expiryDate" -ForegroundColor Gray
}
Write-Host ""
Write-Host "LICENSE KEY:" -ForegroundColor Yellow
Write-Host $licenseKey -ForegroundColor Green
Write-Host ""
Write-Host "Send this license key to your customer!" -ForegroundColor White
Write-Host ""
