import { db, channelAccountsTable, integrationsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { decryptConfig } from "../encryption";
import { ObjectStorageService } from "../objectStorage";

/**
 * Single source of truth for Zernio outbound sends.
 *
 * Both the manual staff reply (routes/inbox.ts) and the AI bot auto-reply
 * (lib/inbox/botAutoReply.ts) MUST send through here for Zernio-hosted
 * conversations. The historical bug: bot replies went through the direct
 * Meta Graph API senders with a Zernio-hosted account → Zernio/WhatsApp
 * rejected with "The account is not registered".
 */

export interface ZernioAttachment {
  url: string;
  type?: string;
  name?: string;
}

export interface ZernioSendParams {
  /** Zernio conversation id (conversations.external_thread_id). */
  externalThreadId: string;
  /** Zernio account id (channel_accounts.external_account_id). */
  externalAccountId: string;
  text?: string;
  attachments?: ZernioAttachment[];
}

export interface ZernioSendOutcome {
  /** True when at least one payload (text or attachment) was accepted. */
  ok: boolean;
  /** Set when any payload failed — can coexist with ok=true (partial send). */
  error?: string;
  externalMessageId?: string;
}

// Test injection seam — unit tests replace the network call.
let __zernioSendOverride: ((params: ZernioSendParams) => Promise<ZernioSendOutcome>) | null = null;
export function __setZernioSendOverrideForTests(
  fn: ((params: ZernioSendParams) => Promise<ZernioSendOutcome>) | null,
): void {
  __zernioSendOverride = fn;
}

/**
 * Resolve the conversation's channel account IF it is Zernio-hosted.
 * Returns null when the account is absent or belongs to another provider —
 * callers then fall back to the direct channel senders.
 */
export async function resolveZernioAccount(
  channelAccountId: number | null | undefined,
): Promise<{ id: number; externalAccountId: string } | null> {
  if (channelAccountId == null) return null;
  const [acct] = await db
    .select()
    .from(channelAccountsTable)
    .where(
      and(
        eq(channelAccountsTable.id, channelAccountId),
        eq(channelAccountsTable.provider, "zernio"),
      ),
    );
  if (!acct || !acct.externalAccountId) return null;
  return { id: acct.id, externalAccountId: acct.externalAccountId };
}

/** Read the (encrypted) Zernio API key from the integrations row. */
export async function getZernioApiKey(): Promise<string | null> {
  const [row] = await db
    .select()
    .from(integrationsTable)
    .where(eq(integrationsTable.key, "zernio"));
  if (!row) return null;
  const cfg = decryptConfig(row.config as Record<string, any>) as { apiKey?: string };
  return cfg.apiKey || null;
}

/** Never log the raw API key — only enough to correlate log lines by eye. */
function maskApiKey(key: string): string {
  if (key.length <= 8) return "****";
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

/**
 * Send a text and/or attachments to a Zernio conversation.
 * Text goes first; each attachment is a separate POST (Zernio API shape).
 * `ok` mirrors "anything was delivered"; `error` carries the first failure so
 * a partial send is reported as sent-with-error (same semantics the manual
 * inbox route always had).
 *
 * STRICT CONTRACT (do not weaken): a send is only ever considered successful
 * when Zernio replies 2xx AND the response body contains a `messageId`. A 2xx
 * with no `messageId` is treated as a failure — Zernio has historically
 * returned 2xx for payloads it silently dropped (e.g. unreachable
 * attachmentUrl), which previously caused messages to be marked "sent" while
 * nothing was actually delivered. Every request/response is logged in full
 * (API key masked) so a persistent contract mismatch is diagnosable from logs
 * alone.
 */
export async function sendViaZernio(params: ZernioSendParams): Promise<ZernioSendOutcome> {
  if (__zernioSendOverride) return __zernioSendOverride(params);

  const apiKey = await getZernioApiKey();
  if (!apiKey) return { ok: false, error: "zernio_api_key_not_configured" };
  if (!params.externalThreadId) return { ok: false, error: "zernio_no_external_thread" };

  const url = `https://zernio.com/api/v1/inbox/conversations/${encodeURIComponent(params.externalThreadId)}/messages`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  let ok = false;
  let error: string | undefined;
  let externalMessageId: string | undefined;

  try {
    const text = params.text?.trim();
    if (text) {
      console.log("[ZERNIO] text send request:", JSON.stringify({
        url,
        accountId: params.externalAccountId,
        externalThreadId: params.externalThreadId,
        textLength: text.length,
        auth: `Bearer ${maskApiKey(apiKey)}`,
      }));
      const resp = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ accountId: params.externalAccountId, message: text }),
      });
      const bodyText = await resp.text().catch(() => "");
      console.log(`[ZERNIO] text send response (${resp.status}):`, bodyText);
      if (resp.ok) {
        let data: any = {};
        try { data = JSON.parse(bodyText); } catch { /* non-JSON body */ }
        const messageId = data?.data?.messageId
          ? String(data.data.messageId)
          : data?.messageId
            ? String(data.messageId)
            : undefined;
        if (messageId) {
          ok = true;
          externalMessageId = messageId;
        } else {
          error = `Zernio text send returned ${resp.status} but no messageId in response: ${bodyText}`;
          console.error("[ZERNIO] " + error);
        }
      } else {
        error = `Zernio text send failed (${resp.status}): ${bodyText}`;
        console.error("[ZERNIO] " + error);
      }
    }
    if (params.attachments?.length && !error) {
      for (const att of params.attachments) {
        const outcome = await sendZernioAttachment(url, apiKey, params.externalAccountId, att);
        if (outcome.ok) {
          ok = true;
          if (!externalMessageId && outcome.externalMessageId) {
            externalMessageId = outcome.externalMessageId;
          }
        } else {
          error = outcome.error;
          break;
        }
      }
    }
  } catch (err: any) {
    error = `Zernio send error: ${err?.message || "Unknown"}`;
    console.error("[ZERNIO] send exception:", err?.stack || err);
  }

  return { ok, error, externalMessageId };
}

