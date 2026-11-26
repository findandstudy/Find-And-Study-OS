/** Operator-only adoption of one recovered TEST02 PDF; never sends or signs. */
import { randomUUID } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  RECOVERY47_TARGET, REQUIRED_RECOVERY_SOURCE_FILES, assertRecovery47Database, canonicalJson,
  prepareRecovery47, readRecovery47Snapshot, recovery47AssetAudit, recovery47InputDigest, sha256,
  validateRecovery47AssetApproval, validateRecovery47AssetProvenance, validateRecovery47Manifest, validateRecovery47Pdf,
  type Recovery47Identity, type Recovery47Manifest, type Recovery47Snapshot, type Recovery47SqlClient,
} from "./contract47Recovery";

const HEX = /^[a-f0-9]{64}$/;
function fail(code: string): never { throw new Error(`enrollment47:${code}`); }
export const ENROLLMENT47_RECIPIENT = "en+agency-uat-20261125-02@findandstudy.com";
export const ENROLLMENT47_MESSAGE_ID = "<fas-contract-47-test02-recovered-v1@findandstudy.com>";
export const ENROLLMENT47_SOURCE_FILES = [...REQUIRED_RECOVERY_SOURCE_FILES,
  "artifacts/api-server/src/lib/contract47DeliveryEnrollment.ts", "artifacts/api-server/scripts/enroll-contract47-delivery.ts",
  "artifacts/api-server/src/lib/contractDeliveryPolicy.ts", "artifacts/api-server/src/lib/contractDeliveryStore.ts",
  "artifacts/api-server/src/lib/contractDeliveryWorker.ts", "artifacts/api-server/src/lib/contractDeliveryPdf.ts",
  "deploy/prepared-migrations/apply/0067_signed_contract_delivery.sql",
] as const;
export interface Enrollment47Manifest {
  schemaVersion: 1; target: typeof RECOVERY47_TARGET; database: Recovery47Identity; storageRoot: string;
  recipient: typeof ENROLLMENT47_RECIPIENT; messageId: typeof ENROLLMENT47_MESSAGE_ID;
  recoveryManifestSha256: string; postRecoveryInputSha256: string; pdfObjectKey: string;
  pdfSha256: string; evidenceHash: string; operatorReceiptSha256: string; sourceFiles: Record<string, string>;
  email: { subject: string; html: string; text: string; sha256: string };
}
export interface Enrollment47Evidence {
  recoveryManifest: Uint8Array; pdf: Uint8Array; operatorReceipt: Uint8Array;
  assetAudit?: Uint8Array; assetApproval?: Uint8Array; assetProvenance?: Uint8Array[];
}

export function enrollment47Email(reconstructed: boolean): Enrollment47Manifest["email"] {
  const subject = reconstructed ? "TEST02 — signed agreement copy with reconstructed branding" : "TEST02 — recovered signed agreement copy";
  const disclosure = reconstructed
    ? "This PDF contains reconstructed branding. The historical logo image bytes have not been established. The original signing record and signature were not changed by this recovery."
    : "This recovered PDF uses separately reviewed historical asset evidence. The original signing record and signature were not changed by this recovery.";
  const text = `Attached is the recovered PDF copy of your signed agreement.\n\n${disclosure}`;
  const html = `<p>Attached is the recovered PDF copy of your signed agreement.</p><p><strong>${disclosure}</strong></p>`;
  return { subject, html, text, sha256: sha256(canonicalJson({ subject, html, text })) };
}

export function validateEnrollment47Manifest(value: unknown): asserts value is Enrollment47Manifest {
  const m = value as Enrollment47Manifest;
  if (!m || m.schemaVersion !== 1 || canonicalJson(m.target) !== canonicalJson(RECOVERY47_TARGET)
    || m.recipient !== ENROLLMENT47_RECIPIENT || m.messageId !== ENROLLMENT47_MESSAGE_ID) fail("target_mismatch");
  if (!m.database || !m.database.database || !m.database.address || !m.database.role
    || !Number.isInteger(m.database.port) || m.database.port < 1 || m.database.port > 65535) fail("identity_missing");
  if (!m.storageRoot?.startsWith("/") || m.storageRoot.endsWith("/")
    || m.storageRoot.split("/").some((part, index) => index > 0 && (!part || part === "." || part === ".."))) fail("storage_identity_invalid");
  if (![m.recoveryManifestSha256, m.postRecoveryInputSha256, m.pdfSha256, m.evidenceHash, m.operatorReceiptSha256].every(v => HEX.test(v ?? ""))
    || m.pdfObjectKey !== `/objects/signed-contracts/recovery47-${m.pdfSha256}.pdf`) fail("reviewed_digest_missing");
  if (!m.sourceFiles || ENROLLMENT47_SOURCE_FILES.some(file => !HEX.test(m.sourceFiles[file] ?? ""))) fail("source_attestation_missing");
  const e = m.email;
  if (!e || typeof e.subject !== "string" || typeof e.html !== "string" || typeof e.text !== "string"
    || e.subject.length > 1000 || e.html.length > 5000 || e.text.length > 5000
    || sha256(canonicalJson({ subject: e.subject, html: e.html, text: e.text })) !== e.sha256) fail("email_digest_invalid");
}

