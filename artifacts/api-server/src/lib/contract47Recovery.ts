/**
 * Operator-only recovery of the existing TEST02 signature. No runtime route or
 * worker imports this module. It never signs, sends, approves or repairs other
 * records. Missing historical input is a blocker, not a fallback opportunity.
 */
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { buildAgentContext, buildFinalSignedContractHtml, contractNumber } from "./contractRenderer";
import { sanitizeContractBranding, validateCompanySignatureDataUrl } from "./contractBranding";
import { validateContractLogoSnapshot } from "./contractPdfAssets";

export const RECOVERY47_TARGET = Object.freeze({ contractId: 47, sessionId: 165, templateId: 48, applicationId: 12 });
const HEX = /^[a-f0-9]{64}$/;
const MAX_PDF = 10 * 1024 * 1024;
function FAIL(code: string): never { throw new Error(`recovery47:${code}`); }
export const sha256 = (bytes: string | Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/** The reviewed tree must be the code executing this command, not a decoy. */
export async function assertRecovery47ExecutingSource(sourceRoot: string, scriptUrl: string): Promise<void> {
  const root = await realpath(sourceRoot);
  if (root !== sourceRoot) FAIL("source_root_must_be_canonical");
  const [script, helper] = await Promise.all([realpath(fileURLToPath(scriptUrl)), realpath(fileURLToPath(import.meta.url))]);
  if (script !== path.join(root, "artifacts/api-server/scripts/recover-contract47.ts")
    || helper !== path.join(root, "artifacts/api-server/src/lib/contract47Recovery.ts")) FAIL("executing_source_mismatch");
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson((value as any)[key])}`).join(",")}}`;
  }
  return FAIL("non_json_input");
}

export interface Recovery47Snapshot {
  contract: Record<string, any>;
  session: Record<string, any>;
  application: Record<string, any>;
}
export interface Recovery47Identity { database: string; address: string; port: number; role: string }
export interface Recovery47SqlClient {
  query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }>;
}
export interface Recovery47Manifest {
  schemaVersion: 1;
  target: typeof RECOVERY47_TARGET;
  database: Recovery47Identity;
  storageRoot: string;
  inputSha256: string;
  sourceFiles: Record<string, string>;
  workerIsolationReceiptSha256: string;
  assetRecovery?: Recovery47Assets;
  preservedBlankFields?: readonly ["whatsapp_phone"];
  assetApprovalReceiptSha256?: string;
  candidate?: { pdfSha256: string; evidenceHash: string; renderedHtmlSha256: string; assetAuditSha256?: string };
}

// These are the two missing public brand images in session165, not a general
// asset adapter. Signatures, arbitrary URLs and other historical records are
// outside this operator-only recovery contract.
export const RECOVERY47_IMAGE_URLS = Object.freeze([
  "https://www.findandstudy.com/wp-content/uploads/2025/10/logotest-scaled.png",
  "https://www.findandstudy.com/wp-content/uploads/2024/12/Find-and-study-logo-wht-scaled.webp",
]);
export interface Recovery47Assets {
  classification: "verified_historical_assets" | "reconstructed_branding";
  assets: Array<{ requestedUrl: string; sourceUrl: string; sourceSha256: string;
    normalizedSha256: string; dataUrl: string; provenanceReceiptSha256: string }>;
}
function publicAssetUrl(value: unknown): boolean {
  if (typeof value !== "string" || value.length > 2000) return false;
  try { const u = new URL(value); return u.protocol === "https:" && u.hostname === "www.findandstudy.com"
    && u.pathname.startsWith("/wp-content/uploads/") && !u.username && !u.password && !u.port
    && !u.search && !u.hash && u.href === value; } catch { return false; }
}
function validateRecovery47Assets(value: Recovery47Assets): void {
  if (!value || !["verified_historical_assets", "reconstructed_branding"].includes(value.classification)
    || !Array.isArray(value.assets) || value.assets.length < 1 || value.assets.length > 2) FAIL("asset_manifest_invalid");
  const seen = new Set<string>();
  for (const asset of value.assets) {
    if (!asset || !RECOVERY47_IMAGE_URLS.includes(asset.requestedUrl) || seen.has(asset.requestedUrl)
      || !publicAssetUrl(asset.sourceUrl) || !HEX.test(asset.sourceSha256)
      || !HEX.test(asset.normalizedSha256) || !HEX.test(asset.provenanceReceiptSha256)
      || !validateContractLogoSnapshot({ sourceUrl: asset.requestedUrl, dataUrl: asset.dataUrl,
        sha256: asset.normalizedSha256 }, asset.requestedUrl)
      || (value.classification === "verified_historical_assets" && asset.sourceUrl !== asset.requestedUrl)) FAIL("asset_manifest_invalid");
    seen.add(asset.requestedUrl);
  }
}

