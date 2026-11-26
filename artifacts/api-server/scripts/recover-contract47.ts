/**
 * Manual TEST02 recovery. Default: read-only validation, no PDF or DB writes.
 * Run only from a reviewed release, with a reviewed private manifest.
 * Credentials use CONTRACT_RECOVERY_DATABASE_URL, never the application's URL.
 * This command never starts the API, workers, email or notification services.
 */
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import {
  applyRecovery47, assertRecovery47Database, assertRecovery47ExecutingSource, canonicalJson, prepareRecovery47,
  readPinnedRecoveryFile, readRecovery47Snapshot, recovery47InputDigest, sha256,
  REQUIRED_RECOVERY_SOURCE_FILES, validateRecovery47Manifest, validateRecovery47WorkerReceipt, writeImmutableRecoveryFile,
  recovery47AssetAudit, validateRecovery47AssetProvenance,
  type Recovery47Manifest,
} from "../src/lib/contract47Recovery";

// Resolve the existing workspace driver's dependency without importing the
// database module (which would start the application's global connection pool).
const ownRequire = createRequire(import.meta.url);
const pg = createRequire(ownRequire.resolve("@workspace/db"))("pg");

const allowed = new Set(["--manifest", "--manifest-sha256", "--source-root", "--prepare", "--apply", "--candidate-dir", "--storage-root", "--inspect", "--worker-receipt", "--asset-evidence-dir", "--asset-approval"]);
function args() {
  const values = new Map<string, string>();
  for (let i = 2; i < process.argv.length; i++) {
    const key = process.argv[i];
    if (!allowed.has(key) || values.has(key)) throw new Error("recovery47:invalid_arguments");
    if (["--prepare", "--apply", "--inspect"].includes(key)) values.set(key, "true");
    else {
      const value = process.argv[++i];
      if (!value || value.startsWith("--")) throw new Error("recovery47:missing_argument");
      values.set(key, value);
    }
  }
  if (["--prepare", "--apply", "--inspect"].filter(key => values.has(key)).length > 1) throw new Error("recovery47:conflicting_modes");
  return values;
}

