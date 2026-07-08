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
        const messageId = data?.messageId ? String(data.messageId) : undefined;
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

// ── Attachment upload (multipart) ─────────────────────────────────────────────
// Zernio cannot reliably download our public-objects URLs from the outside
// (VPS/ACL), so we upload the binary directly: download the file from our own
// object storage and POST it as multipart/form-data. There is INTENTIONALLY no
// fallback to the raw attachmentUrl JSON body anymore — Zernio previously
// accepted that JSON with a 2xx while silently failing to fetch the
// unreachable local URL, which made us mark attachment-less "sent" messages
// as delivered. If multipart fails (or bytes can't be loaded), the message is
// marked failed so the real Zernio response is visible instead of a false
// positive.

let _storage: ObjectStorageService | null = null;
function getStorage(): ObjectStorageService {
  if (!_storage) _storage = new ObjectStorageService();
  return _storage;
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
      const filePath = decodeURIComponent(match[1]);
      if (filePath.includes("..") || filePath.includes("\\")) return null;
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

/**
 * STRICT CONTRACT (see sendViaZernio doc comment): only a 2xx response that
 * also contains a `messageId` counts as delivered. There is no fallback to
 * the raw attachmentUrl JSON body — that path let Zernio 2xx an
 * undeliverable message and we'd wrongly mark it "sent".
 */
async function sendZernioAttachment(
  url: string,
  apiKey: string,
  externalAccountId: string,
  att: ZernioAttachment,
): Promise<ZernioSendOutcome> {
  const name = att.name || "attachment";
  const type = att.type ?? "file";
  const bytes = await downloadAttachmentBytes(att.url);

  if (!bytes) {
    const error = `Zernio attachment bytes unavailable for "${name}" (source url: ${att.url}) — cannot upload binary; NOT falling back to attachmentUrl JSON`;
    console.error("[ZERNIO] " + error);
    return { ok: false, error };
  }

  // Zernio's docs say "For binary file uploads, use multipart/form-data" but
  // the exact binary field name is not pinned down. Try `file` (docs wording)
  // first, then retry once with `attachment` on a 4xx. Every request and the
  // FULL response body is logged so a persistent contract mismatch (wrong
  // field name, wrong required fields, etc.) is diagnosable from logs alone.
  const fileFieldCandidates = ["file", "attachment"] as const;
  let lastError: string | undefined;
  for (const fileField of fileFieldCandidates) {
    const form = new FormData();
    form.append("accountId", externalAccountId);
    form.append("attachmentType", type);
    form.append("attachmentName", name);
    form.append(
      fileField,
      new Blob([new Uint8Array(bytes.buf)], { type: bytes.contentType }),
      name,
    );
    console.log("[ZERNIO] multipart attachment request:", JSON.stringify({
      url,
      fields: ["accountId", "attachmentType", "attachmentName", fileField],
      fileField,
      attachmentType: type,
      fileName: name,
      fileSize: bytes.buf.length,
      contentType: bytes.contentType,
      auth: `Bearer ${maskApiKey(apiKey)}`,
    }));
    const resp = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` }, // no Content-Type — fetch sets the boundary
      body: form,
    });
    const bodyText = await resp.text().catch(() => "");
    console.log(`[ZERNIO] multipart attachment response (${resp.status}, field=${fileField}):`, bodyText);
    if (resp.ok) {
      let data: any = {};
      try { data = JSON.parse(bodyText); } catch { /* non-JSON body */ }
      const messageId = data?.messageId ? String(data.messageId) : undefined;
      if (messageId) {
        return { ok: true, externalMessageId: messageId };
      }
      lastError = `Zernio multipart attachment returned ${resp.status} (field=${fileField}) but no messageId in response: ${bodyText}`;
      console.error("[ZERNIO] " + lastError);
      // Zernio accepted this field name (2xx) but the contract on the
      // response shape is broken — retrying the other field won't help.
      break;
    }
    lastError = `Zernio multipart attachment failed (${resp.status}, field=${fileField}): ${bodyText}`;
    console.error("[ZERNIO] " + lastError);
    // Retry with the alternate field name only on 4xx (contract mismatch);
    // a 5xx means Zernio itself is failing — don't hammer it.
    if (resp.status >= 500) break;
  }

  return { ok: false, error: lastError || "Zernio attachment send failed (unknown error)" };
}
