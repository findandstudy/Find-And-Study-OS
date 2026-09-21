import { Router, type IRouter, type Request, type Response } from "express";
import { db, channelAccountsTable, messageTemplatesTable, emailTemplateVersionsTable, stageEmailDispatchesTable, emailQueueTable } from "@workspace/db";
import { and, desc, eq, inArray, lt, isNotNull, sql } from "drizzle-orm";
import { logAudit } from "../lib/auth";
import { requireEmailAutomationHuman } from "../lib/notifications/emailAutomationPolicy";
import { EMAIL_TEMPLATE_CATEGORIES, EMAIL_TEMPLATE_LANGUAGES, EMAIL_TEMPLATE_VARIABLES, STAGE_EMAIL_TEMPLATE_VARIABLES, EmailLibraryError,
  positiveEmailId, validateEmailVersion, renderEmailVersion, canTransitionEmailVersion } from "../lib/notifications/emailTemplateLibrary";
import { emailSenderMetadata, safeEmailSender, senderInputFromRow, validateEmailSender, verifyEmailSenderConnection } from "../lib/notifications/emailSenderAccounts";
import { serializeAccountConfig } from "../lib/inbox/channelAccountConfig";
import { emailDeliveryAllowed } from "../lib/emailDeliveryPolicy";
import { stageEmailRuntime } from "../lib/notifications/stageEmailPolicy";
import { backgroundJobsEnabled } from "../lib/backgroundJobs";

const router: IRouter = Router();
router.use("/notification-email", requireEmailAutomationHuman, (_req, res, next) => { res.set("Cache-Control", "private, no-store"); next(); });
const handle = (action: (req: Request, res: Response) => Promise<void>) => async (req: Request, res: Response): Promise<void> => {
  try { await action(req, res); }
  catch (error) {
    if (error instanceof EmailLibraryError) { res.status(error.status).json({ error: error.code }); return; }
    // Database/SMTP errors may contain credentials or recipient data. Never reflect them.
    res.status(503).json({ error: "EMAIL_LIBRARY_UNAVAILABLE" });
  }
};
const senderWhere = (id: number) => and(eq(channelAccountsTable.id, id), eq(channelAccountsTable.channel, "email"), eq(channelAccountsTable.provider, "smtp"));
function identity(input: unknown) {
  const data = input as Record<string, unknown> | null;
  if (!data || typeof data.name !== "string" || !data.name.trim() || data.name.length > 160 || /[\x00-\x1f]/.test(data.name)
    || (data.category !== undefined && (typeof data.category !== "string" || !EMAIL_TEMPLATE_CATEGORIES.includes(data.category)))) throw new EmailLibraryError("EMAIL_TEMPLATE_IDENTITY_INVALID");
  return { name: data.name.trim(), category: typeof data.category === "string" ? data.category : "applications" };
}

router.get("/notification-email/capabilities", handle(async (_req, res) => {
  res.json({ enabled: stageEmailRuntime().enabled && emailDeliveryAllowed() && backgroundJobsEnabled(), runtimeConfigured: stageEmailRuntime().enabled,
    deliveryAllowed: emailDeliveryAllowed(), backgroundJobsConfigured: backgroundJobsEnabled(), verificationAllowed: emailDeliveryAllowed(), canManage: true,
    variables: EMAIL_TEMPLATE_VARIABLES, stageVariables: STAGE_EMAIL_TEMPLATE_VARIABLES, languages: EMAIL_TEMPLATE_LANGUAGES, categories: EMAIL_TEMPLATE_CATEGORIES });
}));

router.get("/notification-email/senders", handle(async (_req, res) => {
  const rows = await db.select().from(channelAccountsTable).where(and(eq(channelAccountsTable.channel, "email"), eq(channelAccountsTable.provider, "smtp")))
    .orderBy(desc(channelAccountsTable.id)).limit(101);
  res.json({ senders: rows.slice(0, 100).map(safeEmailSender), truncated: rows.length > 100 });
}));

router.get("/notification-email/senders/:id", handle(async (req, res) => {
  const [row] = await db.select().from(channelAccountsTable).where(senderWhere(positiveEmailId(req.params.id))).limit(1);
  if (!row) throw new EmailLibraryError("EMAIL_SENDER_NOT_FOUND", 404);
  res.json({ sender: safeEmailSender(row) });
}));