async function main() {
  const options = args();
  const manifestPath = options.get("--manifest");
  const expectedManifest = options.get("--manifest-sha256");
  const sourceRoot = options.get("--source-root");
  if (!manifestPath || !/^[0-9a-f]{64}$/.test(expectedManifest ?? "") || !sourceRoot) throw new Error("recovery47:reviewed_manifest_required");
  const raw = await readPinnedRecoveryFile(manifestPath, 1024 * 1024);
  if (sha256(raw) !== expectedManifest) throw new Error("recovery47:manifest_digest_mismatch");
  const manifest: Recovery47Manifest = JSON.parse(raw.toString("utf8"));
  validateRecovery47Manifest(manifest);
  const canonicalRoot = await realpath(sourceRoot);
  if (canonicalRoot !== sourceRoot) throw new Error("recovery47:source_root_must_be_canonical");
  await assertRecovery47ExecutingSource(canonicalRoot, import.meta.url);
  for (const [file, expected] of Object.entries(manifest.sourceFiles)) {
    if (!/^[a-zA-Z0-9_./-]+$/.test(file) || file.split("/").some(part => part === ".." || !part)
      || (!file.startsWith("artifacts/api-server/") && !(REQUIRED_RECOVERY_SOURCE_FILES as readonly string[]).includes(file))
      || !/^[a-f0-9]{64}$/.test(expected)) throw new Error("recovery47:source_path_invalid");
    const full = path.join(canonicalRoot, file);
    if (await realpath(full) !== full || sha256(await readFile(full)) !== expected) throw new Error("recovery47:source_drift");
  }
  const connectionString = process.env.CONTRACT_RECOVERY_DATABASE_URL;
  if (!connectionString) throw new Error("recovery47:dedicated_database_url_required");
  const parsed = new URL(connectionString);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !parsed.hostname || parsed.search || parsed.hash
    || parsed.hostname !== manifest.database.address || Number(parsed.port || "5432") !== manifest.database.port
    || decodeURIComponent(parsed.pathname.slice(1)) !== manifest.database.database
    || decodeURIComponent(parsed.username) !== manifest.database.role) throw new Error("recovery47:connection_identity_invalid");
  if (process.env.SIGNED_CONTRACT_DELIVERY_ENABLED !== "false" || process.env.SIGNED_CONTRACT_PDF_WORKER_ENABLED !== "false") {
    throw new Error("recovery47:contract_workers_must_be_disabled");
  }
  if (options.has("--apply") || options.has("--prepare")) {
    const receipt = options.get("--worker-receipt");
    if (!receipt) throw new Error("recovery47:verified_worker_receipt_required");
    validateRecovery47WorkerReceipt(await readPinnedRecoveryFile(receipt, 128 * 1024), manifest);
  }
  const provenance: Buffer[] = [];
  if (manifest.assetRecovery) {
    const evidenceDirectory = options.get("--asset-evidence-dir");
    if (!evidenceDirectory) throw new Error("recovery47:asset_evidence_directory_required");
    for (let i = 0; i < manifest.assetRecovery.assets.length; i++) {
      const asset = manifest.assetRecovery.assets[i];
      const bytes = await readPinnedRecoveryFile(path.join(evidenceDirectory, `${asset.provenanceReceiptSha256}.json`), 128 * 1024);
      validateRecovery47AssetProvenance(bytes, manifest.assetRecovery, i);
      provenance.push(bytes);
    }
  } else if (options.has("--asset-evidence-dir") || options.has("--asset-approval")) throw new Error("recovery47:asset_manifest_missing");
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 5000, statement_timeout: 10000,
    query_timeout: 12000, application_name: "contract47-controlled-recovery" });
  try {
    await client.connect();
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL search_path = pg_catalog, public");
    await assertRecovery47Database(client, manifest.database);
    const snapshot = await readRecovery47Snapshot(client);
    await client.query("ROLLBACK");
    const observedDigest = recovery47InputDigest(snapshot);
    if (options.has("--inspect")) {
      // First read-only pass: obtain the hash needed for a separately reviewed
      // manifest. Never print the signed payload, signer data or signature.
      console.log(JSON.stringify({ status: "READ_ONLY_INSPECTED", contractId: 47, inputSha256: observedDigest }));
      return;
    }
    const params = prepareRecovery47(snapshot, manifest.inputSha256, manifest.assetRecovery, manifest.preservedBlankFields);
    if (options.has("--apply")) {
      if (!manifest.candidate) throw new Error("recovery47:approved_candidate_required");
      const candidateDir = options.get("--candidate-dir");
      const storageRoot = options.get("--storage-root");
      if (!candidateDir || !storageRoot) throw new Error("recovery47:candidate_and_storage_required");
      if (storageRoot !== manifest.storageRoot) throw new Error("recovery47:storage_identity_mismatch");
      const pdf = await readPinnedRecoveryFile(path.join(candidateDir, `${manifest.candidate.pdfSha256}.pdf`));
      const approvalPath = options.get("--asset-approval");
      if (manifest.assetRecovery && !approvalPath) throw new Error("recovery47:asset_approval_required");
      const approval = approvalPath ? await readPinnedRecoveryFile(approvalPath, 128 * 1024) : undefined;
      await applyRecovery47(client, manifest, pdf, async (bytes, digest) => {
        const name = `recovery47-${digest}.pdf`;
        const targetDir = path.join(storageRoot, "signed-contracts");
        await writeImmutableRecoveryFile(targetDir, name, bytes);
        await writeImmutableRecoveryFile(targetDir, `${name}.ct`, Buffer.from("application/pdf"));
        return `/objects/signed-contracts/${name}`;
      }, manifest.assetRecovery ? { provenanceReceipts: provenance, approvalReceipt: approval!,
        installAudit: async (audit, approved, receipts) => {
          const targetDir = path.join(storageRoot, "signed-contracts");
          const prefix = `recovery47-${manifest.candidate!.pdfSha256}`;
          const name = `${prefix}.recovery-${sha256(audit)}.json`;
          await writeImmutableRecoveryFile(targetDir, name, audit);
          await writeImmutableRecoveryFile(targetDir, `${prefix}.approval-${sha256(approved)}.json`, approved);
          for (const receipt of receipts) await writeImmutableRecoveryFile(targetDir, `${prefix}.provenance-${sha256(receipt)}.json`, receipt);
          return `/objects/signed-contracts/${name}`;
        } } : undefined);
      console.log(JSON.stringify({ status: "APPLIED_ONE_RECORD", contractId: 47, pdfSha256: manifest.candidate.pdfSha256 }));
    } else if (options.has("--prepare")) {
      const directory = options.get("--candidate-dir");
      if (!directory) throw new Error("recovery47:candidate_directory_required");
      const { buildSignedPdf } = await import("../src/lib/contractPdf");
      // Legacy renderer diagnostics include signer email. This standalone
      // process has no other jobs: suppress them, restore on every outcome.
      const previous = { log: console.log, info: console.info, warn: console.warn, error: console.error };
      let built: Awaited<ReturnType<typeof buildSignedPdf>>;
      try {
        console.log = console.info = console.warn = console.error = () => {};
        built = await buildSignedPdf(params);
      } finally { Object.assign(console, previous); }
      const candidate: NonNullable<Recovery47Manifest["candidate"]> = { pdfSha256: sha256(built.pdfBytes), evidenceHash: built.evidenceHash, renderedHtmlSha256: sha256(params.bodyHtml) };
      await writeImmutableRecoveryFile(directory, `${candidate.pdfSha256}.pdf`, built.pdfBytes);
      if (manifest.assetRecovery) {
        const audit = recovery47AssetAudit({ ...manifest, candidate });
        candidate.assetAuditSha256 = sha256(audit);
        await writeImmutableRecoveryFile(directory, `${candidate.pdfSha256}.recovery-${candidate.assetAuditSha256}.json`, audit);
        for (const receipt of provenance) await writeImmutableRecoveryFile(directory, `${sha256(receipt)}.json`, receipt);
      }
      // An old approval cannot carry over to a newly rendered candidate.
      const { assetApprovalReceiptSha256: _oldApproval, ...unapproved } = manifest;
      const reviewManifest = Buffer.from(`${canonicalJson({ ...unapproved, candidate })}\n`);
      const reviewHash = sha256(reviewManifest);
      await writeImmutableRecoveryFile(directory, `${reviewHash}.manifest.json`, reviewManifest);
      console.log(JSON.stringify({ status: manifest.assetRecovery?.classification === "reconstructed_branding"
        ? "RECONSTRUCTED_CANDIDATE_REQUIRES_APPROVAL" : "CANDIDATE_REQUIRES_REVIEW", contractId: 47, ...candidate, manifestSha256: reviewHash }));
    } else {
      console.log(JSON.stringify({ status: "DRY_RUN_PASS", contractId: 47, inputSha256: observedDigest, renderedHtmlSha256: sha256(params.bodyHtml) }));
    }
  } finally { await client.end(); }
}

main().catch(error => {
  // Driver, filesystem and renderer errors can contain paths, user data or
  // credentials. Only fixed operator codes leave this process.
  const message = error instanceof Error ? error.message : "";
  console.error(/^recovery47:[a-zA-Z0-9_:,.]+$/.test(message) ? message : "recovery47:operation_failed_inspect_privately");
  process.exitCode = 1;
});
