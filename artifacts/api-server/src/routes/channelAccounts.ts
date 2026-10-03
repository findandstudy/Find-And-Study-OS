/** Existing encrypted account registry. SMTP stays exclusively revision-bound under notification-email/senders. */
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db, channelAccountsTable, conversationsTable, communicationPipelineAccountsTable, pipelineStagesTable,
  pipelineStageMessageDispatchesTable, messageCampaignRecipientsTable, auditLogsTable } from "@workspace/db";
import { and, eq, ne, asc, sql, or } from "drizzle-orm";
import { requireAuth, requireRole } from "../lib/auth";
import { ADMIN_ROLES } from "../lib/roles";
import { emailAutomationHumanAllowed } from "../lib/notifications/emailAutomationPolicy";
import { META_API_VERSION } from "../lib/inbox/channels/meta-shared";
import { simulatedIntegrationTestResult, unsupportedIntegrationTestResult } from "../lib/integrationTestResult";
import { parseAccountConfig, serializeAccountConfig } from "../lib/inbox/channelAccountConfig";
import { getZernioApiKey } from "../lib/inbox/zernioSend";
import { verifyZernioManagedAccount } from "../lib/inbox/channelAccountVerification";
import { accountCapabilities, accountFilter, accountKind, accountRecord, accountText, accountVerificationAllowed, assertAccountActivation,
  ChannelAccountInputError, managedAccountConfig, managedExternalId, safeManagedAccountConfig } from "../lib/inbox/channelAccountManagementPolicy";

