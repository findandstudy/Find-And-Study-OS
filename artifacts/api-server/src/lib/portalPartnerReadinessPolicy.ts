export type PortalPartnerBlockerCode =
  | "ADAPTER_REQUIRED"
  | "SECURE_PORTAL_URL_REQUIRED"
  | "CREDENTIALS_REQUIRED"
  | "CATALOG_LINK_REQUIRED"
  | "ACTIVE_PROGRAM_REQUIRED";

export type PortalPartnerPhase =
  | "configuration_required"
  | "manual_pilot"
  | "activation_ready"
  | "automation_ready"
  | "automated";

export interface PortalPartnerReadinessInput {
  adapterRegistered: boolean;
  portalUrl: string | null;
  hasCredentials: boolean;
  catalogLinked: boolean;
  activeProgramCount: number;
  graduationRequired: boolean;
  successCount: number;
  graduationThreshold: number;
  isActive: boolean;
  autoProcess: boolean;
}

export interface PortalPartnerReadiness {
  configurationReady: boolean;
  manualPilotEligible: boolean;
  automaticEligible: boolean;
  blockers: PortalPartnerBlockerCode[];
  successProofsRemaining: number;
  requiredVerifications: readonly ["TEST_LOGIN", "STRICT_DRY_RUN"];
  phase: PortalPartnerPhase;
}

export function safePortalHttpsUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Pure, fail-closed partner onboarding projection.
 *
 * Login and strict dry-run are deliberately returned as required human
 * verifications rather than claimed complete: the current schema does not yet
 * hold version-bound receipts for either action. Durable real-submission
 * proofs remain the only graduation authority.
 */
export function computePortalPartnerReadiness(
  input: PortalPartnerReadinessInput,
): PortalPartnerReadiness {
  const blockers: PortalPartnerBlockerCode[] = [];
  if (!input.adapterRegistered) blockers.push("ADAPTER_REQUIRED");
  if (!safePortalHttpsUrl(input.portalUrl)) blockers.push("SECURE_PORTAL_URL_REQUIRED");
  if (!input.hasCredentials) blockers.push("CREDENTIALS_REQUIRED");
  if (!input.catalogLinked) blockers.push("CATALOG_LINK_REQUIRED");
  if (input.activeProgramCount < 1) blockers.push("ACTIVE_PROGRAM_REQUIRED");

  const configurationReady = blockers.length === 0;
  const successProofsRemaining = input.graduationRequired
    ? Math.max(0, input.graduationThreshold - Math.max(0, input.successCount))
    : 0;
  const automaticEligible = configurationReady && successProofsRemaining === 0;
  const manualPilotEligible = configurationReady && input.isActive;

  let phase: PortalPartnerPhase;
  if (!configurationReady) phase = "configuration_required";
  else if (successProofsRemaining > 0) phase = "manual_pilot";
  else if (!input.isActive) phase = "activation_ready";
  else if (!input.autoProcess) phase = "automation_ready";
  else phase = "automated";

  return {
    configurationReady,
    manualPilotEligible,
    automaticEligible,
    blockers,
    successProofsRemaining,
    requiredVerifications: ["TEST_LOGIN", "STRICT_DRY_RUN"],
    phase,
  };
}