router.post("/notification-email/senders", handle(async (req, res) => {
  const input = validateEmailSender(req.body);
  const [row] = await db.insert(channelAccountsTable).values({ channel: "email", provider: "smtp", displayName: input.displayName,
    isActive: false, isDefault: false, status: "inactive",
    configEncrypted: serializeAccountConfig({ host: input.host, port: input.port, username: input.username, password: input.password }),
    metadata: { emailSender: { revision: 1, fromEmail: input.fromEmail, fromName: input.fromName, replyTo: input.replyTo,
      verified: false, createdById: req.user!.id, lastChangedById: req.user!.id } } }).returning();
  logAudit(req.user!.id, "notification_email.sender_created", "channel_account", row.id, { revision: 1 }, req.ip);
  res.status(201).json({ sender: safeEmailSender(row) });
}));

router.patch("/notification-email/senders/:id", handle(async (req, res) => {
  const id = positiveEmailId(req.params.id), expected = positiveEmailId(req.body?.expectedRevision);
  const row = await db.transaction(async tx => {
    const [old] = await tx.select().from(channelAccountsTable).where(senderWhere(id)).for("update");
    if (!old) throw new EmailLibraryError("EMAIL_SENDER_NOT_FOUND", 404);
    const meta = emailSenderMetadata(old.metadata);
    if (!meta || meta.revision !== expected) throw new EmailLibraryError("EMAIL_SENDER_REVISION_CONFLICT", 409);
    if (req.body.isActive === true) throw new EmailLibraryError("EMAIL_SENDER_VERIFICATION_REQUIRED", 409);
    const input = validateEmailSender(req.body, senderInputFromRow(old));
    const revision = positiveEmailId(meta.revision + 1);
    const [updated] = await tx.update(channelAccountsTable).set({ displayName: input.displayName, status: "inactive", isActive: false,
      configEncrypted: serializeAccountConfig({ host: input.host, port: input.port, username: input.username, password: input.password }),
      metadata: { emailSender: { revision, fromEmail: input.fromEmail, fromName: input.fromName, replyTo: input.replyTo,
        verified: false, createdById: meta.createdById, lastChangedById: req.user!.id } }, updatedAt: new Date() }).where(senderWhere(id)).returning();
    return updated;
  });
  logAudit(req.user!.id, "notification_email.sender_updated", "channel_account", id, { revision: emailSenderMetadata(row.metadata)?.revision }, req.ip);
  res.json({ sender: safeEmailSender(row) });
}));

router.post("/notification-email/senders/:id/verify", handle(async (req, res) => {
  const id = positiveEmailId(req.params.id), expected = positiveEmailId(req.body?.expectedRevision);
  if (!emailDeliveryAllowed()) throw new EmailLibraryError("EMAIL_VERIFICATION_DISABLED", 409);
  const [old] = await db.select().from(channelAccountsTable).where(senderWhere(id)).limit(1);
  if (!old) throw new EmailLibraryError("EMAIL_SENDER_NOT_FOUND", 404);
  const meta = emailSenderMetadata(old.metadata);
  if (!meta || meta.revision !== expected) throw new EmailLibraryError("EMAIL_SENDER_REVISION_CONFLICT", 409);
  if (meta.lastChangedById === req.user!.id) throw new EmailLibraryError("EMAIL_SECOND_REVIEWER_REQUIRED", 403);
  await verifyEmailSenderConnection(id, senderInputFromRow(old));
  // Never hold DB locks while waiting for an external SMTP server.
  const row = await db.transaction(async tx => {
    const [current] = await tx.select().from(channelAccountsTable).where(senderWhere(id)).for("update");
    const currentMeta = emailSenderMetadata(current?.metadata);
    if (!current || !currentMeta || currentMeta.revision !== expected || current.configEncrypted !== old.configEncrypted
      || JSON.stringify(current.metadata) !== JSON.stringify(old.metadata)) throw new EmailLibraryError("EMAIL_SENDER_REVISION_CONFLICT", 409);
    if (!emailDeliveryAllowed()) throw new EmailLibraryError("EMAIL_VERIFICATION_DISABLED", 409);
    const [updated] = await tx.update(channelAccountsTable).set({ isActive: true, status: "active",
      metadata: { emailSender: { ...currentMeta, verified: true, approvedById: req.user!.id } }, updatedAt: new Date() }).where(senderWhere(id)).returning();
    return updated;
  });
  logAudit(req.user!.id, "notification_email.sender_verified", "channel_account", id, { revision: expected, kind: "smtp_connection_authentication" }, req.ip);
  res.json({ sender: safeEmailSender(row) });
}));

