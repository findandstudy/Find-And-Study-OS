import { Router, type IRouter, type Request, type Response } from "express";
import { db, integrationsTable, auditLogsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { requireAuth, requireRole } from "../lib/auth";
import { ADMIN_ROLES } from "../lib/roles";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { clearConfigCache } from "@workspace/integrations-anthropic-ai";
import { createSmtpTransporter, invalidateSmtpCache } from "../lib/email";
import crypto from "crypto";
import { isLiveIntegrationsEnabled, liveModeReason } from "../lib/inbox/liveMode";
import { resolveZernioWhatsAppAccount, listZernioWhatsAppTemplates } from "../lib/inbox/zernioTemplates";
import { EncryptionKeyUnavailableError, encryptConfig, decryptConfig, isEncrypted } from "../lib/encryption";
import { maskSecrets, mergeConfig } from "../lib/configMasking";
import { META_API_VERSION } from "../lib/inbox/channels/meta-shared";
import { clearDocumentAiConnectionCache, isAnthropicConnectionKey } from "../lib/documentAiConnection";
import { simulatedIntegrationTestResult, unsupportedIntegrationTestResult } from "../lib/integrationTestResult";
import { cityWeatherOutboundEnabled, testOpenWeatherConnection } from "../lib/cityWeather";

const router: IRouter = Router();

const LIVE_GATED_KEYS = new Set(["whatsapp", "web_form", "facebook_messenger", "instagram", "zernio"]);
type IntegrationTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function encryptionFailureResponse(res: Response, error: unknown): boolean {
  if (!(error instanceof EncryptionKeyUnavailableError)) return false;
  res.status(503).json({
    error: error.code,
    message:
      "Secure integration storage is not configured for this local API. Set ENCRYPTION_KEY or SESSION_SECRET, restart the API, then save the key again.",
  });
  return true;
}

function publicIntegrationConfig(config: Record<string, any> | null | undefined): {
  config: Record<string, any>;
  requiresCredentialReset: boolean;
} {
  const decrypted = decryptConfig(config);
  const requiresCredentialReset = Object.values(decrypted).some(isEncrypted);
  const safeConfig = Object.fromEntries(
    Object.entries(decrypted).map(([key, value]) => [key, isEncrypted(value) ? "" : value]),
  );
  return { config: maskSecrets(safeConfig), requiresCredentialReset };
}

async function writeIntegrationAudit(
  tx: IntegrationTransaction,
  req: Request,
  action: "update_integration" | "toggle_integration",
  resourceId: number,
  changes: { key: string; isEnabled: boolean },
): Promise<void> {
  await tx.insert(auditLogsTable).values({
    userId: req.user!.id,
    action,
    resource: "integration",
    resourceId,
    changes: JSON.stringify(changes),
    ipAddress: req.ip || null,
  });
}

router.get("/integrations/live-mode", requireAuth, requireRole(...ADMIN_ROLES), async (_req, res): Promise<void> => {
  res.json({ live: isLiveIntegrationsEnabled(), reason: liveModeReason() });
});

router.get("/integrations", requireAuth, requireRole(...ADMIN_ROLES), async (_req, res): Promise<void> => {
  const integrations = await db
    .select()
    .from(integrationsTable)
    .orderBy(integrationsTable.category, integrationsTable.name);

  const masked = integrations.map((i) => ({ ...i, ...publicIntegrationConfig(i.config as Record<string, any>) }));

  res.json({ data: masked });
});

router.get("/integrations/:key", requireAuth, requireRole(...ADMIN_ROLES), async (req, res): Promise<void> => {
  const [integration] = await db
    .select()
    .from(integrationsTable)
    .where(eq(integrationsTable.key, String(req.params.key)));

  if (!integration) {
    res.status(404).json({ error: "Integration not found" });
    return;
  }

  res.json({ ...integration, ...publicIntegrationConfig(integration.config as Record<string, any>) });
});

router.put("/integrations/:key", requireAuth, requireRole(...ADMIN_ROLES), async (req, res): Promise<void> => {
  const key = String(req.params.key).trim().toLowerCase();
  const { name, category, isEnabled, config } = req.body;

  if (!name || !category) {
    res.status(400).json({ error: "Name and category are required" });
    return;
  }

  if ((key.startsWith("claude:") || key.startsWith("anthropic:")) && !isAnthropicConnectionKey(key)) {
    res.status(400).json({ error: "Invalid Anthropic connection key" });
    return;
  }
  if (isAnthropicConnectionKey(key) && category !== "ai") {
    res.status(400).json({ error: "Anthropic connections must use the ai category" });
    return;
  }

  if (LIVE_GATED_KEYS.has(key) && isEnabled === true && !isLiveIntegrationsEnabled()) {
    res.status(403).json({
      error: "live_integrations_disabled",
      message:
        "Live integrations are disabled by the deployment environment.",
    });
    return;
  }

  // WhatsApp cannot be enabled without an app secret — webhook signature
  // verification is mandatory and would reject every inbound otherwise.
  if (key === "whatsapp" && isEnabled === true) {
    const incomingCfg = (config || {}) as Record<string, any>;
    // We need the merged plaintext to validate; pull existing decrypted state.
    const existingForCheck = (await db.select().from(integrationsTable).where(eq(integrationsTable.key, key)))[0];
    const existingPlainCfg = existingForCheck ? decryptConfig(existingForCheck.config as Record<string, any>) : {};
    const merged = { ...existingPlainCfg, ...incomingCfg };
    if (!merged.appSecret || !merged.webhookVerifyToken) {
      res.status(400).json({
        error: "whatsapp_secrets_required",
        message: "WhatsApp cannot be enabled without both an App Secret and a Webhook Verify Token (required to authenticate inbound webhooks).",
      });
      return;
    }
  }

  const [existing] = await db
    .select()
    .from(integrationsTable)
    .where(eq(integrationsTable.key, key));

  let result;
  if (existing) {
    // Decrypt the stored config before merging so masked-incoming detection works on plaintext.
    const existingPlain = decryptConfig(existing.config as Record<string, any>);
    const mergedConfig = mergeConfig(existingPlain, config || {});
    if (Object.values(mergedConfig).some(isEncrypted)) {
      res.status(409).json({
        error: "integration_credential_reset_required",
        message:
          "The saved credential was encrypted with a different local key. Enter the API key again, then save the connection.",
      });
      return;
    }
    if (key === "web_form" && !mergedConfig.formId) mergedConfig.formId = crypto.randomUUID();
    if (key === "web_form" && !mergedConfig.secret) mergedConfig.secret = crypto.randomBytes(24).toString("hex");
    let toStore;
    try {
      toStore = encryptConfig(mergedConfig);
    } catch (error) {
      if (encryptionFailureResponse(res, error)) return;
      throw error;
    }
    result = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(integrationsTable)
        .set({
          name,
          category,
          isEnabled: isEnabled ?? existing.isEnabled,
          config: toStore,
        })
        .where(and(eq(integrationsTable.id, existing.id), eq(integrationsTable.key, key)))
        .returning();
      if (!updated) return null;
      await writeIntegrationAudit(tx, req, "update_integration", updated.id, { key, isEnabled: updated.isEnabled });
      return updated;
    });
  } else {
    const initialConfig: Record<string, any> = { ...(config || {}) };
    if (key === "web_form") {
      if (!initialConfig.formId) initialConfig.formId = crypto.randomUUID();
      if (!initialConfig.secret) initialConfig.secret = crypto.randomBytes(24).toString("hex");
    }
    let toStore;
    try {
      toStore = encryptConfig(initialConfig);
    } catch (error) {
      if (encryptionFailureResponse(res, error)) return;
      throw error;
    }
    result = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(integrationsTable)
        .values({ key, name, category, isEnabled: isEnabled ?? false, config: toStore })
        .returning();
      await writeIntegrationAudit(tx, req, "update_integration", created.id, { key, isEnabled: created.isEnabled });
      return created;
    });
  }

  if (!result) {
    res.status(409).json({ error: "integration_version_conflict" });
    return;
  }

  if (isAnthropicConnectionKey(key)) {
    clearConfigCache();
    clearDocumentAiConnectionCache();
  }
  if (key === "smtp") invalidateSmtpCache();
  res.json({ ...result, ...publicIntegrationConfig(result.config as Record<string, any>) });
});

