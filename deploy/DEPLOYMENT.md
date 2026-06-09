# EduConsult OS — Hostinger VPS Deployment Guide

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
10. [PM2 Auto-Start & Log Rotation](#pm2-auto-start--log-rotation)
11. [Zero-Downtime Updates](#zero-downtime-updates)
12. [Database Migrations](#database-migrations)
13. [Public Endpoints (Anonim Yüzey)](#public-endpoints-anonim-yüzey)
14. [Rollback](#rollback)
15. [Monitoring](#monitoring)
16. [Troubleshooting](#troubleshooting)

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

# Veritabanı ve kullanıcı oluşturun
sudo -u postgres psql <<EOF
CREATE USER edconsult WITH PASSWORD 'guclu-bir-sifre-girin';
CREATE DATABASE edconsult_db OWNER edconsult;
GRANT ALL PRIVILEGES ON DATABASE edconsult_db TO edconsult;
\c edconsult_db
GRANT ALL ON SCHEMA public TO edconsult;
EOF
```

`DATABASE_URL` değeriniz:
```
postgresql://edconsult:guclu-bir-sifre-girin@localhost:5432/edconsult_db
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
# Uygulama dizini oluşturun
sudo mkdir -p /var/www/edconsult-os
sudo chown $USER:$USER /var/www/edconsult-os

# Projeyi klonlayın veya yükleyin
cd /var/www/edconsult-os
git clone https://your-repo-url.git .
# Or upload via SFTP/rsync

# Install dependencies
pnpm install --frozen-lockfile
```

---

## Environment Configuration

```bash
# Örnek dosyayı kopyalayın ve düzenleyin
cp deploy/.env.example .env
nano .env
```

> **deploy/.env.example** tüm desteklenen değişkenleri ve açıklamalarını içerir.

**Zorunlu değişkenler (`<degistir>` ile işaretli):**
- `DATABASE_URL` — PostgreSQL bağlantı dizisi
- `PORT` — `5000` (nginx.conf upstream ile eşleşmeli)
- `SESSION_SECRET` — Üret: `openssl rand -hex 32`
- `ENCRYPTION_KEY` — Üret: `openssl rand -hex 32`
- `EMBED_TOKEN_SECRET` — Üret: `openssl rand -hex 32`
- `ALLOWED_ORIGINS` — Domain'leriniz, örn. `https://yourdomain.com`
- `APP_BASE_URL` — Uygulamanın dış URL'i (e-posta/PDF linklerinde kullanılır)
- `WA_ACCESS_TOKEN` — WhatsApp entegrasyonu için (istege bağlı ama önerilir)
- `WA_APP_SECRET` — WhatsApp webhook doğrulaması için
- `ALLOW_LIVE_INTEGRATIONS` — `true` (production'da canlı gönderimler için)

---

## First Deploy

```bash
# Tam deploy scriptini çalıştırın
bash deploy/deploy.sh
```

Bu işlem:
1. Bağımlılıkları yükler
2. Frontend ve backend'i derler
3. Veritabanı şemasını kontrol eder (boot DDL idempotent çalışır)
4. Uygulamayı PM2 ile başlatır

**Çalıştığını doğrulayın:**
```bash
pm2 status
curl http://localhost:5000/api/healthz
```

> **Nginx kurulumu öncesinde** uygulama doğrudan PORT=5000 üzerinden erişilebilir.
> Nginx kurulduktan sonra `curl http://localhost/api/healthz` çalışmalıdır.

---

## Nginx Setup

> ⚠️ **Önemli:** `deploy/nginx.conf` içindeki `yourdomain.com` ifadelerini gerçek
> domain'inizle değiştirmeyi unutmayın. Değiştirmeden kullanırsanız SSL sertifikası
> alınamaz ve site çalışmaz.

```bash
# Nginx config'ini kopyalayın
sudo cp deploy/nginx.conf /etc/nginx/sites-available/edconsult-os

# 'yourdomain.com' → gerçek domain'inizle değiştirin
sudo nano /etc/nginx/sites-available/edconsult-os

# Siteyi etkinleştirin
sudo ln -s /etc/nginx/sites-available/edconsult-os /etc/nginx/sites-enabled/

# Varsayılan siteyi devre dışı bırakın (isteğe bağlı)
sudo rm -f /etc/nginx/sites-enabled/default

# İsteğe bağlı: Brotli sıkıştırma (gzip'ten daha iyi)
sudo apt install -y libnginx-mod-brotli
# Kurulduktan sonra nginx.conf içindeki brotli direktiflerini yorum satırından çıkarın

# Test edin ve yeniden yükleyin
sudo nginx -t
sudo systemctl reload nginx
```

> **Port kontrolü:** `nginx.conf` upstream bloğu `server 127.0.0.1:5000` olmalıdır.
> `ecosystem.config.cjs` içindeki `PORT: 5000` ile eşleştiğinden emin olun.

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

## PM2 Auto-Start & Log Rotation

```bash
# Generate startup script (run as your deploy user)
pm2 startup
# Follow the printed command (sudo env PATH=... pm2 startup ...)

# Save current process list
pm2 save

# Log rotation kurulumu (deploy.sh tarafından otomatik yapılır)
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 14
pm2 set pm2-logrotate:compress true
```

Bu sayede uygulama sunucu yeniden başlatmalarında otomatik olarak devreye girer ve
loglar diskinizi doldurmadan döndürülür.

Sistem genelinde logrotate kullanmak istiyorsanız:
```bash
sudo cp /var/www/edconsult-os/deploy/logrotate.conf /etc/logrotate.d/edconsult-os
sudo logrotate -d /etc/logrotate.d/edconsult-os  # test (dry-run)
```

---

## Zero-Downtime Updates

Kod değişikliklerini sıfır kesinti ile yayınlamak için:

```bash
cd /var/www/edconsult-os

# Son kodu çekin
git pull origin main

# Derleme ve PM2 hot-reload (kesinti yok — cluster rolling restart)
bash deploy/build-production.sh
pm2 reload deploy/ecosystem.config.cjs --update-env
pm2 save
```

> `pm2 reload` (restart değil) her instance'ı sırayla yeniden başlatır;
> en az bir instance her zaman canlı kalır. Ortam değişkenleri güncellendiğinde
> `--update-env` bayrağını mutlaka kullanın.

**Tam deploy (bağımlılık güncellemesi dahil):**
```bash
bash deploy/deploy.sh
```

---

## Database Migrations

> ⚠️ **`drizzle push` production'da KULLANILMAZ** — mevcut tabloları silebilir.

**api-server boot DDL (otomatik):**
`api-server` açılışında `artifacts/api-server/src/index.ts` içindeki boot DDL bloğu
idempotent olarak çalışır. Yeni `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`
ifadeleri otomatik uygulanır — normal deploy sırasında ekstra adım gerekmez.

**Manuel şema değişikliği (Drizzle migration):**
```bash
# 1. lib/db dizininde migration SQL'i oluşturun
cd lib/db
pnpm drizzle-kit generate

# 2. Oluşan SQL dosyasını gözden geçirin
cat drizzle/<timestamp>_migration.sql

# 3. Production veritabanına uygulayın
psql "$DATABASE_URL" < drizzle/<timestamp>_migration.sql

# 4. api-server'ı yeniden başlatın
pm2 reload deploy/ecosystem.config.cjs --update-env
```

---

## Public Endpoints (Anonim Yüzey)

Aşağıdaki endpoint'ler oturum gerektirmez ve internetten erişilebilirdir.
Bu bilinçli bir tasarım tercihidir — nginx rate limiting ile korunurlar.

| Endpoint | Açıklama | Rate Limit |
|----------|----------|------------|
| `GET /api/healthz` | Uygulama sağlık kontrolü | — |
| `GET /api/destinations` | Aktif ülke/üniversite listesi (Course Finder) | API zone |
| `POST /api/public-apply` | Öğrenci başvuru formu | API zone |
| `GET /api/public/sign/:token` | Sözleşme imza sayfası | sign limiter |
| `POST /api/public/sign/:token/sign` | Sözleşme imzalama | sign limiter |
| `GET /api/public/sign/:token/pdf` | İmzalı PDF indirme | sign limiter |
| `POST /api/webhooks/whatsapp` | WhatsApp Cloud API webhook | API zone |
| `GET /api/webhooks/whatsapp` | WhatsApp webhook doğrulama | API zone |
| `GET /api/embed/public/*` | Embed widget kamuya açık API | API zone |
| `GET /public/website-forms/:slug/check` | Website form varlık kontrolü | API zone |
| `POST /public/website-forms/:slug/submit` | Website form gönderimi | API zone |

**Güvenlik notları:**
- Sözleşme endpoint'leri cryptographic token ile korunur (hashToken)
- WhatsApp webhook HMAC-SHA256 imzası doğrulanır (`WA_APP_SECRET`)
- Embed widget API key ile doğrulanır; domain allowlist kontrolü yapılır
- `POST /api/public-apply`: e-posta bazlı IDOR koruması mevcuttur

---

## Rollback

Deploy başarısız olursa:

```bash
# Son iyi commit'i bulun
git log --oneline -5

# O commit'e dönün
git checkout <commit-hash> -- .

# Yeniden derleyin ve başlatın
bash deploy/build-production.sh
pm2 reload deploy/ecosystem.config.cjs --update-env
```

> Ciddi bir sorun varsa PM2'yi tamamen yeniden başlatın:
> ```bash
> pm2 delete all
> pm2 start deploy/ecosystem.config.cjs
> pm2 save
> ```

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
# PM2 log'larını kontrol edin
pm2 logs edconsult-os-api --lines 50

# Port kullanımda mı?
sudo lsof -i :5000

# Hatayı doğrudan görmek için manuel çalıştırın
cd /var/www/edconsult-os
NODE_ENV=production PORT=5000 node artifacts/api-server/dist/index.cjs
```

### Database connection issues
```bash
# PostgreSQL bağlantısını test edin
psql "$DATABASE_URL" -c "SELECT 1;"

# PostgreSQL çalışıyor mu?
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
sudo chown -R $USER:$USER /var/www/edconsult-os

# Ensure log directory exists
mkdir -p /var/www/edconsult-os/logs
```

### Memory issues
```bash
# Check memory usage
free -h
pm2 monit

# Reduce cluster instances in ecosystem.config.cjs if needed
# Change instances: "max" to instances: 2
```
