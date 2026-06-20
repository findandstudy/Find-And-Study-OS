import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import express from "express";
import rateLimit from "express-rate-limit";
import { db, integrationsTable, channelAccountsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { processInboundMessage } from "../lib/inbox/processInbound";
import { maybeAutoReply } from "../lib/inbox/botAutoReply";
import { verifyWhatsAppSignature, parseWhatsAppWebhook, type WhatsAppConfig } from "../lib/inbox/channels/whatsapp";
import { verifyWebFormSignature, parseWebFormPayload } from "../lib/inbox/channels/webForm";
import { decryptConfig } from "../lib/encryption";
import { logAudit } from "../lib/auth";
import crypto from "crypto";
import { PgRateLimitStore } from "../lib/pgRateLimiter";
import { getRateLimitIp } from "../lib/clientIp";

/**
 * Per-IP rate limiter for inbound webhook endpoints. Backed by PostgreSQL so
 * all PM2 workers share the same counters. Limits are generous enough not to
 * throttle legitimate WA Cloud / web-form bursts.
 */
const WEBHOOK_WINDOW_MS = 60 * 1000;
const webhookLimiter = rateLimit({
  windowMs: WEBHOOK_WINDOW_MS,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many webhook requests" },
  store: new PgRateLimitStore(WEBHOOK_WINDOW_MS, "webhook"),
  keyGenerator: (req) => getRateLimitIp(req),
});

const router: IRouter = Router();

/**
 * Mounted before express.json() so the raw body is available for HMAC.
 * After verification, payload is parsed inside each handler.
 *
 * Limit matches the global parser cap (1 MB) so unauthenticated webhook
 * routes don't widen the DoS surface beyond the rest of the API
 * (Sprint 1 / C3 — body-size hardening).
 */
const rawJson = express.raw({ type: "application/json", limit: "1mb" });

/**
 * Captures the raw body for ANY content-type (json, x-www-form-urlencoded, multipart, text)
 * so HMAC can be verified, then parses based on Content-Type into req.body.
 * Used by the public web-form webhook which is typically posted from an HTML form.
 *
 * Same 1 MB cap as rawJson (Sprint 1 / C3).
 */
const rawAny = express.raw({ type: () => true, limit: "1mb" });

interface RequestWithRawBody extends Request {
  rawBody?: Buffer;
}

function parseRawByContentType(req: Request, _res: Response, next: NextFunction): void {
  const raw = req.body as Buffer;
  (req as RequestWithRawBody).rawBody = raw;
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
  return (decryptConfig(row.config as Record<string, any>) as WhatsAppConfig) || {};
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

router.get("/webhooks/whatsapp", webhookLimiter, async (req: Request, res: Response): Promise<void> => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  const config = await getWhatsAppConfig();
  const expected = config?.webhookVerifyToken;
  if (mode === "subscribe" && expected && token === expected && challenge) {
    res.status(200).send(String(challenge));
    return;
  }
  logAudit(null, "webhook_auth_failed", "webhook:whatsapp:verify", undefined, {
    mode: String(mode || ""),
    hasToken: Boolean(token),
    hasExpected: Boolean(expected),
  }, req.ip);
  res.status(403).send("Forbidden");
});

router.post("/webhooks/whatsapp", webhookLimiter, rawJson, async (req: Request, res: Response): Promise<void> => {
  const config = await getWhatsAppConfig();
  if (!config) {
    res.status(200).json({ ok: true, ignored: "integration disabled" });
    return;
  }

  const sig = req.headers["x-hub-signature-256"] as string | undefined;
  const raw = req.body as Buffer;
  // Always verify — verifyWhatsAppSignature returns false when appSecret OR
  // the signature header is missing, so unsigned/legacy configs are rejected.
  if (!verifyWhatsAppSignature(raw, sig, config.appSecret)) {
    logAudit(null, "webhook_auth_failed", "webhook:whatsapp", undefined, {
      reason: "invalid_or_missing_signature",
      hasSig: Boolean(sig),
      hasSecret: Boolean(config.appSecret),
    }, req.ip);
    console.warn("[WEBHOOK] WhatsApp signature verification failed", {
      hasSig: Boolean(sig),
      hasSecret: Boolean(config.appSecret),
    });
    res.status(401).json({ error: "Invalid or missing signature" });
    return;
  }

  let payload: unknown;
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
  // Inbound text messages that are eligible to trigger the intake bot. We only
  // act on fresh (non-duplicate) inbound text — duplicate webhook deliveries are
  // dropped here AND again by the engine's idempotency claim.
  const botCandidates: Array<{ conversationId: number; inboundMessageId: number }> = [];
  for (const m of messages) {
    try {
      const result = await processInboundMessage({
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
      if (!result.duplicate && m.text && m.text.trim()) {
        botCandidates.push({ conversationId: result.conversationId, inboundMessageId: result.messageId });
      }
    } catch (err) {
      console.error("[WEBHOOK] WA process error:", err);
    }
  }
  res.status(200).json({ ok: true, processed });

  // Fire the intake bot AFTER acking the webhook so delivery latency never
  // gates Meta's 200. maybeAutoReply is self-guarding: it no-ops when the
  // per-conversation bot is off and is idempotent against duplicate triggers.
  for (const cand of botCandidates) {
    void maybeAutoReply(cand).catch((err) => {
      console.error("[WEBHOOK] WA auto-reply error:", err);
    });
  }
});

function timingSafeEq(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  try {
    return crypto.timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}

async function handleWebFormPost(req: Request, res: Response): Promise<void> {
  const [integ] = await db.select().from(integrationsTable).where(eq(integrationsTable.key, "web_form"));
  if (!integ || !integ.isEnabled) {
    res.status(200).json({ ok: true, ignored: "integration disabled" });
    return;
  }
  const cfg = decryptConfig((integ.config as Record<string, any>) || {});

  // If a formId path param was supplied, verify it matches the configured formId.
  const formIdParam = req.params.formId;
  if (formIdParam && cfg.formId && formIdParam !== cfg.formId) {
    console.warn("[WEBHOOK] web_form formId mismatch", { provided: formIdParam });
    res.status(404).json({ error: "Unknown form id" });
    return;
  }

  // Mandatory secret enforcement when a secret is configured.
  // Authenticators are accepted ONLY via request headers, which a server-to-server
  // caller controls but a public browser embed cannot supply without exposing the
  // secret. Accepts either:
  //   - HMAC-SHA256 signature in X-Webform-Signature (raw hex digest of the raw body), OR
  //   - shared token in the X-Webform-Token header.
  // The secret is deliberately NOT read from the request body (e.g. `secret_token`
  // or `secret` fields): a body field that ships inside public website HTML is
  // visible to every visitor and provides no real authentication. All comparisons
  // are constant-time.
  if (cfg.secret) {
    const sig = req.headers["x-webform-signature"] as string | undefined;
    const raw = (req as RequestWithRawBody).rawBody;
    const tokenHeader = (req.headers["x-webform-token"] as string | undefined) || undefined;

    const sigOk = sig ? verifyWebFormSignature(raw ?? Buffer.alloc(0), sig, cfg.secret) : false;
    const tokenOk = timingSafeEq(tokenHeader, cfg.secret);
    if (!sigOk && !tokenOk) {
      logAudit(null, "webhook_auth_failed", "webhook:web_form", undefined, {
        reason: "invalid_or_missing_secret",
        formId: formIdParam || cfg.formId || null,
        hasSig: Boolean(sig),
        hasTokenHeader: Boolean(tokenHeader),
      }, req.ip);
      console.warn("[WEBHOOK] web_form auth failed", {
        hasSig: Boolean(sig),
        hasTokenHeader: Boolean(tokenHeader),
      });
      res.status(401).json({ error: "Invalid or missing webhook secret" });
      return;
    }
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
  } catch (err) {
    console.error("[WEBHOOK] web_form process error:", err);
    res.status(500).json({ error: "Processing failed" });
  }
}

router.post("/webhooks/web-form", webhookLimiter, rawAny, parseRawByContentType, handleWebFormPost);
router.post("/webhooks/web-form/:formId", webhookLimiter, rawAny, parseRawByContentType, handleWebFormPost);

export default router;
