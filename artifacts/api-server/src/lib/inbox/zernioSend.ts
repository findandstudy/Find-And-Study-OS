import { db, channelAccountsTable, integrationsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { decryptConfig } from "../encryption";

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

/**
 * Send a text and/or attachments to a Zernio conversation.
 * Text goes first; each attachment is a separate POST (Zernio API shape).
 * `ok` mirrors "anything was delivered"; `error` carries the first failure so
 * a partial send is reported as sent-with-error (same semantics the manual
 * inbox route always had).
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
      const resp = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ accountId: params.externalAccountId, message: text }),
      });
      if (resp.ok) {
        const data = (await resp.json().catch(() => ({}))) as any;
        ok = true;
        externalMessageId = data?.messageId ? String(data.messageId) : undefined;
      } else {
        const errBody = await resp.text().catch(() => "");
        error = `Zernio send failed (${resp.status}): ${errBody.slice(0, 200)}`;
      }
    }
    if (params.attachments?.length && !error) {
      for (const att of params.attachments) {
        const body: Record<string, any> = {
          accountId: params.externalAccountId,
          attachmentUrl: att.url,
          attachmentType: att.type ?? "file",
        };
        if (att.name) body.attachmentName = att.name;
        const resp = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
        if (resp.ok) {
          ok = true;
          if (!externalMessageId) {
            const data = (await resp.json().catch(() => ({}))) as any;
            externalMessageId = data?.messageId ? String(data.messageId) : undefined;
          }
        } else {
          const errBody = await resp.text().catch(() => "");
          error = `Zernio attachment send failed (${resp.status}): ${errBody.slice(0, 200)}`;
          break;
        }
      }
    }
  } catch (err: any) {
    error = `Zernio send error: ${err?.message || "Unknown"}`;
  }

  return { ok, error, externalMessageId };
}
