import crypto from "node:crypto";

const UUID_V7_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type SocialOperationsMode = "off" | "read" | "manage";

export function resolveSocialOperationsConfiguration(input: {
  configuredMode?: string;
  nodeEnv?: string;
  tenantId?: string;
  organizationId?: string;
}): {
  enabled: boolean;
  mode: SocialOperationsMode;
  reason: string | null;
} {
  const raw =
    input.configuredMode ?? (input.nodeEnv === "production" ? "off" : "manage");
  const normalized = raw.trim().toLowerCase();
  const mode: SocialOperationsMode =
    normalized === "read" || normalized === "manage" ? normalized : "off";
  if (mode === "off") {
    return { enabled: false, mode, reason: "SOCIAL_OPERATIONS_DISABLED" };
  }
  if (!UUID_V7_RE.test(input.tenantId ?? "")) {
    return {
      enabled: false,
      mode,
      reason: "SOCIAL_OPERATIONS_TENANT_INVALID",
    };
  }
  if (!UUID_V7_RE.test(input.organizationId ?? "")) {
    return {
      enabled: false,
      mode,
      reason: "SOCIAL_OPERATIONS_ORGANIZATION_INVALID",
    };
  }
  return { enabled: true, mode, reason: null };
}

export function nextSocialId(observedAt = Date.now()): string {
  const bytes = crypto.randomBytes(16);
  const timestamp = BigInt(observedAt);
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = Number((timestamp >> BigInt((5 - index) * 8)) & 0xffn);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  if (!UUID_V7_RE.test(id)) throw new Error("social_uuid_generation_failed");
  return id;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

export function socialHash(value: unknown): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalize(value)), "utf8")
    .digest("hex");
}
