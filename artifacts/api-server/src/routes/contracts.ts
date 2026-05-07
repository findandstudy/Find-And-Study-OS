import { Router, type IRouter } from "express";
import { db, contractTemplatesTable, signingSessionsTable, signedContractsTable, agentsTable } from "@workspace/db";
import { and, desc, eq, isNull } from "drizzle-orm";
import { requireAuth, requirePermission } from "../lib/auth";
import { writeAudit } from "../lib/auditLog";
import { createSigningToken } from "../lib/signingTokens";
import { buildContractSignRequestEmail, sendEmail, getAppBaseUrl } from "../lib/email";

const router: IRouter = Router();

const DEFAULT_EXPIRY_DAYS = 14;

async function pickTemplate(language: string, entityType: string) {
  // Prefer exact match, latest version. Fall back to active EN+company.
  const exact = await db.select().from(contractTemplatesTable)
    .where(and(
      isNull(contractTemplatesTable.deletedAt),
      eq(contractTemplatesTable.isActive, true),
      eq(contractTemplatesTable.language, language),
      eq(contractTemplatesTable.entityType, entityType),
    ))
    .orderBy(desc(contractTemplatesTable.version))
    .limit(1);
  if (exact[0]) return exact[0];
  const fallbackLang = await db.select().from(contractTemplatesTable)
    .where(and(
      isNull(contractTemplatesTable.deletedAt),
      eq(contractTemplatesTable.isActive, true),
      eq(contractTemplatesTable.entityType, entityType),
    ))
    .orderBy(desc(contractTemplatesTable.version))
    .limit(1);
  return fallbackLang[0] || null;
}

router.get("/contracts/sessions", requireAuth, requirePermission("contracts.view", "self_fill_links.view"), async (req, res): Promise<void> => {
  try {
    const mode = (req.query.mode as string) || null;
    const where = mode === "self_fill" || mode === "admin_driven"
      ? eq(signingSessionsTable.mode, mode)
      : undefined;
    const rows = await db.select({
      id: signingSessionsTable.id,
      templateId: signingSessionsTable.templateId,
      agentId: signingSessionsTable.agentId,
      mode: signingSessionsTable.mode,
      status: signingSessionsTable.status,
      signerEmail: signingSessionsTable.signerEmail,
      signerName: signingSessionsTable.signerName,
      expiresAt: signingSessionsTable.expiresAt,
      openedAt: signingSessionsTable.openedAt,
      signedAt: signingSessionsTable.signedAt,
      revokedAt: signingSessionsTable.revokedAt,
      createdAt: signingSessionsTable.createdAt,
    }).from(signingSessionsTable)
      .where(where)
      .orderBy(desc(signingSessionsTable.createdAt))
      .limit(500);
    res.json({ data: rows });
  } catch (err) {
    console.error("[contracts] sessions list:", err);
    res.status(500).json({ error: "Failed to list signing sessions" });
  }
});

router.get("/contracts/signed", requireAuth, requirePermission("contracts.view"), async (_req, res): Promise<void> => {
  try {
    const rows = await db.select().from(signedContractsTable)
      .orderBy(desc(signedContractsTable.signedAt))
      .limit(500);
    res.json({ data: rows });
  } catch (err) {
    console.error("[contracts] signed list:", err);
    res.status(500).json({ error: "Failed to list signed contracts" });
  }
});

router.post("/contracts/admin-send", requireAuth, requirePermission("contracts.manage"), async (req, res): Promise<void> => {
  try {
    const { agentId, language: requestedLang, expiryDays } = req.body || {};
    const aId = parseInt(String(agentId), 10);
    if (!aId) { res.status(400).json({ error: "agentId is required" }); return; }
    const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, aId));
    if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }
    if (!agent.email) { res.status(400).json({ error: "Agent has no email on file" }); return; }
    const lang = (requestedLang && typeof requestedLang === "string") ? requestedLang : (agent.preferredContractLanguage || "en");
    const entityType = agent.entityType === "individual" ? "individual" : "company";
    const tpl = await pickTemplate(lang, entityType);
    if (!tpl) { res.status(404).json({ error: `No active template found for language=${lang}, entityType=${entityType}` }); return; }

    const { rawToken, tokenHash } = createSigningToken();
    const days = Number.isInteger(expiryDays) && expiryDays > 0 && expiryDays <= 90 ? expiryDays : DEFAULT_EXPIRY_DAYS;
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    const signerName = `${agent.firstName || ""} ${agent.lastName || ""}`.trim() || agent.businessName || null;

    const [session] = await db.insert(signingSessionsTable).values({
      templateId: tpl.id,
      agentId: aId,
      tokenHash,
      mode: "admin_driven",
      status: "review_pending",
      intakeData: null,
      signerEmail: agent.email,
      signerName,
      expiresAt,
      createdByUserId: (req as any).user?.id ?? null,
    }).returning();

    const signUrl = `${getAppBaseUrl()}/sign/${rawToken}`;
    try {
      const email = await buildContractSignRequestEmail({
        signerName,
        agentName: agent.businessName || null,
        templateName: tpl.name,
        signUrl,
        expiresAt,
        selfFill: false,
      });
      await sendEmail(agent.email, email);
    } catch (err) {
      console.error("[contracts] failed to send sign request email:", err);
    }

    await writeAudit({
      userId: (req as any).user?.id ?? null,
      action: "contract.sign_link_sent",
      resource: "signing_session",
      resourceId: session.id,
      changes: { mode: "admin_driven", agentId: aId, templateId: tpl.id, expiresAt: expiresAt.toISOString() },
      ipAddress: req.ip,
    });

    res.status(201).json({ data: { sessionId: session.id, signUrl, templateId: tpl.id, expiresAt } });
  } catch (err) {
    console.error("[contracts] admin-send:", err);
    res.status(500).json({ error: "Failed to create signing session" });
  }
});

