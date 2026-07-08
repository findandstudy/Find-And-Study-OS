import { db, channelAccountsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { getZernioApiKey } from "./zernioSend";

/**
 * Zernio WhatsApp Template Management proxy.
 *
 * Lists and creates Meta-approved WhatsApp message templates through the
 * Zernio API (rather than talking to the Meta Graph API directly — the
 * account is registered/hosted on Zernio, same reasoning as zernioSend.ts).
 */

const ZERNIO_BASE = "https://zernio.com/api/v1/whatsapp";

export interface ZernioTemplateComponent {
  type: string;
  text?: string;
  format?: string;
  buttons?: Array<Record<string, any>>;
}

export interface NormalizedZernioTemplate {
  name: string;
  language: string;
  category: string;
  status: string;
  components: ZernioTemplateComponent[];
  bodyText: string;
  variableCount: number;
}

function extractBodyText(components: any[]): string {
  const body = components?.find((c) => String(c?.type).toUpperCase() === "BODY");
  return body?.text || "";
}

function countVariables(text: string): number {
  const matches = text.match(/\{\{\s*\d+\s*\}\}/g);
  return matches ? new Set(matches).size : 0;
}

function normalizeStatus(raw: string | undefined | null): string {
  const s = String(raw || "").toLowerCase();
  if (s.includes("approve")) return "approved";
  if (s.includes("reject")) return "rejected";
  if (s.includes("pending") || s.includes("review") || s.includes("submitted")) return "pending";
  return s || "unknown";
}

function normalizeTemplate(raw: any): NormalizedZernioTemplate {
  const components = Array.isArray(raw?.components) ? raw.components : [];
  const bodyText = extractBodyText(components) || raw?.body || "";
  return {
    name: raw?.name || raw?.templateName || "",
    language: raw?.language || raw?.lang || "en",
    category: (raw?.category || "utility").toLowerCase(),
    status: normalizeStatus(raw?.status),
    components,
    bodyText,
    variableCount: countVariables(bodyText),
  };
}

/** Resolve a Zernio-hosted WhatsApp channel account (first active one, or by id). */
export async function resolveZernioWhatsAppAccount(
  channelAccountId?: number | null,
): Promise<{ id: number; externalAccountId: string } | null> {
  const conditions = [eq(channelAccountsTable.provider, "zernio"), eq(channelAccountsTable.channel, "whatsapp")];
  if (channelAccountId != null) conditions.push(eq(channelAccountsTable.id, channelAccountId));
  const [acct] = await db.select().from(channelAccountsTable).where(and(...conditions));
  if (!acct || !acct.externalAccountId) return null;
  return { id: acct.id, externalAccountId: acct.externalAccountId };
}

export interface ZernioTemplateListOutcome {
  ok: boolean;
  templates: NormalizedZernioTemplate[];
  error?: string;
}

export async function listZernioWhatsAppTemplates(externalAccountId: string): Promise<ZernioTemplateListOutcome> {
  const apiKey = await getZernioApiKey();
  if (!apiKey) return { ok: false, templates: [], error: "zernio_api_key_not_configured" };

  const url = `${ZERNIO_BASE}/get-whatsapp-templates?accountId=${encodeURIComponent(externalAccountId)}`;
  try {
    const resp = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const bodyText = await resp.text().catch(() => "");
    if (!resp.ok) {
      console.error(`[ZERNIO] get-whatsapp-templates failed (${resp.status}):`, bodyText.slice(0, 600));
      return { ok: false, templates: [], error: `Zernio template list failed (${resp.status}): ${bodyText.slice(0, 200)}` };
    }
    let data: any = {};
    try { data = JSON.parse(bodyText); } catch { /* non-JSON */ }
    const rawList: any[] = Array.isArray(data) ? data : (data?.templates || data?.data || []);
    return { ok: true, templates: rawList.map(normalizeTemplate) };
  } catch (err: any) {
    console.error("[ZERNIO] get-whatsapp-templates error:", err?.message || err);
    return { ok: false, templates: [], error: `Zernio template list error: ${err?.message || "Unknown"}` };
  }
}

export interface ZernioTemplateCreateParams {
  externalAccountId: string;
  mode: "custom" | "library";
  name: string;
  language: string;
  category?: string;
  bodyText?: string;
  footerText?: string;
  libraryTemplateName?: string;
}

export interface ZernioTemplateCreateOutcome {
  ok: boolean;
  status?: string;
  error?: string;
  raw?: any;
}

export async function createZernioWhatsAppTemplate(
  params: ZernioTemplateCreateParams,
): Promise<ZernioTemplateCreateOutcome> {
  const apiKey = await getZernioApiKey();
  if (!apiKey) return { ok: false, error: "zernio_api_key_not_configured" };

  const url = `${ZERNIO_BASE}/create-whatsapp-template`;
  const components: ZernioTemplateComponent[] = [];
  if (params.mode === "custom") {
    components.push({ type: "BODY", text: params.bodyText || "" });
    if (params.footerText) components.push({ type: "FOOTER", text: params.footerText });
  }

  const body: Record<string, any> =
    params.mode === "library"
      ? {
          accountId: params.externalAccountId,
          name: params.name,
          language: params.language,
          category: params.category || "utility",
          libraryTemplateName: params.libraryTemplateName,
        }
      : {
          accountId: params.externalAccountId,
          name: params.name,
          language: params.language,
          category: params.category || "utility",
          components,
        };

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const bodyText = await resp.text().catch(() => "");
    let data: any = {};
    try { data = JSON.parse(bodyText); } catch { /* non-JSON */ }
    if (!resp.ok) {
      console.error(`[ZERNIO] create-whatsapp-template failed (${resp.status}):`, bodyText.slice(0, 600));
      return { ok: false, error: data?.error || `Zernio template create failed (${resp.status}): ${bodyText.slice(0, 200)}`, raw: data };
    }
    return { ok: true, status: normalizeStatus(data?.status), raw: data };
  } catch (err: any) {
    console.error("[ZERNIO] create-whatsapp-template error:", err?.message || err);
    return { ok: false, error: `Zernio template create error: ${err?.message || "Unknown"}` };
  }
}
