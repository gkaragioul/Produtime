# Configure Nginx for License Manager
$VPS_HOST = "146.190.233.122"
$VPS_USER = "root"

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "Configuring Nginx for License Manager" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

# Create Nginx configuration
$nginxConfig = @"
server {
    listen 80;
    listen [::]:80;
    server_name $VPS_HOST;

    # Increase client body size for update uploads (500MB)
    client_max_body_size 500M;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade `$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host `$host;
        proxy_set_header X-Real-IP `$remote_addr;
        proxy_set_header X-Forwarded-For `$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto `$scheme;
        proxy_cache_bypass `$http_upgrade;
        
        # Timeouts for large file uploads
        proxy_connect_timeout 600;
        proxy_send_timeout 600;
        proxy_read_timeout 600;
        send_timeout 600;
    }
}
"@

Write-Host "`nCreating Nginx configuration..." -ForegroundColor Yellow

# Create temp file with config
$tempConfig = Join-Path $env:TEMP "license-manager-nginx.conf"
# Use ASCII encoding to avoid BOM
$nginxConfig | Out-File -FilePath $tempConfig -Encoding ASCII

# Upload config to VPS
Write-Host "Uploading Nginx configuration..." -ForegroundColor Yellow
scp $tempConfig "${VPS_USER}@${VPS_HOST}:/etc/nginx/sites-available/license-manager"

# Enable the site
Write-Host "Enabling Nginx site..." -ForegroundColor Yellow
ssh ${VPS_USER}@${VPS_HOST} "ln -sf /etc/nginx/sites-available/license-manager /etc/nginx/sites-enabled/license-manager"

# Remove default site if it exists
ssh ${VPS_USER}@${VPS_HOST} "rm -f /etc/nginx/sites-enabled/default"

# Test Nginx configuration
Write-Host "Testing Nginx configuration..." -ForegroundColor Yellow
ssh ${VPS_USER}@${VPS_HOST} "nginx -t"

# Reload Nginx
Write-Host "Reloading Nginx..." -ForegroundColor Yellow
ssh ${VPS_USER}@${VPS_HOST} "systemctl reload nginx"

# Check Nginx status
Write-Host "Checking Nginx status..." -ForegroundColor Yellow
ssh ${VPS_USER}@${VPS_HOST} "systemctl status nginx --no-pager"

# Cleanup
Remove-Item $tempConfig -Force

Write-Host "`n============================================================" -ForegroundColor Green
Write-Host "Nginx Configuration Complete!" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "License Manager is now accessible at:" -ForegroundColor Green
Write-Host "  http://$VPS_HOST" -ForegroundColor Cyan
Write-Host ""
Write-Host "Test the connection:" -ForegroundColor Yellow
Write-Host "  curl http://$VPS_HOST/health" -ForegroundColor Cyan
Write-Host ""

