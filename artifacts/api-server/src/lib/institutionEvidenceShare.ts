const UUID_V7_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_RE = /^[0-9a-f]{64}$/;
const REQUIREMENT_CODE_RE = /^[a-z][a-z0-9._:-]{1,95}$/;
const MAX_ALLOWLIST_SIZE = 200;

export type InstitutionEvidenceShareMode = "off" | "allowlist" | "all";

export type InstitutionEvidenceShareConfig = {
  schemaVersion: 1;
  mode: InstitutionEvidenceShareMode;
  relationshipAllowlist: ReadonlySet<string>;
};

export type InstitutionEvidenceShareRequest = {
  tenantId: string;
  relationshipId: string;
  applicationCaseId: string;
  journeyEvidenceReceiptId: string;
  journeyConsentReceiptId: string;
};

export type InstitutionEvidenceShareResult = {
  outcome: "CREATED" | "REPLAY";
  shareReceiptId: string;
  evidenceRefHash: string;
  contentSha256: string;
  requirementCode: string;
  receiptHash: string;
  validUntil: string | null;
};

export function parseInstitutionEvidenceShareConfig(
  environment: Record<string, string | undefined>,
): InstitutionEvidenceShareConfig {
  const rawMode = environment.INSTITUTION_EVIDENCE_SHARE_V1_MODE?.trim() ?? "off";
  if (rawMode !== "off" && rawMode !== "allowlist" && rawMode !== "all") {
    throw new Error("institution_evidence_share_mode_invalid");
  }
  const tokens = (environment.INSTITUTION_EVIDENCE_SHARE_V1_RELATIONSHIP_ALLOWLIST ?? "")
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
  if (
    tokens.length > MAX_ALLOWLIST_SIZE ||
    tokens.some((token) => !UUID_V7_RE.test(token)) ||
    new Set(tokens).size !== tokens.length
  ) {
    throw new Error("institution_evidence_share_allowlist_invalid");
  }
  const relationshipAllowlist = new Set(tokens);
  if (rawMode === "allowlist" && relationshipAllowlist.size === 0) {
    throw new Error("institution_evidence_share_allowlist_required");
  }
  if (rawMode !== "allowlist" && relationshipAllowlist.size > 0) {
    throw new Error("institution_evidence_share_allowlist_unexpected");
  }
  return { schemaVersion: 1, mode: rawMode, relationshipAllowlist };
}

export function validateInstitutionEvidenceShareRequest(
  input: InstitutionEvidenceShareRequest,
): InstitutionEvidenceShareRequest {
  const values = {
    tenantId: input?.tenantId?.trim().toLowerCase(),
    relationshipId: input?.relationshipId?.trim().toLowerCase(),
    applicationCaseId: input?.applicationCaseId?.trim().toLowerCase(),
    journeyEvidenceReceiptId: input?.journeyEvidenceReceiptId?.trim().toLowerCase(),
    journeyConsentReceiptId: input?.journeyConsentReceiptId?.trim().toLowerCase(),
  };
  if (Object.values(values).some((value) => !UUID_V7_RE.test(value))) {
    throw new Error("institution_evidence_share_scope_invalid");
  }
  return values;
}

export function assertInstitutionEvidenceShareEnabled(
  config: InstitutionEvidenceShareConfig,
  relationshipId: string,
): void {
  if (config.mode === "off") throw new Error("institution_evidence_share_disabled");
  if (config.mode === "allowlist" && !config.relationshipAllowlist.has(relationshipId)) {
    throw new Error("institution_evidence_share_relationship_not_allowed");
  }
}

export function parseInstitutionEvidenceShareResult(
  value: Record<string, unknown> | undefined,
): InstitutionEvidenceShareResult {
  const outcome = value?.outcome;
  const shareReceiptId = value?.share_receipt_id;
  const evidenceRefHash = value?.evidence_ref_hash;
  const contentSha256 = value?.content_sha256;
  const requirementCode = value?.requirement_code;
  const receiptHash = value?.receipt_hash;
  const validUntil = value?.valid_until;
  let normalizedValidUntil: string | null = null;
  if (validUntil instanceof Date || typeof validUntil === "string") {
    const parsed = new Date(validUntil);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error("institution_evidence_share_result_invalid");
    }
    normalizedValidUntil = parsed.toISOString();
  }
  if (
    (outcome !== "CREATED" && outcome !== "REPLAY") ||
    typeof shareReceiptId !== "string" || !UUID_V7_RE.test(shareReceiptId) ||
    typeof evidenceRefHash !== "string" || !HASH_RE.test(evidenceRefHash) ||
    typeof contentSha256 !== "string" || !HASH_RE.test(contentSha256) ||
    typeof requirementCode !== "string" || !REQUIREMENT_CODE_RE.test(requirementCode) ||
    typeof receiptHash !== "string" || !HASH_RE.test(receiptHash) ||
    (validUntil !== null && validUntil !== undefined && normalizedValidUntil === null)
  ) {
    throw new Error("institution_evidence_share_result_invalid");
  }
  return {
    outcome,
    shareReceiptId: shareReceiptId.toLowerCase(),
    evidenceRefHash,
    contentSha256,
    requirementCode,
    receiptHash,
    validUntil: normalizedValidUntil,
  };
}
