import crypto from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";

import {
  ACTIVE_SESSION_SELECTION_COMMAND_RECEIPT_V1,
} from "./activeContextSelectionConsumptionAttempt";
import type {
  PendingSelectionConsumptionAttempt,
  SelectionConsumptionRepairStore,
  SelectionConsumptionStoredOutcome,
} from "./activeContextSelectionConsumptionRepairWorker";

const UUID_V7_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/;
const IDENTIFIER_RE = /^[a-z][a-z0-9-]{1,62}$/;
const ROLE_RE = /^[a-z_][a-z0-9_]{0,62}$/;
const DEFAULT_LEASE_SECONDS = 60;
const DEFAULT_LOCK_TIMEOUT_MS = 2_500;
const DEFAULT_STATEMENT_TIMEOUT_MS = 5_000;
const DEFAULT_IDLE_TRANSACTION_TIMEOUT_MS = 10_000;

type RpcRow = QueryResultRow & { result: unknown };

export type PostgresActiveContextSelectionConsumptionRepairStoreOptions = {
  pool: Pool;
  expectedRole: string;
  leaseSeconds?: number;
  lockTimeoutMs?: number;
  statementTimeoutMs?: number;
  idleTransactionTimeoutMs?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  return Object.keys(value).sort().join("\0") === [...expected].sort().join("\0");
}

function isTimeout(value: unknown, maximum: number): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= maximum;
}

function parseAttempt(
  value: unknown,
  leaseToken: string,
): PendingSelectionConsumptionAttempt | null {
  if (!isRecord(value)) return null;
  if (
    !exactKeys(value, [
      "attemptCount", "attemptId", "cellId", "contextId", "environmentId",
      "idempotencyKeyHash", "maxAttempts", "membershipId", "outcomeSource",
      "principalId", "requestHash", "selectionId", "sessionGeneration", "status",
      "tenantId",
    ]) ||
    !UUID_V7_RE.test(String(value.attemptId)) ||
    !UUID_RE.test(String(value.tenantId)) ||
    !UUID_V7_RE.test(String(value.contextId)) ||
    !UUID_RE.test(String(value.selectionId)) ||
    !UUID_RE.test(String(value.principalId)) ||
    !UUID_RE.test(String(value.membershipId)) ||
    !Number.isSafeInteger(value.sessionGeneration) ||
    Number(value.sessionGeneration) <= 0 ||
    !SHA256_RE.test(String(value.idempotencyKeyHash)) ||
    !SHA256_RE.test(String(value.requestHash)) ||
    !IDENTIFIER_RE.test(String(value.environmentId)) ||
    !IDENTIFIER_RE.test(String(value.cellId)) ||
    value.outcomeSource !== ACTIVE_SESSION_SELECTION_COMMAND_RECEIPT_V1 ||
    value.status !== "PENDING" ||
    !Number.isSafeInteger(value.attemptCount) ||
    Number(value.attemptCount) < 1 ||
    !Number.isSafeInteger(value.maxAttempts) ||
    Number(value.maxAttempts) < Number(value.attemptCount) ||
    Number(value.maxAttempts) > 12
  ) {
    return null;
  }
  return { ...(value as Omit<PendingSelectionConsumptionAttempt, "leaseToken">), leaseToken };
}

function parseOutcome(value: unknown): SelectionConsumptionStoredOutcome | null {
  if (!isRecord(value) || typeof value.state !== "string") return null;
  if (["NOT_FOUND", "IN_PROGRESS", "INVALID"].includes(value.state)) {
    return exactKeys(value, ["state"])
      ? (value as SelectionConsumptionStoredOutcome)
      : null;
  }
  if (
    value.state !== "COMPLETED" ||
    !exactKeys(value, ["resultHash", "state"]) ||
    !SHA256_RE.test(String(value.resultHash))
  ) {
    return null;
  }
  return value as SelectionConsumptionStoredOutcome;
}

