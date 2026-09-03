import crypto from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import {
  assertInstitutionCaseIntakeEnabled,
  parseInstitutionCaseIntakeResult,
  validateInstitutionCaseIntakeRequest,
  type InstitutionCaseIntakeConfig,
  type InstitutionCaseIntakeRequest,
  type InstitutionCaseIntakeResult,
} from "./institutionCaseIntake";

const EXACT_EXECUTOR_ROLE = "fas_institution_intake_executor";
const MAX_ATTEMPTS = 3;

type IntakeResultRow = QueryResultRow & {
  outcome: string;
  application_case_id: string;
  receipt_id: string;
  source_snapshot_hash: string;
  receipt_hash: string;
  masked_student_ref: string;
};

export type PostgresInstitutionCaseIntakeStoreOptions = {
  pool: Pool;
  config: InstitutionCaseIntakeConfig;
  expectedRole?: typeof EXACT_EXECUTOR_ROLE;
};

function uuidV7(observedAt = Date.now()): string {
  const bytes = crypto.randomBytes(16);
  const timestamp = BigInt(observedAt);
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = Number((timestamp >> BigInt((5 - index) * 8)) & 0xffn);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
async function rollback(client: PoolClient): Promise<Error | undefined> {
  try {
    await client.query("ROLLBACK");
    return undefined;
  } catch (error) {
    return error instanceof Error ? error : new Error("institution_case_intake_rollback_failed");
  }
}

function retryable(error: unknown): boolean {
  const code = (error as { code?: unknown })?.code;
  return code === "40001" || code === "40P01";
}

export class PostgresInstitutionCaseIntakeStore {
  private readonly pool: Pool;
  private readonly config: InstitutionCaseIntakeConfig;
  private readonly expectedRole: string;

  constructor(options: PostgresInstitutionCaseIntakeStoreOptions) {
    if (!options?.pool || (options.expectedRole && options.expectedRole !== EXACT_EXECUTOR_ROLE)) {
      throw new Error("institution_case_intake_store_configuration_invalid");
    }
    this.pool = options.pool;
    this.config = options.config;
    this.expectedRole = options.expectedRole ?? EXACT_EXECUTOR_ROLE;
  }

  async intake(input: InstitutionCaseIntakeRequest): Promise<InstitutionCaseIntakeResult> {
    const request = validateInstitutionCaseIntakeRequest(input);
    assertInstitutionCaseIntakeEnabled(this.config, request.relationshipId);

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const client = await this.pool.connect();
      let transactionStarted = false;
      let releaseError: Error | undefined;
      try {
        const identity = await client.query<{
          current_user: string;
          tenant_setting: string | null;
          relationship_setting: string | null;
          intake_guard: string | null;
        }>(`SELECT current_user,
              nullif(current_setting('app.tenant_id', true), '') AS tenant_setting,
              nullif(current_setting('app.institution_relationship_id', true), '') AS relationship_setting,
              nullif(current_setting('app.institution_intake_guard', true), '') AS intake_guard`);
        if (
          identity.rowCount !== 1 ||
          identity.rows[0]?.current_user !== this.expectedRole ||
          identity.rows[0]?.tenant_setting !== null ||
          identity.rows[0]?.relationship_setting !== null ||
          identity.rows[0]?.intake_guard !== null
        ) {
          throw new Error("institution_case_intake_executor_identity_invalid");
        }

        // The SECURITY DEFINER function takes a transaction-scoped advisory
        // lock before it checks the receipt. READ COMMITTED is intentional:
        // a SERIALIZABLE snapshot can be fixed before a concurrent caller
        // releases that lock, hiding the committed receipt and surfacing the
        // legacy-application unique constraint instead of an idempotent replay.
        await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
        transactionStarted = true;
        await client.query(`SELECT set_config('lock_timeout', '2500ms', true),
          set_config('statement_timeout', '8000ms', true),
          set_config('idle_in_transaction_session_timeout', '12000ms', true)`);
        const result = await client.query<IntakeResultRow>(
          `SELECT * FROM fas_institution_intake_v1.create_case_from_portal_submission(
            $1::uuid, $2::uuid, $3::integer, $4::uuid, $5::uuid
          )`,
          [request.tenantId, request.relationshipId, request.portalSubmissionId, uuidV7(), uuidV7()],
        );
        if (result.rowCount !== 1) throw new Error("institution_case_intake_result_invalid");
        const parsed = parseInstitutionCaseIntakeResult(result.rows[0]);
        await client.query("COMMIT");
        transactionStarted = false;
        return parsed;
      } catch (error) {
        if (transactionStarted) {
          releaseError = await rollback(client);
          transactionStarted = false;
        }
        if (retryable(error) && attempt < MAX_ATTEMPTS) continue;
        throw error instanceof Error ? error : new Error("institution_case_intake_failed");
      } finally {
        client.release(releaseError);
      }
    }
    throw new Error("institution_case_intake_retry_budget_exhausted");
  }
}

export function createPostgresInstitutionCaseIntakeStore(
  options: PostgresInstitutionCaseIntakeStoreOptions,
): PostgresInstitutionCaseIntakeStore {
  return new PostgresInstitutionCaseIntakeStore(options);
}
