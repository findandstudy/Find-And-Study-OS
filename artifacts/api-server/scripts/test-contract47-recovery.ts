import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";
import {
  RECOVERY47_TARGET, REQUIRED_RECOVERY_SOURCE_FILES, canonicalJson, prepareRecovery47, recovery47InputDigest,
  sha256, validateRecovery47Manifest, validateRecovery47Pdf, readPinnedRecoveryFile, writeImmutableRecoveryFile,
  validateRecovery47WorkerReceipt,
  assertRecovery47ExecutingSource,
  RECOVERY47_IMAGE_URLS, recovery47AssetAudit, validateRecovery47AssetProvenance, validateRecovery47AssetApproval,
  applyRecovery47, type Recovery47Assets, type Recovery47Snapshot, type Recovery47Manifest,
} from "../src/lib/contract47Recovery";
import { signedContractDeliveryWorkerEnabled } from "../src/lib/signedContractDeliveryPolicy";

export const TEST_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
export function testSnapshot(): Recovery47Snapshot {
  return {
    contract: { id: 47, signing_session_id: 165, template_id: 48, agent_id: 902,
      subject_type: "agent_application", subject_id: 12, pdf_object_key: null, evidence_hash: null,
      delivery_claimed_at: null, emailed_at: null, signed_at: "2026-11-25T17:00:00.000Z",
      signer_email: "test02@example.invalid", signer_name: "TEST ACENTE 02", signer_ip: "192.0.2.2", signer_user_agent: "TEST",
      signature_image_base64: TEST_PNG, signature_image_object_key: null,
      email_verification_required: true, email_verification_method: "one_time_code", email_verified_at: "2026-11-25T16:00:00.000Z" },
    session: { id: 165, template_id: 48, agent_id: 902, subject_type: "agent_application", subject_id: 12,
      status: "signed", revoked_at: null, signed_at: "2026-11-25T17:00:00.000Z", signer_email: "test02@example.invalid",
      template_version_snapshot: 6, template_name_snapshot: "TEST Agreement", template_language_snapshot: "en",
      template_entity_type_snapshot: "company", template_intake_schema_snapshot: null,
      template_body_html_snapshot: '<style>.box{color:#123456}</style><p class="box">{{agency_name}} {{signer_name}} {{contract_number}}</p><img src="{{signature}}"><img src="{{main_agency_signature}}">',
      template_signing_page_config_snapshot: { companySignatureDataUrl: `data:image/png;base64,${TEST_PNG}`, requireEmailVerification: true },
      intake_data: { companyName: "TEST synthetic company" } },
    application: { id: 12, signing_session_id: 165, signed_contract_id: 47, contract_template_id: 48,
      provisional_agent_id: 902, approved_agent_id: null, status: "contract_signed", approved_at: null, commercial_activated_at: null },
  };
}
export function testManifest(snapshot = testSnapshot()): Recovery47Manifest {
  return { schemaVersion: 1, target: RECOVERY47_TARGET, database: { database: "test47", address: "127.0.0.1", port: 5433, role: "test47" },
    storageRoot: "/tmp/test-contract47-storage",
    inputSha256: recovery47InputDigest(snapshot), workerIsolationReceiptSha256: "1".repeat(64),
    sourceFiles: Object.fromEntries(REQUIRED_RECOVERY_SOURCE_FILES.map(file => [file, "2".repeat(64)])) };
}