function validatePreservedBlankFields(value: unknown, assets?: Recovery47Assets): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length !== 1 || value[0] !== "whatsapp_phone"
    || assets?.classification !== "reconstructed_branding") FAIL("preserved_blank_fields_invalid");
  return value;
}

/** A reviewed operator provenance receipt is an attestation, not proof that a
 * current remote URL returned these bytes at signing time. Reconstruction is
 * permanently labelled as such; neither this helper nor the CLI fetches URLs. */
export function validateRecovery47AssetProvenance(raw: Uint8Array, assets: Recovery47Assets, index: number): void {
  validateRecovery47Assets(assets);
  const asset = assets.assets[index];
  if (!asset || sha256(raw) !== asset.provenanceReceiptSha256) FAIL("asset_provenance_digest_mismatch");
  let receipt: any;
  try { receipt = JSON.parse(Buffer.from(raw).toString("utf8")); } catch { FAIL("asset_provenance_invalid"); }
  if (receipt.schemaVersion !== 1 || receipt.classification !== assets.classification
    || receipt.requestedUrl !== asset.requestedUrl || receipt.sourceUrl !== asset.sourceUrl
    || receipt.sourceSha256 !== asset.sourceSha256 || receipt.normalizedSha256 !== asset.normalizedSha256
    || !HEX.test(receipt.referenceSha256) || !Number.isFinite(Date.parse(receipt.observedAt))
    || receipt.operatorVerified !== true) FAIL("asset_provenance_invalid");
}

/** Sidecar describes the recovered rendition. It does not change signed rows,
 * original signature evidence or claim that substituted branding is original. */
export function recovery47AssetAudit(manifest: Pick<Recovery47Manifest, "inputSha256" | "sourceFiles" | "assetRecovery" | "candidate" | "preservedBlankFields">): Buffer {
  if (!manifest.assetRecovery || !manifest.candidate) FAIL("asset_audit_requires_candidate");
  validateRecovery47Assets(manifest.assetRecovery);
  validatePreservedBlankFields(manifest.preservedBlankFields, manifest.assetRecovery);
  return Buffer.from(`${canonicalJson({ schemaVersion: 1, target: RECOVERY47_TARGET,
    inputSha256: manifest.inputSha256, classification: manifest.assetRecovery.classification,
    rendition: manifest.assetRecovery.classification === "reconstructed_branding"
      ? "Reconstructed branding rendition; historical image bytes are not established."
      : "Historical assets restored using separately reviewed provenance.",
    assets: manifest.assetRecovery.assets.map(({ dataUrl: _dataUrl, ...asset }) => asset),
    ...(manifest.preservedBlankFields ? { preservedBlankFields: manifest.preservedBlankFields } : {}),
    sourceFilesSha256: sha256(canonicalJson(manifest.sourceFiles)),
    pdfSha256: manifest.candidate.pdfSha256, evidenceHash: manifest.candidate.evidenceHash,
    renderedHtmlSha256: manifest.candidate.renderedHtmlSha256 })}\n`);
}

