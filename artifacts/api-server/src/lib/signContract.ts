import { db, contractTemplatesTable, signingSessionsTable, signedContractsTable, agentsTable, auditLogsTable } from "@workspace/db";
import { and, eq, isNull, desc } from "drizzle-orm";
import { prepareFrozenContractPdf, preflightUnsignedContractPdf, signingSnapshotIdentity } from "./contractSigningPreflight";
import { buildSignedPdf } from "./contractPdf";
import { ObjectStorageService } from "./objectStorage";
import { writeAudit } from "./auditLog";
import { getAppBaseUrl } from "./email";
import { withRenderLock } from "./renderLock";
import { resolveContractEmailVerificationEvidence } from "./contractBranding";
import { PDFDocument } from "pdf-lib";

// Convert the canonical /objects/<entityId> key returned by uploadBuffer into a
// browser-openable URL served by GET /api/storage/objects/*path (requireAuth).
export function objectKeyToStorageUrl(pdfObjectKey: string): string {
  let p = pdfObjectKey;
  if (p.startsWith("/objects/")) p = p.slice("/objects/".length);
  else if (p.startsWith("objects/")) p = p.slice("objects/".length);
  return `${getAppBaseUrl()}/api/storage/objects/${p}`;
}

// Read-time resolution of an agent's *current* signed contract. An agent can
// accumulate multiple signed_contracts over time: an admin "resend" creates a
// brand-new signing session (often isPrimaryOnboarding=false) plus a new
// signed_contract. The agent's authoritative contract is always the most
// recently signed one. Endpoints resolve this at read time so that neither a
// stale agents.contractUrl (locked to an earlier contract) nor a
// primary-onboarding-only session lookup can surface a superseded/broken PDF.
export async function loadNewestSignedContractForAgent(agentId: number) {
  const [row] = await db
    .select({ signed: signedContractsTable, session: signingSessionsTable })
    .from(signedContractsTable)
    .innerJoin(signingSessionsTable, eq(signedContractsTable.signingSessionId, signingSessionsTable.id))
    .where(eq(signedContractsTable.agentId, agentId))
    .orderBy(desc(signedContractsTable.signedAt), desc(signedContractsTable.id))
    .limit(1);
  return row ?? null;
}

// Browser-openable URL of the agent's newest signed contract PDF, or null when
// the agent has no signed contract yet or its PDF has not been rendered.
export async function getNewestSignedContractUrl(agentId: number): Promise<string | null> {
  const row = await loadNewestSignedContractForAgent(agentId);
  if (!row?.signed.pdfObjectKey) return null;
  return objectKeyToStorageUrl(row.signed.pdfObjectKey);
}

const objectStorage = new ObjectStorageService();

export type FinalizeSignResult =
  | { ok: true; signedContractId: number }
  | { ok: false; status: number; error: string; code?: string; missingFields?: string[] };

// First 8 bytes of every PNG file (magic number).
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export const MAX_SIGNATURE_BYTES = 2 * 1024 * 1024;

export type SignatureValidation =
  | { ok: true; base64: string; bytes: Buffer }
  | { ok: false; status: number; error: string };

/**
 * Normalize and validate an incoming signature image. Accepts either bare
 * base64 or a legacy "data:image/...;base64,<...>" data URL (older clients sent
 * the latter for small signatures). Decodes the base64 and enforces that the
 * bytes are a real PNG (magic number) of bounded size — a prior bug let an
 * invalid value ("AAAA") through and corrupted a signed contract record.
 */
