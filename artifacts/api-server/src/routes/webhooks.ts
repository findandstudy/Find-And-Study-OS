import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import express from "express";
import { db, integrationsTable, channelAccountsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { processInboundMessage } from "../lib/inbox/processInbound";
import { verifyWhatsAppSignature, parseWhatsAppWebhook, type WhatsAppConfig } from "../lib/inbox/channels/whatsapp";
import { verifyWebFormSignature, parseWebFormPayload } from "../lib/inbox/channels/webForm";

const router: IRouter = Router();

/**
 * Mounted before express.json() so the raw body is available for HMAC.
 * After verification, payload is parsed inside each handler.
 */
const rawJson = express.raw({ type: "application/json", limit: "5mb" });

/**
 * Captures the raw body for ANY content-type (json, x-www-form-urlencoded, multipart, text)
 * so HMAC can be verified, then parses based on Content-Type into req.body.
 * Used by the public web-form webhook which is typically posted from an HTML form.
 */
const rawAny = express.raw({ type: () => true, limit: "5mb" });

function parseRawByContentType(req: Request, _res: Response, next: NextFunction): void {
  const raw = req.body as Buffer;
  (req as any).rawBody = raw;
  const ct = String(req.headers["content-type"] || "").toLowerCase();
  try {
    if (!raw || raw.length === 0) {
      req.body = {};
    } else if (ct.includes("application/json")) {
      req.body = JSON.parse(raw.toString("utf8"));
    } else if (ct.includes("application/x-www-form-urlencoded")) {
      const params = new URLSearchParams(raw.toString("utf8"));
      const obj: Record<string, string> = {};
      params.forEach((v, k) => {
        obj[k] = v;
      });
      req.body = obj;
    } else {
      // Best-effort: try JSON, otherwise leave as raw text under a `text` field
      try {
        req.body = JSON.parse(raw.toString("utf8"));
      } catch {
        req.body = { text: raw.toString("utf8") };
      }
    }
  } catch {
    req.body = {};
  }
  next();
}

async function getWhatsAppConfig(): Promise<WhatsAppConfig | null> {
  const [row] = await db.select().from(integrationsTable).where(eq(integrationsTable.key, "whatsapp"));
  if (!row || !row.isEnabled) return null;
  return (row.config as WhatsAppConfig) || {};
}

async function ensureChannelAccount(channel: string, displayName: string, externalAccountId?: string): Promise<number | null> {
  try {
    if (externalAccountId) {
      const [existing] = await db
        .select()
        .from(channelAccountsTable)
        .where(and(eq(channelAccountsTable.channel, channel), eq(channelAccountsTable.externalAccountId, externalAccountId)));
      if (existing) return existing.id;
      const [created] = await db
        .insert(channelAccountsTable)
        .values({ channel, displayName, externalAccountId, status: "active" })
        .returning();
      return created.id;
    }
    const [existing] = await db.select().from(channelAccountsTable).where(eq(channelAccountsTable.channel, channel));
    if (existing) return existing.id;
    const [created] = await db
      .insert(channelAccountsTable)
      .values({ channel, displayName, status: "active" })
      .returning();
    return created.id;
  } catch (err) {
    console.error("[WEBHOOK] ensureChannelAccount error:", err);
    return null;
  }
}

router.get("/webhooks/whatsapp", async (req: Request, res: Response): Promise<void> => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  const config = await getWhatsAppConfig();
  const expected = config?.webhookVerifyToken;
  if (mode === "subscribe" && expected && token === expected && challenge) {
    res.status(200).send(String(challenge));
    return;
  }
  res.status(403).send("Forbidden");
});

