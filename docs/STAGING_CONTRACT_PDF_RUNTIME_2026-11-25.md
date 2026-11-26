# Staging contract PDF runtime prerequisite

The staging image inspected on 25 November lacked both system Chromium and a
Playwright browser. Updating JavaScript alone cannot fix PDF generation.

`deploy/staging/Dockerfile` now installs Chromium, fontconfig and Liberation/Noto
fonts from the pinned Debian base's signed package repositories during the
runtime image build. No browser download or package install runs at app boot.
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` points to the system binary; writable XDG
cache/config directories are under `/tmp`. The existing non-root app user,
read-only root filesystem, noexec tmpfs, dropped capabilities and disabled
external integrations remain unchanged.

For a bounded derivative image, apply the same runtime package-install block
to the exact inspected staging parent image, then copy the checksum-verified
API/frontend artifacts and `deploy/staging/check-pdf-runtime.mjs` into their
matching `/app` locations. Do not use an old template's mutable image tag. The
package-install build step needs access to the base image's official Debian
repositories; do not add third-party repositories or weaken TLS/signature
verification. Record the resulting image digest and installed Chromium version.
Restore the final image user to `10042:10042` after installation.

Run the candidate image gate before switching the staging app:

```sh
docker run --rm --pull never --network none --read-only \
  --user 10042:10042 --cap-drop ALL --security-opt no-new-privileges \
  --memory 768m --memory-swap 768m --cpus 1 --pids-limit 128 \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=256m,mode=1777 \
  --entrypoint node "$CANDIDATE_IMAGE_DIGEST" \
  deploy/staging/check-pdf-runtime.mjs
```

The gate launches actual Chromium, renders only labelled synthetic multilingual
HTML, checks the PDF bytes and rejects external requests. It imports no API app,
DB module or worker, sends no email, and creates no signing record. All temporary
browser data disappears with the container. A pass proves the browser/fonts work
under the container restrictions; it does not prove a real signed contract,
signature configuration, email delivery, or the live worker lifecycle.

Before staging PDF-worker activation, separately verify the approved persistent
`MAIN_AGENCY_SIGNATURE_FILE` is configured/readable (report only booleans), and
the pending staging record scope is authorized. Keep `BACKGROUND_JOBS_ENABLED`
and `ALLOW_LIVE_INTEGRATIONS` false and `EMAIL_DELIVERY_DISABLED` true. Enable only
`SIGNED_CONTRACT_PDF_WORKER_ENABLED` if PDF generation is in scope. No migration,
seed, production mutation or global scheduler activation is required.

## Offline managed logo capture

The offline logo path is deliberately **Linux `/proc` only**. With
`STORAGE_DRIVER=local`, the URL must have the exact `APP_BASE_URL` origin, be in
`CONTRACT_PDF_TRUSTED_LOGO_URLS`, and use the existing public namespace:

```text
/api/storage/public-branding/embed-widget/contract-logo-<sha256>.png
```

The operator-copied PNG resides below `STORAGE_LOCAL_DIR` in the corresponding
`branding/embed-widget` path. Before reading, capture rejects symlinks, multiple
hard links, non-regular files, oversized files, and inode/device/size changes.
It opens with `O_NOFOLLOW | O_NONBLOCK`, resolves `/proc/self/fd/<fd>` to prove
the opened file is the expected managed object, and verifies the bounded PNG
bytes against the hash in the URL. This closes the parent-directory replacement
race without permitting reads of private storage aliases.

On Windows or another OS, or when `/proc/self/fd` is unavailable, this local
capture path **fails closed**. There is no pathname-only or HTTP fallback. Do
not add host PID access or mount the host's `/proc` to work around this gate.
The Linux container's normal process-local `/proc` is sufficient. Keep
`ALLOW_LIVE_INTEGRATIONS=false`; managed logo capture needs no outbound network.
New signing sessions receive their own frozen logo snapshot. This path does not
refresh or rewrite historical signed session/PDF/evidence records.

## Compose switch checks

Use the currently attested Compose configuration and exact source path. The
repository's app service reads these substitution names (never print their
secret values): `FASOS_STAGING_APP_IMAGE`, `FASOS_STAGING_UID`,
`FASOS_STAGING_GID`, `FASOS_STAGING_APP_ENV_FILE`, `FASOS_STAGING_DB_POOL_MAX`,
`FASOS_STAGING_STORAGE_DIR`, `FASOS_STAGING_HOST`, and
`FASOS_STAGING_LEGACY_HOST`. DB configuration additionally references
`FASOS_STAGING_DB_PORT`, `FASOS_STAGING_POSTGRES_PASSWORD_FILE`,
`FASOS_STAGING_MIGRATOR_PASSWORD_FILE`, and `FASOS_STAGING_APP_PASSWORD_FILE`.
Their current paths, values, volumes and container identities must be preserved;
this change requires no DB credential, port, or migration adjustment.

Before and after `up -d --no-deps --pull never app`, verify:

- App user remains the attested non-root UID/GID, `init: true`,
  `read_only: true`, `cap_drop: [ALL]`, and
  `security_opt: [no-new-privileges:true]`.
- App tmpfs remains `/tmp:rw,noexec,nosuid,nodev,size=256m,mode=1777` and the
  storage bind target remains `/var/lib/findandstudy/storage`. Do not replace
  noexec with exec to launch a downloaded browser; Chromium is in the image.
- `BACKGROUND_JOBS_ENABLED=false`, `ALLOW_LIVE_INTEGRATIONS=false`,
  `EMAIL_DELIVERY_DISABLED=true`, and
  `AI_EXTERNAL_AUTO_REPLY_KILL_SWITCH=true` remain effective. The only worker
  opt-in for this task is `SIGNED_CONTRACT_PDF_WORKER_ENABLED=true` after its
  candidate-image gate and authorized pending-record scope pass.
- Preserve disabled `SOCIAL_PUBLICATION_WORKER_ENABLED`,
  `SOCIAL_PERFORMANCE_WORKER_ENABLED`, `SOCIAL_CREATIVE_WORKER_ENABLED`,
  `SOCIAL_AD_WORKER_ENABLED`, `SOCIAL_PROVIDER_CONNECTIVITY_ENABLED`,
  `SOCIAL_PROVIDER_PUBLISHING_ENABLED`, `SOCIAL_PROVIDER_ADVERTISING_ENABLED`,
  and `SOCIAL_CREATIVE_GENERATION_ENABLED`. Do not enable the `social-external`
  or `social-ai` Compose profiles.
- Preserve existing network identities: internal `findandstudy_staging_backend`,
  external ingress `root_default`, and `findandstudy_staging_egress`. The
  candidate probe uses `--network none`; the deployed app keeps its attested
  topology and application-level external-effect kill switches.
- Compose currently sets `WEBSITE_TRANSLATION_QUEUE_ENABLED=true` and defaults
  `DB_POOL_MAX` from `FASOS_STAGING_DB_POOL_MAX` to `20`. Compare the effective
  config with the running container before switch; do not silently change these
  unrelated settings when preparing the PDF-only override.
- Preserve the DB/other container IDs and start times, ledger digest, and
  noindex ingress headers. Verify exact release/image health and retain the
  previous image/config for code-only rollback. Do not recreate DB or workers.

Local validation: JavaScript syntax and whitespace checks passed. The local
Docker daemon was unavailable, so the candidate-image gate must be run on the
isolated staging build host before claiming runtime success.
