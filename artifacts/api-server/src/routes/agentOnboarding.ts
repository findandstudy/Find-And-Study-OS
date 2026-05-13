import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { getClientIp } from "../lib/clientIp";
import crypto from "crypto";
import { db, agentsTable, usersTable, signingSessionsTable, signedContractsTable, contractTemplatesTable, settingsTable, emailVerificationCodesTable } from "@workspace/db";
import { and, eq, gt, desc } from "drizzle-orm";
import { requireAuth, requireRole } from "../lib/auth";
import { MANAGER_ROLES } from "../lib/roles";
import { writeAudit } from "../lib/auditLog";
import { sendEmail, buildContractSignRequestEmail, getAppBaseUrl } from "../lib/email";
import { createSigningToken } from "../lib/signingTokens";
import { finalizeSign } from "../lib/signContract";
import { RateLimiterPostgres } from "rate-limiter-flexible";
import { pool } from "@workspace/db";

const router: IRouter = Router();

const AGENT_ROLES = ["agent", "sub_agent", "agent_staff"];

const rateLimiter = new RateLimiterPostgres({
  storeClient: pool,
  storeType: "pool",
  tableName: "rate_limits",
  points: 5,
  duration: 900,
});

function generateVerificationCode(): string {
  return crypto.randomInt(100000, 999999).toString();
}