export function validateRecovery47AssetApproval(raw: Uint8Array, manifest: Recovery47Manifest): void {
  if (!manifest.assetRecovery || !manifest.candidate || !manifest.assetApprovalReceiptSha256
    || sha256(raw) !== manifest.assetApprovalReceiptSha256) FAIL("asset_approval_required");
  let receipt: any;
  try { receipt = JSON.parse(Buffer.from(raw).toString("utf8")); } catch { FAIL("asset_approval_invalid"); }
  if (receipt.schemaVersion !== 1 || receipt.userApproved !== true
    || receipt.decision !== "approve_exact_recovered_rendition_for_contract47"
    || canonicalJson(receipt.target) !== canonicalJson(RECOVERY47_TARGET)
    || receipt.inputSha256 !== manifest.inputSha256
    || receipt.assetRecoverySha256 !== sha256(canonicalJson(manifest.assetRecovery))
    || canonicalJson(receipt.preservedBlankFields ?? null) !== canonicalJson(manifest.preservedBlankFields ?? null)
    || canonicalJson(receipt.candidate) !== canonicalJson(manifest.candidate)
    || !HEX.test(receipt.userDecisionEvidenceSha256) || !Number.isFinite(Date.parse(receipt.recordedAt))) FAIL("asset_approval_invalid");
}

export const REQUIRED_RECOVERY_SOURCE_FILES = [
  "artifacts/api-server/src/lib/contract47Recovery.ts",
  "artifacts/api-server/scripts/recover-contract47.ts",
  "artifacts/api-server/src/lib/contractRenderer.ts",
  "artifacts/api-server/src/lib/contractPdf.ts",
  "artifacts/api-server/src/lib/contractBranding.ts",
  "artifacts/api-server/src/lib/contractHtmlSanitizer.ts",
  "artifacts/api-server/src/lib/contractPdfAssets.ts",
  "artifacts/api-server/src/lib/documentByteLimits.ts",
  "artifacts/api-server/src/lib/safeOutboundRequest.ts",
  "artifacts/api-server/src/lib/mainAgencySignature.ts",
  "artifacts/api-server/src/lib/signedContractDelivery.ts",
  "artifacts/api-server/src/lib/signedContractDeliveryPolicy.ts",
  "artifacts/api-server/package.json",
  "lib/db/package.json",
  "pnpm-lock.yaml",
] as const;

export function validateRecovery47Manifest(value: unknown): asserts value is Recovery47Manifest {
  const v = value as Recovery47Manifest;
  if (!v || v.schemaVersion !== 1 || canonicalJson(v.target) !== canonicalJson(RECOVERY47_TARGET)) FAIL("target_mismatch");
  if (!v.database || !v.database.database || !v.database.address || !v.database.role
    || !Number.isInteger(v.database.port) || v.database.port < 1 || v.database.port > 65535) FAIL("identity_missing");
  if (typeof v.storageRoot !== "string" || !v.storageRoot.startsWith("/") || v.storageRoot.endsWith("/")
    || v.storageRoot.split("/").some((part, index) => index > 0 && (!part || part === "." || part === ".."))) FAIL("storage_identity_missing");
  if (!HEX.test(v.inputSha256) || !HEX.test(v.workerIsolationReceiptSha256)) FAIL("approval_digest_missing");
  if (!v.sourceFiles || REQUIRED_RECOVERY_SOURCE_FILES.some(file => !HEX.test(v.sourceFiles[file] ?? ""))) FAIL("source_attestation_missing");
  if (v.candidate && (!HEX.test(v.candidate.pdfSha256) || !HEX.test(v.candidate.evidenceHash)
    || !HEX.test(v.candidate.renderedHtmlSha256))) FAIL("candidate_digest_invalid");
  validatePreservedBlankFields(v.preservedBlankFields, v.assetRecovery);
  if (v.assetRecovery) {
    validateRecovery47Assets(v.assetRecovery);
    if (v.candidate && (!HEX.test(v.candidate.assetAuditSha256 ?? "")
      || sha256(recovery47AssetAudit(v)) !== v.candidate.assetAuditSha256)) FAIL("asset_audit_digest_mismatch");
    if (v.assetApprovalReceiptSha256 !== undefined && !HEX.test(v.assetApprovalReceiptSha256)) FAIL("asset_approval_invalid");
  } else if (v.assetApprovalReceiptSha256 !== undefined || v.candidate?.assetAuditSha256 !== undefined) FAIL("asset_manifest_missing");
}

