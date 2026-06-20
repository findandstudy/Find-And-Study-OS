#!/usr/bin/env bash
set -a
. /var/www/apply.findandstudy.com/.env
set +a
cd /var/www/apply.findandstudy.com/artifacts/portal-automation-worker
exec /usr/bin/pnpm run start
