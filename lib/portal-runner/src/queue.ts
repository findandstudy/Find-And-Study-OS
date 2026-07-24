/**
 * queue.ts — portal_submissions queue mechanics
 *
 * claimNext()    — atomically grabs the oldest queued submission using
 *                  FOR UPDATE SKIP LOCKED so concurrent workers never
 *                  double-process the same row.
 *                  Optional `universityKeys` param restricts to specific
 *                  universities (used by auto-drain to honour autoProcess flag).
 *                  Any status='queued' row is claimable regardless of
 *                  attempt count — if it's queued, it was explicitly
 *                  authorised for (re-)processing by admin/reset-stuck.
 *
 * claimById()    — atomically claims a specific submission by id (for
 *                  the manual "process now" endpoint). Returns null if
 *                  the row is not queued or already locked by another worker.
 *
 * releaseStale() — resets submissions that have been running longer than
 *                  thresholdMs back to "queued" (crash-recovery).
 *
 * NOTE: raw pg `SELECT *` returns snake_case column names. All three
 * claim queries use explicit AS aliases to produce camelCase keys that
 * match the ClaimedSubmission TypeScript type.
 */

import { pool } from "@workspace/db";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClaimedSubmission {
  id: number;
  applicationId: number;
  studentId: number;
  universityKey: string;
  universityName: string;
  mode: "dry" | "real";
  status: string;
  attempts: number;
  maxAttempts: number;
  lockedBy: string | null;
  lockedAt: Date | null;
  enqueuedBy: number | null;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Shared column list (explicit camelCase aliases)
// ---------------------------------------------------------------------------

const CLAIM_COLS = `
  id,
  application_id    AS "applicationId",
  student_id        AS "studentId",
  university_key    AS "universityKey",
  university_name   AS "universityName",
  mode,
  status,
  attempts,
  max_attempts      AS "maxAttempts",
  locked_at         AS "lockedAt",
  locked_by         AS "lockedBy",
  enqueued_by       AS "enqueuedBy",
  created_at        AS "createdAt"
`;

// ---------------------------------------------------------------------------
// claimNext
// ---------------------------------------------------------------------------

/**
 * Atomically claims the next queued submission for this worker instance.
 *
 * Uses BEGIN / SELECT ... FOR UPDATE SKIP LOCKED / UPDATE / COMMIT
 * so concurrent workers never attempt the same row.
 *
 * @param universityKeys  Optional allowlist of university_key values.
 *   When provided (non-empty), only submissions belonging to these
 *   universities are considered. Used by auto-drain to respect the
 *   per-university `autoProcess` flag.
 * @param triggerStages  Optional list of application stages that gate which
 *   submissions may be claimed. When provided (an array, even empty), only
 *   submissions whose application is currently in one of these stages are
 *   claimed — an empty array matches nothing, mirroring the enqueue-time
 *   candidate selection. `undefined` skips the stage filter entirely (used by
 *   the manual "process all queued" path, which must not be stage-gated).
 *
 * Manual bypass: rows enqueued via the user-facing "Run" action (Applications
 * bulk Run / admin Manual Submit dialog) are marked `meta.manual = true` at
 * enqueue time (see portalManualEnqueue.ts). Such rows are ALWAYS claimable —
 * both the `universityKeys` (autoProcess) and `triggerStages` gates are
 * bypassed for them, because the user already made an explicit, one-off
 * decision to submit that application regardless of its current stage or the
 * university's autoProcess toggle. The gates still apply in full to every
 * other (automatic/scheduled) row.
 *
 * Returns null when the queue is empty or all rows are locked by other workers.
 */
export async function claimNext(
  workerId: string,
  universityKeys?: string[],
  triggerStages?: string[],
  excludeUniversityKeys?: string[],
): Promise<ClaimedSubmission | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // NOTE: deliberately NO "attempts < max_attempts" condition here. attempts
    // increments at claim time and a failed run parks the row in 'failed'
    // permanently — there is no per-row auto-retry loop to guard against. The
    // manual Retry button re-queues WITHOUT resetting attempts, so gating on
    // attempts would silently dead-lock retried rows (see TAP4). The infinite
    // auto-retry loop is instead capped at the enqueue side (max_failures gate
    // in enqueueIfEligible / aggregator fan-out) — new rows stop being created
    // after MAX_AUTO_FAILED_SUBMISSIONS failures per application × university.
    const conds: string[] = ["status = 'queued'", "deleted_at IS NULL"];
    const params: unknown[] = [];
    const isManualCond = `(meta->>'manual')::boolean IS TRUE`;

    const gatedConds: string[] = [];

    if (universityKeys && universityKeys.length > 0) {
      params.push(universityKeys);
      gatedConds.push(`university_key = ANY($${params.length}::text[])`);
    }

    if (triggerStages !== undefined) {
      params.push(triggerStages);
      gatedConds.push(
        `EXISTS (
          SELECT 1 FROM applications a
          WHERE a.id = portal_submissions.application_id
            AND a.deleted_at IS NULL
            AND a.stage = ANY($${params.length}::text[])
        )`,
      );
    }

    // Adapter auto-graduation: scheduled/automatic drains exclude submissions
    // targeting still-experimental (non-graduated) adapters. Gated — manual
    // (meta.manual) rows bypass this like every other automatic-only gate,
    // because manual single-submission of experimental adapters is allowed.
    if (excludeUniversityKeys && excludeUniversityKeys.length > 0) {
      params.push(excludeUniversityKeys);
      gatedConds.push(`university_key <> ALL($${params.length}::text[])`);
    }

    if (gatedConds.length > 0) {
      conds.push(`(${isManualCond} OR (${gatedConds.join(" AND ")}))`);
    }

    const sel = await client.query<ClaimedSubmission>(
      `SELECT ${CLAIM_COLS}
       FROM portal_submissions
       WHERE ${conds.join("\n         AND ")}
       ORDER BY created_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED`,
      params,
    );

    if (sel.rows.length === 0) {
      await client.query("COMMIT");
      return null;
    }

    const row = sel.rows[0];

    await client.query(
      `UPDATE portal_submissions
       SET status     = 'running',
           locked_at  = NOW(),
           locked_by  = $1,
           attempts   = attempts + 1,
           updated_at = NOW()
       WHERE id = $2`,
      [workerId, row.id],
    );

    await client.query("COMMIT");
    return row;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// claimById
// ---------------------------------------------------------------------------

/**
 * Atomically claims a specific submission by id.
 *
 * Returns null if the row:
 *   - doesn't exist or is soft-deleted
 *   - is not in 'queued' status
 *   - is already locked by another worker (SKIP LOCKED)
 *
 * Note: attempt count is NOT checked — any queued row is claimable.
 * If status='queued' it was explicitly authorised for (re-)processing.
 */
export async function claimById(
  id: number,
  workerId: string,
): Promise<ClaimedSubmission | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const sel = await client.query<ClaimedSubmission>(`
      SELECT ${CLAIM_COLS}
      FROM portal_submissions
      WHERE id = $1
        AND status = 'queued'
        AND deleted_at IS NULL
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `, [id]);

    if (sel.rows.length === 0) {
      await client.query("COMMIT");
      return null;
    }

    const row = sel.rows[0];

    await client.query(
      `UPDATE portal_submissions
       SET status     = 'running',
           locked_at  = NOW(),
           locked_by  = $1,
           attempts   = attempts + 1,
           updated_at = NOW()
       WHERE id = $2`,
      [workerId, row.id],
    );

    await client.query("COMMIT");
    return row;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// releaseStale
// ---------------------------------------------------------------------------

/**
 * Resets submissions that have been in "running" state longer than
 * `thresholdMs` milliseconds back to "queued" (worker crash recovery).
 *
 * Also resets attempts = 0 so the row is immediately claimable again —
 * without this, a submission whose attempts reached max_attempts while
 * running would be requeued into a state that claimNext could never pick up
 * (permanent lock). Clearing attempts on crash-recovery is safe: the crash
 * itself is the reason we're retrying.
 *
 * Returns the IDs of rows that were reset.
 */
export async function releaseStale(thresholdMs: number): Promise<number[]> {
  // FIX-CRASHLOOP: a submission that deterministically crashes the worker
  // process (e.g. a native SIGBUS in a downstream dependency) used to be
  // forgiven forever - attempts was unconditionally reset to 0 on every
  // crash-recovery, so claimNext kept reclaiming it and it kept crashing
  // the worker, taking the whole queue hostage. We still forgive normal
  // crash-recovery (attempts=0, so app-level retry budget is untouched),
  // but we now track how many times THIS row has come back from a stale
  // "running" lock via meta.crash_recoveries. Once that exceeds
  // MAX_CRASH_RECOVERIES we quarantine the row as 'failed' instead of
  // requeueing it, so one poison-pill submission can no longer crash-loop
  // the daemon or block the rest of the batch.
  const res = await pool.query<{ id: number }>(
    `UPDATE portal_submissions
     SET status     = CASE
                         WHEN COALESCE((meta->>'crash_recoveries')::int, 0) + 1 >= 3
                           THEN 'failed'
                         ELSE 'queued'
                       END,
         attempts   = CASE
                         WHEN COALESCE((meta->>'crash_recoveries')::int, 0) + 1 >= 3
                           THEN attempts
                         ELSE 0
                       END,
         locked_at  = NULL,
         locked_by  = NULL,
         error      = CASE
                         WHEN COALESCE((meta->>'crash_recoveries')::int, 0) + 1 >= 3
                           THEN 'WORKER CRASH LOOP - bu basvuru worker surecini ust uste 3+ kez cokerterek (SIGBUS/anormal exit) durdurdu. Otomatik izole edildi (failed); manuel inceleme gerekiyor.'
                         ELSE error
                       END,
         meta       = jsonb_set(
                         COALESCE(meta, '{}'::jsonb),
                         '{crash_recoveries}',
                         to_jsonb(COALESCE((meta->>'crash_recoveries')::int, 0) + 1)
                       ),
         updated_at = NOW()
     WHERE status = 'running'
       AND locked_at < NOW() - ($1 || ' milliseconds')::interval
       AND deleted_at IS NULL
     RETURNING id`,
    [thresholdMs],
  );
  return (res.rows ?? []).map((r) => r.id);
}

// ---------------------------------------------------------------------------
// heartbeat
// ---------------------------------------------------------------------------

/**
 * Refreshes locked_at for an active running submission.
 * Call periodically while processing to prevent stuck-reset from firing.
 * Guards on locked_by when workerId is provided so only the owning worker
 * can extend the lease.
 */
export async function heartbeat(id: number, workerId?: string): Promise<void> {
  if (workerId) {
    await pool.query(
      `UPDATE portal_submissions
       SET locked_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND status = 'running' AND locked_by = $2`,
      [id, workerId],
    );
  } else {
    await pool.query(
      `UPDATE portal_submissions
       SET locked_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND status = 'running'`,
      [id],
    );
  }
}

// ---------------------------------------------------------------------------
// requeueStuck
// ---------------------------------------------------------------------------

/**
 * Atomically requeues a specific running submission back to "queued".
 * Only acts if the row is still owned by `workerId` (locked_by guard).
 * Returns true if the row was actually reset.
 */
export async function requeueStuck(id: number, workerId: string): Promise<boolean> {
  const res = await pool.query<{ id: number }>(
    `UPDATE portal_submissions
     SET status     = 'queued',
         locked_at  = NULL,
         locked_by  = NULL,
         updated_at = NOW()
     WHERE id = $1
       AND status   = 'running'
       AND locked_by = $2
       AND deleted_at IS NULL
     RETURNING id`,
    [id, workerId],
  );
  return (res.rowCount ?? 0) > 0;
}
