import crypto from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import {
  assertInstitutionEvidenceShareEnabled,
  parseInstitutionEvidenceShareResult,
  validateInstitutionEvidenceShareRequest,
  type InstitutionEvidenceShareConfig,
  type InstitutionEvidenceShareRequest,
  type InstitutionEvidenceShareResult,
} from "./institutionEvidenceShare";

const EXACT_EXECUTOR_ROLE = "fas_institution_evidence_share_executor";
const MAX_ATTEMPTS = 3;

type ShareResultRow = QueryResultRow & {
  outcome: string;
  share_receipt_id: string;
  evidence_ref_hash: string;
  content_sha256: string;
  requirement_code: string;
  receipt_hash: string;
  valid_until: Date | string | null;
};

export type PostgresInstitutionEvidenceShareStoreOptions = {
  pool: Pool;
  config: InstitutionEvidenceShareConfig;
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
    return error instanceof Error ? error : new Error("institution_evidence_share_rollback_failed");
  }
}

function retryable(error: unknown): boolean {
  const code = (error as { code?: unknown })?.code;
  return code === "40001" || code === "40P01";
}

export class PostgresInstitutionEvidenceShareStore {
  private readonly pool: Pool;
  private readonly config: InstitutionEvidenceShareConfig;
  private readonly expectedRole: string;

  constructor(options: PostgresInstitutionEvidenceShareStoreOptions) {
    if (!options?.pool || (options.expectedRole && options.expectedRole !== EXACT_EXECUTOR_ROLE)) {
      throw new Error("institution_evidence_share_store_configuration_invalid");
    }
    this.pool = options.pool;
    this.config = options.config;
    this.expectedRole = options.expectedRole ?? EXACT_EXECUTOR_ROLE;
  }

  async share(input: InstitutionEvidenceShareRequest): Promise<InstitutionEvidenceShareResult> {
    const request = validateInstitutionEvidenceShareRequest(input);
    assertInstitutionEvidenceShareEnabled(this.config, request.relationshipId);

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const client = await this.pool.connect();
      let transactionStarted = false;
      let releaseError: Error | undefined;
      try {
        const identity = await client.query<{
          current_user: string;
          tenant_setting: string | null;
          relationship_setting: string | null;
          evidence_guard: string | null;
        }>(`SELECT current_user,
              nullif(current_setting('app.tenant_id', true), '') AS tenant_setting,
              nullif(current_setting('app.institution_relationship_id', true), '') AS relationship_setting,
              nullif(current_setting('app.institution_evidence_share_guard', true), '') AS evidence_guard`);
        if (
          identity.rowCount !== 1 ||
          identity.rows[0]?.current_user !== this.expectedRole ||
          identity.rows[0]?.tenant_setting !== null ||
          identity.rows[0]?.relationship_setting !== null ||
          identity.rows[0]?.evidence_guard !== null
        ) {
          throw new Error("institution_evidence_share_executor_identity_invalid");
        }

        await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
        transactionStarted = true;
        await client.query(`SELECT set_config('lock_timeout', '2500ms', true),
          set_config('statement_timeout', '8000ms', true),
          set_config('idle_in_transaction_session_timeout', '12000ms', true)`);
        const result = await client.query<ShareResultRow>(
          `SELECT * FROM fas_institution_evidence_v1.create_share_receipt(
            $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid
          )`,
          [
            request.tenantId,
            request.relationshipId,
            request.applicationCaseId,
            request.journeyEvidenceReceiptId,
            request.journeyConsentReceiptId,
            uuidV7(),
          ],
        );
        if (result.rowCount !== 1) throw new Error("institution_evidence_share_result_invalid");
        const parsed = parseInstitutionEvidenceShareResult(result.rows[0]);
        await client.query("COMMIT");
        transactionStarted = false;
        return parsed;
      } catch (error) {
        if (transactionStarted) {
          releaseError = await rollback(client);
          transactionStarted = false;
        }
        if (retryable(error) && attempt < MAX_ATTEMPTS) continue;
        throw error instanceof Error ? error : new Error("institution_evidence_share_failed");
      } finally {
        client.release(releaseError);
      }
    }
    throw new Error("institution_evidence_share_retry_budget_exhausted");
  }
}

export function createPostgresInstitutionEvidenceShareStore(
  options: PostgresInstitutionEvidenceShareStoreOptions,
): PostgresInstitutionEvidenceShareStore {
  return new PostgresInstitutionEvidenceShareStore(options);
}