export function testRecoveryAssets(classification: Recovery47Assets["classification"] = "reconstructed_branding") {
  const provenanceReceipts: Buffer[] = [];
  const assets = RECOVERY47_IMAGE_URLS.map((requestedUrl, index) => {
    const asset = { requestedUrl, sourceUrl: classification === "verified_historical_assets" ? requestedUrl
      : `https://www.findandstudy.com/wp-content/uploads/2026/01/TEST-brand-${index}.png`,
      sourceSha256: sha256(Buffer.from(TEST_PNG, "base64")), normalizedSha256: sha256(Buffer.from(TEST_PNG, "base64")),
      dataUrl: `data:image/png;base64,${TEST_PNG}`, provenanceReceiptSha256: "" };
    const receipt = Buffer.from(canonicalJson({ schemaVersion: 1, classification, requestedUrl,
      sourceUrl: asset.sourceUrl, sourceSha256: asset.sourceSha256, normalizedSha256: asset.normalizedSha256,
      referenceSha256: "b".repeat(64), observedAt: "2026-11-26T10:00:00Z", operatorVerified: true }));
    asset.provenanceReceiptSha256 = sha256(receipt); provenanceReceipts.push(receipt);
    return asset;
  });
  return { assetRecovery: { classification, assets } as Recovery47Assets, provenanceReceipts };
}
export function testRecoverySnapshotWithImages() {
  const snapshot = testSnapshot();
  snapshot.session.template_signing_page_config_snapshot.logoUrl = RECOVERY47_IMAGE_URLS[0];
  snapshot.session.template_body_html_snapshot += `<img class="TEST-frozen-logo" src="${RECOVERY47_IMAGE_URLS[1]}"><a href="${RECOVERY47_IMAGE_URLS[1]}">TEST unchanged link</a>`;
  return snapshot;
}
export function testAssetApproval(manifest: Recovery47Manifest) {
  return Buffer.from(canonicalJson({ schemaVersion: 1, userApproved: true,
    decision: "approve_exact_recovered_rendition_for_contract47", target: RECOVERY47_TARGET,
    inputSha256: manifest.inputSha256, assetRecoverySha256: sha256(canonicalJson(manifest.assetRecovery)),
    ...(manifest.preservedBlankFields ? { preservedBlankFields: manifest.preservedBlankFields } : {}),
    candidate: manifest.candidate, userDecisionEvidenceSha256: "c".repeat(64), recordedAt: "2026-11-26T11:00:00Z" }));
}