// ── Template send via Zernio ─────────────────────────────────────────────────

export interface ZernioTemplateSendParams {
  /** Zernio conversation id (conversations.external_thread_id). */
  externalThreadId: string;
  /** Zernio account id (channel_accounts.external_account_id). */
  externalAccountId: string;
  templateName: string;
  language: string;
  parameters?: string[];
}

/**
 * Send a WhatsApp template message through Zernio's conversation messages
 * endpoint (same URL as text sends, different body shape). This must be used
 * instead of the direct Meta Graph API for Zernio-hosted numbers.
 */
export async function sendZernioTemplate(params: ZernioTemplateSendParams): Promise<ZernioSendOutcome> {
  const apiKey = await getZernioApiKey();
  if (!apiKey) return { ok: false, error: "zernio_api_key_not_configured" };
  if (!params.externalThreadId) return { ok: false, error: "zernio_no_external_thread" };

  const url = `https://zernio.com/api/v1/inbox/conversations/${encodeURIComponent(params.externalThreadId)}/messages`;

  const components =
    params.parameters && params.parameters.length > 0
      ? [{ type: "body", parameters: params.parameters.map((p) => ({ type: "text", text: p })) }]
      : undefined;

  const body: Record<string, unknown> = {
    accountId: params.externalAccountId,
    type: "template",
    template: {
      name: params.templateName,
      language: { code: params.language },
      ...(components ? { components } : {}),
    },
  };

  console.log("[ZERNIO] send template request:", JSON.stringify({
    url,
    accountId: params.externalAccountId,
    externalThreadId: params.externalThreadId,
    templateName: params.templateName,
    language: params.language,
    paramCount: params.parameters?.length ?? 0,
    auth: `Bearer ${maskApiKey(apiKey)}`,
  }));

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const bodyText = await resp.text().catch(() => "");
    console.log(`[ZERNIO] send template response (${resp.status}):`, bodyText.slice(0, 600));

    if (!resp.ok) {
      const error = `Zernio template send failed (${resp.status}): ${bodyText}`;
      console.error("[ZERNIO] " + error);
      return { ok: false, error };
    }

    let data: any = {};
    try { data = JSON.parse(bodyText); } catch { /* non-JSON */ }
    const messageId = data?.data?.messageId
      ? String(data.data.messageId)
      : data?.messageId
        ? String(data.messageId)
        : undefined;

    if (messageId) {
      return { ok: true, externalMessageId: messageId };
    }

    // Some Zernio versions return 2xx with no messageId for template sends —
    // treat as success (template was accepted) but without a trackable id.
    console.warn("[ZERNIO] template send returned", resp.status, "but no messageId:", bodyText.slice(0, 200));
    return { ok: true, externalMessageId: undefined };
  } catch (err: any) {
    const error = `Zernio template send error: ${err?.message || "Unknown"}`;
    console.error("[ZERNIO] " + error, err?.stack || "");
    return { ok: false, error };
  }
}

