#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter db push
# Embed lead duplicate cleanup + install partial unique index. Idempotent
# (no-op once duplicates are gone and the index exists). See task #168.
pnpm --filter @workspace/api-server exec tsx ./scripts/cleanup-embed-duplicates.ts || echo "[post-merge] cleanup-embed-duplicates failed (non-fatal)"
