/**
 * queue.ts — portal_submissions queue mechanics
 *
 * claimNext()    — atomically grabs the oldest queued submission using
 *                  FOR UPDATE SKIP LOCKED so concurrent workers never
 *                  double-process the same row.
 *
 * releaseStale() — resets submissions that have been running longer than
 *                  thresholdMs back to "queued" (crash-recovery).
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
// claimNext
// ---------------------------------------------------------------------------

/**
 * Atomically claims the next queued submission for this worker instance.
 *
 * Uses a BEGIN / SELECT ... FOR UPDATE SKIP LOCKED / UPDATE / COMMIT
 * sequence so that concurrent workers never attempt the same row.
 *
 * Returns null when the queue is empty or all rows are locked / exhausted.
 */
export async function claimNext(
  workerId: string,
): Promise<ClaimedSubmission | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const sel = await client.query<ClaimedSubmission>(`
      SELECT *
      FROM portal_submissions
      WHERE status = 'queued'
        AND attempts < max_attempts
        AND deleted_at IS NULL
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `);

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
 * Returns the number of rows reset.
 */
export async function releaseStale(thresholdMs: number): Promise<number> {
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
  return res.rowCount ?? 0;
}
