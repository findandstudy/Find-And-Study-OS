import { Router, type IRouter } from "express";
import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, applicationsTable, portalSubmissionsTable, portalUniversitiesTable } from "@workspace/db";
import { buildPageMeta, parsePaginationParams } from "@workspace/pagination";
import { adapterMetadata } from "@workspace/portal-adapters";
import { isAgentRole } from "@workspace/roles";
import { logAudit, requireAuth, requireRole } from "../lib/auth";
import { getAgentVisibleIds } from "../lib/agentVisibility";
import { ADMIN_ROLES, STAFF_ROLES } from "../lib/roles";
import { getValidated, validate } from "../middlewares/validate";
import {
  claimById,
  claimNext,
  releaseStale,
  heartbeat,
  requeueStuck,
  buildStudentProfile,
  runSubmission,
  writebackResult,
  type ClaimedSubmission,
} from "@workspace/portal-runner";
import { batchPortalCredentialKeys, resolvePortalCreds } from "../lib/portalCreds.js";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Shared schemas
// ---------------------------------------------------------------------------
const idParamsSchema = z.object({ id: z.coerce.number().int().positive() });
type IdSchemas = { params: typeof idParamsSchema };

// ---------------------------------------------------------------------------
// POST /applications/:appId/portal-submissions — Enqueue
// ---------------------------------------------------------------------------
const enqueueParamsSchema = z.object({ appId: z.coerce.number().int().positive() });
const enqueueBodySchema = z.object({
  universityKey: z.string().min(1),
  mode: z.enum(["dry", "real"]),
  confirm: z.boolean().optional(),
});
type EnqueueSchemas = { params: typeof enqueueParamsSchema; body: typeof enqueueBodySchema };

router.post(
  "/applications/:appId/portal-submissions",
  requireAuth,
  requireRole(...STAFF_ROLES, ...ADMIN_ROLES),
  validate({ params: enqueueParamsSchema, body: enqueueBodySchema }),
  async (req, res): Promise<void> => {
    const { appId } = getValidated<EnqueueSchemas>(req).params;
    const { universityKey, mode, confirm } = getValidated<EnqueueSchemas>(req).body;

    if (mode === "real" && !confirm) {
      res.status(422).json({
        error: "CONFIRM_REQUIRED",
        message: "Set confirm:true to submit in real mode",
      });
      return;
    }

    const user = req.user!;

    const [app] = await db
      .select({ id: applicationsTable.id, studentId: applicationsTable.studentId })
      .from(applicationsTable)
      .where(and(eq(applicationsTable.id, appId), isNull(applicationsTable.deletedAt)));

    if (!app) {
      res.status(404).json({ error: "NOT_FOUND" });
      return;
    }

    const meta = adapterMetadata();
    const universityName = meta.find((m) => m.key === universityKey)?.label ?? universityKey;

    const [row] = await db
      .insert(portalSubmissionsTable)
      .values({
        applicationId: app.id,
        studentId: app.studentId,
        universityKey,
        universityName,
        mode,
        status: "queued",
        enqueuedBy: user.id,
      })
      .returning();

    await logAudit(
      user.id,
      "enqueue_portal_submission",
      "portal_submission",
      row.id,
      { universityKey, mode },
      req.ip,
    );

    res.status(201).json(row);
  },
);

// ---------------------------------------------------------------------------
// GET /portal-submissions — List with filters + pagination + isolation
// ---------------------------------------------------------------------------
const listQuerySchema = z.object({
  applicationId: z.coerce.number().int().positive().optional(),
  status: z
    .enum(["queued", "running", "submitted", "already_exists", "program_missing", "failed", "canceled"])
    .optional(),
  mode: z.enum(["dry", "real"]).optional(),
});
type ListSchemas = { query: typeof listQuerySchema };