export function validateSignatureImage(input: string): SignatureValidation {
  const base64 = input.replace(/^data:image\/[a-z+]+;base64,/i, "");
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length < PNG_MAGIC.length || !bytes.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
    return { ok: false, status: 400, error: "Invalid PNG" };
  }
  if (bytes.length > MAX_SIGNATURE_BYTES) {
    return { ok: false, status: 400, error: "Signature image too large" };
  }
  return { ok: true, base64, bytes };
}

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

  const signedAt = new Date();
  const finalSignerName = opts.signerName ? opts.signerName.slice(0, 200) : (session.signerName || null);
  const emailVerificationEvidence = resolveContractEmailVerificationEvidence(
    session.templateSigningPageConfigSnapshot ?? template.signingPageConfig,
    {
      verifiedEmail: session.verifiedEmail,
      method: session.emailVerificationMethod,
      verifiedAt: session.emailVerifiedAt,
      authenticatedAt: opts.triggerUserId ? signedAt : null,
    },
  );

  // Store the signature as a base64 string directly in the DB row. Previously
  // the signature was uploaded to GCS here, but the GCS upload (up to 30 s) was
  // OOM-killing the resource-constrained autoscale instance mid-request, which
  // made the edge proxy return an opaque HTML "403 Forbidden" page instead of
  // completing the sign. Storing base64 in the DB is a pure DB write (<50 ms)
  // and eliminates the GCS I/O from the sign hot path entirely.
  // The GCS upload now happens lazily inside ensureSignedContractPdf() the first
  // time someone downloads the PDF, together with the Chromium render.
  const sigCheck = validateSignatureImage(opts.signatureImagePngBase64);
  if (!sigCheck.ok) return sigCheck;
  const signatureBase64 = sigCheck.base64;

  // Validate every new signature independently of delivery-worker rollout.
  try {
    preflightUnsignedContractPdf(session, { signedAt, signatureBase64, signerName: finalSignerName,
      signerIp: opts.signerIp, signerUserAgent: opts.signerUserAgent, evidence: emailVerificationEvidence });
  } catch (error: any) {
    if (error?.message === 'CONTRACT_FROZEN_FIELD_MISSING' && session.mode !== 'admin_driven') return { ok: false, status: 422,
      code: 'CONTRACT_INTAKE_REQUIRED', missingFields: error.missingFields,
      error: 'Complete the required contract details before signing.' };
    return { ok: false, status: 422, code: 'CONTRACT_DOCUMENT_NOT_READY',
      error: 'The contract document is not ready for signing. Please contact our team; your signature was not saved.' };
  }

  type Outcome = { ok: true; row: typeof signedContractsTable.$inferSelect } | { ok: false; status: number; error: string };
  let outcome: Outcome;
  try {
    outcome = await db.transaction(async (tx): Promise<Outcome> => {
      const [current] = await tx.select().from(signingSessionsTable).where(eq(signingSessionsTable.id, session.id)).for('update');
      if (!current || signingSnapshotIdentity(current) !== signingSnapshotIdentity(session)) {
        return { ok: false, status: 409, error: 'Contract details changed. Reload and review before signing.' };
      }
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
        subjectType: session.subjectType,
        subjectId: session.subjectId,
        subjectLabel: session.subjectLabel,
        pdfObjectKey: null,
        signatureImageObjectKey: null,
        signatureImageBase64: signatureBase64,
        evidenceHash: null,
        signerEmail: session.signerEmail,
        signerName: finalSignerName,
        signerIp: opts.signerIp,
        signerUserAgent: opts.signerUserAgent,
        emailVerificationRequired: emailVerificationEvidence.required,
        emailVerificationMethod: emailVerificationEvidence.method,
        emailVerifiedAt: emailVerificationEvidence.verifiedAt,
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

  // NOTE: PDF delivery (rendering the signed PDF, emailing it as an attachment
  // to the signer AND all admins, and populating agents.contractUrl) is handled
  // out-of-band by the signed-contract delivery worker (see
  // lib/signedContractDelivery.ts). We deliberately leave emailedAt = NULL here
  // so the worker picks this row up. Keeping delivery off the sign hot path
  // avoids running headless Chromium on a user-blocking request, which OOM-kills
  // the autoscale instance and surfaces as an opaque edge-proxy 403.

  await writeAudit({
    userId: opts.triggerUserId ?? session.createdByUserId ?? null,
    action: "contract.signed",
    resource: "signed_contract",
    resourceId: signed.id,
    changes: {
      sessionId: session.id, templateId: template.id, agentId: session.agentId,
      signerEmail: session.signerEmail,
      emailVerificationRequired: emailVerificationEvidence.required,
      emailVerificationMethod: emailVerificationEvidence.method,
      emailVerifiedAt: emailVerificationEvidence.verifiedAt?.toISOString() ?? null,
      isPrimaryOnboarding: session.isPrimaryOnboarding,
    },
    ipAddress: opts.signerIp,
  });

  // NOTE: we deliberately do NOT render the PDF here. The sign hot path must
  // stay lightweight (signature upload + DB commit). Headless Chromium is run
  // lazily on the first download via ensureSignedContractPdf(). Autoscale does
  // not support fire-and-forget background work after the response is sent — a
  // post-response Chromium render destabilizes the instance and made the sign
  // POST itself surface as an opaque edge-proxy "403 Forbidden".
  return { ok: true, signedContractId: signed.id };
}

export async function readObjectBuffer(key: string, maxBytes = 10 * 1024 * 1024): Promise<Buffer | null> {
  try {
    let p = key;
    if (p.startsWith("/objects/")) p = p.slice("/objects/".length);
    if (p.startsWith("objects/")) p = p.slice("objects/".length);
    const file = await objectStorage.getObjectEntityFile(`/objects/${p}`);
    const chunks: Buffer[] = [];
    let total = 0;
    await new Promise<void>((resolve, reject) => {
      file.createReadStream()
        .on("data", function (this: NodeJS.ReadableStream, c: Buffer) {
          total += c.length;
          if (total > maxBytes) {
            (this as any).destroy(new Error("object_too_large"));
            return;
          }
          chunks.push(c);
        })
        .on("end", () => resolve())
        .on("error", reject);
    });
    return Buffer.concat(chunks);
  } catch (err) {
    console.error("[ensureSignedContractPdf] failed to read signature image:", err);
    return null;
  }
}

function preparePersistedFrozenPdf(
  row: typeof signedContractsTable.$inferSelect,
  session: typeof signingSessionsTable.$inferSelect,
  signatureBase64: string,
  allowExistingArtifact = false,
) {
  return prepareFrozenContractPdf({
    contract: {
      signing_session_id: row.signingSessionId,
      template_id: row.templateId,
      pdf_object_key: row.pdfObjectKey,
      evidence_hash: row.evidenceHash,
      signature_image_base64: signatureBase64,
      signed_at: row.signedAt,
      signer_email: row.signerEmail,
      signer_name: row.signerName,
      signer_ip: row.signerIp,
      signer_user_agent: row.signerUserAgent,
      email_verification_required: row.emailVerificationRequired,
      email_verification_method: row.emailVerificationMethod,
      email_verified_at: row.emailVerifiedAt,
    },
    session: {
      id: session.id,
      template_id: session.templateId,
      status: session.status,
      revoked_at: session.revokedAt,
      signed_at: session.signedAt,
      template_body_html_snapshot: session.templateBodyHtmlSnapshot,
      template_name_snapshot: session.templateNameSnapshot,
      template_language_snapshot: session.templateLanguageSnapshot,
      template_version_snapshot: session.templateVersionSnapshot,
      template_intake_schema_snapshot: session.templateIntakeSchemaSnapshot,
      template_signing_page_config_snapshot: session.templateSigningPageConfigSnapshot,
      intake_data: session.intakeData,
    },
  }, { allowExistingArtifact });
}

/**
 * Lazily render + store the signed contract PDF the first time it is accessed.
 * Signing itself no longer renders a PDF (headless Chromium is too heavy for the
 * autoscale request path and was crashing the instance), so the heavy work
 * happens here, on download. Idempotent: returns immediately once a PDF object
 * key has been stored. All inputs needed to reconstruct the document (template,
 * intake data, signer identity, signed timestamp, signature image) are persisted
 * at sign time, so the regenerated PDF is deterministic.
 */
export async function ensureSignedContractPdf(
  signedContractId: number,
): Promise<{ pdfObjectKey: string; evidenceHash: string }> {
  const [row] = await db.select().from(signedContractsTable).where(eq(signedContractsTable.id, signedContractId));
  if (!row) throw new Error("Signed contract not found");
  if (row.pdfObjectKey && row.evidenceHash) {
    return { pdfObjectKey: row.pdfObjectKey, evidenceHash: row.evidenceHash };
  }
  if (row.pdfObjectKey || row.evidenceHash) {
    throw new Error("SIGNED_ARTIFACT_INCOMPLETE_REPAIR_REQUIRED");
  }

  const [session] = await db.select().from(signingSessionsTable).where(eq(signingSessionsTable.id, row.signingSessionId));
  if (!session) throw new Error("CONTRACT_FROZEN_INPUT_REQUIRED");

  // Signature source: new sign attempts store base64 directly in the DB row
  // (signatureImageBase64) to avoid a GCS upload on the hot sign path. Older
  // rows that were signed before this change have a GCS object key instead. The
  // logic below handles both transparently.
  // Fail hard if neither source is available: generating a PDF with no signature
  // would persist an "unsigned" document as if it were validly signed.
  let signatureBase64: string;
  if (row.signatureImageBase64) {
    signatureBase64 = row.signatureImageBase64;
  } else if (row.signatureImageObjectKey) {
    const sigBuf = await readObjectBuffer(row.signatureImageObjectKey);
    if (!sigBuf) {
      throw new Error(`Signature image could not be read for signed_contract ${row.id}; refusing to generate unsigned PDF`);
    }
    signatureBase64 = sigBuf.toString("base64");
  } else {
    throw new Error(`Signature image missing for signed_contract ${row.id}; refusing to generate unsigned PDF`);
  }

  // For rows that only have the base64 in the DB (no GCS object key yet),
  // upload the signature to GCS now so the object storage stays the authoritative
  // store for binary assets and future renders can skip the DB column.
  // This is a best-effort background step: failure is logged but does NOT abort
  // the PDF render — the base64 column is still there for next time.
  if (!row.signatureImageObjectKey && row.signatureImageBase64) {
    try {
      const sigBytes = Buffer.from(row.signatureImageBase64, "base64");
      const uploadedKey = await objectStorage.uploadBuffer({
        subdir: "signed-contracts",
        filename: `signature-${row.signingSessionId}.png`,
        buffer: sigBytes,
        contentType: "image/png",
      });
      await db.update(signedContractsTable)
        .set({ signatureImageObjectKey: uploadedKey })
        .where(and(eq(signedContractsTable.id, row.id), isNull(signedContractsTable.signatureImageObjectKey)));
    } catch (uploadErr) {
      console.warn(`[ensureSignedContractPdf] background signature GCS upload failed for signed_contract ${row.id} (non-fatal):`, uploadErr);
    }
  }

  const signedAt = row.signedAt ? new Date(row.signedAt) : new Date(NaN);
  const prepared = preparePersistedFrozenPdf(row, session, signatureBase64);

  // Serialize the heavy render: only one headless Chromium runs at a time across
  // the instance (see withRenderLock). The lock also lets concurrent downloads of
  // the same contract skip the work once the winner has finished, by re-checking
  // the stored key inside the lock.
  return withRenderLock(async () => {
    const [latest] = await db.select().from(signedContractsTable).where(eq(signedContractsTable.id, row.id));
    if (latest?.pdfObjectKey && latest.evidenceHash) {
      return { pdfObjectKey: latest.pdfObjectKey, evidenceHash: latest.evidenceHash };
    }

    // buildSignedPdf self-bounds its render with an internal timeout that closes
    // the browser on expiry, so the lock is held only until Chromium has actually
    // exited — a timed-out render frees its memory before the next one starts.
    const built = await buildSignedPdf({
      ...prepared,
    });

    const pdfObjectKey = await objectStorage.uploadBuffer({
      subdir: "signed-contracts",
      filename: `contract-${row.signingSessionId}.pdf`,
      buffer: Buffer.from(built.pdfBytes),
      contentType: "application/pdf",
    });
    // Compare-and-set: only the first concurrent generator wins. If a parallel
    // request already filled pdfObjectKey, this update affects 0 rows; we then
    // return the winner's key and discard our freshly uploaded duplicate object.
    const updated = await db.update(signedContractsTable)
      .set({ pdfObjectKey, evidenceHash: built.evidenceHash })
      .where(and(
        eq(signedContractsTable.id, row.id),
        isNull(signedContractsTable.pdfObjectKey),
        isNull(signedContractsTable.evidenceHash),
      ))
      .returning({ id: signedContractsTable.id });

    let finalPdfObjectKey = pdfObjectKey;
    let finalEvidenceHash = built.evidenceHash;

    if (updated.length === 0) {
      const [fresh] = await db.select().from(signedContractsTable).where(eq(signedContractsTable.id, row.id));
      if (fresh?.pdfObjectKey && fresh.evidenceHash) {
        console.warn(`[ensureSignedContractPdf] race for signed_contract ${row.id}; discarding duplicate object ${pdfObjectKey}`);
        finalPdfObjectKey = fresh.pdfObjectKey;
        finalEvidenceHash = fresh.evidenceHash;
      }
    }

    // Lazy contractUrl hydration: set agents.contractUrl on the first successful
    // PDF render so the agent's Account "Contract" tile and the staff Agents page
    // contract link work as soon as someone first downloads the PDF. The delivery
    // worker sets contractStartDate/contractEndDate without the PDF; this fills
    // in contractUrl.
    //
    // Only the agent's MOST RECENT signed_contract is allowed to set contractUrl.
    // An earlier `isNull(contractUrl)` guard permanently locked the agent to the
    // first contract that rendered — so when an agent re-signs (resend creates a
    // new signing session + signed_contract), the new contract's render became a
    // no-op and the agent stayed pointed at the stale (possibly broken) PDF.
    // Gating on "is this the newest signed_contract for the agent" lets a re-sign
    // win while preventing a late download of an OLD contract's PDF from clobbering
    // the URL back to a superseded contract.
    if (row.agentId) {
      try {
        const [newest] = await db
          .select({ id: signedContractsTable.id })
          .from(signedContractsTable)
          .where(eq(signedContractsTable.agentId, row.agentId))
          .orderBy(desc(signedContractsTable.signedAt), desc(signedContractsTable.id))
          .limit(1);
        if (newest?.id === row.id) {
          const storageUrl = objectKeyToStorageUrl(finalPdfObjectKey);
          const startDate = row.signedAt ? new Date(row.signedAt) : new Date();
          const endDate = new Date(startDate);
          endDate.setFullYear(endDate.getFullYear() + 1);
          await db.update(agentsTable)
            .set({ contractUrl: storageUrl, contractStartDate: startDate, contractEndDate: endDate })
            .where(eq(agentsTable.id, row.agentId));
        }
      } catch (agentErr) {
        // Non-fatal: contractUrl is cosmetic. Log and continue — the PDF is
        // already stored and will be downloadable; the tile link just won't
        // appear until the next successful render (or a manual admin update).
        console.error(`[ensureSignedContractPdf] failed to set contractUrl for agent ${row.agentId}:`, agentErr);
      }
    }

    return { pdfObjectKey: finalPdfObjectKey, evidenceHash: finalEvidenceHash };
  });
}

const MAX_SIGNED_PDF_BYTES = 10 * 1024 * 1024;

export async function isStoredSignedPdfHealthy(
  row: Pick<typeof signedContractsTable.$inferSelect, "pdfObjectKey" | "evidenceHash">,
): Promise<boolean> {
  if (!row.pdfObjectKey || !row.evidenceHash || !/^[a-f0-9]{64}$/.test(row.evidenceHash)) return false;
  const bytes = await readObjectBuffer(row.pdfObjectKey, MAX_SIGNED_PDF_BYTES);
  if (!bytes || bytes.length < 100 || bytes.length > MAX_SIGNED_PDF_BYTES
    || bytes.subarray(0, 5).toString("ascii") !== "%PDF-") return false;
  try {
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false });
    return pdf.getPageCount() > 0;
  } catch {
    return false;
  }
}

