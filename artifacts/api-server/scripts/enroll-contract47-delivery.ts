/** Manual one-record preparation only. Default read-only; never starts workers. */
import path from "node:path";
import { createRequire } from "node:module";
import { readPinnedRecoveryFile, sha256, validateRecovery47Manifest } from "../src/lib/contract47Recovery";
import { assertEnrollment47Mode, assertEnrollment47Source, enrollRecovery47, validateEnrollment47Manifest,
  type Enrollment47Manifest, type Enrollment47Evidence } from "../src/lib/contract47DeliveryEnrollment";

const allowed = new Set(["--manifest", "--manifest-sha256", "--source-root", "--recovery-manifest", "--operator-receipt", "--apply"]);
async function main() {
  const options = new Map<string, string>();
  for (let i = 2; i < process.argv.length; i++) {
    const key = process.argv[i];
    if (!allowed.has(key) || options.has(key)) throw new Error("enrollment47:invalid_arguments");
    const value = key === "--apply" ? "true" : process.argv[++i];
    if (!value || value.startsWith("--")) throw new Error("enrollment47:missing_argument");
    options.set(key, value);
  }
  for (const key of allowed) if (key !== "--apply" && !options.has(key)) throw new Error("enrollment47:reviewed_inputs_required");
  const expected = options.get("--manifest-sha256")!;
  if (!/^[a-f0-9]{64}$/.test(expected)) throw new Error("enrollment47:manifest_digest_required");
  const raw = await readPinnedRecoveryFile(options.get("--manifest")!, 128 * 1024);
  if (sha256(raw) !== expected) throw new Error("enrollment47:manifest_digest_mismatch");
  const manifest = JSON.parse(raw.toString()) as Enrollment47Manifest;
  validateEnrollment47Manifest(manifest); assertEnrollment47Mode();
  await assertEnrollment47Source(options.get("--source-root")!, import.meta.url, manifest);
  const connectionString = process.env.CONTRACT_ENROLLMENT_DATABASE_URL;
  if (!connectionString) throw new Error("enrollment47:dedicated_database_url_required");
  const url = new URL(connectionString);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || url.search || url.hash
    || url.hostname !== manifest.database.address || Number(url.port || "5432") !== manifest.database.port
    || decodeURIComponent(url.pathname.slice(1)) !== manifest.database.database
    || decodeURIComponent(url.username) !== manifest.database.role) throw new Error("enrollment47:connection_identity_invalid");
  const readEvidence = async (): Promise<Enrollment47Evidence> => {
    const recoveryManifest = await readPinnedRecoveryFile(options.get("--recovery-manifest")!, 1024 * 1024);
    if (sha256(recoveryManifest) !== manifest.recoveryManifestSha256) throw new Error("enrollment47:recovery_manifest_mismatch");
    const recovery = JSON.parse(recoveryManifest.toString()); validateRecovery47Manifest(recovery);
    if (!recovery.candidate || recovery.candidate.pdfSha256 !== manifest.pdfSha256) throw new Error("enrollment47:recovery_binding_mismatch");
    const prefix = path.join(manifest.storageRoot, "signed-contracts", `recovery47-${manifest.pdfSha256}`);
    if ((await readPinnedRecoveryFile(`${prefix}.pdf.ct`, 64)).toString() !== "application/pdf") throw new Error("enrollment47:pdf_mime_mismatch");
    const result: Enrollment47Evidence = { recoveryManifest, pdf: await readPinnedRecoveryFile(`${prefix}.pdf`),
      operatorReceipt: await readPinnedRecoveryFile(options.get("--operator-receipt")!, 128 * 1024) };
    if (recovery.assetRecovery) {
      if (!recovery.assetApprovalReceiptSha256) throw new Error("enrollment47:asset_approval_required");
      result.assetAudit = await readPinnedRecoveryFile(`${prefix}.recovery-${recovery.candidate.assetAuditSha256}.json`, 128 * 1024);
      result.assetApproval = await readPinnedRecoveryFile(`${prefix}.approval-${recovery.assetApprovalReceiptSha256}.json`, 128 * 1024);
      result.assetProvenance = [];
      for (const asset of recovery.assetRecovery.assets) result.assetProvenance.push(await readPinnedRecoveryFile(`${prefix}.provenance-${asset.provenanceReceiptSha256}.json`, 128 * 1024));
    }
    return result;
  };
  // Use the driver directly, never import the runtime/global application pool.
  const ownRequire = createRequire(import.meta.url);
  const pg = createRequire(ownRequire.resolve("@workspace/db"))("pg");
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 5000, statement_timeout: 10000,
    query_timeout: 12000, application_name: "contract47-delivery-enrollment" });
  try {
    await client.connect();
    await enrollRecovery47(client, manifest, readEvidence, options.has("--apply"));
    console.log(JSON.stringify({ status: options.has("--apply") ? "ONE_TEST_DELIVERY_READY_NOT_SENT" : "READ_ONLY_ENROLLMENT_CHECK_PASS",
      contractId: 47, pdfSha256: manifest.pdfSha256, emailSha256: manifest.email.sha256 }));
  } finally { await client.end(); }
}
main().catch(error => {
  const message = error instanceof Error ? error.message : "";
  console.error(/^(?:enrollment47|recovery47):[a-zA-Z0-9_:,.]+$/.test(message) ? message : "enrollment47:operation_failed_inspect_privately");
  process.exitCode = 1;
});
