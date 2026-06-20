import crypto from "crypto";

/**
 * Meta Graph API version used across every Meta channel (WhatsApp Cloud API,
 * Messenger, Instagram). Kept as a single source of truth so all channels stay
 * on the same version. Aligned with the WhatsApp Cloud API version.
 */
export const META_API_VERSION = "v21.0";

/**
 * Verify the X-Hub-Signature-256 header from any Meta webhook request
 * (WhatsApp, Messenger, Instagram). Meta signs the raw request body with the
 * app secret using HMAC-SHA256 and sends the digest as `sha256=<hex>`.
 *
 * Returns false (reject) when either appSecret or signatureHeader is missing,
 * so unsigned/spoofed payloads are never accepted in production. The comparison
 * is constant-time to avoid leaking the expected digest via timing.
 */
export function verifyMetaSignature(
  rawBody: Buffer | string,
  signatureHeader: string | undefined,
  appSecret: string | undefined,
): boolean {
  if (!appSecret || !signatureHeader) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
  } catch {
    return false;
  }
}
