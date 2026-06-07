import { db, signedContractsTable, contractTemplatesTable, agentsTable, usersTable } from "@workspace/db";
import { and, eq, isNull, inArray, gt, lt, or, asc } from "drizzle-orm";
import { buildSignedContractEmail, buildSignedContractAdminEmail, sendEmail, getAppBaseUrl } from "./email";
import { ensureSignedContractPdf } from "./signContract";

// Roles that receive a copy of every signed contract (mirrors publicSigning).
const SIGNED_CONTRACT_ADMIN_ROLES = ["super_admin", "admin"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// How often the delivery sweep runs. Delivery is best-effort and not latency
// sensitive — a sub-minute cadence is plenty for an agent who has just signed.
const DELIVERY_INTERVAL_MS = 30_000;
// Only deliver recently-signed contracts. This guards against a first-boot
// backfill flood: any historical rows whose link email failed long ago
// (emailed_at IS NULL) stay untouched, while freshly-signed rows are picked up
// within one sweep.
const RECENT_WINDOW_DAYS = 3;
// Bound the work per sweep. With no Chromium renders each row is a handful of
// DB queries + SMTP calls, so this is purely a backlog-throttle.
const BATCH_SIZE = 5;
// A claimed-but-not-delivered row is considered abandoned (worker crashed/
// restarted mid-delivery) after this long and becomes reclaimable. Comfortably
// longer than the worst-case SMTP timeout.
const LEASE_TIMEOUT_MS = 5 * 60_000;

// A signed-PDF render that fails for one of these reasons is treated as an
// out-of-memory / Chromium-crash event: the lease is released (emailed_at stays
// NULL) so the row is retried on a later sweep, instead of being marked
// delivered without a PDF. Case-insensitive; "OOM" also matches "oom".
const OOM_PATTERN = /out of memory|OOM|Chromium|page crashed|Protocol error|Target closed/i;
// Consecutive OOM/crash counter across sweeps. Reset to 0 on the next successful
// render. When it reaches 5 we emit a single CRITICAL alarm log so a super_admin
// can intervene (e.g. the instance is persistently memory-starved). It does NOT
// stop the worker — delivery keeps retrying.
let oomStreak = 0;

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

/**
 * Lightweight delivery worker for signed contracts produced by the in-app /
 * onboarding signing flow (finalizeSign leaves emailed_at = NULL). For each
 * pending row the worker:
 *   1. Claims an exclusive lease (delivery_claimed_at) so concurrent instances
 *      never double-deliver.
 *   2. Renders + uploads the signed PDF via ensureSignedContractPdf() and sets
 *      agents.contractUrl. This is the ONLY place headless Chromium runs for the
 *      in-app / onboarding signing flow — never on a request path.
 *   3. Sets contractStartDate / contractEndDate on the agent row.
 *   4. Sends a link-only notification email to the signer (portal login URL)
 *      and every active admin (admin signed-contracts panel URL).
 *   5. Marks emailed_at = now, permanently excluding the row from future sweeps.
 *
 * PDF rendering runs HERE, off the request path, by design. Chromium is
 * memory-heavy and, when launched inside an HTTP handler, OOM-killed the 512MB
 * autoscale container while a sign POST was in-flight — the edge proxy then
 * returned its own HTML "403 Forbidden" instead of completing the request.
 * Moving the render into this background sweep keeps every request path free of
 * Chromium. If a render still OOMs/crashes here (OOM_PATTERN), the lease is
 * released and emailed_at stays NULL so the row is retried on a later sweep —
 * the instance restarting mid-render never permanently loses delivery.
 */
export async function deliverPendingSignedContracts(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const leaseExpiry = new Date(Date.now() - LEASE_TIMEOUT_MS);
    // A row is a delivery candidate when it has never been delivered
    // (emailed_at IS NULL), was signed recently, and is either unclaimed or its
    // claim lease has expired (the previous attempt crashed mid-flight).
    const reclaimable = or(
      isNull(signedContractsTable.deliveryClaimedAt),
      lt(signedContractsTable.deliveryClaimedAt, leaseExpiry),
    );
    const pending = await db.select({
      id: signedContractsTable.id,
      signingSessionId: signedContractsTable.signingSessionId,
      templateId: signedContractsTable.templateId,
      agentId: signedContractsTable.agentId,
      signerEmail: signedContractsTable.signerEmail,
      signerName: signedContractsTable.signerName,
      signedAt: signedContractsTable.signedAt,
    })
      .from(signedContractsTable)
      .where(and(isNull(signedContractsTable.emailedAt), gt(signedContractsTable.signedAt, cutoff), reclaimable))
      .orderBy(asc(signedContractsTable.signedAt))
      .limit(BATCH_SIZE);

    if (pending.length === 0) return;

    const portalUrl = `${getAppBaseUrl()}/login`;
    const adminContractUrl = `${getAppBaseUrl()}/admin/signed-contracts`;

    for (const row of pending) {
      // Atomically claim a lease on the row so concurrent workers / instances
      // don't deliver twice. The lease (delivery_claimed_at) is DISTINCT from
      // the delivered marker (emailed_at): we only set the lease here, and set
      // emailed_at after delivery succeeds. A crash between the two leaves the
      // lease to expire and the row to be reclaimed — delivery is never
      // permanently lost.
      const claimed = await db.update(signedContractsTable)
        .set({ deliveryClaimedAt: new Date() })
        .where(and(
          eq(signedContractsTable.id, row.id),
          isNull(signedContractsTable.emailedAt),
          or(isNull(signedContractsTable.deliveryClaimedAt), lt(signedContractsTable.deliveryClaimedAt, leaseExpiry)),
        ))
        .returning({ id: signedContractsTable.id });
      if (claimed.length === 0) continue;

      // Render + upload the signed PDF (and hydrate agents.contractUrl) BEFORE
      // marking the row delivered, so by the time the notification emails go out
      // the download is ready. This is the single Chromium launch site for this
      // flow and it lives off the request path. On an OOM/crash we release the
      // lease and leave emailed_at NULL for a later retry; a non-OOM render error
      // is handled the same way (retry) but without the OOM streak bookkeeping.
      try {
        await ensureSignedContractPdf(row.id);
        oomStreak = 0;
      } catch (pdfErr) {
        const msg = String((pdfErr as any)?.message || pdfErr || "");
        if (OOM_PATTERN.test(msg)) {
          oomStreak++;
          console.warn(`[contract-pdf] OOM/crash detected for row=${row.id}, releasing lease for retry`);
          if (oomStreak >= 5) {
            console.error("[contract-pdf] CRITICAL: 5 consecutive OOMs, manual intervention needed");
          }
        } else {
          console.error(`[SIGNED-DELIVERY] PDF render failed for signed_contract ${row.id}, releasing lease for retry:`, pdfErr);
        }
        // Both OOM and non-OOM render errors: keep emailed_at NULL and release
        // the lease so the row is retried on a later sweep (still bounded by
        // RECENT_WINDOW_DAYS). Do not throw — the sweep continues to the next row.
        try {
          await db.update(signedContractsTable)
            .set({ deliveryClaimedAt: null })
            .where(and(eq(signedContractsTable.id, row.id), isNull(signedContractsTable.emailedAt)));
        } catch (resetErr) {
          console.error(`[SIGNED-DELIVERY] failed to release lease for signed_contract ${row.id}:`, resetErr);
        }
        continue;
      }

      try {
        const [template] = await db.select({ name: contractTemplatesTable.name, language: contractTemplatesTable.language })
          .from(contractTemplatesTable)
          .where(eq(contractTemplatesTable.id, row.templateId));
        const templateName = template?.name || "Contract";

        // Populate start/end dates on the agent row (date fields only — no PDF
        // needed here). agents.contractUrl is set lazily inside
        // ensureSignedContractPdf() on the first download request.
        if (row.agentId) {
          const startDate = row.signedAt ?? new Date();
          const endDate = new Date(startDate);
          endDate.setFullYear(endDate.getFullYear() + 1);
          await db.update(agentsTable)
            .set({ contractStartDate: startDate, contractEndDate: endDate })
            .where(eq(agentsTable.id, row.agentId));
        }

        const signerEmail = (row.signerEmail || "").trim();
        if (signerEmail && EMAIL_RE.test(signerEmail)) {
          const email = await buildSignedContractEmail({
            signerName: row.signerName,
            templateName,
            portalUrl,
            language: template?.language,
          });
          await sendEmail(signerEmail, email);
        }

        const adminEmails = await getAdminRecipientEmails(signerEmail);
        if (adminEmails.length > 0) {
          const adminEmail = await buildSignedContractAdminEmail({
            signerName: row.signerName,
            signerEmail,
            templateName,
            adminContractUrl,
          });
          for (const to of adminEmails) {
            try {
              await sendEmail(to, adminEmail);
            } catch (adminErr) {
              console.error(`[SIGNED-DELIVERY] failed to email admin ${to} for signed_contract ${row.id}:`, adminErr);
            }
          }
        }

        // Mark delivered only now that the dates were updated and the signer
        // email was sent. emailed_at is the permanent "done" flag and excludes
        // the row from all future sweeps. Admin failures are logged above but
        // do not block this — admins are best-effort copies.
        await db.update(signedContractsTable)
          .set({ emailedAt: new Date() })
          .where(eq(signedContractsTable.id, row.id));

        console.log(`[SIGNED-DELIVERY] delivered signed_contract ${row.id} (signer=${signerEmail || "none"}, admins=${adminEmails.length})`);
      } catch (err) {
        // Release the lease so the row is retried on the next sweep (still bounded
        // by RECENT_WINDOW_DAYS). emailed_at stays NULL, so a partial failure
        // before the signer email never marks the row delivered. The signer email
        // is the last throwing step, so retries do not re-send a successful one.
        console.error(`[SIGNED-DELIVERY] delivery failed for signed_contract ${row.id}, releasing lease for retry:`, err);
        try {
          await db.update(signedContractsTable)
            .set({ deliveryClaimedAt: null })
            .where(and(eq(signedContractsTable.id, row.id), isNull(signedContractsTable.emailedAt)));
        } catch (resetErr) {
          console.error(`[SIGNED-DELIVERY] failed to release lease for signed_contract ${row.id}:`, resetErr);
        }
      }
    }
  } catch (err) {
    console.error("[SIGNED-DELIVERY] sweep error:", err);
  }
}

let deliveryInterval: ReturnType<typeof setInterval> | null = null;
// Re-entrancy guard: a sweep can outlast the interval in pathological cases
// (many SMTP calls), so never let two sweeps run concurrently on the same
// instance.
let sweeping = false;

async function runSweep(): Promise<void> {
  if (sweeping) return;
  sweeping = true;
  try {
    await deliverPendingSignedContracts();
  } finally {
    sweeping = false;
  }
}

export function startSignedContractDeliveryWorker(intervalMs = DELIVERY_INTERVAL_MS): void {
  if (deliveryInterval) return;
  console.log(`[SIGNED-DELIVERY] Worker started, running every ${intervalMs / 1000}s`);
  setTimeout(() => { runSweep(); }, 15000);
  deliveryInterval = setInterval(() => { runSweep(); }, intervalMs);
}
