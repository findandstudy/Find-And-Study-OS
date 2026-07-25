#!/usr/bin/env bash
set -a
. /var/www/apply.findandstudy.com/.env
set +a
export ALTINBAS_UI_COMPLETE="${ALTINBAS_UI_COMPLETE:-1}"
export ALTINBAS_CAPTURE="${ALTINBAS_CAPTURE:-0}"
cd /var/www/apply.findandstudy.com/artifacts/portal-automation-worker
exec /usr/bin/pnpm run start
