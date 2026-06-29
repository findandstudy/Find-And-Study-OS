import { Router, type IRouter } from "express";
import { and, asc, count, desc, eq, ilike, inArray, isNull, notInArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  applicationsTable,
  studentsTable,
  portalSubmissionsTable,
  portalUniversitiesTable,
  portalProgramMappingTable,
  portalProgramCacheTable,
} from "@workspace/db";
import { findActivePortalUniversity } from "../lib/portalAutoTrigger.js";
import { buildPageMeta, parsePaginationParams } from "@workspace/pagination";
import {
  adapterMetadata,
  resolveAdapterByKey,
  setCredsOverride,
  clearCredsOverride,
} from "@workspace/portal-adapters";
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
  resolveAdapterKey,
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
// Manual submit — in-memory per-user rate limiter (short window).
// Prevents an admin from hammering the queue; counts /submit calls per user.
// ---------------------------------------------------------------------------
const MANUAL_SUBMIT_WINDOW_MS = 10_000;
const MANUAL_SUBMIT_MAX = 20;
const _manualSubmitHits = new Map<number, number[]>();

function manualSubmitRateLimited(userId: number): boolean {
  const now = Date.now();
  const recent = (_manualSubmitHits.get(userId) ?? []).filter(
    (t) => now - t < MANUAL_SUBMIT_WINDOW_MS,
  );
  recent.push(now);
  _manualSubmitHits.set(userId, recent);
  return recent.length > MANUAL_SUBMIT_MAX;
}

// ---------------------------------------------------------------------------
// POST /portal-automation/submit — manual enqueue of one or many applications
//
// Body: { applicationIds: number[], mode: "dry"|"real", confirm?: boolean }
// The university/adapter is resolved from each application's OWN record
// (findActivePortalUniversity); universityKey is never hardcoded. Queuing only
// inserts status='queued' rows — it never enables auto-process (drain-once
// still keys off portal_universities.autoProcess=true only).
// ---------------------------------------------------------------------------
const manualSubmitBodySchema = z.object({
  applicationIds: z.array(z.coerce.number().int().positive()).min(1).max(100),
  mode: z.enum(["dry", "real"]),
  confirm: z.boolean().optional(),
});
type ManualSubmitSchemas = { body: typeof manualSubmitBodySchema };

type SkipReason = "NOT_FOUND" | "NO_PORTAL" | "ALREADY_QUEUED";

router.post(
  "/portal-automation/submit",
  requireAuth,
  requireRole(...ADMIN_ROLES),
  validate({ body: manualSubmitBodySchema }),
  async (req, res): Promise<void> => {
    const user = req.user!;
    const { applicationIds, mode, confirm } = getValidated<ManualSubmitSchemas>(req).body;

    if (manualSubmitRateLimited(user.id)) {
      res.status(429).json({ error: "RATE_LIMITED", message: "Too many submissions, slow down." });
      return;
    }

    if (mode === "real" && !confirm) {
      res.status(422).json({
        error: "CONFIRM_REQUIRED",
        message: "Set confirm:true to submit in real mode",
      });
      return;
    }

    const uniqueIds = [...new Set(applicationIds)];

    const apps = await db
      .select({
        id:             applicationsTable.id,
        studentId:      applicationsTable.studentId,
        universityId:   applicationsTable.universityId,
        universityName: applicationsTable.universityName,
      })
      .from(applicationsTable)
      .where(and(inArray(applicationsTable.id, uniqueIds), isNull(applicationsTable.deletedAt)));

    const appMap = new Map(apps.map((a) => [a.id, a]));

    const queued: { applicationId: number; submissionId: number; universityKey: string }[] = [];
    const skipped: { applicationId: number; reason: SkipReason; submissionId?: number }[] = [];

    for (const appId of uniqueIds) {
      const app = appMap.get(appId);
      if (!app) {
        skipped.push({ applicationId: appId, reason: "NOT_FOUND" });
        continue;
      }

      const portalUni = await findActivePortalUniversity({
        universityId:   app.universityId,
        universityName: app.universityName,
      });
      if (!portalUni) {
        skipped.push({ applicationId: appId, reason: "NO_PORTAL" });
        continue;
      }

      // Duplicate guard: an active (queued/running) submission for this
      // application × university must not be re-queued.
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
          applicationId:  appId,
          studentId:      app.studentId,
          universityKey:  portalUni.universityKey,
          universityName: portalUni.universityName,
          mode,
          status:         "queued",
          enqueuedBy:     user.id,
        })
        .returning({ id: portalSubmissionsTable.id });

      queued.push({ applicationId: appId, submissionId: row.id, universityKey: portalUni.universityKey });
    }

    // Single-application strictness: surface the precise failure instead of an
    // empty 200 so the per-application "Portala Gönder" button can react.
    if (uniqueIds.length === 1 && queued.length === 0) {
      const only = skipped[0];
      if (only?.reason === "NOT_FOUND") {
        res.status(404).json({ error: "NOT_FOUND" });
        return;
      }
      if (only?.reason === "NO_PORTAL") {
        res.status(400).json({
          error: "NO_PORTAL",
          message: "No active portal university matches this application",
        });
        return;
      }
      // ALREADY_QUEUED → fall through to a 200 idempotent response.
    }

    await logAudit(
      user.id,
      "portal.manualSubmit",
      "portal_submission",
      queued[0]?.submissionId ?? 0,
      { ids: uniqueIds, mode, queued: queued.length, skipped: skipped.length },
      req.ip,
    );

    res.status(queued.length > 0 ? 201 : 200).json({ queued, skipped });
  },
);

