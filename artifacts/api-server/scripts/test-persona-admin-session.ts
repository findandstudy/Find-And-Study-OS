import assert from "node:assert/strict";
import test from "node:test";
import type { Request } from "express";
import type { Pool, PoolClient } from "pg";
import { createPersonaAdminSession, isPersonaAdminSessionAuthority } from "../src/lib/personaAdminSession";
import { ABSOLUTE_SESSION_TTL } from "../src/lib/sessionLifetime";

process.env.NODE_ENV = "test";
process.env.ALLOW_LIVE_INTEGRATIONS = "false";
const id = (n: number) => `019a0000-0000-7000-8000-${String(n).padStart(12, "0")}`;
const sid = "a".repeat(64), csrf = "b".repeat(64), origin = "http://127.0.0.1:9999";
const project = { projectId: id(1), tenantId: id(2), organizationId: id(3) };
function request(headers: Record<string, string | string[] | undefined> = {}, method = "PUT") {
  return { method, headers: { cookie: `sid=${sid}; csrf_token=${csrf}`, origin, "x-csrf-token": csrf, ...headers } } as unknown as Request;
}
function fixture() {
  const now = Date.now();
  const row: Record<string, any> = {
    user_id: 14, session_user_id: 14, session_json_user_id: "14", issued_at: String(now - 10000),
    idle_expires_at: new Date(now + 300000), has_original_sid: false,
    role: "admin", user_active: true, user_deleted: false, permission_overrides: null,
    principal_id: id(4), principal_type: "HUMAN", principal_status: "ACTIVE", risk_state: "NORMAL",
    membership_id: id(5), membership_status: "ACTIVE", valid_from: new Date(now - 100000), valid_until: null,
    tenant_status: "ACTIVE", organization_status: "ACTIVE",
  };
  const state = {
    rows: 1, projectVisible: true, reads: 0, callbacks: 0, rollbackFails: false,
    db: "codex_persona_flow_test_123_456", connectCount: 0, releases: [] as Array<Error | undefined>, queries: [] as string[],
  };
  function client(): PoolClient {
    return {
      async query(sql: string) {
        state.queries.push(sql);
        if (sql.includes("current_database()")) return { rows: [{ db: state.db, host: "127.0.0.1", port: 5433, role: "persona_test", session_role: "persona_test", rolsuper: false, rolbypassrls: false }], rowCount: 1 };
        if (sql.includes("FROM sessions s")) {
          state.reads++;
          assert.match(sql, /FOR SHARE OF s,u,p,m,t,o/);
          assert.match(sql, /m\.legacy_branch_id IS NULL/);
          return { rows: Array.from({ length: state.rows }, () => structuredClone(row)), rowCount: state.rows };
        }
        if (sql.includes("FROM ai_persona_projects")) return { rows: state.projectVisible ? [{ id: project.projectId }] : [], rowCount: state.projectVisible ? 1 : 0 };
        if (sql === "ROLLBACK" && state.rollbackFails) throw new Error("broken connection");
        return { rows: [], rowCount: 0 };
      },
      release(error?: Error) { state.releases.push(error); },
    } as unknown as PoolClient;
  }
  const pool = { async connect() { state.connectCount++; return client(); } } as Pick<Pool, "connect">;
  const authority = createPersonaAdminSession({ pool, project, trustedOrigin: origin });
  return { row, state, authority, client };
}

test("admin and super_admin use a real-session authority without minting a signed context", async () => {
  for (const role of ["admin", "super_admin"]) {
    const f = fixture(); f.row.role = role;
    assert.equal(isPersonaAdminSessionAuthority(f.authority), true);
    assert.equal(isPersonaAdminSessionAuthority({ ...f.authority }), false);
    const identity = await f.authority.resolveSession(request());
    assert.equal(identity.token, "server-admin-session");
    await identity.sessionBoundary!(async () => {
      assert.deepEqual(f.authority.contextFor(identity, project.projectId), {
        tenantId: project.tenantId, organizationId: project.organizationId, principalId: id(4),
      });
      assert.deepEqual(await f.authority.authorize(f.client(), identity, project.projectId, "ai.persona.read"), { principal: { principalType: "HUMAN" } });
    });
    assert.equal(f.state.reads, 3);
    assert.equal(f.state.queries.filter(v => v === "COMMIT").length, 0);
    assert.equal(f.state.queries.filter(v => v === "ROLLBACK").length, 2);
  }
});

