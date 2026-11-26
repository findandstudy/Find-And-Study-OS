import assert from "node:assert/strict";
import { test } from "node:test";
import { realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { RECOVERY47_TARGET, RECOVERY47_IMAGE_URLS, REQUIRED_RECOVERY_SOURCE_FILES, canonicalJson, prepareRecovery47,
  recovery47AssetAudit, recovery47InputDigest, sha256, type Recovery47Snapshot, type Recovery47Manifest } from "../src/lib/contract47Recovery";
import { ENROLLMENT47_RECIPIENT, ENROLLMENT47_MESSAGE_ID, ENROLLMENT47_SOURCE_FILES, enrollment47Email,
  assertEnrollment47Mode, assertEnrollment47Source, validateEnrollment47Manifest, validateEnrollment47Operator,
  verifyEnrollment47, type Enrollment47Manifest, type Enrollment47Evidence } from "../src/lib/contract47DeliveryEnrollment";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
export const ENROLLMENT_TEST_ENV = { SIGNED_CONTRACT_DURABLE_DELIVERY_MODE: "prepare", SIGNED_CONTRACT_DELIVERY_ENABLED: "false",
  SIGNED_CONTRACT_PDF_WORKER_ENABLED: "false", SIGNED_CONTRACT_SMTP_ENABLED: "false" };
export const ENROLLMENT_TEST_PDF = Buffer.from(`%PDF-1.7\n${"SYNTHETIC TEST PDF ONLY ".repeat(20)}`);
export function enrollmentTestSnapshot(preserveWhatsAppBlank = false): Recovery47Snapshot {
  return {
    contract: { id: 47, signing_session_id: 165, template_id: 48, agent_id: 902,
      subject_type: "agent_application", subject_id: 12,
      pdf_object_key: `/objects/signed-contracts/recovery47-${sha256(ENROLLMENT_TEST_PDF)}.pdf`, evidence_hash: "3".repeat(64),
      delivery_claimed_at: null, emailed_at: null, signed_at: "2026-11-25T17:00:00.000Z",
      signer_email: ENROLLMENT47_RECIPIENT, signer_name: "TEST ACENTE 02", signer_ip: "192.0.2.2", signer_user_agent: "TEST",
      signature_image_base64: PNG, signature_image_object_key: null,
      email_verification_required: true, email_verification_method: "one_time_code", email_verified_at: "2026-11-25T16:00:00.000Z" },
    session: { id: 165, template_id: 48, agent_id: 902, subject_type: "agent_application", subject_id: 12,
      status: "signed", revoked_at: null, signed_at: "2026-11-25T17:00:00.000Z", signer_email: ENROLLMENT47_RECIPIENT,
      template_version_snapshot: 6, template_name_snapshot: "TEST Agreement", template_language_snapshot: "en",
      template_entity_type_snapshot: "company", template_intake_schema_snapshot: null,
      template_body_html_snapshot: `<style>.box{color:#123456}</style><p class="box">{{agency_name}} {{signer_name}}</p>${preserveWhatsAppBlank ? '<p>WhatsApp: {{whatsapp_phone}}</p>' : ''}<img src="${RECOVERY47_IMAGE_URLS[0]}"><img src="{{signature}}"><img src="{{main_agency_signature}}">`,
      template_signing_page_config_snapshot: { companySignatureDataUrl: `data:image/png;base64,${PNG}`, requireEmailVerification: true },
      intake_data: { companyName: "TEST synthetic company" } },
    application: { id: 12, signing_session_id: 165, signed_contract_id: 47, contract_template_id: 48,
      provisional_agent_id: 902, approved_agent_id: null, status: "contract_signed", approved_at: null, commercial_activated_at: null },
  };
}
export function enrollmentTestEvidence(snapshot = enrollmentTestSnapshot(), database = { database: "fixture", address: "127.0.0.1", port: 5433, role: "fixture" }, preservedBlankFields?: readonly ["whatsapp_phone"]) {
  const original = structuredClone(snapshot); original.contract.pdf_object_key = null; original.contract.evidence_hash = null;
  const asset = { requestedUrl: RECOVERY47_IMAGE_URLS[0], sourceUrl: RECOVERY47_IMAGE_URLS[0], sourceSha256: "4".repeat(64),
    normalizedSha256: sha256(Buffer.from(PNG, "base64")), dataUrl: `data:image/png;base64,${PNG}`, provenanceReceiptSha256: "" };
  const provenance = Buffer.from(JSON.stringify({ schemaVersion: 1, classification: "reconstructed_branding", ...asset,
    referenceSha256: "5".repeat(64), observedAt: "2026-11-25T18:00:00Z", operatorVerified: true }));
  asset.provenanceReceiptSha256 = sha256(provenance);
  const recovery: Recovery47Manifest = { schemaVersion: 1, target: RECOVERY47_TARGET, database, storageRoot: "/tmp/TEST-private-storage",
    inputSha256: recovery47InputDigest(original), workerIsolationReceiptSha256: "1".repeat(64),
    sourceFiles: Object.fromEntries(REQUIRED_RECOVERY_SOURCE_FILES.map(file => [file, "2".repeat(64)])),
    assetRecovery: { classification: "reconstructed_branding", assets: [asset] }, ...(preservedBlankFields ? { preservedBlankFields } : {}) };
  recovery.candidate = { pdfSha256: sha256(ENROLLMENT_TEST_PDF), evidenceHash: "3".repeat(64),
    renderedHtmlSha256: sha256(prepareRecovery47(original, recovery.inputSha256, recovery.assetRecovery, recovery.preservedBlankFields).bodyHtml), assetAuditSha256: "0".repeat(64) };
  const assetAudit = recovery47AssetAudit(recovery); recovery.candidate.assetAuditSha256 = sha256(assetAudit);
  const assetApproval = Buffer.from(JSON.stringify({ schemaVersion: 1, userApproved: true, decision: "approve_exact_recovered_rendition_for_contract47",
    target: RECOVERY47_TARGET, inputSha256: recovery.inputSha256, assetRecoverySha256: sha256(canonicalJson(recovery.assetRecovery)),
    candidate: recovery.candidate, ...(preservedBlankFields ? { preservedBlankFields } : {}), userDecisionEvidenceSha256: "6".repeat(64), recordedAt: "2026-11-25T18:00:00Z" }));
  recovery.assetApprovalReceiptSha256 = sha256(assetApproval);
  const recoveryManifest = Buffer.from(JSON.stringify(recovery));
  const manifest: Enrollment47Manifest = { schemaVersion: 1, target: RECOVERY47_TARGET, database, storageRoot: recovery.storageRoot,
    recipient: ENROLLMENT47_RECIPIENT, messageId: ENROLLMENT47_MESSAGE_ID, recoveryManifestSha256: sha256(recoveryManifest),
    postRecoveryInputSha256: recovery47InputDigest(snapshot), pdfObjectKey: snapshot.contract.pdf_object_key,
    pdfSha256: recovery.candidate.pdfSha256, evidenceHash: recovery.candidate.evidenceHash,
    operatorReceiptSha256: "0".repeat(64), sourceFiles: Object.fromEntries(ENROLLMENT47_SOURCE_FILES.map(file => [file, "7".repeat(64)])), email: enrollment47Email(true, preservedBlankFields !== undefined) };
  const receipt = { schemaVersion: 1, operatorVerified: true, enrollmentApproved: true, operation: "prepare_exact_recovered_test47_delivery",
    target: RECOVERY47_TARGET, database, recipient: manifest.recipient, messageId: manifest.messageId,
    postRecoveryInputSha256: manifest.postRecoveryInputSha256, recoveryManifestSha256: manifest.recoveryManifestSha256,
    pdfSha256: manifest.pdfSha256, evidenceHash: manifest.evidenceHash, emailSha256: manifest.email.sha256,
    sourceFilesSha256: sha256(canonicalJson(manifest.sourceFiles)), userDecisionEvidenceSha256: "8".repeat(64),
    recordedAt: new Date().toISOString(), instances: [{ id: "TEST-process", startedAt: "2026-11-25T00:00:00Z",
      durableMode: "prepare", legacyDeliveryEnabled: false, legacyPdfEnabled: false, smtpEnabled: false, inFlightContractJobs: 0 }] };
  const operatorReceipt = Buffer.from(JSON.stringify(receipt)); manifest.operatorReceiptSha256 = sha256(operatorReceipt);
  const evidence: Enrollment47Evidence = { recoveryManifest, pdf: ENROLLMENT_TEST_PDF, operatorReceipt, assetAudit, assetApproval, assetProvenance: [provenance] };
  return { manifest, evidence, recovery, receipt };
}

test("enrollment validates exact recovered artifact, original frozen input, disclosure and operator proof without mutations", () => {
  const snapshot = enrollmentTestSnapshot(), { manifest, evidence } = enrollmentTestEvidence(snapshot);
  const before = canonicalJson(snapshot);
  verifyEnrollment47(snapshot, manifest, evidence);
  assert.equal(canonicalJson(snapshot), before);
  assert.match(manifest.email.text, /historical logo image bytes have not been established/);
});
test("only prepare mode with explicit disabled SMTP and legacy workers is allowed", () => {
  assertEnrollment47Mode(ENROLLMENT_TEST_ENV);
  for (const field of Object.keys(ENROLLMENT_TEST_ENV)) for (const value of [undefined, "true", "send", "off"]) {
    assert.throws(() => assertEnrollment47Mode({ ...ENROLLMENT_TEST_ENV, [field]: value }), /prepare_only_required/);
  }
});
test("explicit reviewed blank WhatsApp is preserved in recovery and frozen email without inferring a number", () => {
  const snapshot = enrollmentTestSnapshot(true);
  snapshot.session.intake_data.phone = "+1 202 555 0147";
  const { manifest, evidence, recovery } = enrollmentTestEvidence(snapshot, undefined, ["whatsapp_phone"]);
  verifyEnrollment47(snapshot, manifest, evidence);
  assert.match(manifest.email.text, /original frozen WhatsApp value is absent and is preserved blank/);
  assert.match(manifest.email.html, /no telephone number has been inferred/);
  assert.doesNotMatch(manifest.email.text, /202 555/);
  assert.deepEqual(recovery.preservedBlankFields, ["whatsapp_phone"]);
  assert.throws(() => enrollmentTestEvidence(snapshot), /missing_frozen_fields:whatsapp_phone/);
});
test("blank WhatsApp disclosure cannot be omitted or falsely claimed even after rehashing approval content", () => {
  for (const preserve of [true, false]) {
    const snapshot = enrollmentTestSnapshot(preserve);
    const { manifest, evidence, receipt } = enrollmentTestEvidence(snapshot, undefined, preserve ? ["whatsapp_phone"] : undefined);
    manifest.email = enrollment47Email(true, !preserve);
    receipt.emailSha256 = manifest.email.sha256;
    evidence.operatorReceipt = Buffer.from(JSON.stringify(receipt)); manifest.operatorReceiptSha256 = sha256(evidence.operatorReceipt);
    assert.throws(() => verifyEnrollment47(snapshot, manifest, evidence), /disclosure_email_mismatch/);
  }
});
test("recovery approval must explicitly include the blank-field decision", () => {
  const snapshot = enrollmentTestSnapshot(true), { manifest, evidence, recovery, receipt } = enrollmentTestEvidence(snapshot, undefined, ["whatsapp_phone"]);
  const approval = JSON.parse(Buffer.from(evidence.assetApproval!).toString()); delete approval.preservedBlankFields;
  evidence.assetApproval = Buffer.from(JSON.stringify(approval)); recovery.assetApprovalReceiptSha256 = sha256(evidence.assetApproval);
  evidence.recoveryManifest = Buffer.from(JSON.stringify(recovery)); manifest.recoveryManifestSha256 = sha256(evidence.recoveryManifest);
  receipt.recoveryManifestSha256 = manifest.recoveryManifestSha256;
  evidence.operatorReceipt = Buffer.from(JSON.stringify(receipt)); manifest.operatorReceiptSha256 = sha256(evidence.operatorReceipt);
  assert.throws(() => verifyEnrollment47(snapshot, manifest, evidence), /asset_approval_invalid/);
});
test("exact test identity, reviewed source, file key and email cannot be broadened", () => {
  const { manifest } = enrollmentTestEvidence();
  for (const edit of [(m: any) => { m.target = { ...m.target, contractId: 48 }; }, (m: any) => { m.recipient = "another@example.invalid"; },
    (m: any) => { m.messageId = "<other@findandstudy.com>"; }, (m: any) => { m.sourceFiles = {}; },
    (m: any) => { m.pdfObjectKey = "/objects/private/signature.png"; }, (m: any) => { m.email.text += "changed"; }]) {
    const changed = structuredClone(manifest); edit(changed); assert.throws(() => validateEnrollment47Manifest(changed));
  }
});
test("changed source, already sent, active claim or missing PDF never enroll", () => {
  const original = enrollmentTestSnapshot(), { manifest, evidence } = enrollmentTestEvidence(original);
  for (const edit of [(s: any) => { s.contract.emailed_at = new Date().toISOString(); }, (s: any) => { s.contract.delivery_claimed_at = new Date().toISOString(); },
    (s: any) => { s.contract.pdf_object_key = null; }, (s: any) => { s.session.status = "revoked"; },
    (s: any) => { s.application.approved_agent_id = 999; }, (s: any) => { s.session.intake_data.companyName = "TEST changed"; }]) {
    const changed = structuredClone(original); edit(changed); assert.throws(() => verifyEnrollment47(changed, manifest, evidence));
  }
});
test("PDF, recovery manifest, sidecar, asset approval and provenance tampering deny", () => {
  const snapshot = enrollmentTestSnapshot(), { manifest, evidence } = enrollmentTestEvidence(snapshot);
  for (const key of ["pdf", "recoveryManifest", "assetAudit", "assetApproval", "operatorReceipt"] as const) {
    assert.throws(() => verifyEnrollment47(snapshot, manifest, { ...evidence, [key]: Buffer.from("TEST changed") }));
  }
  assert.throws(() => verifyEnrollment47(snapshot, manifest, { ...evidence, assetProvenance: [] }));
  assert.throws(() => verifyEnrollment47(snapshot, manifest, { ...evidence, assetAudit: undefined }));
});
test("fresh external operator receipt must prove no sending worker/inflight and exact reviewed source", () => {
  const { manifest, receipt } = enrollmentTestEvidence();
  for (const edit of [(r: any) => { r.recordedAt = "2000-01-01"; }, (r: any) => { r.instances[0].durableMode = "send"; },
    (r: any) => { r.instances[0].smtpEnabled = true; }, (r: any) => { r.instances[0].inFlightContractJobs = 1; },
    (r: any) => { r.sourceFilesSha256 = "0".repeat(64); }, (r: any) => { r.enrollmentApproved = false; }]) {
    const changed = structuredClone(receipt); edit(changed); const bytes = Buffer.from(JSON.stringify(changed));
    assert.throws(() => validateEnrollment47Operator(bytes, { ...manifest, operatorReceiptSha256: sha256(bytes) }));
  }
});
test("recomputed mail and operator hashes cannot remove reconstructed-branding disclosure", () => {
  const snapshot = enrollmentTestSnapshot(), { manifest, evidence, receipt } = enrollmentTestEvidence(snapshot);
  const changedEmail = { subject: "TEST Agreement", html: "<p>Original historical design.</p>", text: "Original historical design." };
  manifest.email = { ...changedEmail, sha256: sha256(canonicalJson(changedEmail)) };
  receipt.emailSha256 = manifest.email.sha256;
  evidence.operatorReceipt = Buffer.from(JSON.stringify(receipt)); manifest.operatorReceiptSha256 = sha256(evidence.operatorReceipt);
  assert.throws(() => verifyEnrollment47(snapshot, manifest, evidence), /disclosure_email_mismatch/);
});
test("approved post-snapshot hash cannot silently reset changed application approval to recovery-time state", () => {
  const snapshot = enrollmentTestSnapshot(), { manifest, evidence, receipt } = enrollmentTestEvidence(snapshot);
  snapshot.application.status = "approved";
  manifest.postRecoveryInputSha256 = recovery47InputDigest(snapshot); receipt.postRecoveryInputSha256 = manifest.postRecoveryInputSha256;
  evidence.operatorReceipt = Buffer.from(JSON.stringify(receipt)); manifest.operatorReceiptSha256 = sha256(evidence.operatorReceipt);
  assert.throws(() => verifyEnrollment47(snapshot, manifest, evidence), /input_digest_mismatch/);
});
test("executing CLI must be this reviewed source, not an attested decoy directory", async () => {
  const root = await realpath(fileURLToPath(new URL("../../../", import.meta.url)));
  await assert.rejects(assertEnrollment47Source(root, import.meta.url, enrollmentTestEvidence().manifest), /executing_source_mismatch/);
  await assert.rejects(assertEnrollment47Source(root, new URL("./enroll-contract47-delivery.ts", import.meta.url).href, enrollmentTestEvidence().manifest), /source_drift/);
});
