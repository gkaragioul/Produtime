<# 
ProduTime v1.6.6 Client Deployment Script
Configures all clients to use License Manager for updates

Usage:
  .\deploy-clients.ps1 -LicenseManagerUrl "http://192.168.1.100:3000"
  .\deploy-clients.ps1 -LicenseManagerUrl "http://192.168.1.100:3000" -ComputerNames @("PC1", "PC2", "PC3")

#>

param(
  [Parameter(Mandatory=$true)]
  [string]$LicenseManagerUrl,
  
  [Parameter(Mandatory=$false)]
  [string[]]$ComputerNames = @("localhost"),
  
  [Parameter(Mandatory=$false)]
  [switch]$SkipRestart = $false
)

# Colors for output
$colors = @{
  Success = "Green"
  Error = "Red"
  Warning = "Yellow"
  Info = "Cyan"
}

function Write-Status {
  param(
    [string]$Message,
    [string]$Type = "Info"
  )
  $color = $colors[$Type]
  Write-Host $Message -ForegroundColor $color
}

function Configure-Client {
  param(
    [string]$ComputerName,
    [string]$Url
  )
  
  Write-Status "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" "Info"
  Write-Status "Configuring: $ComputerName" "Info"
  Write-Status "License Manager URL: $Url" "Info"
  Write-Status "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" "Info"
  
  try {
    if ($ComputerName -eq "localhost" -or $ComputerName -eq $env:COMPUTERNAME) {
      # Local configuration
      Write-Status "Setting environment variable (local)..." "Info"
      [Environment]::SetEnvironmentVariable(
        "LICENSE_MANAGER_URL",
        $Url,
        "User"
      )
      
      # Create config file as backup
      $appDataPath = "$env:APPDATA\ProduTime"
      if (-not (Test-Path $appDataPath)) {
        New-Item -ItemType Directory -Path $appDataPath -Force | Out-Null
      }
      
      $configFile = "$appDataPath\license-manager-url.txt"
      Set-Content -Path $configFile -Value $Url
      
      Write-Status "✅ Environment variable set" "Success"
      Write-Status "✅ Config file created: $configFile" "Success"
      
      # Verify
      $envValue = [Environment]::GetEnvironmentVariable("LICENSE_MANAGER_URL", "User")
      if ($envValue -eq $Url) {
        Write-Status "✅ Verification successful" "Success"
      } else {
        Write-Status "❌ Verification failed" "Error"
        return $false
      }
    } else {
      # Remote configuration
      Write-Status "Setting environment variable (remote)..." "Info"
      
      $scriptBlock = {
        param($Url)
        [Environment]::SetEnvironmentVariable(
          "LICENSE_MANAGER_URL",
          $Url,
          "User"
        )
        
        $appDataPath = "$env:APPDATA\ProduTime"
        if (-not (Test-Path $appDataPath)) {
          New-Item -ItemType Directory -Path $appDataPath -Force | Out-Null
        }
        
        $configFile = "$appDataPath\license-manager-url.txt"
        Set-Content -Path $configFile -Value $Url
        
        return $true
      }
      
      $result = Invoke-Command -ComputerName $ComputerName -ScriptBlock $scriptBlock -ArgumentList $Url
      
      if ($result) {
        Write-Status "✅ Remote configuration successful" "Success"
      } else {
        Write-Status "❌ Remote configuration failed" "Error"
        return $false
      }
    }
    
    return $true
  } catch {
    Write-Status "❌ Error: $_" "Error"
    return $false
  }
}