function buildOnboardingVerificationCodeEmail(firstName: string, code: string): { subject: string; html: string; text: string } {
  const subject = "Welcome ��� Verify Your Email / Ho�� geldiniz ��� E-posta Do��rulama";
  const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);">
    <div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:32px;text-align:center;">
      <h1 style="margin:0;color:#fff;font-size:24px;">Find And Study OS</h1>
      <p style="margin:8px 0 0;color:rgba(255,255,255,.85);font-size:14px;">Agent Onboarding �� Acente Kay��t</p>
    </div>
    <div style="padding:32px;">
      <h2 style="margin:0 0 16px;color:#111827;font-size:20px;">Verify your email / E-postan��z�� do��rulay��n</h2>
      <p style="margin:0 0 24px;color:#374151;font-size:15px;line-height:1.6;">
        Hi ${firstName}, your agent account has been created. Use the code below to verify your email. After verifying you must sign your agency contract before accessing the dashboard. This code expires in 15 minutes.
      </p>
      <div style="text-align:center;margin:0 0 24px;">
        <div style="display:inline-block;background:#f0f0ff;border:2px solid #6366f1;border-radius:12px;padding:16px 32px;letter-spacing:8px;font-size:32px;font-weight:700;color:#6366f1;">${code}</div>
      </div>
      <p style="margin:0 0 8px;color:#6b7280;font-size:13px;text-align:center;">If you did not expect this email, you can ignore it.</p>
    </div>
  </div></body></html>`;
  const text = `Hi ${firstName},\n\nYour agent account has been created. Verification code: ${code}\nExpires in 15 minutes.\nAfter verifying you must sign your contract before accessing the dashboard.`;
  return { subject, html, text };
}

async function loadAgentForUser(userId: number, userRole: string) {
  if (userRole === "agent_staff") {
    const [staffUser] = await db.select({ managingAgentId: usersTable.managingAgentId }).from(usersTable).where(eq(usersTable.id, userId));
    if (!staffUser?.managingAgentId) return null;
    const [a] = await db.select().from(agentsTable).where(eq(agentsTable.id, staffUser.managingAgentId));
    return a || null;
  }
  const [a] = await db.select().from(agentsTable).where(eq(agentsTable.userId, userId));
  return a || null;
}

async function loadOnboardingSession(agentId: number) {
  const [s] = await db.select().from(signingSessionsTable)
    .where(and(eq(signingSessionsTable.agentId, agentId), eq(signingSessionsTable.isPrimaryOnboarding, true)))
    .orderBy(desc(signingSessionsTable.createdAt))
    .limit(1);
  return s || null;
}

async function lazyExpire(session: typeof signingSessionsTable.$inferSelect) {
  if (!session) return session;
  const isPastDue = new Date(session.expiresAt).getTime() < Date.now();
  if (isPastDue && (session.status === "intake_pending" || session.status === "review_pending")) {
    try {
      await db.update(signingSessionsTable).set({ status: "expired" }).where(and(
        eq(signingSessionsTable.id, session.id),
        eq(signingSessionsTable.status, session.status),
      ));
      return { ...session, status: "expired" as const };
    } catch {}
  }
  return session;
}

/**
 * GET /api/agents/me/onboarding-status
 * Returns the gate state for the current agent: emailVerified flag plus
 * a snapshot of their primary onboarding signing session (if any).
 */
router.get("/agents/me/onboarding-status", requireAuth, async (req: Request, res: Response): Promise<void> => {
  if (!AGENT_ROLES.includes(req.user!.role)) {
    res.json({ requiresOnboarding: false, emailVerified: true, contractStatus: "n/a" });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.id));
  const agent = await loadAgentForUser(req.user!.id, req.user!.role);
  if (!agent) {
    res.json({
      requiresOnboarding: !user?.emailVerified,
      emailVerified: !!user?.emailVerified,
      email: user?.email || null,
      contractStatus: "none",
    });
    return;
  }
  let session = await loadOnboardingSession(agent.id);
  if (session) session = await lazyExpire(session);
  let contractStatus: "none" | "pending" | "signed" | "expired" | "revoked" = "none";
  if (session) {
    if (session.status === "signed") contractStatus = "signed";
    else if (session.status === "expired") contractStatus = "expired";
    else if (session.status === "revoked") contractStatus = "revoked";
    else contractStatus = "pending";
  }
  res.json({
    requiresOnboarding: !user?.emailVerified || (contractStatus !== "signed" && contractStatus !== "none"),
    emailVerified: !!user?.emailVerified,
    email: user?.email || null,
    contractStatus,
    sessionId: session?.id ?? null,
    expiresAt: session?.expiresAt ?? null,
    templateId: session?.templateId ?? null,
    isPrimaryOnboarding: !!session?.isPrimaryOnboarding,
  });
});

/**
 * POST /api/agents/me/resend-verification ��� generates a new 6-digit code,
 * invalidates older codes, emails the agent.
 */
router.post("/agents/me/resend-verification", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const ip = getClientIp(req);
  try {
    await rateLimiter.consume(`agent-resend:${ip}`);
    await rateLimiter.consume(`agent-resend:${req.user!.id}`);
  } catch {
    res.status(429).json({ error: "Too many attempts. Please wait before requesting again." });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.id));
  if (!user || !user.email) { res.status(404).json({ error: "User not found" }); return; }
  if (user.emailVerified) { res.status(400).json({ error: "Email already verified" }); return; }

  const normalizedEmail = user.email.toLowerCase().trim();
  await db.update(emailVerificationCodesTable)
    .set({ used: true })
    .where(and(eq(emailVerificationCodesTable.email, normalizedEmail), eq(emailVerificationCodesTable.used, false)));

  const code = generateVerificationCode();
  await db.insert(emailVerificationCodesTable).values({
    email: normalizedEmail, code, expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  });
  try {
    const email = buildOnboardingVerificationCodeEmail(user.firstName || "Agent", code);
    await sendEmail(normalizedEmail, email);
  } catch (err) {
    console.error("[agent-onboarding] resend code email failed:", err);
  }
  await writeAudit({
    userId: req.user!.id,
    action: "agent.email_verification_sent",
    resource: "user",
    resourceId: req.user!.id,
    changes: { resent: true },
    ipAddress: req.ip,
  });
  res.json({ success: true });
});

/**
 * POST /api/agents/me/verify-email ��� confirms the 6-digit code, flips
 * users.emailVerified=true, refreshes the session payload.
 */
router.post("/agents/me/verify-email", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { code } = req.body || {};
  if (!code || typeof code !== "string") { res.status(400).json({ error: "Code is required" }); return; }
  const ip = getClientIp(req);
  try {
    await rateLimiter.consume(`agent-verify:${ip}`);
    await rateLimiter.consume(`agent-verify:${req.user!.id}`);
  } catch {
    res.status(429).json({ error: "Too many attempts. Please request a new code." });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.id));
  if (!user?.email) { res.status(404).json({ error: "User not found" }); return; }
  if (user.emailVerified) { res.json({ success: true, alreadyVerified: true }); return; }
  const normalizedEmail = user.email.toLowerCase().trim();
  const [record] = await db.select().from(emailVerificationCodesTable).where(and(
    eq(emailVerificationCodesTable.email, normalizedEmail),
    eq(emailVerificationCodesTable.code, code.trim()),
    eq(emailVerificationCodesTable.used, false),
    gt(emailVerificationCodesTable.expiresAt, new Date()),
  ));
  if (!record) { res.status(400).json({ error: "Invalid or expired verification code" }); return; }
  await db.update(emailVerificationCodesTable).set({ used: true }).where(eq(emailVerificationCodesTable.email, normalizedEmail));
  await db.update(usersTable).set({ emailVerified: true, isActive: true }).where(eq(usersTable.id, user.id));
  // Refresh in-memory session user so the next request sees the flag.
  if (req.user) (req.user as any).emailVerified = true;
  await writeAudit({
    userId: user.id, action: "agent.email_verified", resource: "user", resourceId: user.id, ipAddress: req.ip,
  });
  res.json({ success: true });
});

/**
 * GET /api/contracts/me ��� primary onboarding session info plus rendered
 * preview HTML for the review step. Returns the signed PDF link if signed.
 */
router.get("/contracts/me", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const agent = await loadAgentForUser(req.user!.id, req.user!.role);
  if (!agent) { res.status(404).json({ error: "Agent profile not found" }); return; }
  let session = await loadOnboardingSession(agent.id);
  if (!session) { res.json({ data: null }); return; }
  session = await lazyExpire(session);
  const [template] = await db.select().from(contractTemplatesTable).where(eq(contractTemplatesTable.id, session.templateId));
  let signedContract: typeof signedContractsTable.$inferSelect | null = null;
  if (session.status === "signed") {
    const [s] = await db.select().from(signedContractsTable).where(eq(signedContractsTable.signingSessionId, session.id));
    signedContract = s || null;
  }
  let previewHtml: string | null = null;
  if (template && (session.status === "review_pending" || session.status === "intake_pending")) {
    try {
      const { renderTemplate, buildAgentContext } = await import("../lib/contractRenderer");
      const ctx = buildAgentContext(agent, (session.intakeData as any) || null, {
        signerEmail: session.signerEmail, signerName: session.signerName || undefined,
      });
      previewHtml = renderTemplate(template.bodyHtml, ctx);
    } catch (err) {
      console.error("[contracts/me] preview render failed:", err);
    }
  }
  res.json({
    data: {
      sessionId: session.id,
      status: session.status,
      expiresAt: session.expiresAt,
      isPrimaryOnboarding: session.isPrimaryOnboarding,
      signerEmail: session.signerEmail,
      signerName: session.signerName,
      template: template ? { id: template.id, name: template.name, language: template.language, entityType: template.entityType } : null,
      previewHtml,
      signedPdfUrl: signedContract ? `/api/contracts/signed/${signedContract.id}/pdf` : null,
      signedAt: signedContract?.signedAt ?? null,
    },
  });
});

/**
 * POST /api/contracts/me/sign ��� agent draws their signature in the dashboard
 * and finalizes the primary onboarding session (no token).
 */
router.post("/contracts/me/sign", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const agent = await loadAgentForUser(req.user!.id, req.user!.role);
  if (!agent) { res.status(404).json({ error: "Agent profile not found" }); return; }
  const session = await loadOnboardingSession(agent.id);
  if (!session) { res.status(404).json({ error: "No onboarding session found" }); return; }

  const { signatureImagePngBase64, signerName } = req.body || {};
  if (!signatureImagePngBase64 || typeof signatureImagePngBase64 !== "string") {
    res.status(400).json({ error: "signatureImagePngBase64 is required" }); return;
  }
  if (signatureImagePngBase64.length > 2_000_000) {
    res.status(413).json({ error: "Signature image too large" }); return;
  }
  const signerIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || null;
  const ua = (req.headers["user-agent"] as string) || null;

  const result = await finalizeSign({
    sessionId: session.id,
    signatureImagePngBase64,
    signerName: signerName ? String(signerName) : (session.signerName || null),
    signerIp,
    signerUserAgent: ua,
    triggerUserId: req.user!.id,
  });
  if (!result.ok) { res.status(result.status).json({ error: result.error }); return; }
  res.json({ data: { signedContractId: result.signedContractId } });
});

/**
 * POST /api/contracts/agent/:agentId/resend-onboarding ��� admin reissues a
 * primary onboarding session for an agent whose previous session expired or
 * was revoked. Reuses the originally assigned template if any.
 */
router.post("/contracts/agent/:agentId/resend-onboarding", requireAuth, requireRole(...MANAGER_ROLES), async (req: Request, res: Response): Promise<void> => {
  const agentId = parseInt(req.params.agentId, 10);
  if (!agentId) { res.status(400).json({ error: "Invalid agent id" }); return; }
  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, agentId));
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }
  if (!agent.email) { res.status(400).json({ error: "Agent has no email on file" }); return; }

  // Pick template: explicit body, then agent's assignment, then strict (lang, entityType).
  let templateId: number | null = req.body?.templateId ? parseInt(req.body.templateId, 10) : null;
  if (!templateId && agent.assignedContractTemplateId) templateId = agent.assignedContractTemplateId;
  let template: typeof contractTemplatesTable.$inferSelect | undefined;
  if (templateId) {
    [template] = await db.select().from(contractTemplatesTable).where(eq(contractTemplatesTable.id, templateId));
  }
  if (!template) {
    const lang = agent.preferredContractLanguage || "en";
    const entityType = agent.entityType === "individual" ? "individual" : "company";
    [template] = await db.select().from(contractTemplatesTable)
      .where(and(eq(contractTemplatesTable.language, lang), eq(contractTemplatesTable.entityType, entityType), eq(contractTemplatesTable.isActive, true)))
      .orderBy(desc(contractTemplatesTable.version)).limit(1);
  }
  if (!template) { res.status(404).json({ error: "No matching contract template found" }); return; }

  const [settings] = await db.select({ days: settingsTable.defaultSigningDeadlineDays }).from(settingsTable);
  const days = Math.max(1, Math.min(365, settings?.days || 14));
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

  const { rawToken, tokenHash } = createSigningToken();
  const signerName = `${agent.firstName || ""} ${agent.lastName || ""}`.trim() || agent.businessName || null;
  const [session] = await db.insert(signingSessionsTable).values({
    templateId: template.id,
    agentId: agent.id,
    tokenHash,
    mode: "admin_driven",
    status: "review_pending",
    intakeData: null,
    signerEmail: agent.email,
    signerName,
    expiresAt,
    isPrimaryOnboarding: true,
    createdByUserId: req.user!.id,
  }).returning();

  // Persist the assigned template id on the agent for future re-issues.
  if (agent.assignedContractTemplateId !== template.id) {
    await db.update(agentsTable).set({ assignedContractTemplateId: template.id }).where(eq(agentsTable.id, agent.id));
  }

  const baseUrl = getAppBaseUrl();
  try {
    const email = await buildContractSignRequestEmail({
      signerName,
      agentName: agent.businessName || null,
      templateName: template.name,
      signUrl: `${baseUrl}/agent`,
      expiresAt,
      selfFill: false,
    });
    await sendEmail(agent.email, email);
  } catch (err) {
    console.error("[agent-onboarding] resend email failed:", err);
  }
  await writeAudit({
    userId: req.user!.id,
    action: "agent.contract_resent_after_expiry",
    resource: "signing_session",
    resourceId: session.id,
    changes: { agentId: agent.id, templateId: template.id, expiresAt: expiresAt.toISOString() },
    ipAddress: req.ip,
  });
  res.status(201).json({ data: { sessionId: session.id, expiresAt, signUrlIfNeeded: `${baseUrl}/sign/${rawToken}` } });
});

export default router;

// ������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������
// Helpers exported for the gate middleware in routes/index.ts and the agents
// POST handler that creates the initial verification code + signing session.
// ������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������

export const ONBOARDING_HELPERS = {
  generateVerificationCode,
  buildOnboardingVerificationCodeEmail,
  loadAgentForUser,
  loadOnboardingSession,
  lazyExpire,
};
