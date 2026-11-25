# Apply contract candidate — build preparation only

No command in this recipe is a deployment authorization. No candidate has been
built or run merely because this document exists. Linux image/build tests,
production preflight, backup verification and the user's final approval are
separate gates.

## Source identity and preserved live changes

The verified Apply source baseline is Git `a5f31e06568229d5f61fa29a1416dd46b83119b0`
**plus 13 deployed drift files and four extra source files**. A checkout of that
commit or the newer staging tree is not a substitute for the actual Apply tree.

Read-only snapshot prepared by the parent task:

- `/opt/findandstudy-staging/backups/unsigned-preview-20261125/apply-current-source`
- 1,803 source files, 27,500,728 bytes; no `.env`, storage, `node_modules`, or
  generated `dist`.
- Sibling `apply-source-manifest.json` SHA-256:
  `9d940fdc7536e6dffc2519b30fd489379bc1ccc32391491e07cb6f54f1492109`.
- Its actual schema is `baseCommit`, `drift`, `extras`, `files`; each file has
  `path`, `bytes`, `sha256`, `gitBlob`, `baseBlob` (null for an extra).

`deploy/prepared-releases/assemble-apply-contract-candidate.mjs` reads that exact
manifest and verifies membership, byte hashes, Git blob hashes and all 13+4
differences before creating any output. The CLI pins the recorded manifest hash.
It writes only a **new non-overlapping candidate directory**, never the snapshot,
patch source, production bind mounts or an existing output directory.

The overlay's second reviewed manifest has this format (values are real hashes,
not placeholders when executed):

```json
{
  "schemaVersion": 1,
  "baseCommit": "a5f31e06568229d5f61fa29a1416dd46b83119b0",
  "sourceManifestSha256": "<exact recorded snapshot manifest SHA-256>",
  "patchCommit": "<reviewed complete hotfix commit>",
  "files": [
    {
      "path": "<explicit reviewed repository-relative path>",
      "beforeSha256": "<actual snapshot hash, or null only for a new file>",
      "afterSha256": "<exact Git-exported patch bytes hash>"
    }
  ],
  "brandingMerge": {
    "preservesDefinedProfileValues": true,
    "beforeSha256": "<live contractTemplateBranding hash>",
    "afterSha256": "<reviewed merged file hash>",
    "reviewReceiptSha256": "<independent undefined-override preservation test/review receipt>"
  }
}
```

Only `contractTemplateBranding.ts` may replace a drift file, with that explicit
merge-review record. The remaining 12 drift files and all four extras are
byte-preserved. No overlay into `lib/db/drizzle/` is permitted. In particular,
live `0066_education_country.sql`, `meta/0066_snapshot.json` and the deployed
journal are preserved; the live ledger stays **67 entries**. A future contract
email migration remains a separate prepared migration, not part of this code
overlay or a staging journal copy.

Invoke the assembler with `--snapshot-root`, `--snapshot-manifest`, `--patch-root`,
`--patch-manifest`, `--patch-manifest-sha256`, and `--output-root`. Export patch
files from the exact reviewed Git commit so Windows checkout newline conversion
cannot silently change the approved bytes. The resulting
`.apply-candidate-receipt.json` records the full candidate file hashes and source
tree digest. A leftover partial output after a filesystem failure is quarantined;
the tool never overwrites or silently cleans it.

## Build in isolation

Use a new image and a separate builder workspace. Never bind the current Apply
release or production storage writable into a builder.

1. Pin `node:22.23.4-bookworm-slim` by its verified image digest. Build
   `Dockerfile.apply-contract-runtime` with an explicit Debian snapshot timestamp
   and exact Chromium/common/sandbox, DejaVu, Liberation and Noto package versions
   resolved from that snapshot. Missing pins fail; do not replace them with
   `latest`. Record final image ID and all installed package versions. This
   adds Chromium/font infrastructure inside the new image, not on the VPS host.
2. Copy the assembled candidate into an isolated builder. Install the already
   approved `pnpm@10.33.2` from a hash-verified artifact, then use the exact lock
   with `pnpm install --frozen-lockfile`. Do not rewrite the lock or copy staging
   dependencies. Keep all real integration credentials absent.
