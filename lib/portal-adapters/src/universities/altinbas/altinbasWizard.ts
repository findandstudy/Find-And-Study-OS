import { fold } from "../../programMatch.js";

export const ALTINBAS_WIZARD_STEPS = [
  "Personal Information",
  "Educational Information",
  "Questionnaire",
  "Documents",
  "Completed",
] as const;

export type AltinbasWizardStep = (typeof ALTINBAS_WIZARD_STEPS)[number];

export interface AltinbasWizardSnapshot {
  /**
   * Raw text/data-label values read from `.slds-path__stage-name` across the
   * document and every open shadow root.
   */
  stageNames: string[];
  /**
   * Optional corroboration from
   * `li.slds-path__item.slds-is-current .slds-path__title`.
   */
  currentTitles: string[];
  /** Diagnostic only. It is never used to decide the active step. */
  fileInputCount: number;
}

export interface AltinbasWizardState {
  step: AltinbasWizardStep | "";
  fileInputCount: number;
  documentScreen: boolean;
  reason:
    | "ok"
    | "stage_missing"
    | "stage_ambiguous"
    | "current_ambiguous"
    | "marker_mismatch";
}

export interface AltinbasLabeledControlCandidate {
  tagName: string;
  role: string;
  visible: boolean;
  disabled: boolean;
  readOnly: boolean;
}

export type AltinbasBasicField =
  | "firstName"
  | "lastName"
  | "passport"
  | "email";

const ALTINBAS_BASIC_FIELD_LABELS: Record<AltinbasBasicField, string> = {
  firstName: "first name",
  lastName: "last name",
  passport: "passport number",
  email: "applicant email",
};

/**
 * Required Lightning labels expose their visual asterisk as part of the
 * accessible name (for example `* First Name`). Match that live contract
 * exactly while also accepting the same label without the required marker.
 */
export function altinbasBasicFieldLabel(
  field: AltinbasBasicField,
): RegExp {
  const label = ALTINBAS_BASIC_FIELD_LABELS[field];
  return new RegExp(`^\\s*\\*?\\s*${label}\\s*\\*?\\s*$`, "i");
}

/**
 * Salesforce labels both the interactive country input and its owned listbox.
 * Select only one visible, writable input combobox; duplicate/ambiguous inputs
 * fail closed instead of relying on DOM order.
 */
export function chooseAltinbasLabeledCombobox(
  candidates: AltinbasLabeledControlCandidate[],
  options: { allowReadOnly?: boolean } = {},
): number {
  const matches = candidates
    .map((candidate, index) => ({ candidate, index }))
    .filter(({ candidate }) =>
      candidate.tagName.toLowerCase() === "input" &&
      candidate.role.toLowerCase() === "combobox" &&
      candidate.visible &&
      !candidate.disabled &&
      (options.allowReadOnly || !candidate.readOnly)
    );
  return matches.length === 1 ? matches[0].index : -1;
}

const STEP_BY_FOLDED_NAME = new Map<string, AltinbasWizardStep>(
  ALTINBAS_WIZARD_STEPS.map((step) => [step.toLowerCase(), step]),
);

/**
 * Salesforce emits the active marker as `Stage: Personal Information`.
 * Accept only the five live-discovered Altınbaş stages; never infer from
 * substring/heading/body text.
 */
export function canonicalAltinbasWizardStep(
  raw: unknown,
): AltinbasWizardStep | "" {
  if (typeof raw !== "string") return "";
  const clean = raw
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^stage\s*:\s*/i, "")
    .trim();
  return STEP_BY_FOLDED_NAME.get(clean.toLowerCase()) ?? "";
}

/**
 * Resolve the active step from the live SLDS Path contract. The stage-name
 * marker is primary. A current-li title, when present, must agree with it.
 */
