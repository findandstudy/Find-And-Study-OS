import type { Pool, PoolClient, QueryResultRow } from "pg";

import {
  type StudentDocumentRequestAccessDecisionReceipt,
  type StudentDocumentRequestResponseAudit,
  type StudentDocumentRequestResponseReceipt,
  type StudentDocumentRequestResponseStore,
  type StudentDocumentRequestResponseTransaction,
  type StudentDocumentRequestSnapshot,
  type StudentDocumentResponseClaim,
  type StudentDocumentResponseClaimResult,
} from "./studentDocumentRequestResponseCommand.js";

const UUID_V7_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/;
const ROLE_RE = /^[a-z_][a-z0-9_]{0,62}$/;
const DEFAULT_LOCK_TIMEOUT_MS = 2_500;
const DEFAULT_STATEMENT_TIMEOUT_MS = 8_000;
const DEFAULT_IDLE_TRANSACTION_TIMEOUT_MS = 12_000;
const MAX_TRANSACTION_ATTEMPTS = 3;

type CommandRow = QueryResultRow & {
  commandHash: string;
  status: "CLAIMED" | "COMMITTED";
  receiptPayload: unknown | null;
};

type RequestRow = QueryResultRow & {
  tenantId: string;
  subjectRef: string;
  applicationRef: string;
  requestRef: string;
  version: string | number;
  state: StudentDocumentRequestSnapshot["state"];
  acknowledgedAt: Date | string | null;
  respondedAt: Date | string | null;
};

export type PostgresStudentDocumentRequestResponseStoreOptions = {
  pool: Pool;
  expectedRole: string;
  lockTimeoutMs?: number;
  statementTimeoutMs?: number;
  idleTransactionTimeoutMs?: number;
};

export class PostgresStudentDocumentResponseCommitOutcomeUnknownError extends Error {
  constructor() {
    super("student_document_response_commit_outcome_unknown");
    this.name = "PostgresStudentDocumentResponseCommitOutcomeUnknownError";
  }
}

function isBoundedTimeout(value: unknown, maximum: number): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= maximum;
}

function requireUuidV7(value: string, field: string): string {
  if (!UUID_V7_RE.test(value)) {
    throw new Error(`student_document_response_${field}_invalid`);
  }
  return value.toLowerCase();
}

function requireSha256(value: string, field: string): string {
  if (!SHA256_RE.test(value)) {
    throw new Error(`student_document_response_${field}_invalid`);
  }
  return value;
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error("student_document_response_timestamp_invalid");
  }
  return date.toISOString();
}

function isRetryableTransactionError(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    "code" in value &&
    (value.code === "40001" || value.code === "40P01")
  );
}

async function rollback(client: PoolClient): Promise<Error | undefined> {
  try {
    await client.query("ROLLBACK");
    return undefined;
  } catch (error) {
    return error instanceof Error
      ? error
      : new Error("student_document_response_rollback_failed");
  }
}

