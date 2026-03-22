# Find And Study OS — Hostinger VPS Deployment Guide

## Table of Contents

1. [VPS Requirements](#vps-requirements)
2. [Initial Server Setup](#initial-server-setup)
3. [PostgreSQL Setup](#postgresql-setup)
4. [Node.js Installation](#nodejs-installation)
5. [Project Setup](#project-setup)
6. [Environment Configuration](#environment-configuration)
7. [First Deploy](#first-deploy)
8. [Nginx Setup](#nginx-setup)
9. [SSL with Let's Encrypt](#ssl-with-lets-encrypt)
10. [PM2 Auto-Start](#pm2-auto-start)
11. [Updates & Redeployment](#updates--redeployment)
12. [Rollback](#rollback)
13. [Monitoring](#monitoring)
14. [Troubleshooting](#troubleshooting)

---

## VPS Requirements

- **OS**: Ubuntu 22.04+ or Debian 12+
- **RAM**: Minimum 2 GB (4 GB recommended)
- **CPU**: 2+ cores
- **Disk**: 20 GB+ SSD
- **Software**: Node.js 20+, PostgreSQL 16, Nginx, PM2

---

## Initial Server Setup

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install essential tools
sudo apt install -y curl git build-essential ufw

# Configure firewall
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

---

## PostgreSQL Setup

```bash
# Install PostgreSQL 16
sudo apt install -y postgresql postgresql-contrib

# Start and enable
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Create database and user
sudo -u postgres psql <<EOF
CREATE USER findandstudy WITH PASSWORD 'your-secure-password';
CREATE DATABASE findandstudy_db OWNER findandstudy;
GRANT ALL PRIVILEGES ON DATABASE findandstudy_db TO findandstudy;
\c findandstudy_db
GRANT ALL ON SCHEMA public TO findandstudy;
EOF
```

Your `DATABASE_URL` will be:
```
postgresql://findandstudy:your-secure-password@localhost:5432/findandstudy_db
```

---

## Node.js Installation

```bash
# Install Node.js 20 via NodeSource
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Install pnpm globally
npm install -g pnpm

# Install PM2 globally
npm install -g pm2

# Verify versions
node --version    # v20.x.x
pnpm --version
pm2 --version
```

---

## Project Setup

```bash
# Create app directory
sudo mkdir -p /var/www/findandstudy
sudo chown $USER:$USER /var/www/findandstudy

# Clone or upload your project
cd /var/www/findandstudy
git clone https://your-repo-url.git .
# Or upload via SFTP/rsync

# Install dependencies
pnpm install --frozen-lockfile
```

---

## Environment Configuration

```bash
# Copy and edit the environment file
cp deploy/.env.example .env
nano .env
```

**Required variables to set:**
- `DATABASE_URL` — Your PostgreSQL connection string
- `ALLOWED_ORIGINS` — Your domain(s), e.g., `https://yourdomain.com`
- `SESSION_SECRET` — Generate with: `openssl rand -hex 32`

---

## First Deploy

```bash
# Run the full deploy script
bash deploy/deploy.sh
```

This will:
1. Install dependencies
2. Build frontend and backend
3. Run database migrations (creates all tables)
4. Start the app with PM2

**Verify it's running:**
```bash
pm2 status
curl http://localhost:3000/api/health
```

---

## Nginx Setup

```bash
# Copy the nginx config
sudo cp deploy/nginx.conf /etc/nginx/sites-available/findandstudy

# Edit the config — replace 'yourdomain.com' with your actual domain
sudo nano /etc/nginx/sites-available/findandstudy

# Enable the site
sudo ln -s /etc/nginx/sites-available/findandstudy /etc/nginx/sites-enabled/

# Remove default site (optional)
sudo rm -f /etc/nginx/sites-enabled/default

# Test and reload
sudo nginx -t
sudo systemctl reload nginx
```

---

## SSL with Let's Encrypt

```bash
# Install Certbot
sudo apt install -y certbot python3-certbot-nginx

# Get SSL certificate (replace with your domain)
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com

# Certbot will auto-configure Nginx for SSL
# Auto-renewal is set up by default; verify with:
sudo certbot renew --dry-run
```

---

## PM2 Auto-Start

```bash
# Generate startup script (run as your deploy user)
pm2 startup
# Follow the printed command (sudo env PATH=... pm2 startup ...)

# Save current process list
pm2 save
```

This ensures the app restarts automatically after server reboots.

---

## Updates & Redeployment

```bash
cd /var/www/findandstudy

# Pull latest code
git pull origin main

# Re-run the deploy script
bash deploy/deploy.sh
```

The deploy script handles building, migrating, and restarting PM2.

---

## Rollback

If a deploy goes wrong:

```bash
# Revert to previous commit
git log --oneline -5    # Find the good commit hash
git checkout <commit-hash> -- .

# Rebuild and restart
bash deploy/build-production.sh
pm2 restart all
```

---

## Monitoring

```bash
# Real-time logs
pm2 logs

# Process status
pm2 status

# CPU/Memory monitoring dashboard
pm2 monit

# Nginx access logs
sudo tail -f /var/log/nginx/access.log

# Nginx error logs
sudo tail -f /var/log/nginx/error.log

# PostgreSQL logs
sudo tail -f /var/log/postgresql/postgresql-16-main.log
```

---

## Troubleshooting

### App not starting
```bash
# Check PM2 logs for errors
pm2 logs findandstudy-os --lines 50

# Check if port is in use
sudo lsof -i :3000

# Try running directly to see errors
cd /var/www/findandstudy
NODE_ENV=production PORT=3000 node artifacts/api-server/dist/index.cjs
```

### Database connection issues
```bash
# Test PostgreSQL connection
psql "postgresql://findandstudy:password@localhost:5432/findandstudy_db" -c "SELECT 1;"

# Check PostgreSQL is running
sudo systemctl status postgresql
```

### Nginx 502 Bad Gateway
```bash
# App may not be running
pm2 status

# Check nginx error log
sudo tail -f /var/log/nginx/error.log

# Verify upstream port matches ecosystem.config.cjs PORT
```

### Frontend not loading / blank page
```bash
# Verify frontend was built
ls -la artifacts/edcons/dist/public/

# Verify index.html exists
ls -la artifacts/edcons/dist/public/index.html

# Rebuild if needed
bash deploy/build-production.sh
pm2 restart all
```

### Permission errors
```bash
# Ensure the app directory is owned by your deploy user
sudo chown -R $USER:$USER /var/www/findandstudy

# Ensure log directory exists
mkdir -p /var/www/findandstudy/logs
```

### Memory issues
```bash
# Check memory usage
free -h
pm2 monit

# Reduce cluster instances in ecosystem.config.cjs if needed
# Change instances: "max" to instances: 2
```
