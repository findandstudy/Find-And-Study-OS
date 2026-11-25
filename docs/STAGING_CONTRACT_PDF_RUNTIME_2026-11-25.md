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

Local validation: JavaScript syntax and whitespace checks passed. The local
Docker daemon was unavailable, so the candidate-image gate must be run on the
isolated staging build host before claiming runtime success.
