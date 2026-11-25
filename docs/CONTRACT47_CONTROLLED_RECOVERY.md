# TEST02 controlled PDF recovery — prepared locally, not executed on Apply

This command addresses only the existing signed contract **47**, signing session
**165**, frozen template **48**, agency application **12**. It is not a signature,
an approval, an email retry, or a batch renderer. No production execution is
authorized by this document. The normal production deployment/backup/approval
gate still applies.

## Current boundaries

- `SIGNED_CONTRACT_DELIVERY_ENABLED=false` disables the signed-contract delivery
  sweep, legacy backfill, and their startup. Unset retains existing behavior;
  unexpected explicit values disable it. The separate PDF worker must also be
  explicitly disabled during recovery.
- The legacy email queue has no durable attachment/idempotency contract. This
  change does not make that delivery worker safe to re-enable. No email is sent.
- No current template, agent profile, company-signature file, or branding profile
  may fill missing historical inputs. A missing original base64 signature,
  snapshot, used template field, or frozen verification evidence stops recovery.
- An external historical logo without frozen bytes is a distinct blocker:
  `recovery47:unfrozen_image_source`. The tool does not replace it with today's
  logo or download it. Restoring such a logo needs separate review of the exact
  snapshot URL, original/approved static image bytes and SHA-256/provenance. This
  tool intentionally does not implement that historical asset substitution.
- A non-null final PDF key **or** evidence hash blocks recovery. Existing signed
  artifacts cannot be replaced. Any existing lease, even old, blocks it.

## Manifest and evidence

Keep all operator files outside Git in an existing private Linux directory,
owned by the execution user, with file mode `0600`. Paths must be canonical,
without symlinks. The CLI fails closed on non-Linux systems. It never reads the
application's generic `DATABASE_URL`; the dedicated connection variable is
`CONTRACT_RECOVERY_DATABASE_URL`.

The reviewed JSON manifest (`Recovery47Manifest` in `contract47Recovery.ts`)
contains:

1. `schemaVersion: 1` and the exact `target` IDs above.
2. `database`: PostgreSQL-reported `database`, `address`, `port`, `role`.
3. `storageRoot`: the exact canonical private local-storage root.
4. `sourceFiles`: exact byte SHA-256 for every `REQUIRED_RECOVERY_SOURCE_FILES`
   entry, including the CLI, render helpers, asset/byte/outbound helpers and
   package/lock metadata. Additional API source pins may be included. Re-hash
   the actual deployed candidate, not a presumed branch or stale health value.
5. `inputSha256`: canonical hash of the exact joined original rows. The default
   read-only `--inspect` mode reports this digest without exporting personal
   data or the signature. It still requires a source/DB-bound manifest; its
   initial input digest is ignored only for this read-only inspection.
6. `workerIsolationReceiptSha256`: byte hash of a separate, reviewed private
   operator receipt. It is verified for `--prepare` and `--apply`.
7. After preparation, `candidate`: exact PDF SHA-256, evidence hash and final
   rendered-HTML SHA-256. Review the candidate visually before approving this
   second manifest. A different candidate requires another reviewed digest.

The worker receipt must contain `schemaVersion: 1`, `operatorVerified: true`,
the exact `target` and `database`, `sourceFilesSha256` (SHA-256 of canonical JSON
of the manifest's source-file map), `recordedAt`,
`otherContractRenderersDisabled: true`, and a nonempty `instances` array. Each
entry records the **actually verified** process/container identity in `id`,
its `startedAt`, `contractDeliveryEnabled: false`,
`contractPdfWorkerEnabled: false`, and `inFlightContractJobs: 0`.

The receipt expires after one hour. The CLI verifies its hash and bindings; it
does not itself inspect other processes or independently prove operator claims.
The operator must observe all API/worker instances, pause/deny legacy render
entry points, wait for existing work to finish, and record real identities.
Setting flags only in the CLI's environment is insufficient isolation.

## Repeatable command stages

Use the already installed, pinned workspace runner and a reviewed release.
Pass `--manifest`, `--manifest-sha256`, and `--source-root` to
`artifacts/api-server/scripts/recover-contract47.ts` on every invocation.

- No mode flag: `BEGIN READ ONLY`, identity + frozen-input validation, digest-only
  output; no artifact or database writes.
- `--inspect`: read-only digest discovery only. It does not certify completeness.
- `--prepare --candidate-dir <private-dir> --worker-receipt <private-file>`:
  renders from immutable inputs, writes an exclusive PDF and a proposed review
  manifest. It does not write the DB. Renderer diagnostics that contain signer
  addresses are suppressed in this standalone process.
- `--apply --candidate-dir <private-dir> --storage-root <exact-manifest-root>
  --worker-receipt <private-file>`: requires the approved candidate manifest;
  consumes the exact already-reviewed bytes, without another render.

The operator must set both contract-worker flags explicitly to `false` for the
CLI. No example command embeds credentials or authorizes real execution.

## Transaction and recovery behavior

Apply locks the exact contract/session/application rows, rechecks original
input digest and identity, stamps an exclusive lease, installs only the reviewed
content-addressed PDF and MIME sidecar, rechecks the complete frozen digest, and
CAS-updates only contract47's `pdf_object_key`, `evidence_hash`, and lease.
It never updates agency dates/status, application approval, session data,
signature bytes, email status, or other records. Public schema qualification
prevents search-path substitution.

The artifact directory and opened descriptors are checked on Linux. Files use
exclusive no-follow creation, mode `0600`, and file/directory fsync. Existing
bytes may be reused only if the exact hash matches; nothing is overwritten or
automatically removed. A crash before COMMIT rolls back database work but can
leave an immutable candidate/orphan. An uncertain COMMIT requires reading row47
first; never blindly retry or regenerate. If already finalized, stop and verify
the recorded key/hash. Rollback never restores an old production database.

## Local verification

- `tsx --test scripts/test-contract47-recovery.ts`: frozen-input, target,
  identity/receipt, delivery-stop, artifact checks. Linux descriptor tests must
  also pass in the candidate Linux image.
- `tsx --test scripts/test-contract47-recovery-pg.ts`: requires dedicated
  `CONTRACT47_TEST_DATABASE_URL`, loopback and a fresh database whose name starts
  `fas_contract47_test_`; no application DB fallback. Exercises real row locks,
  same-target races, one-row updates, rollback and crash injection using only
  clearly synthetic TEST records.

The application-side recovery adapter and these local tests do not prove that
the current Apply TEST02 snapshot is complete. Actual source/runtime/DB identity,
worker isolation, backups, historical logo evidence, candidate review and final
production authorization remain explicit execution gates.
