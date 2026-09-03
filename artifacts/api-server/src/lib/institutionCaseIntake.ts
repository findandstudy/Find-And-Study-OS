const UUID_V7_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_RE = /^[0-9a-f]{64}$/;
const MASKED_STUDENT_REF_RE = /^STU-[0-9A-F]{16}$/;
const MAX_ALLOWLIST_SIZE = 200;

export type InstitutionCaseIntakeMode = "off" | "allowlist" | "all";

export type InstitutionCaseIntakeConfig = {
  schemaVersion: 1;
  mode: InstitutionCaseIntakeMode;
  relationshipAllowlist: ReadonlySet<string>;
};

export type InstitutionCaseIntakeRequest = {
  tenantId: string;
  relationshipId: string;
  portalSubmissionId: number;
};

export type InstitutionCaseIntakeResult = {
  outcome: "CREATED" | "REPLAY";
  applicationCaseId: string;
  receiptId: string;
  sourceSnapshotHash: string;
  receiptHash: string;
  maskedStudentRef: string;
};

export function parseInstitutionCaseIntakeConfig(
  environment: Record<string, string | undefined>,
): InstitutionCaseIntakeConfig {
  const rawMode = environment.INSTITUTION_CASE_INTAKE_V1_MODE?.trim() ?? "off";
  if (rawMode !== "off" && rawMode !== "allowlist" && rawMode !== "all") {
    throw new Error("institution_case_intake_mode_invalid");
  }

  const tokens = (environment.INSTITUTION_CASE_INTAKE_V1_RELATIONSHIP_ALLOWLIST ?? "")
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
  if (tokens.length > MAX_ALLOWLIST_SIZE || tokens.some((token) => !UUID_V7_RE.test(token))) {
    throw new Error("institution_case_intake_allowlist_invalid");
  }
  const relationshipAllowlist = new Set(tokens);
  if (relationshipAllowlist.size !== tokens.length) {
    throw new Error("institution_case_intake_allowlist_invalid");
  }
  if (rawMode === "allowlist" && relationshipAllowlist.size === 0) {
    throw new Error("institution_case_intake_allowlist_required");
  }
  if (rawMode !== "allowlist" && relationshipAllowlist.size > 0) {
    throw new Error("institution_case_intake_allowlist_unexpected");
  }

  return {
    schemaVersion: 1,
    mode: rawMode,
    relationshipAllowlist,
  };
}
export function validateInstitutionCaseIntakeRequest(
  input: InstitutionCaseIntakeRequest,
): InstitutionCaseIntakeRequest {
  const tenantId = input?.tenantId?.trim().toLowerCase();
  const relationshipId = input?.relationshipId?.trim().toLowerCase();
  if (!UUID_V7_RE.test(tenantId) || !UUID_V7_RE.test(relationshipId)) {
    throw new Error("institution_case_intake_scope_invalid");
  }
  if (!Number.isSafeInteger(input.portalSubmissionId) || input.portalSubmissionId <= 0) {
    throw new Error("institution_case_intake_submission_id_invalid");
  }
  return { tenantId, relationshipId, portalSubmissionId: input.portalSubmissionId };
}

export function assertInstitutionCaseIntakeEnabled(
  config: InstitutionCaseIntakeConfig,
  relationshipId: string,
): void {
  if (config.mode === "off") throw new Error("institution_case_intake_disabled");
  if (config.mode === "allowlist" && !config.relationshipAllowlist.has(relationshipId)) {
    throw new Error("institution_case_intake_relationship_not_allowed");
  }
}

export function parseInstitutionCaseIntakeResult(
  value: Record<string, unknown> | undefined,
): InstitutionCaseIntakeResult {
  const outcome = value?.outcome;
  const applicationCaseId = value?.application_case_id;
  const receiptId = value?.receipt_id;
  const sourceSnapshotHash = value?.source_snapshot_hash;
  const receiptHash = value?.receipt_hash;
  const maskedStudentRef = value?.masked_student_ref;
  if (
    (outcome !== "CREATED" && outcome !== "REPLAY") ||
    typeof applicationCaseId !== "string" || !UUID_V7_RE.test(applicationCaseId) ||
    typeof receiptId !== "string" || !UUID_V7_RE.test(receiptId) ||
    typeof sourceSnapshotHash !== "string" || !HASH_RE.test(sourceSnapshotHash) ||
    typeof receiptHash !== "string" || !HASH_RE.test(receiptHash) ||
    typeof maskedStudentRef !== "string" || !MASKED_STUDENT_REF_RE.test(maskedStudentRef)
  ) {
    throw new Error("institution_case_intake_result_invalid");
  }
  return {
    outcome,
    applicationCaseId: applicationCaseId.toLowerCase(),
    receiptId: receiptId.toLowerCase(),
    sourceSnapshotHash,
    receiptHash,
    maskedStudentRef,
  };
}
