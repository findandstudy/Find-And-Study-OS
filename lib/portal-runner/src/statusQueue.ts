import { pool } from "@workspace/db";

const MAX_STATUS_LANES = 8;
const MAX_STATUS_ROWS_PER_LANE = 25;
export const MAX_PORTAL_STATUS_FAILURES = 8;

export type PortalStatusFailureCode =
  | "STATUS_CHECK_UNSUPPORTED"
  | "STATUS_CHECK_TIMEOUT"
  | "STATUS_CHECK_AUTHENTICATION"
  | "STATUS_CHECK_PORTAL_DRIFT"
  | "STATUS_CHECK_NETWORK"
  | "STATUS_CHECK_LEASE_LOST"
  | "STATUS_CHECK_ARTIFACT"
  | "STATUS_CHECK_FAILED";

export interface ClaimedPortalStatusCheck {
  id: number;
  applicationId: number;
  studentId: number | null;
  universityKey: string;
  adapterKey: string;
  externalRef: string;
  resultJson: Record<string, unknown> | null;
  statusCheckAttempts: number;
  laneKey: string;
}

export interface PortalStatusLaneLease {
  release(): Promise<void>;
}

export type PortalStatusRetryPlan = {
  failedAttempts: number;
  suspended: boolean;
  nextCheckAt: Date;
};

export type PortalLifecycleDisposition =
  | "SUBMITTED"
  | "UNDER_REVIEW"
  | "MISSING_DOCUMENT"
  | "FEE_REQUIRED"
  | "CONDITIONAL_OFFER"
  | "UNCONDITIONAL_OFFER"
  | "DEPOSIT_RECEIVED"
  | "WAITLISTED"
  | "REJECTED"
  | "FINAL_ACCEPTANCE"
  | "ENROLLED"
  | "FULL_QUOTA"
  | "DUPLICATE"
  | "ALREADY_REGISTERED"
  | "WITHDRAWN"
  | "UNKNOWN";

/**
 * Converts untrusted browser/provider failures into a fixed, PII-free code.
 * Raw exception messages must never be stored or emitted by the queue because
 * browser errors can contain credentials, query strings, form values or HTML.
 */
export function classifyPortalStatusFailure(error: unknown): PortalStatusFailureCode {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const normalized = message.toLowerCase();
  if (normalized.includes("status_check_unsupported")) return "STATUS_CHECK_UNSUPPORTED";
  if (
    normalized.includes("timeout") ||
    normalized.includes("timed out") ||
    normalized.includes("etimedout")
  ) {
    return "STATUS_CHECK_TIMEOUT";
  }
  if (
    normalized.includes("credential") ||
    normalized.includes("authentication") ||
    normalized.includes("unauthorized") ||
    normalized.includes("forbidden") ||
    normalized.includes("login") ||
    /(^|\D)(401|403)(\D|$)/.test(normalized)
  ) {
    return "STATUS_CHECK_AUTHENTICATION";
  }
  if (
    normalized.includes("selector") ||
    normalized.includes("locator") ||
    normalized.includes("element") ||
    normalized.includes("drift") ||
    normalized.includes("strict mode violation")
  ) {
    return "STATUS_CHECK_PORTAL_DRIFT";
  }
  if (
    normalized.includes("network") ||
    normalized.includes("connect") ||
    normalized.includes("socket") ||
    normalized.includes("dns") ||
    normalized.includes("enotfound") ||
    normalized.includes("econn")
  ) {
    return "STATUS_CHECK_NETWORK";
  }
  if (normalized.includes("lease_lost")) return "STATUS_CHECK_LEASE_LOST";
  if (
    normalized.includes("status_artifact") ||
    normalized.includes("portal_status_artifact")
  ) {
    return "STATUS_CHECK_ARTIFACT";
  }
  return "STATUS_CHECK_FAILED";
}

