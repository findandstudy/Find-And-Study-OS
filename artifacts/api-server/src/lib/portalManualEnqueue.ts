/**
 * portalManualEnqueue.ts
 *
 * Shared enqueue loop used by every "manually queue applications to the
 * portal automation worker" surface (admin Manual Submit dialog, Applications
 * list bulk "Run" action, ...). NEVER duplicate this loop — the
 * university/adapter is always resolved from the application's own record
 * via resolvePortalRouting, never hardcoded, and the duplicate guard is the
 * single source of truth for "already queued/running".
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, applicationsTable, portalSubmissionsTable } from "@workspace/db";
import { resolvePortalRouting } from "./portalAutoTrigger.js";

export type PortalEnqueueSkipReason = "NOT_FOUND" | "NO_PORTAL" | "ALREADY_QUEUED";

export interface PortalEnqueueQueuedRow {
  applicationId: number;
  submissionId: number;
  universityKey: string;
}

export interface PortalEnqueueSkippedRow {
  applicationId: number;
  reason: PortalEnqueueSkipReason;
  submissionId?: number;
}

export interface PortalEnqueueResult {
  queued: PortalEnqueueQueuedRow[];
  skipped: PortalEnqueueSkippedRow[];
}

/**
 * Enqueues portal_submissions rows (status="queued") for the given
 * application IDs, resolving each application's active portal
 * university/adapter via resolvePortalRouting. Applications without an
 * active portal mapping are reported back with reason "NO_PORTAL" (adapter
 * missing) instead of being silently dropped. Applications with an existing
 * queued/running submission for the same university are skipped as
 * "ALREADY_QUEUED".
 */
export async function enqueuePortalSubmissions(opts: {
  applicationIds: number[];
  mode: "dry" | "real";
  userId: number;
}): Promise<PortalEnqueueResult> {
  const uniqueIds = [...new Set(opts.applicationIds)];

  const apps = await db
    .select({
      id: applicationsTable.id,
      studentId: applicationsTable.studentId,
      universityId: applicationsTable.universityId,
      universityName: applicationsTable.universityName,
    })
    .from(applicationsTable)
    .where(and(inArray(applicationsTable.id, uniqueIds), isNull(applicationsTable.deletedAt)));

  const appMap = new Map(apps.map((a) => [a.id, a]));

  const queued: PortalEnqueueQueuedRow[] = [];
  const skipped: PortalEnqueueSkippedRow[] = [];

  for (const appId of uniqueIds) {
    const app = appMap.get(appId);
    if (!app) {
      skipped.push({ applicationId: appId, reason: "NOT_FOUND" });
      continue;
    }

    const routing = await resolvePortalRouting({
      universityId: app.universityId,
      universityName: app.universityName,
    });
    if (!routing) {
      skipped.push({ applicationId: appId, reason: "NO_PORTAL" });
      continue;
    }
    const { portalUni, target } = routing;

    // Duplicate guard: an active (queued/running) submission for this
    // application x university must not be re-queued.
    const [existing] = await db
      .select({ id: portalSubmissionsTable.id })
      .from(portalSubmissionsTable)
      .where(
        and(
          eq(portalSubmissionsTable.applicationId, appId),
          eq(portalSubmissionsTable.universityKey, portalUni.universityKey),
          inArray(portalSubmissionsTable.status, ["queued", "running"]),
          isNull(portalSubmissionsTable.deletedAt),
        ),
      )
      .limit(1);

    if (existing) {
      skipped.push({ applicationId: appId, reason: "ALREADY_QUEUED", submissionId: existing.id });
      continue;
    }

    const [row] = await db
      .insert(portalSubmissionsTable)
      .values({
        applicationId: appId,
        studentId: app.studentId,
        universityKey: portalUni.universityKey,
        universityName: target ? target.universityName : portalUni.universityName,
        mode: opts.mode,
        status: "queued",
        enqueuedBy: opts.userId,
        // manual:true marks this row as a deliberate user-selected submission
        // (Applications bulk "Run" action / admin Manual Submit dialog — the
        // only two callers of this shared enqueue loop). claimNext() uses this
        // flag to bypass the trigger-stage and autoProcess claim gates, which
        // exist only to scope AUTOMATIC/scheduled processing.
        meta: {
          manual: true,
          ...(target
            ? {
                targetCatalogUniversityId: target.catalogUniversityId,
                targetUniversityName: target.universityName,
                routedViaAggregator: portalUni.universityKey,
              }
            : {}),
        },
      })
      .returning({ id: portalSubmissionsTable.id });

    queued.push({ applicationId: appId, submissionId: row.id, universityKey: portalUni.universityKey });
  }

  return { queued, skipped };
}
