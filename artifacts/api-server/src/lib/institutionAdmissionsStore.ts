import crypto from "node:crypto";
import pg, { type Pool, type PoolClient, type QueryResultRow } from "pg";
import {
  isInstitutionRoleKey,
  type InstitutionRoleKey,
} from "./institutionAdmissionsPolicy";
import type {
  InstitutionCurrentAuthority,
  InstitutionMutationAuthorizationReceipt,
  InstitutionMutationIdentity,
  InstitutionMutationResource,
  InstitutionStepUpReceipt,
} from "./institutionAdmissionsAuthorization";
import type {
  ResolvedActiveContextState,
  VerifiedActiveTenantContext,
} from "./activeTenantContext";

const UUID_V7_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let institutionPool: Pool | undefined;

function getInstitutionPool(): Pool {
  if (institutionPool) return institutionPool;
  const connectionString = process.env.INSTITUTION_DATABASE_URL ??
    (process.env.NODE_ENV === "production" ? undefined : process.env.DATABASE_URL);
  if (!connectionString) throw new Error("institution_database_configuration_missing");
  institutionPool = new pg.Pool({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 10_000,
    statement_timeout: 8_000,
    query_timeout: 8_000,
    allowExitOnIdle: true,
    application_name: "fas-institution-admissions",
  });
  institutionPool.on("error", (error) => {
    console.error("[institution-db] idle client error", { message: error.message });
  });
  return institutionPool;
}

export type InstitutionRequestContext = {
  tenantId: string;
  relationshipId: string;
  institutionId: number;
  institutionName: string;
  membershipId: string;
  principalId: string;
  roleKey: InstitutionRoleKey;
  roleDisplayName: string;
  programScopeIds: number[];
  intakeScopes: string[];
  purposeCode: string;
  dataScopes: ReadonlySet<string>;
  capabilities: ReadonlySet<string>;
};

type MembershipRow = QueryResultRow & {
  tenant_id: string;
  relationship_id: string;
  membership_id: string;
  principal_id: string;
  role_package_version_id: string;
  role_key: string;
  program_scope_ids: number[] | null;
  intake_scopes: string[] | null;
};

type AuthorityRow = QueryResultRow & { role_display_name: string };

