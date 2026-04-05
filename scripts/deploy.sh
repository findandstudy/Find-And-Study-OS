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

echo ""
echo "✓ Deploy complete."
pm2 status findandstudy-api
