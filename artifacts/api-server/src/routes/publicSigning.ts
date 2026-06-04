import { Router, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import { db, contractTemplatesTable, signingSessionsTable, signedContractsTable, agentsTable, settingsTable, usersTable, emailVerificationCodesTable } from "@workspace/db";
import { and, eq, gt, inArray } from "drizzle-orm";
import crypto from "crypto";
import { hashToken } from "../lib/signingTokens";
import { renderTemplate, buildAgentContext, cleanupSignatureImages, SIG_PLACEHOLDER, toSignatureDataUrl } from "../lib/contractRenderer";

function contractNumber(sessionId: number, signedAt?: Date): string {
  const d = signedAt || new Date();
  const yy = String(d.getUTCFullYear()).slice(-2);
  return `FAS-${yy}-${String(sessionId).padStart(5, "0")}`;
}

function sanitizeFilenamePart(s: string): string {
  return (s || "")
    .replace(/[\\/:*?"<>|\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

async function buildContractFilename(params: { agent: any | null; signedAt: Date }): Promise<string> {
  let brand = "Find And Study";
  try {
    const [s] = await db.select({
      publicBrandName: settingsTable.publicBrandName,
      legalCompanyName: settingsTable.legalCompanyName,
      companyName: settingsTable.companyName,
    }).from(settingsTable).limit(1);
    brand = sanitizeFilenamePart(s?.publicBrandName || s?.legalCompanyName || s?.companyName || brand) || brand;
  } catch {
    // fall through to default brand
  }
  const agentName = sanitizeFilenamePart(
    params.agent?.businessName || params.agent?.companyName || "Agent"
  ) || "Agent";
  const d = params.signedAt;
  const pad = (n: number) => String(n).padStart(2, "0");
  const ts = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
  return `${agentName} - ${brand} - ${ts}.pdf`;
}

import { buildSignedPdf } from "../lib/contractPdf";
import { ObjectStorageService } from "../lib/objectStorage";
import { writeAudit } from "../lib/auditLog";
import { buildSignedContractEmail, buildSignVerificationCodeEmail, buildSignedContractAdminEmail, sendEmail, getAppBaseUrl } from "../lib/email";
import { PgRateLimitStore } from "../lib/pgRateLimiter";

const router: IRouter = Router();

const SIGN_WINDOW_MS = 15 * 60 * 1000;
const signLimiter = rateLimit({
  windowMs: SIGN_WINDOW_MS,
  max: 30,
  message: { error: "Too many requests. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
  store: new PgRateLimitStore(SIGN_WINDOW_MS),
});

// Tighter limiter for sending verification codes: the signer types an
// arbitrary email and we send a code there, so cap it harder than the general
// signing limiter to avoid using the endpoint as a spam relay.
const codeLimiter = rateLimit({
  windowMs: SIGN_WINDOW_MS,
  max: 8,
  message: { error: "Too many requests. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
  store: new PgRateLimitStore(SIGN_WINDOW_MS),
});

function generateVerificationCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Roles that should receive a copy of every signed contract. "admin" accounts
// as shown in the system: super_admin + admin.
const SIGNED_CONTRACT_ADMIN_ROLES = ["super_admin", "admin"];

async function getAdminRecipientEmails(excludeEmail?: string | null): Promise<string[]> {
  const rows = await db.select({ email: usersTable.email })
    .from(usersTable)
    .where(and(inArray(usersTable.role, SIGNED_CONTRACT_ADMIN_ROLES), eq(usersTable.isActive, true)));
  const exclude = (excludeEmail || "").trim().toLowerCase();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of rows) {
    const email = (row.email || "").trim();
    if (!email || !EMAIL_RE.test(email)) continue;
    const key = email.toLowerCase();
    if (key === exclude || seen.has(key)) continue;
    seen.add(key);
    out.push(email);
  }
  return out;
}

const objectStorage = new ObjectStorageService();

interface ResolvedSession {
  session: typeof signingSessionsTable.$inferSelect;
  template: typeof contractTemplatesTable.$inferSelect;
  agent: typeof agentsTable.$inferSelect | null;
  expired: boolean;
}

async function resolveByToken(rawToken: string): Promise<ResolvedSession | { error: string; status: number; code?: string }> {
  if (!rawToken || typeof rawToken !== "string" || rawToken.length < 16 || rawToken.length > 200) {
    return { error: "Invalid token", status: 400 };
  }
  const tokenHash = hashToken(rawToken);
  let [session] = await db.select().from(signingSessionsTable).where(eq(signingSessionsTable.tokenHash, tokenHash));
  if (!session) return { error: "Signing link not found", status: 404 };
  if (session.status === "revoked") return { error: "This signing link has been revoked", status: 410, code: "revoked" };
  // Lazy expire: if past expiresAt and still in a non-terminal state, persist
  // status=expired so admin lists/badges/filters reflect reality without
  // waiting for the next sweep tick.
  const isPastDue = new Date(session.expiresAt).getTime() < Date.now();
  if (isPastDue && (session.status === "intake_pending" || session.status === "review_pending")) {
    try {
      await db.update(signingSessionsTable).set({ status: "expired" }).where(and(
        eq(signingSessionsTable.id, session.id),
        eq(signingSessionsTable.status, session.status),
      ));
      session = { ...session, status: "expired" };
    } catch (e) {
      console.error("[public-sign] lazy expire failed:", e);
    }
  }
  if (session.status === "expired") return { error: "This signing link has expired", status: 410, code: "expired" };
  const expired = isPastDue;
  const [template] = await db.select().from(contractTemplatesTable).where(eq(contractTemplatesTable.id, session.templateId));
  if (!template) return { error: "Template missing", status: 404 };
  let agent: typeof agentsTable.$inferSelect | null = null;
  if (session.agentId) {
    const [a] = await db.select().from(agentsTable).where(eq(agentsTable.id, session.agentId));
    agent = a || null;
  }
  return { session, template, agent, expired };
}

router.get("/public/sign/:token", signLimiter, async (req, res): Promise<void> => {
  try {
    const r = await resolveByToken(req.params.token);
    if ("error" in r) { res.status(r.status).json({ error: r.error, code: r.code }); return; }
    // Signed sessions are terminal — surface success even if past expiresAt
    // so the signer can re-open the page and see the success state / PDF link
    // rather than getting an "expired" message after they already signed.
    if (r.session.status !== "signed" && r.expired) {
      res.status(410).json({ error: "This signing link has expired.", code: "expired" });
      return;
    }
    if (!r.session.openedAt && r.session.status !== "signed") {
      try {
        await db.update(signingSessionsTable).set({ openedAt: new Date() }).where(eq(signingSessionsTable.id, r.session.id));
        await writeAudit({
          userId: r.session.createdByUserId ?? null,
          action: "contract.opened",
          resource: "signing_session",
          resourceId: r.session.id,
          changes: { signerEmail: r.session.signerEmail },
          ipAddress: req.ip,
        });
      } catch (auditErr) {
        console.error("[public-sign] failed to record open:", auditErr);
      }
    }
    res.json({
      data: {
        sessionId: r.session.id,
        mode: r.session.mode,
        status: r.session.status,
        signerEmail: r.session.signerEmail,
        verifiedEmail: r.session.verifiedEmail,
        signerName: r.session.signerName,
        expiresAt: r.session.expiresAt,
        expired: r.expired,
        template: {
          id: r.template.id,
          name: r.template.name,
          language: r.template.language,
          entityType: r.template.entityType,
          intakeSchema: r.template.intakeSchema || null,
        },
        agent: r.agent ? {
          id: r.agent.id,
          firstName: r.agent.firstName,
          lastName: r.agent.lastName,
          businessName: r.agent.businessName,
          email: r.agent.email,
          phone: r.agent.phone,
          country: r.agent.country,
          entityType: r.agent.entityType,
          taxNumber: r.agent.taxNumber,
        } : null,
        intakeData: r.session.intakeData || null,
      }
    });
  } catch (err) {
    console.error("[public-sign] get:", err);
    res.status(500).json({ error: "Failed to resolve signing link" });
  }
});

router.get("/public/sign/:token/preview", signLimiter, async (req, res): Promise<void> => {
  try {
    const r = await resolveByToken(req.params.token);
    if ("error" in r) { res.status(r.status).json({ error: r.error }); return; }
    if (r.expired) { res.status(410).json({ error: "Link expired" }); return; }
    const ctx = buildAgentContext(r.agent, (r.session.intakeData as any) || null, {
      signerEmail: r.session.signerEmail,
      signerName: r.session.signerName || undefined,
      number: contractNumber(r.session.id),
    });
    const rendered = renderTemplate(r.template.bodyHtml, ctx);
    const placeholder = SIG_PLACEHOLDER[r.template.language] || SIG_PLACEHOLDER.en;
    const html = cleanupSignatureImages(rendered, placeholder);
    res.json({ data: { html, templateName: r.template.name } });
  } catch (err) {
    console.error("[public-sign] preview:", err);
    res.status(500).json({ error: "Failed to render contract preview" });
  }
});

// Render an unsigned PDF preview so signers can review the document before
// drawing their signature. Same content as /preview but as a downloadable PDF.
router.get("/public/sign/:token/preview-pdf", signLimiter, async (req, res): Promise<void> => {
  try {
    const r = await resolveByToken(req.params.token);
    if ("error" in r) { res.status(r.status).json({ error: r.error }); return; }
    if (r.expired) { res.status(410).json({ error: "Link expired" }); return; }
    const ctx = buildAgentContext(r.agent, (r.session.intakeData as any) || null, {
      signerEmail: r.session.signerEmail,
      signerName: r.session.signerName || undefined,
      number: contractNumber(r.session.id),
    });
    const rendered = renderTemplate(r.template.bodyHtml, ctx);
    const placeholder = SIG_PLACEHOLDER[r.template.language] || SIG_PLACEHOLDER.en;
    const html = cleanupSignatureImages(rendered, placeholder);
    const { buildSignedPdf } = await import("../lib/contractPdf");
    const { pdfBytes } = await buildSignedPdf({
      templateName: r.template.name,
      bodyHtml: html,
      signerEmail: r.session.signerEmail,
      signerName: r.session.signerName,
      signerIp: req.ip,
      signerUserAgent: req.headers["user-agent"] || null,
      signedAt: new Date(),
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="contract-preview.pdf"`);
    res.end(Buffer.from(pdfBytes));
  } catch (err) {
    console.error("[public-sign] preview-pdf:", err);
    if (!res.headersSent) res.status(500).json({ error: "Failed to render preview PDF" });
  }
});

// Send a 6-digit verification code to the email the signer entered. The signer
// must verify ownership of this email before they are allowed to sign.
router.post("/public/sign/:token/send-code", codeLimiter, async (req, res): Promise<void> => {
  try {
    const r = await resolveByToken(req.params.token);
    if ("error" in r) { res.status(r.status).json({ error: r.error, code: r.code }); return; }
    if (r.expired) { res.status(410).json({ error: "Link expired" }); return; }
    if (r.session.status === "signed" || r.session.status === "revoked") {
      res.status(409).json({ error: "Session already finalized" }); return;
    }
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
      res.status(400).json({ error: "A valid email is required" }); return;
    }
    // Bind the code to this specific signing link by storing the same token
    // hash used for the session, so a code issued for one link cannot be
    // replayed against another link/flow for the same email.
    const tokenHash = hashToken(req.params.token);
    // Invalidate previous unused codes for this email+link so only the newest works.
    await db.update(emailVerificationCodesTable)
      .set({ used: true })
      .where(and(
        eq(emailVerificationCodesTable.email, email),
        eq(emailVerificationCodesTable.token, tokenHash),
        eq(emailVerificationCodesTable.used, false),
      ));
    const code = generateVerificationCode();
    await db.insert(emailVerificationCodesTable).values({
      email, code, token: tokenHash, expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });
    try {
      const mail = await buildSignVerificationCodeEmail({
        code,
        templateName: r.template.name,
        language: r.template.language,
      });
      await sendEmail(email, mail);
    } catch (mailErr) {
      console.error("[public-sign] failed to send verification code:", mailErr);
    }
    res.json({ success: true });
  } catch (err) {
    console.error("[public-sign] send-code:", err);
    res.status(500).json({ error: "Failed to send verification code" });
  }
});

// Verify the 6-digit code. On success, persist the verified email on the
// session and adopt it as the signer's email (the signer supplies their own).
router.post("/public/sign/:token/verify-code", codeLimiter, async (req, res): Promise<void> => {
  try {
    const r = await resolveByToken(req.params.token);
    if ("error" in r) { res.status(r.status).json({ error: r.error, code: r.code }); return; }
    if (r.expired) { res.status(410).json({ error: "Link expired" }); return; }
    if (r.session.status === "signed" || r.session.status === "revoked") {
      res.status(409).json({ error: "Session already finalized" }); return;
    }
    const email = String(req.body?.email || "").trim().toLowerCase();
    const code = String(req.body?.code || "").trim();
    if (!email || !EMAIL_RE.test(email) || !/^\d{6}$/.test(code)) {
      res.status(400).json({ error: "Email and 6-digit code are required" }); return;
    }
    // The code must have been issued for THIS signing link (token hash bound).
    const tokenHash = hashToken(req.params.token);
    const [record] = await db.select().from(emailVerificationCodesTable).where(and(
      eq(emailVerificationCodesTable.email, email),
      eq(emailVerificationCodesTable.code, code),
      eq(emailVerificationCodesTable.token, tokenHash),
      eq(emailVerificationCodesTable.used, false),
      gt(emailVerificationCodesTable.expiresAt, new Date()),
    ));
    if (!record) {
      res.status(400).json({ error: "Invalid or expired code", code: "invalid_code" }); return;
    }
    await db.update(emailVerificationCodesTable).set({ used: true })
      .where(eq(emailVerificationCodesTable.id, record.id));
    await db.update(signingSessionsTable).set({
      verifiedEmail: email,
      signerEmail: email,
    }).where(eq(signingSessionsTable.id, r.session.id));
    res.json({ success: true, verifiedEmail: email });
  } catch (err) {
    console.error("[public-sign] verify-code:", err);
    res.status(500).json({ error: "Failed to verify code" });
  }
});

router.post("/public/sign/:token/intake", signLimiter, async (req, res): Promise<void> => {
  try {
    const r = await resolveByToken(req.params.token);
    if ("error" in r) { res.status(r.status).json({ error: r.error }); return; }
    if (r.expired) { res.status(410).json({ error: "Link expired" }); return; }
    if (r.session.mode !== "self_fill") { res.status(400).json({ error: "Intake only allowed for self-fill links" }); return; }
    if (r.session.status === "signed" || r.session.status === "revoked") {
      res.status(409).json({ error: "Session already finalized" }); return;
    }
    const intakeRaw = req.body?.intake;
    if (!intakeRaw || typeof intakeRaw !== "object" || Array.isArray(intakeRaw)) {
      res.status(400).json({ error: "intake object is required" }); return;
    }
    // Cap field count and value length to prevent abuse.
    const cleaned: Record<string, string> = {};
    let count = 0;
    for (const [k, v] of Object.entries(intakeRaw)) {
      if (count >= 50) break;
      const key = String(k).slice(0, 80);
      const val = v == null ? "" : String(v).slice(0, 2000);
      cleaned[key] = val;
      count++;
    }
    await db.update(signingSessionsTable).set({
      intakeData: cleaned,
      status: "review_pending",
      signerName: cleaned.signerName || cleaned.fullName || r.session.signerName,
    }).where(eq(signingSessionsTable.id, r.session.id));
    res.json({ success: true });
  } catch (err) {
    console.error("[public-sign] intake:", err);
    res.status(500).json({ error: "Failed to save intake" });
  }
});

router.post("/public/sign/:token/sign", signLimiter, async (req, res): Promise<void> => {
  try {
    const rawTokenForLink = req.params.token;
    const r = await resolveByToken(req.params.token);
    if ("error" in r) { res.status(r.status).json({ error: r.error }); return; }
    if (r.expired) { res.status(410).json({ error: "Link expired" }); return; }
    if (r.session.status === "signed") { res.status(409).json({ error: "Already signed" }); return; }
    if (r.session.status === "revoked") { res.status(410).json({ error: "Link revoked" }); return; }
    if (r.session.mode === "self_fill" && !r.session.intakeData) {
      res.status(400).json({ error: "Intake must be completed first" }); return;
    }
    if (!r.session.verifiedEmail) {
      res.status(403).json({ error: "Email verification required before signing", code: "email_not_verified" }); return;
    }
    const { signatureImagePngBase64, signerName } = req.body || {};
    if (!signatureImagePngBase64 || typeof signatureImagePngBase64 !== "string") {
      res.status(400).json({ error: "signatureImagePngBase64 is required" }); return;
    }
    if (signatureImagePngBase64.length > 2_000_000) {
      res.status(413).json({ error: "Signature image too large" }); return;
    }

    const signerIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || null;
    const signerUserAgent = (req.headers["user-agent"] as string) || null;
    const signedAt = new Date();
    const finalSignerName = signerName ? String(signerName).slice(0, 200) : (r.session.signerName || null);

    const ctx = buildAgentContext(r.agent, (r.session.intakeData as any) || null, {
      signerEmail: r.session.signerEmail,
      signerName: finalSignerName || undefined,
      date: signedAt.toISOString().slice(0, 10),
      number: contractNumber(r.session.id, signedAt),
    });
    // Inject the signer's drawn signature into the {{signature}} placeholder so
    // it renders inside the designed signature box; remaining unfilled signature
    // images (e.g. {{main_agency_signature}}) become styled placeholders.
    ctx.signature = toSignatureDataUrl(signatureImagePngBase64);
    const rendered = renderTemplate(r.template.bodyHtml, ctx);
    const placeholder = SIG_PLACEHOLDER[r.template.language] || SIG_PLACEHOLDER.en;
    const renderedHtml = cleanupSignatureImages(rendered, placeholder);

    const { pdfBytes, evidenceHash } = await buildSignedPdf({
      templateName: r.template.name,
      bodyHtml: renderedHtml,
      signerEmail: r.session.signerEmail,
      signerName: finalSignerName,
      signerIp,
      signerUserAgent,
      signedAt,
    });

    let pdfObjectKey = "";
    let signatureObjectKey: string | null = null;
    try {
      pdfObjectKey = await objectStorage.uploadBuffer({
        subdir: "signed-contracts",
        filename: `contract-${r.session.id}.pdf`,
        buffer: Buffer.from(pdfBytes),
        contentType: "application/pdf",
      });
      const sigBytes = Buffer.from(signatureImagePngBase64.replace(/^data:image\/[a-z]+;base64,/, ""), "base64");
      signatureObjectKey = await objectStorage.uploadBuffer({
        subdir: "signed-contracts",
        filename: `signature-${r.session.id}.png`,
        buffer: sigBytes,
        contentType: "image/png",
      });
    } catch (uploadErr) {
      console.error("[public-sign] object storage upload failed:", uploadErr);
      res.status(500).json({ error: "Failed to store signed contract. Please try again." });
      return;
    }

    // Atomic finalize: wrap status flip + signed_contracts insert in a single
    // transaction so a mid-flight failure rolls back both. The conditional
    // UPDATE ensures only the first concurrent request wins; UNIQUE(signing_
    // session_id) on signed_contracts is a defensive backstop.
    let signed: typeof signedContractsTable.$inferSelect;
    type FinalizeOutcome =
      | { ok: true; row: typeof signedContractsTable.$inferSelect }
      | { ok: false; status: number; error: string };
    let outcome: FinalizeOutcome;
    try {
      outcome = await db.transaction(async (tx): Promise<FinalizeOutcome> => {
        const [statusUpdate] = await tx.update(signingSessionsTable).set({
          status: "signed",
          signedAt,
          signerName: finalSignerName,
        }).where(and(
          eq(signingSessionsTable.id, r.session.id),
          eq(signingSessionsTable.status, r.session.status),
        )).returning({ id: signingSessionsTable.id });
        if (!statusUpdate) {
          return { ok: false, status: 409, error: "This session has already been signed or is no longer pending." };
        }
        const [row] = await tx.insert(signedContractsTable).values({
          signingSessionId: r.session.id,
          agentId: r.session.agentId,
          templateId: r.template.id,
          pdfObjectKey,
          signatureImageObjectKey: signatureObjectKey,
          evidenceHash,
          signerEmail: r.session.signerEmail,
          signerName: finalSignerName,
          signerIp,
          signerUserAgent,
          signedAt,
        }).returning();
        return { ok: true, row };
      });
    } catch (txErr: any) {
      if (txErr?.code === "23505") {
        res.status(409).json({ error: "This session has already been signed." });
        return;
      }
      console.error("[public-sign] finalize transaction failed:", txErr);
      res.status(500).json({ error: "Failed to complete signing" });
      return;
    }
    if (!outcome.ok) {
      res.status(outcome.status).json({ error: outcome.error });
      return;
    }
    signed = outcome.row;

    // Deliver the signed PDF as a direct attachment (best-effort) to:
    //  1. the signer's verified email, and
    //  2. all active admin accounts (super_admin / admin).
    // The download link is also kept in the body via the opaque token, which
    // gates /api/public/sign/:token/pdf and only serves once status=signed —
    // this is a fallback when the queued retry path (no attachment) runs.
    try {
      const downloadUrl = `${getAppBaseUrl()}/api/public/sign/${rawTokenForLink}/pdf`;
      const portalUrl = `${getAppBaseUrl()}/login`;
      const pdfAttachment = {
        filename: `contract-${r.session.id}.pdf`,
        content: Buffer.from(pdfBytes),
        contentType: "application/pdf",
      };
      const signerEmail = r.session.verifiedEmail || r.session.signerEmail;
      if (signerEmail) {
        const email = await buildSignedContractEmail({
          signerName: finalSignerName,
          templateName: r.template.name,
          pdfDownloadUrl: downloadUrl,
          portalUrl,
          language: r.template.language,
        });
        await sendEmail(signerEmail, email, { attachments: [pdfAttachment] });
        await db.update(signedContractsTable).set({ emailedAt: new Date() }).where(eq(signedContractsTable.id, signed.id));
      }

      const adminEmails = await getAdminRecipientEmails(signerEmail);
      if (adminEmails.length > 0) {
        const adminEmail = await buildSignedContractAdminEmail({
          signerName: finalSignerName,
          signerEmail: signerEmail || "",
          templateName: r.template.name,
          pdfDownloadUrl: downloadUrl,
        });
        for (const to of adminEmails) {
          try {
            await sendEmail(to, adminEmail, { attachments: [pdfAttachment] });
          } catch (adminErr) {
            console.error(`[public-sign] failed to email admin ${to}:`, adminErr);
          }
        }
      }
    } catch (emailErr) {
      console.error("[public-sign] failed to email signed PDF:", emailErr);
    }

    await writeAudit({
      userId: r.session.createdByUserId ?? null,
      action: "contract.signed",
      resource: "signed_contract",
      resourceId: signed.id,
      changes: {
        sessionId: r.session.id,
        templateId: r.template.id,
        agentId: r.session.agentId,
        evidenceHash,
        signerEmail: r.session.signerEmail,
      },
      ipAddress: signerIp,
    });

    res.json({ data: { signedContractId: signed.id, pdfObjectKey, evidenceHash } });
  } catch (err) {
    console.error("[public-sign] sign:", err);
    res.status(500).json({ error: "Failed to complete signing" });
  }
});

/**
 * Public PDF download. Authorised purely by possession of the signing token —
 * no session cookie. Only serves the PDF once the session has been signed.
 * The token is the same opaque secret emailed to the signer.
 */
router.get("/public/sign/:token/pdf", signLimiter, async (req, res): Promise<void> => {
  try {
    const r = await resolveByToken(req.params.token);
    if ("error" in r) { res.status(r.status).json({ error: r.error }); return; }
    if (r.session.status !== "signed") {
      res.status(404).json({ error: "Signed PDF not available" });
      return;
    }
    const [signed] = await db.select().from(signedContractsTable)
      .where(eq(signedContractsTable.signingSessionId, r.session.id));
    if (!signed) { res.status(404).json({ error: "Signed PDF not found" }); return; }
    let normalizedPath = signed.pdfObjectKey;
    if (normalizedPath.startsWith("/objects/")) normalizedPath = normalizedPath.slice("/objects/".length);
    if (normalizedPath.startsWith("objects/")) normalizedPath = normalizedPath.slice("objects/".length);
    const file = await objectStorage.getObjectEntityFile(`/objects/${normalizedPath}`);
    const [metadata] = await file.getMetadata();
    const filename = await buildContractFilename({
      agent: r.agent,
      signedAt: signed.createdAt || new Date(),
    });
    res.setHeader("Content-Type", (metadata.contentType as string) || "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.setHeader("Cache-Control", "private, no-store");
    if (metadata.size) res.setHeader("Content-Length", String(metadata.size));
    file.createReadStream()
      .on("error", (err) => { console.error("[public-sign] pdf stream error:", err); if (!res.headersSent) res.status(500).end(); })
      .pipe(res);
  } catch (err) {
    console.error("[public-sign] pdf download:", err);
    if (!res.headersSent) res.status(500).json({ error: "Failed to download PDF" });
  }
});

export default router;
