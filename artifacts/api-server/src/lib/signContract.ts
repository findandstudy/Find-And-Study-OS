import { db, contractTemplatesTable, signingSessionsTable, signedContractsTable, agentsTable } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import { renderTemplate, buildAgentContext, cleanupSignatureImages, SIG_PLACEHOLDER, toSignatureDataUrl } from "./contractRenderer";
import { buildSignedPdf } from "./contractPdf";
import { ObjectStorageService } from "./objectStorage";
import { writeAudit } from "./auditLog";
import { buildSignedContractEmail, sendEmail, getAppBaseUrl } from "./email";

const objectStorage = new ObjectStorageService();

// Hard ceiling on PDF rendering. buildSignedPdf launches headless Chromium and
// waits on network idle; a hung launch or a stalled subresource would otherwise
// leave the HTTP request open until the edge proxy kills it and returns its own
// opaque "403 Forbidden" HTML page to the agent. Racing a timeout converts any
// such hang into a clean JSON error the client can display. Normal renders
// finish in well under 10s, so 30s only fires on a genuine stall.
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

// Serialize all headless-Chromium PDF renders across the instance. Chromium is
// memory-heavy; two or more concurrent renders multiply RSS and were OOM-killing
// the resource-constrained autoscale instance mid-request. A crashed process
// makes the edge proxy return its own opaque "403 Forbidden" HTML page instead
// of completing the request. This chain guarantees at most ONE render runs at a
// time, keeping peak memory bounded to a single browser instance.
let renderChain: Promise<unknown> = Promise.resolve();
function withRenderLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = renderChain.then(fn, fn);
  // Keep the chain alive regardless of outcome, without leaking rejections.
  renderChain = run.then(() => undefined, () => undefined);
  return run;
}

/**
 * Fire-and-forget pre-warm of a signed contract's PDF. Called right after a
 * successful sign so the heavy headless-Chromium render happens OFF the
 * user-facing request path: by the time the agent opens/downloads the contract
 * the PDF is already cached, so the download returns instantly instead of
 * blocking ~15s on an inline render that can crash the autoscale instance and
 * surface as an opaque "403 Forbidden". Idempotent and error-safe — never
 * throws into its caller.
 */
export function schedulePdfRender(signedContractId: number): void {
  void ensureSignedContractPdf(signedContractId).catch((err) => {
    console.error(`[schedulePdfRender] background render failed for signed_contract ${signedContractId}:`, err);
  });
}

export type FinalizeSignResult =
  | { ok: true; signedContractId: number }
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

  const signedAt = new Date();
  const finalSignerName = opts.signerName ? opts.signerName.slice(0, 200) : (session.signerName || null);

  // Store ONLY the signature image here (lightweight). The contract PDF is
  // rendered lazily on first download via ensureSignedContractPdf(), NOT during
  // this request. Headless-Chromium rendering is memory-heavy and was crashing
  // the resource-constrained autoscale instance mid-request, which made the edge
  // proxy return an opaque HTML "403 Forbidden" page instead of completing the
  // sign. Decoupling guarantees signing succeeds without Chromium on the hot path.
  let signatureObjectKey: string | null = null;
  try {
    const sigBytes = Buffer.from(opts.signatureImagePngBase64.replace(/^data:image\/[a-z]+;base64,/, ""), "base64");
    signatureObjectKey = await objectStorage.uploadBuffer({
      subdir: "signed-contracts",
      filename: `signature-${session.id}.png`,
      buffer: sigBytes,
      contentType: "image/png",
    });
  } catch (err) {
    console.error("[signContract] signature upload failed:", err);
    return { ok: false, status: 500, error: "İmza görseli kaydedilemedi. Lütfen tekrar deneyin." };
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
        pdfObjectKey: null,
        signatureImageObjectKey: signatureObjectKey,
        evidenceHash: null,
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

  // Email the signed PDF copy. Best-effort. Skipped when no signer email
  // exists (e.g. a self-fill link created without an email address).
  if (session.signerEmail) {
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
  }

  await writeAudit({
    userId: opts.triggerUserId ?? session.createdByUserId ?? null,
    action: "contract.signed",
    resource: "signed_contract",
    resourceId: signed.id,
    changes: {
      sessionId: session.id, templateId: template.id, agentId: session.agentId,
      signerEmail: session.signerEmail,
      isPrimaryOnboarding: session.isPrimaryOnboarding,
    },
    ipAddress: opts.signerIp,
  });

  // Pre-warm the signed PDF off the request path. Rendering it here (after the
  // status flip has already committed) means the agent's subsequent open/download
  // hits a cached PDF instead of triggering a ~15s inline headless-Chromium
  // render — the inline render is what crashes the autoscale instance and
  // surfaces to the agent as an opaque edge-proxy "403 Forbidden".
  schedulePdfRender(signed.id);

  return { ok: true, signedContractId: signed.id };
}