export function resolveAltinbasWizardState(
  snapshot: AltinbasWizardSnapshot,
): AltinbasWizardState {
  const stageCandidates = snapshot.stageNames
    .map(canonicalAltinbasWizardStep)
    .filter((step): step is AltinbasWizardStep => !!step);
  const currentCandidates = snapshot.currentTitles
    .map(canonicalAltinbasWizardStep)
    .filter((step): step is AltinbasWizardStep => !!step);
  const fileInputCount = Number.isFinite(snapshot.fileInputCount)
    ? Math.max(0, Math.trunc(snapshot.fileInputCount))
    : 0;

  if (stageCandidates.length === 0) {
    return {
      step: "",
      fileInputCount,
      documentScreen: false,
      reason: "stage_missing",
    };
  }
  if (stageCandidates.length > 1) {
    return {
      step: "",
      fileInputCount,
      documentScreen: false,
      reason: "stage_ambiguous",
    };
  }
  if (currentCandidates.length > 1) {
    return {
      step: "",
      fileInputCount,
      documentScreen: false,
      reason: "current_ambiguous",
    };
  }

  const step = stageCandidates[0];
  if (currentCandidates.length === 1 && currentCandidates[0] !== step) {
    return {
      step: "",
      fileInputCount,
      documentScreen: false,
      reason: "marker_mismatch",
    };
  }
  return {
    step,
    fileInputCount,
    documentScreen: step === "Documents",
    reason: "ok",
  };
}

export type AltinbasWizardTransition =
  | "advanced"
  | "unchanged"
  | "unknown"
  | "invalid";

/** Only the live-discovered canonical next edge is accepted. */
export function classifyAltinbasWizardTransition(
  before: AltinbasWizardStep | "",
  after: AltinbasWizardStep | "",
): AltinbasWizardTransition {
  if (!before || !after) return "unknown";
  if (before === after) return "unchanged";
  const beforeIndex = ALTINBAS_WIZARD_STEPS.indexOf(before);
  return ALTINBAS_WIZARD_STEPS[beforeIndex + 1] === after
    ? "advanced"
    : "invalid";
}

/** City of Birth is accepted only from the dedicated CRM field. */
export function explicitCityOfBirth(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = value.trim();
  return clean && clean !== "-" ? clean : null;
}

/** Altınbaş Mobile accepts international digits only (no +, spaces or dashes). */
export function altinbasPhoneDigits(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const digits = value.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15 ? digits : null;
}

export interface AltinbasPersonalSource {
  email?: string;
  firstName?: string;
  lastName?: string;
  passportNumber?: string;
  dateOfBirth?: string;
  passportIssueDate?: string;
  passportExpiryDate?: string;
  gender?: string;
  nationality?: string;
  addressStreet?: string;
  addressCity?: string;
  addressZip?: string;
}

const isPresent = (value: unknown): boolean =>
  typeof value === "string" && value.trim() !== "" && value.trim() !== "-";

export type AltinbasResumeFieldAction =
  | "write_crm_value"
  | "accept_existing_portal_value"
  | "write_legacy_fallback"
  | "data_missing";

/**
 * Decide how a resumed wizard field may be handled without inventing data.
 *
 * A CRM value always wins and is written/read back. When CRM has no value, a
 * previously saved non-placeholder portal value may be accepted only after
 * native/LWC validity is proved. A blank/invalid portal control remains a hard
 * data_missing boundary unless the caller supplies an explicit, audited
 * legacy fallback.
 */
export function resolveAltinbasResumeFieldAction(input: {
  crmValue: unknown;
  portalValue: unknown;
  portalValid: boolean;
  legacyFallback?: unknown;
}): AltinbasResumeFieldAction {
  if (isPresent(input.crmValue)) return "write_crm_value";
  if (input.portalValid && isPresent(input.portalValue)) {
    return "accept_existing_portal_value";
  }
  if (isPresent(input.legacyFallback)) return "write_legacy_fallback";
  return "data_missing";
}

export type AltinbasVisaResumeAction =
  | "select_no_from_crm"
  | "accept_existing_no"
  | "questionnaire_followup_unmapped"
  | "data_missing";

/**
 * The current CRM can safely answer only "No". "Yes" exposes an additional
 * consulate/embassy question for which no CRM source exists. A resumed portal
 * selection of "No" may be reused; every other unknown remains fail-closed.
 */
export function resolveAltinbasVisaResumeAction(input: {
  crmValue: unknown;
  portalValue: unknown;
}): AltinbasVisaResumeAction {
  const crm = typeof input.crmValue === "string"
    ? input.crmValue.trim().toLowerCase()
    : "";
  const portal = typeof input.portalValue === "string"
    ? input.portalValue.trim().toLowerCase()
    : "";
  if (crm === "yes") return "questionnaire_followup_unmapped";
  if (crm === "no") return "select_no_from_crm";
  if (portal === "yes") return "questionnaire_followup_unmapped";
  if (portal === "no") return "accept_existing_no";
  return "data_missing";
}

const isIsoDate = (value: unknown): boolean => {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
};