// ── Attachment upload (2-step) ────────────────────────────────────────────────
// Step 1: POST https://zernio.com/api/v1/media/upload-direct with the file
//   bytes as multipart/form-data (field name "file") → { url, filename,
//   contentType, size }.  The returned `url` is publicly accessible.
// Step 2: POST the conversation messages endpoint as JSON with
//   { accountId, message?, attachmentUrl: <url>, attachmentType: <type> }.
//
// The old approach (posting multipart directly to the messages endpoint) let
// Zernio return 200 with no messageId while silently dropping the attachment.
// Now a missing messageId on the send step still marks the message failed, but
// we should never reach that branch if upload-direct succeeded.

let _storage: ObjectStorageService | null = null;
function getStorage(): ObjectStorageService {
  if (!_storage) _storage = new ObjectStorageService();
  return _storage;
}

/**
 * The inbox composer builds attachment URLs as
 * `${origin}/api/storage/public-objects/${objectPath}` where `objectPath` is
 * the value returned by the upload-URL endpoint — which already carries a
 * leading `/objects/` prefix meant for the AUTHENTICATED `/storage/objects/*`
 * route, not this public one. That produces keys like
 * `/objects/inbox/<uuid>` (with a stray leading slash, i.e. a `//` in the
 * full URL) instead of the real on-disk key `inbox/<uuid>`. Normalize away
 * both artifacts here so we resolve to the same key the storage layer
 * actually used when writing the file.
 */
