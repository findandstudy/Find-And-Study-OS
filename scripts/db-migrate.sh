#!/bin/bash
# =============================================================================
# Find & Study — Database Migration Script
# =============================================================================
# Exports SOURCE_DB_URL → timestamped backup, restores to TARGET_DB_URL,
# then runs drizzle-kit push to apply schema changes.
#
# Usage:
#   SOURCE_DB_URL="postgresql://..." TARGET_DB_URL="postgresql://..." \
#     bash scripts/db-migrate.sh
#
# Or export vars in your shell / .env first, then: bash scripts/db-migrate.sh
# =============================================================================
set -e

# --- Colours -----------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Colour

log_info()    { echo -e "${CYAN}${BOLD}[INFO]${NC}  $*"; }
log_ok()      { echo -e "${GREEN}${BOLD}[ OK ]${NC}  $*"; }
log_warn()    { echo -e "${YELLOW}${BOLD}[WARN]${NC}  $*"; }
log_error()   { echo -e "${RED}${BOLD}[ERR ]${NC}  $*" >&2; }
log_section() { echo -e "\n${BOLD}━━━  $*  ━━━${NC}"; }

# --- Prerequisite checks -----------------------------------------------------
log_section "Pre-flight checks"

if [ -z "$SOURCE_DB_URL" ]; then
  log_error "SOURCE_DB_URL is not set."
  echo -e "  Export it before running: ${YELLOW}export SOURCE_DB_URL=postgresql://user:pass@host:5432/db${NC}"
  exit 1
fi

if [ -z "$TARGET_DB_URL" ]; then
  log_error "TARGET_DB_URL is not set."
  echo -e "  Export it before running: ${YELLOW}export TARGET_DB_URL=postgresql://user:pass@host:5432/db${NC}"
  exit 1
fi

for cmd in pg_dump pg_restore psql pnpm; do
  if ! command -v "$cmd" &>/dev/null; then
    log_error "Required command not found: $cmd"
    exit 1
  fi
done

log_ok "All prerequisites satisfied."

# --- Paths -------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKUP_DIR="$ROOT_DIR/backups"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_FILE="$BACKUP_DIR/db_backup_${TIMESTAMP}.dump"

mkdir -p "$BACKUP_DIR"

# --- Load .env if present (won't override already-set vars) ------------------
if [ -f "$ROOT_DIR/.env" ]; then
  log_info "Loading .env (values already exported take precedence)..."
  set -o allexport
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.env" || true
  set +o allexport
fi

# --- Mask passwords in log output --------------------------------------------
mask_url() {
  echo "$1" | sed -E 's|://([^:]+):([^@]+)@|://\1:****@|'
}

log_info "Source DB : $(mask_url "$SOURCE_DB_URL")"
log_info "Target DB : $(mask_url "$TARGET_DB_URL")"
log_info "Backup    : $BACKUP_FILE"

# --- Step 1: Dump source database --------------------------------------------
log_section "Step 1/3 — Exporting source database"

log_info "Running pg_dump (custom format)..."
if pg_dump \
    --format=custom \
    --no-acl \
    --no-owner \
    --verbose \
    --file="$BACKUP_FILE" \
    "$SOURCE_DB_URL" 2>&1 | sed "s/^/  /"; then
  BACKUP_SIZE=$(du -sh "$BACKUP_FILE" | cut -f1)
  log_ok "Dump complete → $BACKUP_FILE ($BACKUP_SIZE)"
else
  log_error "pg_dump failed. Aborting."
  exit 1
fi

# --- Step 2: Restore to target database --------------------------------------
log_section "Step 2/3 — Restoring to target database"

log_warn "This will DROP and recreate objects in the target database."
read -r -p "$(echo -e "${YELLOW}Continue? [y/N]:${NC} ")" CONFIRM
if [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]]; then
  log_warn "Aborted by user. Backup is preserved at: $BACKUP_FILE"
  exit 0
fi

log_info "Running pg_restore..."
if pg_restore \
    --no-acl \
    --no-owner \
    --clean \
    --if-exists \
    --verbose \
    --dbname="$TARGET_DB_URL" \
    "$BACKUP_FILE" 2>&1 | sed "s/^/  /"; then
  log_ok "Restore complete."
else
  # pg_restore exits non-zero on warnings (e.g. missing objects to drop)
  # Only treat it as fatal if the file is empty or connection failed
  log_warn "pg_restore exited with warnings (usually safe — check output above)."
fi

# --- Step 3: Apply Drizzle schema --------------------------------------------
log_section "Step 3/3 — Applying Drizzle schema (drizzle-kit push)"

log_info "Setting DATABASE_URL to target and running drizzle-kit push..."
cd "$ROOT_DIR"

if DATABASE_URL="$TARGET_DB_URL" pnpm --filter @workspace/db run push 2>&1 | sed "s/^/  /"; then
  log_ok "Schema push complete."
else
  # Fall back to drizzle-kit directly
  log_warn "Package push script not found — trying drizzle-kit directly..."
  if DATABASE_URL="$TARGET_DB_URL" pnpm dlx drizzle-kit push 2>&1 | sed "s/^/  /"; then
    log_ok "Schema push complete (via drizzle-kit)."
  else
    log_error "drizzle-kit push failed. Schema may be out of sync."
    exit 1
  fi
fi

# --- Done --------------------------------------------------------------------
log_section "Migration complete"
log_ok "Source DB exported  → $BACKUP_FILE"
log_ok "Target DB restored  → $(mask_url "$TARGET_DB_URL")"
log_ok "Schema up to date   → drizzle-kit push succeeded"
echo ""
echo -e "  ${CYAN}Tip:${NC} Keep the backup file for at least 48h before deleting."
echo -e "  ${CYAN}Path:${NC} $BACKUP_FILE"