router.patch("/integrations/:key/toggle", requireAuth, requireRole(...ADMIN_ROLES), async (req, res): Promise<void> => {
  const integrationKey = String(req.params.key).trim().toLowerCase();
  const [existing] = await db
    .select()
    .from(integrationsTable)
    .where(eq(integrationsTable.key, integrationKey));

  if (!existing) {
    res.status(404).json({ error: "Integration not found" });
    return;
  }

  const willEnable = !existing.isEnabled;
  if (LIVE_GATED_KEYS.has(integrationKey) && willEnable && !isLiveIntegrationsEnabled()) {
    res.status(403).json({
      error: "live_integrations_disabled",
      message:
        "Live integrations are disabled by the deployment environment.",
    });
    return;
  }

  // Same WA secrets check as PUT — toggling must not bypass mandatory creds.
  if (integrationKey === "whatsapp" && willEnable) {
    const plain = decryptConfig(existing.config as Record<string, any>);
    if (!plain.appSecret || !plain.webhookVerifyToken) {
      res.status(400).json({
        error: "whatsapp_secrets_required",
        message: "WhatsApp cannot be enabled without both an App Secret and a Webhook Verify Token (required to authenticate inbound webhooks).",
      });
      return;
    }
  }

  const result = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(integrationsTable)
      .set({ isEnabled: willEnable })
      .where(and(eq(integrationsTable.id, existing.id), eq(integrationsTable.key, integrationKey)))
      .returning();
    if (!updated) return null;
    await writeIntegrationAudit(tx, req, "toggle_integration", updated.id, { key: integrationKey, isEnabled: updated.isEnabled });
    return updated;
  });

  if (!result) {
    res.status(409).json({ error: "integration_version_conflict" });
    return;
  }

  if (isAnthropicConnectionKey(integrationKey)) {
    clearConfigCache();
    clearDocumentAiConnectionCache();
  }
  if (integrationKey === "smtp") invalidateSmtpCache();
  res.json({ ...result, config: maskSecrets(decryptConfig(result.config as Record<string, any>)) });
});

