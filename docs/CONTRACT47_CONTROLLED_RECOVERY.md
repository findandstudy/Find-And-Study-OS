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
- An external historical logo without frozen bytes remains a default blocker:
  `recovery47:unfrozen_image_source`. The tool never downloads it or silently
  resolves current branding. The optional, record47-only asset manifest below
  can prepare a separately labelled reconstruction for review; application
  requires the exact user's decision receipt and durable audit sidecars.
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

## Explicit missing-brand-asset recovery (local implementation, not authorization)

Read-only inspection found two distinct missing image sources in session165:

- `https://www.findandstudy.com/wp-content/uploads/2025/10/logotest-scaled.png`
- `https://www.findandstudy.com/wp-content/uploads/2024/12/Find-and-study-logo-wht-scaled.webp`

Targeted local filename searches and existing release receipts did not establish
the signing-time bytes. The current normalized canonical brand PNGs are **not**
claimed to be those original images. A sample PDF or visually similar image is
insufficient to establish original provenance.

An optional `assetRecovery` object has `classification` equal to
`reconstructed_branding` (the known current case) or `verified_historical_assets`
(only with separately verified historical provenance), and at most two `assets`:

```text
requestedUrl               exact one of the two frozen URLs above
sourceUrl                  actual reviewed public www.findandstudy.com/wp-content/uploads/ URL
sourceSha256               hash recorded for source bytes in the provenance evidence
normalizedSha256           hash of the actual bounded PNG embedded below
dataUrl                    canonical image/png base64, <=256 KiB, <=1024 x 1024
provenanceReceiptSha256     hash of the reviewed private provenance JSON
```

Each provenance JSON is supplied as `<hash>.json` in `--asset-evidence-dir`.
It contains `schemaVersion: 1`, `classification`, `requestedUrl`, `sourceUrl`,
`sourceSha256`, `normalizedSha256`, `referenceSha256` (the existing independently
reviewed asset/backup receipt), `observedAt` and `operatorVerified: true`.
The CLI checks the file hash, exact tuple and actual embedded PNG hash. Source
and historical provenance are explicit operator attestations, not something a
hash or current URL alone proves. Historical mode additionally requires source
URL equality. Neither mode can map a signature, an arbitrary URL, duplicate
mapping, unused mapping or a remaining unmapped external image.

Only exact `img[src]` values in the prepared HTML change. Contractual text, links,
styles and original signature inputs are retained; the frozen database rows are
never rewritten. Reconstruction inserts a visible notice **outside the contract
body** explaining that branding is reconstructed, the historical image bytes
were not established, and this is not the original signing-time PDF artifact.
The notice participates in the rendered-content/evidence hash. Verified
historical mode and ordinary complete snapshots receive no reconstruction notice.

Actual TEST02 preflight also found `{{...}}` only inside a CSS documentation
comment and an absent rendered `{{whatsapp_phone}}`. Required-field inspection
now ignores HTML comments and CSS comments only within style contexts; rendered
text, attributes and quoted CSS content remain fail-closed. The original CSS
and frozen HTML are not edited by this inspection.

For this exact test record, optional top-level
`preservedBlankFields: ["whatsapp_phone"]` explicitly preserves the original
blank. It requires `reconstructed_branding`, an actually used placeholder, and
absence of both frozen `whatsapp_phone` and `whatsappPhone` values. Other field
names, duplicates, supplied values, unused options and any other missing field
are rejected. `phone`, `agencyPhone` and `agency_phone` are **never** inferred as
WhatsApp. The existing renderer still receives a null agent and the original
unchanged intake. The visible reconstruction notice additionally explains the
absent WhatsApp value and preserved blank.

The exact selection appears in the recovery manifest, audit sidecar and approval
receipt, and changes the rendered HTML/PDF hashes. Removing or changing it
invalidates the reviewed candidate. The offline operator preview wrapper reads
this optional top-level field from the private asset JSON, separates it from
`assetRecovery`, and copies it into the authority-free preview manifest. Omission
retains the original missing-field denial.

`--prepare` may run without an asset approval to create the reviewable candidate.
It reports `RECONSTRUCTED_CANDIDATE_REQUIRES_APPROVAL`, writes the PDF and a
`.recovery-<hash>.json` sidecar, and strips any stale asset approval from its new
review manifest. `candidate.assetAuditSha256` binds the exact sidecar, including
all asset descriptors, input/source digests, final HTML, PDF and evidence hashes.

`--apply` additionally requires `assetApprovalReceiptSha256` in the reviewed
manifest and `--asset-approval <private-json>`. This receipt must contain:

```text
schemaVersion: 1
userApproved: true
decision: approve_exact_recovered_rendition_for_contract47
target: the exact 47/165/48/12 target
inputSha256: the original frozen input digest
assetRecoverySha256: SHA-256 of canonical assetRecovery JSON
candidate: the exact reviewed candidate object, including assetAuditSha256
preservedBlankFields: ["whatsapp_phone"] only when the reviewed manifest explicitly uses it
userDecisionEvidenceSha256: hash of the recorded explicit user decision
recordedAt: the decision receipt timestamp
```

This is a recorded operator attestation of the user's decision, not a new login,
digital signature, or automatic authority grant. Preparing a manifest does not
authorize applying it. The actual deployment/recovery approval remains external.

Before the final row CAS, the same private signed-contracts directory receives
immutable PDF-bound recovery, approval and provenance JSON sidecars. A failed
sidecar write or wrong storage key rolls the entire DB transaction back; an
already-written orphan is preserved for inspection. Sidecar names start with
`recovery47-<pdfSHA>.recovery-`, `.approval-` and `.provenance-`, each followed by
its own SHA-256. No e-mail enrollment, SMTP call or agency approval is performed.

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
  identity/receipt, delivery-stop, artifact checks; exact asset mapping, visible
  reconstruction disclosure, immutable original inputs, provenance/approval
  mismatches, missing mapping and audit digest changes. Linux descriptor tests must
  also pass in the candidate Linux image.
- `tsx --test scripts/test-contract47-recovery-pg.ts`: requires dedicated
  `CONTRACT47_TEST_DATABASE_URL`, loopback and a fresh database whose name starts
  `fas_contract47_test_`; no application DB fallback. Exercises real row locks,
  same-target races, one-row updates, rollback and crash injection using only
  clearly synthetic TEST records.
  Reconstructed-candidate cases additionally prove approval+sidecar persistence
  before one-record finalization and rollback on failed sidecar persistence.

2026-11-26 local extension validation: **42 PASS, 1 Linux-only SKIP** in the
combined pure + disposable PostgreSQL run. The dedicated test database was
`fas_contract47_test_blank_20261126a` on loopback PostgreSQL16; no real rows or
assets were used. Linux fd checks and actual historical candidate visual review
remain separate gates. API TypeScript also passed. Tests cover misleading CSS
comment markers in visible text and CSS strings, absent/present WhatsApp values,
the exact blank allowlist, no phone inference, immutable original inputs and
approval/audit mutation denial.

The application-side recovery adapter and these local tests do not prove that
the current Apply TEST02 snapshot is complete. Actual source/runtime/DB identity,
worker isolation, backups, historical logo evidence, candidate review and final
production authorization remain explicit execution gates.