router.post("/webhooks/whatsapp", rawJson, async (req: Request, res: Response): Promise<void> => {
  const config = await getWhatsAppConfig();
  if (!config) {
    res.status(200).json({ ok: true, ignored: "integration disabled" });
    return;
  }

  const sig = req.headers["x-hub-signature-256"] as string | undefined;
  const raw = req.body as Buffer;
  if (config.appSecret && !verifyWhatsAppSignature(raw, sig, config.appSecret)) {
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  let payload: any;
  try {
    payload = JSON.parse(raw.toString("utf8"));
  } catch {
    res.status(400).json({ error: "Invalid JSON" });
    return;
  }

  const messages = parseWhatsAppWebhook(payload);
  if (messages.length === 0) {
    res.status(200).json({ ok: true, processed: 0 });
    return;
  }

  const phoneNumberId = config.phoneNumberId;
  const channelAccountId = await ensureChannelAccount("whatsapp", "WhatsApp Business", phoneNumberId);

  let processed = 0;
  for (const m of messages) {
    try {
      await processInboundMessage({
        channel: "whatsapp",
        channelAccountId,
        contact: {
          externalId: m.fromPhone,
          displayName: m.displayName,
          phone: m.fromPhone,
        },
        message: {
          externalMessageId: m.externalMessageId,
          text: m.text,
          externalThreadId: m.externalThreadId,
          receivedAt: m.receivedAt,
          metadata: { raw: m.raw },
        },
      });
      processed++;
    } catch (err) {
      console.error("[WEBHOOK] WA process error:", err);
    }
  }
  res.status(200).json({ ok: true, processed });
});

async function handleWebFormPost(req: Request, res: Response): Promise<void> {
  const [integ] = await db.select().from(integrationsTable).where(eq(integrationsTable.key, "web_form"));
  if (!integ || !integ.isEnabled) {
    res.status(200).json({ ok: true, ignored: "integration disabled" });
    return;
  }
  const cfg = (integ.config as any) || {};

  // If a formId path param was supplied, verify it matches the configured formId.
  const formIdParam = req.params.formId;
  if (formIdParam && cfg.formId && formIdParam !== cfg.formId) {
    res.status(404).json({ error: "Unknown form id" });
    return;
  }

  const sig = req.headers["x-webform-signature"] as string | undefined;
  const raw = (req as any).rawBody as Buffer | undefined;
  // HMAC is verified against the raw bytes when a secret + signature are provided.
  // For HTML form posts (no signature header), the secret check is permissive — the formId
  // in the URL is the shared identifier; this matches the public embed snippet flow.
  if (cfg.secret && sig && !verifyWebFormSignature(raw ?? Buffer.alloc(0), sig, cfg.secret)) {
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  const payload = req.body;
  const submission = parseWebFormPayload(payload);
  if (!submission) {
    res.status(400).json({ error: "Invalid payload" });
    return;
  }

  const channelAccountId = await ensureChannelAccount("web_form", "Web Form", cfg.formId || "default");

  try {
    const result = await processInboundMessage({
      channel: "web_form",
      channelAccountId,
      contact: {
        externalId: submission.email || submission.phone || submission.externalThreadId,
        displayName: submission.fromName,
        email: submission.email,
        phone: submission.phone,
        metadata: { agentRef: submission.agentRef },
      },
      message: {
        externalMessageId: submission.externalMessageId,
        text: submission.text,
        externalThreadId: submission.externalThreadId,
        receivedAt: submission.receivedAt,
        metadata: { agentRef: submission.agentRef, raw: submission.raw },
      },
    });

    // If the request looks like a regular HTML form submission and a redirectUrl is
    // configured, follow it so the user lands on the configured thank-you page.
    const accept = String(req.headers["accept"] || "").toLowerCase();
    const ct = String(req.headers["content-type"] || "").toLowerCase();
    const isHtmlPost = ct.includes("application/x-www-form-urlencoded") && !accept.includes("application/json");
    if (isHtmlPost && cfg.redirectUrl) {
      res.redirect(303, String(cfg.redirectUrl));
      return;
    }
    res.status(200).json({ ok: true, ...result });
  } catch (err: any) {
    console.error("[WEBHOOK] web_form process error:", err);
    res.status(500).json({ error: "Processing failed" });
  }
}

router.post("/webhooks/web-form", rawAny, parseRawByContentType, handleWebFormPost);
router.post("/webhooks/web-form/:formId", rawAny, parseRawByContentType, handleWebFormPost);

export default router;
