import type { StageAutomaticEmail } from "@workspace/db";

export function stageEmailRuntime(env = process.env): { enabled: boolean; since: Date | null } {
  const raw = env.PIPELINE_EMAIL_AUTOMATION_SINCE;
  const since = raw && /^\d{4}-\d{2}-\d{2}T/.test(raw) ? new Date(raw) : null;
  return {
    enabled: env.PIPELINE_EMAIL_AUTOMATION_ENABLED === "true" && !!since && Number.isFinite(since.getTime()),
    since: since && Number.isFinite(since.getTime()) ? since : null,
  };
}

export function parseStageAutomaticEmail(raw: unknown): StageAutomaticEmail | null {
  if (raw == null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) throw new Error("EMAIL_CONFIGURATION_INVALID");
  const value = raw as Record<string, unknown>;
  if (value.enabled === false) return null;
  if (value.enabled !== true) throw new Error("EMAIL_CONFIGURATION_INVALID");
  const id = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v > 0 && v < 1_000_000_000;
  if (!id(value.templateVersionId) || !id(value.senderAccountId)) throw new Error("EMAIL_TEMPLATE_SENDER_REQUIRED");
  const origins = value.originTypes ?? ["direct"];
  if (!Array.isArray(origins) || !origins.length || origins.length > 3 ||
    origins.some(origin => !["direct", "agent", "sub_agent"].includes(origin))) throw new Error("EMAIL_ORIGIN_INVALID");
  return { enabled: true, templateVersionId: value.templateVersionId as number,
    senderAccountId: value.senderAccountId as number, originTypes: [...new Set(origins)] };
}

export function stageEmailOrigin(agentId: number | null, parentAgentId: number | null): "direct" | "agent" | "sub_agent" {
  return agentId == null ? "direct" : parentAgentId == null ? "agent" : "sub_agent";
}

/** PostgreSQL JSONB reorders object keys; origin selection is a set, not a sequence. */
export function stageEmailConfigsEqual(left: unknown, right: unknown): boolean {
  const canonical = (value: unknown) => {
    const parsed = parseStageAutomaticEmail(value);
    return parsed ? JSON.stringify({ ...parsed, originTypes: [...parsed.originTypes].sort() }) : "null";
  };
  try { return canonical(left) === canonical(right); } catch { return false; }
}

export function stageEmailRecipient(value: {
  studentEmail: string | null; userEmail: string | null; verified: boolean | null; active: boolean | null;
}): string | null {
  const email = value.studentEmail?.trim().toLowerCase() ?? "";
  if (!value.verified || !value.active || email !== value.userEmail?.trim().toLowerCase() ||
    email.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) || /[\r\n]/.test(email)) return null;
  return email;
}
