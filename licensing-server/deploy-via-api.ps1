# Railway API Deployment Script
$ErrorActionPreference = "Stop"

$token = "0cb4b579-777f-4129-816b-d4106d2d537c"
$projectId = "925b1b9c-6fc0-4a19-8f80-aefca92f4ca7"
$environmentId = "562947a2-66ff-4995-840f-10dca09b9e85"
$githubRepo = "georgekgr12/produtime-licensing-server"

Write-Host "===============================================" -ForegroundColor Cyan
Write-Host "  Railway API Deployment for ProduTime v1.8  " -ForegroundColor Cyan
Write-Host "===============================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Create a new service
Write-Host "[1/5] Creating new service..." -ForegroundColor Yellow

$createServiceQuery = @"
mutation {
  serviceCreate(input: {
    projectId: \"$projectId\"
    environmentId: \"$environmentId\"
    name: \"produtime-api\"
  }) {
    id
    name
  }
}
"@

$createServiceBody = @{
    query = $createServiceQuery
} | ConvertTo-Json

try {
    $response = Invoke-RestMethod -Uri "https://backboard.railway.app/graphql/v2" `
        -Method Post `
        -Headers @{
            "Authorization" = "Bearer $token"
            "Content-Type" = "application/json"
        } `
        -Body $createServiceBody

    $serviceId = $response.data.serviceCreate.id
    Write-Host "✓ Service created: $serviceId" -ForegroundColor Green
} catch {
    Write-Host "✗ Failed to create service: $_" -ForegroundColor Red
    Write-Host "Response: $($_.ErrorDetails.Message)" -ForegroundColor Red
    exit 1
}

# Step 2: Connect GitHub repo
Write-Host ""
Write-Host "[2/5] Connecting GitHub repository..." -ForegroundColor Yellow

$connectRepoQuery = @"
mutation {
  serviceConnect(input: {
    serviceId: \"$serviceId\"
    repo: \"$githubRepo\"
    branch: \"master\"
  }) {
    id
  }
}
"@

$connectRepoBody = @{
    query = $connectRepoQuery
} | ConvertTo-Json

try {
    $response = Invoke-RestMethod -Uri "https://backboard.railway.app/graphql/v2" `
        -Method Post `
        -Headers @{
            "Authorization" = "Bearer $token"
            "Content-Type" = "application/json"
        } `
        -Body $connectRepoBody

    Write-Host "✓ GitHub repository connected" -ForegroundColor Green
} catch {
    Write-Host "✗ Failed to connect repo: $_" -ForegroundColor Red
    Write-Host "Response: $($_.ErrorDetails.Message)" -ForegroundColor Red
}

# Step 3: Set environment variables
Write-Host ""
Write-Host "[3/5] Setting environment variables..." -ForegroundColor Yellow

$envVars = @{
    "ED25519_PRIVATE_KEY" = "29nD/vXDPy/eVmQBWSWeRrYUzxiZt5gftlap2WGHpIfIGkzqZVMFsb2PxKZCVAW9FaUvxN87Ae7NYQ7vOEfODA=="
    "ED25519_PUBLIC_KEY" = "yBpM6mVTBbG9j8SmQlQFvRWlL8TfOwHuzWEO7zhHzgw="
    "JWT_SECRET" = "produtime-v18-jwt-secret-secure-random-string-2026"
    "DEFAULT_ADMIN_EMAIL" = "admin@produtime.local"
    "DEFAULT_ADMIN_PASSWORD" = "ProduTime2026!Admin"
    "NODE_ENV" = "production"
    "PORT" = "3000"
}

foreach ($key in $envVars.Keys) {
    $value = $envVars[$key]
    $setVarQuery = @"
mutation {
  variableUpsert(input: {
    serviceId: \"$serviceId\"
    environmentId: \"$environmentId\"
    name: \"$key\"
    value: \"$value\"
  })
}
"@

    $setVarBody = @{
        query = $setVarQuery
    } | ConvertTo-Json

    try {
        Invoke-RestMethod -Uri "https://backboard.railway.app/graphql/v2" `
            -Method Post `
            -Headers @{
                "Authorization" = "Bearer $token"
                "Content-Type" = "application/json"
            } `
            -Body $setVarBody | Out-Null

        Write-Host "  ✓ Set $key" -ForegroundColor Green
    } catch {
        Write-Host "  ✗ Failed to set $key" -ForegroundColor Red
    }
}

# Step 4: Trigger deployment
Write-Host ""
Write-Host "[4/5] Triggering deployment..." -ForegroundColor Yellow

$deployQuery = @"
mutation {
  serviceInstanceRedeploy(serviceId: \"$serviceId\", environmentId: \"$environmentId\")
}
"@

$deployBody = @{
    query = $deployQuery
} | ConvertTo-Json

try {
    Invoke-RestMethod -Uri "https://backboard.railway.app/graphql/v2" `
        -Method Post `
        -Headers @{
            "Authorization" = "Bearer $token"
            "Content-Type" = "application/json"
        } `
        -Body $deployBody | Out-Null

    Write-Host "✓ Deployment triggered" -ForegroundColor Green
} catch {
    Write-Host "✗ Failed to trigger deployment: $_" -ForegroundColor Red
}

# Step 5: Get service URL
Write-Host ""
Write-Host "[5/5] Getting service URL..." -ForegroundColor Yellow
Write-Host "(This may take a moment...)" -ForegroundColor Gray

Start-Sleep -Seconds 5

$getUrlQuery = @"
{
  service(id: \"$serviceId\") {
    domains {
      domain
    }
  }
}
"@

$getUrlBody = @{
    query = $getUrlQuery
} | ConvertTo-Json

try {
    $response = Invoke-RestMethod -Uri "https://backboard.railway.app/graphql/v2" `
        -Method Post `
        -Headers @{
            "Authorization" = "Bearer $token"
            "Content-Type" = "application/json"
        } `
        -Body $getUrlBody

    if ($response.data.service.domains.Count -gt 0) {
        $domain = $response.data.service.domains[0].domain
        Write-Host "✓ Service URL: https://$domain" -ForegroundColor Green
    } else {
        Write-Host "! No domain generated yet. Generate one in Railway dashboard." -ForegroundColor Yellow
    }
} catch {
    Write-Host "✗ Failed to get URL: $_" -ForegroundColor Red
}

Write-Host ""
Write-Host "===============================================" -ForegroundColor Cyan
Write-Host "  Deployment Complete!  " -ForegroundColor Cyan
Write-Host "===============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "1. Check deployment status in Railway dashboard"
Write-Host "2. Generate a public domain if not auto-generated"
Write-Host "3. Test: curl https://YOUR-URL/v1/public-key"
Write-Host ""
