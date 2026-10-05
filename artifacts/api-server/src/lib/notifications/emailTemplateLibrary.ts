import { db, emailTemplateVersionsTable, messageTemplatesTable, NOTIFICATION_EVENTS } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { sanitizeContractTemplateHtml } from "../contractHtmlSanitizer";
import { PROGRAM_SUPPORTED_LOCALES } from "../programTranslationContract";

export const STAGE_EMAIL_TEMPLATE_VARIABLES = ["studentName", "firstName", "lastName", "universityName", "programName", "newStage", "newStageKey", "applicationId"] as const;
// Existing notification event variables; this catalogue adds no new events or data sources.
export const EMAIL_TEMPLATE_VARIABLES = [...STAGE_EMAIL_TEMPLATE_VARIABLES, "email", "phone", "oldStage", "validUntil", "daysLeft", "stageLabel",
  "nationality", "documentName", "documentType", "oldStatus", "newStatus", "amount", "dueDate", "agentName", "companyName", "businessName",
  "contractEndDate", "threshold", "message", "title", "senderName", "channel", "signerName", "signerEmail", "contractName", "contractLink",
  "verificationCode", "actorName", "taskTitle", "country", "expiryDate"] as const;
export const EMAIL_TEMPLATE_LANGUAGES = PROGRAM_SUPPORTED_LOCALES;
export const EMAIL_TEMPLATE_CATEGORIES = ["general", ...Object.keys(NOTIFICATION_EVENTS)];
export class EmailLibraryError extends Error {
  constructor(public readonly code: string, public readonly status = 400) { super(code); }
}
export function positiveEmailId(value: unknown): number {
  if (!(typeof value === "number" || typeof value === "string") || !/^[1-9]\d{0,9}$/.test(String(value))) throw new EmailLibraryError("EMAIL_INVALID_ID");
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id > 2147483647) throw new EmailLibraryError("EMAIL_INVALID_ID");
  return id;
}

/** There is no expression language, nested access, helpers, or runtime-generated data. */
export function extractEmailVariables(subject: string, content: string): string[] {
  const source = `${subject}\n${content}`;
  const variables = [...new Set([...source.matchAll(/\{\{\s*([A-Za-z][A-Za-z0-9]*)\s*\}\}/g)].map(match => match[1]))];
  if (/\{\{\{|\}\}\}/.test(source) || variables.some(key => !(EMAIL_TEMPLATE_VARIABLES as readonly string[]).includes(key))
    || /\{\{|\}\}/.test(source.replace(/\{\{\s*[A-Za-z][A-Za-z0-9]*\s*\}\}/g, ""))) {
    throw new EmailLibraryError("EMAIL_TEMPLATE_VARIABLE_INVALID");
  }
  return variables.sort();
}

export function validateEmailVersion(input: unknown): { subject: string; content: string; language: string; variables: string[] } {
  const data = input as Record<string, unknown> | null;
  if (!data || typeof data.subject !== "string" || !data.subject.trim() || data.subject.length > 250 || /[\r\n\x00]/.test(data.subject)
    || typeof data.content !== "string" || !data.content.trim() || data.content.length > 20_000
    || typeof data.language !== "string" || !(EMAIL_TEMPLATE_LANGUAGES as readonly string[]).includes(data.language)) {
    throw new EmailLibraryError("EMAIL_TEMPLATE_INVALID");
  }
  // Validate before and after sanitizing; silently dropping an unknown placeholder is unsafe.
  extractEmailVariables(data.subject, data.content);
  const content = sanitizeContractTemplateHtml(data.content);
  if (!content.trim()) throw new EmailLibraryError("EMAIL_TEMPLATE_EMPTY");
  return { subject: data.subject.trim(), content, language: data.language, variables: extractEmailVariables(data.subject, content) };
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

export function renderEmailVersionFields(version: { subject: string; content: string }, values: unknown): { subject: string; bodyHtml: string; variables: string[] } {
  if (!values || typeof values !== "object" || Array.isArray(values)) throw new EmailLibraryError("EMAIL_TEMPLATE_VARIABLES_REQUIRED");
  const data = values as Record<string, unknown>;
  if (Object.keys(data).some(key => !(EMAIL_TEMPLATE_VARIABLES as readonly string[]).includes(key))) throw new EmailLibraryError("EMAIL_TEMPLATE_VARIABLE_INVALID");
  const variables = extractEmailVariables(version.subject, version.content);
  for (const key of variables) {
    if (!Object.hasOwn(data, key) || typeof data[key] !== "string" || !(data[key] as string).trim() || (data[key] as string).length > 2000
      || /[\x00-\x1f\x7f]/.test(data[key] as string)) throw new EmailLibraryError("EMAIL_TEMPLATE_VARIABLE_MISSING");
  }
  const replace = (text: string, html: boolean) => text.replace(/\{\{\s*([A-Za-z][A-Za-z0-9]*)\s*\}\}/g, (_, key: string) => html ? escapeHtml(data[key] as string) : data[key] as string);
  const subject = replace(version.subject, false);
  if (subject.length > 998 || /[\r\n\x00]/.test(subject)) throw new EmailLibraryError("EMAIL_SUBJECT_INVALID");
  return { subject, bodyHtml: sanitizeContractTemplateHtml(replace(version.content, true)), variables };
}

export async function renderEmailVersion(version: { subject: string; content: string }, values: unknown) {
  const fields = renderEmailVersionFields(version, values);
  const { buildNotificationEmail } = await import("../email");
  const rendered = await buildNotificationEmail(fields);
  // Includes branding, which is also configurable and must not inject active content in preview.
  return { ...rendered, html: sanitizeContractTemplateHtml(rendered.html), variables: fields.variables };
}

export async function renderApprovedEmailVersion(versionId: number, values: Record<string, string>): Promise<{ subject: string; html: string; text: string } | null> {
  positiveEmailId(versionId);
  const [row] = await db.select({ version: emailTemplateVersionsTable }).from(emailTemplateVersionsTable)
    .innerJoin(messageTemplatesTable, eq(messageTemplatesTable.id, emailTemplateVersionsTable.templateId))
    .where(and(eq(emailTemplateVersionsTable.id, versionId), eq(emailTemplateVersionsTable.status, "approved"),
      eq(messageTemplatesTable.isActive, true), inArray(messageTemplatesTable.channel, ["email", "all"]))).limit(1);
  if (!row) return null;
  try {
    // Event producers can carry unrelated context fields. Only declared, referenced values enter a version.
    const referenced = extractEmailVariables(row.version.subject, row.version.content);
    const selected = Object.fromEntries(referenced.filter(key => Object.hasOwn(values, key)).map(key => [key, values[key]]));
    const { subject, html, text } = await renderEmailVersion(row.version, selected);
    return { subject, html, text };
  }
  catch (error) { if (error instanceof EmailLibraryError) return null; throw error; }
}

export function canTransitionEmailVersion(status: string, target: string, maker: number, actor: number): boolean {
  return (status === "draft" && target === "review") || (status === "review" && target === "approved" && maker !== actor)
    || (status === "approved" && target === "retired");
}