// ---------------------------------------------------------------------------
// GET /portal-automation/eligible-applications — searchable, paginated list of
// applications that can be manually submitted (deleted_at IS NULL AND map to an
// active portal_universities row). Optional filters: stage, universityKey, q.
// ---------------------------------------------------------------------------
const eligibleQuerySchema = z.object({
  stage:         z.string().min(1).optional(),
  universityKey: z.string().min(1).optional(),
  q:             z.string().trim().min(1).optional(),
});
type EligibleSchemas = { query: typeof eligibleQuerySchema };

router.get(
  "/portal-automation/eligible-applications",
  requireAuth,
  requireRole(...ADMIN_ROLES),
  validate({ query: eligibleQuerySchema }),
  async (req, res): Promise<void> => {
    const { stage, universityKey, q } = getValidated<EligibleSchemas>(req).query;
    const pageParams = parsePaginationParams(req, { defaultLimit: 20, maxLimit: "small" });

    // An application is submittable when an active portal_universities row
    // matches its university by crmUniversityId (exact) OR name (case-insensitive).
    const joinCondition = and(
      isNull(portalUniversitiesTable.deletedAt),
      eq(portalUniversitiesTable.isActive, true),
      or(
        eq(portalUniversitiesTable.crmUniversityId, applicationsTable.universityId),
        sql`LOWER(${portalUniversitiesTable.universityName}) = LOWER(${applicationsTable.universityName})`,
      ),
    );

    const filters = and(
      isNull(applicationsTable.deletedAt),
      stage !== undefined ? eq(applicationsTable.stage, stage) : undefined,
      universityKey !== undefined ? eq(portalUniversitiesTable.universityKey, universityKey) : undefined,
      q !== undefined
        ? or(
            ilike(studentsTable.firstName, `%${q}%`),
            ilike(studentsTable.lastName, `%${q}%`),
            ilike(studentsTable.email, `%${q}%`),
            sql`CAST(${applicationsTable.id} AS TEXT) = ${q}`,
          )
        : undefined,
    );

    const [{ total }] = await db
      .select({ total: count(sql`DISTINCT ${applicationsTable.id}`) })
      .from(applicationsTable)
      .innerJoin(studentsTable, eq(applicationsTable.studentId, studentsTable.id))
      .innerJoin(portalUniversitiesTable, joinCondition)
      .where(filters);

    const rows = await db
      .selectDistinctOn([applicationsTable.id], {
        id:                  applicationsTable.id,
        stage:               applicationsTable.stage,
        universityName:      applicationsTable.universityName,
        studentFirstName:    studentsTable.firstName,
        studentLastName:     studentsTable.lastName,
        studentEmail:        studentsTable.email,
        portalUniversityKey: portalUniversitiesTable.universityKey,
        portalUniversityName: portalUniversitiesTable.universityName,
      })
      .from(applicationsTable)
      .innerJoin(studentsTable, eq(applicationsTable.studentId, studentsTable.id))
      .innerJoin(portalUniversitiesTable, joinCondition)
      .where(filters)
      .orderBy(desc(applicationsTable.id))
      .limit(pageParams.limit)
      .offset(pageParams.offset);

    res.json({ data: rows, ...buildPageMeta(total, pageParams) });
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
    // Multi-portal routing: if this university routes_via a multi-portal company,
    // resolveAdapterKey returns the company's adapterKey + the routedVia key.
    // routedVia is null on the legacy path → no adapter override is passed, so
    // behaviour is byte-for-byte identical to before this feature.
    const { adapterKey, routedVia } = await resolveAdapterKey(sub.universityKey);
    if (routedVia) {
      console.log(
        `[portal-process] #${sub.id} routed via multi-portal "${routedVia}" → adapter "${adapterKey}"`,
      );
    }

    let creds: { user: string; password: string } | undefined;
    try {
      // When routed, credentials belong to the multi-portal company (routedVia).
      creds = await resolvePortalCreds(routedVia ?? sub.universityKey, adapterKey);
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
      routedVia ? { adapterKey } : undefined,
    );
    // Enrich resultJson with doc-slot info so skip reasons are surfaced in the UI
    runResult.meta["filledSlots"]  = profileResult.filledSlots;
    runResult.meta["missingSlots"] = profileResult.missingSlots;
    if (routedVia) {
      runResult.meta["routedVia"]      = routedVia;
      runResult.meta["routedAdapter"]  = adapterKey;
    }
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

// ===========================================================================
// PROGRAM EŞLEME (FAZ 1) — LIVE program options + CRM→portal program mapping
// ===========================================================================

/** Live portal login timeout for listPrograms (mirrors test-login). */
const PROGRAM_LOGIN_TIMEOUT_MS = 90_000;
/** Program option cache TTL — entries older than this are refetched. */
const PROGRAM_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

/** Races a promise against a timeout, rejecting with `msg` if it elapses. */
function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(msg)), ms)),
  ]);
}

