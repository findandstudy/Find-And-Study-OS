export type StudentJourneyFeatureMode = "off" | "allowlist" | "all";

export type StudentJourneyFeatureDecision = {
  enabled: boolean;
  mode: StudentJourneyFeatureMode;
  reason: "disabled" | "all" | "allowlisted" | "not_allowlisted" | "invalid_configuration";
};

const MAX_ALLOWLIST_ENTRIES = 500;
const MAX_ALLOWLIST_BYTES = 4_096;

function parseAllowlist(raw: string | undefined): Set<number> | null {
  if (!raw || Buffer.byteLength(raw, "utf8") > MAX_ALLOWLIST_BYTES) return null;
  const entries = raw.split(",").map((entry) => entry.trim());
  if (entries.length === 0 || entries.length > MAX_ALLOWLIST_ENTRIES) return null;

  const ids = new Set<number>();
  for (const entry of entries) {
    if (!/^[1-9]\d*$/.test(entry)) return null;
    const id = Number(entry);
    if (!Number.isSafeInteger(id)) return null;
    ids.add(id);
  }
  return ids;
}

export function resolveStudentJourneyFeature(input: {
  mode?: string;
  allowlist?: string;
  userId: number;
}): StudentJourneyFeatureDecision {
  if (input.mode === "all") {
    return { enabled: true, mode: "all", reason: "all" };
  }
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

export function isStudentJourneyEnabled(userId: number): boolean {
  return resolveStudentJourneyFeature({
    mode: process.env.STUDENT_JOURNEY_V1_MODE,
    allowlist: process.env.STUDENT_JOURNEY_V1_USER_IDS,
    userId,
  }).enabled;
}
