import crypto from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import type { Request } from "express";
import type { Pool, PoolClient } from "pg";
import type { PersonaMockIdentity } from "./personaScopedMock";
import { getAbsoluteSessionExpiry } from "./sessionLifetime";
import {
  assertPersonaDatabase, assertPersonaRuntime, createPersonaRuntimeBoundary,
  type PersonaRuntimeBoundary,
} from "./personaRuntimeBoundary";

export type PersonaAdminSessionOptions = {
  pool: Pick<Pool, "connect">;
  project: { projectId: string; tenantId: string; organizationId: string };
  trustedOrigin: string;
};
export type PersonaAdminContext = Readonly<{
  tenantId: string; organizationId: string; principalId: string;
}>;
const authorities = new WeakSet<object>();
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const hex = /^[a-f0-9]{64}$/;
const capabilities = new Set([
  "ai.persona.read", "ai.persona.propose", "ai.persona.approve", "ai.persona.execute", "ai.persona.reconcile",
  "ai.persona_context.read", "ai.persona_context.write", "ai.persona_context.retention",
  "ai.persona_team.propose", "ai.persona_team.approve", "ai.persona_team.manage",
  "ai.persona_task.manage", "ai.persona_tool.draft",
]);
const deny = (reason: string): never => { throw new Error(`PERSONA_${reason}`); };
type SessionRow = {
  user_id: number; session_user_id: number; session_json_user_id: string;
  issued_at: string; idle_expires_at: Date; has_original_sid: boolean;
  role: string; user_active: boolean; user_deleted: boolean; permission_overrides: unknown;
  principal_id: string; principal_type: string; principal_status: string; risk_state: string;
  membership_id: string; membership_status: string; valid_from: Date; valid_until: Date | null;
  tenant_status: string; organization_status: string;
};
type Binding = { sid: string; context: PersonaAdminContext; membershipId: string; userId: number; role: string; issuedAt: number };

/** Explicitly scoped, same-process admin session authority for the mock workspace.
 * It does not mint/pretend to verify an active-context token or change any global
 * Control Plane contract. Canonical project ownership and HUMAN membership still
 * have to exist; this adapter never creates them from a role or an email address.
 */