/** Verified operator receipt, not a claim that this CLI controls other processes. */
export function validateRecovery47WorkerReceipt(raw: Uint8Array, manifest: Recovery47Manifest, now = Date.now()): void {
  if (sha256(raw) !== manifest.workerIsolationReceiptSha256) FAIL("worker_receipt_digest_mismatch");
  let receipt: any;
  try { receipt = JSON.parse(Buffer.from(raw).toString("utf8")); } catch { FAIL("worker_receipt_invalid"); }
  const recordedAt = Date.parse(receipt.recordedAt);
  if (receipt.schemaVersion !== 1 || receipt.operatorVerified !== true
    || canonicalJson(receipt.target) !== canonicalJson(RECOVERY47_TARGET)
    || canonicalJson(receipt.database) !== canonicalJson(manifest.database)
    || receipt.sourceFilesSha256 !== sha256(canonicalJson(manifest.sourceFiles))
    || !Number.isFinite(recordedAt) || recordedAt > now || now - recordedAt > 60 * 60_000
    || receipt.otherContractRenderersDisabled !== true
    || !Array.isArray(receipt.instances) || receipt.instances.length === 0 || receipt.instances.length > 20) FAIL("worker_isolation_unproven");
  const ids = new Set<string>();
  for (const instance of receipt.instances) {
    if (typeof instance.id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{2,199}$/.test(instance.id)
      || ids.has(instance.id) || !Number.isFinite(Date.parse(instance.startedAt))
      || Date.parse(instance.startedAt) > recordedAt || instance.contractDeliveryEnabled !== false
      || instance.contractPdfWorkerEnabled !== false || instance.inFlightContractJobs !== 0) FAIL("worker_isolation_unproven");
    ids.add(instance.id);
  }
}

function date(value: unknown, field: string): Date {
  if (typeof value !== "string" || !value || Number.isNaN(Date.parse(value))) return FAIL(`missing_${field}`);
  return new Date(value);
}
function scalar(ctx: any, key: string): boolean {
  const parts = key.split(".");
  if (parts.some(part => ["__proto__", "prototype", "constructor"].includes(part))) return false;
  const valid = (v: unknown) => (typeof v === "string" && v.trim() !== "") || typeof v === "number" || typeof v === "boolean";
  if (parts.length === 1) return [ctx, ctx.intake, ctx.agent, ctx.contract].some(scope => scope && valid(scope[key]));
  let current = ctx;
  for (const part of parts) {
    if (!current || !Object.prototype.hasOwnProperty.call(current, part)) return false;
    current = current[part];
  }
  return valid(current);
}

/** Full digest includes nullable fields and exact original timestamp strings. */
export function recovery47InputDigest(snapshot: Recovery47Snapshot): string { return sha256(canonicalJson(snapshot)); }

/** Remove CSS comments only; quoted content such as content:"{{field}}" is
 * still a real template value, even when it contains comment-looking text. */
function withoutCssComments(css: string): string {
  let out = "", quote = "";
  for (let i = 0; i < css.length; i++) {
    const char = css[i];
    if (quote) {
      out += char;
      if (char === "\\" && i + 1 < css.length) out += css[++i];
      else if (char === quote) quote = "";
    } else if (char === "\\" && i + 1 < css.length) { out += char + css[++i]; }
    else if (char === "\"" || char === "'") { quote = char; out += char; }
    else if (char === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      if (end < 0) return out;
      out += " "; i = end + 1;
    } else out += char;
  }
  return out;
}
function renderedTemplateVariables(html: string): string[] {
  const parsed = new JSDOM(html);
  try {
    const doc = parsed.window.document;
    const walker = doc.createTreeWalker(doc, parsed.window.NodeFilter.SHOW_COMMENT);
    const comments: Array<typeof walker.currentNode> = [];
    while (walker.nextNode()) comments.push(walker.currentNode);
    for (const comment of comments) comment.parentNode?.removeChild(comment);
    for (const style of doc.querySelectorAll("style")) style.textContent = withoutCssComments(style.textContent || "");
    for (const element of doc.querySelectorAll("[style]")) element.setAttribute("style", withoutCssComments(element.getAttribute("style") || ""));
    return [...doc.documentElement.outerHTML.matchAll(/\{\{\{?\s*([\w.]+)\s*\}\}\}?/g)].map(match => match[1]);
  } finally { parsed.window.close(); }
}