/**
 * Resolves an active (non-deleted) portal_universities row by universityKey.
 * Returns null when the key is unknown — callers respond 404.
 */
async function getPortalUniversity(
  universityKey: string,
): Promise<typeof portalUniversitiesTable.$inferSelect | null> {
  const [uni] = await db
    .select()
    .from(portalUniversitiesTable)
    .where(
      and(
        eq(portalUniversitiesTable.universityKey, universityKey),
        isNull(portalUniversitiesTable.deletedAt),
      ),
    )
    .limit(1);
  return uni ?? null;
}

const uniKeyParamsSchema = z.object({ key: z.string().min(1) });
type UniKeyParams = { params: typeof uniKeyParamsSchema };

// ---------------------------------------------------------------------------
// GET /portal-automation/universities/:key/program-options?level=&refresh=0|1
//
// Returns the portal's LIVE program option list ({ v, t }[]). Served from the
// portal_program_cache table; on cache miss / stale (>TTL) / refresh=1 the
// adapter is driven headless to fetch fresh options, which are then cached.
// ---------------------------------------------------------------------------
const programOptionsQuerySchema = z.object({
  level: z.string().optional(),
  refresh: z.coerce.number().int().optional(),
});
type ProgramOptionsSchemas = {
  params: typeof uniKeyParamsSchema;
  query: typeof programOptionsQuerySchema;
};