type RelationshipRow = QueryResultRow & {
  institution_id: number;
  institution_name: string;
  purpose_code: string;
  data_scopes: string[];
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

export function nextInstitutionId(): string {
  const id = uuidV7();
  if (!UUID_V7_RE.test(id)) throw new Error("institution_uuid_generation_failed");
  return id;
}

export function institutionHash(value: unknown): string {
  const canonical = JSON.stringify(canonicalize(value));
  return crypto.createHash("sha256").update(canonical, "utf8").digest("hex");
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

async function configureTransaction(client: PoolClient, legacyUserId: number): Promise<void> {
  await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  await client.query("SET LOCAL statement_timeout = '8000ms'");
  await client.query("SET LOCAL lock_timeout = '2500ms'");
  await client.query("SET LOCAL idle_in_transaction_session_timeout = '12000ms'");
  await client.query("SELECT set_config('app.legacy_user_id', $1, true)", [String(legacyUserId)]);
}

async function resolveContext(
  client: PoolClient,
  legacyUserId: number,
): Promise<InstitutionRequestContext> {
  const membership = await client.query<MembershipRow>(`
    SELECT
      m.tenant_id,
      m.relationship_id,
      m.id AS membership_id,
      m.principal_id,
      m.role_package_version_id,
      m.role_key,
      m.program_scope_ids,
      m.intake_scopes
    FROM institution_memberships m
    WHERE m.legacy_user_id = $1
      AND m.status = 'ACTIVE'
      AND m.valid_from <= now()
      AND (m.valid_until IS NULL OR m.valid_until > now())
    ORDER BY m.created_at DESC
    LIMIT 2
  `, [legacyUserId]);
  if (membership.rowCount === 0) throw new Error("institution_membership_unavailable");
  if (membership.rowCount !== 1) throw new Error("institution_membership_ambiguous");

  const row = membership.rows[0];
  if (!isInstitutionRoleKey(row.role_key)) throw new Error("institution_role_invalid");
  const roleDefinitionKey = {
    INSTITUTION_ADMIN: "institution.admin",
    PROGRAM_INTAKE_MANAGER: "institution.program_intake_manager",
    ADMISSIONS_REVIEWER: "institution.admissions_reviewer",
    DECISION_APPROVER: "institution.decision_approver",
    INTEGRATION_ADMIN: "institution.integration_admin",
    INSTITUTION_AUDITOR: "institution.auditor",
  }[row.role_key];
  const authority = await client.query<AuthorityRow>(`
    SELECT rd.display_name AS role_display_name
    FROM principals p
    JOIN role_package_versions rpv ON rpv.id = $2
    JOIN role_definitions rd ON rd.id = rpv.role_definition_id
    WHERE p.id = $1
      AND p.legacy_user_id = $3
      AND p.principal_type = 'HUMAN'
      AND p.status = 'ACTIVE'
      AND p.risk_state = 'NORMAL'
      AND rpv.status = 'ACTIVE'
      AND rpv.effective_at <= now()
      AND (rpv.deprecated_at IS NULL OR rpv.deprecated_at > now())
      AND rd.status = 'ACTIVE'
      AND rd.key = $4
  `, [row.principal_id, row.role_package_version_id, legacyUserId, roleDefinitionKey]);
  if (authority.rowCount !== 1) throw new Error("institution_authority_unavailable");
  await client.query("SELECT set_config('app.tenant_id', $1, true)", [row.tenant_id]);
  await client.query("SELECT set_config('app.institution_relationship_id', $1, true)", [row.relationship_id]);
  await client.query("SELECT set_config('app.institution_role', $1, true)", [row.role_key]);
  await client.query("SELECT set_config('app.institution_membership_id', $1, true)", [row.membership_id]);
  await client.query("SELECT set_config('app.institution_principal_id', $1, true)", [row.principal_id]);
  await client.query("SELECT set_config('app.institution_program_scope_ids', $1, true)", [JSON.stringify(row.program_scope_ids ?? [])]);
  await client.query("SELECT set_config('app.institution_intake_scopes', $1, true)", [JSON.stringify(row.intake_scopes ?? [])]);

  const relationship = await client.query<RelationshipRow>(`
    SELECT r.institution_id, u.name AS institution_name, r.purpose_code, r.data_scopes
    FROM institution_relationships r
    JOIN universities u ON u.id = r.institution_id
    JOIN tenants t ON t.id = r.tenant_id AND t.status = 'ACTIVE'
    WHERE r.id = $1
      AND r.tenant_id = $2
      AND r.status = 'ACTIVE'
      AND r.valid_from <= now()
      AND (r.valid_until IS NULL OR r.valid_until > now())
      AND r.purpose_code = 'admissions.review'
      AND cardinality(r.data_scopes) > 0
  `, [row.relationship_id, row.tenant_id]);
  if (relationship.rowCount !== 1) throw new Error("institution_relationship_unavailable");

  const capabilityRows = await client.query<{ capability_key: string; effect: string }>(`
    SELECT rpc.capability_key, rpc.effect
    FROM institution_memberships m
    JOIN role_package_versions rpv ON rpv.id = m.role_package_version_id
    JOIN role_package_capabilities rpc ON rpc.role_package_version_id = rpv.id
    JOIN capability_definitions cd
      ON cd.key = rpc.capability_key
     AND cd.status = 'ACTIVE'
    WHERE m.id = $1 AND m.tenant_id = $2
  `, [row.membership_id, row.tenant_id]);
  const denied = new Set(
    capabilityRows.rows.filter((item) => item.effect === "DENY").map((item) => item.capability_key),
  );
  const capabilities = new Set(
    capabilityRows.rows
      .filter((item) => item.effect === "ALLOW" && !denied.has(item.capability_key))
      .map((item) => item.capability_key),
  );
  if (!capabilities.has("institution.workspace.read")) {
    throw new Error("institution_workspace_denied");
  }

  return {
    tenantId: row.tenant_id,
    relationshipId: row.relationship_id,
    institutionId: Number(relationship.rows[0].institution_id),
    institutionName: relationship.rows[0].institution_name,
    membershipId: row.membership_id,
    principalId: row.principal_id,
    roleKey: row.role_key,
    roleDisplayName: authority.rows[0].role_display_name,
    programScopeIds: row.program_scope_ids ?? [],
    intakeScopes: row.intake_scopes ?? [],
    purposeCode: relationship.rows[0].purpose_code,
    dataScopes: new Set(relationship.rows[0].data_scopes ?? []),
    capabilities,
  };
}

type InstitutionAuthorityResolutionInput = {
  context: VerifiedActiveTenantContext & {
    tokenVersion: 2;
    selectionId: string;
    sessionGeneration: number;
  };
  identity: InstitutionMutationIdentity;
  resource: InstitutionMutationResource;
  capabilityKey: string;
  stepUpReceiptId: string | null;
};

function millis(value: unknown): number {
  const parsed = value instanceof Date ? value.valueOf() : new Date(String(value)).valueOf();
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error("institution_authority_timestamp_invalid");
  }
  return parsed;
}

function nullableMillis(value: unknown): number | null {
  return value == null ? null : millis(value);
}

export async function resolveInstitutionCurrentAuthority(
  client: PoolClient,
  currentContext: InstitutionRequestContext,
  input: InstitutionAuthorityResolutionInput,
): Promise<InstitutionCurrentAuthority> {
  if (
    input.identity.tenantId !== currentContext.tenantId ||
    input.identity.relationshipId !== currentContext.relationshipId ||
    input.identity.membershipId !== currentContext.membershipId ||
    input.identity.authenticatedPrincipalId !== currentContext.principalId
  ) throw new Error("institution_authority_context_mismatch");

  const selection = await client.query<{
    id: string; tenant_id: string; relationship_id: string; membership_id: string;
    principal_id: string; legacy_user_id: number; session_fingerprint: string;
    session_generation: string; status: string; expires_at: Date;
    impersonator_principal_id: string | null;
  }>(`SELECT id,tenant_id,relationship_id,membership_id,principal_id,legacy_user_id,
      session_fingerprint,session_generation,status,expires_at,impersonator_principal_id
    FROM institution_active_context_selections
    WHERE id=$1 AND tenant_id=$2 AND relationship_id=$3 AND membership_id=$4
      AND principal_id=$5 AND legacy_user_id=$6
    `, [
    input.context.selectionId, currentContext.tenantId, currentContext.relationshipId,
    currentContext.membershipId, currentContext.principalId,
    input.identity.authenticatedUserId,
  ]);
  if (selection.rowCount !== 1) throw new Error("institution_selection_unavailable");

  const relationship = await client.query<{
    id: string; tenant_id: string; status: string; purpose_code: string;
    data_scopes: string[]; policy_version: string; valid_from: Date; valid_until: Date | null;
  }>(`SELECT id,tenant_id,status,purpose_code,data_scopes,policy_version,valid_from,valid_until
    FROM institution_relationships
    WHERE id=$1 AND tenant_id=$2
    `, [currentContext.relationshipId, currentContext.tenantId]);
  if (relationship.rowCount !== 1) throw new Error("institution_relationship_unavailable");

  const authority = await client.query<{
    tenant_status: string; tenant_policy_version: string;
    principal_status: string; principal_type: string; risk_state: string; principal_legacy_user_id: number;
    membership_status: string; membership_valid_from: Date; membership_valid_until: Date | null;
    role_package_version_id: string; package_status: string; package_effective_at: Date | null;
    package_deprecated_at: Date | null; package_principal_type: string;
    policy_id: string; policy_state: string; policy_effective_at: Date | null; policy_revoked_at: Date | null;
  }>(`SELECT t.status AS tenant_status,t.policy_version AS tenant_policy_version,
      p.status AS principal_status,p.principal_type,p.risk_state,p.legacy_user_id AS principal_legacy_user_id,
      m.status AS membership_status,m.valid_from AS membership_valid_from,m.valid_until AS membership_valid_until,
      rpv.id AS role_package_version_id,rpv.status AS package_status,
      rpv.effective_at AS package_effective_at,rpv.deprecated_at AS package_deprecated_at,
      rd.principal_type AS package_principal_type,
      pv.id AS policy_id,pv.state AS policy_state,pv.effective_at AS policy_effective_at,pv.revoked_at AS policy_revoked_at
    FROM tenants t
    JOIN principals p ON p.id=$2 AND p.legacy_user_id=$3
    JOIN institution_memberships m ON m.id=$4 AND m.tenant_id=t.id AND m.principal_id=p.id
    JOIN role_package_versions rpv ON rpv.id=m.role_package_version_id
    JOIN role_definitions rd ON rd.id=rpv.role_definition_id
    JOIN policy_versions pv ON pv.tenant_id=t.id AND pv.id=$5 AND pv.version_number=$6
    WHERE t.id=$1`, [
    currentContext.tenantId, currentContext.principalId, input.identity.authenticatedUserId,
    currentContext.membershipId, input.context.policyVersionId, input.context.policyVersion,
  ]);
  if (authority.rowCount !== 1) throw new Error("institution_authority_unavailable");

  const capabilityRows = await client.query<{
    key: string; effect: "ALLOW" | "DENY"; status: "ACTIVE" | "DEPRECATED" | "REVOKED";
    step_up_required: boolean; approval_required: boolean;
  }>(`SELECT cd.key,rpc.effect,cd.status,cd.step_up_required,cd.approval_required
    FROM institution_memberships m
    JOIN role_package_capabilities rpc ON rpc.role_package_version_id=m.role_package_version_id
    JOIN capability_definitions cd ON cd.key=rpc.capability_key
    WHERE m.id=$1 AND m.tenant_id=$2
    ORDER BY cd.key`, [currentContext.membershipId, currentContext.tenantId]);
  const selectionRow = selection.rows[0];
  const relationshipRow = relationship.rows[0];
  const authorityRow = authority.rows[0];
  const state: ResolvedActiveContextState = {
    tenant: {
      id: currentContext.tenantId,
      status: authorityRow.tenant_status as ResolvedActiveContextState["tenant"]["status"],
      policyVersion: Number(authorityRow.tenant_policy_version),
    },
    principal: {
      id: currentContext.principalId,
      principalType: authorityRow.principal_type as ResolvedActiveContextState["principal"]["principalType"],
      status: authorityRow.principal_status as ResolvedActiveContextState["principal"]["status"],
      riskState: authorityRow.risk_state as ResolvedActiveContextState["principal"]["riskState"],
    },
    membership: {
      id: currentContext.membershipId,
      tenantId: currentContext.tenantId,
      organizationId: null,
      legacyBranchId: null,
      principalId: currentContext.principalId,
      status: authorityRow.membership_status as ResolvedActiveContextState["membership"]["status"],
      validFrom: millis(authorityRow.membership_valid_from),
      validUntil: nullableMillis(authorityRow.membership_valid_until),
    },
    policy: {
      id: authorityRow.policy_id,
      tenantId: currentContext.tenantId,
      version: input.context.policyVersion,
      state: authorityRow.policy_state as ResolvedActiveContextState["policy"]["state"],
      effectiveAt: nullableMillis(authorityRow.policy_effective_at),
      revokedAt: nullableMillis(authorityRow.policy_revoked_at),
    },
    assignments: [{
      // Institution membership is the relationship-scoped access assignment;
      // it deliberately does not create an internal staff membership row.
      id: currentContext.membershipId,
      tenantId: currentContext.tenantId,
      membershipId: currentContext.membershipId,
      status: authorityRow.membership_status as ResolvedActiveContextState["assignments"][number]["status"],
      validFrom: millis(authorityRow.membership_valid_from),
      validUntil: nullableMillis(authorityRow.membership_valid_until),
      scopeType: "TENANT",
      organizationId: null,
      legacyBranchId: null,
      constraintDocument: {},
      rolePackageVersionId: authorityRow.role_package_version_id,
      rolePackageStatus: authorityRow.package_status as ResolvedActiveContextState["assignments"][number]["rolePackageStatus"],
      rolePackagePrincipalType: authorityRow.package_principal_type as ResolvedActiveContextState["assignments"][number]["rolePackagePrincipalType"],
      rolePackageEffectiveAt: nullableMillis(authorityRow.package_effective_at),
      rolePackageDeprecatedAt: nullableMillis(authorityRow.package_deprecated_at),
      capabilities: capabilityRows.rows.map((row) => ({
        key: row.key,
        effect: row.effect,
        status: row.status,
        stepUpRequired: row.step_up_required,
        approvalRequired: row.approval_required,
      })),
    }],
  };

  let stepUpReceipt: InstitutionCurrentAuthority["stepUpReceipt"] = null;
  if (input.stepUpReceiptId !== null) {
    const receipt = await client.query<{
      id:string; tenant_id:string; relationship_id:string; principal_id:string; membership_id:string;
      selection_id:string; session_generation:string; context_id:string; capability_key:string;
      resource_type:string; resource_id:string; request_hash:string; status:string;
      issued_at:Date; expires_at:Date; consumed_at:Date|null;
    }>(`SELECT id,tenant_id,relationship_id,principal_id,membership_id,selection_id,
        session_generation,context_id,capability_key,resource_type,resource_id,request_hash,
        status,issued_at,expires_at,consumed_at
      FROM institution_step_up_receipts
      WHERE id=$1 AND tenant_id=$2 AND relationship_id=$3 AND membership_id=$4
      FOR UPDATE`, [input.stepUpReceiptId,currentContext.tenantId,currentContext.relationshipId,currentContext.membershipId]);
    if (receipt.rowCount !== 1) throw new Error("institution_step_up_receipt_unavailable");
    const row = receipt.rows[0];
    stepUpReceipt = {
      id:row.id,tenantId:row.tenant_id,relationshipId:row.relationship_id,
      principalId:row.principal_id,membershipId:row.membership_id,selectionId:row.selection_id,
      sessionGeneration:Number(row.session_generation),contextId:row.context_id,
      capabilityKey:row.capability_key,resourceType:row.resource_type,resourceId:row.resource_id,
      requestHash:row.request_hash,status:row.status as InstitutionStepUpReceipt["status"],
      issuedAt:millis(row.issued_at),expiresAt:millis(row.expires_at),consumedAt:nullableMillis(row.consumed_at),
    };
  }
  return {
    principalLegacyUserId: authorityRow.principal_legacy_user_id,
    selection: {
      id:selectionRow.id,tenantId:selectionRow.tenant_id,relationshipId:selectionRow.relationship_id,
      membershipId:selectionRow.membership_id,principalId:selectionRow.principal_id,
      legacyUserId:selectionRow.legacy_user_id,sessionFingerprint:selectionRow.session_fingerprint,
      sessionGeneration:Number(selectionRow.session_generation),
      status:selectionRow.status as InstitutionCurrentAuthority["selection"]["status"],
      expiresAt:millis(selectionRow.expires_at),impersonatorPrincipalId:selectionRow.impersonator_principal_id,
    },
    relationship: {
      id:relationshipRow.id,tenantId:relationshipRow.tenant_id,
      status:relationshipRow.status as InstitutionCurrentAuthority["relationship"]["status"],
      purposeCode:relationshipRow.purpose_code,dataScopes:relationshipRow.data_scopes,
      policyVersion:Number(relationshipRow.policy_version),validFrom:millis(relationshipRow.valid_from),
      validUntil:nullableMillis(relationshipRow.valid_until),
    },
    state,
    stepUpReceipt,
  };
}

export async function consumeInstitutionMutationAuthorization(
  client: PoolClient,
  context: InstitutionRequestContext,
  receipt: InstitutionMutationAuthorizationReceipt,
): Promise<string> {
  if (
    receipt.tenantId !== context.tenantId ||
    receipt.relationshipId !== context.relationshipId ||
    receipt.actorMembershipId !== context.membershipId ||
    receipt.actorPrincipalId !== context.principalId
  ) throw new Error("institution_authorization_receipt_mismatch");
  if (receipt.stepUpReceiptId !== null) {
    const consumed = await client.query(`UPDATE institution_step_up_receipts
      SET status='CONSUMED',consumed_at=now()
      WHERE id=$1 AND tenant_id=$2 AND relationship_id=$3 AND membership_id=$4
        AND principal_id=$5 AND selection_id=$6 AND session_generation=$7
        AND context_id=$8 AND capability_key=$9 AND resource_type=$10
        AND resource_id=$11 AND request_hash=$12 AND status='ACTIVE'
        AND issued_at <= now() AND expires_at > now()
      RETURNING id`, [
      receipt.stepUpReceiptId,receipt.tenantId,receipt.relationshipId,receipt.actorMembershipId,
      receipt.actorPrincipalId,receipt.selectionId,receipt.sessionGeneration,receipt.contextId,
      receipt.capabilityKey,receipt.resourceType,receipt.resourceId,receipt.requestHash,
    ]);
    if (consumed.rowCount !== 1) throw new Error("institution_step_up_receipt_not_consumed");
  }
  const id = nextInstitutionId();
  const authorizationHash = institutionHash({ id, ...receipt, capabilityDecision: receipt.capabilityDecision.receipt });
  await client.query(`INSERT INTO institution_command_authorization_receipts (
      id,tenant_id,relationship_id,context_id,selection_id,session_generation,
      actor_principal_id,actor_membership_id,capability_key,required_data_scope,policy_version_id,policy_version,
      resource_type,resource_id,request_hash,step_up_receipt_id,decision,decision_reason,authorization_hash
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'ALLOW','allowed',$17)`, [
    id,receipt.tenantId,receipt.relationshipId,receipt.contextId,receipt.selectionId,
    receipt.sessionGeneration,receipt.actorPrincipalId,receipt.actorMembershipId,
    receipt.capabilityKey,receipt.requiredDataScope,receipt.policyVersionId,receipt.policyVersion,
    receipt.resourceType,receipt.resourceId,receipt.requestHash,receipt.stepUpReceiptId,authorizationHash,
  ]);
  return id;
}

async function rollback(client: PoolClient): Promise<void> {
  try { await client.query("ROLLBACK"); } catch {}
}

export async function withInstitutionContext<T>(
  legacyUserId: number,
  operation: (client: PoolClient, context: InstitutionRequestContext) => Promise<T>,
): Promise<T> {
  if (!Number.isSafeInteger(legacyUserId) || legacyUserId <= 0) {
    throw new Error("institution_user_invalid");
  }
  const client = await getInstitutionPool().connect();
  try {
    await configureTransaction(client, legacyUserId);
    if (process.env.NODE_ENV === "production") {
      const expectedRole = process.env.INSTITUTION_DB_EXECUTOR_ROLE;
      if (!expectedRole || !/^[a-z_][a-z0-9_]{0,62}$/.test(expectedRole)) {
        throw new Error("institution_executor_configuration_missing");
      }
      const identity = await client.query<{ current_user: string; rolsuper: boolean; rolbypassrls: boolean }>(`
        SELECT current_user, r.rolsuper, r.rolbypassrls
        FROM pg_roles r WHERE r.rolname = current_user
      `);
      if (
        identity.rows[0]?.current_user !== expectedRole ||
        identity.rows[0]?.rolsuper !== false ||
        identity.rows[0]?.rolbypassrls !== false
      ) throw new Error("institution_executor_identity_invalid");
    }
    const context = await resolveContext(client, legacyUserId);
    const result = await operation(client, context);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await rollback(client);
    throw error;
  } finally {
    client.release();
  }
}

export function institutionScopeSql(
  context: InstitutionRequestContext,
  startIndex: number,
): { sql: string; values: unknown[] } {
  return {
    sql: `(
      (cardinality($${startIndex}::integer[]) = 0 OR program_id = ANY($${startIndex}::integer[]))
      AND (cardinality($${startIndex + 1}::text[]) = 0 OR intake_key = ANY($${startIndex + 1}::text[]))
    )`,
    values: [context.programScopeIds, context.intakeScopes],
  };
}

export function toPublicInstitutionContext(context: InstitutionRequestContext) {
  return {
    institutionId: context.institutionId,
    institutionName: context.institutionName,
    role: context.roleKey,
    roleDisplayName: context.roleDisplayName,
    programScopeIds: context.programScopeIds,
    intakeScopes: context.intakeScopes,
    capabilities: [...context.capabilities].sort(),
  };
}