/** Required Personal fields proven against the live Altınbaş DOM. */
export function missingAltinbasPersonalFields(
  profile: AltinbasPersonalSource,
): string[] {
  const missing: string[] = [];
  for (const key of [
    "email",
    "firstName",
    "lastName",
    "passportNumber",
    "nationality",
    "addressStreet",
    "addressCity",
    "addressZip",
  ] as const) {
    if (!isPresent(profile[key])) missing.push(key);
  }
  if (!isIsoDate(profile.dateOfBirth)) missing.push("dateOfBirth");
  if (!isIsoDate(profile.passportIssueDate)) missing.push("passportIssueDate");
  if (!isIsoDate(profile.passportExpiryDate)) missing.push("passportExpiryDate");
  if (!/^(male|female|m|f)$/i.test(profile.gender?.trim() || "")) {
    missing.push("gender");
  }
  return missing;
}

/**
 * One result is unique after applicant search. Multiple results require exactly
 * one row that proves both applicant name and programme.
 */
export function chooseAltinbasApplicationRow(
  foldedRows: string[],
  expectedFoldedNames: string[],
  expectedFoldedPrograms: string[],
): number {
  if (foldedRows.length === 1) return 0;
  if (foldedRows.length === 0) return -1;
  const names = expectedFoldedNames.filter((value) => value.length >= 3);
  const programs = expectedFoldedPrograms.filter((value) => value.length >= 5);
  if (!names.length || !programs.length) return -1;
  const matches = foldedRows
    .map((row, index) => ({
      index,
      name: names.some((name) => row.includes(name)),
      program: programs.some((program) => row.includes(program)),
    }))
    .filter((candidate) => candidate.name && candidate.program);
  return matches.length === 1 ? matches[0].index : -1;
}

/**
 * Salesforce list rows sometimes omit the medium that the CRM's legacy title
 * carries, e.g. `Associate of Oral and Dental Health (Turkish)` versus
 * `Oral and Dental Health`. Remove only degree/title boilerplate and explicit
 * EN/TR medium tokens. If both language variants remain as separate rows, the
 * caller still sees multiple equal candidates and fails closed.
 */
export function altinbasApplicationCoreProgram(value: string): string {
  return fold(
    value.replace(
      /\b(bachelor|master|associate|phd|doctorate|of|in|the|english|turkish|turkce|türkçe|degree|program|programme)\b/gi,
      " ",
    ),
  );
}

export type AltinbasSignedUpLookupDecision =
  | "open"
  | "retry"
  | "missing"
  | "ambiguous";

/**
 * A Program commit can take time to surface its Signed-Up row in Salesforce's
 * My Applications list. Retrying is safe only while no actionable row exists;
 * a visible but ambiguous row must never be retried into a different target.
 */
export function decideAltinbasSignedUpLookup(input: {
  completeButtonCount: number;
  chosenIndex: number;
  attempt: number;
  maxAttempts: number;
}): AltinbasSignedUpLookupDecision {
  if (input.completeButtonCount > 0) {
    return input.chosenIndex >= 0 ? "open" : "ambiguous";
  }
  return input.attempt + 1 < input.maxAttempts ? "retry" : "missing";
}

/**
 * Select the applicant-search grid row only when email + passport prove the
 * identity. Prefer a row-scoped proof. Some Altınbaş Lightning builds render
 * the radio and its visible cells under different shadow hosts, so a
 * row-scoped ancestor walk cannot read the cells. In that case one radio is
 * accepted only when either composed-page text proves both identifiers or the
 * preceding Basic Information search had exact readback for all five fields.
 *
 * All inputs must already be folded by the caller.
 */
export function chooseAltinbasApplicantGridRow(input: {
  foldedRows: string[];
  foldedPageText: string;
  expectedFoldedEmail: string;
  expectedFoldedPassport: string;
  exactSearchReadbackVerified: boolean;
}): number {
  const {
    foldedRows,
    foldedPageText,
    expectedFoldedEmail,
    expectedFoldedPassport,
    exactSearchReadbackVerified,
  } = input;
  if (!expectedFoldedEmail || !expectedFoldedPassport) return -1;

  const exactRowMatches = foldedRows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) =>
      row.includes(expectedFoldedEmail) &&
      row.includes(expectedFoldedPassport)
    );
  if (exactRowMatches.length === 1) return exactRowMatches[0].index;
  if (exactRowMatches.length > 1 || foldedRows.length !== 1) return -1;

  const pageProvesIdentity =
    foldedPageText.includes(expectedFoldedEmail) &&
    foldedPageText.includes(expectedFoldedPassport);
  return pageProvesIdentity || exactSearchReadbackVerified ? 0 : -1;
}

