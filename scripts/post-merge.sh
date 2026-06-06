#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter db push
# Embed lead duplicate cleanup + install partial unique index. Idempotent
# (no-op once duplicates are gone and the index exists). See task #168.
pnpm --filter @workspace/api-server exec tsx ./scripts/cleanup-embed-duplicates.ts || echo "[post-merge] cleanup-embed-duplicates failed (non-fatal)"
# Public lead duplicate cleanup + install partial unique indexes for
# /public/lead (source=website), /public/lead/:token (source=web_form),
# and /website-form/:slug (source=website-form:*). Idempotent. See task #169.
pnpm --filter @workspace/api-server exec tsx ./scripts/cleanup-public-lead-duplicates.ts || echo "[post-merge] cleanup-public-lead-duplicates failed (non-fatal)"
# Sync assignedToId across Lead → Student → Application triplets. Student is
# the canonical source; lead and applications are updated to match. Idempotent.
pnpm --filter @workspace/api-server exec tsx ./scripts/sync-assignment-backfill.ts || echo "[post-merge] sync-assignment-backfill failed (non-fatal)"
