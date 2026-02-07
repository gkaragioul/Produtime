#!/usr/bin/env python3
"""
ProduTime Server Deployment Script
Automates the setup of ProduTime on Ubuntu server
"""

import paramiko
import time
import sys

# Server configuration
SERVER_IP = "146.190.233.122"
SERVER_USER = "root"
SERVER_PASSWORD = "paulreedsmith1"

# Setup commands to run on the server
SETUP_COMMANDS = """
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
"""

def run_ssh_commands(hostname, username, password, commands):
    """Connect to server via SSH and run commands"""
    
    print(f"Connecting to {hostname}...")
    
    # Create SSH client
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    
    try:
        # Connect to the server
        client.connect(hostname, username=username, password=password, timeout=30)
        print("✓ Connected successfully!")
        
        # Execute commands
        print("\n" + "="*60)
        print("Starting server setup...")
        print("="*60 + "\n")
        
        # Run the setup script
        stdin, stdout, stderr = client.exec_command(commands, get_pty=True)
        
        # Stream output in real-time
        while True:
            line = stdout.readline()
            if not line:
                break
            print(line, end='')
            sys.stdout.flush()
        
        # Check for errors
        exit_status = stdout.channel.recv_exit_status()
        
        if exit_status == 0:
            print("\n" + "="*60)
            print("✓ Server setup completed successfully!")
            print("="*60)
        else:
            print("\n" + "="*60)
            print(f"✗ Setup failed with exit code: {exit_status}")
            print("="*60)
            stderr_output = stderr.read().decode()
            if stderr_output:
                print("\nErrors:")
                print(stderr_output)
        
        return exit_status == 0
        
    except paramiko.AuthenticationException:
        print("✗ Authentication failed. Please check your credentials.")
        return False
    except paramiko.SSHException as e:
        print(f"✗ SSH error: {e}")
        return False
    except Exception as e:
        print(f"✗ Error: {e}")
        return False
    finally:
        client.close()
        print("\nConnection closed.")

if __name__ == "__main__":
    print("="*60)
    print("ProduTime Server Deployment")
    print("="*60)
    print(f"Server: {SERVER_IP}")
    print(f"User: {SERVER_USER}")
    print("="*60 + "\n")
    
    success = run_ssh_commands(SERVER_IP, SERVER_USER, SERVER_PASSWORD, SETUP_COMMANDS)
    
    if success:
        print("\n✓ Deployment completed successfully!")
        sys.exit(0)
    else:
        print("\n✗ Deployment failed!")
        sys.exit(1)

