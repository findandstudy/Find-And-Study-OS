import crypto from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";

import {
  PUBLIC_WEB_PUBLICATION_CAPABILITIES,
  hashPublicWebPublicationCommand,
  parsePublicWebPublicationCommand,
  type AuthorizedPublicWebPublicationCommand,
} from "./publicWebPublicationCommand.js";
import { resolvePublicWebRollout } from "./publicWebContentContract.js";

const EXACT_EXECUTOR_ROLE = "fas_public_web_executor";
const MAX_ATTEMPTS = 3;
const UUID_V7_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PublicWebPublicationStoreConfig = {
  mode: string | undefined;
  tenantAllowlist: string | undefined;
};

export type PublicWebPublicationStoreInput = {
  authorized: AuthorizedPublicWebPublicationCommand;
  actorLegacyUserId: number;
};

export type PublicWebPublicationStoreResult =
  | {
      outcome: "APPLIED";
      publicationReceiptId: string;
      status: "DRAFT" | "PENDING_REVIEW" | "APPROVED" | "PUBLISHED" | "STALE" | "RETIRED";
      indexState: "NOINDEX" | "INDEX";
      version: number;
    }
  | {
      outcome: "REPLAY";
      publicationReceiptId: string;
      status: "DRAFT" | "PENDING_REVIEW" | "APPROVED" | "PUBLISHED" | "STALE" | "RETIRED";
      indexState: "NOINDEX" | "INDEX";
    };

export type PostgresPublicWebPublicationStoreOptions = {
  pool: Pool;
  config: PublicWebPublicationStoreConfig;
  expectedRole?: typeof EXACT_EXECUTOR_ROLE;
  now?: () => number;
  newUuidV7?: (observedAt: number) => string;
};

