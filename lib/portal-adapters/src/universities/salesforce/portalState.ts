import { fold } from "../../programMatch.js";

const PROGRAM_LEVEL_PREFIXES = [
  /^(?:bachelor(?:'s)?(?:\s+degree)?|undergraduate)\s+(?:of|in)\s+/i,
  /^(?:associate(?:'s)?(?:\s+degree)?)\s+(?:of|in)\s+/i,
  /^(?:master(?:'s)?(?:\s+degree)?|graduate)\s+(?:of|in)\s+/i,
  /^(?:ph\.?d\.?|doctorate|doctoral)\s+(?:of|in)\s+/i,
];

/**
 * Üsküdar and the related Salesforce portals show the degree level outside
 * the programme label. CRM names commonly include it as a prefix.
 */
export function salesforcePortalProgramName(crmProgramName: string): string {
  let value = crmProgramName.replace(/\s+/g, " ").trim();
  for (const prefix of PROGRAM_LEVEL_PREFIXES) {
    value = value.replace(prefix, "");
  }
  return value.trim();
}

export type SalesforceStage =
  | "Program Selection"
  | "Personal Information"
  | "Educational Information"
  | "Documents"
  | "Review and Submit"
  | "Completed"
  | null;

export function parseSalesforceStageMarker(
  value: string | null | undefined,
): SalesforceStage {
  return normalizeSalesforceStage(
    String(value ?? "").replace(/^\s*stage\s*:\s*/i, ""),
  );
}

export type SalesforceDocumentSlot =
  | "diploma"
  | "transcript"
  | "passport"
  | "photo"
  | "english"
  | null;

export function inferSalesforceDocumentSlot(
  metadata: string | null | undefined,
): SalesforceDocumentSlot {
  const value = fold(metadata ?? "");
  if (!value) return null;
  if (/\b(passport|pasaport)\b/.test(value)) return "passport";
  if (/\b(transcript|marks sheet|not dokumu|transkript)\b/.test(value)) {
    return "transcript";
  }
  if (
    /\b(diploma|diploma certificate|graduation certificate|mezuniyet belgesi)\b/.test(
      value,
    )
  ) {
    return "diploma";
  }
  if (/\b(photo|photograph|fotograf)\b/.test(value)) return "photo";
  if (/\b(english|toefl|ielts|language proficiency)\b/.test(value)) {
    return "english";
  }
  return null;
}

export function normalizeSalesforceStage(
  value: string | null | undefined,
): SalesforceStage {
  const normalized = fold(value ?? "");
  if (!normalized) return null;
  if (normalized === "program selection") return "Program Selection";
  if (normalized === "personal information") return "Personal Information";
  if (normalized === "educational information") {
    return "Educational Information";
  }
  if (normalized === "documents") return "Documents";
  if (normalized === "review and submit") return "Review and Submit";
  if (normalized === "completed") return "Completed";
  return null;
}

export interface SalesforceCompletionEvidence {
  activeStage?: string | null;
  applicationStatus?: string | null;
  trackStage?: string | null;
  externalRef?: string | null;
}

/**
 * A future step label in the wizard is never success. Success is either the
 * active Completed step, or a durable Track Applications row with an external
 * reference and an explicit submitted/completed status.
 */
export function hasSalesforceCompletionProof(
  evidence: SalesforceCompletionEvidence,
): boolean {
  if (normalizeSalesforceStage(evidence.activeStage) === "Completed") {
    return true;
  }

  const externalRef = (evidence.externalRef ?? "").trim();
  if (!externalRef) return false;

  const durableState = fold(
    `${evidence.applicationStatus ?? ""} ${evidence.trackStage ?? ""}`,
  );
  return /\b(submitted|completed|received)\b/.test(durableState);
}

export function isOwnedSalesforceApplicant(input: {
  firstName: string;
  lastName: string;
  email: string;
  rowName: string;
  rowEmail: string;
}): boolean {
  const expectedNames = new Set([
    fold(`${input.firstName} ${input.lastName}`),
    fold(`${input.lastName} ${input.firstName}`),
  ]);
  const rowName = fold(input.rowName);
  const rowEmail = input.rowEmail.trim().toLowerCase();
  const email = input.email.trim().toLowerCase();
  return (
    [...expectedNames].some(
      (name) => rowName === name || rowName.includes(name),
    ) &&
    (rowEmail === email ||
      rowEmail === `mailto:${email}` ||
      rowEmail.includes(email))
  );
}