/**
 * Controlled artifact-only repair. The original signed row and signing
 * session remain the authority: no signature, signed_at, signer, intake or
 * template snapshot is changed. A new immutable object/evidence pair replaces
 * only a missing or unreadable PDF reference; the caller records the audit
 * receipt after this compare-and-set succeeds.
 */
export async function repairSignedContractPdfArtifact(
  signedContractId: number,
  audit: { userId: number | null; reason: string; ipAddress: string | null },
): Promise<{
  oldPdfObjectKey: string | null;
  oldEvidenceHash: string | null;
  pdfObjectKey: string;
  evidenceHash: string;
  signingSessionId: number;
  agentId: number | null;
}> {
  const [row] = await db.select().from(signedContractsTable).where(eq(signedContractsTable.id, signedContractId));
  if (!row) throw new Error("SIGNED_CONTRACT_NOT_FOUND");
  if (await isStoredSignedPdfHealthy(row)) throw new Error("SIGNED_ARTIFACT_HEALTHY");
  const [session] = await db.select().from(signingSessionsTable).where(eq(signingSessionsTable.id, row.signingSessionId));
  if (!session) throw new Error("CONTRACT_FROZEN_INPUT_REQUIRED");

  let signatureBase64 = row.signatureImageBase64 || null;
  if (!signatureBase64 && row.signatureImageObjectKey) {
    const bytes = await readObjectBuffer(row.signatureImageObjectKey, 2 * 1024 * 1024);
    signatureBase64 = bytes?.toString("base64") || null;
  }
  if (!signatureBase64) throw new Error("CONTRACT_FROZEN_SIGNATURE_REQUIRED");

  const prepared = preparePersistedFrozenPdf(row, session, signatureBase64, true);
  const sessionIdentity = signingSnapshotIdentity(session);
  const contractIdentity = JSON.stringify([
    row.signingSessionId, row.templateId, row.agentId, row.signerEmail, row.signerName,
    row.signerIp, row.signerUserAgent, row.signedAt, row.signatureImageBase64,
    row.signatureImageObjectKey, row.emailVerificationRequired,
    row.emailVerificationMethod, row.emailVerifiedAt,
  ]);

  return withRenderLock(async () => {
    const [[fresh], [freshSession]] = await Promise.all([
      db.select().from(signedContractsTable).where(eq(signedContractsTable.id, row.id)),
      db.select().from(signingSessionsTable).where(eq(signingSessionsTable.id, row.signingSessionId)),
    ]);
    if (!fresh || !freshSession
      || fresh.pdfObjectKey !== row.pdfObjectKey
      || fresh.evidenceHash !== row.evidenceHash
      || signingSnapshotIdentity(freshSession) !== sessionIdentity
      || JSON.stringify([
        fresh.signingSessionId, fresh.templateId, fresh.agentId, fresh.signerEmail, fresh.signerName,
        fresh.signerIp, fresh.signerUserAgent, fresh.signedAt, fresh.signatureImageBase64,
        fresh.signatureImageObjectKey, fresh.emailVerificationRequired,
        fresh.emailVerificationMethod, fresh.emailVerifiedAt,
      ]) !== contractIdentity) throw new Error("SIGNED_ARTIFACT_REPAIR_SOURCE_CHANGED");

    const built = await buildSignedPdf(prepared);
    const pdfObjectKey = await objectStorage.uploadBuffer({
      subdir: "signed-contracts",
      filename: `contract-${row.signingSessionId}-repair-${built.evidenceHash.slice(0, 16)}.pdf`,
      buffer: Buffer.from(built.pdfBytes),
      contentType: "application/pdf",
    });
    const pdfCondition = row.pdfObjectKey
      ? eq(signedContractsTable.pdfObjectKey, row.pdfObjectKey)
      : isNull(signedContractsTable.pdfObjectKey);
    const evidenceCondition = row.evidenceHash
      ? eq(signedContractsTable.evidenceHash, row.evidenceHash)
      : isNull(signedContractsTable.evidenceHash);
    await db.transaction(async tx => {
      const updated = await tx.update(signedContractsTable)
        .set({ pdfObjectKey, evidenceHash: built.evidenceHash })
        .where(and(eq(signedContractsTable.id, row.id), pdfCondition, evidenceCondition))
        .returning({ id: signedContractsTable.id });
      if (updated.length !== 1) throw new Error("SIGNED_ARTIFACT_REPAIR_COMPARE_AND_SET_FAILED");
      await tx.insert(auditLogsTable).values({
        userId: audit.userId,
        action: "contract.repair_pdf_artifact",
        resource: "signed_contract",
        resourceId: row.id,
        changes: JSON.stringify({
          reason: audit.reason,
          signingSessionId: row.signingSessionId,
          agentId: row.agentId,
          oldPdfObjectKey: row.pdfObjectKey,
          oldEvidenceHash: row.evidenceHash,
          newPdfObjectKey: pdfObjectKey,
          newEvidenceHash: built.evidenceHash,
          signaturePreserved: true,
          signedAtPreserved: true,
        }),
        ipAddress: audit.ipAddress,
      });
    });

    if (row.agentId) {
      const [newest] = await db.select({ id: signedContractsTable.id })
        .from(signedContractsTable)
        .where(eq(signedContractsTable.agentId, row.agentId))
        .orderBy(desc(signedContractsTable.signedAt), desc(signedContractsTable.id))
        .limit(1);
      if (newest?.id === row.id) {
        await db.update(agentsTable)
          .set({ contractUrl: objectKeyToStorageUrl(pdfObjectKey) })
          .where(eq(agentsTable.id, row.agentId));
      }
    }
    return {
      oldPdfObjectKey: row.pdfObjectKey,
      oldEvidenceHash: row.evidenceHash,
      pdfObjectKey,
      evidenceHash: built.evidenceHash,
      signingSessionId: row.signingSessionId,
      agentId: row.agentId,
    };
  });
}
