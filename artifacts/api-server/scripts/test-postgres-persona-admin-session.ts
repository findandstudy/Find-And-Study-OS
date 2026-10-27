import assert from "node:assert/strict";
import test from "node:test";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import pg from "pg";
import express from "express";
import cookieParser from "cookie-parser";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createPersonaWorkspaceApplication } from "../src/lib/personaWorkspaceApplication";
import { createPersonaAdminSession } from "../src/lib/personaAdminSession";
import { createPersonaScopedMock } from "../src/lib/personaScopedMock";
import { socialMockTeamTemplate } from "../src/lib/personaTeamDraft";
// @ts-ignore Existing browser projection is a plain JavaScript module.
import { installedTeamChoices } from "../src/lib/persona-team-tasks.client.js";
import type { Request } from "express";

// A separate database is the sole mutation target. No .env, real accounts,
// provider keys, background workers or network provider are loaded by this test.
test("admin sessions use the durable persona workspace without a KMS/signing service", async (t) => {
  assert.equal(process.env.ALLOW_DISPOSABLE_PERSONA_DB, "true");
  assert.equal(process.env.ALLOW_LIVE_INTEGRATIONS, "false");
  assert.equal(process.env.NODE_ENV, "test");
  const admin = new pg.Pool({ host: "127.0.0.1", port: 5433, user: "postgres", database: "fasos_apply_local", connectionTimeoutMillis: 2000 });
  const suffix = `${process.pid}_${Date.now()}`;
  const database = `codex_persona_flow_test_${suffix}`;
  const role = `persona_test_${suffix}`;
  const authRole = `persona_auth_test_${suffix}`;
  const prefixDatabase = `codex_persona_flow_test_${process.pid}_${Date.now() + 1}`;
  let databaseCreated = false, roleCreated = false, authRoleCreated = false, prefixCreated = false;
  let prefixFolder: string | undefined;
  let target: pg.Pool | undefined, pool: pg.Pool | undefined, server: Server | undefined;
  let authPool: pg.Pool | undefined;
  const osBrowser = process.env.PERSONA_ADMIN_OS_BROWSER_ACCEPTANCE === "true";
  const oldDatabaseUrl = process.env.DATABASE_URL;
  let authMiddleware: typeof import("../src/middlewares/authMiddleware").authMiddleware | undefined;
  let authRouter: typeof import("../src/routes/auth").default | undefined;
  const id = (n: number) => `018f7000-0000-7000-8000-${String(n).padStart(12, "0")}`;
  const project = { projectId: id(100), tenantId: id(1), organizationId: id(2) };
  const makerSid = "a".repeat(64), checkerSid = "b".repeat(64), csrf = "1".repeat(64);
  const workspace = {
    expectedRevision: 0,
    document: socialMockTeamTemplate,
    layout: { positions: [{ key: "research", x: 440, y: 220 }], zoom: 0.75, selectedKey: "research" },
  };
  async function closeServer() {
    if (!server) return;
    const closing = server;
    server = undefined;
    closing.closeIdleConnections();
    await new Promise<void>((resolve, reject) => closing.close(error => error ? reject(error) : resolve()));
  }
  try {
    assert.deepEqual((await admin.query("SELECT current_database() AS db,host(inet_server_addr()) AS host,inet_server_port() AS port")).rows[0], {
      db: "fasos_apply_local", host: "127.0.0.1", port: 5433,
    });
    assert.match(database, /^codex_persona_flow_test_\d+_\d+$/);
    assert.match(role, /^persona_test_\d+_\d+$/);
    await admin.query(`CREATE DATABASE "${database}" TEMPLATE template0`);
    databaseCreated = true;
    target = new pg.Pool({ host: "127.0.0.1", port: 5433, user: "postgres", database, connectionTimeoutMillis: 2000 });
    const migrationsFolder = fileURLToPath(new URL("../../../lib/db/drizzle", import.meta.url));
    const journal = JSON.parse(readFileSync(`${migrationsFolder}/meta/_journal.json`, "utf8"));
    const canonicalTag = "0133_persona_admin_workspace";
    const canonicalIndex = journal.entries.findIndex((entry: { tag: string }) => entry.tag === canonicalTag);
    if (canonicalIndex >= 0) {
      assert.equal(canonicalIndex, 133, "persona promotion must follow the exact staging prefix");
      assert.equal(journal.entries[canonicalIndex].idx, 133);
    }
    await migrate(drizzle(target), { migrationsFolder });
    await migrate(drizzle(target), { migrationsFolder });
    assert.equal((await target.query("SELECT count(*)::int n FROM drizzle.__drizzle_migrations")).rows[0].n, journal.entries.length);
    if (canonicalIndex < 0) {
      // The existing local Pages branch has its own later migrations. Only the
      // exact promoted tag above substitutes for these six prepared migrations.
      for (const migration of [
        "persona_phase1_scoped_mock.sql", "persona_phase2_team_drafts.sql",
        "persona_phase2_team_instances.sql", "persona_phase3_workflow.sql",
        "persona_phase4_conversation.sql", "persona_phase5_team_workspace.sql",
      ]) await target.query(readFileSync(new URL(`../../../lib/db/migrations-pending/${migration}`, import.meta.url), "utf8"));
    }
    if (canonicalIndex >= 0) await t.test("staging prefix 133 adopts the persona migration without changing existing product rows or claiming legacy personas", async () => {
      assert.match(prefixDatabase, /^codex_persona_flow_test_\d+_\d+$/);
      assert.notEqual(prefixDatabase, database);
      await admin.query(`CREATE DATABASE "${prefixDatabase}" TEMPLATE template0`);
      prefixCreated = true;
      const prefix = new pg.Pool({ host: "127.0.0.1", port: 5433, user: "postgres", database: prefixDatabase, connectionTimeoutMillis: 2000 });
      try {
        prefixFolder = mkdtempSync(join(tmpdir(), "fas-persona-prefix-"));
        mkdirSync(join(prefixFolder, "meta"));
        writeFileSync(join(prefixFolder, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, canonicalIndex) }));
        for (const entry of journal.entries.slice(0, canonicalIndex)) copyFileSync(join(migrationsFolder, `${entry.tag}.sql`), join(prefixFolder, `${entry.tag}.sql`));
        await migrate(drizzle(prefix), { migrationsFolder: prefixFolder });
        assert.equal((await prefix.query("SELECT count(*)::int n FROM drizzle.__drizzle_migrations")).rows[0].n, 133);
        await prefix.query(`
          INSERT INTO users(id,email,first_name,last_name,role,language) VALUES(930001,'prefix-fixture@example.test','Synthetic','Prefix','staff','en');
          INSERT INTO leads(id,first_name,last_name,status) VALUES(930001,'Synthetic','Prefix lead','new');
          INSERT INTO students(id,first_name,last_name,status) VALUES(930001,'Synthetic','Prefix student','active');
          INSERT INTO applications(id,student_id,stage) VALUES(930001,930001,'inquiry');
          INSERT INTO website_pages(id,title,slug,status) VALUES(930001,'Synthetic prefix page','synthetic-persona-prefix','draft');
          INSERT INTO ai_personas(id,name,slug,provider,model,is_active) VALUES(930001,'Unowned synthetic legacy persona','synthetic-unowned-prefix','anthropic','mock-fixture',false);
        `);
        const preserved = ["users", "leads", "students", "applications", "website_pages", "ai_personas"];
        const snapshot = async () => Promise.all(preserved.map(async table => ({ table, rows: (await prefix.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY id`)).rows })));
        const before = await snapshot();
        await migrate(drizzle(prefix), { migrationsFolder });
        await migrate(drizzle(prefix), { migrationsFolder });
        assert.equal((await prefix.query("SELECT count(*)::int n FROM drizzle.__drizzle_migrations")).rows[0].n, journal.entries.length);
        assert.deepEqual(await snapshot(), before);
        assert.equal((await prefix.query("SELECT count(*)::int n FROM ai_persona_ownership")).rows[0].n, 0);
        assert.equal((await prefix.query("SELECT count(*)::int n FROM ai_persona_project_assignments")).rows[0].n, 0);
      } finally { await prefix.end(); }
      await admin.query(`DROP DATABASE "${prefixDatabase}"`);
      prefixCreated = false;
    });
    const personaTables = [
      "ai_persona_projects", "ai_persona_project_assignments", "ai_persona_ownership", "ai_persona_approval_bindings",
      "ai_persona_executions", "ai_persona_mock_receipts", "ai_persona_team_drafts", "ai_persona_team_instances",
      "ai_persona_team_members", "ai_persona_workflows", "ai_persona_workflow_nodes", "ai_persona_workflow_reviews",
      "ai_persona_message_scope", "ai_persona_team_workspaces",
    ];
    await t.test("full migration chain replay and all 14 persona tables have FORCE RLS", async () => {
      assert.equal((await target!.query("SELECT count(*)::int n FROM pg_class WHERE relname=ANY($1::text[]) AND relrowsecurity AND relforcerowsecurity", [personaTables])).rows[0].n, 14);
      assert.equal((await target!.query("SELECT to_regclass('public.ai_persona_social_links') AS optional_social")).rows[0].optional_social, null);
    });
    await admin.query(`CREATE ROLE "${role}" NOLOGIN NOSUPERUSER NOBYPASSRLS`);
    roleCreated = true;
    await target.query(`GRANT USAGE ON SCHEMA public TO "${role}";
      GRANT SELECT(id,role,is_active,deleted_at,permission_overrides) ON users TO "${role}";
      GRANT SELECT(sid,user_id,sess,expire) ON sessions TO "${role}";
      GRANT SELECT(id,legacy_user_id,principal_type,status,risk_state) ON principals TO "${role}";
      GRANT SELECT(id,principal_id,tenant_id,organization_id,legacy_branch_id,status,valid_from,valid_until) ON memberships TO "${role}";
      GRANT SELECT(id,status) ON tenants TO "${role}";
      GRANT SELECT(id,tenant_id,status) ON organizations TO "${role}";
      GRANT UPDATE(id) ON users,principals,memberships,tenants,organizations TO "${role}";
      GRANT UPDATE(expire) ON sessions TO "${role}";
      GRANT SELECT ON ${personaTables.join(",")},ai_personas,ai_action_queue,ai_persona_runs,ai_persona_messages TO "${role}";
      GRANT UPDATE(id) ON ai_persona_projects TO "${role}";
      GRANT UPDATE(persona_id) ON ai_persona_ownership TO "${role}";
      GRANT INSERT ON ai_action_queue,ai_persona_runs,ai_persona_approval_bindings,ai_persona_executions,
        ai_persona_team_drafts,ai_persona_team_workspaces,ai_persona_workflows,ai_persona_messages,ai_persona_message_scope TO "${role}";
      GRANT INSERT ON ai_persona_mock_receipts,ai_personas,ai_persona_ownership,ai_persona_team_instances,
        ai_persona_team_members,ai_persona_workflow_nodes,ai_persona_workflow_reviews TO "${role}";
      GRANT UPDATE(is_active) ON ai_personas TO "${role}";
      GRANT UPDATE(reviewer,reviewed_at) ON ai_persona_team_drafts TO "${role}";
      GRANT UPDATE(status) ON ai_persona_team_instances TO "${role}";
      GRANT UPDATE(revision,document,layout) ON ai_persona_team_workspaces TO "${role}";
      GRANT UPDATE(reviewer,reviewed_at,consumed_by) ON ai_persona_approval_bindings TO "${role}";
      GRANT UPDATE(state,actual_micros) ON ai_persona_executions TO "${role}";
      GRANT UPDATE(state) ON ai_persona_workflows TO "${role}";
      GRANT UPDATE(purged_at,source_label) ON ai_persona_message_scope TO "${role}";
      GRANT UPDATE(status,reviewed_at,executed_at) ON ai_action_queue TO "${role}";
      GRANT UPDATE(status,cost_usd,error_message,output_payload) ON ai_persona_runs TO "${role}";
      GRANT UPDATE(content,tool_calls) ON ai_persona_messages TO "${role}";
      GRANT USAGE ON SEQUENCE ai_personas_id_seq,ai_action_queue_id_seq,ai_persona_runs_id_seq,
        ai_persona_messages_id_seq,ai_persona_team_drafts_action_id_seq TO "${role}";`);
    await target.query("INSERT INTO tenants(id,slug,legal_name,display_name,home_region,status) VALUES($1,'persona-admin-synthetic','Synthetic workspace','Synthetic workspace','test','ACTIVE')", [id(1)]);
    await target.query("INSERT INTO organizations(id,tenant_id,legal_name,display_name,organization_type) VALUES($1,$2,'Synthetic organization','Synthetic organization','INTERNAL_LEGAL_ENTITY')", [id(2), id(1)]);
    await target.query("INSERT INTO organizations(id,tenant_id,legal_name,display_name,organization_type) VALUES($1,$2,'Unrelated synthetic organization','Unrelated synthetic organization','INTERNAL_LEGAL_ENTITY')", [id(200), id(1)]);
    const now = Date.now();
    for (const actor of [
      { index: 1, sid: makerSid, role: "admin", member: true, active: true, organization: id(2) },
      { index: 2, sid: checkerSid, role: "super_admin", member: true, active: true, organization: id(2) },
      { index: 3, sid: "c".repeat(64), role: "staff", member: true, active: true, organization: id(2) },
      { index: 4, sid: "d".repeat(64), role: "admin", member: true, active: false, organization: id(2) },
      { index: 5, sid: "e".repeat(64), role: "super_admin", member: false, active: true, organization: id(2) },
      { index: 6, sid: "f".repeat(64), role: "admin", member: true, active: true, organization: id(200) },
    ]) {
      const userId = 920000 + actor.index;
      await target.query("INSERT INTO users(id,email,first_name,last_name,role,language,is_active,email_verified) VALUES($1,$2,'Synthetic','Admin session',$3,'en',$4,true)", [userId, `persona-admin-${actor.index}@example.test`, actor.role, actor.active]);
      await target.query("INSERT INTO principals(id,principal_type,issuer,subject,legacy_user_id) VALUES($1,'HUMAN','persona-admin-test',$2,$3)", [id(10 + actor.index), `synthetic-${actor.index}`, userId]);
      if (actor.member) await target.query("INSERT INTO memberships(id,tenant_id,organization_id,principal_id,status,valid_from) VALUES($1,$2,$3,$4,'ACTIVE',now()-interval '1 day')", [id(20 + actor.index), id(1), actor.organization, id(10 + actor.index)]);
      // Deliberately untrusted/stale session role: authoritative role is users.role.
      await target.query("INSERT INTO sessions(sid,sess,expire,user_id) VALUES($1,$2,to_timestamp($3::bigint/1000.0) AT TIME ZONE 'UTC',$4)", [actor.sid, { user: { id: userId, role: "super_admin" }, issued_at: now - 1000 }, now + 600000, userId]);
    }
    await target.query("INSERT INTO ai_persona_projects(id,tenant_id,organization_id,label,cap_micros,mock_bound_micros,period_start,period_end,costs_verified,active) VALUES($1,$2,$3,'Synthetic admin workspace',1000000,50,now()-interval '1 day',now()+interval '1 day',true,true)", [id(100), id(1), id(2)]);
    await target.query("INSERT INTO ai_persona_projects(id,tenant_id,organization_id,label,cap_micros,mock_bound_micros,period_start,period_end,costs_verified,active) VALUES($1,$2,$3,'Unconfigured project',1000000,50,now()-interval '1 day',now()+interval '1 day',true,true)", [id(101), id(1), id(2)]);
    const firstTeamProject = { ...project, projectId: id(102) };
    await target.query("INSERT INTO ai_persona_projects(id,tenant_id,organization_id,label,cap_micros,mock_bound_micros,period_start,period_end,costs_verified,active) VALUES($1,$2,$3,'Synthetic empty first team',1000000,50,now()-interval '1 day',now()+interval '1 day',true,true)", [firstTeamProject.projectId, id(1), id(2)]);
    const personaId = (await target.query("INSERT INTO ai_personas(name,slug,provider,model,is_active,tools_enabled,allowed_data_scopes) VALUES('Synthetic KMS-free draft specialist','synthetic-admin-session-copy','anthropic','mock-fixture',true,'[\"mock_draft\"]','[\"persona_mock_context\"]') RETURNING id")).rows[0].id;
    await target.query("INSERT INTO ai_persona_ownership(persona_id,tenant_id,organization_id,project_id,cap_micros,active,evidence_ref,maker,checker) VALUES($1,$2,$3,$4,1000000,true,'synthetic-explicit-admin-workspace',$5,$6)", [personaId, id(1), id(2), id(100), id(11), id(12)]);
    pool = new pg.Pool({ host: "127.0.0.1", port: 5433, user: "postgres", database, options: `-c role=${role}`, max: 6, connectionTimeoutMillis: 2000 });
    if (osBrowser) {
      // The real OS auth read path uses its established pool. Pin it BEFORE
      // importing that module to this exact disposable DB. Its independent
      // role must not widen the persona runtime's column-limited authority reads.
      await admin.query(`CREATE ROLE "${authRole}" NOLOGIN NOSUPERUSER NOBYPASSRLS`);
      authRoleCreated = true;
      await target.query(`GRANT USAGE ON SCHEMA public TO "${authRole}";
        GRANT SELECT ON users,sessions,roles TO "${authRole}";
        GRANT UPDATE(expire) ON sessions TO "${authRole}"`);
      const authUrl = new URL(`postgresql://postgres@127.0.0.1:5433/${database}`);
      authUrl.searchParams.set("options", `-c role=${authRole}`);
      process.env.DATABASE_URL = authUrl.toString();
      authPool = (await import("@workspace/db")).pool;
      assert.deepEqual((await authPool.query("SELECT current_database() db,host(inet_server_addr()) host,inet_server_port() port,current_user role,r.rolsuper,r.rolbypassrls FROM pg_roles r WHERE r.rolname=current_user")).rows[0], {
        db: database, host: "127.0.0.1", port: 5433, role: authRole, rolsuper: false, rolbypassrls: false,
      });
      ({ authMiddleware } = await import("../src/middlewares/authMiddleware"));
      ({ default: authRouter } = await import("../src/routes/auth"));
    }

    async function openServer(configuredProject = project) {
      const app = express();
      server = app.listen(0, "127.0.0.1");
      await new Promise<void>(resolve => server!.once("listening", resolve));
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      const origin = `http://127.0.0.1:${address.port}`;
      app.use(cookieParser());
      app.use("/api/persona-workspace", createPersonaWorkspaceApplication({
        pool: pool!, adminSession: { project: configuredProject, trustedOrigin: origin },
      }));
      if (osBrowser) {
        // Only the normal authenticated read route is mounted; no login,
        // mail, registration, upload or unrelated business mutation is exposed.
        app.use("/api", (request, response, next) => {
          if (request.method !== "GET" || request.path !== "/auth/me") { next(); return; }
          void authMiddleware!(request, response, () => authRouter!(request, response, next)).catch(next);
        });
        app.use("/api", (_request, response) => response.status(404).json({ error: "TEST_ROUTE_NOT_MOUNTED" }));
        const publicDirectory = fileURLToPath(new URL("../../edcons/dist/public/", import.meta.url));
        assert.ok(existsSync(`${publicDirectory}/index.html`), "Build normal Edcons OS before running browser acceptance");
        app.use(express.static(publicDirectory, { index: false }));
        app.get(/^\/admin\/agent-team-workspace(?:\/[a-f0-9-]{36})?$/, (_request, response) => response.sendFile(`${publicDirectory}/index.html`));
      }
      const request = async (path: string, options: { sid?: string; method?: string; body?: unknown; projectId?: string; rootPath?: true; headers?: Record<string, string | null> } = {}) => {
        const headers: Record<string, string> = {
          cookie: `sid=${options.sid ?? makerSid}; csrf_token=${csrf}`,
          origin, "x-csrf-token": csrf, "content-type": "application/json",
        };
        for (const [key, value] of Object.entries(options.headers ?? {})) {
          if (value === null) delete headers[key]; else headers[key] = value;
        }
        const response = await fetch(`${origin}/api/persona-workspace${options.rootPath ? "" : `/${options.projectId ?? configuredProject.projectId}`}${path}`, {
          method: options.method ?? "GET", headers,
          ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
          signal: AbortSignal.timeout(20000),
        });
        return { status: response.status, data: await response.json() as any, headers: response.headers };
      };
      return Object.assign(request, { origin });
    }
    let call = await openServer();
    const post = (path: string, body?: unknown, sid = makerSid) => call(path, { method: "POST", body, sid });
    const denied = (value: Awaited<ReturnType<typeof call>>) => {
      assert.ok(value.status >= 400 && value.status < 500, JSON.stringify(value.data));
      assert.match(value.data.error, /^PERSONA_(?:ADMIN_SESSION_(?:MEMBERSHIP_REQUIRED|REVOKED|COOKIE_INVALID|ORIGIN_INVALID|CSRF_INVALID)|DIRECT_HUMAN_SESSION_REQUIRED|PROJECT_DENIED|ADMIN_CAPABILITY_DENIED|PROJECT_ACCESS_REQUIRED)$/);
    };

    await t.test("real admin and super-admin sessions enter the same pinned mock project", async () => {
      for (const sid of [makerSid, checkerSid]) {
        const context = await call("/context", { sid });
        assert.equal(context.status, 200, JSON.stringify(context.data));
        assert.equal(context.data.project.id, project.projectId);
        assert.equal(context.data.providerConnected, false);
        assert.equal(context.data.mode, "mock");
        assert.equal(context.headers.get("cache-control"), "private, no-store");
        const discovery = await call("/projects", { sid, rootPath: true });
        assert.equal(discovery.status, 200);
        assert.deepEqual(discovery.data, { projects: [{ id: project.projectId, label: "Synthetic admin workspace" }], mode: "disposable-test" });
      }
    });
    await t.test("staff, inactive, absent membership and other organization are denied despite cached super-admin session role", async () => {
      for (const sid of ["c", "d", "e", "f"].map(c => c.repeat(64))) denied(await call("/team-workspace", { sid }));
      denied(await call("/projects", { sid: "c".repeat(64), rootPath: true }));
    });
    await t.test("missing session, bearer, duplicate cookies, foreign project and cross-origin writes are denied", async () => {
      denied(await call("/personas", { headers: { cookie: null } }));
      denied(await call("/personas", { headers: { authorization: "Bearer synthetic-not-a-token" } }));
      denied(await call("/personas", { headers: { cookie: `sid=${makerSid}; sid=${checkerSid}; csrf_token=${csrf}` } }));
      denied(await call("/history", { projectId: id(101) }));
      denied(await call("/team-workspace", { method: "PUT", body: workspace, headers: { origin: "https://unrelated.example.test" } }));
      denied(await call("/team-workspace", { method: "PUT", body: workspace, headers: { "x-csrf-token": null } }));
      denied(await call("/team-workspace", { method: "PUT", body: workspace, headers: { "x-csrf-token": "2".repeat(64) } }));
      assert.equal((await target!.query("SELECT count(*)::int n FROM ai_persona_team_workspaces")).rows[0].n, 0);
    });
    let saved: any;
    await t.test("workspace persists, private layout is isolated and concurrent stale saves cannot overwrite", async () => {
      const result = await call("/team-workspace", { method: "PUT", body: workspace });
      assert.equal(result.status, 200, JSON.stringify(result.data));
      assert.equal(result.data.approved, false);
      assert.equal(result.data.activated, false);
      assert.equal(result.data.workspace.revision, 1);
      assert.equal((await call("/team-workspace", { sid: checkerSid })).data.workspace, null);
      const race = await Promise.all([1, 2].map(() => call("/team-workspace", { method: "PUT", body: { ...workspace, expectedRevision: 1 } })));
      assert.equal(race.filter(r => r.status === 200).length, 1);
      assert.equal(race.filter(r => r.data.error === "PERSONA_WORKSPACE_CONFLICT").length, 1);
      saved = (await call("/team-workspace")).data.workspace;
      assert.equal(saved.revision, 2);
    });
    await t.test("HTTP application recreation restores the exact durable workspace without a signing key", async () => {
      await closeServer();
      call = await openServer();
      assert.deepEqual((await call("/team-workspace")).data.workspace, saved);
      assert.equal((await call("/team-workspace", { sid: checkerSid })).data.workspace, null);
    });
    let approved: { actionId: number; digest: string };
    await t.test("two separate current administrators complete proposal, review, approval and mock execution", async () => {
      const proposed = await post("/proposals", { personaId, content: "Synthetic local-only administrator draft", target: "local-preview" });
      assert.equal(proposed.status, 200, JSON.stringify(proposed.data));
      approved = proposed.data;
      const self = await post(`/approvals/${approved.actionId}`, { digest: approved.digest });
      assert.equal(self.data.error, "PERSONA_SELF_APPROVAL_DENIED");
      const review = await call(`/approvals/${approved.actionId}`, { sid: checkerSid });
      assert.equal(review.status, 200);
      assert.equal(review.data.intent.content, "Synthetic local-only administrator draft");
      const races = await Promise.all([1, 2].map(() => post(`/approvals/${approved.actionId}`, { digest: approved.digest }, checkerSid)));
      assert.equal(races.filter(r => r.status === 200).length, 1);
      assert.equal((await target!.query("SELECT count(*)::int n FROM ai_persona_executions")).rows[0].n, 0);
      const executions = await Promise.all([1, 2, 3, 4].map(() => post(`/executions/${approved.actionId}`)));
      assert.ok(executions.every(r => r.status === 200), JSON.stringify(executions.map(r => r.data)));
      assert.equal(new Set(executions.map(r => r.data.executionId)).size, 1);
      const persisted = (await target!.query("SELECT state,actual_micros FROM ai_persona_executions WHERE approval_id=$1", [approved.actionId])).rows;
      assert.equal(persisted.length, 1);
      assert.equal(persisted[0].state, "SUCCEEDED");
      assert.equal(Number(persisted[0].actual_micros), 20);
      assert.equal((await target!.query("SELECT count(*)::int n FROM ai_persona_mock_receipts")).rows[0].n, 1);
      assert.equal((await call("/history")).data.length, 1);
    });
    await t.test("current role downgrade, explicit permission revocation and inactive account immediately deny reused cookies", async () => {
      await target!.query("UPDATE users SET role='staff' WHERE id=920001");
      denied(await call("/team-workspace"));
      await target!.query("UPDATE users SET role='admin',permission_overrides=$1 WHERE id=920001", [{ "ai.persona.read": false }]);
      denied(await call("/personas"));
      await target!.query("UPDATE users SET permission_overrides=NULL,is_active=false WHERE id=920001");
      denied(await call("/team-workspace"));
      await target!.query("UPDATE users SET is_active=true WHERE id=920001");
      assert.equal((await call("/personas")).status, 200);
      await target!.query("UPDATE principals SET legacy_user_id=NULL WHERE id=$1", [id(11)]);
      denied(await call("/personas"));
      await target!.query("UPDATE principals SET legacy_user_id=920001 WHERE id=$1", [id(11)]);
      assert.equal((await call("/personas")).status, 200);
    });
    await t.test("impersonated, idle-expired and absolute-expired database sessions are denied", async () => {
      await target!.query("UPDATE sessions SET sess=sess || $2::jsonb WHERE sid=$1", [makerSid, { originalSid: checkerSid }]);
      denied(await call("/personas"));
      await target!.query("UPDATE sessions SET sess=sess-'originalSid',expire=(now()-interval '1 second') AT TIME ZONE 'UTC' WHERE sid=$1", [makerSid]);
      denied(await call("/personas"));
      await target!.query("UPDATE sessions SET expire=(now()+interval '10 minutes') AT TIME ZONE 'UTC',sess=jsonb_set(sess,'{issued_at}',$2::jsonb) WHERE sid=$1", [makerSid, JSON.stringify(Date.now() - 25 * 3600000)]);
      denied(await call("/personas"));
      await target!.query("UPDATE sessions SET sess=jsonb_set(sess,'{issued_at}',$2::jsonb) WHERE sid=$1", [makerSid, JSON.stringify(Date.now() - 1000)]);
      assert.equal((await call("/personas")).status, 200);
    });
    await t.test("membership revocation, ambiguity and tenant suspension fail closed", async () => {
      await target!.query("UPDATE memberships SET status='SUSPENDED' WHERE id=$1", [id(21)]);
      denied(await call("/personas"));
      await target!.query("UPDATE memberships SET status='ACTIVE' WHERE id=$1", [id(21)]);
      await target!.query("INSERT INTO memberships(id,tenant_id,organization_id,principal_id,status,valid_from) VALUES($1,$2,$3,$4,'ACTIVE',now()-interval '1 day')", [id(99), id(1), id(2), id(11)]);
      denied(await call("/personas"));
      await target!.query("UPDATE memberships SET status='REVOKED' WHERE id=$1", [id(99)]);
      await target!.query("UPDATE tenants SET status='SUSPENDED' WHERE id=$1", [id(1)]);
      denied(await call("/personas"));
      await target!.query("UPDATE tenants SET status='ACTIVE' WHERE id=$1", [id(1)]);
      assert.equal((await call("/personas")).status, 200);
    });
    await t.test("budget race consumes only the remaining project reservation", async () => {
      const proposals = [];
      for (const content of ["Synthetic budget race one", "Synthetic budget race two"]) {
        const value = await post("/proposals", { personaId, content, target: "local-preview" });
        assert.equal(value.status, 200);
        assert.equal((await post(`/approvals/${value.data.actionId}`, { digest: value.data.digest }, checkerSid)).status, 200);
        proposals.push(value.data.actionId);
      }
      // Prior actual usage 20 + exactly one possible 50-unit reservation.
      await target!.query("UPDATE ai_persona_projects SET cap_micros=70 WHERE id=$1", [project.projectId]);
      const executions = await Promise.all(proposals.map(actionId => post(`/executions/${actionId}`)));
      assert.equal(executions.filter(r => r.status === 200).length, 1, JSON.stringify(executions.map(r => r.data)));
      assert.equal(executions.filter(r => r.data.error === "PERSONA_BUDGET_EXCEEDED").length, 1);
      await target!.query("UPDATE ai_persona_projects SET cap_micros=1000000 WHERE id=$1", [project.projectId]);
    });
    await t.test("admin session/account locks span each operation and forged identities have no authority", async () => {
      const trustedOrigin = "http://127.0.0.1:1";
      const authority = createPersonaAdminSession({ pool: pool!, project, trustedOrigin });
      const identity = await authority.resolveSession({ method: "POST", headers: {
        cookie: `sid=${makerSid}; csrf_token=${csrf}`, origin: trustedOrigin, "x-csrf-token": csrf,
      } } as Request);
      await identity.sessionBoundary!(async () => {
        const connection = await target!.connect();
        try {
          await connection.query("BEGIN; SET LOCAL lock_timeout='100ms'");
          await assert.rejects(connection.query("UPDATE users SET is_active=false WHERE id=920001"), { code: "55P03" });
        } finally { await connection.query("ROLLBACK"); connection.release(); }
      });
      const service = createPersonaScopedMock(pool!, { adminSession: authority });
      await assert.rejects(service.list({ ...identity }, project.projectId), /PERSONA_PROJECT_DENIED/);
      assert.equal((await service.list(identity, project.projectId)).length, 1);
    });
    await t.test("dispatch crash keeps its reservation and separate admin reconciliation does not resend", async () => {
      const proposed = await post("/proposals", { personaId, content: "Synthetic crash checkpoint", target: "local-preview" });
      assert.equal(proposed.status, 200);
      assert.equal((await post(`/approvals/${proposed.data.actionId}`, { digest: proposed.data.digest }, checkerSid)).status, 200);
      const trustedOrigin = "http://127.0.0.1:1";
      const authority = createPersonaAdminSession({ pool: pool!, project, trustedOrigin });
      const resolve = (sid: string) => authority.resolveSession({ method: "POST", headers: {
        cookie: `sid=${sid}; csrf_token=${csrf}`, origin: trustedOrigin, "x-csrf-token": csrf,
      } } as Request);
      const crashing = createPersonaScopedMock(pool!, { adminSession: authority }, async point => {
        if (point === "after_dispatch") throw new Error("SYNTHETIC_ADMIN_DISPATCH_CRASH");
      });
      await assert.rejects(crashing.execute(await resolve(makerSid), project.projectId, proposed.data.actionId), /SYNTHETIC_ADMIN_DISPATCH_CRASH/);
      const execution = (await target!.query("SELECT id,state,reserved_micros,actual_micros FROM ai_persona_executions WHERE approval_id=$1", [proposed.data.actionId])).rows[0];
      assert.equal(execution.state, "DISPATCHED");
      assert.equal(execution.actual_micros, null);
      assert.equal(Number(execution.reserved_micros), 50);
      const recovered = createPersonaScopedMock(pool!, { adminSession: authority });
      const result = await recovered.reconcile(await resolve(checkerSid), project.projectId, execution.id);
      assert.equal(result.state, "UNCERTAIN");
      assert.equal(result.reservationHeld, true);
      assert.equal((await target!.query("SELECT count(*)::int n FROM ai_persona_mock_receipts WHERE execution_id=$1", [execution.id])).rows[0].n, 0);
      const replay = await recovered.execute(await resolve(makerSid), project.projectId, proposed.data.actionId);
      assert.equal(replay.executionId, execution.id);
      assert.equal(replay.replay, true);
      assert.equal((await target!.query("SELECT count(*)::int n FROM ai_persona_executions WHERE approval_id=$1", [proposed.data.actionId])).rows[0].n, 1);
    });
    await t.test("an empty project creates its first scoped paused team, then two admins run one mock task exactly once", async () => {
      await closeServer();
      call = await openServer(firstTeamProject);
      try {
        assert.deepEqual((await call("/personas")).data, []);
        assert.deepEqual((await call("/teams")).data, []);
        assert.equal((await target!.query("SELECT count(*)::int n FROM ai_persona_ownership WHERE project_id=$1", [firstTeamProject.projectId])).rows[0].n, 0);
        const queueBefore = (await target!.query("SELECT count(*)::int n FROM ai_action_queue")).rows[0].n;
        const personaCountBefore = (await target!.query("SELECT count(*)::int n FROM ai_personas")).rows[0].n;
        denied(await call("/team-drafts", { method: "POST", sid: "c".repeat(64), body: { document: socialMockTeamTemplate } }));
        const proposed = await post("/team-drafts", { document: socialMockTeamTemplate });
        assert.equal(proposed.status, 200, JSON.stringify(proposed.data));
        assert.equal(proposed.data.activated, false);
        const draftId = proposed.data.actionId, hash = proposed.data.digest;
        assert.ok(Number.isSafeInteger(draftId) && draftId > 0);
        assert.match(hash, /^[a-f0-9]{64}$/);
        assert.equal((await target!.query("SELECT count(*)::int n FROM ai_action_queue")).rows[0].n, queueBefore, "a human team draft must not create a runnable legacy queue item");
        assert.equal((await target!.query("SELECT count(*)::int n FROM ai_personas")).rows[0].n, personaCountBefore, "drafting must not create a placeholder persona");
        const reviews = await call("/team-drafts", { sid: checkerSid });
        assert.equal(reviews.status, 200);
        assert.equal(reviews.data.length, 1);
        assert.equal(reviews.data[0].action_id, draftId);
        assert.deepEqual(reviews.data[0].document, proposed.data.document);
        assert.equal(reviews.data[0].reviewer, null);
        assert.equal((await post(`/team-drafts/${draftId}/approve`, { digest: hash })).data.error, "PERSONA_SELF_APPROVAL_DENIED");
        assert.equal((await post(`/team-drafts/${draftId}/approve`, { digest: "0".repeat(64) }, checkerSid)).data.error, "PERSONA_APPROVAL_STALE");
        assert.equal((await post(`/team-drafts/${draftId}/install`, { digest: hash })).data.error, "PERSONA_APPROVAL_REQUIRED");
        const approvedTeam = await post(`/team-drafts/${draftId}/approve`, { digest: hash }, checkerSid);
        assert.equal(approvedTeam.status, 200, JSON.stringify(approvedTeam.data));
        assert.equal(approvedTeam.data.activated, false);
        assert.equal((await post(`/team-drafts/${draftId}/install`, { digest: "0".repeat(64) })).data.error, "PERSONA_APPROVAL_STALE");
        const installations = await Promise.all([1, 2].map(() => post(`/team-drafts/${draftId}/install`, { digest: hash })));
        assert.ok(installations.every(value => value.status === 200), JSON.stringify(installations.map(value => value.data)));
        assert.equal(new Set(installations.map(value => value.data.id)).size, 1);
        assert.equal(installations.filter(value => value.data.replay === false).length, 1);
        assert.ok(installations.every(value => value.data.status === "PAUSED" && value.data.grantsCreated === 0));
        const teamId = installations[0].data.id;
        const members = (await target!.query(`SELECT p.id,p.is_active,p.model,o.tenant_id,o.organization_id,o.project_id,o.maker,o.checker,m.member_key
          FROM ai_persona_team_members m JOIN ai_persona_ownership o ON o.persona_id=m.persona_id JOIN ai_personas p ON p.id=m.persona_id
          WHERE m.team_id=$1 ORDER BY m.member_key`, [teamId])).rows;
        assert.equal(members.length, socialMockTeamTemplate.members.length);
        assert.ok(members.every(member => member.is_active === false && member.model === "mock-fixture" && member.tenant_id === project.tenantId && member.organization_id === project.organizationId && member.project_id === firstTeamProject.projectId && member.maker === id(11) && member.checker === id(12)));
        assert.equal((await target!.query("SELECT count(*)::int n FROM ai_personas")).rows[0].n, personaCountBefore + members.length);
        assert.equal((await target!.query("SELECT count(*)::int n FROM ai_action_queue")).rows[0].n, queueBefore);
        const taskPersonaId = members.find(member => member.member_key === "copy")!.id;
        const taskBody = { personaId: taskPersonaId, content: "Synthetic first-team mock draft", target: "local-preview" };
        assert.equal((await post("/proposals", taskBody)).data.error, "PERSONA_OWNERSHIP_REQUIRED", "paused team must not execute");
        const unpaused = await post(`/teams/${teamId}/pause`, { paused: false });
        assert.equal(unpaused.status, 200);
        assert.equal(unpaused.data.status, "MOCK_READY");
        assert.equal(unpaused.data.providerActivation, false);
        // The recent-version endpoint remains bounded to 50. An older
        // installed team's own reviewed source must still bind its members.
        for (let index = 0; index < 51; index++) {
          const later = await post("/team-drafts", {
            document: { ...socialMockTeamTemplate, name: `Synthetic later version ${index}` },
          });
          assert.equal(later.status, 200, JSON.stringify(later.data));
        }
        const recentDrafts = await call("/team-drafts");
        const installedRows = await call("/teams");
        assert.equal(recentDrafts.status, 200);
        assert.equal(installedRows.status, 200);
        assert.equal(recentDrafts.data.length, 50);
        assert.equal(recentDrafts.data.some((draft: any) => draft.action_id === draftId), false);
        assert.ok(installedRows.data.every((row: any) => row.source_digest === hash && row.source_reviewer === id(12)));
        const choices = installedTeamChoices(installedRows.data, recentDrafts.data);
        assert.equal(choices.length, 1, "installed team survives the recent draft window");
        const selectedMember = choices[0].members.find((member: any) => member.key === "copy");
        assert.equal(selectedMember?.personaId, taskPersonaId);
        taskBody.personaId = selectedMember.personaId;
        const task = await post("/proposals", taskBody);
        assert.equal(task.status, 200, JSON.stringify(task.data));
        assert.equal((await post(`/approvals/${task.data.actionId}`, { digest: task.data.digest }, checkerSid)).status, 200);
        const executions = await Promise.all([1, 2, 3].map(() => post(`/executions/${task.data.actionId}`)));
        assert.ok(executions.every(value => value.status === 200), JSON.stringify(executions.map(value => value.data)));
        assert.equal(new Set(executions.map(value => value.data.executionId)).size, 1);
        const result = (await target!.query("SELECT e.state,e.actual_micros,count(r.execution_id)::int receipt_count FROM ai_persona_executions e LEFT JOIN ai_persona_mock_receipts r ON r.execution_id=e.id WHERE e.project_id=$1 AND e.approval_id=$2 GROUP BY e.id", [firstTeamProject.projectId, task.data.actionId])).rows;
        assert.equal(result.length, 1);
        assert.equal(result[0].state, "SUCCEEDED");
        assert.equal(Number(result[0].actual_micros), 20);
        assert.equal(result[0].receipt_count, 1);
        assert.equal((await call("/history")).data.length, 1);
        assert.equal((await post(`/teams/${teamId}/pause`, { paused: true })).data.status, "PAUSED");
        assert.equal((await post("/proposals", taskBody)).data.error, "PERSONA_OWNERSHIP_REQUIRED");
      } finally {
        await closeServer();
        call = await openServer();
      }
    });
    if (osBrowser) await t.test("normal OS browser completes the first-team and two-admin mock task workflow through real session and database routes", async () => {
      const browserProject = { ...project, projectId: id(103) };
      await target!.query("INSERT INTO ai_persona_projects(id,tenant_id,organization_id,label,cap_micros,mock_bound_micros,period_start,period_end,costs_verified,active) VALUES($1,$2,$3,'Synthetic OS browser project',1000000,50,now()-interval '1 day',now()+interval '1 day',true,true)", [browserProject.projectId, id(1), id(2)]);
      await closeServer();
      call = await openServer(browserProject);
      try {
        const { assertPersonaAdminWorkspaceBrowser } = await import("./persona-admin-workspace-browser-acceptance");
        await assertPersonaAdminWorkspaceBrowser({ origin: call.origin, projectId: browserProject.projectId, makerSid, reviewerSid: checkerSid, makerUserId: 920001, reviewerUserId: 920002, csrfToken: csrf });
        assert.equal((await target!.query("SELECT count(*)::int n FROM ai_persona_executions WHERE project_id=$1 AND state='SUCCEEDED'", [browserProject.projectId])).rows[0].n, 1);
        assert.equal((await target!.query("SELECT count(*)::int n FROM ai_persona_mock_receipts WHERE project_id=$1", [browserProject.projectId])).rows[0].n, 1);
      } finally { await closeServer(); call = await openServer(); }
    });
    await t.test("logout revokes the existing cookie and pooled tenant context is cleared", async () => {
      await target!.query("DELETE FROM sessions WHERE sid=$1", [makerSid]);
      denied(await call("/personas"));
      assert.equal((await pool!.query("SELECT nullif(current_setting('app.tenant_id',true),'') tenant")).rows[0].tenant, null);
      assert.equal((await pool!.query("SELECT count(*)::int n FROM ai_persona_team_workspaces")).rows[0].n, 0);
      assert.equal((await pool!.query("SELECT count(*)::int n FROM ai_persona_projects")).rows[0].n, 0);
    });
    console.info(`KMS-free admin workspace test completed: canonical chain ${journal.entries.length}/${journal.entries.length}, 14 prepared RLS tables; use TAP results for each security and HTTP case`);
  } finally {
    await closeServer();
    await authPool?.end();
    if (oldDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = oldDatabaseUrl;
    await pool?.end();
    await target?.end();
    try {
      if (prefixCreated) await admin.query(`DROP DATABASE "${prefixDatabase}"`);
      if (databaseCreated) await admin.query(`DROP DATABASE "${database}"`);
      if (roleCreated) await admin.query(`DROP ROLE "${role}"`);
      if (authRoleCreated) await admin.query(`DROP ROLE "${authRole}"`);
      if (databaseCreated || roleCreated) {
        const result = (await admin.query("SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname=$1) db,EXISTS(SELECT 1 FROM pg_roles WHERE rolname=$2) role", [database, role])).rows[0];
        assert.deepEqual(result, { db: false, role: false });
        console.info("Disposable admin-session database and role removed; normal local/staging/production databases unchanged");
      }
    } finally {
      await admin.end();
      if (prefixFolder) {
        // Delete only the exact newly created temporary migration fixture.
        assert.equal(dirname(resolve(prefixFolder)), resolve(tmpdir()));
        assert.match(basename(prefixFolder), /^fas-persona-prefix-/);
        rmSync(prefixFolder, { recursive: true });
      }
    }
  }
});
