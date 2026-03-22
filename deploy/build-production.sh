#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "============================================"
echo " Find And Study OS — Production Build"
echo "============================================"

cd "$PROJECT_ROOT"

echo ""
echo "[1/4] Installing dependencies..."
pnpm install --frozen-lockfile

echo ""
echo "[2/4] Building shared libraries..."
pnpm run typecheck:libs

echo ""
echo "[3/4] Building frontend..."
cd artifacts/edcons
BASE_PATH="/" PORT=3000 NODE_ENV=production pnpm run build
cd "$PROJECT_ROOT"

echo ""
echo "[4/4] Building backend..."
cd artifacts/api-server
pnpm run build
cd "$PROJECT_ROOT"

echo ""
echo "============================================"
echo " Build complete!"
echo " Frontend: artifacts/edcons/dist/public/"
echo " Backend:  artifacts/api-server/dist/index.cjs"
echo "============================================"
