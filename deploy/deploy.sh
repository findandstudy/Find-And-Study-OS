#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "============================================"
echo " Find And Study OS — Deploy"
echo "============================================"

cd "$PROJECT_ROOT"

if [ ! -f ".env" ]; then
  echo "[error] .env file not found. Copy deploy/.env.example to .env and configure it."
  exit 1
fi

set -a
source .env
set +a

echo ""
echo "[1/5] Installing production dependencies..."
pnpm install --frozen-lockfile

echo ""
echo "[2/5] Running production build..."
bash deploy/build-production.sh

echo ""
echo "[3/6] Running database migrations..."
pnpm --filter db run push

echo ""
echo "[4/6] Running one-shot data cleanups (idempotent)..."
node lib/db/cleanup-data.mjs

echo ""
echo "[5/6] Creating log directory..."
mkdir -p logs

echo ""
echo "[6/6] Starting/restarting PM2..."
if command -v pm2 &> /dev/null; then
  pm2 startOrRestart deploy/ecosystem.config.cjs --env production
  pm2 save

  if ! pm2 describe pm2-logrotate > /dev/null 2>&1; then
    echo "  Installing pm2-logrotate..."
    pm2 install pm2-logrotate
    pm2 set pm2-logrotate:max_size 10M
    pm2 set pm2-logrotate:retain 7
    pm2 set pm2-logrotate:compress true
  fi
  echo ""
  echo " PM2 process started. Useful commands:"
  echo "   pm2 status           — View process status"
  echo "   pm2 logs             — View logs"
  echo "   pm2 monit            — Monitor dashboard"
  echo "   pm2 restart all      — Restart all processes"
else
  echo "[warn] PM2 not found. Install it with: npm install -g pm2"
  echo "       Then run: pm2 start deploy/ecosystem.config.cjs --env production"
  echo ""
  echo "       Or run directly with:"
  echo "       NODE_ENV=production PORT=3000 node artifacts/api-server/dist/index.cjs"
fi

echo ""
echo "============================================"
echo " Deploy complete!"
echo " App should be running on port ${PORT:-3000}"
echo "============================================"
