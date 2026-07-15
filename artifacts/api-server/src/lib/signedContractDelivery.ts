import { db, signedContractsTable, contractTemplatesTable, agentsTable } from "@workspace/db";
import { and, eq, isNull, isNotNull, gt, lt, or, asc } from "drizzle-orm";
import { buildSignedContractEmail, sendEmail, getAppBaseUrl } from "./email";
import { ensureSignedContractPdf } from "./signContract";
import { dispatchNotification } from "./notificationDispatcher";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// How often the delivery sweep runs. Delivery is best-effort and not latency
// sensitive — a sub-minute cadence is plenty for an agent who has just signed.
const DELIVERY_INTERVAL_MS = 30_000;
// Only deliver recently-signed contracts. This guards against a first-boot
// backfill flood: any historical rows whose link email failed long ago
// (emailed_at IS NULL) stay untouched, while freshly-signed rows are picked up
// within one sweep.
const RECENT_WINDOW_DAYS = 3;
// Bound the primary sweep per tick. Each claimed row now also renders one PDF
// (serialized via withRenderLock inside ensureSignedContractPdf), so this also
// caps concurrent render pressure on the instance.
const BATCH_SIZE = 5;
// Legacy-row PDF backfill batch. Deliberately smaller than BATCH_SIZE and run
// AFTER the primary sweep so it never delays freshly-signed deliveries and
// drains a large historical backlog gradually instead of overwhelming a
// memory-constrained instance.
const BACKFILL_BATCH_SIZE = 3;
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
 *   4. Sends a link-only notification email to the signer (portal login URL).
 *   5. Fires contract.signed via the notification-rule system (in_app + email
 *      to roles as configured in Settings > Notification Rules).
 *   6. Marks emailed_at = now, permanently excluding the row from future sweeps.
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
    const adminContractUrl = `${getAppBaseUrl()}/admin/contracts`;

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

        // Notify admins/super_admins via the notification-rule system (respects
        // Settings > Notification Rules > Contracts > Contract Signed channels/active).
        // This replaces the previous hardcoded buildSignedContractAdminEmail loop.
        (async () => {
          try {
            await dispatchNotification({
              event: "contract.signed",
              title: "Contract Signed",
              body: `${row.signerName || signerEmail || "A signer"} signed "${templateName}".`,
              templateVars: {
                signerName: row.signerName || "",
                signerEmail,
                contractName: templateName,
                contractLink: adminContractUrl,
              },
            });
          } catch (e) { console.error(`[SIGNED-DELIVERY] contract.signed dispatch failed for signed_contract ${row.id}:`, e); }
        })();

        // Mark delivered only now that the dates were updated and the signer
        // email was sent. emailed_at is the permanent "done" flag and excludes
        // the row from all future sweeps. The contract.signed dispatch is
        // fire-and-forget so admin notification failures never block delivery.
        await db.update(signedContractsTable)
          .set({ emailedAt: new Date() })
          .where(eq(signedContractsTable.id, row.id));

        console.log(`[SIGNED-DELIVERY] delivered signed_contract ${row.id} (signer=${signerEmail || "none"})`);
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

/**
 * Backfill for legacy signed contracts that were delivered (emailed_at IS NOT
 * NULL) BEFORE PDF rendering moved into this worker, so they never got a
 * pdf_object_key. For each such row we ONLY render + upload the PDF
 * (ensureSignedContractPdf also hydrates agents.contractUrl). We never re-send
 * any email and never touch emailed_at — these rows are already delivered.
 *
 * Runs at the tail of each sweep with a small batch so it never delays the
 * primary (freshly-signed) flow and drains a large historical backlog
 * gradually. The lease re-uses delivery_claimed_at: the primary sweep only ever
 * considers emailed_at IS NULL rows, so the two candidate sets are disjoint and
 * can never contend for the same row. No new column / migration is required.
 */
export async function backfillMissingSignedPdfs(): Promise<void> {
  try {
    const leaseExpiry = new Date(Date.now() - LEASE_TIMEOUT_MS);
    const reclaimable = or(
      isNull(signedContractsTable.deliveryClaimedAt),
      lt(signedContractsTable.deliveryClaimedAt, leaseExpiry),
    );
    const candidates = await db.select({ id: signedContractsTable.id })
      .from(signedContractsTable)
      .where(and(
        isNull(signedContractsTable.pdfObjectKey),
        isNotNull(signedContractsTable.emailedAt),
        reclaimable,
      ))
      .orderBy(asc(signedContractsTable.signedAt))
      .limit(BACKFILL_BATCH_SIZE);

    if (candidates.length === 0) return;

    for (const row of candidates) {
      // Atomically claim via delivery_claimed_at. Reusing this column is safe:
      // emailed rows are never primary-sweep candidates, so there is no contention.
      const claimed = await db.update(signedContractsTable)
        .set({ deliveryClaimedAt: new Date() })
        .where(and(
          eq(signedContractsTable.id, row.id),
          isNull(signedContractsTable.pdfObjectKey),
          isNotNull(signedContractsTable.emailedAt),
          or(isNull(signedContractsTable.deliveryClaimedAt), lt(signedContractsTable.deliveryClaimedAt, leaseExpiry)),
        ))
        .returning({ id: signedContractsTable.id });
      if (claimed.length === 0) continue;

      console.log(`[contract-pdf-backfill] start row=${row.id}`);
      try {
        // Render + upload only. ensureSignedContractPdf sets pdf_object_key
        // (compare-and-set) which permanently drops the row from this backfill
        // set; it does NOT email and does NOT touch emailed_at.
        await ensureSignedContractPdf(row.id);
        oomStreak = 0;
        console.log(`[contract-pdf-backfill] done row=${row.id}`);
      } catch (pdfErr) {
        const msg = String((pdfErr as any)?.message || pdfErr || "");
        if (OOM_PATTERN.test(msg)) {
          oomStreak++;
          console.warn(`[contract-pdf-backfill] OOM detected row=${row.id}, releasing lease for retry`);
          if (oomStreak >= 5) {
            console.error("[contract-pdf] CRITICAL: 5 consecutive OOMs, manual intervention needed");
          }
        } else {
          console.error(`[contract-pdf-backfill] render failed row=${row.id}, releasing lease for retry:`, pdfErr);
        }
        // Release the lease so the row is retried on a later sweep. emailed_at is
        // already set and must stay set, so the release guards only on the PDF
        // still being missing.
        try {
          await db.update(signedContractsTable)
            .set({ deliveryClaimedAt: null })
            .where(and(eq(signedContractsTable.id, row.id), isNull(signedContractsTable.pdfObjectKey)));
        } catch (resetErr) {
          console.error(`[contract-pdf-backfill] failed to release lease for row=${row.id}:`, resetErr);
        }
      }
    }
  } catch (err) {
    console.error("[contract-pdf-backfill] sweep error:", err);
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
    // Primary flow first (freshly-signed deliveries), then drain a small batch
    // of legacy rows that predate worker-side rendering. Both have their own
    // internal try/catch and never throw, so one can't starve the other.
    await deliverPendingSignedContracts();
    await backfillMissingSignedPdfs();
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
