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
  raw: Record<string, unknown>;
}

/**
 * Verify HMAC-SHA256 signature on a web form POST body.
 * Header expected as raw hex: X-Webform-Signature.
 */
export function verifyWebFormSignature(rawBody: Buffer | string, signatureHeader: string | undefined, secret: string | undefined): boolean {
  if (!secret || secret.length < 16) return false;
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
export function parseWebFormPayload(payload: unknown): WebFormSubmission | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const bounded = (value: unknown, max: number) => String(value ?? "").trim().slice(0, max);
  const text = bounded(p.message || p.text || p.body || "", 10_000);
  // Idempotency: prefer caller-supplied submission_id/id. When absent (most plain
  // HTML form posts), derive a deterministic content hash so retries of the same
  // submission collapse to the same externalMessageId. Includes a coarse 1-hour
  // bucket so legitimate re-submissions later (e.g. user retries the next day)
  // are not silently de-duped.
  const explicitId = p.submission_id || p.id;
  let externalMessageId: string;
  if (explicitId) {
    externalMessageId = bounded(explicitId, 200);
  } else {
    const hourBucket = Math.floor(Date.now() / (60 * 60 * 1000));
    const hashInput = JSON.stringify({
      formId: p.form_id ?? null,
      email: p.email ?? null,
      phone: p.phone ?? null,
      text,
      bucket: hourBucket,
    });
    externalMessageId = `wf_${crypto.createHash("sha256").update(hashInput).digest("hex").slice(0, 24)}`;
  }
  const externalThreadId = bounded(
    p.thread_id || p.email || p.phone || externalMessageId,
    320,
  );
  const fromName = p.name
    ? bounded(p.name, 200)
    : bounded([p.firstName, p.lastName].filter(Boolean).join(" "), 200) || undefined;
  const safeRaw: Record<string, unknown> = {};
  for (const key of ["form_id", "submission_id", "utm_source", "utm_medium", "utm_campaign", "utm_content", "page_url"]) {
    const value = p[key];
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      safeRaw[key] = bounded(value, key === "page_url" ? 1000 : 200);
    }
  }
  return {
    externalMessageId,
    fromName,
    email: p.email ? bounded(p.email, 320) : undefined,
    phone: p.phone ? bounded(p.phone, 80) : undefined,
    agentRef: p.agent_ref ? bounded(p.agent_ref, 128) : null,
    text: text || "(no message body)",
    externalThreadId,
    receivedAt: new Date(),
    raw: safeRaw,
  };
}
