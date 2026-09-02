export type InstitutionAdmissionsMode = "off" | "allowlist" | "all";

export type InstitutionAdmissionsFeatureDecision = {
  enabled: boolean;
  mode: InstitutionAdmissionsMode;
  reason:
    | "disabled"
    | "all"
    | "allowlisted"
    | "not_allowlisted"
    | "invalid_configuration";
};

const MAX_ALLOWLIST_ENTRIES = 500;
const MAX_ALLOWLIST_BYTES = 4_096;

function parseAllowlist(raw: string | undefined): Set<number> | null {
  if (!raw || Buffer.byteLength(raw, "utf8") > MAX_ALLOWLIST_BYTES) return null;
  const values = raw.split(",").map((value) => value.trim());
  if (values.length === 0 || values.length > MAX_ALLOWLIST_ENTRIES) return null;
  const ids = new Set<number>();
  for (const value of values) {
    if (!/^[1-9]\d*$/.test(value)) return null;
    const id = Number(value);
    if (!Number.isSafeInteger(id)) return null;
    ids.add(id);
  }
  return ids;
}

export function resolveInstitutionAdmissionsFeature(input: {
  mode?: string;
  allowlist?: string;
  userId: number;
}): InstitutionAdmissionsFeatureDecision {
  if (input.mode === "all") return { enabled: true, mode: "all", reason: "all" };
  if (input.mode === "allowlist") {
    const allowlist = parseAllowlist(input.allowlist);
    if (!allowlist) {
      return { enabled: false, mode: "off", reason: "invalid_configuration" };
    }
    return allowlist.has(input.userId)
      ? { enabled: true, mode: "allowlist", reason: "allowlisted" }
      : { enabled: false, mode: "allowlist", reason: "not_allowlisted" };
  }
  if (input.mode == null || input.mode === "" || input.mode === "off") {
    return { enabled: false, mode: "off", reason: "disabled" };
  }
  return { enabled: false, mode: "off", reason: "invalid_configuration" };
}

export function isInstitutionAdmissionsEnabled(userId: number): boolean {
  return resolveInstitutionAdmissionsFeature({
    mode: process.env.INSTITUTION_ADMISSIONS_V1_MODE,
    allowlist: process.env.INSTITUTION_ADMISSIONS_V1_USER_IDS,
    userId,
  }).enabled;
}

// High-impact institution actions remain unusable in production until the
// authoritative active-context + step-up/maker-checker corridor is wired.
export function isLocalInstitutionAssuranceEnabled(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.INSTITUTION_ADMISSIONS_V1_LOCAL_ASSURANCE === "true"
  );
}