function validAttempt(value: PendingSelectionConsumptionAttempt): boolean {
  return Boolean(
    value &&
    UUID_V7_RE.test(value.attemptId) &&
    UUID_RE.test(value.tenantId) &&
    SHA256_RE.test(value.leaseToken),
  );
}

export class PostgresActiveContextSelectionConsumptionRepairStore
  implements SelectionConsumptionRepairStore
{
  private readonly pool: Pool;
  private readonly expectedRole: string;
  private readonly leaseSeconds: number;
  private readonly lockTimeoutMs: number;
  private readonly statementTimeoutMs: number;
  private readonly idleTransactionTimeoutMs: number;

  constructor(options: PostgresActiveContextSelectionConsumptionRepairStoreOptions) {
    const leaseSeconds = options?.leaseSeconds ?? DEFAULT_LEASE_SECONDS;
    const lockTimeoutMs = options?.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
    const statementTimeoutMs = options?.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS;
    const idleTransactionTimeoutMs =
      options?.idleTransactionTimeoutMs ?? DEFAULT_IDLE_TRANSACTION_TIMEOUT_MS;
    if (
      !options?.pool ||
      !ROLE_RE.test(options.expectedRole) ||
      !Number.isSafeInteger(leaseSeconds) ||
      leaseSeconds < 30 || leaseSeconds > 300 ||
      !isTimeout(lockTimeoutMs, 10_000) ||
      !isTimeout(statementTimeoutMs, 15_000) ||
      !isTimeout(idleTransactionTimeoutMs, 30_000) ||
      lockTimeoutMs > statementTimeoutMs ||
      statementTimeoutMs >= idleTransactionTimeoutMs
    ) {
      throw new Error("active_context_selection_repair_store_configuration_invalid");
    }
    this.pool = options.pool;
    this.expectedRole = options.expectedRole;
    this.leaseSeconds = leaseSeconds;
    this.lockTimeoutMs = lockTimeoutMs;
    this.statementTimeoutMs = statementTimeoutMs;
    this.idleTransactionTimeoutMs = idleTransactionTimeoutMs;
  }

  private async transaction<T>(
    tenantId: string,
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    if (!UUID_RE.test(tenantId)) {
      throw new Error("active_context_selection_repair_store_tenant_invalid");
    }
    const normalizedTenant = tenantId.toLowerCase();
    const client = await this.pool.connect();
    let transactionStarted = false;
    let releaseError: Error | undefined;
    try {
      const identity = await client.query<{
        current_user: string;
        tenant_setting: string | null;
      }>(
        `SELECT current_user,
                nullif(current_setting('app.tenant_id', true), '') AS tenant_setting`,
      );
      if (
        identity.rowCount !== 1 ||
        identity.rows[0]?.current_user !== this.expectedRole ||
        identity.rows[0]?.tenant_setting !== null
      ) {
        throw new Error("active_context_selection_repair_store_identity_invalid");
      }
      await client.query("BEGIN");
      transactionStarted = true;
      await client.query(
        `SELECT set_config('lock_timeout', $1, true),
                set_config('statement_timeout', $2, true),
                set_config('idle_in_transaction_session_timeout', $3, true),
                set_config('app.tenant_id', $4, true)`,
        [
          `${this.lockTimeoutMs}ms`, `${this.statementTimeoutMs}ms`,
          `${this.idleTransactionTimeoutMs}ms`, normalizedTenant,
        ],
      );
      const result = await operation(client);
      await client.query("COMMIT");
      transactionStarted = false;
      return result;
    } catch (error) {
      if (transactionStarted) {
        try {
          await client.query("ROLLBACK");
          transactionStarted = false;
        } catch (rollbackError) {
          releaseError = rollbackError instanceof Error
            ? rollbackError
            : new Error("active_context_selection_repair_store_rollback_failed");
        }
      }
      throw error instanceof Error
        ? error
        : new Error("active_context_selection_repair_store_transaction_failed");
    } finally {
      client.release(releaseError);
    }
  }

  private async rpc<T>(
    tenantId: string,
    name:
      | "claim_due_attempt"
      | "load_selection_command_outcome"
      | "reschedule_attempt"
      | "complete_attempt",
    values: readonly unknown[],
  ): Promise<T> {
    return this.transaction(tenantId, async (client) => {
      const placeholders = values.map((_, index) => `$${index + 1}`).join(", ");
      const result = await client.query<RpcRow>(
        `SELECT fas_session_repair_v1.${name}(${placeholders}) AS result`,
        [...values],
      );
      if (result.rowCount !== 1) {
        throw new Error("active_context_selection_repair_store_rpc_cardinality");
      }
      return result.rows[0]?.result as T;
    });
  }

  async claimDue(tenantId: string): Promise<PendingSelectionConsumptionAttempt | null> {
    const normalizedTenant = tenantId.toLowerCase();
    const leaseToken = crypto.randomBytes(32).toString("hex");
    const value = await this.rpc<unknown>(normalizedTenant, "claim_due_attempt", [
      normalizedTenant, leaseToken, this.leaseSeconds,
    ]);
    if (value === null) return null;
    const attempt = parseAttempt(value, leaseToken);
    if (!attempt || attempt.tenantId !== normalizedTenant) {
      throw new Error("active_context_selection_repair_store_attempt_invalid");
    }
    return attempt;
  }

  async loadOutcome(
    attempt: PendingSelectionConsumptionAttempt,
  ): Promise<SelectionConsumptionStoredOutcome> {
    if (!validAttempt(attempt)) {
      throw new Error("active_context_selection_repair_store_attempt_invalid");
    }
    const value = await this.rpc<unknown>(
      attempt.tenantId,
      "load_selection_command_outcome",
      [attempt.tenantId, attempt.attemptId, attempt.leaseToken],
    );
    const outcome = parseOutcome(value);
    if (!outcome) {
      throw new Error("active_context_selection_repair_store_outcome_invalid");
    }
    return outcome;
  }

  async reschedule(
    attempt: PendingSelectionConsumptionAttempt,
    reason: "NOT_FOUND" | "IN_PROGRESS",
  ): Promise<void> {
    if (!validAttempt(attempt) || !["NOT_FOUND", "IN_PROGRESS"].includes(reason)) {
      throw new Error("active_context_selection_repair_store_retry_invalid");
    }
    const delaySeconds = Math.min(300, 5 * 2 ** (attempt.attemptCount - 1));
    await this.rpc<void>(attempt.tenantId, "reschedule_attempt", [
      attempt.tenantId, attempt.attemptId, attempt.leaseToken, delaySeconds,
      reason === "NOT_FOUND" ? "OUTCOME_NOT_FOUND" : "OUTCOME_IN_PROGRESS",
    ]);
  }

  async resolve(attempt: PendingSelectionConsumptionAttempt): Promise<void> {
    if (!validAttempt(attempt)) {
      throw new Error("active_context_selection_repair_store_resolution_invalid");
    }
    await this.rpc<void>(attempt.tenantId, "complete_attempt", [
      attempt.tenantId, attempt.attemptId, attempt.leaseToken,
      "RESOLVED", "RECEIPT_CONFIRMED", null,
    ]);
  }

  async escalate(
    attempt: PendingSelectionConsumptionAttempt,
    reason: "INVALID" | "NOT_FOUND" | "IN_PROGRESS",
  ): Promise<void> {
    if (!validAttempt(attempt) || !["INVALID", "NOT_FOUND", "IN_PROGRESS"].includes(reason)) {
      throw new Error("active_context_selection_repair_store_escalation_invalid");
    }
    const mapping = reason === "INVALID"
      ? ["INVALID_RECEIPT", "OUTCOME_INVALID"]
      : reason === "NOT_FOUND"
        ? ["NO_RECEIPT", "OUTCOME_NOT_FOUND"]
        : ["INCOMPLETE_RECEIPT", "OUTCOME_IN_PROGRESS"];
    await this.rpc<void>(attempt.tenantId, "complete_attempt", [
      attempt.tenantId, attempt.attemptId, attempt.leaseToken,
      "ESCALATED", mapping[0], mapping[1],
    ]);
  }
}