function normalizePublicObjectKey(raw: string): string {
  let key = raw.replace(/^\/+/, "");
  key = key.replace(/^objects\//, "");
  key = key.replace(/\/{2,}/g, "/");
  return key;
}

/**
 * Load the attachment bytes. Attachments uploaded from the inbox composer have
 * URLs of the form `${origin}/api/storage/public-objects/<objectPath>`; we
 * read those straight from our own storage (no HTTP round-trip). Anything else
 * is fetched over HTTP as a best effort.
 */
async function downloadAttachmentBytes(
  attUrl: string,
): Promise<{ buf: Buffer; contentType: string } | null> {
  try {
    const withoutQuery = attUrl.split("?")[0];
    const match = withoutQuery.match(/\/api\/storage\/public-objects\/(.+)$/);
    if (match) {
      const rawFilePath = decodeURIComponent(match[1]);
      const filePath = normalizePublicObjectKey(rawFilePath);
      if (filePath.includes("..") || filePath.includes("\\")) return null;
      console.log("[ZERNIO] resolving attachment storage key:", { rawFilePath, filePath });
      const file = await getStorage().searchPublicObject(filePath);
      if (!file) {
        console.warn("[ZERNIO] attachment object not found in storage:", filePath);
        return null;
      }
      const [buf] = await file.download();
      const [meta] = await file.getMetadata();
      return { buf, contentType: meta.contentType || "application/octet-stream" };
    }
    // External URL — fetch without credentials.
    const resp = await fetch(attUrl);
    if (!resp.ok) {
      console.warn(`[ZERNIO] attachment fetch failed (${resp.status}) for external URL`);
      return null;
    }
    const buf = Buffer.from(await resp.arrayBuffer());
    return { buf, contentType: resp.headers.get("content-type") || "application/octet-stream" };
  } catch (err: any) {
    console.warn("[ZERNIO] attachment byte load error:", err?.message || err);
    return null;
  }
}

/** Map MIME type to the Zernio attachmentType enum. */
function mimeToZernioAttachmentType(contentType: string): string {
  if (contentType.startsWith("image/")) return "image";
  if (contentType.startsWith("video/")) return "video";
  if (contentType.startsWith("audio/")) return "audio";
  return "file";
}

/**
 * Two-step attachment delivery:
 *   1. Upload the raw bytes to /v1/media/upload-direct (multipart, field "file")
 *      → Zernio returns { url, filename, contentType, size }; the url is public.
 *   2. POST the conversation messages endpoint as JSON with attachmentUrl + attachmentType.
 *
 * Sending multipart directly to the messages endpoint returned 200 with no
 * messageId (Zernio silently dropped the file). upload-direct is the correct
 * path per Zernio docs.
 *
 * STRICT CONTRACT: only a 2xx messages response that contains a `messageId`
 * counts as delivered.  upload-direct failure → immediate failed, no send attempt.
 */
async function sendZernioAttachment(
  messagesUrl: string,
  apiKey: string,
  externalAccountId: string,
  att: ZernioAttachment,
): Promise<ZernioSendOutcome> {
  const name = att.name || "attachment";
  const bytes = await downloadAttachmentBytes(att.url);

  if (!bytes) {
    const error = `Zernio attachment bytes unavailable for "${name}" (source url: ${att.url})`;
    console.error("[ZERNIO] " + error);
    return { ok: false, error };
  }

  // ── Step 1: upload-direct ────────────────────────────────────────────────
  const uploadUrl = "https://zernio.com/api/v1/media/upload-direct";
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes.buf)], { type: bytes.contentType }), name);
  form.append("contentType", bytes.contentType);

  console.log("[ZERNIO] upload-direct request:", JSON.stringify({
    uploadUrl,
    fileName: name,
    fileSize: bytes.buf.length,
    contentType: bytes.contentType,
    auth: `Bearer ${maskApiKey(apiKey)}`,
  }));

  const uploadResp = await fetch(uploadUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` }, // no Content-Type — fetch sets the boundary
    body: form,
  });
  const uploadBodyText = await uploadResp.text().catch(() => "");
  console.log(`[ZERNIO] upload-direct response (${uploadResp.status}):`, uploadBodyText);

  if (!uploadResp.ok) {
    const error = `Zernio upload-direct failed (${uploadResp.status}): ${uploadBodyText}`;
    console.error("[ZERNIO] " + error);
    return { ok: false, error };
  }

  let uploadData: any = {};
  try { uploadData = JSON.parse(uploadBodyText); } catch { /* non-JSON */ }
  const publicUrl: string | undefined = uploadData?.url;
  if (!publicUrl) {
    const error = `Zernio upload-direct returned ${uploadResp.status} but no url in response: ${uploadBodyText}`;
    console.error("[ZERNIO] " + error);
    return { ok: false, error };
  }

  // ── Step 2: send-inbox-message via JSON ──────────────────────────────────
  const attachmentType = mimeToZernioAttachmentType(uploadData?.contentType || bytes.contentType);
  const sendBody: Record<string, string> = {
    accountId: externalAccountId,
    attachmentUrl: publicUrl,
    attachmentType,
  };

  console.log("[ZERNIO] send-attachment request:", JSON.stringify({
    messagesUrl,
    attachmentUrl: publicUrl,
    attachmentType,
    auth: `Bearer ${maskApiKey(apiKey)}`,
  }));

  const sendResp = await fetch(messagesUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(sendBody),
  });
  const sendBodyText = await sendResp.text().catch(() => "");
  console.log(`[ZERNIO] send-attachment response (${sendResp.status}):`, sendBodyText);

  if (!sendResp.ok) {
    const error = `Zernio send-attachment failed (${sendResp.status}): ${sendBodyText}`;
    console.error("[ZERNIO] " + error);
    return { ok: false, error };
  }

  let sendData: any = {};
  try { sendData = JSON.parse(sendBodyText); } catch { /* non-JSON */ }
  const messageId = sendData?.data?.messageId
    ? String(sendData.data.messageId)
    : sendData?.messageId
      ? String(sendData.messageId)
      : undefined;
  if (messageId) {
    return { ok: true, externalMessageId: messageId };
  }

  const error = `Zernio send-attachment returned ${sendResp.status} but no messageId in response: ${sendBodyText}`;
  console.error("[ZERNIO] " + error);
  return { ok: false, error };
}