export type AltinbasMutationCanaryGate =
  | "inactive"
  | "ready"
  | "requires_ui_complete"
  | "requires_dry_run";

export function altinbasMutationCanaryGate(input: {
  requested: boolean;
  uiComplete: boolean;
  dryRun: boolean;
}): AltinbasMutationCanaryGate {
  if (!input.requested) return "inactive";
  if (!input.uiComplete) return "requires_ui_complete";
  if (!input.dryRun) return "requires_dry_run";
  return "ready";
}

/** Every dry-run is routed through the read-only UI inspection path. */
export function shouldUseAltinbasUiPath(input: {
  uiComplete: boolean;
  dryRun: boolean;
}): boolean {
  return input.uiComplete || input.dryRun;
}

/** Redact applicant data before any raw portal/browser text reaches logs. */
export function redactAltinbasLog(value: unknown): string {
  return String(value ?? "")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "<redacted-email>")
    .replace(
      /((?:first|last|father|mother)[_ ]?name|passport(?:[_ ]?number)?|address(?:[_ ]?(?:street|city|zip|postal))?|phone|mobile|token|signature|sig)\s*["']?\s*[:=]\s*["']?([^"',}&\n]+)/gi,
      "$1=<redacted>",
    )
    .replace(/([?&](?:token|signature|sig|key)=)[^&\s]+/gi, "$1<redacted>")
    .replace(/\b\+?\d[\d\s().-]{6,}\d\b/g, "<redacted-number>");
}

/** Map CRM grading-system values to the exact Altınbaş select labels. */
export function altinbasGpaTypeLabel(value: unknown): string | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  const scale =
    normalized === "percentage" ? "100" :
    normalized === "4.0" ? "4" :
    /^(4|5|10|12|20|100)$/.test(normalized) ? normalized :
    /^grading system out of (4|5|10|12|20|100)$/i.test(normalized)
      ? normalized.match(/(4|5|10|12|20|100)$/)?.[1] || ""
      : "";
  return scale ? `GRADING SYSTEM OUT OF ${scale}` : null;
}

export interface AltinbasLegacyGpaResolution {
  gpa: string;
  gpaType: string;
  provenance: "record" | "legacy_numeric" | "legacy_letter" | "policy_default";
}

const LETTER_GPA_4: Record<string, string> = {
  "A+": "4",
  A: "4",
  "A-": "3.7",
  "B+": "3.3",
  B: "3",
  "B-": "2.7",
  "C+": "2.3",
  C: "2",
  "C-": "1.7",
  "D+": "1.3",
  D: "1",
  "D-": "0.7",
  F: "0",
};

function numericGpaScale(value: number): string | null {
  if (value < 0 || value > 100) return null;
  if (value <= 4) return "4";
  if (value <= 5) return "5";
  if (value <= 10) return "10";
  if (value <= 12) return "12";
  if (value <= 20) return "20";
  return "100";
}

/**
 * Convert historical free-form GPA values to the numeric contracts exposed by
 * the live Altınbaş modal. Missing legacy GPA follows the explicitly approved
 * compatibility policy (3.0/4); the chosen provenance is always logged by the
 * adapter and nothing is written back to the CRM.
 */
export function resolveAltinbasLegacyGpa(input: {
  recordGpa?: unknown;
  recordGpaType?: unknown;
  legacyGpa?: unknown;
}): AltinbasLegacyGpaResolution {
  const recordRaw = String(input.recordGpa ?? "").trim();
  const legacyRaw = String(input.legacyGpa ?? "").trim();
  const raw = recordRaw || legacyRaw;
  const numericToken = raw.replace(",", ".").match(/\d+(?:\.\d+)?/);
  const numeric = numericToken ? Number(numericToken[0]) : NaN;
  const explicitType = altinbasGpaTypeLabel(input.recordGpaType);
  const explicitScale =
    explicitType?.match(/(4|5|10|12|20|100)$/)?.[1] || null;

  if (Number.isFinite(numeric)) {
    const scale = explicitScale || numericGpaScale(numeric);
    if (scale && numeric <= Number(scale)) {
      return {
        gpa: String(numeric),
        gpaType: scale,
        provenance: recordRaw ? "record" : "legacy_numeric",
      };
    }
  }

  const letterText = raw
    .toUpperCase()
    .replace(/\(\s*PLUS\s*\)/g, "+")
    .replace(/\(\s*MINUS\s*\)/g, "-");
  const letterMatch = letterText.match(/(?:^|\s)([ABCDF])\s*([+-])?/);
  if (letterMatch) {
    const grade = `${letterMatch[1]}${letterMatch[2] || ""}`;
    const converted = LETTER_GPA_4[grade];
    if (converted != null) {
      return {
        gpa: converted,
        gpaType: "4",
        provenance: "legacy_letter",
      };
    }
  }

  return {
    gpa: "3",
    gpaType: "4",
    provenance: "policy_default",
  };
}

