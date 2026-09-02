export const INSTITUTION_ROLE_KEYS = [
  "INSTITUTION_ADMIN",
  "PROGRAM_INTAKE_MANAGER",
  "ADMISSIONS_REVIEWER",
  "DECISION_APPROVER",
  "INTEGRATION_ADMIN",
  "INSTITUTION_AUDITOR",
] as const;

export type InstitutionRoleKey = (typeof INSTITUTION_ROLE_KEYS)[number];

export const INSTITUTION_CAPABILITIES = [
  "institution.workspace.read",
  "institution.applications.review",
  "institution.evidence.assess",
  "institution.information.request",
  "institution.decisions.draft",
  "institution.decisions.approve",
  "institution.offers.issue",
  "institution.enrolment.confirm",
  "institution.catalog.manage",
  "institution.requirements.manage",
  "institution.sla.manage",
  "institution.integrations.manage",
  "institution.analytics.read",
  "institution.team.manage",
  "institution.audit.read",
] as const;

export type InstitutionCapability = (typeof INSTITUTION_CAPABILITIES)[number];

export const CASE_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  RECEIVED: ["REVIEWING", "CLOSED"],
  REVIEWING: ["INFORMATION_REQUESTED", "READY_FOR_DECISION", "CLOSED"],
  INFORMATION_REQUESTED: ["REVIEWING", "READY_FOR_DECISION", "CLOSED"],
  READY_FOR_DECISION: ["DECISION_PENDING_APPROVAL", "REVIEWING", "CLOSED"],
  DECISION_PENDING_APPROVAL: ["DECIDED", "READY_FOR_DECISION"],
  DECIDED: ["OFFER_ISSUED", "CLOSED"],
  OFFER_ISSUED: ["ENROLMENT_PENDING", "CLOSED"],
  ENROLMENT_PENDING: ["ENROLLED", "CLOSED"],
  ENROLLED: [],
  CLOSED: [],
};

export function isInstitutionRoleKey(value: unknown): value is InstitutionRoleKey {
  return typeof value === "string" &&
    (INSTITUTION_ROLE_KEYS as readonly string[]).includes(value);
}

export function canTransitionInstitutionCase(from: string, to: string): boolean {
  return CASE_TRANSITIONS[from]?.includes(to) === true;
}

export function assertCapability(
  capabilities: ReadonlySet<string>,
  capability: InstitutionCapability,
): void {
  if (!capabilities.has(capability)) throw new Error("institution_capability_denied");
}

export function assertAnyCapability(
  capabilities: ReadonlySet<string>,
  required: readonly InstitutionCapability[],
): void {
  if (!required.some((capability) => capabilities.has(capability))) {
    throw new Error("institution_capability_denied");
  }
}

export function assertIndependentChecker(makerId: string, checkerId: string): void {
  if (!makerId || !checkerId || makerId === checkerId) {
    throw new Error("institution_maker_checker_conflict");
  }
}

export function assertDecisionCanCreateOffer(input: {
  state: string;
  decisionType: string;
}): void {
  if (
    input.state !== "APPROVED" ||
    !["CONDITIONAL_OFFER", "UNCONDITIONAL_OFFER"].includes(input.decisionType)
  ) {
    throw new Error("institution_offer_requires_approved_offer_decision");
  }
}

export function assertEnrolmentEvidenceHash(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error("institution_enrolment_evidence_required");
  }
}

const SHARED_PROFILE_KEYS = new Set([
  "givenName",
  "familyName",
  "dateOfBirth",
  "nationality",
  "passportCountry",
  "educationSummary",
  "languageQualifications",
]);

export function sanitizeInstitutionSharedProfile(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => SHARED_PROFILE_KEYS.has(key))
      .map(([key, item]) => [key, typeof item === "string" ? item.slice(0, 500) : item]),
  );
}