router.get(
  "/portal-submissions",
  requireAuth,
  validate({ query: listQuerySchema }),
  async (req, res): Promise<void> => {
    const user = req.user!;
    const { applicationId, status, mode } = getValidated<ListSchemas>(req).query;
    const pageParams = parsePaginationParams(req, { defaultLimit: 20, maxLimit: "small" });

    // Agent isolation: restrict to applications visible to this user
    let visibleAppIds: number[] | null = null;
    if (isAgentRole(user.role)) {
      const visibleAgentIds = await getAgentVisibleIds(user.id, user.role);
      if (visibleAgentIds.length > 0) {
        const apps = await db
          .select({ id: applicationsTable.id })
          .from(applicationsTable)
          .where(
            and(
              isNull(applicationsTable.deletedAt),
              inArray(applicationsTable.agentId, visibleAgentIds),
            ),
          );
        visibleAppIds = apps.map((a) => a.id);
        if (visibleAppIds.length === 0) {
          res.json({ data: [], ...buildPageMeta(0, pageParams) });
          return;
        }
      }
    }

    const where = and(
      isNull(portalSubmissionsTable.deletedAt),
      applicationId !== undefined ? eq(portalSubmissionsTable.applicationId, applicationId) : undefined,
      status !== undefined ? eq(portalSubmissionsTable.status, status) : undefined,
      mode !== undefined ? eq(portalSubmissionsTable.mode, mode) : undefined,
      visibleAppIds !== null ? inArray(portalSubmissionsTable.applicationId, visibleAppIds) : undefined,
    );

    const [{ total }] = await db
      .select({ total: count() })
      .from(portalSubmissionsTable)
      .where(where);

    const rows = await db
      .select()
      .from(portalSubmissionsTable)
      .where(where)
      .orderBy(desc(portalSubmissionsTable.createdAt))
      .limit(pageParams.limit)
      .offset(pageParams.offset);

    res.json({ data: rows, ...buildPageMeta(total, pageParams) });
  },
);

// ---------------------------------------------------------------------------
// GET /portal-submissions/:id
// ---------------------------------------------------------------------------
router.get(
  "/portal-submissions/:id",
  requireAuth,
  validate({ params: idParamsSchema }),
  async (req, res): Promise<void> => {
    const user = req.user!;
    const { id } = getValidated<IdSchemas>(req).params;

    const [row] = await db
      .select()
      .from(portalSubmissionsTable)
      .where(and(eq(portalSubmissionsTable.id, id), isNull(portalSubmissionsTable.deletedAt)));

    if (!row) {
      res.status(404).json({ error: "NOT_FOUND" });
      return;
    }

    // Isolation check for agent roles
    if (isAgentRole(user.role)) {
      const visibleAgentIds = await getAgentVisibleIds(user.id, user.role);
      if (visibleAgentIds.length > 0) {
        const [app] = await db
          .select({ agentId: applicationsTable.agentId })
          .from(applicationsTable)
          .where(eq(applicationsTable.id, row.applicationId));
        if (!app || app.agentId == null || !visibleAgentIds.includes(app.agentId)) {
          res.status(404).json({ error: "NOT_FOUND" });
          return;
        }
      }
    }

    res.json(row);
  },
);

// ---------------------------------------------------------------------------
// POST /portal-submissions/:id/retry
// ---------------------------------------------------------------------------
router.post(
  "/portal-submissions/:id/retry",
  requireAuth,
  requireRole(...STAFF_ROLES, ...ADMIN_ROLES),
  validate({ params: idParamsSchema }),
  async (req, res): Promise<void> => {
    const user = req.user!;
    const { id } = getValidated<IdSchemas>(req).params;

    const [row] = await db
      .select({ id: portalSubmissionsTable.id, status: portalSubmissionsTable.status })
      .from(portalSubmissionsTable)
      .where(and(eq(portalSubmissionsTable.id, id), isNull(portalSubmissionsTable.deletedAt)));

    if (!row) {
      res.status(404).json({ error: "NOT_FOUND" });
      return;
    }

    if (row.status !== "failed" && row.status !== "canceled") {
      res.status(409).json({
        error: "NOT_RETRYABLE",
        message: "Only failed or canceled submissions can be retried",
      });
      return;
    }

    await db
      .update(portalSubmissionsTable)
      .set({ status: "queued", lockedAt: null, lockedBy: null, error: null, attempts: 0 })
      .where(eq(portalSubmissionsTable.id, id));

    await logAudit(user.id, "retry_portal_submission", "portal_submission", id, {}, req.ip);

    res.json({ ok: true });
  },
);

