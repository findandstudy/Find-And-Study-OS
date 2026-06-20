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

/**
 * A normalized inbound message shared by every Meta Messaging channel
 * (Messenger and Instagram DMs). Both channels deliver structurally identical
 * `entry[].messaging[]` events, so they map onto the same shape.
 */
export interface MetaAttachment {
  type: string;
  url?: string;
}

export interface MetaInbound {
  channel: "messenger" | "instagram";
  /** The sender's page-scoped (PSID) / IG-scoped (IGSID) id. Also the thread key. */
  externalUserId: string;
  displayName?: string;
  text: string;
  externalMessageId: string;
  attachments?: MetaAttachment[];
  timestamp: Date;
  raw: Record<string, unknown>;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

/**
 * Parse a Meta Messaging webhook payload (`object: "page"` for Messenger or
 * `object: "instagram"` for Instagram DMs) into normalized inbound messages.
 *
 * Only user-sent messages are returned. Delivery / read receipts, postbacks,
 * and echoes of our own outbound messages are skipped. Comment / feed events
 * (`entry[].changes[]`) are ignored here — they carry no `messaging[]` array —
 * and are handled in a later comments phase.
 */
export function parseMetaMessaging(
  payload: unknown,
  channel: "messenger" | "instagram",
): MetaInbound[] {
  const out: MetaInbound[] = [];
  const root = asRecord(payload);
  const entries = Array.isArray(root.entry) ? (root.entry as unknown[]) : [];
  for (const entryRaw of entries) {
    const entry = asRecord(entryRaw);
    const messaging = Array.isArray(entry.messaging) ? (entry.messaging as unknown[]) : [];
    for (const evtRaw of messaging) {
      const evt = asRecord(evtRaw);
      // Only message events carry a `message` object; skip delivery/read/postback.
      if (!evt.message || typeof evt.message !== "object") continue;
      const message = asRecord(evt.message);
      // Skip echoes of our own outbound messages.
      if (message.is_echo === true) continue;
      const mid = typeof message.mid === "string" ? message.mid : "";
      if (!mid) continue;
      const sender = asRecord(evt.sender);
      const externalUserId =
        typeof sender.id === "string"
          ? sender.id
          : sender.id != null
            ? String(sender.id)
            : "";
      if (!externalUserId) continue;

      const attachmentsRaw = Array.isArray(message.attachments)
        ? (message.attachments as unknown[])
        : [];
      const attachments: MetaAttachment[] = attachmentsRaw.map((a) => {
        const att = asRecord(a);
        const payloadObj = asRecord(att.payload);
        return {
          type: typeof att.type === "string" ? att.type : "unknown",
          url: typeof payloadObj.url === "string" ? payloadObj.url : undefined,
        };
      });

      const rawText = typeof message.text === "string" ? message.text : "";
      let text = rawText;
      if (!text) {
        text = attachments.length > 0 ? `[${attachments[0].type}]` : "[message]";
      }

      // Meta messaging timestamps are epoch milliseconds.
      const tsNum =
        typeof evt.timestamp === "number" ? evt.timestamp : Number(evt.timestamp);
      const timestamp = Number.isFinite(tsNum) && tsNum > 0 ? new Date(tsNum) : new Date();

      out.push({
        channel,
        externalUserId,
        text,
        externalMessageId: mid,
        attachments: attachments.length > 0 ? attachments : undefined,
        timestamp,
        raw: evt,
      });
    }
  }
  return out;
}

/**
 * Returns true when any entry carries a `changes[]` array — i.e. a feed /
 * comment / mention event rather than a DM. The unified Meta route logs and
 * skips these (handled in the comments phase).
 */
export function hasMetaChanges(payload: unknown): boolean {
  const root = asRecord(payload);
  const entries = Array.isArray(root.entry) ? (root.entry as unknown[]) : [];
  return entries.some((e) => {
    const changes = asRecord(e).changes;
    return Array.isArray(changes) && changes.length > 0;
  });
}
