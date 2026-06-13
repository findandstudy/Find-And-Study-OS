import { Router, type IRouter } from "express";
import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, applicationsTable, portalSubmissionsTable } from "@workspace/db";
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
  buildStudentProfile,
  runSubmission,
  writebackResult,
} from "@workspace/portal-runner";
import { resolvePortalCreds } from "../lib/portalCreds.js";

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

interface ProcessSingleResult {
  id: number;
  status: "submitted" | "already_exists" | "program_missing" | "failed" | "dry_run" | "skipped";
  error?: string;
}

/**
 * Claims and processes a single submission by id.
 * Returns null if the submission cannot be claimed (not queued / exhausted / locked).
 */
async function processSingle(
  submissionId: number,
  workerId: string,
): Promise<ProcessSingleResult> {
  const sub = await claimById(submissionId, workerId);
  if (!sub) {
    return { id: submissionId, status: "skipped" };
  }

  try {
    const profileResult = await buildStudentProfile(sub.id);

    let creds: { user: string; password: string } | undefined;
    if (sub.mode === "real") {
      creds = await resolvePortalCreds(sub.universityKey, sub.universityKey);
    }

    const runResult = await runSubmission(
      sub,
      profileResult.profile,
      profileResult.files,
      profileResult.tempDir,
      creds,
    );

    await writebackResult(sub.id, runResult);

    const status: ProcessSingleResult["status"] = runResult.meta["dryRun"]
      ? "dry_run"
      : runResult.result.submitted
        ? "submitted"
        : runResult.result.alreadyExists
          ? "already_exists"
          : runResult.result.programMissing
            ? "program_missing"
            : "failed";

    return { id: sub.id, status };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await writebackResult(sub.id, null, msg);
    return { id: sub.id, status: "failed", error: msg };
  }
}

// ---------------------------------------------------------------------------
// POST /portal-submissions/process-queued
// Processes ALL queued submissions sequentially; eşzaman 1.
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
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const sub = await claimNext(workerId);
        if (!sub) break;

        console.log(`[portal-process] Processing #${sub.id} uni=${sub.universityKey} mode=${sub.mode}`);

        let creds: { user: string; password: string } | undefined;
        if (sub.mode === "real") {
          try {
            creds = await resolvePortalCreds(sub.universityKey, sub.universityKey);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            await writebackResult(sub.id, null, msg);
            results.push({ id: sub.id, status: "failed", error: msg });
            continue;
          }
        }

        try {
          const profileResult = await buildStudentProfile(sub.id);
          const runResult = await runSubmission(
            sub,
            profileResult.profile,
            profileResult.files,
            profileResult.tempDir,
            creds,
          );

          await writebackResult(sub.id, runResult);

          const status: ProcessSingleResult["status"] = runResult.meta["dryRun"]
            ? "dry_run"
            : runResult.result.submitted
              ? "submitted"
              : runResult.result.alreadyExists
                ? "already_exists"
                : runResult.result.programMissing
                  ? "program_missing"
                  : "failed";

          results.push({ id: sub.id, status });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          await writebackResult(sub.id, null, msg);
          results.push({ id: sub.id, status: "failed", error: msg });
        }
      }
    } finally {
      _processMutex = false;
    }

    await logAudit(
      user.id,
      "process_portal_submissions",
      "portal_submission",
      undefined,
      { processed: results.length, results: results.map(r => ({ id: r.id, status: r.status })) },
      req.ip,
    );

    res.json({ processed: results.length, results });
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

      res.json({ processed: result.status !== "skipped" ? 1 : 0, results: [result] });
    } finally {
      _processMutex = false;
    }
  },
);

// ---------------------------------------------------------------------------
// GET /university-portals
// ---------------------------------------------------------------------------
router.get("/university-portals", requireAuth, async (_req, res): Promise<void> => {
  const meta = adapterMetadata();
  const result = meta.map(({ key, label }) => {
    const K = key.toUpperCase().replace(/-/g, "_");
    const hasCredentials = !!(
      (process.env[`${K}_EMAIL`] || process.env[`${K}_USER`]) &&
      process.env[`${K}_PASSWORD`]
    );
    return { key, label, hasCredentials };
  });
  res.json(result);
});

export default router;
