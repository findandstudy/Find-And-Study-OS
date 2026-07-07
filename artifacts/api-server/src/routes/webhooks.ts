import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import express from "express";
import rateLimit from "express-rate-limit";
import { db, integrationsTable, channelAccountsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { processInboundMessage } from "../lib/inbox/processInbound";
import { maybeAutoReply } from "../lib/inbox/botAutoReply";
import { verifyWhatsAppSignature, parseWhatsAppWebhook, type WhatsAppConfig } from "../lib/inbox/channels/whatsapp";
import { verifyWebFormSignature, parseWebFormPayload } from "../lib/inbox/channels/webForm";
import { verifyMetaSignature, hasMetaChanges } from "../lib/inbox/channels/meta-shared";
import { parseMessengerWebhook, type MessengerConfig } from "../lib/inbox/channels/messenger";
import { parseInstagramWebhook, type InstagramConfig } from "../lib/inbox/channels/instagram";
import { CHANNEL_MESSENGER, CHANNEL_INSTAGRAM } from "../lib/inbox/channels/constants";
import { resolveInboundAccount, parseAccountConfig } from "../lib/inbox/channelAccountConfig";
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

async function getMessengerConfig(): Promise<MessengerConfig | null> {
  const [row] = await db.select().from(integrationsTable).where(eq(integrationsTable.key, "facebook_messenger"));
  if (!row || !row.isEnabled) return null;
  return (decryptConfig(row.config as Record<string, any>) as MessengerConfig) || {};
}

async function getInstagramConfig(): Promise<InstagramConfig | null> {
  const [row] = await db.select().from(integrationsTable).where(eq(integrationsTable.key, "instagram"));
  if (!row || !row.isEnabled) return null;
  return (decryptConfig(row.config as Record<string, any>) as InstagramConfig) || {};
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

function asRec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

/**
 * Extract the WhatsApp Business phone_number_id from a webhook payload. This is
 * the per-account identifier used to pick the correct channel_account secret.
 * Path: entry[].changes[].value.metadata.phone_number_id
 */
function extractWhatsAppPhoneNumberId(payload: unknown): string | undefined {
  const entries = Array.isArray(asRec(payload).entry) ? (asRec(payload).entry as unknown[]) : [];
  for (const e of entries) {
    const changes = Array.isArray(asRec(e).changes) ? (asRec(e).changes as unknown[]) : [];
    for (const c of changes) {
      const meta = asRec(asRec(asRec(c).value).metadata);
      const id = meta.phone_number_id;
      if (typeof id === "string" && id) return id;
      if (id != null) return String(id);
    }
  }
  return undefined;
}

/**
 * Extract the receiving Meta account id (page id for Messenger, IG-scoped id
 * for Instagram DMs) from a Meta messaging payload. Prefers the per-message
 * recipient.id and falls back to entry[].id.
 */
function extractMetaRecipientId(payload: unknown): string | undefined {
  const entries = Array.isArray(asRec(payload).entry) ? (asRec(payload).entry as unknown[]) : [];
  for (const e of entries) {
    const messaging = Array.isArray(asRec(e).messaging) ? (asRec(e).messaging as unknown[]) : [];
    for (const evt of messaging) {
      const rid = asRec(asRec(evt).recipient).id;
      if (typeof rid === "string" && rid) return rid;
      if (rid != null) return String(rid);
    }
  }
  for (const e of entries) {
    const eid = asRec(e).id;
    if (typeof eid === "string" && eid) return eid;
    if (eid != null) return String(eid);
  }
  return undefined;
}

/**
 * Gather every webhook verify token that should be accepted for a channel:
 * the active channel_accounts' tokens plus the legacy single-config token.
 * Used by the GET (subscription challenge) handlers so any connected account
 * under the same Meta app can complete verification.
 */
async function gatherVerifyTokens(channel: string, legacyToken?: string): Promise<string[]> {
  const tokens = new Set<string>();
  if (legacyToken) tokens.add(legacyToken);
  try {
    const rows = await db
      .select()
      .from(channelAccountsTable)
      .where(and(eq(channelAccountsTable.channel, channel), eq(channelAccountsTable.isActive, true)));
    for (const r of rows) {
      const cfg = parseAccountConfig(r.configEncrypted);
      const t = cfg.webhookVerifyToken;
      if (typeof t === "string" && t) tokens.add(t);
    }
  } catch (err) {
    console.error("[WEBHOOK] gatherVerifyTokens error:", err);
  }
  return [...tokens];
}

router.get("/webhooks/whatsapp", webhookLimiter, async (req: Request, res: Response): Promise<void> => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  const legacy = await getWhatsAppConfig();
  const expectedTokens = await gatherVerifyTokens("whatsapp", legacy?.webhookVerifyToken);
  const matches = typeof token === "string" && expectedTokens.some((t) => t === token);
  if (mode === "subscribe" && matches && challenge) {
    res.status(200).send(String(challenge));
    return;
  }
  logAudit(null, "webhook_auth_failed", "webhook:whatsapp:verify", undefined, {
    mode: String(mode || ""),
    hasToken: Boolean(token),
    hasExpected: expectedTokens.length > 0,
  }, req.ip);
  res.status(403).send("Forbidden");
});

router.post("/webhooks/whatsapp", webhookLimiter, rawJson, async (req: Request, res: Response): Promise<void> => {
  const sig = req.headers["x-hub-signature-256"] as string | undefined;
  const raw = req.body as Buffer;

  // Parse the payload up front ONLY to route to the correct per-account secret
  // (by phone_number_id). The HMAC below is still computed over the raw bytes,
  // so picking the secret from the parsed body never weakens verification.
  let payload: unknown;
  try {
    payload = JSON.parse(raw.toString("utf8"));
  } catch {
    res.status(400).json({ error: "Invalid JSON" });
    return;
  }

  const phoneNumberId = extractWhatsAppPhoneNumberId(payload);
  // Per-account first; fall back to the legacy single-config integration only
  // when no active channel_account matches the inbound phone_number_id.
  const perAccount = await resolveInboundAccount<WhatsAppConfig>("whatsapp", phoneNumberId);
  const config = perAccount?.config ?? (await getWhatsAppConfig());
  if (!config) {
    res.status(200).json({ ok: true, ignored: "integration disabled" });
    return;
  }

  // Always verify — verifyWhatsAppSignature returns false when appSecret OR
  // the signature header is missing, so unsigned/legacy configs are rejected.
  if (!verifyWhatsAppSignature(raw, sig, config.appSecret)) {
    logAudit(null, "webhook_auth_failed", "webhook:whatsapp", undefined, {
      reason: "invalid_or_missing_signature",
      hasSig: Boolean(sig),
      hasSecret: Boolean(config.appSecret),
      perAccount: Boolean(perAccount),
    }, req.ip);
    console.warn("[WEBHOOK] WhatsApp signature verification failed", {
      hasSig: Boolean(sig),
      hasSecret: Boolean(config.appSecret),
    });
    res.status(401).json({ error: "Invalid or missing signature" });
    return;
  }

  const messages = parseWhatsAppWebhook(payload);
  if (messages.length === 0) {
    res.status(200).json({ ok: true, processed: 0 });
    return;
  }

  const channelAccountId = perAccount
    ? perAccount.channelAccountId
    : await ensureChannelAccount("whatsapp", "WhatsApp Business", phoneNumberId ?? config.phoneNumberId);

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

// ---------------------------------------------------------------------------
// Unified Meta webhook (Facebook Messenger + Instagram DMs)
//
// Meta delivers Messenger and Instagram events to ONE callback URL and signs
// every request with the (single) Meta App secret. The `object` field on the
// payload tells the channels apart: "page" → Messenger, "instagram" → IG DMs.
// WhatsApp keeps its own /webhooks/whatsapp route untouched.
// ---------------------------------------------------------------------------

router.get("/webhooks/meta", webhookLimiter, async (req: Request, res: Response): Promise<void> => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  const [messengerCfg, instagramCfg] = await Promise.all([getMessengerConfig(), getInstagramConfig()]);
  const [msgrTokens, igTokens] = await Promise.all([
    gatherVerifyTokens(CHANNEL_MESSENGER, messengerCfg?.webhookVerifyToken),
    gatherVerifyTokens(CHANNEL_INSTAGRAM, instagramCfg?.webhookVerifyToken),
  ]);
  const expectedTokens = [...new Set([...msgrTokens, ...igTokens])];
  const matches = typeof token === "string" && expectedTokens.some((t) => t === token);
  if (mode === "subscribe" && matches && challenge) {
    res.status(200).send(String(challenge));
    return;
  }
  logAudit(null, "webhook_auth_failed", "webhook:meta:verify", undefined, {
    mode: String(mode || ""),
    hasToken: Boolean(token),
    hasExpected: expectedTokens.length > 0,
  }, req.ip);
  res.status(403).send("Forbidden");
});

router.post("/webhooks/meta", webhookLimiter, rawJson, async (req: Request, res: Response): Promise<void> => {
  const sig = req.headers["x-hub-signature-256"] as string | undefined;
  const raw = req.body as Buffer;

  // Parse the payload up front to route to the correct channel + per-account
  // secret (by the receiving page/IG id). The HMAC below is still computed over
  // the raw bytes, so this never weakens verification.
  let payload: unknown;
  try {
    payload = JSON.parse(raw.toString("utf8"));
  } catch {
    res.status(400).json({ error: "Invalid JSON" });
    return;
  }

  const object = (payload && typeof payload === "object")
    ? (payload as { object?: unknown }).object
    : undefined;

  let channel: "messenger" | "instagram";
  let displayName: string;
  if (object === "page") {
    channel = CHANNEL_MESSENGER;
    displayName = "Facebook Messenger";
  } else if (object === "instagram") {
    channel = CHANNEL_INSTAGRAM;
    displayName = "Instagram";
  } else {
    res.status(200).json({ ok: true, ignored: `unknown object: ${String(object)}` });
    return;
  }

  // Resolve the receiving account (per-account first, legacy fallback). The
  // legacy config for the OTHER channel is irrelevant here since `object`
  // already disambiguated Messenger vs Instagram.
  const externalAccountId = extractMetaRecipientId(payload);
  const perAccount = await resolveInboundAccount<MessengerConfig & InstagramConfig>(channel, externalAccountId);
  const legacyCfg = perAccount
    ? null
    : channel === CHANNEL_MESSENGER
      ? await getMessengerConfig()
      : await getInstagramConfig();
  const config = perAccount?.config ?? legacyCfg;
  if (!config) {
    res.status(200).json({ ok: true, ignored: `${channel} disabled` });
    return;
  }

  // verifyMetaSignature returns false when the secret OR the header is missing,
  // so unsigned payloads are always rejected.
  if (!verifyMetaSignature(raw, sig, config.appSecret)) {
    logAudit(null, "webhook_auth_failed", "webhook:meta", undefined, {
      reason: "invalid_or_missing_signature",
      hasSig: Boolean(sig),
      hasSecret: Boolean(config.appSecret),
      perAccount: Boolean(perAccount),
    }, req.ip);
    console.warn("[WEBHOOK] Meta signature verification failed", {
      hasSig: Boolean(sig),
      hasSecret: Boolean(config.appSecret),
    });
    res.status(401).json({ error: "Invalid or missing signature" });
    return;
  }

  if (hasMetaChanges(payload)) {
    console.log(`[WEBHOOK] Meta ${channel} change event (feed/comment/mention) — skipped (handled in comments phase)`);
  }

  const messages = channel === CHANNEL_MESSENGER
    ? parseMessengerWebhook(payload)
    : parseInstagramWebhook(payload);

  if (messages.length === 0) {
    res.status(200).json({ ok: true, processed: 0 });
    return;
  }

  const fallbackExternalId = channel === CHANNEL_MESSENGER
    ? (config as MessengerConfig).pageId
    : (config as InstagramConfig).igBusinessAccountId || (config as InstagramConfig).pageId;
  const channelAccountId = perAccount
    ? perAccount.channelAccountId
    : await ensureChannelAccount(channel, displayName, externalAccountId ?? fallbackExternalId);

  let processed = 0;
  for (const m of messages) {
    try {
      await processInboundMessage({
        channel,
        channelAccountId,
        contact: {
          externalId: m.externalUserId,
          displayName: m.displayName,
        },
        message: {
          externalMessageId: m.externalMessageId,
          text: m.text,
          // Each user has one DM thread per page/account; key the thread by
          // the sender's page-/IG-scoped id.
          externalThreadId: m.externalUserId,
          receivedAt: m.timestamp,
          metadata: { raw: m.raw, attachments: m.attachments },
        },
      });
      processed++;
    } catch (err) {
      console.error("[WEBHOOK] Meta process error:", err);
    }
  }
  res.status(200).json({ ok: true, processed });

  // Outbound replies / AI bot routing for Meta channels arrive in Faz 3.
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

// ─── Zernio omnichannel webhook ────────────────────────────────────────────
// Receives unified message events from Zernio (WhatsApp/Instagram/Facebook/
// Telegram). Verified with HMAC-SHA256 using the global webhook secret stored
// in integrations.zernio.webhookSecret. Signature header: X-Late-Signature
// (bare 64-char hex, no "sha256=" prefix — Zernio legacy from getlate.dev).
// Falls back to X-Zernio-Signature for forward compat. Unknown accounts and
// duplicate messageIds are silently swallowed (dedup via processInboundMessage).

function verifyZernioSignature(raw: Buffer, sig: string, secret: string): boolean {
  if (!sig || !secret) return false;
  const expected = crypto.createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(sig.trim(), "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  try { return crypto.timingSafeEqual(a, b); } catch { return false; }
}

router.post("/webhooks/zernio", webhookLimiter, rawJson, async (req, res): Promise<void> => {
  const raw = req.body as Buffer;
  const sig = String(
    req.headers["x-late-signature"] ||
    req.headers["x-zernio-signature"] || ""
  );

  // Load Zernio global config (apiKey + webhookSecret).
  const [zernioRow] = await db.select().from(integrationsTable).where(eq(integrationsTable.key, "zernio"));
  if (!zernioRow || !zernioRow.isEnabled) {
    // Not configured or disabled — accept silently so Zernio doesn't retry.
    res.status(200).json({ ok: true });
    return;
  }

  const cfg = decryptConfig(zernioRow.config as Record<string, any>) as { apiKey?: string; webhookSecret?: string };
  if (!verifyZernioSignature(raw, sig, cfg.webhookSecret || "")) {
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  let body: any;
  try {
    body = JSON.parse(raw.toString("utf8"));
  } catch {
    res.status(400).json({ error: "Invalid JSON" });
    return;
  }

  try {
    const m = body?.message;
    const acctPayload = body?.account;

    if (body?.event === "message.received" && m?.direction === "incoming") {
      const zAccountId = String(acctPayload?.id ?? acctPayload?.accountId ?? "");
      const platform   = String(m.platform ?? acctPayload?.platform ?? "");

      const [acct] = await db
        .select()
        .from(channelAccountsTable)
        .where(
          and(
            eq(channelAccountsTable.provider, "zernio"),
            eq(channelAccountsTable.externalAccountId, zAccountId),
            eq(channelAccountsTable.channel, platform),
          ),
        )
        .limit(1);

      if (!acct || acct.isActive === false) {
        res.status(200).json({ ok: true, skipped: "no active channel account" });
        return;
      }

      const attachments = Array.isArray(m.attachments) && m.attachments.length > 0
        ? { attachments: m.attachments }
        : {};

      const result = await processInboundMessage({
        channel: platform as any,
        channelAccountId: acct.id,
        contact: {
          externalId: String(m.sender?.id ?? m.sender?.contactId ?? ""),
          displayName: m.sender?.name ?? null,
          phone: platform === "whatsapp"
            ? (m.sender?.phoneNumber ?? m.sender?.id ?? undefined)
            : undefined,
        },
        message: {
          externalMessageId: String(m.platformMessageId ?? m.id),
          text: m.text ?? "",
          externalThreadId: String(m.conversationId ?? body?.conversation?.id ?? ""),
          receivedAt: m.sentAt ? new Date(m.sentAt) : new Date(),
          metadata: { raw: body, ...attachments },
        },
      });

      if (!result.duplicate) {
        (async () => {
          try {
            await maybeAutoReply({
              conversationId: result.conversationId!,
              inboundMessageId: result.messageId!,
            });
          } catch (err) {
            console.error("[ZERNIO] auto-reply error:", err);
          }
        })();
      }
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("[ZERNIO] webhook processing error:", err);
    res.status(500).json({ error: "Processing failed" });
  }
});

export default router;
