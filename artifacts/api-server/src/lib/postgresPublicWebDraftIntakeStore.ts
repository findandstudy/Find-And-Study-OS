import crypto from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";

import {
  hashPublicWebDraftIntakeCommand,
  parsePublicWebDraftIntakeCommand,
  type AuthorizedPublicWebDraftIntakeCommand,
} from "./publicWebDraftIntakeCommand.js";
import { resolvePublicWebRollout } from "./publicWebContentContract.js";

const EXACT_EXECUTOR_ROLE = "fas_public_web_executor";
const MAX_ATTEMPTS = 3;
const EXECUTOR_CRITICAL_RELATIONS = [
  "public.users",
  "public.sessions",
  "public.active_session_context_selections",
  "public.tenants",
  "public.organizations",
  "public.principals",
  "public.memberships",
  "public.policy_versions",
  "public.access_assignments",
  "public.role_definitions",
  "public.role_package_versions",
  "public.role_package_capabilities",
  "public.capability_definitions",
  "public.access_decision_receipts",
  "public.public_web_content_records",
  "public.public_web_content_revisions",
  "public.public_web_publication_states",
  "public.public_web_route_aliases",
  "public.public_web_draft_intake_receipts",
  "public.programs",
  "public.universities",
  "public.destinations",
  "public.cities",
  "public.countries",
  "public.website_pages",
  "public.website_blog_posts",
] as const;
const UUID_V7_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/;

export type PublicWebDraftIntakeStoreInput = {
  authorized: AuthorizedPublicWebDraftIntakeCommand;
  actorLegacyUserId: number;
};

export type PublicWebDraftIntakeStoreResult = {
  outcome: "APPLIED" | "REPLAY";
  intakeReceiptId: string;
  contentRecordId: string;
  revisionId: string;
  status: "DRAFT";
  indexState: "NOINDEX";
  version: 1;
};