export function assertEnrollment47Mode(env: NodeJS.ProcessEnv = process.env): void {
  if (env.SIGNED_CONTRACT_DURABLE_DELIVERY_MODE !== "prepare" || env.SIGNED_CONTRACT_DELIVERY_ENABLED !== "false"
    || env.SIGNED_CONTRACT_PDF_WORKER_ENABLED !== "false" || env.SIGNED_CONTRACT_SMTP_ENABLED !== "false") fail("prepare_only_required");
}

export function validateEnrollment47Operator(raw: Uint8Array, m: Enrollment47Manifest, now = Date.now()): void {
  if (sha256(raw) !== m.operatorReceiptSha256) fail("operator_receipt_digest_mismatch");
  let r: any; try { r = JSON.parse(Buffer.from(raw).toString()); } catch { fail("operator_receipt_invalid"); }
  const at = Date.parse(r.recordedAt);
  if (r.schemaVersion !== 1 || r.operatorVerified !== true || r.enrollmentApproved !== true
    || r.operation !== "prepare_exact_recovered_test47_delivery"
    || canonicalJson(r.target) !== canonicalJson(RECOVERY47_TARGET) || canonicalJson(r.database) !== canonicalJson(m.database)
    || r.recipient !== m.recipient || r.messageId !== m.messageId || r.postRecoveryInputSha256 !== m.postRecoveryInputSha256
    || r.recoveryManifestSha256 !== m.recoveryManifestSha256 || r.pdfSha256 !== m.pdfSha256 || r.evidenceHash !== m.evidenceHash
    || r.emailSha256 !== m.email.sha256 || r.sourceFilesSha256 !== sha256(canonicalJson(m.sourceFiles))
    || !HEX.test(r.userDecisionEvidenceSha256 ?? "") || !Number.isFinite(at) || at > now || now - at > 3600000
    || !Array.isArray(r.instances) || r.instances.length < 1 || r.instances.length > 20) fail("operator_isolation_unproven");
  const ids = new Set<string>();
  for (const i of r.instances) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{2,199}$/.test(i.id ?? "") || ids.has(i.id)
      || !Number.isFinite(Date.parse(i.startedAt)) || Date.parse(i.startedAt) > at
      || !["off", "prepare"].includes(i.durableMode) || i.legacyDeliveryEnabled !== false || i.legacyPdfEnabled !== false
      || i.smtpEnabled !== false || i.inFlightContractJobs !== 0) fail("operator_isolation_unproven");
    ids.add(i.id);
  }
}

export async function assertEnrollment47Source(root: string, scriptUrl: string, m: Enrollment47Manifest): Promise<void> {
  if (await realpath(root) !== root
    || await realpath(fileURLToPath(scriptUrl)) !== path.join(root, "artifacts/api-server/scripts/enroll-contract47-delivery.ts")
    || await realpath(fileURLToPath(import.meta.url)) !== path.join(root, "artifacts/api-server/src/lib/contract47DeliveryEnrollment.ts")) fail("executing_source_mismatch");
  for (const [file, hash] of Object.entries(m.sourceFiles)) {
    if (!(ENROLLMENT47_SOURCE_FILES as readonly string[]).includes(file) || !HEX.test(hash)) fail("source_path_invalid");
    const target = path.join(root, file);
    if (await realpath(target) !== target || sha256(await readFile(target)) !== hash) fail("source_drift");
  }
}