router.post("/contracts/self-fill-link", requireAuth, requirePermission("self_fill_links.manage"), async (req, res): Promise<void> => {
  try {
    const { signerEmail, signerName, language, entityType, expiryDays } = req.body || {};
    if (!signerEmail || typeof signerEmail !== "string") { res.status(400).json({ error: "signerEmail is required" }); return; }
    const lang = (language && typeof language === "string") ? language : "en";
    const ent = entityType === "individual" ? "individual" : "company";
    const tpl = await pickTemplate(lang, ent);
    if (!tpl) { res.status(404).json({ error: `No active template found for language=${lang}, entityType=${ent}` }); return; }

    const { rawToken, tokenHash } = createSigningToken();
    const days = Number.isInteger(expiryDays) && expiryDays > 0 && expiryDays <= 90 ? expiryDays : DEFAULT_EXPIRY_DAYS;
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    const [session] = await db.insert(signingSessionsTable).values({
      templateId: tpl.id,
      agentId: null,
      tokenHash,
      mode: "self_fill",
      status: "intake_pending",
      intakeData: null,
      signerEmail: String(signerEmail).toLowerCase().trim(),
      signerName: signerName ? String(signerName).slice(0, 200) : null,
      expiresAt,
      createdByUserId: (req as any).user?.id ?? null,
    }).returning();

    const signUrl = `${getAppBaseUrl()}/sign/${rawToken}`;
    try {
      const email = await buildContractSignRequestEmail({
        signerName: signerName || null,
        agentName: null,
        templateName: tpl.name,
        signUrl,
        expiresAt,
        selfFill: true,
      });
      await sendEmail(session.signerEmail, email);
    } catch (err) {
      console.error("[contracts] failed to send self-fill email:", err);
    }

    await writeAudit({
      userId: (req as any).user?.id ?? null,
      action: "contract.self_fill_link_sent",
      resource: "signing_session",
      resourceId: session.id,
      changes: { mode: "self_fill", templateId: tpl.id, expiresAt: expiresAt.toISOString() },
      ipAddress: req.ip,
    });

    res.status(201).json({ data: { sessionId: session.id, signUrl, templateId: tpl.id, expiresAt } });
  } catch (err) {
    console.error("[contracts] self-fill-link:", err);
    res.status(500).json({ error: "Failed to create self-fill link" });
  }
});

router.post("/contracts/sessions/:id/revoke", requireAuth, requirePermission("contracts.manage"), async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
    const [row] = await db.update(signingSessionsTable)
      .set({ status: "revoked", revokedAt: new Date() })
      .where(eq(signingSessionsTable.id, id))
      .returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    await writeAudit({
      userId: (req as any).user?.id ?? null,
      action: "contract.session_revoked",
      resource: "signing_session",
      resourceId: id,
      ipAddress: req.ip,
    });
    res.json({ success: true });
  } catch (err) {
    console.error("[contracts] revoke:", err);
    res.status(500).json({ error: "Failed to revoke session" });
  }
});

router.post("/contracts/sessions/:id/resend", requireAuth, requirePermission("contracts.manage"), async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
    const [session] = await db.select().from(signingSessionsTable).where(eq(signingSessionsTable.id, id));
    if (!session) { res.status(404).json({ error: "Not found" }); return; }
    if (session.status === "signed" || session.status === "revoked") {
      res.status(409).json({ error: "Cannot resend a signed or revoked session" }); return;
    }
    // Issue a new token and reset expiry.
    const { rawToken, tokenHash } = createSigningToken();
    const expiresAt = new Date(Date.now() + DEFAULT_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
    await db.update(signingSessionsTable)
      .set({ tokenHash, expiresAt })
      .where(eq(signingSessionsTable.id, id));
    const [tpl] = await db.select().from(contractTemplatesTable).where(eq(contractTemplatesTable.id, session.templateId));
    const signUrl = `${getAppBaseUrl()}/sign/${rawToken}`;
    if (tpl) {
      try {
        const email = await buildContractSignRequestEmail({
          signerName: session.signerName,
          agentName: null,
          templateName: tpl.name,
          signUrl,
          expiresAt,
          selfFill: session.mode === "self_fill",
        });
        await sendEmail(session.signerEmail, email);
      } catch (err) {
        console.error("[contracts] failed to resend email:", err);
      }
    }
    await writeAudit({
      userId: (req as any).user?.id ?? null,
      action: "contract.session_resent",
      resource: "signing_session",
      resourceId: id,
      ipAddress: req.ip,
    });
    res.json({ data: { signUrl, expiresAt } });
  } catch (err) {
    console.error("[contracts] resend:", err);
    res.status(500).json({ error: "Failed to resend session" });
  }
});

export default router;