export function prepareRecovery47(snapshot: Recovery47Snapshot, expectedDigest: string, assetRecovery?: Recovery47Assets,
  preservedBlankFields?: readonly ["whatsapp_phone"]) {
  if (!HEX.test(expectedDigest) || recovery47InputDigest(snapshot) !== expectedDigest) FAIL("input_digest_mismatch");
  const { contract: c, session: s, application: a } = snapshot;
  if (c.id !== 47 || c.signing_session_id !== 165 || c.template_id !== 48 || s.id !== 165 || s.template_id !== 48
    || a.id !== 12 || a.signing_session_id !== 165 || a.signed_contract_id !== 47 || a.contract_template_id !== 48
    || c.subject_type !== "agent_application" || s.subject_type !== "agent_application"
    || c.subject_id !== 12 || s.subject_id !== 12 || c.agent_id !== s.agent_id
    || (a.provisional_agent_id !== c.agent_id && a.approved_agent_id !== c.agent_id)) FAIL("target_relationship_mismatch");
  if (c.pdf_object_key !== null || c.evidence_hash !== null) FAIL("final_artifact_exists");
  if (c.delivery_claimed_at !== null) FAIL("lease_not_empty");
  if (c.emailed_at !== null) FAIL("already_delivered");
  if (s.status !== "signed" || s.revoked_at !== null || !/\bTEST\b/i.test(c.signer_name ?? "")) FAIL("not_signed_test_case");
  const signedAt = date(c.signed_at, "signed_at");
  if (date(s.signed_at, "session_signed_at").getTime() !== signedAt.getTime()) FAIL("signed_at_mismatch");
  if (typeof c.signer_email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.signer_email)
    || c.signer_email !== s.signer_email) FAIL("signer_mismatch");
  if (typeof s.template_body_html_snapshot !== "string" || !s.template_body_html_snapshot.trim()
    || Buffer.byteLength(s.template_body_html_snapshot) > 2 * 1024 * 1024
    || !Number.isInteger(s.template_version_snapshot) || s.template_version_snapshot < 1
    || typeof s.template_name_snapshot !== "string" || !s.template_name_snapshot.trim()
    || typeof s.template_language_snapshot !== "string" || !s.template_language_snapshot.trim()
    || typeof s.template_entity_type_snapshot !== "string" || !s.template_entity_type_snapshot.trim()
    || !Object.prototype.hasOwnProperty.call(s, "template_intake_schema_snapshot")) FAIL("frozen_template_missing");
  if (!s.intake_data || typeof s.intake_data !== "object" || Array.isArray(s.intake_data)) FAIL("frozen_intake_missing");
  const config = s.template_signing_page_config_snapshot;
  const branding = sanitizeContractBranding(config);
  if (!branding?.companySignatureDataUrl) FAIL("frozen_company_signature_missing");
  if (typeof c.signature_image_base64 !== "string" || !c.signature_image_base64
    || c.signature_image_base64.startsWith("data:")) FAIL("original_signature_missing");
  const signature = `data:image/png;base64,${c.signature_image_base64}`;
  if (validateCompanySignatureDataUrl(signature) !== null
    || Buffer.from(c.signature_image_base64, "base64").toString("base64") !== c.signature_image_base64) FAIL("original_signature_invalid");
  if (typeof c.email_verification_required !== "boolean") FAIL("frozen_email_policy_missing");
  let verifiedAt: Date | null = null;
  if (c.email_verification_required) {
    if (!["one_time_code", "verified_agent_application", "authenticated_portal_session", "legacy_verified_email"].includes(c.email_verification_method)) FAIL("frozen_email_method_missing");
    verifiedAt = date(c.email_verified_at, "email_verified_at");
    if (verifiedAt.getTime() > signedAt.getTime()) FAIL("verification_after_signature");
  } else if (c.email_verification_method !== "not_required" || c.email_verified_at !== null) FAIL("email_evidence_inconsistent");
  const number = contractNumber(165, signedAt);
  const ctx = buildAgentContext(null, s.intake_data, { signerEmail: c.signer_email, signerName: c.signer_name, date: signedAt.toISOString().slice(0, 10), number });
  ctx.signature = signature;
  ctx.main_agency_signature = branding.companySignatureDataUrl;
  const variables = renderedTemplateVariables(s.template_body_html_snapshot);
  const preserve = validatePreservedBlankFields(preservedBlankFields, assetRecovery);
  for (const field of preserve) {
    if (!variables.includes(field)) FAIL("unused_preserved_blank_field");
    const absent = (value: unknown) => value === undefined || value === null || (typeof value === "string" && !value.trim());
    // The schema's camelCase key may carry an explicit frozen answer. Never
    // discard that answer, infer agencyPhone/phone, or query a current agent.
    if (scalar(ctx, field) || !absent(s.intake_data.whatsapp_phone)
      || !absent(s.intake_data.whatsappPhone)) FAIL("preserved_blank_has_frozen_value");
  }
  const missing = [...new Set(variables.filter((key: string) => !scalar(ctx, key) && !preserve.includes(key)))];
  // Variable names, never their values, may be reported to the operator.
  if (missing.length) FAIL(`missing_frozen_fields:${missing.sort().join(",")}`);
  let bodyHtml = buildFinalSignedContractHtml({ bodyHtml: s.template_body_html_snapshot, templateLanguage: s.template_language_snapshot,
    agent: null, intakeData: s.intake_data, signerEmail: c.signer_email, signerName: c.signer_name,
    signedAt, signatureBase64: c.signature_image_base64, contractNumber: number, signingPageConfig: config });
  const rendered = new JSDOM(bodyHtml);
  try {
    if (assetRecovery) {
      validateRecovery47Assets(assetRecovery);
      const replaced = new Set<string>();
      for (const img of rendered.window.document.querySelectorAll("img[src]")) {
        const src = img.getAttribute("src")!;
        const asset = assetRecovery.assets.find(item => item.requestedUrl === src);
        if (asset) { img.setAttribute("src", asset.dataUrl); replaced.add(src); }
      }
      if (replaced.size !== assetRecovery.assets.length) FAIL("unused_asset_mapping");
      if (assetRecovery.classification === "reconstructed_branding") {
        const notice = rendered.window.document.createElement("aside");
        notice.setAttribute("data-recovery47-notice", "reconstructed-branding");
        notice.setAttribute("role", "note");
        notice.setAttribute("style", "border:1px solid #64748b;padding:8px;margin:0 0 12px;font-size:10px;color:#334155;background:#f8fafc");
        notice.textContent = "Recovered TEST02 copy — branding reconstructed from separately reviewed assets. "
          + "The original historical logo bytes were not established. This PDF was generated after signing; "
          + "the frozen contract text, original signatures and signing date are retained. This is not the original signing-time PDF artifact.";
        if (preserve.length) notice.textContent += " The original frozen WhatsApp value is absent and is preserved blank; no telephone number has been inferred.";
        rendered.window.document.body.prepend(notice);
      }
      // Only the prepared rendition is serialized. No template or session
      // update occurs; source text, CSS, signatures and links remain intact.
      bodyHtml = `${rendered.window.document.head.innerHTML}${rendered.window.document.body.innerHTML}`;
    }
    if (Array.from(rendered.window.document.querySelectorAll("img")).some(img =>
      validateCompanySignatureDataUrl(img.getAttribute("src")) !== null)) FAIL("unfrozen_image_source");
  } finally { rendered.window.close(); }
  return { templateName: s.template_name_snapshot as string, bodyHtml, signerEmail: c.signer_email as string,
    signerName: c.signer_name as string | null, signerIp: c.signer_ip as string | null, signerUserAgent: c.signer_user_agent as string | null,
    signedAt, emailVerificationRequired: c.email_verification_required as boolean,
    emailVerificationMethod: c.email_verification_method as string, emailVerifiedAt: verifiedAt };
}

