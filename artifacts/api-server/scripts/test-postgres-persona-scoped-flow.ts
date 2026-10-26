import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import http from "node:http";
import { readFileSync } from "node:fs";
import express from "express";
import pg from "pg";
import { createPersonaScopedMock } from "../src/lib/personaScopedMock";
import { createPersonaScopedMockRouter } from "../src/routes/persona-scoped-mock";
import {
  ACTIVE_CONTEXT_V2_ALGORITHM,
  fingerprintActiveContextPublicKey,
  issueVersionedActiveTenantContext,
} from "../src/lib/activeTenantContext";

const uid = (n: number) =>
  `018f6000-0000-7000-8000-${n.toString().padStart(12, "0")}`;
const tenant = uid(1),
  org = uid(2),
  project = uid(100),
  otherProject = uid(101);
const capabilities = [
  ...["read", "propose", "approve", "execute", "reconcile"].map(
    (k) => `ai.persona.${k}`,
  ),
  "ai.persona_context.read",
  "ai.persona_tool.draft",
];

test("scoped persona HTTP workflow with canonical authorization and disposable PostgreSQL", async (t) => {
  if (
    process.env.ALLOW_DISPOSABLE_PERSONA_DB !== "true" ||
    process.env.ALLOW_LIVE_INTEGRATIONS !== "false"
  )
    throw new Error("TEST_OPT_IN_REQUIRED");
  process.env.NODE_ENV = "test";
  const admin = new pg.Pool({
    host: "127.0.0.1",
    port: 5433,
    user: "postgres",
    database: "fasos_apply_local",
    connectionTimeoutMillis: 2000,
  });
  const name = `codex_persona_flow_test_${process.pid}_${Date.now()}`;
  const role = `persona_test_${process.pid}_${Date.now()}`;
  let created = false,
    roleCreated = false,
    owner: pg.Pool | undefined,
    raw: pg.Pool | undefined,
    server: http.Server | undefined;
  try {
    assert.deepEqual(
      (
        await admin.query(
          "SELECT current_database() AS db,host(inet_server_addr()) AS host,inet_server_port() AS port",
        )
      ).rows[0],
      { db: "fasos_apply_local", host: "127.0.0.1", port: 5433 },
    );
    assert.match(name, /^codex_persona_flow_test_\d+_\d+$/);
    assert.match(role, /^persona_test_\d+_\d+$/);
    await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0`);
    created = true;
    await admin.query(`CREATE ROLE "${role}" NOLOGIN NOSUPERUSER NOBYPASSRLS`);
    roleCreated = true;
    owner = new pg.Pool({
      host: "127.0.0.1",
      port: 5433,
      user: "postgres",
      database: name,
    });
    await owner.query(`CREATE TABLE tenants(id uuid PRIMARY KEY,status text,policy_version bigint);
      CREATE TABLE organizations(id uuid PRIMARY KEY,tenant_id uuid REFERENCES tenants(id),UNIQUE(tenant_id,id));
      CREATE TABLE principals(id uuid PRIMARY KEY,principal_type text,status text,risk_state text);
      CREATE TABLE memberships(id uuid PRIMARY KEY,tenant_id uuid,organization_id uuid,legacy_branch_id integer,principal_id uuid,status text,valid_from timestamptz,valid_until timestamptz);
      CREATE TABLE policy_versions(id uuid PRIMARY KEY,tenant_id uuid,version_number bigint,state text,effective_at timestamptz,revoked_at timestamptz);
      CREATE TABLE role_definitions(id uuid PRIMARY KEY,principal_type text);
      CREATE TABLE role_package_versions(id uuid PRIMARY KEY,role_definition_id uuid,status text,effective_at timestamptz,deprecated_at timestamptz);
      CREATE TABLE capability_definitions(key text PRIMARY KEY,status text,step_up_required boolean,approval_required boolean);
      CREATE TABLE role_package_capabilities(role_package_version_id uuid,capability_key text,effect text);
      CREATE TABLE access_assignments(id uuid PRIMARY KEY,tenant_id uuid,membership_id uuid,status text,valid_from timestamptz,valid_until timestamptz,scope_type text,
        organization_id uuid,legacy_branch_id integer,constraint_document jsonb,role_package_version_id uuid,UNIQUE(tenant_id,id));
      CREATE TABLE active_session_context_selections(id uuid PRIMARY KEY,tenant_id uuid,principal_id uuid,membership_id uuid,session_generation bigint,session_fingerprint text,status text,impersonator_principal_id uuid);
      CREATE TABLE ai_personas(id serial PRIMARY KEY,name text,provider text,model text,system_prompt text DEFAULT '',guidelines text DEFAULT '',negative_prompt text DEFAULT '',tools_enabled jsonb DEFAULT '[]',allowed_data_scopes jsonb DEFAULT '[]',max_tokens integer DEFAULT 100,temperature numeric DEFAULT 0,is_active boolean DEFAULT true);
      CREATE TABLE ai_action_queue(id serial PRIMARY KEY,persona_id integer REFERENCES ai_personas(id),action_type text,payload jsonb,preview text,status text,reviewed_at timestamptz,executed_at timestamptz);
      CREATE TABLE ai_persona_runs(id serial PRIMARY KEY,persona_id integer REFERENCES ai_personas(id),triggered_by text,status text,cost_usd numeric(10,6),error_message text,output_payload jsonb,created_at timestamptz DEFAULT now());
      CREATE SCHEMA fas_cp_v1;`);
    // Run the ORIGINAL canonical resolver, not a mock authorization function.
    const source = readFileSync(
      new URL(
        "../../../lib/db/drizzle/0071_change_set_postgres_command_adapter.sql",
        import.meta.url,
      ),
      "utf8",
    );
    for (const fn of ["assert_tenant", "resolve_active_context"]) {
      const sql = source.match(
        new RegExp(`CREATE FUNCTION fas_cp_v1\\.${fn}\\([\\s\\S]*?\\$\\$;`),
      )?.[0];
      assert.ok(sql);
      await owner.query(sql);
    }
    await owner.query(
      readFileSync(
        new URL(
          "../../../lib/db/migrations-pending/persona_phase1_scoped_mock.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await owner.query(
      "INSERT INTO tenants VALUES ($1,'ACTIVE',1),($2,'ACTIVE',1)",
      [tenant, uid(51)],
    );
    await owner.query("INSERT INTO organizations VALUES ($1,$2),($3,$4)", [
      org,
      tenant,
      uid(52),
      uid(51),
    ]);
    await owner.query(
      "INSERT INTO policy_versions VALUES ($1,$2,1,'ACTIVE',now()-interval '1 day',NULL)",
      [uid(60), tenant],
    );
    for (const cap of capabilities)
      await owner.query(
        "INSERT INTO capability_definitions VALUES ($1,'ACTIVE',false,false)",
        [cap],
      );
    const now = Date.now(),
      pair = crypto.generateKeyPairSync("ed25519");
    const pem = pair.publicKey
      .export({ type: "spki", format: "pem" })
      .toString();
    const key = {
      keyId: "persona-test",
      algorithm: ACTIVE_CONTEXT_V2_ALGORITHM,
      state: "ACTIVE" as const,
      issuerId: uid(90),
      environmentId: "test",
      cellId: "local",
      publicKeyPem: pem,
      publicKeyFingerprint: fingerprintActiveContextPublicKey(pem),
      signFrom: now - 60000,
      signUntil: now + 600000,
      verifyUntil: now + 900000,
    };
    const config = {
      audience: "fas.persona.mock",
      environmentId: "test",
      cellId: "local",
      issuerId: uid(90),
      keyRing: [key],
    };
    const identities: Record<string, any> = {};
    for (const [i, label] of [
      "maker",
      "reviewer",
      "outsider",
      "ai",
    ].entries()) {
      await owner.query(
        "INSERT INTO principals VALUES ($1,$2,'ACTIVE','NORMAL')",
        [uid(10 + i), label === "ai" ? "AI" : "HUMAN"],
      );
      await owner.query(
        "INSERT INTO memberships VALUES ($1,$2,$3,NULL,$4,'ACTIVE',now()-interval '1 day',NULL)",
        [uid(20 + i), tenant, org, uid(10 + i)],
      );
      await owner.query("INSERT INTO role_definitions VALUES ($1,$2)", [
        uid(80 + i),
        label === "ai" ? "AI" : "HUMAN",
      ]);
      await owner.query(
        "INSERT INTO role_package_versions VALUES ($1,$2,'ACTIVE',now()-interval '1 day',NULL)",
        [uid(70 + i), uid(80 + i)],
      );
      for (const cap of capabilities)
        await owner.query(
          "INSERT INTO role_package_capabilities VALUES ($1,$2,'ALLOW')",
          [uid(70 + i), cap],
        );
      await owner.query(
        "INSERT INTO access_assignments VALUES ($1,$2,$3,'ACTIVE',now()-interval '1 day',NULL,'ORGANIZATION',$4,NULL,'{}',$5)",
        [uid(40 + i), tenant, uid(20 + i), org, uid(70 + i)],
      );
      await owner.query(
        "INSERT INTO active_session_context_selections VALUES ($1,$2,$3,$4,1,$5,'ACTIVE',NULL)",
        [uid(30 + i), tenant, uid(10 + i), uid(20 + i), `session-${label}`],
      );
      const token = await issueVersionedActiveTenantContext({
        subject: {
          contextId: uid(200 + i),
          tenantId: tenant,
          organizationId: org,
          legacyBranchId: null,
          principalId: uid(10 + i),
          membershipId: uid(20 + i),
          assignmentIds: [uid(40 + i)],
          policyVersionId: uid(60),
          policyVersion: 1,
          selectionId: uid(30 + i),
          sessionGeneration: 1,
        },
        ...config,
        keyId: key.keyId,
        keyReference: "test-memory://persona",
        signer: {
          async sign(input) {
            return crypto.sign(null, input.signingInput, pair.privateKey);
          },
        },
        ttlMs: 60000,
        now,
      });
      identities[label] = {
        token,
        tenantId: tenant,
        principalId: uid(10 + i),
        sessionFingerprint: `session-${label}`,
      };
    }
    for (const id of [project, otherProject])
      await owner.query(
        `INSERT INTO ai_persona_projects(id,tenant_id,organization_id,label,cap_micros,mock_bound_micros,period_start,period_end,costs_verified,active)
      VALUES ($1,$2,$3,'Synthetic project',1000000,50,now()-interval '1 day',now()+interval '1 day',true,true)`,
        [id, tenant, org],
      );
    await owner.query(
      `INSERT INTO ai_persona_projects(id,tenant_id,organization_id,label,period_start,period_end) VALUES($1,$2,$3,'Other tenant',now(),now()+interval '1 day')`,
      [uid(102), uid(51), uid(52)],
    );
    for (const i of [0, 1, 3])
      await owner.query(
        "INSERT INTO ai_persona_project_assignments VALUES ($1,$2,$3,$4)",
        [tenant, org, project, uid(40 + i)],
      );
    await owner.query(
      "INSERT INTO ai_persona_project_assignments VALUES ($1,$2,$3,$4)",
      [tenant, org, otherProject, uid(42)],
    );
    for (const n of [1, 2, 3, 4, 5]) {
      await owner.query(
        `INSERT INTO ai_personas(id,name,provider,model,tools_enabled,allowed_data_scopes) VALUES ($1,$2,'anthropic','mock-fixture','["mock_draft"]','["persona_mock_context"]')`,
        [n, `Synthetic persona ${n}`],
      );
      if (n !== 4)
        await owner.query(
          `INSERT INTO ai_persona_ownership(persona_id,tenant_id,organization_id,project_id,cap_micros,active,evidence_ref,maker,checker)
        VALUES ($1,$2,$3,$4,$5,true,'synthetic-reviewed-ownership',$6,$7)`,
          [
            n,
            tenant,
            org,
            n === 3 ? otherProject : project,
            n === 2 ? 75 : 1000000,
            uid(10),
            uid(11),
          ],
        );
    }
    // Temporary test role only, removed after dropping the test DB. No grants in migration.
    await owner.query(`GRANT USAGE ON SCHEMA public,fas_cp_v1 TO "${role}";
      GRANT SELECT ON ALL TABLES IN SCHEMA public TO "${role}";
      GRANT UPDATE(id) ON active_session_context_selections,ai_persona_projects,ai_personas TO "${role}";
      GRANT UPDATE(persona_id) ON ai_persona_ownership TO "${role}";
      GRANT UPDATE(assignment_id) ON ai_persona_project_assignments TO "${role}";
      GRANT INSERT,UPDATE ON ai_action_queue,ai_persona_runs,ai_persona_approval_bindings,ai_persona_executions TO "${role}";
      GRANT INSERT ON ai_persona_mock_receipts TO "${role}";
      GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO "${role}";
      GRANT EXECUTE ON FUNCTION fas_cp_v1.resolve_active_context(uuid,uuid,uuid,uuid,uuid[]) TO "${role}";`);
    raw = new pg.Pool({
      host: "127.0.0.1",
      port: 5433,
      user: "postgres",
      database: name,
      max: 10,
    });
    const safePool = {
      async connect() {
        const c = await raw!.connect();
        await c.query(`SET ROLE "${role}"`);
        return c;
      },
    };
    let crash: string | null = null;
    let revoke = false;
    let revokeTool = false;
    await t.test(
      "mock application is not mounted in live routes and cannot be constructed for live mode",
      async () => {
        const routeIndex = readFileSync(
          new URL("../src/routes/index.ts", import.meta.url),
          "utf8",
        );
        assert.doesNotMatch(
          routeIndex,
          /persona-scoped-mock|createPersonaScopedMockRouter/,
        );
        process.env.NODE_ENV = "production";
        try {
          assert.throws(
            () => createPersonaScopedMock(safePool, config),
            /PERSONA_MOCK_ONLY/,
          );
        } finally {
          process.env.NODE_ENV = "test";
        }
        process.env.ALLOW_LIVE_INTEGRATIONS = "true";
        try {
          assert.throws(
            () => createPersonaScopedMock(safePool, config),
            /PERSONA_MOCK_ONLY/,
          );
        } finally {
          process.env.ALLOW_LIVE_INTEGRATIONS = "false";
        }
      },
    );
    const service = createPersonaScopedMock(safePool, config, async (point) => {
      if (revokeTool && point === "after_dispatch")
        await owner!.query(
          "UPDATE role_package_capabilities SET effect='DENY' WHERE role_package_version_id=$1 AND capability_key='ai.persona_tool.draft'",
          [uid(70)],
        );
      if (revoke && point === "after_reservation")
        await owner!.query(
          "UPDATE access_assignments SET status='REVOKED' WHERE id=$1",
          [uid(40)],
        );
      if (crash === point) throw new Error("simulated-process-exit");
    });
    const app = express();
    app.use(
      "/mock",
      createPersonaScopedMockRouter(
        service,
        async (req) =>
          identities[String(req.headers["x-test-session"])] ?? null,
      ),
    );
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((r) => server!.once("listening", r));
    const port = (server.address() as { port: number }).port;
    const request = (
      actor: string,
      method: string,
      path: string,
      body?: unknown,
    ): Promise<{ status: number; data: any }> =>
      new Promise((resolve, reject) => {
        const json = JSON.stringify(body ?? {});
        const r = http.request(
          {
            host: "127.0.0.1",
            port,
            method,
            path: `/mock/${path}`,
            headers: {
              "x-test-session": actor,
              "content-type": "application/json",
              "content-length": Buffer.byteLength(json),
            },
          },
          (res) => {
            let text = "";
            res.on("data", (s) => (text += s));
            res.on("end", () =>
              resolve({ status: res.statusCode!, data: JSON.parse(text) }),
            );
          },
        );
        r.on("error", reject);
        r.end(json);
      });
    const proposal = async (
      personaId = 1,
      content = "Verified catalogue brief",
    ) => {
      const p = await request("maker", "POST", `${project}/proposals`, {
        personaId,
        content,
        target: "draft-library",
      });
      assert.equal(p.status, 200, JSON.stringify(p.data));
      return p.data;
    };
    const approved = async (personaId = 1) => {
      const p = await proposal(personaId);
      const review = await request(
        "reviewer",
        "GET",
        `${project}/approvals/${p.actionId}`,
      );
      assert.equal(review.status, 200);
      assert.equal(review.data.digest, p.digest);
      assert.equal(review.data.intent.content, "Verified catalogue brief");
      const a = await request(
        "reviewer",
        "POST",
        `${project}/approvals/${p.actionId}`,
        { digest: p.digest },
      );
      assert.equal(a.status, 200, JSON.stringify(a.data));
      return p;
    };
    await t.test(
      "successful authorized HTTP mock execution persists output, approval consumption and cost",
      async () => {
        const p = await approved();
        const result = await request(
          "maker",
          "POST",
          `${project}/executions/${p.actionId}`,
        );
        assert.equal(result.status, 200, JSON.stringify(result.data));
        assert.equal(result.data.state, "SUCCEEDED");
        assert.match(result.data.output, /MOCK DRAFT/);
        assert.equal(result.data.actualMicros, 20);
        t.diagnostic(
          `synthetic example: ${result.data.executionId} | ${result.data.state} | ${result.data.output} | cost=20 mock micros`,
        );
        const history = await request("maker", "GET", `${project}/history`);
        assert.equal(history.data.length, 1);
        assert.equal(history.data[0].id, result.data.executionId);
      },
    );
    await t.test(
      "list/history/read deny other project, other tenant and unowned legacy persona",
      async () => {
        const list = await request("maker", "GET", `${project}/personas`);
        assert.deepEqual(
          list.data.map((p: any) => p.id),
          [1, 2, 5],
        );
        for (const path of [
          `${otherProject}/personas`,
          `${otherProject}/history`,
          `${uid(102)}/history`,
        ])
          assert.equal((await request("maker", "GET", path)).status, 409);
        for (const id of [3, 4])
          assert.equal(
            (
              await request("maker", "POST", `${project}/proposals`, {
                personaId: id,
                content: "x",
                target: "x",
              })
            ).status,
            409,
          );
        assert.equal(
          (await request("nobody", "GET", `${project}/personas`)).status,
          401,
        );
      },
    );
    await t.test(
      "human maker and AI cannot self approve; request cannot grant capabilities",
      async () => {
        const p = await proposal();
        for (const actor of ["maker", "ai"])
          assert.equal(
            (
              await request(
                actor,
                "POST",
                `${project}/approvals/${p.actionId}`,
                { digest: p.digest },
              )
            ).status,
            409,
          );
        assert.equal(
          (
            await request("maker", "POST", `${project}/proposals`, {
              personaId: 1,
              content: "x",
              target: "x",
              capabilities: ["admin"],
            })
          ).status,
          400,
        );
      },
    );
    await t.test(
      "signature, session generation and persona tool scope are enforced",
      async () => {
        identities.tampered = {
          ...identities.maker,
          token: identities.maker.token + "invalid",
        };
        assert.equal(
          (await request("tampered", "GET", `${project}/personas`)).status,
          409,
        );
        await owner!.query(
          "UPDATE active_session_context_selections SET session_generation=2 WHERE id=$1",
          [uid(30)],
        );
        assert.equal(
          (await request("maker", "GET", `${project}/history`)).data.error,
          "PERSONA_SELECTION_REVOKED",
        );
        await owner!.query(
          "UPDATE active_session_context_selections SET session_generation=1 WHERE id=$1",
          [uid(30)],
        );
        await owner!.query(
          "UPDATE ai_personas SET tools_enabled='[]' WHERE id=1",
        );
        assert.equal(
          (
            await request("maker", "POST", `${project}/proposals`, {
              personaId: 1,
              content: "x",
              target: "x",
            })
          ).data.error,
          "PERSONA_PERSONA_TOOL_SCOPE_DENIED",
        );
        await owner!.query(
          `UPDATE ai_personas SET tools_enabled='["mock_draft"]' WHERE id=1`,
        );
      },
    );
    await t.test(
      "concurrent human review records a single immutable reviewer and timestamp",
      async () => {
        const p = await proposal();
        const reviews = await Promise.all(
          [1, 2].map(() =>
            request("reviewer", "POST", `${project}/approvals/${p.actionId}`, {
              digest: p.digest,
            }),
          ),
        );
        assert.deepEqual(reviews.map((r) => r.status).sort(), [200, 409]);
        const r = await request(
          "reviewer",
          "GET",
          `${project}/approvals/${p.actionId}`,
        );
        assert.equal(r.data.reviewer, uid(11));
        assert.ok(r.data.reviewedAt);
        assert.equal(
          (
            await request(
              "outsider",
              "GET",
              `${otherProject}/approvals/${p.actionId}`,
            )
          ).status,
          409,
        );
      },
    );
    await t.test(
      "changed content/target or persona configuration invalidates approval",
      async () => {
        const p = await approved();
        await owner!.query(
          "UPDATE ai_action_queue SET payload=jsonb_set(payload,'{intent,target}','\"changed\"') WHERE id=$1",
          [p.actionId],
        );
        assert.equal(
          (
            await request(
              "maker",
              "POST",
              `${project}/executions/${p.actionId}`,
            )
          ).data.error,
          "PERSONA_APPROVAL_STALE",
        );
        const q = await approved();
        await owner!.query("UPDATE ai_personas SET model='changed' WHERE id=1");
        assert.equal(
          (
            await request(
              "maker",
              "POST",
              `${project}/executions/${q.actionId}`,
            )
          ).data.error,
          "PERSONA_APPROVAL_STALE",
        );
        await owner!.query(
          "UPDATE ai_personas SET model='mock-fixture' WHERE id=1",
        );
        for (const field of ["content", "version"]) {
          const q = await approved();
          await owner!.query(
            "UPDATE ai_action_queue SET payload=jsonb_set(payload,$2::text[],$3::jsonb) WHERE id=$1",
            [
              q.actionId,
              ["intent", field],
              field === "version" ? "2" : '"altered"',
            ],
          );
          assert.equal(
            (
              await request(
                "maker",
                "POST",
                `${project}/executions/${q.actionId}`,
              )
            ).data.error,
            "PERSONA_APPROVAL_STALE",
          );
        }
      },
    );
    await t.test(
      "concurrent reuse consumes one approval once and invokes mock once",
      async () => {
        const p = await approved();
        const results = await Promise.all(
          Array.from({ length: 4 }, () =>
            request("maker", "POST", `${project}/executions/${p.actionId}`),
          ),
        );
        for (const r of results)
          assert.equal(r.status, 200, JSON.stringify(r.data));
        assert.equal(new Set(results.map((r) => r.data.executionId)).size, 1);
        assert.equal(
          (
            await owner!.query(
              "SELECT count(*)::int AS n FROM ai_persona_mock_receipts WHERE execution_id=$1",
              [results[0].data.executionId],
            )
          ).rows[0].n,
          1,
        );
      },
    );
    await t.test(
      "crash after provider commit reconciles from durable evidence without rerunning",
      async () => {
        const p = await approved();
        crash = "after_provider";
        assert.equal(
          (
            await request(
              "maker",
              "POST",
              `${project}/executions/${p.actionId}`,
            )
          ).status,
          409,
        );
        crash = null;
        const e = (
          await owner!.query(
            "SELECT id FROM ai_persona_executions WHERE approval_id=$1",
            [p.actionId],
          )
        ).rows[0].id;
        const restarted = createPersonaScopedMock(safePool, config);
        await owner!.query(
          "UPDATE ai_personas SET model='new-config-after-crash' WHERE id=1",
        );
        const result = await restarted.reconcile(
          identities.reviewer,
          project,
          e,
        );
        assert.equal(result.state, "SUCCEEDED");
        await owner!.query(
          "UPDATE ai_personas SET model='mock-fixture' WHERE id=1",
        );
        assert.equal(
          (
            await owner!.query(
              "SELECT count(*)::int AS n FROM ai_persona_mock_receipts WHERE execution_id=$1",
              [e],
            )
          ).rows[0].n,
          1,
        );
      },
    );
    await t.test(
      "crash before receipt keeps reservation and never retries or refunds",
      async () => {
        const p = await approved();
        crash = "after_dispatch";
        await request("maker", "POST", `${project}/executions/${p.actionId}`);
        crash = null;
        const e = (
          await owner!.query(
            "SELECT id FROM ai_persona_executions WHERE approval_id=$1",
            [p.actionId],
          )
        ).rows[0].id;
        const result = await request(
          "reviewer",
          "POST",
          `${project}/reconcile/${e}`,
        );
        assert.equal(result.data.state, "UNCERTAIN");
        assert.equal(result.data.reservationHeld, true);
        assert.equal(
          (
            await request(
              "maker",
              "POST",
              `${project}/executions/${p.actionId}`,
            )
          ).data.replay,
          true,
        );
        assert.equal(
          (
            await owner!.query(
              "SELECT actual_micros FROM ai_persona_executions WHERE id=$1",
              [e],
            )
          ).rows[0].actual_micros,
          null,
        );
      },
    );
    await t.test(
      "authority revoked between admission and tool call blocks the tool",
      async () => {
        const p = await approved();
        revoke = true;
        assert.equal(
          (
            await request(
              "maker",
              "POST",
              `${project}/executions/${p.actionId}`,
            )
          ).status,
          409,
        );
        revoke = false;
        await owner!.query(
          "UPDATE access_assignments SET status='ACTIVE' WHERE id=$1",
          [uid(40)],
        );
        assert.equal(
          (
            await owner!.query(
              "SELECT count(*)::int AS n FROM ai_persona_mock_receipts r JOIN ai_persona_executions e ON e.id=r.execution_id WHERE e.approval_id=$1",
              [p.actionId],
            )
          ).rows[0].n,
          0,
        );
      },
    );
    await t.test(
      "tool capability revoked after dispatch blocks provider invocation",
      async () => {
        const p = await approved();
        revokeTool = true;
        assert.equal(
          (
            await request(
              "maker",
              "POST",
              `${project}/executions/${p.actionId}`,
            )
          ).status,
          409,
        );
        revokeTool = false;
        await owner!.query(
          "UPDATE role_package_capabilities SET effect='ALLOW' WHERE role_package_version_id=$1 AND capability_key='ai.persona_tool.draft'",
          [uid(70)],
        );
        assert.equal(
          (
            await owner!.query(
              "SELECT count(*)::int AS n FROM ai_persona_mock_receipts r JOIN ai_persona_executions e ON e.id=r.execution_id WHERE e.approval_id=$1",
              [p.actionId],
            )
          ).rows[0].n,
          0,
        );
      },
    );
    await t.test(
      "failure inside admission transaction rolls back run, reservation and consumption together",
      async () => {
        const p = await approved();
        const before = (
          await owner!.query("SELECT count(*)::int AS n FROM ai_persona_runs")
        ).rows[0].n;
        await owner!.query(
          `CREATE FUNCTION synthetic_crash() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic_crash'; END $$; CREATE TRIGGER synthetic_crash BEFORE INSERT ON ai_persona_executions FOR EACH ROW EXECUTE FUNCTION synthetic_crash()`,
        );
        try {
          assert.equal(
            (
              await request(
                "maker",
                "POST",
                `${project}/executions/${p.actionId}`,
              )
            ).status,
            409,
          );
        } finally {
          await owner!.query(
            "DROP TRIGGER synthetic_crash ON ai_persona_executions; DROP FUNCTION synthetic_crash()",
          );
        }
        assert.equal(
          (await owner!.query("SELECT count(*)::int AS n FROM ai_persona_runs"))
            .rows[0].n,
          before,
        );
        assert.equal(
          (
            await owner!.query(
              "SELECT consumed_by FROM ai_persona_approval_bindings WHERE action_id=$1",
              [p.actionId],
            )
          ).rows[0].consumed_by,
          null,
        );
      },
    );
    await t.test(
      "real lock timeout preserves previously held reservations and consumes no new approval",
      async () => {
        const p = await approved();
        const before = (
          await owner!.query(
            "SELECT count(*)::int AS n FROM ai_persona_executions",
          )
        ).rows[0].n;
        const locker = await owner!.connect();
        try {
          await locker.query("BEGIN");
          await locker.query(
            "SELECT id FROM ai_persona_projects WHERE id=$1 FOR UPDATE",
            [project],
          );
          const result = await request(
            "maker",
            "POST",
            `${project}/executions/${p.actionId}`,
          );
          assert.equal(
            result.data.error,
            "PERSONA_TRANSACTION_UNKNOWN_RECONCILE",
          );
        } finally {
          await locker.query("ROLLBACK");
          locker.release();
        }
        assert.equal(
          (
            await owner!.query(
              "SELECT count(*)::int AS n FROM ai_persona_executions",
            )
          ).rows[0].n,
          before,
        );
        assert.equal(
          (
            await owner!.query(
              "SELECT consumed_by FROM ai_persona_approval_bindings WHERE action_id=$1",
              [p.actionId],
            )
          ).rows[0].consumed_by,
          null,
        );
      },
    );
    await t.test(
      "approval cannot be consumed by another approval's execution even inside the same project",
      async () => {
        const p = await approved();
        const e = (
          await owner!.query(
            "SELECT id FROM ai_persona_executions ORDER BY created_at LIMIT 1",
          )
        ).rows[0].id;
        await assert.rejects(
          owner!.query(
            "UPDATE ai_persona_approval_bindings SET consumed_by=$2 WHERE action_id=$1",
            [p.actionId, e],
          ),
          /persona_consumed_execution_fk|unique constraint/,
        );
      },
    );
    await t.test(
      "unknown bound and unverified project costs cannot be treated as zero",
      async () => {
        await owner!.query(
          "UPDATE ai_persona_projects SET mock_bound_micros=NULL WHERE id=$1",
          [project],
        );
        assert.equal(
          (
            await request("maker", "POST", `${project}/proposals`, {
              personaId: 1,
              content: "x",
              target: "x",
            })
          ).data.error,
          "PERSONA_COST_UNKNOWN",
        );
        await owner!.query(
          "UPDATE ai_persona_projects SET mock_bound_micros=50 WHERE id=$1",
          [project],
        );
        const p = await approved();
        await owner!.query(
          "UPDATE ai_persona_projects SET costs_verified=false WHERE id=$1",
          [project],
        );
        assert.equal(
          (
            await request(
              "maker",
              "POST",
              `${project}/executions/${p.actionId}`,
            )
          ).data.error,
          "PERSONA_BUDGET_UNVERIFIED",
        );
        await owner!.query(
          "UPDATE ai_persona_projects SET costs_verified=true WHERE id=$1",
          [project],
        );
      },
    );
    await t.test(
      "project and persona budgets independently serialize races",
      async () => {
        const spent = Number(
          (
            await owner!.query(
              "SELECT sum(coalesce(actual_micros,reserved_micros))::text AS n FROM ai_persona_executions WHERE project_id=$1",
              [project],
            )
          ).rows[0].n,
        );
        await owner!.query(
          "UPDATE ai_persona_projects SET cap_micros=$2 WHERE id=$1",
          [project, spent + 60],
        );
        const a = await approved(1),
          b = await approved(5);
        crash = "after_reservation";
        const before = Number(
          (
            await owner!.query(
              "SELECT count(*) AS n FROM ai_persona_executions",
            )
          ).rows[0].n,
        );
        await Promise.all(
          [a, b].map((p) =>
            request("maker", "POST", `${project}/executions/${p.actionId}`),
          ),
        );
        assert.equal(
          Number(
            (
              await owner!.query(
                "SELECT count(*) AS n FROM ai_persona_executions",
              )
            ).rows[0].n,
          ),
          before + 1,
        );
        await owner!.query(
          "UPDATE ai_persona_projects SET cap_micros=1000000 WHERE id=$1",
          [project],
        );
        const c = await approved(2),
          d = await approved(2);
        await Promise.all(
          [c, d].map((p) =>
            request("maker", "POST", `${project}/executions/${p.actionId}`),
          ),
        );
        crash = null;
        assert.equal(
          (
            await owner!.query(
              "SELECT count(*)::int AS n FROM ai_persona_executions WHERE persona_id=2",
            )
          ).rows[0].n,
          1,
        );
      },
    );
    await t.test(
      "FORCE RLS and immutable approval receipt reject direct cross-project/tamper attempts",
      async () => {
        const c = await safePool.connect();
        try {
          await c.query("BEGIN");
          await c.query(
            "SELECT set_config('app.tenant_id',$1,true),set_config('app.organization_id',$2,true),set_config('app.persona_project_id',$3,true)",
            [tenant, org, otherProject],
          );
          assert.equal(
            (await c.query("SELECT * FROM ai_persona_executions")).rowCount,
            0,
          );
          await c.query("ROLLBACK");
          await c.query("BEGIN");
          await c.query(
            "SELECT set_config('app.tenant_id',$1,true),set_config('app.organization_id',$2,true),set_config('app.persona_project_id',$3,true)",
            [tenant, org, project],
          );
          await assert.rejects(
            c.query(
              "UPDATE ai_persona_approval_bindings SET intent='{}'::jsonb",
            ),
          );
          await c.query("ROLLBACK");
        } finally {
          c.release();
        }
      },
    );
    await t.test(
      "unknown historical cost blocks new work even when project flag was verified",
      async () => {
        const p = await approved();
        await owner!.query(
          "INSERT INTO ai_persona_runs(persona_id,status,cost_usd) VALUES(1,'error',NULL)",
        );
        assert.equal(
          (
            await request(
              "maker",
              "POST",
              `${project}/executions/${p.actionId}`,
            )
          ).data.error,
          "PERSONA_COST_RECONCILIATION_REQUIRED",
        );
      },
    );
  } finally {
    if (server) await new Promise<void>((r) => server!.close(() => r()));
    await raw?.end();
    await owner?.end();
    if (created) await admin.query(`DROP DATABASE "${name}"`);
    if (roleCreated) await admin.query(`DROP ROLE "${role}"`);
    await admin.end();
  }
});
