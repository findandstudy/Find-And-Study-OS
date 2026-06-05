import { db, signedContractsTable, signingSessionsTable, contractTemplatesTable, agentsTable, usersTable } from "@workspace/db";
import { and, eq, isNull, inArray, gt, lt, or, asc } from "drizzle-orm";
import { ensureSignedContractPdf, readObjectBuffer } from "./signContract";
import { buildSignedContractEmail, buildSignedContractAdminEmail, sendEmail, getAppBaseUrl } from "./email";

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
// Bound the work per sweep so a backlog can never spawn many serialized Chromium
// renders back-to-back inside one tick.
const BATCH_SIZE = 5;
// A claimed-but-not-delivered row is considered abandoned (worker crashed/
// restarted mid-delivery) after this long, and becomes reclaimable. This is the
// crash-recovery mechanism: delivery state (emailed_at) is only set on success,
// so a stale lease is always safe to retry. Comfortably longer than the slowest
// serialized Chromium render.
const LEASE_TIMEOUT_MS = 5 * 60_000;

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

// Convert the canonical /objects/<entityId> key returned by uploadBuffer into a
// browser-openable URL served by GET /api/storage/objects/*path (requireAuth).
// This is the same URL shape admin-uploaded agent documents use, so the agent
// Account "Contract" tile and the staff Agents page both render it identically.
function objectKeyToStorageUrl(pdfObjectKey: string): string {
  let p = pdfObjectKey;
  if (p.startsWith("/objects/")) p = p.slice("/objects/".length);
  else if (p.startsWith("objects/")) p = p.slice("objects/".length);
  return `${getAppBaseUrl()}/api/storage/objects/${p}`;
}

/**
 * Out-of-band delivery of signed contracts produced by the in-app / onboarding
 * signing flow (finalizeSign leaves emailed_at = NULL). For each pending row:
 *   1. render the signed PDF (serialized headless Chromium via withRenderLock),
 *   2. email it as an ATTACHMENT to the signer AND every active admin,
 *   3. populate agents.contract_url so the signed PDF shows in the agent's
 *      Account "Contract" tile (and the staff Agents page) just like an
 *      admin-uploaded contract.
 * The whole step runs off the user-blocking request path, which is why it lives
 * in a worker rather than inside finalizeSign.
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

      try {
        const { pdfObjectKey } = await ensureSignedContractPdf(row.id);
        const pdfBuf = await readObjectBuffer(pdfObjectKey);
        if (!pdfBuf) throw new Error(`signed PDF bytes unreadable for signed_contract ${row.id}`);

        const [template] = await db.select({ name: contractTemplatesTable.name, language: contractTemplatesTable.language })
          .from(contractTemplatesTable)
          .where(eq(contractTemplatesTable.id, row.templateId));
        const templateName = template?.name || "Contract";

        const storageUrl = objectKeyToStorageUrl(pdfObjectKey);

        // Populate the agent's Contract tile (parity with admin-uploaded
        // contracts). Only set the start date if it is not already managed.
        if (row.agentId) {
          await db.update(agentsTable)
            .set({ contractUrl: storageUrl, contractStartDate: row.signedAt ?? new Date() })
            .where(eq(agentsTable.id, row.agentId));
        }

        const attachment = {
          filename: `contract-${row.signingSessionId}.pdf`,
          content: pdfBuf,
          contentType: "application/pdf",
        };
        const portalUrl = `${getAppBaseUrl()}/login`;

        const signerEmail = (row.signerEmail || "").trim();
        if (signerEmail && EMAIL_RE.test(signerEmail)) {
          const email = await buildSignedContractEmail({
            signerName: row.signerName,
            templateName,
            pdfDownloadUrl: storageUrl,
            portalUrl,
            language: template?.language,
          });
          await sendEmail(signerEmail, email, { attachments: [attachment] });
        }

        const adminEmails = await getAdminRecipientEmails(signerEmail);
        if (adminEmails.length > 0) {
          const adminEmail = await buildSignedContractAdminEmail({
            signerName: row.signerName,
            signerEmail,
            templateName,
            pdfDownloadUrl: storageUrl,
          });
          for (const to of adminEmails) {
            try {
              await sendEmail(to, adminEmail, { attachments: [attachment] });
            } catch (adminErr) {
              console.error(`[SIGNED-DELIVERY] failed to email admin ${to} for signed_contract ${row.id}:`, adminErr);
            }
          }
        }

        // Mark delivered only now that the PDF rendered, the tile was updated and
        // the signer email was sent. emailed_at is the permanent "done" flag and
        // excludes the row from all future sweeps. Admin failures are logged
        // above but do not block this — admins are best-effort copies.
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
// Re-entrancy guard: a sweep can outlast the interval (serialized Chromium
// renders), so never let two sweeps run concurrently on the same instance.
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