// ---------------------------------------------------------------------------
// POST /portal-submissions/:id/cancel
// ---------------------------------------------------------------------------
router.post(
  "/portal-submissions/:id/cancel",
  requireAuth,
  requireRole(...STAFF_ROLES, ...ADMIN_ROLES),
  validate({ params: idParamsSchema }),
  async (req, res): Promise<void> => {
    const user = req.user!;
    const { id } = getValidated<IdSchemas>(req).params;

    const [row] = await db
      .select({ id: portalSubmissionsTable.id, status: portalSubmissionsTable.status })
      .from(portalSubmissionsTable)
      .where(and(eq(portalSubmissionsTable.id, id), isNull(portalSubmissionsTable.deletedAt)));

    if (!row) {
      res.status(404).json({ error: "NOT_FOUND" });
      return;
    }

    if (row.status !== "queued" && row.status !== "running") {
      res.status(409).json({
        error: "NOT_CANCELABLE",
        message: "Only queued or running submissions can be canceled",
      });
      return;
    }

    await db
      .update(portalSubmissionsTable)
      .set({ status: "canceled" })
      .where(eq(portalSubmissionsTable.id, id));

    await logAudit(user.id, "cancel_portal_submission", "portal_submission", id, {}, req.ip);

    res.json({ ok: true });
  },
);

// ---------------------------------------------------------------------------
// Process-once helper — sequential, eşzaman 1 guaranteed by mutex flag.
// ---------------------------------------------------------------------------

/** Module-level mutex: prevents concurrent manual process runs. */
let _processMutex = false;

/** Submissions running longer than this are candidates for stuck-reset. */
const STUCK_THRESHOLD_MS = 10 * 60_000; // 10 minutes

/** Inline process timeout: responds early and requeues if work exceeds this. */
const INLINE_TIMEOUT_MS = 50_000; // 50 seconds

/**
 * Looks up the adapterKey for a universityKey from the portal_universities table.
 * Falls back to universityKey itself when the row isn't found (backward compat).
 */
async function lookupAdapterKey(universityKey: string): Promise<string> {
  try {
    const [row] = await db
      .select({ adapterKey: portalUniversitiesTable.adapterKey })
      .from(portalUniversitiesTable)
      .where(
        and(
          eq(portalUniversitiesTable.universityKey, universityKey),
          isNull(portalUniversitiesTable.deletedAt),
        ),
      )
      .limit(1);
    return row?.adapterKey ?? universityKey;
  } catch {
    return universityKey;
  }
}

interface ProcessSingleResult {
  id: number;
  status: "submitted" | "already_exists" | "program_missing" | "failed" | "dry_run" | "skipped" | "requeued";
  error?: string;
  message?: string;
}

/**
 * Processes a pre-claimed submission with a heartbeat and hard inline timeout.
 *
 * Heartbeat (every 20s): keeps locked_at fresh so the periodic stuck-reset
 * job never fires while work is in flight.
 *
 * Timeout (INLINE_TIMEOUT_MS): if the run takes longer than the inline limit
 * the row is atomically requeued (locked_by guard prevents clobbering if
 * drain-once reclaims the row before we write back) and the caller receives
 * { status: "requeued" }.  The background browser process continues; when it
 * eventually calls writebackResult the locked_by guard makes the write a
 * no-op on a re-claimed row.
 */