router.get(
  "/portal-automation/universities/:key/program-options",
  requireAuth,
  requireRole(...ADMIN_ROLES),
  validate({ params: uniKeyParamsSchema, query: programOptionsQuerySchema }),
  async (req, res): Promise<void> => {
    const { key } = getValidated<ProgramOptionsSchemas>(req).params;
    const { level: levelRaw, refresh } = getValidated<ProgramOptionsSchemas>(req).query;
    const level = (levelRaw ?? "").trim();
    const forceRefresh = refresh === 1;

    const uni = await getPortalUniversity(key);
    if (!uni) {
      res.status(404).json({ error: "UNIVERSITY_NOT_FOUND" });
      return;
    }

    // Cache read (keyed by universityKey + normalized level).
    const [cached] = await db
      .select()
      .from(portalProgramCacheTable)
      .where(
        and(
          eq(portalProgramCacheTable.universityKey, key),
          eq(portalProgramCacheTable.level, level),
        ),
      )
      .limit(1);

    const isStale =
      !cached || Date.now() - cached.fetchedAt.getTime() > PROGRAM_CACHE_TTL_MS;

    if (cached && !isStale && !forceRefresh) {
      res.json({
        options: cached.options,
        cached: true,
        stale: false,
        fetchedAt: cached.fetchedAt,
      });
      return;
    }

    // Live fetch via the adapter.
    const adapter = await resolveAdapterByKey(uni.adapterKey);
    if (!adapter) {
      res.status(404).json({
        error: "ADAPTER_NOT_FOUND",
        message: `Adapter bulunamadı: '${uni.adapterKey}'`,
      });
      return;
    }
    if (typeof adapter.listPrograms !== "function") {
      res.status(400).json({
        error: "NOT_SUPPORTED",
        message: `Adapter '${uni.adapterKey}' program listelemeyi desteklemiyor`,
      });
      return;
    }

    let session: Awaited<ReturnType<typeof adapter.login>> | null = null;
    try {
      const creds = await resolvePortalCreds(key, uni.adapterKey);
      setCredsOverride(adapter.key, { user: creds.user, password: creds.password });
      session = await withTimeout(
        adapter.login({ headless: true }),
        PROGRAM_LOGIN_TIMEOUT_MS,
        "Login zaman aşımına uğradı",
      );
      const options = await withTimeout(
        adapter.listPrograms(session, level || undefined),
        PROGRAM_LOGIN_TIMEOUT_MS,
        "Program listesi zaman aşımına uğradı",
      );

      // Upsert cache (university_key, level) — refresh options + fetchedAt.
      const [row] = await db
        .insert(portalProgramCacheTable)
        .values({ universityKey: key, level, options })
        .onConflictDoUpdate({
          target: [
            portalProgramCacheTable.universityKey,
            portalProgramCacheTable.level,
          ],
          set: { options, fetchedAt: new Date() },
        })
        .returning();

      res.json({
        options: row.options,
        cached: false,
        stale: false,
        fetchedAt: row.fetchedAt,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const safe = msg
        .replace(/password[^\s]*/gi, "***")
        .replace(/token[^\s]*/gi, "***");
      res.status(502).json({ error: "PORTAL_ERROR", message: safe });
    } finally {
      clearCredsOverride(adapter.key);
      session?.close().catch(() => {});
    }
  },
);

// ---------------------------------------------------------------------------
// GET /portal-automation/universities/:key/mapping
// Returns the CRM→portal program mapping data for the university.
// ---------------------------------------------------------------------------
router.get(
  "/portal-automation/universities/:key/mapping",
  requireAuth,
  requireRole(...ADMIN_ROLES),
  validate({ params: uniKeyParamsSchema }),
  async (req, res): Promise<void> => {
    const { key } = getValidated<UniKeyParams>(req).params;

    const uni = await getPortalUniversity(key);
    if (!uni) {
      res.status(404).json({ error: "UNIVERSITY_NOT_FOUND" });
      return;
    }

    const [row] = await db
      .select()
      .from(portalProgramMappingTable)
      .where(eq(portalProgramMappingTable.universityKey, key))
      .limit(1);

    res.json({
      universityKey: key,
      programOverrides: row?.programOverrides ?? {},
      synonyms: row?.synonyms ?? [],
      countryOverrides: row?.countryOverrides ?? {},
      updatedAt: row?.updatedAt ?? null,
    });
  },
);

// ---------------------------------------------------------------------------
// PUT /portal-automation/universities/:key/mapping
// Replaces the program_overrides object wholesale. Other mapping columns
// (synonyms, country_overrides) are left untouched. Audited.
// ---------------------------------------------------------------------------
const putMappingBodySchema = z.object({
  programOverrides: z.record(z.string()),
});
type PutMappingSchemas = {
  params: typeof uniKeyParamsSchema;
  body: typeof putMappingBodySchema;
};

router.put(
  "/portal-automation/universities/:key/mapping",
  requireAuth,
  requireRole(...ADMIN_ROLES),
  validate({ params: uniKeyParamsSchema, body: putMappingBodySchema }),
  async (req, res): Promise<void> => {
    const { key } = getValidated<PutMappingSchemas>(req).params;
    const { programOverrides } = getValidated<PutMappingSchemas>(req).body;
    const user = req.user!;

    const uni = await getPortalUniversity(key);
    if (!uni) {
      res.status(404).json({ error: "UNIVERSITY_NOT_FOUND" });
      return;
    }

    const [existing] = await db
      .select()
      .from(portalProgramMappingTable)
      .where(eq(portalProgramMappingTable.universityKey, key))
      .limit(1);

    let row;
    if (existing) {
      [row] = await db
        .update(portalProgramMappingTable)
        .set({ programOverrides, updatedAt: new Date() })
        .where(eq(portalProgramMappingTable.id, existing.id))
        .returning();
    } else {
      [row] = await db
        .insert(portalProgramMappingTable)
        .values({ universityKey: key, programOverrides })
        .returning();
    }

    logAudit(
      user.id,
      "update_portal_program_mapping",
      "portal_program_mapping",
      row.id,
      { universityKey: key, programOverrides: Object.keys(programOverrides).length },
      req.ip,
    );

    res.json({
      universityKey: key,
      programOverrides: row.programOverrides,
      synonyms: row.synonyms,
      countryOverrides: row.countryOverrides,
      updatedAt: row.updatedAt,
    });
  },
);

// ---------------------------------------------------------------------------
// GET /portal-automation/multi-portals
//
// Lists every multi-portal company (is_multi_portal=true) together with its
// member universities (rows whose routes_via points at the company's key).
// ---------------------------------------------------------------------------
router.get(
  "/portal-automation/multi-portals",
  requireAuth,
  requireRole(...ADMIN_ROLES),
  async (_req, res): Promise<void> => {
    const portals = await db
      .select({
        universityKey: portalUniversitiesTable.universityKey,
        universityName: portalUniversitiesTable.universityName,
        adapterKey: portalUniversitiesTable.adapterKey,
        isActive: portalUniversitiesTable.isActive,
      })
      .from(portalUniversitiesTable)
      .where(
        and(
          eq(portalUniversitiesTable.isMultiPortal, true),
          isNull(portalUniversitiesTable.deletedAt),
        ),
      )
      .orderBy(asc(portalUniversitiesTable.universityName));

    const portalKeys = portals.map((p) => p.universityKey);
    const memberRows =
      portalKeys.length > 0
        ? await db
            .select({
              universityKey: portalUniversitiesTable.universityKey,
              universityName: portalUniversitiesTable.universityName,
              adapterKey: portalUniversitiesTable.adapterKey,
              routesVia: portalUniversitiesTable.routesVia,
            })
            .from(portalUniversitiesTable)
            .where(
              and(
                inArray(portalUniversitiesTable.routesVia, portalKeys),
                isNull(portalUniversitiesTable.deletedAt),
              ),
            )
            .orderBy(asc(portalUniversitiesTable.universityName))
        : [];

    const data = portals.map((p) => ({
      ...p,
      members: memberRows
        .filter((m) => m.routesVia === p.universityKey)
        .map((m) => ({
          universityKey: m.universityKey,
          universityName: m.universityName,
          adapterKey: m.adapterKey,
        })),
    }));

    res.json({ data });
  },
);

// ---------------------------------------------------------------------------
// PUT /portal-automation/multi-portals/:key/members
//
// Sets the full member list for a multi-portal company. Selected universities
// get routes_via=:key; universities previously routed here but omitted are
// reset to NULL (own adapter). Routing assignment does NOT enable auto-process.
// ---------------------------------------------------------------------------
const putMembersBodySchema = z.object({
  universityKeys: z.array(z.string().min(1)).max(1000),
});
type PutMembersSchemas = {
  params: typeof uniKeyParamsSchema;
  body: typeof putMembersBodySchema;
};

router.put(
  "/portal-automation/multi-portals/:key/members",
  requireAuth,
  requireRole(...ADMIN_ROLES),
  validate({ params: uniKeyParamsSchema, body: putMembersBodySchema }),
  async (req, res): Promise<void> => {
    const { key } = getValidated<PutMembersSchemas>(req).params;
    const { universityKeys } = getValidated<PutMembersSchemas>(req).body;
    const user = req.user!;

    const portal = await getPortalUniversity(key);
    if (!portal) {
      res.status(404).json({ error: "PORTAL_NOT_FOUND" });
      return;
    }
    if (!portal.isMultiPortal) {
      res.status(400).json({
        error: "NOT_MULTI_PORTAL",
        message: `'${key}' is not a multi-portal company`,
      });
      return;
    }

    const requested = Array.from(new Set(universityKeys));

    if (requested.includes(key)) {
      res.status(400).json({
        error: "INVALID_MEMBER",
        message: "A multi-portal company cannot be its own member",
      });
      return;
    }

    if (requested.length > 0) {
      const rows = await db
        .select({
          universityKey: portalUniversitiesTable.universityKey,
          isMultiPortal: portalUniversitiesTable.isMultiPortal,
          routesVia: portalUniversitiesTable.routesVia,
        })
        .from(portalUniversitiesTable)
        .where(
          and(
            inArray(portalUniversitiesTable.universityKey, requested),
            isNull(portalUniversitiesTable.deletedAt),
          ),
        );

      const foundKeys = new Set(rows.map((r) => r.universityKey));
      const missing = requested.filter((k) => !foundKeys.has(k));
      if (missing.length > 0) {
        res.status(404).json({
          error: "MEMBER_NOT_FOUND",
          message: `Unknown university key(s): ${missing.join(", ")}`,
        });
        return;
      }

      const portalsAmongMembers = rows
        .filter((r) => r.isMultiPortal)
        .map((r) => r.universityKey);
      if (portalsAmongMembers.length > 0) {
        res.status(400).json({
          error: "INVALID_MEMBER",
          message: `Cannot route a multi-portal company through another: ${portalsAmongMembers.join(", ")}`,
        });
        return;
      }

      // Double-assign block: a university already routed to a DIFFERENT portal.
      const conflicts = rows
        .filter((r) => r.routesVia && r.routesVia !== key)
        .map((r) => r.universityKey);
      if (conflicts.length > 0) {
        res.status(409).json({
          error: "ALREADY_ASSIGNED",
          message: `Already assigned to another multi-portal: ${conflicts.join(", ")}`,
        });
        return;
      }
    }

    await db.transaction(async (tx) => {
      // Detach removed members (previously routed here, now omitted).
      const clearCondition =
        requested.length > 0
          ? and(
              eq(portalUniversitiesTable.routesVia, key),
              notInArray(portalUniversitiesTable.universityKey, requested),
              isNull(portalUniversitiesTable.deletedAt),
            )
          : and(
              eq(portalUniversitiesTable.routesVia, key),
              isNull(portalUniversitiesTable.deletedAt),
            );
      await tx
        .update(portalUniversitiesTable)
        .set({ routesVia: null, updatedAt: new Date() })
        .where(clearCondition);

      // Attach selected members. Note: only routes_via changes — auto_process
      // is intentionally left untouched so routing never enables auto-process.
      if (requested.length > 0) {
        await tx
          .update(portalUniversitiesTable)
          .set({ routesVia: key, updatedAt: new Date() })
          .where(
            and(
              inArray(portalUniversitiesTable.universityKey, requested),
              isNull(portalUniversitiesTable.deletedAt),
            ),
          );
      }
    });

    logAudit(
      user.id,
      "portal.routing.update",
      "portal_university",
      portal.id,
      { portalKey: key, universityKeys: requested },
      req.ip,
    );

    const members = await db
      .select({
        universityKey: portalUniversitiesTable.universityKey,
        universityName: portalUniversitiesTable.universityName,
        adapterKey: portalUniversitiesTable.adapterKey,
      })
      .from(portalUniversitiesTable)
      .where(
        and(
          eq(portalUniversitiesTable.routesVia, key),
          isNull(portalUniversitiesTable.deletedAt),
        ),
      )
      .orderBy(asc(portalUniversitiesTable.universityName));

    res.json({ portalKey: key, members });
  },
);

export default router;
