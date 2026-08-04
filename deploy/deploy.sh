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

# Must run before install/build/restart. It validates paths only and never
# creates, copies, removes or prints persistent-data contents.
node deploy/data-path-preflight.cjs

echo ""
echo "[1/5] Installing production dependencies..."
pnpm install --frozen-lockfile

echo ""
echo "[2/5] Running production build..."
bash deploy/build-production.sh

echo ""
echo "[3/5] Database migration check..."
# UYARI: 'drizzle push' burada KULLANILMAZ — production tablolarını silebilir.
# Normal API boot da DDL, seed veya backfill çalıştırmaz. Deploy yalnızca
# migration geçmişinin tutarlı olduğunu doğrular; hiçbir migration uygulamaz.
node lib/db/validate-migrations.mjs
echo "  Ledger valid; no migration was applied"

echo ""
echo "[4/5] Creating log directory..."
mkdir -p logs

echo ""
echo "[5/5] Starting/restarting PM2..."
if command -v pm2 &> /dev/null; then
  node deploy/pm2-preflight.cjs
  API_PROCESS_NAME="$(node -p "require('./deploy/ecosystem.config.cjs').processNames.api")"
  PORTAL_WORKER_PROCESS_NAME="$(node -p "require('./deploy/ecosystem.config.cjs').processNames.portalWorker")"

  # Restart exact, preflight-verified names. `pm2 restart` cannot create a
  # missing process; worker first keeps the old API available during its boot.
  pm2 restart "$PORTAL_WORKER_PROCESS_NAME" --update-env
  pm2 restart "$API_PROCESS_NAME" --update-env
  pm2 save

  if ! pm2 describe pm2-logrotate > /dev/null 2>&1; then
    echo "  Installing pm2-logrotate..."
    pm2 install pm2-logrotate
    pm2 set pm2-logrotate:max_size 10M
    pm2 set pm2-logrotate:retain 14
    pm2 set pm2-logrotate:compress true
  fi
  echo ""
  echo " PM2 processes safely updated. Useful commands:"
  echo "   pm2 status           — View process status"
  echo "   pm2 logs             — View logs"
  echo "   pm2 monit            — Monitor dashboard"
  echo "   pm2 restart $API_PROCESS_NAME"
  echo "   pm2 restart $PORTAL_WORKER_PROCESS_NAME"
else
  echo "[error] PM2 not found; refusing to start unmanaged production processes."
  exit 1
fi

echo ""
echo "============================================"
echo " Deploy complete!"
echo " App should be running on port ${PORT:-5000}"
echo "============================================"