async function runWithTimeout(
  sub: ClaimedSubmission,
  workerId: string,
  timeoutMs = INLINE_TIMEOUT_MS,
): Promise<ProcessSingleResult> {
  const hbInterval = setInterval(() => {
    heartbeat(sub.id, workerId).catch(() => {});
  }, 20_000);

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;

  const workPromise = (async (): Promise<ProcessSingleResult> => {
    const profileResult = await buildStudentProfile(sub.id);
    const adapterKey = await lookupAdapterKey(sub.universityKey);

    let creds: { user: string; password: string } | undefined;
    try {
      creds = await resolvePortalCreds(sub.universityKey, adapterKey);
    } catch (credsErr) {
      if (sub.mode === "real") throw credsErr;
      // dry mode: missing creds → adapter login will fail and be caught
    }

    const runResult = await runSubmission(
      sub,
      profileResult.profile,
      profileResult.files,
      profileResult.tempDir,
      creds,
    );
    // Enrich resultJson with doc-slot info so skip reasons are surfaced in the UI
    runResult.meta["filledSlots"]  = profileResult.filledSlots;
    runResult.meta["missingSlots"] = profileResult.missingSlots;
    await writebackResult(sub.id, runResult, undefined, workerId);

    const status: ProcessSingleResult["status"] = runResult.meta["dryRun"]
      ? "dry_run"
      : runResult.result.submitted      ? "submitted"
      : runResult.result.alreadyExists  ? "already_exists"
      : runResult.result.programMissing ? "program_missing"
      : "failed";

    return { id: sub.id, status };
  })();

  // Attach a no-op catch so that if the timeout fires first and the background
  // work eventually rejects, we don't get an UnhandledPromiseRejection.
  workPromise.catch(() => {});

  const timeoutPromise = new Promise<ProcessSingleResult>((resolve) => {
    timeoutHandle = setTimeout(async () => {
      timedOut = true;
      try {
        const requeued = await requeueStuck(sub.id, workerId);
        if (requeued) {
          console.log(
            `[portal-process] #${sub.id} timed out after ${timeoutMs}ms — requeued for drain-once`,
          );
        }
      } catch { /* best-effort */ }
      resolve({
        id: sub.id,
        status: "requeued",
        message: `İşlem ${Math.round(timeoutMs / 1000)}sn'yi aştı, drain-once tarafından tamamlanacak`,
      });
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([workPromise, timeoutPromise]);
    clearTimeout(timeoutHandle);
    return result;
  } catch (err) {
    clearTimeout(timeoutHandle);
    if (timedOut) {
      // Timeout already resolved; background work threw after the race settled.
      // writebackResult's locked_by guard prevents any DB clobbering.
      return { id: sub.id, status: "requeued" };
    }
    const msg = err instanceof Error ? err.message : String(err);
    await writebackResult(sub.id, null, msg, workerId);
    return { id: sub.id, status: "failed", error: msg };
  } finally {
    clearInterval(hbInterval);
  }
}

/**
 * Claims and processes a single submission by id.
 * Returns "skipped" if the row cannot be claimed (not queued / exhausted / locked).
 */
async function processSingle(
  submissionId: number,
  workerId: string,
): Promise<ProcessSingleResult> {
  const sub = await claimById(submissionId, workerId);
  if (!sub) return { id: submissionId, status: "skipped" };
  return runWithTimeout(sub, workerId);
}

// ---------------------------------------------------------------------------
// POST /portal-submissions/process-queued
// Processes ALL queued submissions sequentially; eşzaman 1.
// Runs releaseStale first, then drains with per-submission timeout + heartbeat.
// ---------------------------------------------------------------------------
router.post(
  "/portal-submissions/process-queued",
  requireAuth,
  requireRole(...STAFF_ROLES, ...ADMIN_ROLES),
  async (req, res): Promise<void> => {
    if (_processMutex) {
      res.status(409).json({
        error: "ALREADY_RUNNING",
        message: "A portal process run is already in progress on this instance",
      });
      return;
    }

    const user = req.user!;
    const workerId = `api-manual-${user.id}-${Date.now()}`;

    _processMutex = true;
    const results: ProcessSingleResult[] = [];

    try {
      // Release stale locks first (crash recovery: inline requests that died
      // without requeuing leave orphan 'running' rows).
      const staleIds = await releaseStale(STUCK_THRESHOLD_MS);
      if (staleIds.length > 0) {
        console.log(
          `[portal-process-queued] Released ${staleIds.length} stale submission(s): ${staleIds.join(",")}`,
        );
      }

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const sub = await claimNext(workerId);
        if (!sub) break;

        console.log(
          `[portal-process] Processing #${sub.id} uni=${sub.universityKey} mode=${sub.mode} attempt=${sub.attempts}/${sub.maxAttempts}`,
        );
        results.push(await runWithTimeout(sub, workerId));
      }
    } finally {
      _processMutex = false;
    }

    const processedCount = results.filter(
      (r) => r.status !== "skipped" && r.status !== "requeued",
    ).length;

    await logAudit(
      user.id,
      "process_portal_submissions",
      "portal_submission",
      undefined,
      {
        processed: processedCount,
        results: results.map((r) => ({ id: r.id, status: r.status })),
      },
      req.ip,
    );

    res.json({ processed: processedCount, results });
  },
);

// ---------------------------------------------------------------------------
// POST /portal-submissions/:id/process
// Processes a SINGLE submission by id; eşzaman 1.
// ---------------------------------------------------------------------------
router.post(
  "/portal-submissions/:id/process",
  requireAuth,
  requireRole(...STAFF_ROLES, ...ADMIN_ROLES),
  validate({ params: idParamsSchema }),
  async (req, res): Promise<void> => {
    if (_processMutex) {
      res.status(409).json({
        error: "ALREADY_RUNNING",
        message: "A portal process run is already in progress on this instance",
      });
      return;
    }

    const user = req.user!;
    const { id } = getValidated<IdSchemas>(req).params;
    const workerId = `api-manual-${user.id}-${Date.now()}`;

    // Verify the submission exists and is queued before acquiring mutex
    const [row] = await db
      .select({ id: portalSubmissionsTable.id, status: portalSubmissionsTable.status })
      .from(portalSubmissionsTable)
      .where(and(eq(portalSubmissionsTable.id, id), isNull(portalSubmissionsTable.deletedAt)));

    if (!row) {
      res.status(404).json({ error: "NOT_FOUND" });
      return;
    }

    if (row.status !== "queued") {
      res.status(409).json({
        error: "NOT_QUEUED",
        message: `Submission #${id} is ${row.status}, not queued`,
      });
      return;
    }

    _processMutex = true;

    try {
      const result = await processSingle(id, workerId);

      await logAudit(
        user.id,
        "process_portal_submission",
        "portal_submission",
        id,
        { status: result.status, error: result.error },
        req.ip,
      );

      res.json({ processed: result.status !== "skipped" && result.status !== "requeued" ? 1 : 0, results: [result] });
    } finally {
      _processMutex = false;
    }
  },
);

// ---------------------------------------------------------------------------
// POST /portal-submissions/reset-stuck
// Resets "running" submissions that have been locked longer than
// thresholdMinutes (default 10) back to "queued".
// Safe to call at any time (idempotent) — used by admin button + startup.
// ---------------------------------------------------------------------------
const resetStuckBodySchema = z.object({
  thresholdMinutes: z.number().int().positive().min(1).max(60).default(10),
});
type ResetStuckSchemas = { body: typeof resetStuckBodySchema };

router.post(
  "/portal-submissions/reset-stuck",
  requireAuth,
  requireRole(...STAFF_ROLES, ...ADMIN_ROLES),
  validate({ body: resetStuckBodySchema }),
  async (req, res): Promise<void> => {
    const user = req.user!;
    const { thresholdMinutes } = getValidated<ResetStuckSchemas>(req).body;
    const thresholdMs = thresholdMinutes * 60_000;

    const ids = await releaseStale(thresholdMs);

    if (ids.length > 0) {
      console.log(
        `[portal-stuck-reset] Manual reset: ${ids.length} submission(s) — ids: ${ids.join(",")}`,
      );
    }

    await logAudit(
      user.id,
      "reset_stuck_portal_submissions",
      "portal_submission",
      undefined,
      { thresholdMinutes, reset: ids.length, ids },
      req.ip,
    );

    res.json({ reset: ids.length, ids });
  },
);

// ---------------------------------------------------------------------------
// GET /university-portals
// Returns active portal universities that have credentials configured.
// Used by app-detail Submit dropdown — shows only credential-ready entries.
// ---------------------------------------------------------------------------
router.get("/university-portals", requireAuth, async (_req, res): Promise<void> => {
  const [dbCredKeys, unis] = await Promise.all([
    batchPortalCredentialKeys(),
    db
      .select({
        universityKey: portalUniversitiesTable.universityKey,
        universityName: portalUniversitiesTable.universityName,
        adapterKey: portalUniversitiesTable.adapterKey,
      })
      .from(portalUniversitiesTable)
      .where(
        and(
          eq(portalUniversitiesTable.isActive, true),
          isNull(portalUniversitiesTable.deletedAt),
        ),
      ),
  ]);

  function envHasKey(k: string): boolean {
    const K = k.toUpperCase().replace(/-/g, "_");
    return !!(
      (process.env[`${K}_EMAIL`] || process.env[`${K}_USER`]) &&
      process.env[`${K}_PASSWORD`]
    );
  }

  // --- Step 1: DB-registered universities with credentials ---
  const seenAdapterKeys = new Set<string>();
  const result: { key: string; label: string; adapterKey: string; hasCredentials: boolean }[] = [];

  for (const { universityKey, universityName, adapterKey } of unis) {
    const hasCredentials =
      dbCredKeys.has(adapterKey) || dbCredKeys.has(universityKey) || envHasKey(adapterKey);
    if (hasCredentials) {
      result.push({ key: universityKey, label: universityName, adapterKey, hasCredentials: true });
      seenAdapterKeys.add(adapterKey);
    }
  }

  // --- Step 2: Registry adapters with credentials NOT yet in the DB list ---
  // Covers the case where portal_credentials has the key but portal_universities
  // hasn't been seeded yet (e.g. fresh PROD deploy).
  for (const { key: aKey, label } of adapterMetadata()) {
    if (seenAdapterKeys.has(aKey)) continue;
    const hasCredentials = dbCredKeys.has(aKey) || envHasKey(aKey);
    if (hasCredentials) {
      result.push({ key: aKey, label, adapterKey: aKey, hasCredentials: true });
    }
  }

  res.json(result);
});

// ---------------------------------------------------------------------------
// Background job: periodic stuck-reset
// ---------------------------------------------------------------------------

/**
 * Starts a setInterval that periodically resets stuck portal_submissions.
 * Call once at api-server startup (safe on every instance — releaseStale is
 * idempotent and the DB UPDATE is atomic).
 */
export function startPortalStuckReset(intervalMs = 5 * 60_000): void {
  const run = (): void => {
    releaseStale(STUCK_THRESHOLD_MS)
      .then((ids) => {
        if (ids.length > 0) {
          console.log(
            `[portal-stuck-reset] Auto-reset ${ids.length} submission(s): ${ids.join(",")}`,
          );
        }
      })
      .catch((err) => {
        console.error("[portal-stuck-reset] Error:", err);
      });
  };
  setInterval(run, intervalMs);
  console.log(
    `[portal-stuck-reset] Started — interval=${intervalMs}ms threshold=${STUCK_THRESHOLD_MS}ms`,
  );
}

export default router;
