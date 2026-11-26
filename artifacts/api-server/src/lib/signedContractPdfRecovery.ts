/** A retry may recover an absent artifact, never replace finalized evidence. */
export const MISSING_PDF_LEASE_RESET = { deliveryClaimedAt: null } as const;
export const PDF_LEASE_MS = 5 * 60_000;
const RECENT_EMAIL_WINDOW_MS = 3 * 24 * 60 * 60_000;

export function decideMissingPdfRecovery(
  row: {
    pdfObjectKey: string | null;
    evidenceHash: string | null;
    deliveryClaimedAt: Date | null;
    emailedAt: Date | null;
    signedAt: Date;
  },
  workers: { delivery: boolean; pdfOnly: boolean },
  now = new Date(),
): { ok: true } | { ok: false; status: 409 | 503; code: string; error: string } {
  if (row.pdfObjectKey || row.evidenceHash) {
    return { ok: false, status: 409, code: "SIGNED_ARTIFACT_IMMUTABLE", error: "An existing signed PDF or evidence hash cannot be replaced. The original evidence is preserved." };
  }
  if (row.deliveryClaimedAt && row.deliveryClaimedAt.getTime() >= now.getTime() - PDF_LEASE_MS) {
    return { ok: false, status: 409, code: "PDF_WORK_IN_PROGRESS", error: "A worker already owns this contract. Its active lease cannot be reset." };
  }
  if (!workers.delivery && !workers.pdfOnly) {
    return { ok: false, status: 503, code: "PDF_WORKER_UNAVAILABLE", error: "PDF processing is not enabled. Ask an administrator to check the document worker." };
  }
  if (!(workers.delivery && row.emailedAt) && row.signedAt.getTime() <= now.getTime() - RECENT_EMAIL_WINDOW_MS) {
    return { ok: false, status: 409, code: "CONTROLLED_PDF_RECOVERY_REQUIRED", error: "This historical contract needs controlled PDF-only recovery. No email has been queued." };
  }
  return { ok: true };
}
