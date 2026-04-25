import crypto from "crypto";
import { isLiveIntegrationsEnabled } from "../liveMode";

const WA_API_VERSION = "v21.0";

export interface WhatsAppConfig {
  phoneNumberId?: string;
  accessToken?: string;
  businessAccountId?: string;
  webhookVerifyToken?: string;
  appSecret?: string;
}

export interface WhatsAppSendResult {
  ok: boolean;
  externalMessageId?: string;
  error?: string;
  simulated: boolean;
}

const SIMULATED_PREFIX = "sim_wa_";

/**
 * Verify the X-Hub-Signature-256 header from a WhatsApp webhook request.
 *
 * Returns false (reject) when either appSecret or signatureHeader is missing,
 * so unsigned spoofed payloads are never accepted in production.
 */
export function verifyWhatsAppSignature(rawBody: Buffer | string, signatureHeader: string | undefined, appSecret: string | undefined): boolean {
  if (!appSecret || !signatureHeader) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
  } catch {
    return false;
  }
}

/**
 * Send a free-form text message via the WhatsApp Cloud API.
 *
 * In dev (and without ALLOW_LIVE_INTEGRATIONS), returns a simulated success
 * with a synthesized externalMessageId so the rest of the pipeline can run.
 */
/**
 * Send a WA Cloud API request with bounded retry+backoff for 429/5xx.
 * Backoff schedule: 250ms, 750ms, 1750ms (max 3 attempts total).
 */
async function sendWaApiRequest(
  url: string,
  accessToken: string,
  body: Record<string, any>,
): Promise<{ ok: true; data: any } | { ok: false; status: number; error: string }> {
  const delays = [0, 250, 750, 1750];
  let last: { status: number; error: string } = { status: 0, error: "no_attempt" };
  for (let attempt = 0; attempt < delays.length; attempt++) {
    if (delays[attempt] > 0) await new Promise((r) => setTimeout(r, delays[attempt]));
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const data: any = await res.json().catch(() => ({}));
      if (res.ok) return { ok: true, data };
      const errMsg = data?.error?.message || `HTTP ${res.status}`;
      last = { status: res.status, error: errMsg };
      const retriable = res.status === 429 || (res.status >= 500 && res.status < 600);
      if (!retriable) return { ok: false, status: res.status, error: errMsg };
    } catch (err: any) {
      last = { status: 0, error: err?.message || "network_error" };
      // Network errors are retriable.
    }
  }
  return { ok: false, status: last.status, error: last.error };
}

export async function sendWhatsAppText(opts: {
  config: WhatsAppConfig;
  toPhoneE164: string;
  text: string;
}): Promise<WhatsAppSendResult> {
  const { config, toPhoneE164, text } = opts;

  if (!isLiveIntegrationsEnabled()) {
    return {
      ok: true,
      externalMessageId: `${SIMULATED_PREFIX}${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      simulated: true,
    };
  }

  if (!config.phoneNumberId || !config.accessToken) {
    return { ok: false, error: "WhatsApp integration is not configured", simulated: false };
  }

  const cleaned = toPhoneE164.replace(/^\+/, "");
  const url = `https://graph.facebook.com/${WA_API_VERSION}/${config.phoneNumberId}/messages`;
  const result = await sendWaApiRequest(url, config.accessToken, {
    messaging_product: "whatsapp",
    to: cleaned,
    type: "text",
    text: { body: text },
  });
  if (!result.ok) {
    return { ok: false, error: result.error, simulated: false };
  }
  const externalMessageId = result.data?.messages?.[0]?.id;
  return { ok: true, externalMessageId, simulated: false };
}

/**
 * Send a WhatsApp template message (used to re-open conversation outside the 24h window).
 */
export async function sendWhatsAppTemplate(opts: {
  config: WhatsAppConfig;
  toPhoneE164: string;
  templateName: string;
  language: string;
  parameters?: string[];
}): Promise<WhatsAppSendResult> {
  const { config, toPhoneE164, templateName, language, parameters } = opts;

  if (!isLiveIntegrationsEnabled()) {
    return {
      ok: true,
      externalMessageId: `${SIMULATED_PREFIX}${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      simulated: true,
    };
  }

  if (!config.phoneNumberId || !config.accessToken) {
    return { ok: false, error: "WhatsApp integration is not configured", simulated: false };
  }

  const cleaned = toPhoneE164.replace(/^\+/, "");
  const url = `https://graph.facebook.com/${WA_API_VERSION}/${config.phoneNumberId}/messages`;

  const components = parameters && parameters.length > 0
    ? [{
        type: "body",
        parameters: parameters.map((p) => ({ type: "text", text: p })),
      }]
    : undefined;

  const result = await sendWaApiRequest(url, config.accessToken, {
    messaging_product: "whatsapp",
    to: cleaned,
    type: "template",
    template: {
      name: templateName,
      language: { code: language },
      ...(components ? { components } : {}),
    },
  });
  if (!result.ok) {
    return { ok: false, error: result.error, simulated: false };
  }
  const externalMessageId = result.data?.messages?.[0]?.id;
  return { ok: true, externalMessageId, simulated: false };
}

export interface WhatsAppInbound {
  externalMessageId: string;
  fromPhone: string;
  displayName?: string;
  text: string;
  receivedAt: Date;
  externalThreadId: string;
  raw: any;
}

/**
 * Parse a WhatsApp Cloud API webhook payload into normalized inbound messages.
 * Returns an empty array for non-message events (status updates, etc.).
 */
export function parseWhatsAppWebhook(payload: any): WhatsAppInbound[] {
  const out: WhatsAppInbound[] = [];
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change?.value || {};
      const contacts = Array.isArray(value.contacts) ? value.contacts : [];
      const messages = Array.isArray(value.messages) ? value.messages : [];
      for (const msg of messages) {
        const fromPhone = "+" + String(msg.from || "").replace(/^\+/, "");
        const contact = contacts.find((c: any) => c.wa_id === msg.from) || contacts[0];
        let text = "";
        if (msg.type === "text") text = msg.text?.body || "";
        else if (msg.type === "interactive") {
          text = msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title || "[interactive]";
        } else if (msg.type === "image" || msg.type === "document" || msg.type === "audio" || msg.type === "video") {
          text = msg[msg.type]?.caption || `[${msg.type}]`;
        } else {
          text = `[${msg.type}]`;
        }
        out.push({
          externalMessageId: msg.id,
          fromPhone,
          displayName: contact?.profile?.name,
          text,
          receivedAt: msg.timestamp ? new Date(parseInt(msg.timestamp, 10) * 1000) : new Date(),
          externalThreadId: fromPhone,
          raw: msg,
        });
      }
    }
  }
  return out;
}

/**
 * Returns true if the conversation's last inbound message is within the 24h
 * WhatsApp service window. Outside this window only template messages are allowed.
 */
export function isWithin24hWindow(lastInboundAt: Date | null | undefined): boolean {
  if (!lastInboundAt) return false;
  const ms = Date.now() - new Date(lastInboundAt).getTime();
  return ms < 24 * 60 * 60 * 1000;
}