3. Run shared-library and API typechecks; build Edcons with `BASE_PATH=/` and the
   existing production build command; build API with its existing `build.ts`.
   Do not run the generic deployment/start/migration entrypoints. Do not run
   startup seeders against any long-lived database.
4. Export only this builder's candidate source, resolved dependency tree and
   generated assets into a **new release directory**. Preserve its receipt and
   add output hashes for API `dist/index.cjs`, Edcons `dist/public` and fonts.
   Set ownership on this new directory only for UID/GID10000. Do not modify the
   old release, storage or another service's ownership.
5. Run recovery/artifact, contract authorization/render, fresh disposable-DB,
   fake email and real Chromium PDF tests in an isolated network/container.
   Test with the exact final image + candidate code + Node version. Linux
   descriptor tests must run, not skip. Inspect EN/TR/AR PDFs visually.

The runtime Dockerfile contains no application code, env file, proxy settings or
storage. It provides the same Node major/minor/patch plus Chromium/fonts. The
application continues to run from the two existing internal code-bind targets.

## Exact observed launch baseline and intentional deltas

Observed Apply launch (allowlisted inspection, no secrets):

- Node image `node:22.23.4-bookworm-slim`; user `10000:10000`.
- Working directory `/opt/findandstudy/releases/20260911T101300Z-a5f31e065682`.
- Entrypoint `["node"]`; command is the API `dist/index.cjs` under that directory.
- Restart `unless-stopped`; root filesystem read-only; no port bindings or
  healthcheck; no explicit memory/CPU/PID limit.
- Network mode `academy160-preview`; attached networks `academy160-preview`
  and `academy160-egress`. Preserve their actual aliases/settings and proxy
  labels from the private inspect receipt, without printing them here.
- `/tmp` tmpfs: `rw,nosuid,nodev,mode=1777,size=256m`; shared memory 67,108,864 bytes;
  IPC mode `private`.
- Current release host bind
  `/srv/academy160-preview/opt/findandstudy/releases/20260911T101300Z-a5f31e065682`
  maps read/write to both `/opt/findandstudy/current` and the internal release
  path above. Candidate launch changes these **host source paths only** to the
  new prepared release; retain both target paths. Keep old source immutable for
  rollback.
- Existing storage host bind `/srv/academy160-preview/var/lib/findandstudy`
  maps read/write to `/var/lib/findandstudy`. Do not copy or replace it.
  Private PDF directory is `/var/lib/findandstudy/storage/signed-contracts`;
  observed root/storage/signed-contracts directories are `0700`, UID/GID10000 and
  not symlinks.

Planned deliberate runtime changes: new pinned image with Chromium/fonts,
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium`, **`init: true`** to reap
Chromium children, and the explicit contract-worker safety flags. Preserve the
rest of the actual inspected launch and env. Do not introduce resource caps,
ports, labels, network changes, global job changes or copied staging env.

Before first candidate startup, set `SIGNED_CONTRACT_DELIVERY_ENABLED=false` and
`SIGNED_CONTRACT_PDF_WORKER_ENABLED=false` in the **application's real launch
configuration**. Any new durable-contract-email feature also remains explicitly
off with `SIGNED_CONTRACT_DURABLE_DELIVERY_MODE=off`. CLI-local variables do not stop deployed workers. Verify actual launched
container/process identities, flags and zero in-flight contract work.

## Production preflight and rollback inputs still required

Report the exact final patch commit, reviewed patch manifest, full assembled
source digest, build output hashes, runtime image digest and package pins. Recheck
the actual current production source/drift and container IDs/start times before
switching; any new drift stops the rollout. Confirm the 67-entry migration ledger
is unchanged; this code candidate applies no migration.

Take fresh verified DB and storage backups; record exact old container/image,
private env/proxy/network configuration and both old code-bind host paths.
Specify the short API restart window and verify worker/job impact explicitly.
Do not send emails, sign, approve accounts, or run batch PDF backfill as smoke
tests. Health and read-only download/status checks follow the switch.

Rollback restores the prior image, private launch configuration and original
code-bind sources; it does not restore an old database or overwrite storage.
Keep any newly generated immutable artifact/receipt for investigation. Contract47
one-record reconstruction and any future email migration/activation each require
their own reviewed inputs and production authorization.