function Test-Connection {
  param(
    [string]$ComputerName,
    [string]$Url
  )
  
  Write-Status "Testing connection..." "Info"
  
  try {
    if ($ComputerName -eq "localhost" -or $ComputerName -eq $env:COMPUTERNAME) {
      # Local test
      $response = Invoke-WebRequest -Uri "$Url/api/updates/check?version=1.6.6" -ErrorAction Stop
      if ($response.StatusCode -eq 200) {
        Write-Status "✅ Connection successful" "Success"
        return $true
      }
    } else {
      # Remote test
      $scriptBlock = {
        param($Url)
        try {
          $response = Invoke-WebRequest -Uri "$Url/api/updates/check?version=1.6.6" -ErrorAction Stop
          return $response.StatusCode -eq 200
        } catch {
          return $false
        }
      }
      
      $result = Invoke-Command -ComputerName $ComputerName -ScriptBlock $scriptBlock -ArgumentList $Url
      if ($result) {
        Write-Status "✅ Connection successful" "Success"
        return $true
      }
    }
  } catch {
    Write-Status "⚠️  Connection test failed: $_" "Warning"
    Write-Status "This may be normal if License Manager is not yet running" "Warning"
    return $false
  }
}

function Restart-ProduTime {
  param(
    [string]$ComputerName
  )
  
  Write-Status "Restarting ProduTime..." "Info"
  
  try {
    if ($ComputerName -eq "localhost" -or $ComputerName -eq $env:COMPUTERNAME) {
      # Local restart
      Stop-Process -Name "ProduTime" -Force -ErrorAction SilentlyContinue
      Start-Sleep -Seconds 2
      Write-Status "✅ ProduTime restarted (local)" "Success"
    } else {
      # Remote restart
      $scriptBlock = {
        Stop-Process -Name "ProduTime" -Force -ErrorAction SilentlyContinue
      }
      
      Invoke-Command -ComputerName $ComputerName -ScriptBlock $scriptBlock
      Write-Status "✅ ProduTime restarted (remote)" "Success"
    }
  } catch {
    Write-Status "⚠️  Could not restart ProduTime: $_" "Warning"
  }
}

# Main execution
Write-Status "╔════════════════════════════════════════════════════════════════╗" "Info"
Write-Status "║  ProduTime v1.6.6 Client Deployment Script                    ║" "Info"
Write-Status "╚════════════════════════════════════════════════════════════════╝" "Info"
Write-Status ""

Write-Status "Configuration:" "Info"
Write-Status "  License Manager URL: $LicenseManagerUrl" "Info"
Write-Status "  Computers: $($ComputerNames -join ', ')" "Info"
Write-Status "  Skip Restart: $SkipRestart" "Info"
Write-Status ""

$successCount = 0
$failureCount = 0

foreach ($computer in $ComputerNames) {
  $configured = Configure-Client -ComputerName $computer -Url $LicenseManagerUrl
  
  if ($configured) {
    Test-Connection -ComputerName $computer -Url $LicenseManagerUrl
    
    if (-not $SkipRestart) {
      Restart-ProduTime -ComputerName $computer
    }
    
    $successCount++
  } else {
    $failureCount++
  }
  
  Write-Status ""
}

# Summary
Write-Status "╔════════════════════════════════════════════════════════════════╗" "Info"
Write-Status "║  Deployment Summary                                           ║" "Info"
Write-Status "╚════════════════════════════════════════════════════════════════╝" "Info"
Write-Status "  ✅ Successful: $successCount" "Success"
Write-Status "  ❌ Failed: $failureCount" $(if ($failureCount -gt 0) { "Error" } else { "Success" })
Write-Status ""

if ($failureCount -eq 0) {
  Write-Status "✅ All clients configured successfully!" "Success"
  Write-Status ""
  Write-Status "Next steps:" "Info"
  Write-Status "  1. Verify License Manager is running" "Info"
  Write-Status "  2. Upload update to License Manager" "Info"
  Write-Status "  3. Clients will check for updates automatically" "Info"
} else {
  Write-Status "⚠️  Some clients failed to configure" "Warning"
  Write-Status "Please check the errors above and try again" "Warning"
}

Write-Status ""
Write-Status "For more information, see QUICK_START_DEPLOYMENT.md" "Info"

