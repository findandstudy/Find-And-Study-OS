import crypto from "crypto";

export interface WebFormSubmission {
  externalMessageId: string;
  fromName?: string;
  email?: string;
  phone?: string;
  text: string;
  agentRef?: string | null;
  externalThreadId: string;
  receivedAt: Date;
  raw: any;
}

/**
 * Verify HMAC-SHA256 signature on a web form POST body.
 * Header expected as raw hex: X-Webform-Signature.
 */
export function verifyWebFormSignature(rawBody: Buffer | string, signatureHeader: string | undefined, secret: string | undefined): boolean {
  if (!secret) return true;
  if (!signatureHeader) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
  } catch {
    return false;
  }
}

/**
 * Parse a web form payload into a normalized inbound submission.
 * Expected shape (lenient): { name, email, phone, message, agent_ref, form_id, submission_id }
 */
export function parseWebFormPayload(payload: any): WebFormSubmission | null {
  if (!payload || typeof payload !== "object") return null;
  const text = String(payload.message || payload.text || payload.body || "").trim();
  const externalMessageId = String(
    payload.submission_id || payload.id || `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  );
  const externalThreadId = String(
    payload.thread_id || payload.email || payload.phone || externalMessageId,
  );
  const fromName = payload.name
    ? String(payload.name)
    : [payload.firstName, payload.lastName].filter(Boolean).join(" ").trim() || undefined;
  return {
    externalMessageId,
    fromName,
    email: payload.email ? String(payload.email) : undefined,
    phone: payload.phone ? String(payload.phone) : undefined,
    agentRef: payload.agent_ref ? String(payload.agent_ref) : null,
    text: text || "(no message body)",
    externalThreadId,
    receivedAt: new Date(),
    raw: payload,
  };
}
