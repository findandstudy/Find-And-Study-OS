# Isolated VPS staging

This topology is only for the fresh, synthetic-data staging environment. It
does not copy production data, enable external delivery or run the portal
automation worker.

Hard boundaries:

- Use the dedicated `findandstudy-staging` Unix account and a clean exact Git
  commit.
- Keep PostgreSQL published only on the configured `127.0.0.1` port.
- Keep `ALLOW_LIVE_INTEGRATIONS=false`, `EMAIL_DELIVERY_DISABLED=true`,
  `BACKGROUND_JOBS_ENABLED=false` and `STUDENT_JOURNEY_V1_MODE=off`.
- Join only the app container to the existing external `root_default` Traefik
  network. The database remains on the internal backend network.
- Never prune Docker images, containers, volumes or application data as part of
  this deployment. Build-cache retention is a separate approved operation.
- Apply schema only with `lib/db/run-staging-migrations.mjs`; never reclassify
  staging as development and never use `drizzle push`.

The checked-in compose file contains no credentials. Host-only configuration,
database passwords, application secrets and the generated initial login remain
under `/opt/findandstudy-staging/secrets` with restrictive permissions.

On this Docker Compose file-provider topology, the three PostgreSQL secret files
are bind-mounted rather than copied into a Swarm secret. They must therefore be
owned by the pinned PostgreSQL container uid/gid (`999:999`) with mode `0400`;
the parent host directory remains `root:findandstudy-staging 0750`, so unrelated
host users cannot traverse it. Application env and initial-login files remain
`root:findandstudy-staging 0640`.

## Canonical host layout

The staging host uses these paths. Do not substitute a production path or copy
production credentials/data into them.

```text
/opt/findandstudy-staging/source      exact clean staging Git checkout
/opt/findandstudy-staging/secrets     host-only configuration and credentials
/opt/findandstudy-staging/data        synthetic staging storage
/opt/findandstudy-staging/backups     checksum-attested staging-only backups
```

The public hostname is `staging.srv1110168.hstgr.cloud`. Production and the
`Find-And-Study-OS-Next` repository are outside this deployment path.

## Preflight and image build

Run source checks before every build and record the full lowercase commit. The
tracked worktree must be clean and the branch must be synchronized with its
remote before it is treated as reviewed staging source.

```bash
cd /opt/findandstudy-staging/source
git rev-parse --verify HEAD
git status --porcelain=v1 --untracked-files=no
git rev-list --left-right --count HEAD...@{upstream}

docker build \
  --file deploy/staging/Dockerfile \
  --target build \
  --build-arg FASOS_SOURCE_COMMIT=<exact-40-character-commit> \
  --tag findandstudy-staging-build:<commit12> \
  .

docker build \
  --file deploy/staging/Dockerfile \
  --build-arg FASOS_SOURCE_COMMIT=<exact-40-character-commit> \
  --tag findandstudy-staging-app:<commit12> \
  .
```

Keep `compose.env`, `app.env`, database password files, the initial-login file
and the admin-password file under the host-only secrets directory. Never print
their contents, add them to shell history, or copy them into Git. Validate the
four mandatory integration kill switches before starting the app.

```bash
grep -x 'ALLOW_LIVE_INTEGRATIONS=false' /opt/findandstudy-staging/secrets/app.env
grep -x 'EMAIL_DELIVERY_DISABLED=true' /opt/findandstudy-staging/secrets/app.env
grep -x 'BACKGROUND_JOBS_ENABLED=false' /opt/findandstudy-staging/secrets/app.env
grep -x 'AI_EXTERNAL_AUTO_REPLY_KILL_SWITCH=true' /opt/findandstudy-staging/secrets/app.env
```

## Database adoption and seed

Start only the database first. The application does not own schema creation.

```bash
cd /opt/findandstudy-staging/source/deploy/staging
docker compose \
  --env-file /opt/findandstudy-staging/secrets/compose.env \
  -f compose.yml up -d db
```

Run `lib/db/run-staging-migrations.mjs` from the exact build image, using a
temporary loopback TCP forwarder inside the internal backend network. Supply
all runner confirmations through a restricted host-only env file; do not put a
database URL/password on the command line. The runner requires:

- exact clean source commit and pnpm `10.33.2`;
- `fas_migrator` through `127.0.0.1` to exact database `fasos_staging`;
- exact pre-ledger count and, when non-zero, the exact backup attestation ID;
- PostgreSQL-reported server address/port and a timestamped change ID;
- the dedicated `ALLOW_STAGING_MIGRATIONS=true` and
  `MIGRATION_TARGET_ENV=staging` opt-ins.

After migration, run `deploy/staging/seed-staging.mjs` only for a fresh `83/83`
database with zero users. It creates synthetic reference data and one synthetic
Super Admin; it refuses any other database or pre-populated user table. Keep
the generated password only in `/opt/findandstudy-staging/secrets/admin-password`.

## Start and attest

```bash
cd /opt/findandstudy-staging/source/deploy/staging
docker compose \
  --env-file /opt/findandstudy-staging/secrets/compose.env \
  -f compose.yml up -d app

docker compose \
  --env-file /opt/findandstudy-staging/secrets/compose.env \
  -f compose.yml ps
```

Required acceptance evidence:

- both staging containers are healthy;
- `GET /api/healthz` returns exact HTTP `200`;
- `GET /api/health` returns exact HTTP `200`, `dbConnected=true`, and the
  expected staging release ID;
- TLS verification succeeds and HTTPS sends HSTS;
- the migration ledger is exact `83/83`;
- a server-side login / `auth/me` / logout smoke succeeds with the synthetic
  account without logging its password or session cookie;
- the app runs as UID/GID `10042`, with read-only root filesystem, all Linux
  capabilities dropped and `no-new-privileges` enabled;
- no external delivery, background job or portal automation worker is active.

## Backup and isolated restore drill

Create a custom-format dump with `pg_dump`, restrict it to
`root:findandstudy-staging 0640`, and store a SHA-256 sidecar/attestation. A
backup is not accepted until it opens in a disposable restore drill.

The restore drill must use the exact PostgreSQL digest from `compose.yml`, a
named disposable container, `--network none`, and tmpfs database/runtime
directories. Restore into a new database with `--no-owner --no-privileges`,
then verify at minimum:

- database name is the drill-only name;
- ledger count is exactly `83`;
- exactly one synthetic staging user and one active synthetic Super Admin are
  present;
- the public schema is non-empty.

Always remove the drill container through an EXIT trap, and confirm it is absent
afterward. Never mount or restore into `fasos_staging_postgres` during a drill.

## Update and rollback

An update repeats the exact-source build, backup, migration and attestation
sequence. `docker compose up -d app` may replace only the staging app container;
do not restart unrelated VPS projects. If application health fails, point
`FASOS_STAGING_APP_IMAGE` back to the previously attested image and replace only
the app service.

Never use `docker compose down -v`, `docker system prune`, broad container
restart commands, or a database restore as an application rollback. Database
rollback requires a separately reviewed forward fix or an explicitly approved,
staging-only recovery operation.
