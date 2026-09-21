import { createHash } from "node:crypto";

export function emailDeliveryAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV === "test" || env.EMAIL_DELIVERY_DISABLED === "true") return false;
  if (env.EMAIL_DELIVERY_DISABLED !== undefined && !["true", "false"].includes(env.EMAIL_DELIVERY_DISABLED)) return false;
  if (env.ALLOW_LIVE_INTEGRATIONS !== undefined && env.ALLOW_LIVE_INTEGRATIONS !== "true") return false;
  return env.NODE_ENV === "production" || env.ALLOW_LIVE_INTEGRATIONS === "true";
}

export const EMAIL_ATTACHMENT_LIMITS = Object.freeze({ count: 5, totalBytes: 10 * 1024 * 1024 });
export type QueueAttachment = { filename: string; contentBase64: string; contentType?: string; sha256: string };
export type BufferAttachment = { filename: string; content: Buffer; contentType?: string };

function attachmentMetadata(filename: unknown, contentType: unknown): boolean {
  return typeof filename === "string" && filename.length > 0 && filename.length <= 240
    && !/[\x00-\x1f\x7f/\\]/.test(filename)
    && (contentType === undefined || (typeof contentType === "string" && /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(contentType)));
}

export function serializeEmailAttachments(attachments?: BufferAttachment[]): QueueAttachment[] | null {
  if (attachments === undefined) return null;
  if (!Array.isArray(attachments) || attachments.length > EMAIL_ATTACHMENT_LIMITS.count) throw new Error("EMAIL_ATTACHMENT_INVALID");
  if (!attachments.length) return null;
  let total = 0;
  return attachments.map((item) => {
    if (!item || !attachmentMetadata(item.filename, item.contentType) || !Buffer.isBuffer(item.content)) throw new Error("EMAIL_ATTACHMENT_INVALID");
    total += item.content.length;
    if (total > EMAIL_ATTACHMENT_LIMITS.totalBytes) throw new Error("EMAIL_ATTACHMENT_TOO_LARGE");
    return { filename: item.filename, contentBase64: item.content.toString("base64"), ...(item.contentType ? { contentType: item.contentType } : {}), sha256: createHash("sha256").update(item.content).digest("hex") };
  });
}

export function deserializeEmailAttachments(value: unknown): BufferAttachment[] | undefined {
  if (value == null) return undefined;
  if (!Array.isArray(value) || value.length > EMAIL_ATTACHMENT_LIMITS.count) throw new Error("EMAIL_ATTACHMENT_INVALID");
  let total = 0;
  return value.map((item: QueueAttachment) => {
    if (!item || !attachmentMetadata(item.filename, item.contentType) || typeof item.contentBase64 !== "string"
      || item.contentBase64.length > Math.ceil(EMAIL_ATTACHMENT_LIMITS.totalBytes / 3) * 4
      || /[^A-Za-z0-9+/=]/.test(item.contentBase64)) throw new Error("EMAIL_ATTACHMENT_INVALID");
    const content = Buffer.from(item.contentBase64, "base64");
    total += content.length;
    // Buffer's decoder is permissive. Round-trip enforces canonical padding without
    // a nested/repeated regex whose engine stack overflows on normal PDF sizes.
    if (total > EMAIL_ATTACHMENT_LIMITS.totalBytes || content.toString("base64") !== item.contentBase64
      || createHash("sha256").update(content).digest("hex") !== item.sha256) throw new Error("EMAIL_ATTACHMENT_INVALID");
    return { filename: item.filename, content, ...(item.contentType ? { contentType: item.contentType } : {}) };
  });
}

