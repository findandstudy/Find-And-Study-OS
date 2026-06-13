/**
 * queue.ts — portal_submissions queue mechanics
 *
 * claimNext()    — atomically grabs the oldest queued submission using
 *                  FOR UPDATE SKIP LOCKED so concurrent workers never
 *                  double-process the same row.
 *                  Optional `universityKeys` param restricts to specific
 *                  universities (used by auto-drain to honour autoProcess flag).
 *
 * claimById()    — atomically claims a specific submission by id (for
 *                  the manual "process now" endpoint). Returns null if
 *                  the row is not queued, already locked, or exhausted.
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
 *
 * Returns null when the queue is empty or all rows are locked / exhausted.
 */
export async function claimNext(
  workerId: string,
  universityKeys?: string[],
): Promise<ClaimedSubmission | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    let sel: { rows: ClaimedSubmission[] };
    if (universityKeys && universityKeys.length > 0) {
      sel = await client.query<ClaimedSubmission>(`
        SELECT ${CLAIM_COLS}
        FROM portal_submissions
        WHERE status = 'queued'
          AND attempts < max_attempts
          AND deleted_at IS NULL
          AND university_key = ANY($1::text[])
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `, [universityKeys]);
    } else {
      sel = await client.query<ClaimedSubmission>(`
        SELECT ${CLAIM_COLS}
        FROM portal_submissions
        WHERE status = 'queued'
          AND attempts < max_attempts
          AND deleted_at IS NULL
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `);
    }

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
 *   - has reached maxAttempts
 *   - is already locked by another worker (SKIP LOCKED)
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
        AND attempts < max_attempts
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
 * Returns the IDs of rows that were reset.
 */
export async function releaseStale(thresholdMs: number): Promise<number[]> {
  const res = await pool.query<{ id: number }>(
    `UPDATE portal_submissions
     SET status     = 'queued',
         locked_at  = NULL,
         locked_by  = NULL,
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