export interface AltinbasLegacyEducationResolution {
  schoolName: string | null;
  country: string;
  endYear: number;
  gpa: string;
  gpaType: string;
  fallbackFields: string[];
  gpaProvenance: AltinbasLegacyGpaResolution["provenance"];
}

/**
 * Complete a historical education row from legacy CRM fields. School identity
 * remains fail-closed: unlike country/year/GPA, it is never invented.
 */
export function resolveAltinbasLegacyEducation(input: {
  record?: {
    schoolName?: string | null;
    country?: string | null;
    endYear?: number | null;
    gpa?: string | null;
    gpaType?: string | null;
  };
  level: "high_school" | "bachelor" | "master";
  applicationLevel: "associate" | "bachelor" | "master" | "phd";
  legacySchoolName?: string;
  fallbackCountry: string;
  legacyGraduationYear?: number;
  legacyGpa?: unknown;
  dateOfBirth?: string;
  currentYear?: number;
}): AltinbasLegacyEducationResolution {
  const record = input.record || {};
  const fallbackFields: string[] = [];
  const schoolName =
    record.schoolName?.trim() || input.legacySchoolName?.trim() || null;
  if (!record.schoolName?.trim() && schoolName) fallbackFields.push("schoolName");

  const country = record.country?.trim() || input.fallbackCountry.trim();
  if (!record.country?.trim()) fallbackFields.push("country");

  let endYear = record.endYear || input.legacyGraduationYear;
  if (!record.endYear) {
    fallbackFields.push("graduationYear");
    if (
      endYear &&
      input.applicationLevel === "phd" &&
      input.level === "bachelor"
    ) {
      endYear -= 2;
    }
  }
  if (!endYear) {
    const currentYear = input.currentYear || new Date().getUTCFullYear();
    const birthYear = Number(input.dateOfBirth?.match(/^(\d{4})/)?.[1]);
    const expectedAge =
      input.level === "high_school" ? 18 :
      input.level === "bachelor" ? 22 :
      24;
    endYear = Number.isFinite(birthYear)
      ? Math.min(currentYear, birthYear + expectedAge)
      : currentYear - 1;
  }

  const gpa = resolveAltinbasLegacyGpa({
    recordGpa: record.gpa,
    recordGpaType: record.gpaType,
    legacyGpa: input.legacyGpa,
  });
  if (!record.gpa?.trim()) fallbackFields.push("gpa");
  if (!altinbasGpaTypeLabel(record.gpaType)) fallbackFields.push("gpaType");

  return {
    schoolName,
    country,
    endYear,
    gpa: gpa.gpa,
    gpaType: gpa.gpaType,
    fallbackFields,
    gpaProvenance: gpa.provenance,
  };
}

/** Ambiguous/previous draft ids never become rollback deletion targets. */
export function selectAltinbasRollbackIds(input: {
  runCreatedIds: Iterable<string>;
  explicitAppIds: Iterable<string>;
}): string[] {
  void input.explicitAppIds;
  return [...new Set(input.runCreatedIds)]
    .filter((id) => /^a02[a-zA-Z0-9]{12}(?:[a-zA-Z0-9]{3})?$/.test(id));
}

export type AltinbasCanaryStage =
  | "Personal Information"
  | "Educational Information"
  | "Questionnaire";

/** Explicit env value → one allowed canary stage; Documents is never allowed. */
export function parseAltinbasCanaryStage(
  value: string | undefined,
): AltinbasCanaryStage | null {
  const normalized = String(value || "personal").trim().toLowerCase();
  if (normalized === "personal") return "Personal Information";
  if (normalized === "educational" || normalized === "education") {
    return "Educational Information";
  }
  if (normalized === "questionnaire") return "Questionnaire";
  return null;
}