const SNAPSHOT_QUERY = `SELECT jsonb_build_object(
  'contract', to_jsonb(sc), 'session', to_jsonb(ss) - 'token_hash',
  'application', jsonb_build_object('id', aa.id, 'signing_session_id', aa.signing_session_id,
    'signed_contract_id', aa.signed_contract_id, 'contract_template_id', aa.contract_template_id,
    'provisional_agent_id', aa.provisional_agent_id, 'approved_agent_id', aa.approved_agent_id,
    'status', aa.status, 'approved_at', aa.approved_at, 'commercial_activated_at', aa.commercial_activated_at)) AS snapshot
  FROM public.signed_contracts sc JOIN public.signing_sessions ss ON ss.id = sc.signing_session_id
  JOIN public.agent_applications aa ON aa.id = 12
  WHERE sc.id = 47 AND ss.id = 165 AND sc.template_id = 48 AND ss.template_id = 48`;

export async function readRecovery47Snapshot(client: Recovery47SqlClient, lock = false): Promise<Recovery47Snapshot> {
  const result = await client.query(`${SNAPSHOT_QUERY}${lock ? " FOR UPDATE OF sc, ss, aa" : ""}`);
  if (result.rows.length !== 1) FAIL("target_not_found");
  return result.rows[0].snapshot;
}

