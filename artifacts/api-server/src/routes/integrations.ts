import { Router, type IRouter } from "express";
import { db, integrationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, requireRole, logAudit } from "../lib/auth";
import { ADMIN_ROLES } from "../lib/roles";
import Anthropic from "@anthropic-ai/sdk";
import { clearConfigCache } from "@workspace/integrations-anthropic-ai";
import { createSmtpTransporter, invalidateSmtpCache } from "../lib/email";

const router: IRouter = Router();

router.get("/integrations", requireAuth, requireRole(...ADMIN_ROLES), async (_req, res): Promise<void> => {
  const integrations = await db
    .select()
    .from(integrationsTable)
    .orderBy(integrationsTable.category, integrationsTable.name);

  const masked = integrations.map((i) => ({
    ...i,
    config: maskSecrets(i.config as Record<string, any>),
  }));

  res.json({ data: masked });
});

router.get("/integrations/:key", requireAuth, requireRole(...ADMIN_ROLES), async (req, res): Promise<void> => {
  const [integration] = await db
    .select()
    .from(integrationsTable)
    .where(eq(integrationsTable.key, req.params.key));

  if (!integration) {
    res.status(404).json({ error: "Integration not found" });
    return;
  }

  res.json({
    ...integration,
    config: maskSecrets(integration.config as Record<string, any>),
  });
});

router.put("/integrations/:key", requireAuth, requireRole(...ADMIN_ROLES), async (req, res): Promise<void> => {
  const { key } = req.params;
  const { name, category, isEnabled, config } = req.body;

  if (!name || !category) {
    res.status(400).json({ error: "Name and category are required" });
    return;
  }

  const [existing] = await db
    .select()
    .from(integrationsTable)
    .where(eq(integrationsTable.key, key));

  let result;
  if (existing) {
    const mergedConfig = mergeConfig(existing.config as Record<string, any>, config || {});
    [result] = await db
      .update(integrationsTable)
      .set({
        name,
        category,
        isEnabled: isEnabled ?? existing.isEnabled,
        config: mergedConfig,
      })
      .where(eq(integrationsTable.key, key))
      .returning();
  } else {
    [result] = await db
      .insert(integrationsTable)
      .values({ key, name, category, isEnabled: isEnabled ?? false, config: config || {} })
      .returning();
  }

  if (key === "claude") clearConfigCache();
  if (key === "smtp") invalidateSmtpCache();
  await logAudit(req.user!.id, "update_integration", "integration", result.id, { key, isEnabled: result.isEnabled }, req.ip);
  res.json({ ...result, config: maskSecrets(result.config as Record<string, any>) });
});

router.patch("/integrations/:key/toggle", requireAuth, requireRole(...ADMIN_ROLES), async (req, res): Promise<void> => {
  const [existing] = await db
    .select()
    .from(integrationsTable)
    .where(eq(integrationsTable.key, req.params.key));

  if (!existing) {
    res.status(404).json({ error: "Integration not found" });
    return;
  }

  const [result] = await db
    .update(integrationsTable)
    .set({ isEnabled: !existing.isEnabled })
    .where(eq(integrationsTable.key, req.params.key))
    .returning();

  if (req.params.key === "claude") clearConfigCache();
  if (req.params.key === "smtp") invalidateSmtpCache();
  await logAudit(req.user!.id, "toggle_integration", "integration", result.id, { key: req.params.key, isEnabled: result.isEnabled }, req.ip);
  res.json({ ...result, config: maskSecrets(result.config as Record<string, any>) });
});

router.post("/integrations/:key/test", requireAuth, requireRole(...ADMIN_ROLES), async (req, res): Promise<void> => {
  const [integration] = await db
    .select()
    .from(integrationsTable)
    .where(eq(integrationsTable.key, req.params.key));

  if (!integration) {
    res.status(404).json({ error: "Integration not found" });
    return;
  }

  const config = integration.config as Record<string, any>;

  if (req.params.key === "claude") {
    if (!config.apiKey) {
      res.json({ success: false, message: "API key is not configured" });
      return;
    }
    try {
      const client = new Anthropic({ apiKey: config.apiKey });
      await client.messages.create({
        model: config.model || "claude-sonnet-4-6",
        max_tokens: 5,
        messages: [{ role: "user", content: "Hi" }],
      });
      res.json({ success: true, message: "Connection test passed — Anthropic API key is valid" });
    } catch (err: any) {
      const msg = err?.status === 401
        ? "Invalid API key"
        : err?.status === 429
          ? "Rate limited — but API key is valid"
          : `Connection failed: ${err?.message || "Unknown error"}`;
      const success = err?.status === 429;
      res.json({ success, message: msg });
    }
    return;
  }

  if (req.params.key === "smtp") {
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

  res.json({ success: true, message: "Connection test passed (simulated)" });
});

function maskSecrets(config: Record<string, any>): Record<string, any> {
  const masked: Record<string, any> = {};
  const secretKeys = ["password", "token", "secret", "api_key", "apiKey", "accessToken", "access_token", "appSecret", "app_secret"];
  for (const [k, v] of Object.entries(config)) {
    if (typeof v === "string" && secretKeys.some((s) => k.toLowerCase().includes(s.toLowerCase())) && v.length > 0) {
      masked[k] = v.slice(0, 4) + "•".repeat(Math.min(v.length - 4, 20));
    } else {
      masked[k] = v;
    }
  }
  return masked;
}

function mergeConfig(existing: Record<string, any>, incoming: Record<string, any>): Record<string, any> {
  const merged = { ...existing };
  const secretKeys = ["password", "token", "secret", "api_key", "apiKey", "accessToken", "access_token", "appSecret", "app_secret"];
  for (const [k, v] of Object.entries(incoming)) {
    if (typeof v === "string" && secretKeys.some((s) => k.toLowerCase().includes(s.toLowerCase())) && v.includes("•")) {
      continue;
    }
    merged[k] = v;
  }
  return merged;
}

export default router;
