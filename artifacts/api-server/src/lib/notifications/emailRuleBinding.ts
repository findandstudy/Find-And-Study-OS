import { db, emailTemplateVersionsTable, messageTemplatesTable, channelAccountsTable, NOTIFICATION_EVENTS, DEFAULT_NOTIFICATION_RULES } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";

export const REGISTERED_NOTIFICATION_EVENTS = new Set([
  ...Object.values(NOTIFICATION_EVENTS).flatMap(category => Object.keys(category.events)),
  ...DEFAULT_NOTIFICATION_RULES.map(rule => rule.event),
]);

export function emailPolicyErrorCode(error: unknown): string {
  const allowed = new Set(["EMAIL_RULE_TEMPLATE_INVALID", "EMAIL_RULE_BINDING_REQUIRED", "NOTIFICATION_EVENT_NOT_REGISTERED",
    "EMAIL_APPROVED_TEMPLATE_AND_VERIFIED_SENDER_REQUIRED", "EMAIL_VARIABLES_UNAVAILABLE_FOR_EVENT",
    "EMAIL_CONFIGURATION_INVALID", "EMAIL_TEMPLATE_SENDER_REQUIRED", "EMAIL_ORIGIN_INVALID", "EMAIL_APPLICATION_STAGES_ONLY"]);
  return error instanceof Error && allowed.has(error.message) ? error.message : "EMAIL_POLICY_UNAVAILABLE";
}

/** Persist only exact approved version + sender revision; unknown events do not create triggers. */
export async function bindNotificationEmailTemplate(raw: unknown, event: string): Promise<Record<string, unknown>> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("EMAIL_RULE_TEMPLATE_INVALID");
  const value = raw as Record<string, unknown>;
  if (value.emailTemplateVersionId == null && value.emailSenderAccountId == null) {
    return { ...value, emailTemplateVersionId: null, emailSenderAccountId: null, emailSenderRevision: null };
  }
  if (!Number.isSafeInteger(value.emailTemplateVersionId) || Number(value.emailTemplateVersionId) < 1 ||
    !Number.isSafeInteger(value.emailSenderAccountId) || Number(value.emailSenderAccountId) < 1) throw new Error("EMAIL_RULE_BINDING_REQUIRED");
  if (!REGISTERED_NOTIFICATION_EVENTS.has(event)) throw new Error("NOTIFICATION_EVENT_NOT_REGISTERED");
  const [version] = await db.select({ id: emailTemplateVersionsTable.id, variables: emailTemplateVersionsTable.variables }).from(emailTemplateVersionsTable)
    .innerJoin(messageTemplatesTable, eq(messageTemplatesTable.id, emailTemplateVersionsTable.templateId))
    .where(and(eq(emailTemplateVersionsTable.id, Number(value.emailTemplateVersionId)), eq(emailTemplateVersionsTable.status, "approved"),
      eq(messageTemplatesTable.isActive, true), inArray(messageTemplatesTable.channel, ["email", "all"])));
  const [sender] = await db.select({ metadata: channelAccountsTable.metadata }).from(channelAccountsTable)
    .where(and(eq(channelAccountsTable.id, Number(value.emailSenderAccountId)), eq(channelAccountsTable.channel, "email"),
      eq(channelAccountsTable.provider, "smtp"), eq(channelAccountsTable.isActive, true)));
  const config = (sender?.metadata as {emailSender?: {verified?: boolean; revision?: number}} | undefined)?.emailSender;
  if (!version || !config?.verified || !Number.isSafeInteger(config.revision) || config.revision! < 1) throw new Error("EMAIL_APPROVED_TEMPLATE_AND_VERIFIED_SENDER_REQUIRED");
  if (!emailVariablesFitEvent(event, version.variables)) throw new Error("EMAIL_VARIABLES_UNAVAILABLE_FOR_EVENT");
  return { ...value, emailSenderRevision: config.revision };
}

// Existing notification producers' advertised variables. A new template does not
// invent a producer or gain access to unrelated record fields.
export const EMAIL_EVENT_VARIABLES: Record<string, readonly string[]> = {
  "lead.created": ["firstName","lastName","email","phone"],
  "lead.assigned": ["firstName","lastName"],
  "lead.stage_changed": ["firstName","lastName","oldStage","newStage"],
  "lead.follow_up_due": ["firstName","lastName"],
  "application.created": ["studentName","universityName","programName"],
  "application.stage_changed": ["studentName","universityName","programName","newStage","newStageKey"],
  "application.offer_received": ["studentName","universityName","programName"],
  "application.offer_letter_expiring": ["studentName","universityName","programName","validUntil","daysLeft","stageLabel"],
  "application.visa_update": ["studentName","universityName"],
  "student.created": ["firstName","lastName","email","nationality"],
  "student.document_uploaded": ["documentName","documentType"],
  "student.status_changed": ["firstName","lastName"],
  "finance.commission_confirmed": ["studentName","universityName","programName"],
  "finance.payment_received": ["studentName","amount"],
  "finance.payment_due": ["studentName","amount","dueDate"],
  "finance.agent_payout": ["agentName","amount"],
  "agent.new_registration": ["firstName","lastName","companyName","email"],
  "agent.sub_agent_added": ["firstName","lastName","email"],
  "agent.contract_expiring": ["agentName","businessName","contractEndDate","daysLeft","threshold"],
  "system.user_activated": ["firstName","lastName"],
  "system.broadcast": ["message"], "system.announcement": ["title","message"],
  "message.new": ["senderName"], "message.mention": ["senderName","channel"],
  "contract.sent": ["signerName","signerEmail","contractName","contractLink"],
  "contract.verification_code": ["verificationCode","contractName","signerName","signerEmail","contractLink"],
  "contract.signed": ["signerName","signerEmail","contractName","contractLink"],
};
export function emailVariablesFitEvent(event: string, variables: readonly string[]): boolean {
  return REGISTERED_NOTIFICATION_EVENTS.has(event) && variables.every(key => (EMAIL_EVENT_VARIABLES[event] ?? []).includes(key));
}