async function readObjectBuffer(key: string): Promise<Buffer | null> {
  try {
    let p = key;
    if (p.startsWith("/objects/")) p = p.slice("/objects/".length);
    if (p.startsWith("objects/")) p = p.slice("objects/".length);
    const file = await objectStorage.getObjectEntityFile(`/objects/${p}`);
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      file.createReadStream()
        .on("data", (c: Buffer) => chunks.push(c))
        .on("end", () => resolve())
        .on("error", reject);
    });
    return Buffer.concat(chunks);
  } catch (err) {
    console.error("[ensureSignedContractPdf] failed to read signature image:", err);
    return null;
  }
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

  const [session] = await db.select().from(signingSessionsTable).where(eq(signingSessionsTable.id, row.signingSessionId));
  const [template] = await db.select().from(contractTemplatesTable).where(eq(contractTemplatesTable.id, row.templateId));
  if (!template) throw new Error("Template missing");
  let agent: typeof agentsTable.$inferSelect | null = null;
  if (row.agentId) {
    const [a] = await db.select().from(agentsTable).where(eq(agentsTable.id, row.agentId));
    agent = a || null;
  }

  // Fail hard if the signature image cannot be retrieved. Generating a PDF with
  // an empty signature would persist an "unsigned" document as if it were validly
  // signed — a data-integrity failure. Throwing keeps pdfObjectKey/evidenceHash
  // null so the download route returns 503 and a later retry can succeed.
  if (!row.signatureImageObjectKey) {
    throw new Error(`Signature image missing for signed_contract ${row.id}; refusing to generate unsigned PDF`);
  }
  const sigBuf = await readObjectBuffer(row.signatureImageObjectKey);
  if (!sigBuf) {
    throw new Error(`Signature image could not be read for signed_contract ${row.id}; refusing to generate unsigned PDF`);
  }
  const signatureBase64 = sigBuf.toString("base64");

  const signedAt = row.signedAt ? new Date(row.signedAt) : new Date();
  const ctx = buildAgentContext(agent, (session?.intakeData as any) || null, {
    signerEmail: row.signerEmail,
    signerName: row.signerName || undefined,
    date: signedAt.toISOString().slice(0, 10),
  });
  ctx.signature = toSignatureDataUrl(signatureBase64);
  const placeholder = SIG_PLACEHOLDER[template.language] || SIG_PLACEHOLDER.en;
  const renderedHtml = cleanupSignatureImages(renderTemplate(template.bodyHtml, ctx), placeholder);

  // Serialize the heavy render: only one headless Chromium runs at a time across
  // the instance (see withRenderLock). The lock also lets a concurrent caller —
  // e.g. the post-sign pre-warm racing the agent's download — skip the work once
  // the winner has finished, by re-checking the stored key inside the lock.
  return withRenderLock(async () => {
    const [latest] = await db.select().from(signedContractsTable).where(eq(signedContractsTable.id, row.id));
    if (latest?.pdfObjectKey && latest.evidenceHash) {
      return { pdfObjectKey: latest.pdfObjectKey, evidenceHash: latest.evidenceHash };
    }

    const built = await withTimeout(
      buildSignedPdf({
        templateName: template.name,
        bodyHtml: renderedHtml,
        signerEmail: row.signerEmail,
        signerName: row.signerName,
        signerIp: row.signerIp,
        signerUserAgent: row.signerUserAgent,
        signedAt,
      }),
      30_000,
      "Contract PDF render",
    );

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
      .where(and(eq(signedContractsTable.id, row.id), isNull(signedContractsTable.pdfObjectKey)))
      .returning({ id: signedContractsTable.id });
    if (updated.length === 0) {
      const [fresh] = await db.select().from(signedContractsTable).where(eq(signedContractsTable.id, row.id));
      if (fresh?.pdfObjectKey && fresh.evidenceHash) {
        console.warn(`[ensureSignedContractPdf] race for signed_contract ${row.id}; discarding duplicate object ${pdfObjectKey}`);
        return { pdfObjectKey: fresh.pdfObjectKey, evidenceHash: fresh.evidenceHash };
      }
    }
    return { pdfObjectKey, evidenceHash: built.evidenceHash };
  });
}