test("role claims and cloned identity cannot manufacture authority; project is server pinned", async () => {
  const f = fixture(), identity = await f.authority.resolveSession(request());
  assert.throws(() => f.authority.contextFor(identity, project.projectId), /SESSION_BOUNDARY_REQUIRED/);
  await identity.sessionBoundary!(async () => {
    assert.throws(() => f.authority.contextFor({ ...identity }, project.projectId), /PROJECT_DENIED/);
    assert.throws(() => f.authority.contextFor(identity, id(99)), /PROJECT_DENIED/);
    await assert.rejects(f.authority.authorize(f.client(), identity, project.projectId, "finance.refund"), /ADMIN_CAPABILITY_DENIED/);
    f.state.projectVisible = false;
    await assert.rejects(f.authority.authorize(f.client(), identity, project.projectId, "ai.persona.read"), /PROJECT_DENIED/);
  });
  f.row.role = "staff";
  const req = request(); req.user = { role: "super_admin", isActive: true, id: 14 } as any;
  await assert.rejects(f.authority.resolveSession(req), /ADMIN_SESSION_REVOKED/);
});

for (const [field, value] of [
  ["user_active", false], ["user_deleted", true], ["role", "staff"], ["session_user_id", 99],
  ["session_json_user_id", "99"], ["has_original_sid", true], ["principal_type", "AI"],
  ["principal_status", "REVOKED"], ["risk_state", "LOCKED"], ["membership_status", "SUSPENDED"],
  ["tenant_status", "SUSPENDED"], ["organization_status", "CLOSED"], ["issued_at", null],
  ["issued_at", String(Date.now() + 1000000)], ["issued_at", String(Date.now() - ABSOLUTE_SESSION_TTL - 1)],
  ["idle_expires_at", new Date(0)], ["valid_from", new Date(Date.now() + 1000000)], ["valid_until", new Date(0)],
  ["permission_overrides", []], ["permission_overrides", { "ai.persona.read": "yes" }],
] as const) test(`current account/session/membership validation rejects ${field}=${String(value)}`, async () => {
  const f = fixture(); f.row[field] = value;
  await assert.rejects(f.authority.resolveSession(request()), /PERSONA_ADMIN_SESSION_/);
});

test("missing or ambiguous memberships are not guessed", async () => {
  for (const count of [0, 2]) {
    const f = fixture(); f.state.rows = count;
    await assert.rejects(f.authority.resolveSession(request()), /MEMBERSHIP_REQUIRED/);
  }
});

test("role revocation and identity remapping invalidate an already resolved request", async () => {
  for (const [field, value] of [["role", "staff"], ["principal_id", id(98)], ["membership_id", id(99)], ["issued_at", String(Date.now() - 5000)]]) {
    const f = fixture(), identity = await f.authority.resolveSession(request());
    f.row[field] = value;
    await assert.rejects(identity.sessionBoundary!(async () => { f.state.callbacks++; }), /ADMIN_SESSION_REVOKED/);
    assert.equal(f.state.callbacks, 0);
  }
});

test("every operation checks current capability revocation, including super_admin", async () => {
  const f = fixture(); f.row.role = "super_admin";
  const identity = await f.authority.resolveSession(request());
  await identity.sessionBoundary!(async () => {
    await f.authority.authorize(f.client(), identity, project.projectId, "ai.persona.read");
    f.row.permission_overrides = { "ai.persona.read": false };
    await assert.rejects(f.authority.authorize(f.client(), identity, project.projectId, "ai.persona.read"), /ADMIN_CAPABILITY_DENIED/);
    f.row.permission_overrides = null; f.row.user_active = false;
    await assert.rejects(f.authority.authorize(f.client(), identity, project.projectId, "ai.persona.read"), /ADMIN_SESSION_REVOKED/);
  });
});

