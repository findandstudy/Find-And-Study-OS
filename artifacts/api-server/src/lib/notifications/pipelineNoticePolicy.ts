import { createHash } from "node:crypto";
export const PIPELINE_RECIPIENTS = [
  "auto",
  "contact",
  "agent",
  "assignee",
] as const;
export type PipelineRecipient = (typeof PIPELINE_RECIPIENTS)[number];
export type PipelineNoticePolicy = {
  enabled: true;
  policyVersion: 2;
  recipientType: PipelineRecipient;
  configuredById: number;
  templateId?: number;
  channelAccountId?: number;
  templateVersionId?: number;
  senderAccountId?: number;
  originTypes: string[];
};
export function canonicalNotice(value: unknown): string {
  const normalize = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(normalize)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, x]) => [k, normalize(x)]),
          )
        : v;
  return JSON.stringify(normalize(value));
}
export function noticeHash(value: unknown): string {
  return createHash("sha256").update(canonicalNotice(value)).digest("hex");
}
export function pipelineNoticePolicy(
  raw: unknown,
  channel: "email" | "whatsapp",
): PipelineNoticePolicy | null {
  if (raw == null || (raw as any)?.enabled === false) return null;
  if (typeof raw !== "object" || Array.isArray(raw))
    throw Error("PIPELINE_NOTICE_CONFIG_INVALID");
  const v = raw as Record<string, unknown>;
  const positive = (n: unknown) =>
    typeof n === "number" && Number.isSafeInteger(n) && n > 0 && n < 1e9;
  if (
    v.enabled !== true ||
    v.policyVersion !== 2 ||
    !PIPELINE_RECIPIENTS.includes(v.recipientType as PipelineRecipient) ||
    !positive(v.configuredById) ||
    !positive(channel === "email" ? v.templateVersionId : v.templateId) ||
    !positive(channel === "email" ? v.senderAccountId : v.channelAccountId) ||
    !Array.isArray(v.originTypes) ||
    v.originTypes.length < 1 ||
    v.originTypes.length > 3 ||
    v.originTypes.some(
      (x) => !["direct", "agent", "sub_agent"].includes(String(x)),
    )
  )
    throw Error("PIPELINE_NOTICE_CONFIG_INVALID");
  return {
    enabled: true,
    policyVersion: 2,
    recipientType: v.recipientType as PipelineRecipient,
    configuredById: Number(v.configuredById),
    ...(channel === "email"
      ? {
          templateVersionId: Number(v.templateVersionId),
          senderAccountId: Number(v.senderAccountId),
        }
      : {
          templateId: Number(v.templateId),
          channelAccountId: Number(v.channelAccountId),
        }),
    originTypes: [...new Set(v.originTypes as string[])],
  };
}
export function preferenceAllows(event: string, preferences: unknown): boolean {
  const p =
    preferences &&
    typeof preferences === "object" &&
    !Array.isArray(preferences)
      ? (preferences as Record<string, unknown>)
      : {};
  const key = event.startsWith("lead.")
    ? "newLeads"
    : event.startsWith("application.") ||
        event.startsWith("student.") ||
        event.startsWith("work.")
      ? "applicationUpdates"
      : event.startsWith("document.")
        ? "documentAlerts"
        : event.startsWith("finance.")
          ? "financeAlerts"
          : null;
  return !key || p[key] !== false;
}
export function stageEvent(
  event: string,
): "application" | "student" | "lead" | null {
  return [
    "application.stage_changed",
    "application.offer_received",
    "application.visa_update",
  ].includes(event)
    ? "application"
    : event === "lead.stage_changed"
      ? "lead"
      : event === "student.status_changed"
        ? "student"
        : null;
}