export async function assertRecovery47Database(client: Recovery47SqlClient, expected: Recovery47Identity): Promise<void> {
  const result = await client.query(`SELECT pg_catalog.current_database() AS database, pg_catalog.host(pg_catalog.inet_server_addr()) AS address,
    pg_catalog.inet_server_port() AS port, current_user AS role`);
  if (canonicalJson(result.rows[0]) !== canonicalJson(expected)) FAIL("database_identity_mismatch");
}

export function validateRecovery47Pdf(bytes: Uint8Array, expectedHash: string): void {
  if (bytes.byteLength < 100 || bytes.byteLength > MAX_PDF || Buffer.from(bytes).subarray(0, 5).toString() !== "%PDF-"
    || !HEX.test(expectedHash) || sha256(bytes) !== expectedHash) FAIL("candidate_pdf_mismatch");
}

/** No symlink traversal or overwrites; Linux fd identity is mandatory. */
async function openPinnedDirectory(directory: string) {
  if (process.platform !== "linux") FAIL("linux_fd_validation_required");
  const resolved = path.resolve(directory);
  if (resolved !== directory || resolved === path.parse(resolved).root) FAIL("absolute_private_directory_required");
  const components = resolved.split(path.sep).filter(Boolean);
  let current = path.parse(resolved).root;
  for (const component of components) {
    current = path.join(current, component);
    const stat = await lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) FAIL("directory_chain_invalid");
  }
  const handle = await open(resolved, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isDirectory() || stat.uid !== process.getuid?.() || (stat.mode & 0o022) !== 0
      || await realpath(`/proc/self/fd/${handle.fd}`) !== resolved) FAIL("directory_identity_invalid");
    return { handle, resolved };
  } catch (error) { await handle.close(); throw error; }
}

export async function readPinnedRecoveryFile(filename: string, limit = MAX_PDF): Promise<Buffer> {
  const pinned = await openPinnedDirectory(path.dirname(filename));
  let file;
  try {
    file = await open(`/proc/self/fd/${pinned.handle.fd}/${path.basename(filename)}`, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await file.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > limit || stat.uid !== process.getuid?.()
      || (stat.mode & 0o077) !== 0 || await realpath(`/proc/self/fd/${file.fd}`) !== filename) FAIL("private_file_identity_invalid");
    const bytes = await file.readFile();
    if (bytes.byteLength !== stat.size || bytes.byteLength > limit) FAIL("private_file_changed");
    return bytes;
  } finally { await file?.close(); await pinned.handle.close(); }
}

export async function writeImmutableRecoveryFile(directory: string, filename: string, bytes: Uint8Array): Promise<string> {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,180}$/.test(filename)) FAIL("artifact_name_invalid");
  const pinned = await openPinnedDirectory(directory);
  const target = path.join(directory, filename);
  let file;
  try {
    try {
      file = await open(`/proc/self/fd/${pinned.handle.fd}/${filename}`,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = await readPinnedRecoveryFile(target, Math.max(MAX_PDF, bytes.byteLength));
      if (sha256(existing) !== sha256(bytes)) FAIL("immutable_artifact_collision");
      return target;
    }
    const stat = await file.stat();
    if (!stat.isFile() || stat.nlink !== 1 || await realpath(`/proc/self/fd/${file.fd}`) !== target) FAIL("new_file_identity_invalid");
    await file.writeFile(bytes);
    await file.sync();
    await pinned.handle.sync();
    if (await realpath(`/proc/self/fd/${pinned.handle.fd}`) !== directory) FAIL("directory_changed");
    return target;
  } finally { await file?.close(); await pinned.handle.close(); }
}