/** Pure validation of complete post-recovery source, artifact and provenance. */
export function verifyEnrollment47(snapshot: Recovery47Snapshot, m: Enrollment47Manifest, evidence: Enrollment47Evidence): Recovery47Manifest {
  validateEnrollment47Manifest(m); validateEnrollment47Operator(evidence.operatorReceipt, m);
  if (sha256(evidence.recoveryManifest) !== m.recoveryManifestSha256) fail("recovery_manifest_mismatch");
  const recovery = JSON.parse(Buffer.from(evidence.recoveryManifest).toString()) as Recovery47Manifest;
  validateRecovery47Manifest(recovery);
  if (!recovery.candidate || canonicalJson(recovery.database) !== canonicalJson(m.database) || recovery.storageRoot !== m.storageRoot
    || recovery.candidate.pdfSha256 !== m.pdfSha256 || recovery.candidate.evidenceHash !== m.evidenceHash) fail("recovery_binding_mismatch");
  if (recovery47InputDigest(snapshot) !== m.postRecoveryInputSha256) fail("post_recovery_input_mismatch");
  const c = snapshot.contract;
  if (c.signer_email !== ENROLLMENT47_RECIPIENT || snapshot.session.signer_email !== ENROLLMENT47_RECIPIENT
    || c.pdf_object_key !== m.pdfObjectKey || c.evidence_hash !== m.evidenceHash
    || c.emailed_at !== null || c.delivery_claimed_at !== null) fail("source_not_eligible");
  validateRecovery47Pdf(evidence.pdf, m.pdfSha256);
  const original = structuredClone(snapshot);
  original.contract.pdf_object_key = null; original.contract.evidence_hash = null;
  // No other field is reset: approval, identity, session or intake drift blocks.
  const params = prepareRecovery47(original, recovery.inputSha256, recovery.assetRecovery);
  if (sha256(params.bodyHtml) !== recovery.candidate.renderedHtmlSha256) fail("rendered_input_mismatch");
  if (recovery.assetRecovery) {
    if (!evidence.assetAudit || !evidence.assetApproval || evidence.assetProvenance?.length !== recovery.assetRecovery.assets.length
      || !Buffer.from(evidence.assetAudit).equals(recovery47AssetAudit(recovery))) fail("recovery_sidecar_missing_or_changed");
    validateRecovery47AssetApproval(evidence.assetApproval, recovery);
    recovery.assetRecovery.assets.forEach((_, index) => validateRecovery47AssetProvenance(evidence.assetProvenance![index], recovery.assetRecovery!, index));
  }
  if (canonicalJson(m.email) !== canonicalJson(enrollment47Email(recovery.assetRecovery?.classification === "reconstructed_branding"))) fail("disclosure_email_mismatch");
  return recovery;
}

/** Default read-only. An uncertain COMMIT is never retried or reconciled here. */
export async function enrollRecovery47(client: Recovery47SqlClient, m: Enrollment47Manifest,
  readEvidence: () => Promise<Enrollment47Evidence>, apply = false, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  validateEnrollment47Manifest(m); assertEnrollment47Mode(env);
  await client.query(apply ? "BEGIN" : "BEGIN READ ONLY");
  try {
    await client.query("SET LOCAL lock_timeout = '3s'"); await client.query("SET LOCAL statement_timeout = '10s'");
    await client.query("SET LOCAL search_path = pg_catalog, public");
    await assertRecovery47Database(client, m.database);
    const snapshot = await readRecovery47Snapshot(client, apply);
    const existing = await client.query("SELECT signed_contract_id FROM public.signed_contract_deliveries WHERE signed_contract_id=47 OR signing_session_id=165 OR message_id=$1", [m.messageId]);
    if (existing.rows.length) fail("existing_delivery_no_retry");
    verifyEnrollment47(snapshot, m, await readEvidence());
    if (!apply) { await client.query("ROLLBACK"); return; }
    const inserted = await client.query(`INSERT INTO public.signed_contract_deliveries
      (signed_contract_id,signing_session_id,recipient,message_id) VALUES (47,165,$1,$2) RETURNING signed_contract_id`, [m.recipient, m.messageId]);
    if (inserted.rowCount !== 1) fail("insert_failed");
    const claim = randomUUID();
    const preparing = await client.query(`UPDATE public.signed_contract_deliveries SET state='preparing',claim_id=$1,
      claimed_at=clock_timestamp(),prepare_attempts=1,updated_at=clock_timestamp()
      WHERE signed_contract_id=47 AND state='waiting_pdf' RETURNING signed_contract_id`, [claim]);
    if (preparing.rowCount !== 1) fail("preparation_claim_failed");
    // Re-read bytes and every source field before freezing ready content.
    verifyEnrollment47(await readRecovery47Snapshot(client), m, await readEvidence());
    const ready = await client.query(`UPDATE public.signed_contract_deliveries SET state='ready',pdf_object_key=$1,pdf_sha256=$2,evidence_hash=$3,
      subject=$4,html_body=$5,text_body=$6,claim_id=NULL,claimed_at=NULL,updated_at=clock_timestamp()
      WHERE signed_contract_id=47 AND signing_session_id=165 AND recipient=$7 AND message_id=$8
      AND state='preparing' AND claim_id=$9 RETURNING signed_contract_id`,
    [m.pdfObjectKey,m.pdfSha256,m.evidenceHash,m.email.subject,m.email.html,m.email.text,m.recipient,m.messageId,claim]);
    if (ready.rowCount !== 1) fail("freeze_failed");
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
}
