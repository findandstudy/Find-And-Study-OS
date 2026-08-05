#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

fail() {
  echo "[deploy:error] $*" >&2
  exit 1
}

for command_name in git node pnpm curl pm2 tar; do
  command -v "$command_name" >/dev/null 2>&1 || fail "$command_name is required"
done

# Runtime secrets must live outside both the Git checkout and immutable
# releases. The path is supplied by the operator; its contents are never
# printed or copied into a release.
RUNTIME_ENV_FILE="${RUNTIME_ENV_FILE:-}"
[ -n "$RUNTIME_ENV_FILE" ] || fail "RUNTIME_ENV_FILE must point to an external runtime env file"
case "$RUNTIME_ENV_FILE" in /*) ;; *) fail "RUNTIME_ENV_FILE must be absolute" ;; esac
[ -f "$RUNTIME_ENV_FILE" ] || fail "RUNTIME_ENV_FILE does not exist"

set -a
# shellcheck disable=SC1090
source "$RUNTIME_ENV_FILE"
set +a

RELEASES_DIR="${RELEASES_DIR:-}"
CURRENT_RELEASE_LINK="${CURRENT_RELEASE_LINK:-}"
LOG_DIR="${LOG_DIR:-}"
PORT="${PORT:-5000}"
CANDIDATE_PORT="${CANDIDATE_PORT:-5057}"

for path_name in RELEASES_DIR CURRENT_RELEASE_LINK LOG_DIR; do
  path_value="${!path_name:-}"
  [ -n "$path_value" ] || fail "$path_name is required"
  case "$path_value" in /*) ;; *) fail "$path_name must be absolute" ;; esac
done
[ "$PORT" != "$CANDIDATE_PORT" ] || fail "CANDIDATE_PORT must differ from PORT"
[[ "$PORT" =~ ^[0-9]{2,5}$ ]] || fail "PORT must be numeric"
[[ "$CANDIDATE_PORT" =~ ^[0-9]{2,5}$ ]] || fail "CANDIDATE_PORT must be numeric"

cd "$SOURCE_ROOT"
git diff --quiet || fail "tracked working tree changes must be committed and reviewed before release"
git diff --cached --quiet || fail "staged changes must be committed and reviewed before release"
SOURCE_COMMIT="$(git rev-parse --verify HEAD)"
RELEASE_ID="$(date -u +%Y%m%dT%H%M%SZ)-${SOURCE_COMMIT:0:12}"
export RELEASE_ID
RELEASE_DIR="$RELEASES_DIR/$RELEASE_ID"
CANDIDATE_LOG="$LOG_DIR/candidate-$RELEASE_ID.log"

[ ! -e "$RELEASE_DIR" ] || fail "release directory already exists: $RELEASE_DIR"
[ -L "$CURRENT_RELEASE_LINK" ] || fail "CURRENT_RELEASE_LINK must already be a symlink managed by the release runbook"
PREVIOUS_RELEASE="$(readlink -f "$CURRENT_RELEASE_LINK")"
[ -d "$PREVIOUS_RELEASE" ] || fail "current release target is not a directory"

mkdir -p "$RELEASES_DIR" "$LOG_DIR"
mkdir "$RELEASE_DIR"

candidate_pid=""
cleanup_candidate() {
  if [ -n "$candidate_pid" ] && kill -0 "$candidate_pid" 2>/dev/null; then
    kill -TERM "$candidate_pid" 2>/dev/null || true
    wait "$candidate_pid" 2>/dev/null || true
  fi
}
trap cleanup_candidate EXIT INT TERM

release_health_ready() {
  health_port="$1"
  expected_release="$2"
  healthz_body="$(curl --fail --silent --show-error --max-time 3 \
    "http://127.0.0.1:$health_port/api/healthz")" || return 1
  curl --fail --silent --show-error --max-time 3 \
    "http://127.0.0.1:$health_port/api/health" >/dev/null || return 1
  EXPECTED_RELEASE_ID="$expected_release" node -e '
    let raw = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { raw += chunk; });
    process.stdin.on("end", () => {
      try {
        const payload = JSON.parse(raw);
        process.exit(payload.releaseId === process.env.EXPECTED_RELEASE_ID ? 0 : 1);
      } catch { process.exit(1); }
    });
  ' <<<"$healthz_body"
}

echo "[1/7] Exporting immutable release $RELEASE_ID"
git archive "$SOURCE_COMMIT" | tar -x -C "$RELEASE_DIR"

cd "$RELEASE_DIR"
export APP_RELEASE_DIR="$RELEASE_DIR"
node deploy/data-path-preflight.cjs

echo "[2/7] Installing locked dependencies and building release"
bash deploy/build-production.sh

echo "[3/7] Validating migration ledger without applying migrations"
node lib/db/validate-migrations.mjs

echo "[4/7] Starting isolated candidate API on port $CANDIDATE_PORT"
NODE_ENV=production \
PORT="$CANDIDATE_PORT" \
BACKGROUND_JOBS_ENABLED=false \
node artifacts/api-server/dist/index.cjs >"$CANDIDATE_LOG" 2>&1 &
candidate_pid="$!"

candidate_ready=0
for _attempt in $(seq 1 30); do
  if ! kill -0 "$candidate_pid" 2>/dev/null; then
    fail "candidate API exited before readiness; inspect the candidate log"
  fi
  if release_health_ready "$CANDIDATE_PORT" "$RELEASE_ID"; then
    candidate_ready=1
    break
  fi
  sleep 1
done
[ "$candidate_ready" = "1" ] || fail "candidate API did not become ready"
cleanup_candidate
candidate_pid=""

echo "[5/7] Verifying canonical PM2 topology and release-link ownership"
node deploy/pm2-preflight.cjs --release-link "$CURRENT_RELEASE_LINK"
API_PROCESS_NAME="$(node -p "require('./deploy/ecosystem.config.cjs').processNames.api")"
PORTAL_WORKER_PROCESS_NAME="$(node -p "require('./deploy/ecosystem.config.cjs').processNames.portalWorker")"

switch_release_link() {
  target="$1"
  next_link="${CURRENT_RELEASE_LINK}.next.$$"
  ln -s "$target" "$next_link"
  mv -Tf "$next_link" "$CURRENT_RELEASE_LINK"
}

rollback_code() {
  echo "[rollback] Restoring previous code release"
  switch_release_link "$PREVIOUS_RELEASE"
  pm2 restart "$PORTAL_WORKER_PROCESS_NAME" --update-env || true
  pm2 restart "$API_PROCESS_NAME" --update-env || true
  if curl --fail --silent --show-error --max-time 5 \
    "http://127.0.0.1:$PORT/api/healthz" >/dev/null; then
    echo "[rollback] Previous code release is healthy"
  else
    echo "[rollback:error] Previous code release health check failed" >&2
  fi
}

echo "[6/7] Atomically switching code and draining canonical processes"
switch_release_link "$RELEASE_DIR"
if ! pm2 restart "$PORTAL_WORKER_PROCESS_NAME" --update-env; then
  rollback_code
  fail "portal worker restart failed; code rollback attempted"
fi
if ! pm2 restart "$API_PROCESS_NAME" --update-env; then
  rollback_code
  fail "API restart failed; code rollback attempted"
fi

echo "[7/7] Verifying canonical API and saving PM2 state"
live_ready=0
for _attempt in $(seq 1 30); do
  if release_health_ready "$PORT" "$RELEASE_ID"; then
    live_ready=1
    break
  fi
  sleep 1
done
if [ "$live_ready" != "1" ]; then
  rollback_code
  fail "new release failed health checks; previous code release restored"
fi

pm2 save
trap - EXIT INT TERM
echo "[deploy] Release $RELEASE_ID is healthy on canonical port $PORT"
echo "[deploy] Database, runtime env and storage were not migrated, copied or rolled back"
