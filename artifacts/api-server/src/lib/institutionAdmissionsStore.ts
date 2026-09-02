import crypto from "node:crypto";
import pg, { type Pool, type PoolClient, type QueryResultRow } from "pg";
import {
  isInstitutionRoleKey,
  type InstitutionRoleKey,
} from "./institutionAdmissionsPolicy";

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

  const relationship = await client.query<RelationshipRow>(`
    SELECT r.institution_id, u.name AS institution_name
    FROM institution_relationships r
    JOIN universities u ON u.id = r.institution_id
    JOIN tenants t ON t.id = r.tenant_id AND t.status = 'ACTIVE'
    WHERE r.id = $1
      AND r.tenant_id = $2
      AND r.status = 'ACTIVE'
      AND r.valid_from <= now()
      AND (r.valid_until IS NULL OR r.valid_until > now())
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
    capabilities,
  };
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