type ResultRow = QueryResultRow & { result: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function uuidV7(observedAt: number): string {
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

function validUuidSet(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length >= 1 &&
    value.length <= 64 &&
    value.every((item) => typeof item === "string" && UUID_V7_RE.test(item)) &&
    new Set(value.map((item) => item.toLowerCase())).size === value.length
  );
}

function validateAuthorizedInput(input: PublicWebPublicationStoreInput) {
  if (
    !isRecord(input) ||
    !Number.isSafeInteger(input.actorLegacyUserId) ||
    input.actorLegacyUserId < 1 ||
    !isRecord(input.authorized)
  ) {
    throw new Error("public_web_publication_input_invalid");
  }
  const command = parsePublicWebPublicationCommand(input.authorized.command);
  const receipt = input.authorized.decisionReceipt;
  if (
    !command ||
    input.authorized.requestHash !== hashPublicWebPublicationCommand(command) ||
    input.authorized.capabilityKey !== PUBLIC_WEB_PUBLICATION_CAPABILITIES[command.type] ||
    !isRecord(receipt) ||
    !UUID_V7_RE.test(receipt.tenantId) ||
    !UUID_V7_RE.test(receipt.contextId) ||
    !UUID_V7_RE.test(receipt.actorPrincipalId) ||
    !UUID_V7_RE.test(receipt.membershipId) ||
    !UUID_V7_RE.test(receipt.policyVersionId) ||
    !validUuidSet(receipt.assignmentIds) ||
    !validUuidSet(receipt.rolePackageVersionIds) ||
    receipt.tenantId !== command.tenantId ||
    receipt.capabilityKey !== input.authorized.capabilityKey ||
    receipt.resourceType !== "PUBLIC_WEB_CONTENT" ||
    receipt.resourceId !== command.contentRecordId ||
    receipt.decision !== "ALLOW" ||
    receipt.reasonCode !== "allowed"
  ) {
    throw new Error("public_web_publication_authorization_invalid");
  }
  return { command, receipt };
}

function parseResult(value: unknown): PublicWebPublicationStoreResult {
  if (!isRecord(value)) throw new Error("public_web_publication_result_invalid");
  const statuses = ["DRAFT", "PENDING_REVIEW", "APPROVED", "PUBLISHED", "STALE", "RETIRED"];
  if (
    !UUID_V7_RE.test(String(value.publicationReceiptId)) ||
    !statuses.includes(String(value.status)) ||
    !["NOINDEX", "INDEX"].includes(String(value.indexState))
  ) {
    throw new Error("public_web_publication_result_invalid");
  }
  if (value.outcome === "REPLAY" && hasExactKeys(value, [
    "indexState", "outcome", "publicationReceiptId", "status",
  ])) {
    return value as PublicWebPublicationStoreResult;
  }
  if (
    value.outcome === "APPLIED" &&
    hasExactKeys(value, ["indexState", "outcome", "publicationReceiptId", "status", "version"]) &&
    Number.isSafeInteger(value.version) &&
    Number(value.version) > 0
  ) {
    return value as PublicWebPublicationStoreResult;
  }
  throw new Error("public_web_publication_result_invalid");
}

function retryable(error: unknown): boolean {
  const code = (error as { code?: unknown })?.code;
  return code === "40001" || code === "40P01";
}

async function rollback(client: PoolClient): Promise<Error | undefined> {
  try {
    await client.query("ROLLBACK");
    return undefined;
  } catch (error) {
    return error instanceof Error ? error : new Error("public_web_publication_rollback_failed");
  }
}

export class PostgresPublicWebPublicationStore {
  private readonly pool: Pool;
  private readonly config: PublicWebPublicationStoreConfig;
  private readonly expectedRole: string;
  private readonly now: () => number;
  private readonly newUuidV7: (observedAt: number) => string;

  constructor(options: PostgresPublicWebPublicationStoreOptions) {
    if (
      !options?.pool ||
      !isRecord(options.config) ||
      (options.expectedRole !== undefined && options.expectedRole !== EXACT_EXECUTOR_ROLE) ||
      (options.now !== undefined && typeof options.now !== "function") ||
      (options.newUuidV7 !== undefined && typeof options.newUuidV7 !== "function")
    ) {
      throw new Error("public_web_publication_store_configuration_invalid");
    }
    this.pool = options.pool;
    this.config = options.config;
    this.expectedRole = options.expectedRole ?? EXACT_EXECUTOR_ROLE;
    this.now = options.now ?? Date.now;
    this.newUuidV7 = options.newUuidV7 ?? uuidV7;
  }

  async execute(input: PublicWebPublicationStoreInput): Promise<PublicWebPublicationStoreResult> {
    const { command, receipt } = validateAuthorizedInput(input);
    const rollout = resolvePublicWebRollout({
      mode: this.config.mode,
      tenantId: command.tenantId,
      tenantAllowlist: this.config.tenantAllowlist,
    });
    if (!rollout.enabled) throw new Error(`public_web_publication_rollout_${rollout.reason}`);

    const occurredAt = this.now();
    if (!Number.isSafeInteger(occurredAt) || occurredAt < 0) {
      throw new Error("public_web_publication_clock_invalid");
    }
    const accessDecisionReceiptId = this.newUuidV7(occurredAt);
    const publicationReceiptId = this.newUuidV7(occurredAt);
    if (
      !UUID_V7_RE.test(accessDecisionReceiptId) ||
      !UUID_V7_RE.test(publicationReceiptId) ||
      accessDecisionReceiptId === publicationReceiptId
    ) {
      throw new Error("public_web_publication_uuid_invalid");
    }

    const accessPayload = {
      id: accessDecisionReceiptId,
      tenantId: receipt.tenantId,
      contextId: receipt.contextId,
      actorPrincipalId: receipt.actorPrincipalId,
      membershipId: receipt.membershipId,
      assignmentIds: receipt.assignmentIds,
      rolePackageVersionIds: receipt.rolePackageVersionIds,
      capabilityKey: receipt.capabilityKey,
      resourceType: receipt.resourceType,
      resourceId: receipt.resourceId,
      decision: receipt.decision,
      reasonCode: receipt.reasonCode,
      policyVersionId: receipt.policyVersionId,
      correlationId: command.idempotencyKey,
      occurredAt,
    };
    const commandPayload = {
      accessDecisionReceiptId,
      actorLegacyUserId: input.actorLegacyUserId,
      command: command.type,
      contentRecordId: command.contentRecordId,
      evidenceSha256: command.evidenceSha256,
      expectedVersion: command.expectedVersion,
      organizationId: command.organizationId,
      publicationReceiptId,
      requestHash: input.authorized.requestHash,
      requestKey: command.idempotencyKey,
      revisionId: command.revisionId,
      staleReasonCode: command.staleReasonCode,
      tenantId: command.tenantId,
    };

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const client = await this.pool.connect();
      let transactionStarted = false;
      let releaseError: Error | undefined;
      try {
        const identity = await client.query<{
          current_user: string;
          rolsuper: boolean;
          rolbypassrls: boolean;
          tenant_setting: string | null;
          organization_setting: string | null;
        }>(`SELECT current_user, role.rolsuper, role.rolbypassrls,
              nullif(current_setting('app.tenant_id', true), '') AS tenant_setting,
              nullif(current_setting('app.organization_id', true), '') AS organization_setting
            FROM pg_roles role WHERE role.rolname = current_user`);
        if (
          identity.rowCount !== 1 ||
          identity.rows[0]?.current_user !== this.expectedRole ||
          identity.rows[0]?.rolsuper !== false ||
          identity.rows[0]?.rolbypassrls !== false ||
          identity.rows[0]?.tenant_setting !== null ||
          identity.rows[0]?.organization_setting !== null
        ) {
          throw new Error("public_web_publication_executor_identity_invalid");
        }

        await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
        transactionStarted = true;
        const settings = await client.query<{ tenant_id: string; organization_id: string }>(
          `SELECT set_config('lock_timeout', '2500ms', true),
                  set_config('statement_timeout', '8000ms', true),
                  set_config('idle_in_transaction_session_timeout', '12000ms', true),
                  set_config('app.tenant_id', $1, true) AS tenant_id,
                  set_config('app.organization_id', $2, true) AS organization_id`,
          [command.tenantId, command.organizationId],
        );
        if (
          settings.rowCount !== 1 ||
          settings.rows[0]?.tenant_id !== command.tenantId ||
          settings.rows[0]?.organization_id !== command.organizationId
        ) {
          throw new Error("public_web_publication_scope_binding_failed");
        }

        const result = await client.query<ResultRow>(
          `SELECT fas_public_web_v1.apply_authorized_publication_command(
             $1::jsonb, $2::jsonb
           ) AS result`,
          [JSON.stringify(accessPayload), JSON.stringify(commandPayload)],
        );
        if (result.rowCount !== 1) throw new Error("public_web_publication_result_invalid");
        const parsed = parseResult(result.rows[0]?.result);
        await client.query("COMMIT");
        transactionStarted = false;
        return parsed;
      } catch (error) {
        if (transactionStarted) {
          releaseError = await rollback(client);
          transactionStarted = false;
        }
        if (retryable(error) && attempt < MAX_ATTEMPTS) continue;
        throw error instanceof Error ? error : new Error("public_web_publication_failed");
      } finally {
        client.release(releaseError);
      }
    }
    throw new Error("public_web_publication_retry_budget_exhausted");
  }
}

export function createPostgresPublicWebPublicationStore(
  options: PostgresPublicWebPublicationStoreOptions,
): PostgresPublicWebPublicationStore {
  return new PostgresPublicWebPublicationStore(options);
}