export type PostgresPublicWebDraftIntakeStoreOptions = {
  pool: Pool;
  config: {
    mode: string | undefined;
    tenantAllowlist: string | undefined;
  };
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

function scopedRequestKey(input: {
  tenantId: string;
  organizationId: string;
  actorPrincipalId: string;
  membershipId: string;
  idempotencyKey: string;
}): string {
  const digest = crypto
    .createHash("sha256")
    .update("fas.public-web.draft-intake-key.v2\0", "utf8")
    .update(input.tenantId, "ascii")
    .update("\0", "ascii")
    .update(input.organizationId, "ascii")
    .update("\0", "ascii")
    .update(input.actorPrincipalId, "ascii")
    .update("\0", "ascii")
    .update(input.membershipId, "ascii")
    .update("\0", "ascii")
    .update(input.idempotencyKey, "utf8")
    .digest("hex");
  return `pwd2:${digest}`;
}

function validUuidSet(value: unknown): value is string[] {
  return Array.isArray(value) && value.length >= 1 && value.length <= 64 &&
    value.every((item) => typeof item === "string" && UUID_V7_RE.test(item)) &&
    new Set(value.map((item) => item.toLowerCase())).size === value.length;
}

function validateAuthorizedInput(input: PublicWebDraftIntakeStoreInput) {
  if (
    !isRecord(input) ||
    !Number.isSafeInteger(input.actorLegacyUserId) ||
    input.actorLegacyUserId < 1 ||
    !isRecord(input.authorized)
  ) {
    throw new Error("public_web_draft_intake_input_invalid");
  }
  const command = parsePublicWebDraftIntakeCommand(input.authorized.command);
  const receipt = input.authorized.decisionReceipt;
  const binding = input.authorized.executionBinding;
  if (
    !command ||
    input.authorized.requestHash !== hashPublicWebDraftIntakeCommand(command) ||
    input.authorized.capabilityKey !== "public_web.content.write" ||
    !isRecord(receipt) ||
    !UUID_V7_RE.test(String(receipt.tenantId)) ||
    !UUID_V7_RE.test(String(receipt.contextId)) ||
    !UUID_V7_RE.test(String(receipt.actorPrincipalId)) ||
    !UUID_V7_RE.test(String(receipt.membershipId)) ||
    !UUID_V7_RE.test(String(receipt.policyVersionId)) ||
    !validUuidSet(receipt.assignmentIds) ||
    !validUuidSet(receipt.rolePackageVersionIds) ||
    receipt.tenantId !== command.tenantId ||
    receipt.capabilityKey !== "public_web.content.write" ||
    receipt.resourceType !== "PUBLIC_WEB_CONTENT" ||
    receipt.resourceId !== command.contentRecordId ||
    receipt.decision !== "ALLOW" ||
    receipt.reasonCode !== "allowed" ||
    !isRecord(binding) ||
    !hasExactKeys(binding, [
      "contextExpiresAt",
      "contextId",
      "contextIssuedAt",
      "selectionId",
      "sessionFingerprint",
      "sessionGeneration",
      "sessionId",
    ]) ||
    binding.contextId !== receipt.contextId ||
    !Number.isSafeInteger(binding.contextIssuedAt) ||
    !Number.isSafeInteger(binding.contextExpiresAt) ||
    binding.contextIssuedAt < 0 ||
    binding.contextExpiresAt <= binding.contextIssuedAt ||
    binding.contextExpiresAt - binding.contextIssuedAt > 15 * 60 * 1000 ||
    typeof binding.sessionId !== "string" ||
    !SHA256_RE.test(binding.sessionId) ||
    typeof binding.sessionFingerprint !== "string" ||
    !SHA256_RE.test(binding.sessionFingerprint) ||
    crypto.createHash("sha256").update(binding.sessionId, "utf8").digest("hex") !==
      binding.sessionFingerprint ||
    !UUID_V7_RE.test(String(binding.selectionId)) ||
    !Number.isSafeInteger(binding.sessionGeneration) ||
    binding.sessionGeneration < 1 ||
    binding.sessionGeneration > Number.MAX_SAFE_INTEGER
  ) {
    throw new Error("public_web_draft_intake_authorization_invalid");
  }
  return { command, receipt };
}

function parseResult(value: unknown): PublicWebDraftIntakeStoreResult {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "contentRecordId",
      "indexState",
      "intakeReceiptId",
      "outcome",
      "revisionId",
      "status",
      "version",
    ]) ||
    !["APPLIED", "REPLAY"].includes(String(value.outcome)) ||
    !UUID_V7_RE.test(String(value.intakeReceiptId)) ||
    !UUID_V7_RE.test(String(value.contentRecordId)) ||
    !UUID_V7_RE.test(String(value.revisionId)) ||
    value.status !== "DRAFT" ||
    value.indexState !== "NOINDEX" ||
    value.version !== 1
  ) {
    throw new Error("public_web_draft_intake_result_invalid");
  }
  return value as PublicWebDraftIntakeStoreResult;
}

function retryable(error: unknown): boolean {
  const code = (error as { code?: unknown })?.code;
  const message = (error as { message?: unknown })?.message;
  if (
    code === "40001" &&
    message === "public web draft intake source changed"
  ) {
    return false;
  }
  return code === "40001" || code === "40P01";
}

async function rollback(client: PoolClient): Promise<Error | undefined> {
  try {
    await client.query("ROLLBACK");
    return undefined;
  } catch (error) {
    return error instanceof Error ? error : new Error("public_web_draft_intake_rollback_failed");
  }
}

export class PostgresPublicWebDraftIntakeStore {
  private readonly pool: Pool;
  private readonly config: PostgresPublicWebDraftIntakeStoreOptions["config"];
  private readonly expectedRole: string;
  private readonly now: () => number;
  private readonly newUuidV7: (observedAt: number) => string;

  constructor(options: PostgresPublicWebDraftIntakeStoreOptions) {
    if (
      !options?.pool ||
      !isRecord(options.config) ||
      (options.expectedRole !== undefined && options.expectedRole !== EXACT_EXECUTOR_ROLE) ||
      (options.now !== undefined && typeof options.now !== "function") ||
      (options.newUuidV7 !== undefined && typeof options.newUuidV7 !== "function")
    ) {
      throw new Error("public_web_draft_intake_store_configuration_invalid");
    }
    this.pool = options.pool;
    this.config = options.config;
    this.expectedRole = options.expectedRole ?? EXACT_EXECUTOR_ROLE;
    this.now = options.now ?? Date.now;
    this.newUuidV7 = options.newUuidV7 ?? uuidV7;
  }

