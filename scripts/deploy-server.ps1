# ProduTime Server Deployment Script
# This script automates the setup of ProduTime on Ubuntu server

$serverIP = "146.190.233.122"
$serverUser = "root"
$password = "paulreedsmith1"

Write-Host "Starting ProduTime Server Deployment..." -ForegroundColor Green

# Create a temporary script file with all commands
$setupScript = @'
#!/bin/bash
set -e

echo "=== Updating system packages ==="
apt update
DEBIAN_FRONTEND=noninteractive apt upgrade -y

echo "=== Installing Node.js and npm ==="
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

echo "=== Installing PostgreSQL ==="
apt install -y postgresql postgresql-contrib

echo "=== Installing other dependencies ==="
apt install -y git nginx certbot python3-certbot-nginx

echo "=== Setting up PostgreSQL database ==="
sudo -u postgres psql -c "CREATE DATABASE produtime;" || echo "Database already exists"
sudo -u postgres psql -c "CREATE USER produtimeuser WITH PASSWORD 'produtime_secure_password_2024';" || echo "User already exists"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE produtime TO produtimeuser;"
sudo -u postgres psql -c "ALTER DATABASE produtime OWNER TO produtimeuser;"

echo "=== Creating application directory ==="
mkdir -p /var/www/produtime
cd /var/www/produtime

echo "=== Installing PM2 for process management ==="
npm install -g pm2

echo "=== Setting up firewall ==="
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 3000/tcp
ufw --force enable

echo "=== Server setup complete! ==="
echo "Node version: $(node --version)"
echo "npm version: $(npm --version)"
echo "PostgreSQL is running"
echo ""
echo "Next steps:"
echo "1. Upload your ProduTime application files to /var/www/produtime"
echo "2. Configure environment variables"
echo "3. Start the application with PM2"
'@

# Save the script to a temporary file
$tempScriptPath = Join-Path $env:TEMP "produtime-setup.sh"
$setupScript | Out-File -FilePath $tempScriptPath -Encoding UTF8 -NoNewline

Write-Host "Setup script created at: $tempScriptPath" -ForegroundColor Cyan

# Use plink (PuTTY's command-line tool) if available, otherwise use ssh with expect-like behavior
Write-Host "`nAttempting to connect and run setup script..." -ForegroundColor Yellow

# Method 1: Try using echo to pipe password
$command = @"
echo $password | ssh -o StrictHostKeyChecking=no $serverUser@$serverIP 'bash -s' < $tempScriptPath
"@

Write-Host "`nExecuting setup on server..." -ForegroundColor Green
Write-Host "This may take several minutes..." -ForegroundColor Yellow

# Execute the command
Invoke-Expression $command

Write-Host "`n=== Deployment Complete! ===" -ForegroundColor Green

