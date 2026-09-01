#!/usr/bin/env bash
set -Eeuo pipefail

fail() {
  echo "[staging-db:init] BLOCKED: $*" >&2
  exit 1
}

[ "${POSTGRES_DB:-}" = "postgres" ] || fail "POSTGRES_DB must remain postgres"
[ "${POSTGRES_USER:-}" = "postgres" ] || fail "POSTGRES_USER must remain postgres"

migrator_password="$(tr -d '\r\n' </run/secrets/migrator_password)"
app_password="$(tr -d '\r\n' </run/secrets/app_password)"
[[ "$migrator_password" =~ ^[0-9a-f]{64}$ ]] || fail "migrator secret must be 64 lowercase hex characters"
[[ "$app_password" =~ ^[0-9a-f]{64}$ ]] || fail "app secret must be 64 lowercase hex characters"
[ "$migrator_password" != "$app_password" ] || fail "database role secrets must differ"

psql --set ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  --set migrator_password="$migrator_password" \
  --set app_password="$app_password" <<'SQL'
CREATE ROLE fas_migrator
  LOGIN PASSWORD :'migrator_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
CREATE ROLE fas_app
  LOGIN PASSWORD :'app_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
ALTER ROLE fas_migrator SET statement_timeout = '15s';
ALTER ROLE fas_migrator SET lock_timeout = '5s';
ALTER ROLE fas_app SET statement_timeout = '15s';
SQL

createdb --username "$POSTGRES_USER" --owner fas_migrator fasos_staging

psql --set ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname fasos_staging <<'SQL'
REVOKE ALL ON DATABASE fasos_staging FROM PUBLIC;
GRANT CONNECT ON DATABASE fasos_staging TO fas_migrator, fas_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO fas_migrator;
GRANT USAGE ON SCHEMA public TO fas_app;
ALTER DEFAULT PRIVILEGES FOR ROLE fas_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO fas_app;
ALTER DEFAULT PRIVILEGES FOR ROLE fas_migrator IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO fas_app;
SQL

echo "[staging-db:init] PASS: fresh fasos_staging roles and database created"