  async execute(input: PublicWebDraftIntakeStoreInput): Promise<PublicWebDraftIntakeStoreResult> {
    const { command, receipt } = validateAuthorizedInput(input);
    const rollout = resolvePublicWebRollout({
      mode: this.config.mode,
      tenantId: command.tenantId,
      tenantAllowlist: this.config.tenantAllowlist,
    });
    if (!rollout.enabled) throw new Error(`public_web_draft_intake_rollout_${rollout.reason}`);

    const occurredAt = this.now();
    if (!Number.isSafeInteger(occurredAt) || occurredAt < 0) {
      throw new Error("public_web_draft_intake_clock_invalid");
    }
    const generatedIds = [
      this.newUuidV7(occurredAt),
      this.newUuidV7(occurredAt),
      this.newUuidV7(occurredAt),
    ];
    if (new Set(generatedIds).size !== 3 || generatedIds.some((id) => !UUID_V7_RE.test(id))) {
      throw new Error("public_web_draft_intake_uuid_invalid");
    }
    const [accessDecisionReceiptId, routeAliasId, intakeReceiptId] = generatedIds;
    const requestKey = scopedRequestKey({
      tenantId: command.tenantId,
      organizationId: command.organizationId,
      actorPrincipalId: receipt.actorPrincipalId,
      membershipId: receipt.membershipId,
      idempotencyKey: command.idempotencyKey,
    });

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
      correlationId: requestKey,
      occurredAt,
    };
    const commandPayload = {
      accessDecisionReceiptId,
      actorLegacyUserId: input.actorLegacyUserId,
      canonicalPath: command.canonicalPath,
      canonicalSlug: command.canonicalSlug,
      contentJson: command.contentJson,
      contentRecordId: command.contentRecordId,
      contentSha256: command.contentSha256,
      entityId: command.entityId,
      entityType: command.entityType,
      generatorReceiptSha256: command.generatorReceiptSha256,
      intakeReceiptId,
      locale: command.locale,
      organizationId: command.organizationId,
      origin: command.origin,
      requestHash: input.authorized.requestHash,
      requestKey,
      revisionId: command.revisionId,
      routeAliasId,
      seoJson: command.seoJson,
      sourceSha256: command.sourceSha256,
      structuredDataJson: command.structuredDataJson,
      summary: command.summary,
      tenantId: command.tenantId,
      title: command.title,
    };
    const selectionPayload = {
      contextId: input.authorized.executionBinding.contextId,
      contextIssuedAt: input.authorized.executionBinding.contextIssuedAt,
      contextExpiresAt: input.authorized.executionBinding.contextExpiresAt,
      selectionId: input.authorized.executionBinding.selectionId,
      sessionGeneration: input.authorized.executionBinding.sessionGeneration,
      sessionId: input.authorized.executionBinding.sessionId,
      sessionFingerprint: input.authorized.executionBinding.sessionFingerprint,
    };

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const client = await this.pool.connect();
      let transactionStarted = false;
      let releaseError: Error | undefined;
      try {
        const identity = await client.query<{
          current_user: string;
          rolsuper: boolean;
          rolcreatedb: boolean;
          rolcreaterole: boolean;
          rolinherit: boolean;
          rolreplication: boolean;
          rolbypassrls: boolean;
          rolcanlogin: boolean;
          has_role_membership: boolean;
          can_execute_v2: boolean;
          can_execute_v1: boolean;
          can_execute_authority_helper: boolean;
          can_execute_source_internal: boolean;
          can_execute_source_locked: boolean;
          can_create_public_schema: boolean;
          can_create_facade_schema: boolean;
          has_critical_table_dml: boolean;
          tenant_setting: string | null;
          organization_setting: string | null;
        }>(`SELECT current_user, role.rolsuper, role.rolcreatedb,
              role.rolcreaterole, role.rolinherit, role.rolreplication,
              role.rolbypassrls, role.rolcanlogin,
              EXISTS (
                SELECT 1 FROM pg_auth_members membership
                WHERE membership.member = role.oid
              ) AS has_role_membership,
              has_function_privilege(current_user,
                'fas_public_web_v1.apply_authorized_draft_intake_v2(jsonb,jsonb,jsonb)',
                'EXECUTE') AS can_execute_v2,
              has_function_privilege(current_user,
                'fas_public_web_v1.apply_authorized_draft_intake(jsonb,jsonb)',
                'EXECUTE') AS can_execute_v1,
              has_function_privilege(current_user,
                'fas_public_web_v1.assert_current_draft_authority(jsonb,jsonb,jsonb)',
                'EXECUTE') AS can_execute_authority_helper,
              has_function_privilege(current_user,
                'fas_public_web_v1.resolve_source_sha256_internal(text,integer,boolean)',
                'EXECUTE') AS can_execute_source_internal,
              has_function_privilege(current_user,
                'fas_public_web_v1.resolve_source_sha256_locked(text,integer)',
                'EXECUTE') AS can_execute_source_locked,
              has_schema_privilege(current_user, 'public', 'CREATE')
                AS can_create_public_schema,
              has_schema_privilege(current_user, 'fas_public_web_v1', 'CREATE')
                AS can_create_facade_schema,
              EXISTS (
                SELECT 1
                FROM unnest($1::text[]) AS critical(relation_name)
                WHERE has_table_privilege(
                  current_user,
                  critical.relation_name,
                  'SELECT,INSERT,UPDATE,DELETE'
                )
              ) AS has_critical_table_dml,
              nullif(current_setting('app.tenant_id', true), '') AS tenant_setting,
              nullif(current_setting('app.organization_id', true), '') AS organization_setting
            FROM pg_roles role WHERE role.rolname = current_user`, [
          EXECUTOR_CRITICAL_RELATIONS,
        ]);
        if (
          identity.rowCount !== 1 ||
          identity.rows[0]?.current_user !== this.expectedRole ||
          identity.rows[0]?.rolsuper !== false ||
          identity.rows[0]?.rolcreatedb !== false ||
          identity.rows[0]?.rolcreaterole !== false ||
          identity.rows[0]?.rolinherit !== false ||
          identity.rows[0]?.rolreplication !== false ||
          identity.rows[0]?.rolbypassrls !== false ||
          identity.rows[0]?.rolcanlogin !== true ||
          identity.rows[0]?.has_role_membership !== false ||
          identity.rows[0]?.can_execute_v2 !== true ||
          identity.rows[0]?.can_execute_v1 !== false ||
          identity.rows[0]?.can_execute_authority_helper !== false ||
          identity.rows[0]?.can_execute_source_internal !== false ||
          identity.rows[0]?.can_execute_source_locked !== false ||
          identity.rows[0]?.can_create_public_schema !== false ||
          identity.rows[0]?.can_create_facade_schema !== false ||
          identity.rows[0]?.has_critical_table_dml !== false ||
          identity.rows[0]?.tenant_setting !== null ||
          identity.rows[0]?.organization_setting !== null
        ) {
          throw new Error("public_web_draft_intake_executor_identity_invalid");
        }

        await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
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
          throw new Error("public_web_draft_intake_scope_binding_failed");
        }