class PostgresStudentDocumentRequestResponseTransaction
  implements StudentDocumentRequestResponseTransaction
{
  constructor(private readonly client: PoolClient) {}

  async revalidateAuthorityForUpdate(input: {
    authority: Parameters<
      StudentDocumentRequestResponseTransaction["revalidateAuthorityForUpdate"]
    >[0]["authority"];
    occurredAt: string;
  }): Promise<boolean> {
    const tenantId = requireUuidV7(input.authority.tenantId, "tenant_id");
    const subjectId = requireUuidV7(input.authority.subjectRef, "subject_ref");
    const applicationCaseId = requireUuidV7(
      input.authority.applicationRef,
      "application_ref",
    );
    const documentRequestId = requireUuidV7(
      input.authority.requestRef,
      "request_ref",
    );
    const occurredAt = iso(input.occurredAt);
    if (!occurredAt) return false;

    const result = await this.client.query<{ authorized: boolean }>(
      `SELECT fas_journey_v1.revalidate_document_request_response_authority(
         $1::uuid, $2::uuid, $3::bigint, $4::uuid, $5::uuid,
         $6::timestamptz, $7::uuid, $8::uuid, $9::uuid, $10::uuid
       ) AS authorized`,
      [
        tenantId,
        requireUuidV7(input.authority.selectionId, "selection_id"),
        input.authority.sessionGeneration,
        requireUuidV7(input.authority.actorPrincipalId, "principal_id"),
        requireUuidV7(input.authority.actorMembershipId, "membership_id"),
        occurredAt,
        requireUuidV7(input.authority.policyVersionId, "policy_version_id"),
        subjectId,
        applicationCaseId,
        documentRequestId,
      ],
    );
    return result.rowCount === 1 && result.rows[0]?.authorized === true;
  }

  async claimCommand(
    claim: StudentDocumentResponseClaim,
  ): Promise<StudentDocumentResponseClaimResult> {
    const tenantId = requireUuidV7(claim.tenantId, "tenant_id");
    requireSha256(claim.idempotencyKeyHash, "idempotency_hash");
    requireSha256(claim.commandHash, "command_hash");
    const inserted = await this.client.query(
      `INSERT INTO journey_document_response_commands (
         tenant_id, idempotency_key_hash, command_hash
       ) VALUES ($1::uuid, $2::text, $3::text)
       ON CONFLICT (tenant_id, idempotency_key_hash) DO NOTHING
       RETURNING 1`,
      [tenantId, claim.idempotencyKeyHash, claim.commandHash],
    );
    if (inserted.rowCount === 1) return { status: "CLAIMED" };

    const existing = await this.client.query<CommandRow>(
      `SELECT command.command_hash AS "commandHash",
              command.status,
              receipt.receipt_payload AS "receiptPayload"
       FROM journey_document_response_commands command
       LEFT JOIN journey_document_response_receipts receipt
         ON receipt.tenant_id = command.tenant_id
        AND receipt.id = command.response_receipt_id
       WHERE command.tenant_id = $1::uuid
         AND command.idempotency_key_hash = $2::text
       FOR UPDATE OF command`,
      [tenantId, claim.idempotencyKeyHash],
    );
    if (existing.rowCount !== 1 || !existing.rows[0]) {
      throw new Error("student_document_response_claim_missing");
    }
    const row = existing.rows[0];
    if (row.commandHash !== claim.commandHash) {
      return { status: "CONFLICT", commandHash: row.commandHash };
    }
    if (row.status === "COMMITTED") {
      if (!row.receiptPayload || typeof row.receiptPayload !== "object") {
        throw new Error("student_document_response_claim_receipt_missing");
      }
      return {
        status: "COMMITTED",
        commandHash: row.commandHash,
        receipt: row.receiptPayload as StudentDocumentRequestResponseReceipt,
      };
    }
    return { status: "IN_PROGRESS", commandHash: row.commandHash };
  }

  async loadRequestForUpdate(input: {
    tenantId: string;
    subjectRef: string;
    applicationRef: string;
    requestRef: string;
  }): Promise<StudentDocumentRequestSnapshot | null> {
    const result = await this.client.query<RequestRow>(
      `SELECT tenant_id AS "tenantId",
              subject_id::text AS "subjectRef",
              application_case_id::text AS "applicationRef",
              id::text AS "requestRef",
              version,
              state,
              acknowledged_at AS "acknowledgedAt",
              responded_at AS "respondedAt"
       FROM journey_document_requests
       WHERE tenant_id = $1::uuid
         AND subject_id = $2::uuid
         AND application_case_id = $3::uuid
         AND id = $4::uuid
       FOR UPDATE`,
      [
        requireUuidV7(input.tenantId, "tenant_id"),
        requireUuidV7(input.subjectRef, "subject_ref"),
        requireUuidV7(input.applicationRef, "application_ref"),
        requireUuidV7(input.requestRef, "request_ref"),
      ],
    );
    const row = result.rows[0];
    if (!row) return null;
    const version = Number(row.version);
    if (!Number.isSafeInteger(version) || version <= 0) {
      throw new Error("student_document_response_request_version_invalid");
    }
    return {
      tenantId: row.tenantId,
      subjectRef: row.subjectRef,
      applicationRef: row.applicationRef,
      requestRef: row.requestRef,
      version,
      state: row.state,
      acknowledgedAt: iso(row.acknowledgedAt),
      respondedAt: iso(row.respondedAt),
    };
  }

  async consumeIngestReceipt(input: {
    tenantId: string;
    ingestReceiptId: string;
    ingestReceiptHash: string;
    subjectRef: string;
    applicationRef: string;
    requestRef: string;
    occurredAt: string;
    commandReceiptId: string;
  }): Promise<boolean> {
    const result = await this.client.query(
      `INSERT INTO journey_document_ingest_consumptions (
         tenant_id, ingest_receipt_id, command_receipt_id, consumed_at
       )
       SELECT receipt.tenant_id, receipt.id, $8::uuid, $7::timestamptz
       FROM journey_document_ingest_receipts receipt
       WHERE receipt.tenant_id = $1::uuid
         AND receipt.id = $2::uuid
         AND receipt.receipt_hash = $3::text
         AND receipt.subject_id = $4::uuid
         AND receipt.application_case_id = $5::uuid
         AND receipt.document_request_id = $6::uuid
         AND receipt.scan_status = 'PASSED'
         AND receipt.occurred_at <= $7::timestamptz
       ON CONFLICT (tenant_id, ingest_receipt_id) DO NOTHING
       RETURNING 1`,
      [
        requireUuidV7(input.tenantId, "tenant_id"),
        requireUuidV7(input.ingestReceiptId, "ingest_receipt_id"),
        requireSha256(input.ingestReceiptHash, "ingest_receipt_hash"),
        requireUuidV7(input.subjectRef, "subject_ref"),
        requireUuidV7(input.applicationRef, "application_ref"),
        requireUuidV7(input.requestRef, "request_ref"),
        iso(input.occurredAt),
        requireUuidV7(input.commandReceiptId, "command_receipt_id"),
      ],
    );
    return result.rowCount === 1;
  }

  async updateRequest(input: {
    tenantId: string;
    subjectRef: string;
    applicationRef: string;
    requestRef: string;
    expectedVersion: number;
    nextVersion: number;
    nextState: StudentDocumentRequestSnapshot["state"];
    acknowledgedAt: string;
    respondedAt: string | null;
  }): Promise<boolean> {
    const result = await this.client.query(
      `UPDATE journey_document_requests
       SET version = $5::bigint,
           state = $6::text,
           acknowledged_at = $7::timestamptz,
           responded_at = $8::timestamptz,
           updated_at = $7::timestamptz
       WHERE tenant_id = $1::uuid
         AND subject_id = $2::uuid
         AND application_case_id = $3::uuid
         AND id = $4::uuid
         AND version = $9::bigint`,
      [
        requireUuidV7(input.tenantId, "tenant_id"),
        requireUuidV7(input.subjectRef, "subject_ref"),
        requireUuidV7(input.applicationRef, "application_ref"),
        requireUuidV7(input.requestRef, "request_ref"),
        input.nextVersion,
        input.nextState,
        iso(input.acknowledgedAt),
        input.respondedAt ? iso(input.respondedAt) : null,
        input.expectedVersion,
      ],
    );
    return result.rowCount === 1;
  }

  async insertAccessDecisionReceipt(
    receipt: StudentDocumentRequestAccessDecisionReceipt,
  ): Promise<void> {
    await this.client.query(
      `INSERT INTO journey_document_access_receipts (
         id, tenant_id, document_request_id, subject_id, application_case_id,
         context_id, selection_id, session_generation, actor_principal_id,
         actor_membership_id, policy_version_id, capability_key, decision,
         correlation_id, occurred_at
       ) VALUES (
         $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
         $6::uuid, $7::uuid, $8::bigint, $9::uuid, $10::uuid,
         $11::uuid, $12::text, $13::text, $14::text, $15::timestamptz
       )`,
      [
        receipt.id,
        receipt.tenantId,
        receipt.requestRef,
        receipt.subjectRef,
        receipt.applicationRef,
        receipt.contextId,
        receipt.selectionId,
        receipt.sessionGeneration,
        receipt.actorPrincipalId,
        receipt.actorMembershipId,
        receipt.policyVersionId,
        receipt.capabilityKey,
        receipt.decision,
        receipt.correlationId,
        receipt.occurredAt,
      ],
    );
  }

  async insertResponseReceipt(
    receipt: StudentDocumentRequestResponseReceipt,
  ): Promise<void> {
    await this.client.query(
      `INSERT INTO journey_document_response_receipts (
         id, tenant_id, document_request_id, subject_id, application_case_id,
         command_id, access_decision_receipt_id, actor_principal_id,
         actor_membership_id, context_id, selection_id, session_generation,
         policy_version_id, response_kind, from_state, to_state,
         previous_version, next_version, acknowledged_at, responded_at,
         ingest_receipt_id, ingest_receipt_hash, idempotency_key_hash,
         command_hash, audit_correlation_id, occurred_at, receipt_hash,
         receipt_payload
       ) VALUES (
         $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
         $6::uuid, $7::uuid, $8::uuid, $9::uuid, $10::uuid,
         $11::uuid, $12::bigint, $13::uuid, $14::text, $15::text,
         $16::text, $17::bigint, $18::bigint, $19::timestamptz,
         $20::timestamptz, $21::uuid, $22::text, $23::text, $24::text,
         $25::text, $26::timestamptz, $27::text, $28::jsonb
       )`,
      [
        receipt.id,
        receipt.tenantId,
        receipt.requestRef,
        receipt.subjectRef,
        receipt.applicationRef,
        receipt.commandId,
        receipt.accessDecisionReceiptId,
        receipt.actorPrincipalId,
        receipt.actorMembershipId,
        receipt.contextId,
        receipt.selectionId,
        receipt.sessionGeneration,
        receipt.policyVersionId,
        receipt.responseKind,
        receipt.fromState,
        receipt.toState,
        receipt.previousVersion,
        receipt.nextVersion,
        receipt.acknowledgedAt,
        receipt.respondedAt,
        receipt.ingestReceiptId,
        receipt.ingestReceiptHash,
        receipt.idempotencyKeyHash,
        receipt.commandHash,
        receipt.auditCorrelationId,
        receipt.occurredAt,
        receipt.receiptHash,
        JSON.stringify(receipt),
      ],
    );
  }

  async insertAudit(audit: StudentDocumentRequestResponseAudit): Promise<void> {
    await this.client.query(
      `INSERT INTO journey_document_response_audits (
         id, tenant_id, command_receipt_id, access_decision_receipt_id,
         actor_principal_id, actor_membership_id, context_id, subject_id,
         application_case_id, document_request_id, response_kind, from_state,
         to_state, previous_version, next_version, ingest_receipt_id,
         correlation_id, occurred_at, audit_hash, audit_payload
       ) VALUES (
         $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
         $6::uuid, $7::uuid, $8::uuid, $9::uuid, $10::uuid,
         $11::text, $12::text, $13::text, $14::bigint, $15::bigint,
         $16::uuid, $17::text, $18::timestamptz, $19::text, $20::jsonb
       )`,
      [
        audit.id,
        audit.tenantId,
        audit.commandReceiptId,
        audit.accessDecisionReceiptId,
        audit.actorPrincipalId,
        audit.actorMembershipId,
        audit.contextId,
        audit.subjectRef,
        audit.applicationRef,
        audit.requestRef,
        audit.responseKind,
        audit.fromState,
        audit.toState,
        audit.previousVersion,
        audit.nextVersion,
        audit.ingestReceiptId,
        audit.correlationId,
        audit.occurredAt,
        audit.auditHash,
        JSON.stringify(audit),
      ],
    );
  }

  async completeCommandClaim(input: {
    tenantId: string;
    idempotencyKeyHash: string;
    commandHash: string;
    receipt: StudentDocumentRequestResponseReceipt;
  }): Promise<void> {
    const result = await this.client.query(
      `UPDATE journey_document_response_commands
       SET status = 'COMMITTED',
           response_receipt_id = $4::uuid,
           completed_at = $5::timestamptz
       WHERE tenant_id = $1::uuid
         AND idempotency_key_hash = $2::text
         AND command_hash = $3::text
         AND status = 'CLAIMED'
         AND response_receipt_id IS NULL`,
      [
        input.tenantId,
        input.idempotencyKeyHash,
        input.commandHash,
        input.receipt.id,
        input.receipt.occurredAt,
      ],
    );
    if (result.rowCount !== 1) {
      throw new Error("student_document_response_claim_completion_conflict");
    }
  }
}