test("reconstructed preview maps exact two logos only and visibly discloses non-original branding", () => {
  const snapshot = testRecoverySnapshotWithImages(); const before = canonicalJson(snapshot);
  const { assetRecovery, provenanceReceipts } = testRecoveryAssets();
  const params = prepareRecovery47(snapshot, recovery47InputDigest(snapshot), assetRecovery);
  assert.match(params.bodyHtml, /Recovered TEST02 copy/);
  assert.match(params.bodyHtml, /not the original signing-time PDF artifact/);
  assert.match(params.bodyHtml, /TEST synthetic company TEST ACENTE 02 FAS-2026-00165/);
  assert.match(params.bodyHtml, /#123456/);
  assert.match(params.bodyHtml, new RegExp(`href="${RECOVERY47_IMAGE_URLS[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  assert.equal((params.bodyHtml.match(/data:image\/png;base64,/g) ?? []).length, 4);
  assert.equal(canonicalJson(snapshot), before);
  provenanceReceipts.forEach((receipt, i) => validateRecovery47AssetProvenance(receipt, assetRecovery, i));
  const historical = prepareRecovery47(snapshot, recovery47InputDigest(snapshot), testRecoveryAssets("verified_historical_assets").assetRecovery);
  assert.doesNotMatch(historical.bodyHtml, /data-recovery47-notice|Recovered TEST02 copy/);
  assert.doesNotMatch(prepareRecovery47(testSnapshot(), recovery47InputDigest(testSnapshot())).bodyHtml, /data-recovery47-notice/);
});

test("variable scanner ignores HTML/CSS comments but rejects unresolved rendered text, attributes and CSS content", () => {
  const snapshot = testSnapshot();
  snapshot.session.template_body_html_snapshot += '<!-- {{unused_comment}} --><style>/* PDF render must keep <img src="{{...}}"> */ .a {color:red; /* {{css_comment}} */}</style><p style="color:blue; /* {{inline_comment}} */">TEST text preserved</p>';
  const before = canonicalJson(snapshot);
  const result = prepareRecovery47(snapshot, recovery47InputDigest(snapshot));
  assert.match(result.bodyHtml, /TEST text preserved/);
  assert.equal(canonicalJson(snapshot), before);
  for (const suffix of ['<p>/* {{missing_field}} */</p>', '<img alt="{{missing_field}}" src="{{signature}}">',
    '<style>.a::before {content:"/* {{missing_field}} */"}</style>', '<p style="--test: \u0027/* {{missing_field}} */\u0027">TEST</p>',
    '<style>.a::before{content: \\/\\* {{missing_field}} *\\/}</style>']) {
    const bad = structuredClone(snapshot); bad.session.template_body_html_snapshot += suffix;
    assert.throws(() => prepareRecovery47(bad, recovery47InputDigest(bad)), /missing_frozen_fields:missing_field/);
  }
});

test("only explicit absent WhatsApp preservation renders blank; no phone alias or frozen value is substituted", () => {
  const snapshot = testRecoverySnapshotWithImages();
  snapshot.session.template_body_html_snapshot += '<p id="test-whatsapp">WhatsApp: {{whatsapp_phone}}</p>';
  snapshot.session.intake_data = { ...snapshot.session.intake_data, agencyPhone: "+12025550123", agency_phone: "+12025550124", phone: "+12025550125" };
  const before = canonicalJson(snapshot), digest = recovery47InputDigest(snapshot), { assetRecovery } = testRecoveryAssets();
  assert.throws(() => prepareRecovery47(snapshot, digest, assetRecovery), /missing_frozen_fields:whatsapp_phone/);
  const rendered = prepareRecovery47(snapshot, digest, assetRecovery, ["whatsapp_phone"]);
  assert.match(rendered.bodyHtml, /id="test-whatsapp">WhatsApp: <\/p>/);
  assert.match(rendered.bodyHtml, /WhatsApp value is absent and is preserved blank/);
  assert.doesNotMatch(rendered.bodyHtml, /1202555012[345]/);
  assert.equal((rendered.bodyHtml.match(/data:image\/png;base64,/g) ?? []).length, 4);
  assert.equal(canonicalJson(snapshot), before);
  for (const value of [["phone"], [], ["whatsapp_phone", "phone"], ["whatsapp_phone", "whatsapp_phone"]]) {
    assert.throws(() => prepareRecovery47(snapshot, digest, assetRecovery, value as any), /preserved_blank_fields_invalid/);
  }
  assert.throws(() => prepareRecovery47(snapshot, digest, testRecoveryAssets("verified_historical_assets").assetRecovery, ["whatsapp_phone"]), /preserved_blank_fields_invalid/);
  const noField = testRecoverySnapshotWithImages();
  assert.throws(() => prepareRecovery47(noField, recovery47InputDigest(noField), assetRecovery, ["whatsapp_phone"]), /unused_preserved_blank_field/);
  for (const [key, value] of [["whatsapp_phone", "+12025550126"], ["whatsappPhone", "+12025550127"], ["whatsapp_phone", {}], ["whatsappPhone", false]] as const) {
    const supplied = structuredClone(snapshot); supplied.session.intake_data[key] = value;
    assert.throws(() => prepareRecovery47(supplied, recovery47InputDigest(supplied), assetRecovery, ["whatsapp_phone"]), /preserved_blank_has_frozen_value/);
  }
  const otherMissing = structuredClone(snapshot); otherMissing.session.template_body_html_snapshot += '{{tax_number}}';
  assert.throws(() => prepareRecovery47(otherMissing, recovery47InputDigest(otherMissing), assetRecovery, ["whatsapp_phone"]), /missing_frozen_fields:tax_number/);
});

test("explicit blank field selection changes audit and requires its own exact candidate approval", () => {
  const snapshot = testRecoverySnapshotWithImages();
  snapshot.session.template_body_html_snapshot += '<p>WhatsApp: {{whatsapp_phone}}</p>';
  const { assetRecovery } = testRecoveryAssets();
  const manifest: Recovery47Manifest = { ...testManifest(snapshot), assetRecovery, preservedBlankFields: ["whatsapp_phone"],
    candidate: { pdfSha256: "a".repeat(64), evidenceHash: "b".repeat(64), renderedHtmlSha256: sha256(prepareRecovery47(snapshot, recovery47InputDigest(snapshot), assetRecovery, ["whatsapp_phone"]).bodyHtml) } };
  manifest.candidate!.assetAuditSha256 = sha256(recovery47AssetAudit(manifest));
  validateRecovery47Manifest(manifest);
  assert.deepEqual(JSON.parse(recovery47AssetAudit(manifest).toString()).preservedBlankFields, ["whatsapp_phone"]);
  const approval = testAssetApproval(manifest); manifest.assetApprovalReceiptSha256 = sha256(approval);
  validateRecovery47AssetApproval(approval, manifest);
  const changed = structuredClone(manifest); delete changed.preservedBlankFields;
  assert.throws(() => validateRecovery47Manifest(changed), /asset_audit_digest_mismatch/);
  assert.throws(() => validateRecovery47AssetApproval(approval, changed), /asset_approval_invalid/);
  const receipt = JSON.parse(approval.toString()); delete receipt.preservedBlankFields;
  const bytes = Buffer.from(canonicalJson(receipt));
  assert.throws(() => validateRecovery47AssetApproval(bytes, { ...manifest, assetApprovalReceiptSha256: sha256(bytes) }), /asset_approval_invalid/);
});

test("asset mapping never widens external URLs or accepts duplicate, unused, wrong bytes or fake original mapping", () => {
  const snapshot = testRecoverySnapshotWithImages();
  const run = (assets: Recovery47Assets) => prepareRecovery47(snapshot, recovery47InputDigest(snapshot), assets);
  assert.throws(() => prepareRecovery47(snapshot, recovery47InputDigest(snapshot)), /unfrozen_image_source/);
  for (const change of [
    (v: Recovery47Assets) => { v.assets[0].requestedUrl = "https://example.invalid/logo.png"; },
    (v: Recovery47Assets) => { v.assets[1].requestedUrl = v.assets[0].requestedUrl; },
    (v: Recovery47Assets) => { v.assets[0].dataUrl = `data:image/png;base64,${TEST_PNG.slice(4)}`; },
    (v: Recovery47Assets) => { v.assets[0].normalizedSha256 = "0".repeat(64); },
    (v: Recovery47Assets) => { v.assets[0].sourceUrl = "https://www.findandstudy.com@private.invalid/test.png"; },
    (v: Recovery47Assets) => { v.classification = "verified_historical_assets"; },
  ]) { const { assetRecovery } = testRecoveryAssets(); change(assetRecovery); assert.throws(() => run(assetRecovery), /asset_manifest_invalid/); }
  const { assetRecovery } = testRecoveryAssets(); assetRecovery.assets.pop();
  assert.throws(() => run(assetRecovery), /unfrozen_image_source/);
  assert.throws(() => prepareRecovery47(testSnapshot(), recovery47InputDigest(testSnapshot()), testRecoveryAssets().assetRecovery), /unused_asset_mapping/);
});

test("audit and user decision bind exact candidate, input, assets and provenance, not just a boolean", async () => {
  const snapshot = testRecoverySnapshotWithImages(); const { assetRecovery, provenanceReceipts } = testRecoveryAssets();
  const pdf = Buffer.from(`%PDF-1.7\n${"TEST ".repeat(30)}`);
  const manifest: Recovery47Manifest = { ...testManifest(snapshot), assetRecovery, candidate: { pdfSha256: sha256(pdf), evidenceHash: "e".repeat(64),
    renderedHtmlSha256: sha256(prepareRecovery47(snapshot, recovery47InputDigest(snapshot), assetRecovery).bodyHtml) } };
  manifest.candidate!.assetAuditSha256 = sha256(recovery47AssetAudit(manifest));
  validateRecovery47Manifest(manifest);
  assert.match(recovery47AssetAudit(manifest).toString(), /historical image bytes are not established/);
  const approvalReceipt = testAssetApproval(manifest); manifest.assetApprovalReceiptSha256 = sha256(approvalReceipt);
  validateRecovery47AssetApproval(approvalReceipt, manifest);
  for (const change of [
    (v: any) => { v.userApproved = false; }, (v: any) => { v.target.contractId = 48; },
    (v: any) => { v.inputSha256 = "0".repeat(64); }, (v: any) => { v.candidate.pdfSha256 = "0".repeat(64); },
    (v: any) => { v.assetRecoverySha256 = "0".repeat(64); },
  ]) { const changed = JSON.parse(approvalReceipt.toString()); change(changed); const bytes = Buffer.from(canonicalJson(changed));
    assert.throws(() => validateRecovery47AssetApproval(bytes, { ...manifest, assetApprovalReceiptSha256: sha256(bytes) }), /asset_approval_invalid/); }
  const noQueries = { query: async () => { throw new Error("must fail before DB"); } };
  await assert.rejects(applyRecovery47(noQueries, manifest, pdf, async () => "never"), /asset_approval_required/);
  const wrong = Buffer.from(provenanceReceipts[0]); wrong[0] = 0;
  assert.throws(() => validateRecovery47AssetProvenance(wrong, assetRecovery, 0), /asset_provenance_digest_mismatch/);
  const changed = structuredClone(manifest); changed.assetRecovery!.assets[0].provenanceReceiptSha256 = "a".repeat(64);
  assert.throws(() => validateRecovery47Manifest(changed), /asset_audit_digest_mismatch/);
  await assert.rejects(applyRecovery47(noQueries, manifest, pdf, async () => "never", {
    provenanceReceipts, approvalReceipt: Buffer.from("{}"), installAudit: async () => "never",
  }), /asset_approval_required/);
});

test("delivery emergency stop preserves unset policy and denies false/invalid values", () => {
  const old = process.env.SIGNED_CONTRACT_DELIVERY_ENABLED;
  delete process.env.SIGNED_CONTRACT_DELIVERY_ENABLED;
  try {
    assert.equal(signedContractDeliveryWorkerEnabled(), true);
    assert.equal(signedContractDeliveryWorkerEnabled("true"), true);
    for (const invalid of ["false", "FALSE", "0", "", "yes"]) assert.equal(signedContractDeliveryWorkerEnabled(invalid), false);
  } finally { if (old === undefined) delete process.env.SIGNED_CONTRACT_DELIVERY_ENABLED; else process.env.SIGNED_CONTRACT_DELIVERY_ENABLED = old; }
});

test("disabled delivery and PDF workers make no query, provider, timer or notification call", async () => {
  const source = await readFile(new URL("../src/lib/signedContractDelivery.ts", import.meta.url), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: Record<string, any> = {};
  const forbiddenCall = () => { throw new Error("disabled worker performed a side effect"); };
  const fakeRequire = (name: string) => {
    if (name === "./signedContractDeliveryPolicy") return { signedContractDeliveryWorkerEnabled: () => false };
    if (name === "@workspace/db") return { db: new Proxy({}, { get: () => forbiddenCall }) };
    return new Proxy({}, { get: () => forbiddenCall });
  };
  vm.runInNewContext(js, { exports, require: fakeRequire, process: { env: { SIGNED_CONTRACT_PDF_WORKER_ENABLED: "false" } },
    console: { log: forbiddenCall, warn: forbiddenCall, error: forbiddenCall }, setTimeout: forbiddenCall, setInterval: forbiddenCall });
  await exports.deliverPendingSignedContracts();
  await exports.backfillMissingSignedPdfs();
  await exports.generatePendingSignedContractPdfs();
  assert.equal(typeof exports.startSignedContractDeliveryWorker(), "function");
  assert.equal(typeof exports.startSignedContractPdfWorker(), "function");
});

test("exact frozen TEST02 renders with original signatures, CSS and canonical number", () => {
  const snapshot = testSnapshot();
  const before = canonicalJson(snapshot);
  const params = prepareRecovery47(snapshot, recovery47InputDigest(snapshot));
  assert.match(params.bodyHtml, /TEST synthetic company/);
  assert.match(params.bodyHtml, /FAS-2026-00165/);
  assert.match(params.bodyHtml, /#123456/);
  assert.equal((params.bodyHtml.match(/data:image\/png;base64,/g) ?? []).length, 2);
  assert.equal(canonicalJson(snapshot), before);
});

const forbidden: [string, (s: Recovery47Snapshot) => void, RegExp][] = [
  ["other record", s => { s.contract.id = 48; }, /target_relationship/],
  ["other application", s => { s.session.subject_id = 13; }, /target_relationship/],
  ["application no longer links contract", s => { s.application.signed_contract_id = 46; }, /target_relationship/],
  ["existing PDF", s => { s.contract.pdf_object_key = "/objects/final.pdf"; }, /final_artifact/],
  ["existing evidence only", s => { s.contract.evidence_hash = "3".repeat(64); }, /final_artifact/],
  ["lease even if old", s => { s.contract.delivery_claimed_at = "2020-01-01T00:00:00Z"; }, /lease_not_empty/],
  ["already emailed", s => { s.contract.emailed_at = "2026-11-25T17:10:00Z"; }, /already_delivered/],
  ["non-test signer", s => { s.contract.signer_name = "Real Person"; }, /not_signed_test/],
  ["revoked session", s => { s.session.revoked_at = "2026-11-25T17:10:00Z"; }, /not_signed_test/],
  ["missing frozen HTML", s => { s.session.template_body_html_snapshot = null; }, /frozen_template/],
  ["missing frozen company signature", s => { s.session.template_signing_page_config_snapshot = {}; }, /frozen_company_signature/],
  ["object-only original signature", s => { s.contract.signature_image_base64 = null; s.contract.signature_image_object_key = "/objects/signature.png"; }, /original_signature_missing/],
  ["missing frozen verification policy", s => { s.contract.email_verification_required = null; }, /frozen_email_policy/],
  ["verification after signature", s => { s.contract.email_verified_at = "2027-01-01T00:00:00Z"; }, /verification_after/],
  ["missing field cannot read mutable agent", s => { s.session.template_body_html_snapshot += "{{agent.taxNumber}}"; }, /missing_frozen_fields:agent.taxNumber/],
  ["prototype field", s => { s.session.template_body_html_snapshot += "{{constructor}}"; }, /missing_frozen_fields:constructor/],
  ["historical external logo without frozen bytes", s => { s.session.template_signing_page_config_snapshot.logoUrl = "https://example.invalid/logo.png"; }, /unfrozen_image_source/],
];
for (const [name, mutate, error] of forbidden) test(`recovery fails closed: ${name}`, () => {
  const snapshot = testSnapshot(); mutate(snapshot);
  assert.throws(() => prepareRecovery47(snapshot, recovery47InputDigest(snapshot)), error);
});

test("changed intake or original signature invalidates approved digest", () => {
  const snapshot = testSnapshot(); const digest = recovery47InputDigest(snapshot);
  snapshot.session.intake_data.companyName = "TEST changed";
  assert.throws(() => prepareRecovery47(snapshot, digest), /input_digest_mismatch/);
});

test("manifest binds target, source and database identity", () => {
  validateRecovery47Manifest(testManifest());
  const manifest = testManifest(); delete manifest.sourceFiles[REQUIRED_RECOVERY_SOURCE_FILES[0]];
  assert.throws(() => validateRecovery47Manifest(manifest), /source_attestation/);
  assert.throws(() => validateRecovery47Manifest({ ...testManifest(), target: { ...RECOVERY47_TARGET, contractId: 99 } }), /target_mismatch/);
});

test("source attestation binds executing CLI and imported helper to reviewed checkout", async () => {
  const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  await assertRecovery47ExecutingSource(sourceRoot, new URL("./recover-contract47.ts", import.meta.url).href);
  await assert.rejects(assertRecovery47ExecutingSource(sourceRoot, import.meta.url), /executing_source_mismatch/);
  const other = await mkdtemp(path.join(tmpdir(), "fas-wrong-source-"));
  try {
    await assert.rejects(assertRecovery47ExecutingSource(await realpath(other), new URL("./recover-contract47.ts", import.meta.url).href), /executing_source_mismatch/);
  } finally { await rm(other, { recursive: true, force: true }); }
});

test("candidate exact bytes required", () => {
  const bytes = Buffer.from(`%PDF-1.7\n${"TEST ".repeat(30)}`);
  validateRecovery47Pdf(bytes, sha256(bytes));
  assert.throws(() => validateRecovery47Pdf(bytes, "0".repeat(64)), /candidate_pdf_mismatch/);
});

test("worker isolation receipt binds actual operator evidence, target, source and time", () => {
  const manifest = testManifest();
  const now = Date.parse("2026-11-25T18:00:00Z");
  const receipt = { schemaVersion: 1, operatorVerified: true, target: RECOVERY47_TARGET, database: manifest.database,
    sourceFilesSha256: sha256(canonicalJson(manifest.sourceFiles)), recordedAt: "2026-11-25T17:55:00Z",
    otherContractRenderersDisabled: true, instances: [{ id: "TEST-container-123:pid456", startedAt: "2026-11-25T17:30:00Z",
      contractDeliveryEnabled: false, contractPdfWorkerEnabled: false, inFlightContractJobs: 0 }] };
  const bytes = Buffer.from(canonicalJson(receipt)); manifest.workerIsolationReceiptSha256 = sha256(bytes);
  validateRecovery47WorkerReceipt(bytes, manifest, now);
  assert.throws(() => validateRecovery47WorkerReceipt(Buffer.from("{}"), manifest, now), /worker_receipt_digest_mismatch/);
  assert.throws(() => validateRecovery47WorkerReceipt(bytes, manifest, now + 70 * 60_000), /worker_isolation_unproven/);
  for (const change of [
    (v: any) => { v.instances[0].contractDeliveryEnabled = true; },
    (v: any) => { v.instances[0].inFlightContractJobs = 1; },
    (v: any) => { v.sourceFilesSha256 = "0".repeat(64); },
    (v: any) => { v.database.database = "other"; },
    (v: any) => { v.otherContractRenderersDisabled = false; },
  ]) {
    const changed = structuredClone(receipt); change(changed);
    const raw = Buffer.from(canonicalJson(changed));
    assert.throws(() => validateRecovery47WorkerReceipt(raw, { ...manifest, workerIsolationReceiptSha256: sha256(raw) }, now), /worker_isolation_unproven/);
  }
});

test("private artifact adapter fails closed outside Linux", { skip: process.platform === "linux" }, async () => {
  await assert.rejects(writeImmutableRecoveryFile(path.join(tmpdir(), "unused"), "test.pdf", Buffer.from("TEST")), /linux_fd_validation/);
});

test("Linux immutable candidate retries exact bytes, rejects overwrite and private symlinks", { skip: process.platform !== "linux" }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "fas-recovery47-"));
  await chmod(directory, 0o700);
  try {
    const bytes = Buffer.from("TEST synthetic artifact");
    const file = await writeImmutableRecoveryFile(directory, "test.pdf", bytes);
    assert.deepEqual(await readPinnedRecoveryFile(file), bytes);
    assert.equal(await writeImmutableRecoveryFile(directory, "test.pdf", bytes), file);
    await assert.rejects(writeImmutableRecoveryFile(directory, "test.pdf", Buffer.from("different")), /immutable_artifact_collision/);
    await symlink(file, path.join(directory, "link.pdf"));
    await assert.rejects(readPinnedRecoveryFile(path.join(directory, "link.pdf")));
    const nested = path.join(directory, "nested"); await mkdir(nested, { mode: 0o700 });
    const alias = path.join(directory, "alias"); await symlink(nested, alias);
    await assert.rejects(writeImmutableRecoveryFile(alias, "private.pdf", bytes), /directory_chain_invalid/);
    assert.equal((await readFile(file)).toString(), bytes.toString());
  } finally { await rm(directory, { recursive: true, force: true }); }
});
