#!/bin/bash
# =============================================================================
# Find & Study — Deploy Script (PM2 + Nginx)
# =============================================================================
# Usage:  bash scripts/deploy.sh
# Prereq: PM2 installed globally (npm i -g pm2)
#         .env file present in project root
#         Nginx configured (conf/nginx.conf.template)
# =============================================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

# --- Load .env if present ----------------------------------------------------
if [ -f ".env" ]; then
  echo "==> Loading .env..."
  set -o allexport
  source .env
  set +o allexport
fi

# --- Ensure logs directory exists --------------------------------------------
mkdir -p logs

# --- Run database migrations -------------------------------------------------
echo "==> [1/4] Running database migrations..."
pnpm --filter @workspace/db run migrate 2>/dev/null || \
  echo "     (no migrate script found, skipping)"

# --- Restart API server via PM2 ----------------------------------------------
echo "==> [2/4] Restarting API server (PM2)..."
if pm2 describe findandstudy-api > /dev/null 2>&1; then
  pm2 reload ecosystem.config.cjs --update-env
else
  pm2 start ecosystem.config.cjs --env production
fi

# --- Save PM2 process list ---------------------------------------------------
echo "==> [3/4] Saving PM2 process list..."
pm2 save

# --- Reload Nginx (if running) -----------------------------------------------
echo "==> [4/4] Reloading Nginx..."
if command -v nginx &> /dev/null && sudo nginx -t 2>/dev/null; then
  sudo systemctl reload nginx
  echo "     Nginx reloaded."
else
  echo "     Nginx not found or config test failed — skipping reload."
fi

# --- Rotate old deploy backups ------------------------------------------------
# Every deploy leaves a full copy under /var/www as <live>.old-YYYYMMDD-HHMMSS.
# Keep the LIVE dir + the 2 most recent .old-* backups (rollback safety),
# delete anything older. Only touches directories we created ourselves
# (".old-*" pattern). Manually parked dirs (.broken-*, .failed-*, apply_build_*,
# old findandstudy.cloud-* copies, etc.) are NEVER touched here.
echo "==> [5/5] Rotating old deploy backups..."
LIVE_DIR="/var/www/apply.findandstudy.com"
KEEP_BACKUPS=2
if [ -d "$(dirname "$LIVE_DIR")" ]; then
  # Newest first (timestamp suffix sorts lexicographically); skip the first
  # $KEEP_BACKUPS entries, delete the rest.
  ls -1d "${LIVE_DIR}.old-"* 2>/dev/null | sort -r | tail -n "+$((KEEP_BACKUPS + 1))" | while read -r OLD_DIR; do
    # Hard safety guards: never the live dir, only our own .old-* pattern.
    case "$OLD_DIR" in
      "$LIVE_DIR") continue ;;
      "${LIVE_DIR}.old-"*) ;;
      *) continue ;;
    esac
    [ -d "$OLD_DIR" ] || continue
    SIZE="$(du -sh "$OLD_DIR" 2>/dev/null | cut -f1)"
    echo "     [deploy] eski kopya siliniyor: $OLD_DIR (${SIZE:-?})"
    rm -rf "$OLD_DIR"
  done
  echo "     Rotation done (live dir + last $KEEP_BACKUPS backups kept)."
else
  echo "     $(dirname "$LIVE_DIR") not found — skipping rotation (dev environment)."
fi

echo ""
echo "✓ Deploy complete."
pm2 status findandstudy-api