export class PostgresStudentDocumentRequestResponseStore
  implements StudentDocumentRequestResponseStore
{
  private readonly pool: Pool;
  private readonly expectedRole: string;
  private readonly lockTimeoutMs: number;
  private readonly statementTimeoutMs: number;
  private readonly idleTransactionTimeoutMs: number;

  constructor(options: PostgresStudentDocumentRequestResponseStoreOptions) {
    if (!options?.pool || !ROLE_RE.test(options.expectedRole)) {
      throw new Error("student_document_response_store_configuration_invalid");
    }
    const lockTimeoutMs = options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
    const statementTimeoutMs =
      options.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS;
    const idleTransactionTimeoutMs =
      options.idleTransactionTimeoutMs ?? DEFAULT_IDLE_TRANSACTION_TIMEOUT_MS;
    if (
      !isBoundedTimeout(lockTimeoutMs, 10_000) ||
      !isBoundedTimeout(statementTimeoutMs, 15_000) ||
      !isBoundedTimeout(idleTransactionTimeoutMs, 30_000) ||
      lockTimeoutMs > statementTimeoutMs ||
      statementTimeoutMs >= idleTransactionTimeoutMs
    ) {
      throw new Error("student_document_response_store_configuration_invalid");
    }
    this.pool = options.pool;
    this.expectedRole = options.expectedRole;
    this.lockTimeoutMs = lockTimeoutMs;
    this.statementTimeoutMs = statementTimeoutMs;
    this.idleTransactionTimeoutMs = idleTransactionTimeoutMs;
  }

  async transaction<T>(
    tenantIdInput: string,
    operation: (tx: StudentDocumentRequestResponseTransaction) => Promise<T>,
  ): Promise<T> {
    const tenantId = requireUuidV7(tenantIdInput, "tenant_id");
    if (typeof operation !== "function") {
      throw new Error("student_document_response_operation_invalid");
    }

    for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
      const client = await this.pool.connect();
      let transactionStarted = false;
      let releaseWithError: Error | undefined;
      try {
        const identity = await client.query<{
          currentUser: string;
          tenantSetting: string | null;
        }>(
          `SELECT current_user AS "currentUser",
                  nullif(current_setting('app.tenant_id', true), '') AS "tenantSetting"`,
        );
        if (
          identity.rowCount !== 1 ||
          identity.rows[0]?.currentUser !== this.expectedRole ||
          identity.rows[0]?.tenantSetting !== null
        ) {
          throw new Error("student_document_response_executor_identity_invalid");
        }

        await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
        transactionStarted = true;
        await client.query(
          `SELECT set_config('app.tenant_id', $1, true),
                  set_config('lock_timeout', $2, true),
                  set_config('statement_timeout', $3, true),
                  set_config('idle_in_transaction_session_timeout', $4, true)`,
          [
            tenantId,
            `${this.lockTimeoutMs}ms`,
            `${this.statementTimeoutMs}ms`,
            `${this.idleTransactionTimeoutMs}ms`,
          ],
        );
        const result = await operation(
          new PostgresStudentDocumentRequestResponseTransaction(client),
        );
        try {
          await client.query("COMMIT");
          transactionStarted = false;
        } catch (commitError) {
          transactionStarted = false;
          releaseWithError =
            commitError instanceof Error
              ? commitError
              : new Error("student_document_response_commit_failed");
          if (isRetryableTransactionError(commitError) && attempt < MAX_TRANSACTION_ATTEMPTS) {
            continue;
          }
          throw new PostgresStudentDocumentResponseCommitOutcomeUnknownError();
        }
        return result;
      } catch (error) {
        if (transactionStarted) {
          releaseWithError = await rollback(client);
          transactionStarted = false;
        }
        if (isRetryableTransactionError(error) && attempt < MAX_TRANSACTION_ATTEMPTS) {
          continue;
        }
        throw error instanceof Error
          ? error
          : new Error("student_document_response_transaction_failed");
      } finally {
        client.release(releaseWithError);
      }
    }
    throw new Error("student_document_response_retry_budget_exhausted");
  }
}

export function createPostgresStudentDocumentRequestResponseStore(
  options: PostgresStudentDocumentRequestResponseStoreOptions,
): PostgresStudentDocumentRequestResponseStore {
  return new PostgresStudentDocumentRequestResponseStore(options);
}
