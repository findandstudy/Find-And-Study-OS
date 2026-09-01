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
