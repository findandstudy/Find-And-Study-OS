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
