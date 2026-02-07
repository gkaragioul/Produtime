# Deploy License Manager Server to VPS
# This script uploads the License Manager server to the VPS and configures it

$VPS_HOST = "146.190.233.122"
$VPS_USER = "root"
$VPS_APP_DIR = "/var/www/produtime-license-server"
$VPS_DATA_DIR = "/var/lib/produtime-license-manager"

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "ProduTime License Server Deployment" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "VPS: $VPS_HOST"
Write-Host "App Directory: $VPS_APP_DIR"
Write-Host "Data Directory: $VPS_DATA_DIR"
Write-Host ""

# Step 1: Create deployment package
Write-Host "Creating deployment package..." -ForegroundColor Yellow
$tempDir = Join-Path $env:TEMP "license-server-deploy"
if (Test-Path $tempDir) {
    Remove-Item $tempDir -Recurse -Force
}
New-Item -ItemType Directory -Path $tempDir | Out-Null

# Copy necessary files
Write-Host "  Copying dist directory..."
Copy-Item -Path "license-manager\dist" -Destination "$tempDir\dist" -Recurse
Write-Host "  Copying package.json..."
Copy-Item -Path "license-manager\package.json" -Destination "$tempDir\package.json"

# Create PM2 ecosystem file
$ecosystemConfig = @"
module.exports = {
  apps: [{
    name: 'produtime-license-server',
    script: 'dist/main/server-entry.js',
    cwd: '$VPS_APP_DIR',
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
      DATA_DIR: '$VPS_DATA_DIR'
    },
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    error_file: '/var/log/produtime-license-server-error.log',
    out_file: '/var/log/produtime-license-server-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
  }]
};
"@

$ecosystemConfig | Out-File -FilePath (Join-Path $tempDir "ecosystem.config.js") -Encoding UTF8
Write-Host "Deployment package created" -ForegroundColor Green

# Step 2: Create directories on VPS
Write-Host "`nCreating directories on VPS..." -ForegroundColor Yellow
ssh ${VPS_USER}@${VPS_HOST} "mkdir -p $VPS_APP_DIR && mkdir -p $VPS_DATA_DIR/updates"
Write-Host "Directories created" -ForegroundColor Green

# Step 3: Upload files
Write-Host "`nUploading files to VPS..." -ForegroundColor Yellow
scp -r "$tempDir\*" "${VPS_USER}@${VPS_HOST}:$VPS_APP_DIR/"
Write-Host "Files uploaded" -ForegroundColor Green

# Step 4: Install dependencies
Write-Host "`nInstalling Node.js dependencies..." -ForegroundColor Yellow
ssh ${VPS_USER}@${VPS_HOST} "cd $VPS_APP_DIR && npm install --production"
Write-Host "Dependencies installed" -ForegroundColor Green

# Step 5: Stop existing PM2 process
Write-Host "`nStopping existing PM2 process..." -ForegroundColor Yellow
ssh ${VPS_USER}@${VPS_HOST} "pm2 delete produtime-license-server || true"
Write-Host "Existing process stopped" -ForegroundColor Green

# Step 6: Start with PM2
Write-Host "`nStarting License Server with PM2..." -ForegroundColor Yellow
ssh ${VPS_USER}@${VPS_HOST} "cd $VPS_APP_DIR && pm2 start ecosystem.config.js"
Write-Host "License Server started" -ForegroundColor Green

# Step 7: Save PM2 configuration
Write-Host "`nSaving PM2 configuration..." -ForegroundColor Yellow
ssh ${VPS_USER}@${VPS_HOST} "pm2 save"
Write-Host "PM2 configuration saved" -ForegroundColor Green

# Step 8: Setup PM2 startup
Write-Host "`nConfiguring PM2 startup..." -ForegroundColor Yellow
ssh ${VPS_USER}@${VPS_HOST} "pm2 startup systemd -u root --hp /root | grep 'sudo' | bash || true"
Write-Host "PM2 startup configured" -ForegroundColor Green

# Step 9: Check status
Write-Host "`nChecking PM2 status..." -ForegroundColor Yellow
ssh ${VPS_USER}@${VPS_HOST} "pm2 status"

# Step 10: Show logs
Write-Host "`nRecent logs:" -ForegroundColor Yellow
ssh ${VPS_USER}@${VPS_HOST} "pm2 logs produtime-license-server --lines 20 --nostream"

# Cleanup
Remove-Item $tempDir -Recurse -Force

Write-Host "`n============================================================" -ForegroundColor Green
Write-Host "DEPLOYMENT COMPLETE!" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "License Server is running at: http://$VPS_HOST:3000" -ForegroundColor Green
Write-Host "Database location: $VPS_DATA_DIR/licenses.db" -ForegroundColor Green
Write-Host "Updates directory: $VPS_DATA_DIR/updates" -ForegroundColor Green
Write-Host ""
Write-Host "Useful commands:" -ForegroundColor Cyan
Write-Host "  - View logs: ssh ${VPS_USER}@${VPS_HOST} 'pm2 logs produtime-license-server'"
Write-Host "  - Restart: ssh ${VPS_USER}@${VPS_HOST} 'pm2 restart produtime-license-server'"
Write-Host "  - Status: ssh ${VPS_USER}@${VPS_HOST} 'pm2 status'"
Write-Host ""