router.get("/notification-email/templates", handle(async (req, res) => {
  const cursor = req.query.cursor === undefined ? undefined : positiveEmailId(req.query.cursor);
  const rows = await db.select().from(messageTemplatesTable).where(and(inArray(messageTemplatesTable.channel, ["email", "all"]), cursor ? lt(messageTemplatesTable.id, cursor) : undefined))
    .orderBy(desc(messageTemplatesTable.id)).limit(51);
  const selected = rows.slice(0, 50);
  const versions = selected.length ? await db.select().from(emailTemplateVersionsTable).where(inArray(emailTemplateVersionsTable.templateId, selected.map(row => row.id)))
    .orderBy(desc(emailTemplateVersionsTable.id)).limit(251) : [];
  res.json({ templates: selected.map(row => ({ id: row.id, name: row.name, category: row.category, channel: row.channel, language: row.language,
    isActive: row.isActive, createdById: row.createdById, versions: versions.slice(0, 250).filter(version => version.templateId === row.id) })),
    nextCursor: rows.length > 50 ? selected.at(-1)!.id : null, versionsTruncated: versions.length > 250 });
}));

router.post("/notification-email/templates", handle(async (req, res) => {
  const fields = validateEmailVersion(req.body), name = identity(req.body);
  const result = await db.transaction(async tx => {
    const [template] = await tx.insert(messageTemplatesTable).values({ ...name, ...fields, channel: "email", createdById: req.user!.id }).returning();
    const [version] = await tx.insert(emailTemplateVersionsTable).values({ templateId: template.id, version: 1, status: "draft", ...fields, createdById: req.user!.id }).returning();
    return { template, version };
  });
  logAudit(req.user!.id, "notification_email.template_created", "message_template", result.template.id, { versionId: result.version.id }, req.ip);
  res.status(201).json(result);
}));

router.post("/notification-email/templates/:id/versions", handle(async (req, res) => {
  const id = positiveEmailId(req.params.id), fields = validateEmailVersion(req.body);
  const version = await db.transaction(async tx => {
    const [template] = await tx.select().from(messageTemplatesTable).where(eq(messageTemplatesTable.id, id)).for("update");
    if (!template || !["email", "all"].includes(template.channel)) throw new EmailLibraryError("EMAIL_TEMPLATE_NOT_FOUND", 404);
    const [last] = await tx.select({ version: emailTemplateVersionsTable.version }).from(emailTemplateVersionsTable).where(eq(emailTemplateVersionsTable.templateId, id))
      .orderBy(desc(emailTemplateVersionsTable.version)).limit(1);
    const [created] = await tx.insert(emailTemplateVersionsTable).values({ templateId: id, version: (last?.version ?? 0) + 1, status: "draft", ...fields, createdById: req.user!.id }).returning();
    return created;
  });
  logAudit(req.user!.id, "notification_email.version_created", "message_template", id, { versionId: version.id }, req.ip);
  res.status(201).json({ version });
}));

router.get("/notification-email/templates/:id/versions", handle(async (req, res) => {
  const id = positiveEmailId(req.params.id), cursor = req.query.cursor === undefined ? undefined : positiveEmailId(req.query.cursor);
  const [template] = await db.select({ channel: messageTemplatesTable.channel }).from(messageTemplatesTable).where(eq(messageTemplatesTable.id, id)).limit(1);
  if (!template || !["email", "all"].includes(template.channel)) throw new EmailLibraryError("EMAIL_TEMPLATE_NOT_FOUND", 404);
  const rows = await db.select().from(emailTemplateVersionsTable).where(and(eq(emailTemplateVersionsTable.templateId, id), cursor ? lt(emailTemplateVersionsTable.id, cursor) : undefined))
    .orderBy(desc(emailTemplateVersionsTable.id)).limit(101);
  res.json({ versions: rows.slice(0, 100), nextCursor: rows.length > 100 ? rows[99].id : null });
}));

router.get("/notification-email/versions/:id", handle(async (req, res) => {
  const [row] = await db.select({ version: emailTemplateVersionsTable, template: { id: messageTemplatesTable.id, name: messageTemplatesTable.name,
    category: messageTemplatesTable.category, channel: messageTemplatesTable.channel, isActive: messageTemplatesTable.isActive, language: messageTemplatesTable.language } })
    .from(emailTemplateVersionsTable).innerJoin(messageTemplatesTable, eq(messageTemplatesTable.id, emailTemplateVersionsTable.templateId))
    .where(and(eq(emailTemplateVersionsTable.id, positiveEmailId(req.params.id)), inArray(messageTemplatesTable.channel, ["email", "all"]))).limit(1);
  if (!row) throw new EmailLibraryError("EMAIL_VERSION_NOT_FOUND", 404);
  res.json(row);
}));