export function createPersonaAdminSession(
  options: PersonaAdminSessionOptions,
  runtime: PersonaRuntimeBoundary = createPersonaRuntimeBoundary(),
) {
  assertPersonaRuntime(runtime);
  if (!options?.pool?.connect || !options.project ||
      ![options.project.projectId, options.project.tenantId, options.project.organizationId].every(v => typeof v === "string" && uuid.test(v)))
    deny("ADMIN_SESSION_CONFIG_REQUIRED");
  const project = Object.freeze({ ...options.project });
  const pool = options.pool;
  const trustedOrigin = options.trustedOrigin;
  let origin: URL;
  try { origin = new URL(trustedOrigin); } catch { return deny("ADMIN_SESSION_CONFIG_REQUIRED"); }
  if (origin.origin !== trustedOrigin || origin.username || origin.password ||
      (runtime.mode === "staging-mock" ? trustedOrigin !== "https://staging.findandstudy.com"
        : origin.protocol !== "http:" || origin.hostname !== "127.0.0.1"))
    deny("ADMIN_SESSION_CONFIG_REQUIRED");
  const identities = new WeakMap<object, Binding>();
  const executing = new AsyncLocalStorage<{ binding: Binding; active: boolean }>();

  function header(req: Request, name: string): string | undefined {
    const value = req.headers[name];
    if (value !== undefined && typeof value !== "string") return deny("ADMIN_SESSION_REQUEST_INVALID");
    const maxBytes = name === "cookie" ? 8192 : name === "referer" ? 4096 : name === "origin" ? 256 : 64;
    if (typeof value === "string" && Buffer.byteLength(value, "utf8") > maxBytes)
      return deny("ADMIN_SESSION_REQUEST_INVALID");
    return value;
  }
  function requestSession(req: Request): string {
    assertPersonaRuntime(runtime);
    if (req.apiTokenAuth || req.headers.authorization !== undefined) deny("DIRECT_HUMAN_SESSION_REQUIRED");
    const cookie = header(req, "cookie");
    const originValue = header(req, "origin");
    const referer = header(req, "referer");
    const fetchSite = header(req, "sec-fetch-site");
    if (fetchSite && fetchSite !== "same-origin") deny("ADMIN_SESSION_ORIGIN_INVALID");
    let refererOrigin: string | undefined;
    if (referer !== undefined) {
      try {
        const value = new URL(referer);
        if (value.username || value.password) deny("ADMIN_SESSION_ORIGIN_INVALID");
        refererOrigin = value.origin;
      } catch { deny("ADMIN_SESSION_ORIGIN_INVALID"); }
    }
    if ((originValue !== undefined && originValue !== trustedOrigin) ||
        (refererOrigin !== undefined && refererOrigin !== trustedOrigin) ||
        (originValue === undefined && refererOrigin === undefined)) deny("ADMIN_SESSION_ORIGIN_INVALID");
    const values = new Map<string, string[]>();
    for (const part of (cookie ?? "").split(";")) {
      const separator = part.indexOf("=");
      if (separator < 1) continue;
      const name = part.slice(0, separator).trim();
      if (name === "sid" || name === "csrf_token")
        values.set(name, [...(values.get(name) ?? []), part.slice(separator + 1).trim()]);
    }
    const sessions = values.get("sid") ?? [], csrf = values.get("csrf_token") ?? [];
    if (sessions.length !== 1 || !hex.test(sessions[0]) || csrf.length > 1)
      deny("ADMIN_SESSION_COOKIE_INVALID");
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const supplied = header(req, "x-csrf-token");
      if (csrf.length !== 1 || !hex.test(csrf[0]) || !supplied || !hex.test(supplied) ||
          !crypto.timingSafeEqual(Buffer.from(csrf[0], "ascii"), Buffer.from(supplied, "ascii")))
        deny("ADMIN_SESSION_CSRF_INVALID");
    }
    return sessions[0];
  }

  async function readCurrent(client: PoolClient, sid: string): Promise<SessionRow> {
    // Only fixed server scope enters RLS settings. Client project IDs never select
    // a tenant or widen the canonical membership lookup.
    const rows = (await client.query<SessionRow>(`SELECT
      u.id AS user_id,s.user_id AS session_user_id,s.sess->'user'->>'id' AS session_json_user_id,
      s.sess->>'issued_at' AS issued_at,s.expire AT TIME ZONE 'UTC' AS idle_expires_at,
      s.sess ? 'originalSid' AS has_original_sid,
      u.role,u.is_active AS user_active,u.deleted_at IS NOT NULL AS user_deleted,u.permission_overrides,
      p.id AS principal_id,p.principal_type,p.status AS principal_status,p.risk_state,
      m.id AS membership_id,m.status AS membership_status,m.valid_from,m.valid_until,
      t.status AS tenant_status,o.status AS organization_status
      FROM sessions s JOIN users u ON u.id=s.user_id
      JOIN principals p ON p.legacy_user_id=u.id
      JOIN memberships m ON m.principal_id=p.id AND m.tenant_id=$2 AND m.organization_id=$3
        AND m.legacy_branch_id IS NULL AND m.status='ACTIVE' AND m.valid_from<=clock_timestamp()
        AND (m.valid_until IS NULL OR m.valid_until>clock_timestamp())
      JOIN tenants t ON t.id=m.tenant_id
      JOIN organizations o ON o.tenant_id=m.tenant_id AND o.id=m.organization_id
      WHERE s.sid=$1
      FOR SHARE OF s,u,p,m,t,o`, [sid, project.tenantId, project.organizationId])).rows;
    // Multiple memberships are an ownership decision, not a first-row choice.
    if (rows.length !== 1) deny("ADMIN_SESSION_MEMBERSHIP_REQUIRED");
    const row = rows[0], now = Date.now(), issuedAt = Number(row.issued_at);
    const expiry = row.idle_expires_at instanceof Date ? row.idle_expires_at.getTime() : NaN;
    const validFrom = row.valid_from instanceof Date ? row.valid_from.getTime() : NaN;
    const validUntil = row.valid_until instanceof Date ? row.valid_until.getTime() : null;
    if (!Number.isSafeInteger(row.user_id) || row.user_id <= 0 || row.session_user_id !== row.user_id ||
        String(row.user_id) !== row.session_json_user_id || row.has_original_sid !== false ||
        !Number.isSafeInteger(issuedAt) || issuedAt <= 0 || issuedAt > now ||
        getAbsoluteSessionExpiry(issuedAt) <= now || !Number.isFinite(expiry) || expiry <= now ||
        row.user_active !== true || row.user_deleted !== false || !["admin", "super_admin"].includes(row.role) ||
        !uuid.test(row.principal_id) || !uuid.test(row.membership_id) ||
        row.principal_type !== "HUMAN" || row.principal_status !== "ACTIVE" || row.risk_state !== "NORMAL" ||
        row.membership_status !== "ACTIVE" || !Number.isFinite(validFrom) || validFrom > now ||
        (row.valid_until !== null && (validUntil === null || !Number.isFinite(validUntil) || validUntil <= now)) ||
        row.tenant_status !== "ACTIVE" || row.organization_status !== "ACTIVE")
      deny("ADMIN_SESSION_REVOKED");
    const overrides = row.permission_overrides;
    if (overrides !== null && (typeof overrides !== "object" || Array.isArray(overrides)))
      deny("ADMIN_SESSION_PERMISSIONS_INVALID");
    if (overrides && Object.entries(overrides).some(([key, value]) => capabilities.has(key) && typeof value !== "boolean"))
      deny("ADMIN_SESSION_PERMISSIONS_INVALID");
    return row;
  }
  function match(row: SessionRow, binding: Binding) {
    if (row.user_id !== binding.userId || row.principal_id !== binding.context.principalId ||
        row.membership_id !== binding.membershipId || row.role !== binding.role || Number(row.issued_at) !== binding.issuedAt)
      deny("ADMIN_SESSION_REVOKED");
  }
  async function locked<T>(sid: string, operation: (row: SessionRow) => Promise<T>): Promise<T> {
    assertPersonaRuntime(runtime);
    const client = await pool.connect();
    let open = false;
    let releaseError: Error | undefined;
    try {
      const identity = (await client.query(`SELECT current_database() AS db,host(inet_server_addr()) AS host,
        inet_server_port() AS port,current_user AS role,session_user AS session_role,r.rolsuper,r.rolbypassrls
        FROM pg_roles r WHERE r.rolname=current_user`)).rows[0];
      assertPersonaDatabase(runtime, identity);
      await client.query("BEGIN"); open = true;
      await client.query("SET LOCAL statement_timeout='8000ms'");
      await client.query("SET LOCAL lock_timeout='4000ms'");
      await client.query("SET LOCAL idle_in_transaction_session_timeout='15000ms'");
      await client.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.organization_id',$2,true)",
        [project.tenantId, project.organizationId]);
      const row = await readCurrent(client, sid);
      const result = await operation(row);
      // This connection only holds authority locks; business writes use their
      // own transaction. Always release using ROLLBACK, never retry callbacks.
      await client.query("ROLLBACK"); open = false;
      return result;
    } catch (error) {
      if (open) await client.query("ROLLBACK").catch(() => { releaseError = new Error("PERSONA_SESSION_CONNECTION_DISCARDED"); });
      if (error instanceof Error && /^PERSONA_[A-Z_]+$/.test(error.message)) throw error;
      throw new Error("PERSONA_ADMIN_SESSION_UNAVAILABLE");
    } finally { client.release(releaseError); }
  }
  function getBinding(identity: PersonaMockIdentity, projectId?: string): Binding {
    assertPersonaRuntime(runtime);
    const binding = identities.get(identity);
    if (!binding || (projectId !== undefined && projectId !== project.projectId)) return deny("PROJECT_DENIED");
    const lease = executing.getStore();
    if (!lease || lease.binding !== binding || !lease.active) return deny("SESSION_BOUNDARY_REQUIRED");
    return binding;
  }
  const authority = {
    async resolveSession(req: Request): Promise<PersonaMockIdentity> {
      const sid = requestSession(req);
      return locked(sid, async (row) => {
        const binding: Binding = {
          sid, userId: row.user_id, membershipId: row.membership_id, role: row.role, issuedAt: Number(row.issued_at),
          context: Object.freeze({ tenantId: project.tenantId, organizationId: project.organizationId, principalId: row.principal_id }),
        };
        const identity: PersonaMockIdentity = Object.freeze({
          // Marker only: no bearer token or signed active-context claim is minted.
          token: "server-admin-session", tenantId: project.tenantId, principalId: row.principal_id,
          sessionFingerprint: crypto.createHash("sha256").update(sid, "ascii").digest("hex"),
          async sessionBoundary<T>(operation: () => Promise<T>): Promise<T> {
            if (!identities.has(identity) || typeof operation !== "function") deny("ADMIN_SESSION_REQUEST_INVALID");
            if (executing.getStore()?.active) deny("SESSION_BOUNDARY_REENTRANT");
            return locked(sid, async (current) => {
              match(current, binding);
              const lease = { binding, active: true };
              try { return await executing.run(lease, operation); }
              finally { lease.active = false; }
            });
          },
        });
        identities.set(identity, binding);
        return identity;
      });
    },
    contextFor(identity: PersonaMockIdentity, projectId: string): PersonaAdminContext {
      return getBinding(identity, projectId).context;
    },
    async authorize(client: PoolClient, identity: PersonaMockIdentity, projectId: string, capability: string) {
      const binding = getBinding(identity, projectId);
      if (!capabilities.has(capability)) deny("ADMIN_CAPABILITY_DENIED");
      const row = await readCurrent(client, binding.sid);
      match(row, binding);
      const overrides = row.permission_overrides as Record<string, boolean> | null;
      if (overrides?.[capability] === false) deny("ADMIN_CAPABILITY_DENIED");
      // The core takes the project FOR UPDATE mutex immediately after this
      // preflight and before any work. A SHARE lock here would let two callers
      // deadlock while both upgrade to that same project mutex.
      const scoped = (await client.query(`SELECT id FROM ai_persona_projects WHERE id=$1
        AND tenant_id=$2 AND organization_id=$3 AND active=true`,
      [project.projectId, project.tenantId, project.organizationId])).rows;
      if (scoped.length !== 1 || scoped[0].id !== projectId) deny("PROJECT_DENIED");
      return { principal: { principalType: "HUMAN" as const } };
    },
  };
  authorities.add(authority);
  return Object.freeze(authority);
}

export type PersonaAdminSessionAuthority = ReturnType<typeof createPersonaAdminSession>;
export function isPersonaAdminSessionAuthority(value: unknown): value is PersonaAdminSessionAuthority {
  return !!value && typeof value === "object" && authorities.has(value);
}