/** Exactly one mailbox is allowed. Commas/newlines must not expand recipients. */
export function isEmailMailbox(value: unknown): value is string {
  return typeof value === "string" && value.length <= 254 && /^[^\s\x00-\x1f\x7f@<>(),;:"\\]+@[^\s\x00-\x1f\x7f@<>(),;:"\\]+\.[^\s\x00-\x1f\x7f@<>(),;:"\\]+$/.test(value);
}

export type EmailAttemptResult = {
  status: "sent" | "pending" | "failed" | "unknown" | "blocked";
  code: string | null;
  messageId?: string;
};

const STAGE_EMAIL_POLICY_CODES = new Set([
  "AUTOMATION_INACTIVE_OR_HISTORICAL", "STAGE_EMAIL_EXPIRED", "RECORD_SCOPE_OR_STAGE_CHANGED",
  "STAGE_POLICY_CHANGED", "TEMPLATE_NOT_APPROVED", "SENDER_CHANGED_OR_UNVERIFIED",
  "STUDENT_EMAIL_MISSING_OR_UNVERIFIED", "STAGE_INTENT_NOT_FOUND", "RECIPIENT_CHANGED",
  "STAGE_EMAIL_CONTEXT_CHANGED",
]);
/** Persist known operational codes, never arbitrary provider/database exception text. */
export function stageEmailDeliveryErrorCode(value: unknown): string {
  return typeof value === "string" && STAGE_EMAIL_POLICY_CODES.has(value) ? value : "STAGE_EMAIL_POLICY_BLOCKED";
}

export function classifyEmailTransportError(error: unknown): EmailAttemptResult {
  const e = (error || {}) as { code?: unknown; responseCode?: unknown; command?: unknown };
  if (e.code === "EAUTH") return { status: "failed", code: "SMTP_AUTH_FAILED" };
  if (e.code === "EENVELOPE") return { status: "failed", code: "SMTP_RECIPIENT_REJECTED" };
  const responseCode = Number(e.responseCode);
  if (responseCode >= 400 && responseCode < 500) return { status: "pending", code: "SMTP_TEMPORARY_REJECTED" };
  if (responseCode >= 500 && responseCode < 600) return { status: "failed", code: "SMTP_REJECTED" };
  // No DATA was sent for these explicitly pre-envelope failures. Everything
  // else is ambiguous: a timeout/disconnect can happen after SMTP acceptance.
  if (e.command === "CONN" || e.command === "EHLO" || e.command === "HELO" || e.command === "STARTTLS" || e.command === "AUTH") {
    return { status: "pending", code: "SMTP_CONNECTION_FAILED" };
  }
  return { status: "unknown", code: "SMTP_OUTCOME_UNKNOWN" };
}

export function emailRetryResult(result: EmailAttemptResult, retryCount: number, maxRetries: number) {
  if (result.status !== "pending" || result.code === "EMAIL_DELIVERY_DISABLED") return { ...result, retryCount, backoffSeconds: null };
  const nextCount = retryCount + 1;
  return nextCount >= maxRetries
    ? { ...result, status: "failed" as const, retryCount: nextCount, backoffSeconds: null }
    : { ...result, retryCount: nextCount, backoffSeconds: Math.pow(2, Math.min(nextCount, 8)) * 60 };
}

export type ClaimedEmail = {
  id: number;
  claim_token: string;
  to_email: string;
  subject: string;
  html_body: string;
  text_body: string;
  retry_count: number;
  max_retries: number;
  sender_account_id: number | null;
  sender_revision: number | null;
  template_version_id: number | null;
  idempotency_key: string | null;
  attachments: unknown;
};

/** A single logical owner handles both immediate sends and retry-worker sends.
 * There is no provider execution before a durable row is atomically claimed. */
export async function executeClaimedEmail(item: ClaimedEmail, deps: {
  allowed: () => boolean;
  send: (item: ClaimedEmail, attachments?: BufferAttachment[]) => Promise<EmailAttemptResult>;
  save: (item: ClaimedEmail, result: ReturnType<typeof emailRetryResult>) => Promise<void>;
  onSaveFailure: () => void;
}): Promise<boolean> {
  let result: EmailAttemptResult;
  if (!deps.allowed()) result = { status: "pending", code: "EMAIL_DELIVERY_DISABLED" };
  else {
    try {
      if (!isEmailMailbox(item.to_email) || typeof item.subject !== "string" || item.subject.length > 998 || /[\r\n\x00]/.test(item.subject)
        || typeof item.html_body !== "string" || typeof item.text_body !== "string"
        || Buffer.byteLength(item.html_body) + Buffer.byteLength(item.text_body) > 2 * 1024 * 1024) throw new Error("EMAIL_ENVELOPE_INVALID");
      const attachments = deserializeEmailAttachments(item.attachments);
      result = await deps.send(item, attachments);
    } catch (error) {
      result = error instanceof Error && /^(EMAIL_ATTACHMENT_|EMAIL_ENVELOPE_)/.test(error.message)
        ? { status: "blocked", code: "EMAIL_CONTENT_INVALID" }
        : { status: "unknown", code: "SMTP_OUTCOME_UNKNOWN" };
    }
  }
  try { await deps.save(item, emailRetryResult(result, item.retry_count, item.max_retries)); }
  catch { deps.onSaveFailure(); } // processing rows become UNKNOWN, never blindly retried.
  return result.status === "sent";
}