router.post("/integrations/:key/test", requireAuth, requireRole(...ADMIN_ROLES), async (req, res): Promise<void> => {
  const integrationKey = String(req.params.key).trim().toLowerCase();
  const [integration] = await db
    .select()
    .from(integrationsTable)
    .where(eq(integrationsTable.key, String(req.params.key)));

  if (!integration) {
    res.status(404).json({ error: "Integration not found" });
    return;
  }

  // Side-effecting provider checks remain behind the live-integration gate.
  // OpenAI and Anthropic use their read-only Models APIs below: an explicit
  // admin click verifies key + model access without generating content.
  const outboundCheckAllowed = integrationKey === "openweather"
    ? cityWeatherOutboundEnabled()
    : isLiveIntegrationsEnabled();
  if (
    (LIVE_GATED_KEYS.has(integrationKey) || integrationKey === "smtp" || integrationKey === "openweather")
    && !outboundCheckAllowed
  ) {
    res.json(simulatedIntegrationTestResult("Live credential check was skipped; simulated mode is not health evidence."));
    return;
  }

  const config = decryptConfig(integration.config as Record<string, any>);

  if (Object.values(config).some(isEncrypted)) {
    res.status(409).json({
      success: false,
      error: "integration_credential_reset_required",
      message: "This API instance cannot decrypt the saved credential. Enter the API key again and save the connection before testing it.",
    });
    return;
  }

  if (integrationKey === "openai") {
    if (!config.apiKey) {
      res.json({ success: false, message: "OpenAI API key is not configured" });
      return;
    }
    try {
      const client = new OpenAI({ apiKey: String(config.apiKey), timeout: 15_000, maxRetries: 0 });
      await client.models.retrieve(String(config.model || "gpt-6.1-sol"));
      res.json({ success: true, message: "Connection test passed — OpenAI API key and selected model are available" });
    } catch (err: any) {
      const msg = err?.status === 401
        ? "Invalid OpenAI API key"
        : err?.status === 429
          ? "Rate limited — but the OpenAI API key was accepted"
          : err?.status === 404
            ? "The selected OpenAI model is not available to this project"
            : `Connection failed: ${err?.message || "Unknown error"}`;
      res.json({ success: err?.status === 429, message: msg });
    }
    return;
  }

  if (integrationKey === "openweather") {
    if (!config.apiKey) {
      res.json({ success: false, message: "OpenWeather API key is not configured" });
      return;
    }
    try {
      await testOpenWeatherConnection(String(config.apiKey));
      res.json({ success: true, message: "OpenWeather connection verified successfully" });
    } catch (error) {
      const code = error instanceof Error ? error.message : "weather_sync_failed";
      const message = code === "weather_provider_http_401"
        ? "OpenWeather rejected the API key"
        : code === "weather_provider_http_429"
          ? "OpenWeather rate limit reached; try again later"
          : code === "weather_hourly_quota_exhausted"
            ? "The local hourly OpenWeather quota is full; try again after the rolling window resets"
          : "OpenWeather connection could not be verified";
      res.json({ success: false, message, code });
    }
    return;
  }

  if (isAnthropicConnectionKey(String(req.params.key).trim().toLowerCase())) {
    if (!config.apiKey) {
      res.json({ success: false, message: "API key is not configured" });
      return;
    }
    try {
      const client = new Anthropic({ apiKey: config.apiKey, timeout: 15_000, maxRetries: 0 });
      await client.models.retrieve(String(config.model || "claude-sonnet-5-5"));
      res.json({ success: true, message: "Connection test passed — Anthropic API key and selected model are available" });
    } catch (err: any) {
      const msg = err?.status === 401
        ? "Invalid API key"
        : err?.status === 429
          ? "Rate limited — but the Anthropic API key was accepted"
          : err?.status === 404
            ? "The selected Anthropic model is not available to this workspace"
          : `Connection failed: ${err?.message || "Unknown error"}`;
      const success = err?.status === 429;
      res.json({ success, message: msg });
    }
    return;
  }

  if (String(req.params.key) === "smtp") {
    if (!config.host || !config.username || !config.password) {
      res.json({ success: false, message: "SMTP host, username, and password are required" });
      return;
    }
    try {
      const transporter = await createSmtpTransporter({
        host: config.host,
        port: parseInt(config.port, 10) || 587,
        username: config.username,
        password: config.password,
      });
      await transporter.verify();
      res.json({ success: true, message: "SMTP connection verified successfully" });
    } catch (err: any) {
      res.json({ success: false, message: `SMTP connection failed: ${err?.message || "Unknown error"}` });
    }
    return;
  }

  if (String(req.params.key) === "whatsapp") {
    if (!isLiveIntegrationsEnabled()) {
      res.json(simulatedIntegrationTestResult("Live credential check was skipped; simulated mode is not health evidence."));
      return;
    }
    if (!config.phoneNumberId || !config.accessToken) {
      res.json({ success: false, message: "Phone Number ID and Access Token are required" });
      return;
    }
    try {
      const r = await fetch(
        `https://graph.facebook.com/v20.0/${encodeURIComponent(config.phoneNumberId)}`,
        { headers: { Authorization: `Bearer ${config.accessToken}` } },
      );
      if (r.ok) {
        res.json({ success: true, message: "WhatsApp Cloud API credentials verified" });
      } else {
        const body = await r.text();
        res.json({ success: false, message: `WhatsApp test failed (${r.status}): ${body.slice(0, 200)}` });
      }
    } catch (err: any) {
      res.json({ success: false, message: `WhatsApp test failed: ${err?.message || "Unknown error"}` });
    }
    return;
  }

  if (String(req.params.key) === "facebook_messenger") {
    if (!isLiveIntegrationsEnabled()) {
      res.json(simulatedIntegrationTestResult("Live credential check was skipped; simulated mode is not health evidence."));
      return;
    }
    if (!config.pageId || !config.pageAccessToken) {
      res.json({ success: false, message: "Page ID and Page Access Token are required" });
      return;
    }
    try {
      const r = await fetch(
        `https://graph.facebook.com/${META_API_VERSION}/${encodeURIComponent(config.pageId)}?fields=name`,
        { headers: { Authorization: `Bearer ${config.pageAccessToken}` } },
      );
      const data: unknown = await r.json().catch(() => ({}));
      if (r.ok) {
        const name = typeof (data as { name?: unknown }).name === "string" ? (data as { name: string }).name : undefined;
        res.json({ success: true, message: name ? `Messenger connected — Page: ${name}` : "Messenger credentials verified" });
      } else {
        const errMsg = (data as { error?: { message?: string } })?.error?.message || `HTTP ${r.status}`;
        res.json({ success: false, message: `Messenger test failed (${r.status}): ${errMsg}` });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      res.json({ success: false, message: `Messenger test failed: ${msg}` });
    }
    return;
  }

  if (String(req.params.key) === "instagram") {
    if (!isLiveIntegrationsEnabled()) {
      res.json(simulatedIntegrationTestResult("Live credential check was skipped; simulated mode is not health evidence."));
      return;
    }
    if (!config.igBusinessAccountId || !config.pageAccessToken) {
      res.json({ success: false, message: "Instagram Business Account ID and Page Access Token are required" });
      return;
    }
    try {
      const r = await fetch(
        `https://graph.facebook.com/${META_API_VERSION}/${encodeURIComponent(config.igBusinessAccountId)}?fields=username`,
        { headers: { Authorization: `Bearer ${config.pageAccessToken}` } },
      );
      const data: unknown = await r.json().catch(() => ({}));
      if (r.ok) {
        const username = typeof (data as { username?: unknown }).username === "string" ? (data as { username: string }).username : undefined;
        res.json({ success: true, message: username ? `Instagram connected — @${username}` : "Instagram credentials verified" });
      } else {
        const errMsg = (data as { error?: { message?: string } })?.error?.message || `HTTP ${r.status}`;
        res.json({ success: false, message: `Instagram test failed (${r.status}): ${errMsg}` });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      res.json({ success: false, message: `Instagram test failed: ${msg}` });
    }
    return;
  }

  if (String(req.params.key) === "web_form") {
    if (!config.formId || !config.secret) {
      res.json({ success: false, message: "Web form has no formId/secret yet — save first to generate" });
      return;
    }
    if (!isLiveIntegrationsEnabled()) {
      res.json(simulatedIntegrationTestResult("Web form configuration exists, but live submission was not verified."));
      return;
    }
    res.json({ success: true, verified: true, simulated: false, status: "verified", message: "Web form is live — submissions will be accepted." });
    return;
  }

  if (String(req.params.key) === "zernio") {
    if (!config.apiKey || !config.webhookSecret) {
      res.json({ success: false, message: "API Key and Webhook Secret are required" });
      return;
    }
    if (!isLiveIntegrationsEnabled()) {
      res.json(simulatedIntegrationTestResult("Live credential check was skipped; simulated mode is not health evidence."));
      return;
    }
    try {
      const acct = await resolveZernioWhatsAppAccount();
      if (!acct) {
        res.json({ success: false, message: "Zernio accountId çözülemedi — önce WhatsApp channel account'ı kaydet/bağla." });
        return;
      }
      const outcome = await listZernioWhatsAppTemplates(acct.externalAccountId);
      if (outcome.ok) {
        res.json({ success: true, message: "Zernio API key doğrulandı (WhatsApp templates erişilebilir)." });
      } else {
        const clean = String(outcome.error || "").trim().startsWith("<")
          ? `HTTP hata (HTML yanıt)`
          : (outcome.error || "unknown").slice(0, 200);
        res.json({ success: false, message: `Zernio test failed: ${clean}` });
      }
    } catch (err: any) {
      res.json({ success: false, message: `Zernio test failed: ${err?.message || "Unknown error"}` });
    }
    return;
  }

  res.json(unsupportedIntegrationTestResult("No real connection verifier is implemented for this integration."));
});

export default router;