function requireBoundedInteger(
  name: string,
  value: number,
  min: number,
  max: number,
): void {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be between ${min} and ${max}`);
  }
}

/** Bounded exponential retry with stable per-row jitter to avoid thundering herds. */
export function planPortalStatusRetry(input: {
  submissionId: number;
  failedAttempts: number;
  now?: Date;
}): PortalStatusRetryPlan {
  requireBoundedInteger("submissionId", input.submissionId, 1, Number.MAX_SAFE_INTEGER);
  requireBoundedInteger("failedAttempts", input.failedAttempts, 1, 1_000_000);
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("now_invalid");
  const suspended = input.failedAttempts >= MAX_PORTAL_STATUS_FAILURES;
  const baseMs = Math.min(6 * 60 * 60_000, 60_000 * 2 ** Math.min(input.failedAttempts - 1, 9));
  const jitterBasis = (input.submissionId * 1_103_515_245 + input.failedAttempts * 12_345) >>> 0;
  const jitterMs = Math.floor(baseMs * 0.25 * (jitterBasis / 0xffff_ffff));
  return {
    failedAttempts: input.failedAttempts,
    suspended,
    nextCheckAt: new Date(now.getTime() + baseMs + jitterMs),
  };
}

/**
 * Adaptive successful-check cadence. Stable per-row jitter spreads traffic
 * across the window while preserving deterministic tests and predictable
 * provider load. Actionable states are checked sooner; passive waiting states
 * are deliberately slower than the legacy fixed fifteen-minute sweep.
 */
export function planPortalStatusSuccess(input: {
  submissionId: number;
  disposition: PortalLifecycleDisposition;
  now?: Date;
}): Date {
  requireBoundedInteger("submissionId", input.submissionId, 1, Number.MAX_SAFE_INTEGER);
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("now_invalid");
  const baseHours: Record<PortalLifecycleDisposition, number> = {
    SUBMITTED: 6,
    UNDER_REVIEW: 6,
    MISSING_DOCUMENT: 12,
    FEE_REQUIRED: 12,
    CONDITIONAL_OFFER: 4,
    UNCONDITIONAL_OFFER: 4,
    DEPOSIT_RECEIVED: 6,
    WAITLISTED: 24,
    REJECTED: 24,
    FINAL_ACCEPTANCE: 12,
    ENROLLED: 24,
    FULL_QUOTA: 24,
    DUPLICATE: 24,
    ALREADY_REGISTERED: 24,
    WITHDRAWN: 24,
    UNKNOWN: 2,
  };
  const baseMs = baseHours[input.disposition] * 60 * 60_000;
  const jitterBasis = (input.submissionId * 2_654_435_761) >>> 0;
  const jitterMs = Math.floor(baseMs * 0.2 * (jitterBasis / 0xffff_ffff));
  return new Date(now.getTime() + baseMs + jitterMs);
}

/**
 * Holds a PostgreSQL session-level advisory lock for one adapter/university
 * lane. The dedicated client is intentionally retained until release so the
 * lock survives the browser session and works across API processes/hosts that
 * share the database. A hash collision can only reduce concurrency, never mix
 * rows or bypass isolation.
 */
export async function acquirePortalStatusLaneLease(input: {
  laneKey: string;
}): Promise<PortalStatusLaneLease | null> {
  const laneKey = input.laneKey.trim().toLocaleLowerCase("en");
  if (!laneKey || laneKey.length > 220) throw new Error("lane_key_invalid");
  const client = await pool.connect();
  try {
    const result = await client.query<{ acquired: boolean }>(
      `SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired`,
      [laneKey],
    );
    if (result.rows[0]?.acquired !== true) {
      client.release();
      return null;
    }
  } catch (error) {
    client.release(true);
    throw error;
  }

  let released = false;
  return {
    async release(): Promise<void> {
      if (released) return;
      released = true;
      let destroyClient = false;
      try {
        const result = await client.query<{ released: boolean }>(
          `SELECT pg_advisory_unlock(hashtextextended($1, 0)) AS released`,
          [laneKey],
        );
        destroyClient = result.rows[0]?.released !== true;
      } catch {
        destroyClient = true;
      } finally {
        client.release(destroyClient);
      }
    },
  };
}

/** Releases row leases without consuming a retry when another worker owns the lane. */
export async function releasePortalStatusChecks(input: {
  submissionIds: number[];
  workerId: string;
}): Promise<number> {
  if (input.submissionIds.length === 0) return 0;
  if (input.submissionIds.length > MAX_STATUS_LANES * MAX_STATUS_ROWS_PER_LANE) {
    throw new Error("submission_ids_too_many");
  }
  if (input.submissionIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    throw new Error("submission_ids_invalid");
  }
  const workerId = input.workerId.trim();
  if (!workerId || workerId.length > 160) throw new Error("worker_id_invalid");
  const result = await pool.query(
    `UPDATE portal_submissions
     SET status_check_locked_at = NULL,
         status_check_locked_by = NULL,
         updated_at = now()
     WHERE id = ANY($1::int[]) AND status_check_locked_by = $2`,
    [input.submissionIds, workerId],
  );
  return result.rowCount ?? 0;
}

/**
 * Atomically claims a fair, bounded batch across independent portal-account
 * lanes. SKIP LOCKED makes overlapping API instances safe; a full/broken lane
 * cannot prevent another university lane from being selected.
 */
export async function claimDuePortalStatusChecks(input: {
  workerId: string;
  maxLanes?: number;
  rowsPerLane?: number;
  staleLeaseMs?: number;
}): Promise<ClaimedPortalStatusCheck[]> {
  const workerId = input.workerId.trim();
  if (!workerId || workerId.length > 160) throw new Error("worker_id_invalid");
  const maxLanes = input.maxLanes ?? 4;
  const rowsPerLane = input.rowsPerLane ?? 10;
  const staleLeaseMs = input.staleLeaseMs ?? 10 * 60_000;
  requireBoundedInteger("maxLanes", maxLanes, 1, MAX_STATUS_LANES);
  requireBoundedInteger("rowsPerLane", rowsPerLane, 1, MAX_STATUS_ROWS_PER_LANE);
  requireBoundedInteger("staleLeaseMs", staleLeaseMs, 60_000, 60 * 60_000);

  const result = await pool.query<ClaimedPortalStatusCheck>(
    `WITH due_lanes AS (
       SELECT
         lower(adapter_key) AS adapter_key,
         lower(university_key) AS university_key,
         min(status_check_next_at) AS oldest_due
       FROM portal_submissions
       WHERE status = 'submitted'
         AND deleted_at IS NULL
         AND external_ref IS NOT NULL
         AND btrim(external_ref) <> ''
         AND adapter_key IS NOT NULL
         AND btrim(adapter_key) <> ''
         AND status_check_suspended_at IS NULL
         AND status_check_next_at <= now()
         AND (
           status_check_locked_at IS NULL
           OR status_check_locked_at < now() - ($4::bigint * interval '1 millisecond')
         )
       GROUP BY lower(adapter_key), lower(university_key)
       ORDER BY oldest_due ASC, lower(adapter_key), lower(university_key)
       LIMIT $2
     ), candidates AS (
       SELECT picked.id
       FROM due_lanes lane
       CROSS JOIN LATERAL (
         SELECT submission.id
         FROM portal_submissions submission
         WHERE lower(submission.adapter_key) = lane.adapter_key
           AND lower(submission.university_key) = lane.university_key
           AND submission.status = 'submitted'
           AND submission.deleted_at IS NULL
           AND submission.external_ref IS NOT NULL
           AND btrim(submission.external_ref) <> ''
           AND submission.status_check_suspended_at IS NULL
           AND submission.status_check_next_at <= now()
           AND (
             submission.status_check_locked_at IS NULL
             OR submission.status_check_locked_at < now() - ($4::bigint * interval '1 millisecond')
           )
         ORDER BY submission.status_check_next_at ASC, submission.id ASC
         LIMIT $3
         FOR UPDATE OF submission SKIP LOCKED
       ) picked
     ), claimed AS (
       UPDATE portal_submissions submission
       SET status_check_locked_at = now(),
           status_check_locked_by = $1,
           updated_at = now()
       FROM candidates
       WHERE submission.id = candidates.id
       RETURNING
         submission.id,
         submission.application_id AS "applicationId",
         submission.student_id AS "studentId",
         submission.university_key AS "universityKey",
         submission.adapter_key AS "adapterKey",
         submission.external_ref AS "externalRef",
         submission.result_json AS "resultJson",
         submission.status_check_attempts AS "statusCheckAttempts"
     )
     SELECT *, lower("adapterKey") || ':' || lower("universityKey") AS "laneKey"
     FROM claimed
     ORDER BY "laneKey", id`,
    [workerId, maxLanes, rowsPerLane, staleLeaseMs],
  );
  return result.rows;
}

export async function completePortalStatusCheck(input: {
  submissionId: number;
  workerId: string;
  nextCheckAt: Date;
}): Promise<boolean> {
  if (!Number.isFinite(input.nextCheckAt.getTime())) {
    throw new Error("next_check_at_invalid");
  }
  const result = await pool.query(
    `UPDATE portal_submissions
     SET status_check_attempts = 0,
         status_check_next_at = $3,
         status_check_last_at = now(),
         status_check_error = NULL,
         status_check_locked_at = NULL,
         status_check_locked_by = NULL,
         updated_at = now()
     WHERE id = $1 AND status_check_locked_by = $2`,
    [input.submissionId, input.workerId, input.nextCheckAt],
  );
  return (result.rowCount ?? 0) === 1;
}

export async function heartbeatPortalStatusCheck(input: {
  submissionId: number;
  workerId: string;
}): Promise<boolean> {
  const result = await pool.query(
    `UPDATE portal_submissions
     SET status_check_locked_at = now(), updated_at = now()
     WHERE id = $1
       AND status = 'submitted'
       AND status_check_locked_by = $2`,
    [input.submissionId, input.workerId],
  );
  return (result.rowCount ?? 0) === 1;
}

export async function failPortalStatusCheck(input: {
  submissionId: number;
  workerId: string;
  currentFailedAttempts: number;
  error: unknown;
  now?: Date;
}): Promise<PortalStatusRetryPlan & { updated: boolean; errorCode: PortalStatusFailureCode }> {
  const plan = planPortalStatusRetry({
    submissionId: input.submissionId,
    failedAttempts: input.currentFailedAttempts + 1,
    now: input.now,
  });
  const errorCode = classifyPortalStatusFailure(input.error);
  const result = await pool.query(
    `UPDATE portal_submissions
     SET status_check_attempts = $3,
         status_check_next_at = $4,
         status_check_last_at = now(),
         status_check_error = $5,
         status_check_suspended_at = CASE WHEN $6 THEN now() ELSE NULL END,
         status_check_locked_at = NULL,
         status_check_locked_by = NULL,
         updated_at = now()
     WHERE id = $1
       AND status_check_locked_by = $2
       AND status_check_attempts = $7`,
    [
      input.submissionId,
      input.workerId,
      plan.failedAttempts,
      plan.nextCheckAt,
      errorCode,
      plan.suspended,
      input.currentFailedAttempts,
    ],
  );
  return { ...plan, updated: (result.rowCount ?? 0) === 1, errorCode };
}