for (const [action, target] of [["submit", "review"], ["approve", "approved"], ["retire", "retired"]] as const) {
  router.post(`/notification-email/versions/:id/${action}`, handle(async (req, res) => {
    const id = positiveEmailId(req.params.id);
    const version = await db.transaction(async tx => {
      const [old] = await tx.select().from(emailTemplateVersionsTable).where(eq(emailTemplateVersionsTable.id, id)).for("update");
      if (!old) throw new EmailLibraryError("EMAIL_VERSION_NOT_FOUND", 404);
      if (!canTransitionEmailVersion(old.status, target, old.createdById, req.user!.id)) throw new EmailLibraryError(
        target === "approved" && old.createdById === req.user!.id ? "EMAIL_SECOND_REVIEWER_REQUIRED" : "EMAIL_VERSION_TRANSITION_INVALID", 409);
      const [updated] = await tx.update(emailTemplateVersionsTable).set({ status: target,
        ...(target === "approved" ? { approvedById: req.user!.id, approvedAt: new Date() } : {}) }).where(eq(emailTemplateVersionsTable.id, id)).returning();
      return updated;
    });
    logAudit(req.user!.id, `notification_email.version_${action}`, "message_template", version.templateId, { versionId: id }, req.ip);
    res.json({ version });
  }));
}

router.post("/notification-email/versions/:id/preview", handle(async (req, res) => {
  const id = positiveEmailId(req.params.id);
  const [version] = await db.select().from(emailTemplateVersionsTable).where(eq(emailTemplateVersionsTable.id, id)).limit(1);
  if (!version) throw new EmailLibraryError("EMAIL_VERSION_NOT_FOUND", 404);
  res.json(await renderEmailVersion(version, req.body?.variables));
}));

router.get("/notification-email/history", handle(async (req, res) => {
  const cursor = req.query.cursor === undefined ? undefined : positiveEmailId(req.query.cursor);
  const source = req.query.source ?? "stage";
  const safeCode = (value: string | null) => value && /^[A-Z0-9_:-]{1,80}$/i.test(value) ? value : value ? "EMAIL_ERROR_REDACTED" : null;
  if (source !== "stage" && source !== "system") throw new EmailLibraryError("EMAIL_HISTORY_SOURCE_INVALID");
  if (source === "system") {
    const rows = await db.select({ id: emailQueueTable.id, templateVersionId: emailQueueTable.templateVersionId,
      senderAccountId: emailQueueTable.senderAccountId, senderRevision: emailQueueTable.senderRevision,
      status: emailQueueTable.status, queueStatus: emailQueueTable.status, createdAt: emailQueueTable.createdAt,
      sentAt: emailQueueTable.sentAt, retryCount: emailQueueTable.retryCount, errorCode: emailQueueTable.deliveryErrorCode }).from(emailQueueTable)
      .where(and(isNotNull(emailQueueTable.templateVersionId), cursor ? lt(emailQueueTable.id, cursor) : undefined,
        sql`NOT EXISTS (SELECT 1 FROM pipeline_stage_email_dispatches d WHERE d.email_queue_id = ${emailQueueTable.id})`))
      .orderBy(desc(emailQueueTable.id)).limit(101);
    res.json({ items: rows.slice(0, 100).map(row => ({ ...row, kind: "system", errorCode: safeCode(row.errorCode) })), nextCursor: rows.length > 100 ? rows[99].id : null });
    return;
  }
  const rows = await db.select({ id: stageEmailDispatchesTable.id, applicationId: stageEmailDispatchesTable.applicationId,
    stageKey: stageEmailDispatchesTable.stageKey, templateVersionId: stageEmailDispatchesTable.templateVersionId,
    senderAccountId: stageEmailDispatchesTable.senderAccountId, senderRevision: stageEmailDispatchesTable.senderRevision,
    origin: stageEmailDispatchesTable.origin, status: stageEmailDispatchesTable.status, emailQueueId: stageEmailDispatchesTable.emailQueueId,
    errorCode: stageEmailDispatchesTable.errorCode, createdAt: stageEmailDispatchesTable.createdAt, updatedAt: stageEmailDispatchesTable.updatedAt,
    queueStatus: emailQueueTable.status, sentAt: emailQueueTable.sentAt, retryCount: emailQueueTable.retryCount,
    deliveryErrorCode: emailQueueTable.deliveryErrorCode }).from(stageEmailDispatchesTable)
    .leftJoin(emailQueueTable, eq(emailQueueTable.id, stageEmailDispatchesTable.emailQueueId))
    .where(cursor ? lt(stageEmailDispatchesTable.id, cursor) : undefined).orderBy(desc(stageEmailDispatchesTable.id)).limit(101);
  res.json({ items: rows.slice(0, 100).map(row => ({ ...row, kind: "stage", errorCode: safeCode(row.errorCode), deliveryErrorCode: safeCode(row.deliveryErrorCode) })),
    nextCursor: rows.length > 100 ? rows[99].id : null });
}));

export default router;
