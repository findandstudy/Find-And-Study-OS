import { db, contractTemplatesTable, signingSessionsTable, signedContractsTable, agentsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { renderTemplate, buildAgentContext, cleanupSignatureImages, SIG_PLACEHOLDER, toSignatureDataUrl } from "./contractRenderer";
import { buildSignedPdf } from "./contractPdf";
import { ObjectStorageService } from "./objectStorage";
import { writeAudit } from "./auditLog";
import { buildSignedContractEmail, sendEmail, getAppBaseUrl } from "./email";

const objectStorage = new ObjectStorageService();

export type FinalizeSignResult =
  | { ok: true; signedContractId: number; pdfObjectKey: string; evidenceHash: string }
  | { ok: false; status: number; error: string };

/**
 * Finalize a signing session: render PDF, store, atomically flip status to
 * signed, insert signed_contracts row, email the signer the PDF link.
 *
 * Used by both the public token-based signing flow and the authenticated
 * agent onboarding signing flow.
 */
export async function finalizeSign(opts: {
  sessionId: number;
  signatureImagePngBase64: string;
  signerName: string | null;
  signerIp: string | null;
  signerUserAgent: string | null;
  pdfDownloadUrl?: string;
  triggerUserId?: number | null;
}): Promise<FinalizeSignResult> {
  const [session] = await db.select().from(signingSessionsTable).where(eq(signingSessionsTable.id, opts.sessionId));
  if (!session) return { ok: false, status: 404, error: "Session not found" };
  if (session.status === "signed") return { ok: false, status: 409, error: "Already signed" };
  if (session.status === "revoked") return { ok: false, status: 410, error: "Session revoked" };
  if (session.status === "expired") return { ok: false, status: 410, error: "Session expired" };
  if (new Date(session.expiresAt).getTime() < Date.now()) {
    try {
      await db.update(signingSessionsTable).set({ status: "expired" }).where(and(
        eq(signingSessionsTable.id, session.id), eq(signingSessionsTable.status, session.status),
      ));
    } catch {}
    return { ok: false, status: 410, error: "Session expired" };
  }

  const [template] = await db.select().from(contractTemplatesTable).where(eq(contractTemplatesTable.id, session.templateId));
  if (!template) return { ok: false, status: 404, error: "Template missing" };
  let agent: typeof agentsTable.$inferSelect | null = null;
  if (session.agentId) {
    const [a] = await db.select().from(agentsTable).where(eq(agentsTable.id, session.agentId));
    agent = a || null;
  }

  const signedAt = new Date();
  const finalSignerName = opts.signerName ? opts.signerName.slice(0, 200) : (session.signerName || null);
  const ctx = buildAgentContext(agent, (session.intakeData as any) || null, {
    signerEmail: session.signerEmail,
    signerName: finalSignerName || undefined,
    date: signedAt.toISOString().slice(0, 10),
  });
  // Inject the signer's drawn signature into the template's {{signature}}
  // placeholder so it renders inside the designed signature box (instead of
  // being appended as a separate block). Any still-unfilled signature image
  // (e.g. {{main_agency_signature}}) is swapped for a styled placeholder.
  ctx.signature = toSignatureDataUrl(opts.signatureImagePngBase64);
  const placeholder = SIG_PLACEHOLDER[template.language] || SIG_PLACEHOLDER.en;
  const renderedHtml = cleanupSignatureImages(renderTemplate(template.bodyHtml, ctx), placeholder);

  const { pdfBytes, evidenceHash } = await buildSignedPdf({
    templateName: template.name,
    bodyHtml: renderedHtml,
    signerEmail: session.signerEmail,
    signerName: finalSignerName,
    signerIp: opts.signerIp,
    signerUserAgent: opts.signerUserAgent,
    signedAt,
  });

  let pdfObjectKey = "";
  let signatureObjectKey: string | null = null;
  try {
    pdfObjectKey = await objectStorage.uploadBuffer({
      subdir: "signed-contracts",
      filename: `contract-${session.id}.pdf`,
      buffer: Buffer.from(pdfBytes),
      contentType: "application/pdf",
    });
    const sigBytes = Buffer.from(opts.signatureImagePngBase64.replace(/^data:image\/[a-z]+;base64,/, ""), "base64");
    signatureObjectKey = await objectStorage.uploadBuffer({
      subdir: "signed-contracts",
      filename: `signature-${session.id}.png`,
      buffer: sigBytes,
      contentType: "image/png",
    });
  } catch (err) {
    console.error("[signContract] upload failed:", err);
    return { ok: false, status: 500, error: "Failed to store signed contract" };
  }

  type Outcome = { ok: true; row: typeof signedContractsTable.$inferSelect } | { ok: false; status: number; error: string };
  let outcome: Outcome;
  try {
    outcome = await db.transaction(async (tx): Promise<Outcome> => {
      const [statusUpdate] = await tx.update(signingSessionsTable).set({
        status: "signed", signedAt, signerName: finalSignerName,
      }).where(and(
        eq(signingSessionsTable.id, session.id),
        eq(signingSessionsTable.status, session.status),
      )).returning({ id: signingSessionsTable.id });
      if (!statusUpdate) return { ok: false, status: 409, error: "Session state changed" };
      const [row] = await tx.insert(signedContractsTable).values({
        signingSessionId: session.id,
        agentId: session.agentId,
        templateId: template.id,
        pdfObjectKey,
        signatureImageObjectKey: signatureObjectKey,
        evidenceHash,
        signerEmail: session.signerEmail,
        signerName: finalSignerName,
        signerIp: opts.signerIp,
        signerUserAgent: opts.signerUserAgent,
        signedAt,
      }).returning();
      return { ok: true, row };
    });
  } catch (txErr: any) {
    if (txErr?.code === "23505") return { ok: false, status: 409, error: "Already signed" };
    console.error("[signContract] tx failed:", txErr);
    return { ok: false, status: 500, error: "Failed to complete signing" };
  }
  if (!outcome.ok) return outcome;
  const signed = outcome.row;

  // Email the signed PDF copy. Best-effort.
  try {
    const downloadUrl = opts.pdfDownloadUrl || `${getAppBaseUrl()}/api/contracts/signed/${signed.id}/pdf`;
    const email = await buildSignedContractEmail({
      signerName: finalSignerName,
      templateName: template.name,
      pdfDownloadUrl: downloadUrl,
    });
    await sendEmail(session.signerEmail, email);
    await db.update(signedContractsTable).set({ emailedAt: new Date() }).where(eq(signedContractsTable.id, signed.id));
  } catch (emailErr) {
    console.error("[signContract] failed to email signed PDF:", emailErr);
  }

  await writeAudit({
    userId: opts.triggerUserId ?? session.createdByUserId ?? null,
    action: "contract.signed",
    resource: "signed_contract",
    resourceId: signed.id,
    changes: {
      sessionId: session.id, templateId: template.id, agentId: session.agentId,
      evidenceHash, signerEmail: session.signerEmail,
      isPrimaryOnboarding: session.isPrimaryOnboarding,
    },
    ipAddress: opts.signerIp,
  });

  return { ok: true, signedContractId: signed.id, pdfObjectKey, evidenceHash };
}
