#!/usr/bin/env python3
"""
Deploy License Manager Server to VPS
Uploads the standalone server to the VPS and configures it with PM2
"""

import paramiko
import os
import sys
from pathlib import Path

# VPS Configuration
VPS_HOST = "146.190.233.122"
VPS_USER = "root"
VPS_PASSWORD = "Paulreedsmith1"
VPS_PORT = 22
SSH_KEY_PATH = Path.home() / ".ssh" / "id_ed25519"

# Deployment paths
LOCAL_LICENSE_DIR = Path("license-manager")
VPS_APP_DIR = "/var/www/produtime-license-server"
VPS_DATA_DIR = "/var/lib/produtime-license-manager"

def run_command(ssh, command, description):
    """Execute a command on the VPS and print output"""
    print(f"\n{'='*60}")
    print(f"🔧 {description}")
    print(f"{'='*60}")
    print(f"Command: {command}\n")
    
    stdin, stdout, stderr = ssh.exec_command(command)
    exit_status = stdout.channel.recv_exit_status()
    
    output = stdout.read().decode('utf-8')
    error = stderr.read().decode('utf-8')
    
    if output:
        print(output)
    if error and exit_status != 0:
        print(f"⚠️ Error: {error}")
    
    if exit_status == 0:
        print(f"✅ {description} - SUCCESS")
    else:
        print(f"❌ {description} - FAILED (exit code: {exit_status})")
        
    return exit_status == 0

def upload_directory(sftp, local_path, remote_path, exclude_dirs=None):
    """Recursively upload a directory to the VPS"""
    if exclude_dirs is None:
        exclude_dirs = {'node_modules', '.git', 'release-vps', 'src'}
    
    print(f"\n📤 Uploading {local_path} to {remote_path}")
    
    # Create remote directory
    try:
        sftp.stat(remote_path)
    except FileNotFoundError:
        sftp.mkdir(remote_path)
    
    for item in os.listdir(local_path):
        local_item = os.path.join(local_path, item)
        remote_item = f"{remote_path}/{item}"
        
        if os.path.isfile(local_item):
            print(f"  📄 {item}")
            sftp.put(local_item, remote_item)
        elif os.path.isdir(local_item) and item not in exclude_dirs:
            upload_directory(sftp, local_item, remote_item, exclude_dirs)

def main():
    print("="*60)
    print("🚀 ProduTime License Server Deployment")
    print("="*60)
    print(f"VPS: {VPS_HOST}")
    print(f"App Directory: {VPS_APP_DIR}")
    print(f"Data Directory: {VPS_DATA_DIR}")
    
    # Connect to VPS
    print("\n🔌 Connecting to VPS...")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    try:
        # Try SSH key first, then password
        try:
            if SSH_KEY_PATH.exists():
                print(f"  Using SSH key: {SSH_KEY_PATH}")
                ssh.connect(VPS_HOST, port=VPS_PORT, username=VPS_USER, key_filename=str(SSH_KEY_PATH))
            else:
                print(f"  Using password authentication")
                ssh.connect(VPS_HOST, port=VPS_PORT, username=VPS_USER, password=VPS_PASSWORD)
        except:
            print(f"  SSH key failed, trying password...")
            ssh.connect(VPS_HOST, port=VPS_PORT, username=VPS_USER, password=VPS_PASSWORD)
        print("✅ Connected to VPS")
        
        sftp = ssh.open_sftp()
        
        # Step 1: Create directories
        run_command(ssh, f"mkdir -p {VPS_APP_DIR}", "Create app directory")
        run_command(ssh, f"mkdir -p {VPS_DATA_DIR}/updates", "Create data directory")
        
        # Step 2: Upload License Manager files
        print("\n📦 Uploading License Manager files...")
        
        # Upload dist directory (compiled code)
        upload_directory(sftp, str(LOCAL_LICENSE_DIR / "dist"), f"{VPS_APP_DIR}/dist")
        
        # Upload package.json
        print("  📄 package.json")
        sftp.put(str(LOCAL_LICENSE_DIR / "package.json"), f"{VPS_APP_DIR}/package.json")
        
        # Step 3: Install production dependencies
        run_command(
            ssh,
            f"cd {VPS_APP_DIR} && npm install --production",
            "Install Node.js dependencies"
        )
        
        # Step 4: Create PM2 ecosystem file
        ecosystem_config = f"""module.exports = {{
  apps: [{{
    name: 'produtime-license-server',
    script: 'dist/main/server-entry.js',
    cwd: '{VPS_APP_DIR}',
    env: {{
      NODE_ENV: 'production',
      PORT: 3000,
      DATA_DIR: '{VPS_DATA_DIR}'
    }},
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    error_file: '/var/log/produtime-license-server-error.log',
    out_file: '/var/log/produtime-license-server-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
  }}]
}};
"""
        
        print("\n📝 Creating PM2 ecosystem file...")
        with sftp.open(f"{VPS_APP_DIR}/ecosystem.config.js", 'w') as f:
            f.write(ecosystem_config)
        print("✅ PM2 ecosystem file created")
        
        # Step 5: Stop existing PM2 process (if any)
        run_command(ssh, "pm2 delete produtime-license-server || true", "Stop existing PM2 process")
        
        # Step 6: Start with PM2
        run_command(
            ssh,
            f"cd {VPS_APP_DIR} && pm2 start ecosystem.config.js",
            "Start License Server with PM2"
        )
        
        # Step 7: Save PM2 configuration
        run_command(ssh, "pm2 save", "Save PM2 configuration")
        
        # Step 8: Setup PM2 startup script
        run_command(ssh, "pm2 startup systemd -u root --hp /root", "Configure PM2 startup")
        
        # Step 9: Check status
        run_command(ssh, "pm2 status", "Check PM2 status")
        
        # Step 10: Show logs
        print("\n📋 Recent logs:")
        run_command(ssh, "pm2 logs produtime-license-server --lines 20 --nostream", "Show recent logs")
        
        print("\n" + "="*60)
        print("🎉 DEPLOYMENT COMPLETE!")
        print("="*60)
        print(f"\n✅ License Server is running at: http://{VPS_HOST}:3000")
        print(f"✅ Database location: {VPS_DATA_DIR}/licenses.db")
        print(f"✅ Updates directory: {VPS_DATA_DIR}/updates")
        print("\n📊 Useful commands:")
        print(f"  - View logs: ssh root@{VPS_HOST} 'pm2 logs produtime-license-server'")
        print(f"  - Restart: ssh root@{VPS_HOST} 'pm2 restart produtime-license-server'")
        print(f"  - Status: ssh root@{VPS_HOST} 'pm2 status'")
        
        sftp.close()
        
    except Exception as e:
        print(f"\n❌ Deployment failed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        ssh.close()

if __name__ == "__main__":
    main()

