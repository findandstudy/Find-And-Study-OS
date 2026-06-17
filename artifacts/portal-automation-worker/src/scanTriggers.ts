import { pool } from "@workspace/db";

/**
 * Auto-trigger: when an application's stage matches a configured trigger
 * (portal_auto_triggers), enqueue ONE portal_submission for it.
 * Safe defaults:
 *  - mode = 'dry' unless the trigger has auto_real = true (explicit gate).
 *  - At most one auto submission per (application, university) ever
 *    (NOT EXISTS guard) -> no duplicate / no dry re-enqueue loop.
 */
const SCAN_SQL = `
INSERT INTO portal_submissions
  (application_id, student_id, university_key, university_name, mode, status, attempts, max_attempts, created_at, updated_at)
SELECT a.id, a.student_id, t.university_key, a.university_name,
       (CASE WHEN t.auto_real THEN 'real' ELSE 'dry' END)::portal_submission_mode,
       'queued'::portal_submission_status, 0, 3, now(), now()
FROM applications a
JOIN portal_auto_triggers t
  ON a.stage = t.trigger_stage
 AND a.university_name ILIKE t.name_match
WHERE t.enabled = true
  AND a.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM portal_submissions s
    WHERE s.application_id = a.id
      AND s.university_key = t.university_key
      AND s.deleted_at IS NULL
  )
RETURNING id, application_id, university_key, mode;
`;

export async function scanTriggers(): Promise<void> {
  try {
    const res = await pool.query(SCAN_SQL);
    if (res.rowCount && res.rowCount > 0) {
      console.log(
        "[auto-trigger] enqueued " + res.rowCount + " submission(s): " +
          res.rows
            .map((r: any) => "#" + r.id + "(app " + r.application_id + " " + r.university_key + " " + r.mode + ")")
            .join(", "),
      );
    }
  } catch (e) {
    console.error("[auto-trigger] scan failed:", e instanceof Error ? e.message : String(e));
  }
}