const router: IRouter = Router();
router.use("/channel-accounts", (_req, res, next) => { res.setHeader("Cache-Control", "private, no-store"); next(); });
async function humanAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!await emailAutomationHumanAllowed(req)) { res.status(403).json({ error: "ACCOUNT_HUMAN_ADMIN_REQUIRED" }); return; }
    next();
  } catch { res.status(503).json({ error: "ACCOUNT_AUTHORITY_UNAVAILABLE" }); }
}
const handle = (work: (req: Request, res: Response) => Promise<void>) => async (req: Request, res: Response): Promise<void> => {
  try { await work(req, res); }
  catch (error) {
    if (error instanceof ChannelAccountInputError) { res.status(error.status).json({ error: error.code }); return; }
    // Provider/DB/encryption errors may contain secrets. Only stable codes leave this boundary.
    res.status(503).json({ error: "ACCOUNT_OPERATION_UNAVAILABLE" });
  }
};
function accountId(raw: unknown): number {
  if (typeof raw !== "string" || !/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw))) throw new ChannelAccountInputError("ACCOUNT_ID_INVALID");
  return Number(raw);
}
function safeConfig(row: typeof channelAccountsTable.$inferSelect): Record<string, unknown> {
  try { return parseAccountConfig(row.configEncrypted); } catch { return {}; }
}
function serializeRow(row: typeof channelAccountsTable.$inferSelect): Record<string, unknown> {
  const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata as Record<string, unknown> : {};
  return { id: row.id, channel: row.channel === "facebook" && row.provider === "zernio" ? "messenger" : row.channel, provider: row.provider, displayName: row.displayName,
    externalAccountId: row.externalAccountId, config: safeManagedAccountConfig(row.channel, row.provider, safeConfig(row)),
    status: row.status, isActive: row.isActive, isDefault: row.isDefault,
    brandLabel: typeof metadata.brandLabel === "string" ? metadata.brandLabel : null,
    brandColor: typeof metadata.brandColor === "string" ? metadata.brandColor : null,
    capabilities: accountCapabilities(row.channel, row.provider),
    lastSeenAt: row.lastSeenAt, createdAt: row.createdAt, updatedAt: row.updatedAt };
}
function brandMetadata(data: Record<string, unknown>, previous: unknown = {}): Record<string, unknown> {
  const metadata = previous && typeof previous === "object" && !Array.isArray(previous) ? { ...previous as Record<string, unknown> } : {};
  if (data.brandLabel !== undefined) metadata.brandLabel = accountText(data.brandLabel, 80, "ACCOUNT_BRAND_INVALID", true);
  if (data.brandColor !== undefined) {
    const color = accountText(data.brandColor, 7, "ACCOUNT_BRAND_INVALID", true);
    if (color && !/^#[0-9a-f]{6}$/i.test(color)) throw new ChannelAccountInputError("ACCOUNT_BRAND_INVALID");
    metadata.brandColor = color.toUpperCase();
  }
  return metadata;
}
function booleanInput(data: Record<string, unknown>, key: string): void {
  if (data[key] !== undefined && typeof data[key] !== "boolean") throw new ChannelAccountInputError("ACCOUNT_BOOLEAN_INVALID");
}
type AccountTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
async function managementLock(tx: AccountTransaction): Promise<void> {
  // Also serializes Zernio account identity across channels, without a new schema/index.
  await tx.execute(sql`SET LOCAL lock_timeout = '2000ms'`);
  await tx.execute(sql`SET LOCAL statement_timeout = '5000ms'`);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('channel-account-management'), 0)`);
}
async function writeAccountAudit(tx: AccountTransaction, req: Request, action: string, resourceId: number, changes: Record<string, unknown>): Promise<void> {
  await tx.insert(auditLogsTable).values({
    userId: req.user!.id,
    action,
    resource: "channel_account",
    resourceId,
    changes: JSON.stringify(changes),
    ipAddress: req.ip || null,
  });
}
async function assertUniqueIdentity(tx: AccountTransaction, channel: string, provider: string, externalId: string | null, exceptId?: number): Promise<void> {
  if (!externalId) return;
  const [duplicate] = await tx.select({ id: channelAccountsTable.id }).from(channelAccountsTable)
    .where(and(eq(channelAccountsTable.provider, provider), provider === "zernio" ? undefined : eq(channelAccountsTable.channel, channel),
      eq(channelAccountsTable.externalAccountId, externalId), exceptId === undefined ? undefined : ne(channelAccountsTable.id, exceptId))).limit(1);
  if (duplicate) throw new ChannelAccountInputError("ACCOUNT_IDENTITY_EXISTS", 409);
}
function channelGroup(channel: string) {
  return channel === "messenger" || channel === "facebook"
    ? or(eq(channelAccountsTable.channel, "messenger"), and(eq(channelAccountsTable.channel, "facebook"), eq(channelAccountsTable.provider, "zernio")))!
    : eq(channelAccountsTable.channel, channel);
}

/** Existing manager read access remains; no SMTP or unbounded config projection is exposed. */
router.get("/channel-accounts", requireAuth, requireRole(...ADMIN_ROLES), handle(async (req, res) => {
  const filter = accountFilter(req.query);
  const rows = await db.select().from(channelAccountsTable).where(and(ne(channelAccountsTable.channel, "email"),
    filter.channel ? channelGroup(filter.channel) : undefined,
    filter.provider ? eq(channelAccountsTable.provider, filter.provider) : undefined))
    .orderBy(asc(channelAccountsTable.channel), asc(channelAccountsTable.id)).limit(1001);
  res.json({ accounts: rows.filter(row => row.channel !== "email").slice(0, 1000).map(serializeRow), hasMore: rows.length > 1000 });
}));

router.post("/channel-accounts", requireAuth, requireRole(...ADMIN_ROLES), humanAdmin, handle(async (req, res) => {
  const data = accountRecord(req.body);
  const { channel, provider } = accountKind(data.channel, data.provider);
  const displayName = accountText(data.displayName, 120, "ACCOUNT_NAME_REQUIRED");
  const config = managedAccountConfig(channel, provider, data.config);
  const externalAccountId = managedExternalId(channel, provider, config, data.externalAccountId);
  const metadata = brandMetadata(data);
  booleanInput(data, "isActive"); booleanInput(data, "isDefault");
  const active = channel === "telegram" || channel === "sms" || provider === "zernio" ? false : data.isActive !== false;
  if (active) assertAccountActivation(channel, provider, config, externalAccountId);
  const result = await db.transaction(async tx => {
    await managementLock(tx);
    await assertUniqueIdentity(tx, channel, provider, externalAccountId);
    const [existing] = await tx.select({ id: channelAccountsTable.id }).from(channelAccountsTable).where(channelGroup(channel)).limit(1);
    const makeDefault = !accountCapabilities(channel, provider).configurationOnly && (data.isDefault === true || !existing);
    if (makeDefault) await tx.update(channelAccountsTable).set({ isDefault: false }).where(channelGroup(channel));
    const [row] = await tx.insert(channelAccountsTable).values({ channel, provider, displayName, externalAccountId,
      configEncrypted: serializeAccountConfig(config), status: active ? "active" : "inactive", isActive: active, isDefault: makeDefault, metadata }).returning();
    await writeAccountAudit(tx, req, "create_channel_account", row.id, { channel, provider });
    return row;
  });
  res.status(201).json(serializeRow(result));
}));

router.put("/channel-accounts/:id", requireAuth, requireRole(...ADMIN_ROLES), humanAdmin, handle(async (req, res) => {
  const id = accountId(req.params.id);
  const data = accountRecord(req.body);
  const [existing] = await db.select().from(channelAccountsTable).where(eq(channelAccountsTable.id, id));
  if (!existing) { res.status(404).json({ error: "ACCOUNT_NOT_FOUND" }); return; }
  if (existing.channel === "email") { res.status(409).json({ error: "managed_email_sender" }); return; }
  const { channel, provider } = accountKind(existing.channel, existing.provider);
  if ((data.channel !== undefined && data.channel !== channel) || (data.provider !== undefined && data.provider !== provider)
    || (data.externalAccountId !== undefined && data.externalAccountId !== existing.externalAccountId)) throw new ChannelAccountInputError("ACCOUNT_IDENTITY_IMMUTABLE", 409);
  const result = await db.transaction(async tx => {
    await managementLock(tx);
    const [current] = await tx.select().from(channelAccountsTable).where(eq(channelAccountsTable.id, id)).for("update");
    if (!current) throw new ChannelAccountInputError("ACCOUNT_NOT_FOUND", 404);
    const config = managedAccountConfig(channel, provider, data.config, safeConfig(current));
    const externalAccountId = managedExternalId(channel, provider, config, provider === "zernio" ? current.externalAccountId : undefined) || current.externalAccountId;
    if (current.externalAccountId && current.externalAccountId !== externalAccountId) throw new ChannelAccountInputError("ACCOUNT_IDENTITY_IMMUTABLE", 409);
    await assertUniqueIdentity(tx, channel, provider, externalAccountId, id);
    const [row] = await tx.update(channelAccountsTable).set({
      displayName: data.displayName === undefined ? current.displayName : accountText(data.displayName, 120, "ACCOUNT_NAME_REQUIRED"),
      configEncrypted: serializeAccountConfig(config), externalAccountId, metadata: brandMetadata(data, current.metadata),
      ...(accountCapabilities(channel, provider).configurationOnly ? { isActive: false, status: "inactive" } : {}),
    }).where(eq(channelAccountsTable.id, id)).returning();
    await writeAccountAudit(tx, req, "update_channel_account", id, { channel, provider });
    return row;
  });
  res.json(serializeRow(result));
}));

router.patch("/channel-accounts/:id/toggle-active", requireAuth, requireRole(...ADMIN_ROLES), humanAdmin, handle(async (req, res) => {
  const id = accountId(req.params.id);
  const [existing] = await db.select().from(channelAccountsTable).where(eq(channelAccountsTable.id, id));
  if (!existing) { res.status(404).json({ error: "ACCOUNT_NOT_FOUND" }); return; }
  if (existing.channel === "email") { res.status(409).json({ error: "managed_email_sender" }); return; }
  const { channel, provider } = accountKind(existing.channel, existing.provider);
  const result = await db.transaction(async tx => {
    await managementLock(tx);
    const [current] = await tx.select().from(channelAccountsTable).where(eq(channelAccountsTable.id, id)).for("update");
    if (!current) throw new ChannelAccountInputError("ACCOUNT_NOT_FOUND", 404);
    const active = !current.isActive;
    if (active && accountCapabilities(channel, provider).configurationOnly) throw new ChannelAccountInputError("ACCOUNT_DELIVERY_UNSUPPORTED", 409);
    if (active) {
      const config = managedAccountConfig(channel, provider, undefined, safeConfig(current));
      const externalId = managedExternalId(channel, provider, config, provider === "zernio" ? current.externalAccountId : undefined);
      assertAccountActivation(channel, provider, config, externalId);
      await assertUniqueIdentity(tx, channel, provider, externalId, id);
    }
    const [row] = await tx.update(channelAccountsTable).set({ isActive: active, status: active ? "active" : "inactive" }).where(eq(channelAccountsTable.id, id)).returning();
    await writeAccountAudit(tx, req, "toggle_channel_account", id, { channel, isActive: row.isActive });
    return row;
  });
  res.json(serializeRow(result));
}));

router.patch("/channel-accounts/:id/set-default", requireAuth, requireRole(...ADMIN_ROLES), humanAdmin, handle(async (req, res) => {
  const id = accountId(req.params.id);
  const [existing] = await db.select().from(channelAccountsTable).where(eq(channelAccountsTable.id, id));
  if (!existing) { res.status(404).json({ error: "ACCOUNT_NOT_FOUND" }); return; }
  if (existing.channel === "email") { res.status(409).json({ error: "managed_email_sender" }); return; }
  accountKind(existing.channel, existing.provider);
  if (accountCapabilities(existing.channel, existing.provider).configurationOnly) throw new ChannelAccountInputError("ACCOUNT_DELIVERY_UNSUPPORTED", 409);
  const result = await db.transaction(async tx => {
    await managementLock(tx);
    const [current] = await tx.select().from(channelAccountsTable).where(eq(channelAccountsTable.id, id)).for("update");
    if (!current) throw new ChannelAccountInputError("ACCOUNT_NOT_FOUND", 404);
    await tx.update(channelAccountsTable).set({ isDefault: false }).where(and(channelGroup(existing.channel), ne(channelAccountsTable.id, id)));
    const [row] = await tx.update(channelAccountsTable).set({ isDefault: true }).where(eq(channelAccountsTable.id, id)).returning();
    await writeAccountAudit(tx, req, "set_default_channel_account", id, { channel: current.channel });
    return row;
  });
  res.json(serializeRow(result));
}));

router.delete("/channel-accounts/:id", requireAuth, requireRole(...ADMIN_ROLES), humanAdmin, handle(async (req, res) => {
  const id = accountId(req.params.id);
  const [existing] = await db.select().from(channelAccountsTable).where(eq(channelAccountsTable.id, id));
  if (!existing) { res.status(404).json({ error: "ACCOUNT_NOT_FOUND" }); return; }
  if (existing.channel === "email") { res.status(409).json({ error: "managed_email_sender" }); return; }
  accountKind(existing.channel, existing.provider);
  await db.transaction(async tx => {
    await managementLock(tx);
    const [current] = await tx.select().from(channelAccountsTable).where(eq(channelAccountsTable.id, id)).for("update");
    if (!current) throw new ChannelAccountInputError("ACCOUNT_NOT_FOUND", 404);
    const [linked] = await tx.select({ id: conversationsTable.id }).from(conversationsTable).where(eq(conversationsTable.channelAccountId, id)).limit(1);
    if (linked) throw new ChannelAccountInputError("account_has_conversations", 409);
    const [pipelineLink] = await tx.select({ id: communicationPipelineAccountsTable.id }).from(communicationPipelineAccountsTable).where(eq(communicationPipelineAccountsTable.channelAccountId, id)).limit(1);
    const [stageLink] = await tx.select({ id: pipelineStagesTable.id }).from(pipelineStagesTable).where(sql`${pipelineStagesTable.automaticMessage}->>'channelAccountId' = ${String(id)}`).limit(1);
    const [dispatchLink] = await tx.select({ id: pipelineStageMessageDispatchesTable.id }).from(pipelineStageMessageDispatchesTable).where(eq(pipelineStageMessageDispatchesTable.channelAccountId, id)).limit(1);
    const [campaignLink] = await tx.select({ id: messageCampaignRecipientsTable.id }).from(messageCampaignRecipientsTable).where(eq(messageCampaignRecipientsTable.channelAccountId, id)).limit(1);
    if (pipelineLink || stageLink || dispatchLink || campaignLink) throw new ChannelAccountInputError("ACCOUNT_IN_USE", 409);
    await tx.delete(channelAccountsTable).where(eq(channelAccountsTable.id, id));
    if (current.isDefault) {
      const [next] = await tx.select().from(channelAccountsTable).where(channelGroup(existing.channel)).orderBy(asc(channelAccountsTable.id)).limit(1);
      if (next) await tx.update(channelAccountsTable).set({ isDefault: true }).where(eq(channelAccountsTable.id, next.id));
    }
    await writeAccountAudit(tx, req, "delete_channel_account", id, { channel: current.channel });
  });
  res.json({ ok: true });
}));

/** Read-only credential check; never sends a message or registers a webhook. */
router.post("/channel-accounts/:id/test", requireAuth, requireRole(...ADMIN_ROLES), humanAdmin, handle(async (req, res) => {
  const id = accountId(req.params.id);
  const [existing] = await db.select().from(channelAccountsTable).where(eq(channelAccountsTable.id, id));
  if (!existing) { res.status(404).json({ error: "ACCOUNT_NOT_FOUND" }); return; }
  if (existing.channel === "email") { res.status(409).json({ error: "managed_email_sender" }); return; }
  const { channel, provider } = accountKind(existing.channel, existing.provider);
  if (!accountCapabilities(channel, provider).verificationSupported) {
    res.json(unsupportedIntegrationTestResult("Configuration is stored; no connection verifier is implemented for this account type.")); return;
  }
  if (!accountVerificationAllowed()) { res.json(simulatedIntegrationTestResult("Live credential check was skipped; simulated mode is not health evidence.")); return; }
  const config = safeConfig(existing);
  let verified = false;
  if (provider === "zernio") {
    const apiKey = await getZernioApiKey();
    if (apiKey && existing.externalAccountId) verified = await verifyZernioManagedAccount(apiKey, existing.externalAccountId);
  } else {
    const externalId = channel === "whatsapp" ? config.phoneNumberId : channel === "messenger" ? config.pageId : config.igBusinessAccountId;
    const token = channel === "whatsapp" ? config.accessToken : config.pageAccessToken;
    if (typeof externalId === "string" && typeof token === "string" && externalId && token && !token.startsWith("enc::")) {
      try {
        const response = await fetch(`https://graph.facebook.com/${META_API_VERSION}/${encodeURIComponent(externalId)}`, {
          headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000), redirect: "error",
        });
        verified = response.ok;
        await response.body?.cancel();
      } catch { /* Provider errors may echo credentials; emit a stable result only. */ }
    }
  }
  res.json({ success: verified, verified, simulated: false, status: verified ? "verified" : "failed",
    message: verified ? "Account credentials verified (read-only check)." : "Account credentials could not be verified." });
}));

export default router;