test("request guard rejects Bearer, impersonation inputs, duplicate cookies, bad origins and CSRF before DB access", async () => {
  const cases = [
    { authorization: "Bearer forged" }, { cookie: `sid=${sid}; sid=${sid}; csrf_token=${csrf}` },
    { cookie: `sid=${sid}; csrf_token=${csrf}; csrf_token=${csrf}` }, { "x-csrf-token": "c".repeat(64) },
    { "x-csrf-token": undefined }, { cookie: `sid=${sid}` }, { origin: "https://attacker.test" },
    { origin: undefined }, { referer: "https://attacker.test/" }, { origin: `${origin}/` },
    { "sec-fetch-site": "same-site" }, { origin: [origin, origin] }, { cookie: "sid=invalid" },
    { cookie: `padding=${"x".repeat(8192)}; sid=${sid}; csrf_token=${csrf}` },
    { referer: `${origin}/${"x".repeat(4096)}` }, { "x-csrf-token": "b".repeat(65) },
    { origin: "ü".repeat(200) },
  ];
  for (const headers of cases) {
    const f = fixture();
    await assert.rejects(f.authority.resolveSession(request(headers)), /PERSONA_/);
    assert.equal(f.state.connectCount, 0);
  }
  const f = fixture(), req = request(); req.apiTokenAuth = true;
  await assert.rejects(f.authority.resolveSession(req), /DIRECT_HUMAN_SESSION_REQUIRED/);
});

test("same-origin GET can use Referer; mutation still needs CSRF", async () => {
  const f = fixture();
  const identity = await f.authority.resolveSession(request({ origin: undefined, referer: `${origin}/admin/agent-team`, cookie: `sid=${sid}`, "x-csrf-token": undefined }, "GET"));
  assert.equal(identity.principalId, id(4));
  await assert.rejects(f.authority.resolveSession(request({ origin: undefined, referer: `${origin}/admin/agent-team`, cookie: `sid=${sid}`, "x-csrf-token": undefined })), /CSRF_INVALID/);
});

test("authority cannot escape its locked callback or be nested to exhaust the pool", async () => {
  const f = fixture(), identity = await f.authority.resolveSession(request());
  let release!: () => void;
  const gate = new Promise<void>(r => { release = r; });
  let late!: Promise<unknown>;
  await identity.sessionBoundary!(async () => {
    late = gate.then(() => f.authority.contextFor(identity, project.projectId));
    await assert.rejects(identity.sessionBoundary!(async () => undefined), /SESSION_BOUNDARY_REENTRANT/);
  });
  release(); await assert.rejects(late, /SESSION_BOUNDARY_REQUIRED/);
});

test("failed callback is never retried and a broken rollback discards the connection", async () => {
  const f = fixture(), identity = await f.authority.resolveSession(request());
  await assert.rejects(identity.sessionBoundary!(async () => {
    f.state.callbacks++; f.state.rollbackFails = true; throw new Error("injected");
  }), /ADMIN_SESSION_UNAVAILABLE/);
  assert.equal(f.state.callbacks, 1);
  assert.equal(f.state.releases.at(-1)?.message, "PERSONA_SESSION_CONNECTION_DISCARDED");
});

test("database and runtime guards apply before authority reads and on old identities", async () => {
  const f = fixture(); f.state.db = "fasos_apply";
  await assert.rejects(f.authority.resolveSession(request()), /TEST_DATABASE_REQUIRED/);
  assert.equal(f.state.reads, 0);
  f.state.db = "codex_persona_flow_test_123_456";
  const identity = await f.authority.resolveSession(request());
  process.env.ALLOW_LIVE_INTEGRATIONS = "true";
  try { await assert.rejects(identity.sessionBoundary!(async () => undefined), /MOCK_ONLY/); }
  finally { process.env.ALLOW_LIVE_INTEGRATIONS = "false"; }
});

test("server configuration rejects arbitrary origins and unscoped project IDs", () => {
  const f = fixture();
  const pool = { connect: async () => f.client() } as Pick<Pool, "connect">;
  for (const trustedOrigin of ["https://apply.findandstudy.com", "http://localhost:9999", `${origin}/`, "invalid"])
    assert.throws(() => createPersonaAdminSession({ pool, project, trustedOrigin }), /CONFIG_REQUIRED/);
  assert.throws(() => createPersonaAdminSession({ pool, project: { ...project, tenantId: "" }, trustedOrigin: origin }), /CONFIG_REQUIRED/);
});