/**
 * Single explicit transaction, no retry. A failed COMMIT is uncertain: inspect
 * row47 before any retry. A failed DB transaction may leave the immutable file;
 * it is never deleted or rewritten automatically.
 */
export async function applyRecovery47(client: Recovery47SqlClient, manifest: Recovery47Manifest,
  pdfBytes: Uint8Array, installArtifact: (bytes: Uint8Array, sha: string) => Promise<string>,
  assetEvidence?: { provenanceReceipts: Uint8Array[]; approvalReceipt: Uint8Array;
    installAudit: (audit: Uint8Array, approval: Uint8Array, provenance: Uint8Array[]) => Promise<string> }): Promise<void> {
  validateRecovery47Manifest(manifest);
  if (!manifest.candidate) FAIL("approved_candidate_missing");
  validateRecovery47Pdf(pdfBytes, manifest.candidate.pdfSha256);
  if (manifest.assetRecovery) {
    if (!assetEvidence || assetEvidence.provenanceReceipts.length !== manifest.assetRecovery.assets.length) FAIL("asset_approval_required");
    manifest.assetRecovery.assets.forEach((_asset, index) => validateRecovery47AssetProvenance(assetEvidence.provenanceReceipts[index], manifest.assetRecovery!, index));
    validateRecovery47AssetApproval(assetEvidence.approvalReceipt, manifest);
  }
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL lock_timeout = '3s'");
    await client.query("SET LOCAL statement_timeout = '10s'");
    await client.query("SET LOCAL search_path = pg_catalog, public");
    await assertRecovery47Database(client, manifest.database);
    const snapshot = await readRecovery47Snapshot(client, true);
    const params = prepareRecovery47(snapshot, manifest.inputSha256, manifest.assetRecovery, manifest.preservedBlankFields);
    if (sha256(params.bodyHtml) !== manifest.candidate.renderedHtmlSha256) FAIL("rendered_input_mismatch");
    const claim = await client.query(`UPDATE public.signed_contracts SET delivery_claimed_at = clock_timestamp()
      WHERE id = 47 AND pdf_object_key IS NULL AND evidence_hash IS NULL AND delivery_claimed_at IS NULL
      AND emailed_at IS NULL RETURNING delivery_claimed_at::text AS lease`);
    if (claim.rowCount !== 1) FAIL("claim_failed");
    const objectKey = await installArtifact(pdfBytes, manifest.candidate.pdfSha256);
    if (objectKey !== `/objects/signed-contracts/recovery47-${manifest.candidate.pdfSha256}.pdf`) FAIL("object_key_mismatch");
    if (manifest.assetRecovery) {
      const audit = recovery47AssetAudit(manifest);
      const auditKey = await assetEvidence!.installAudit(audit, assetEvidence!.approvalReceipt, assetEvidence!.provenanceReceipts);
      if (auditKey !== `/objects/signed-contracts/recovery47-${manifest.candidate.pdfSha256}.recovery-${manifest.candidate.assetAuditSha256}.json`) FAIL("asset_audit_key_mismatch");
    }
    const beforeCommit = await readRecovery47Snapshot(client);
    beforeCommit.contract.delivery_claimed_at = null;
    if (recovery47InputDigest(beforeCommit) !== manifest.inputSha256) FAIL("input_changed_during_install");
    const saved = await client.query(`UPDATE public.signed_contracts SET pdf_object_key = $1, evidence_hash = $2, delivery_claimed_at = NULL
      WHERE id = 47 AND signing_session_id = 165 AND template_id = 48 AND pdf_object_key IS NULL AND evidence_hash IS NULL
      AND emailed_at IS NULL AND delivery_claimed_at = $3::timestamptz RETURNING id`,
    [objectKey, manifest.candidate.evidenceHash, claim.rows[0].lease]);
    if (saved.rowCount !== 1) FAIL("commit_compare_and_set_failed");
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
}