        const result = await client.query<ResultRow>(
          `SELECT fas_public_web_v1.apply_authorized_draft_intake_v2(
             $1::jsonb, $2::jsonb, $3::jsonb
           ) AS result`,
          [
            JSON.stringify(accessPayload),
            JSON.stringify(commandPayload),
            JSON.stringify(selectionPayload),
          ],
        );
        if (result.rowCount !== 1) throw new Error("public_web_draft_intake_result_invalid");
        const parsed = parseResult(result.rows[0]?.result);
        if (parsed.outcome === "APPLIED" && (
          parsed.contentRecordId !== command.contentRecordId ||
          parsed.revisionId !== command.revisionId ||
          parsed.intakeReceiptId !== intakeReceiptId
        )) {
          throw new Error("public_web_draft_intake_result_invalid");
        }
        await client.query("COMMIT");
        transactionStarted = false;
        return parsed;
      } catch (error) {
        if (transactionStarted) {
          releaseError = await rollback(client);
          transactionStarted = false;
        }
        if (retryable(error) && attempt < MAX_ATTEMPTS) continue;
        throw error instanceof Error ? error : new Error("public_web_draft_intake_failed");
      } finally {
        client.release(releaseError);
      }
    }
    throw new Error("public_web_draft_intake_retry_budget_exhausted");
  }
}
