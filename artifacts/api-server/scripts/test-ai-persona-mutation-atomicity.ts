/** AI persona CRUD/evidence tests with rollback-capable DB doubles. */
import assert from "node:assert/strict";
import { after, beforeEach, mock, test } from "node:test";
import express from "express";
import http from "node:http";
import { once } from "node:events";

process.env.DATABASE_URL = "postgres://fixture:fixture@127.0.0.1:5433/fasos_apply_local";
process.env.NODE_ENV = "test";
process.env.ALLOW_LIVE_INTEGRATIONS = "false";
const schema = await import("@workspace/db");
const { db, pool } = schema;
mock.method(pool, "connect", () => { throw new Error("REAL_DATABASE_FORBIDDEN"); });
mock.method(pool, "query", () => { throw new Error("REAL_DATABASE_FORBIDDEN"); });
mock.method(globalThis, "fetch", () => { throw new Error("PROVIDER_CALL_FORBIDDEN"); });

type Row = Record<string, any>;
let rows: Row[] = [];
let audits: Row[] = [];
let failAudit = false;
let hasRun = false;
let hasAction = false;
let hasMessage = false;
let reviewAction: Row | null = null;
let nextId = 10;

const chain = (read: () => Row[]) => {
  const result: any = { then: (resolve: any, reject: any) => Promise.resolve().then(read).then(resolve, reject) };
  for (const method of ["where", "orderBy", "limit", "for", "groupBy", "innerJoin"]) result[method] = () => result;
  return result;
};
mock.method(db, "select", () => ({ from: (table: unknown) => chain(() => {
  if (table === schema.aiPersonasTable) return rows;
  if (table === schema.aiPersonaRunsTable) return hasRun ? [{ id: 70 }] : [];
  if (table === schema.aiActionQueueTable) return reviewAction ? [reviewAction] : hasAction ? [{ id: 80 }] : [];
  if (table === schema.aiPersonaMessagesTable) return hasMessage ? [{ id: 90 }] : [];
  return [];
}) }));
mock.method(db, "execute", async () => []);
mock.method(db, "insert", (table: unknown) => ({ values: (values: Row) => {
  if (table === schema.auditLogsTable) {
    if (failAudit) return Promise.reject(new Error("SYNTHETIC_AUDIT_FAILURE"));
    audits.push({ ...values }); return Promise.resolve();
  }
  const row = { id: nextId++, createdAt: new Date(), updatedAt: new Date(), ...values };
  rows.push(row); return { returning: async () => [row] };
} }));
mock.method(db, "update", () => ({ set: (values: Row) => ({ where: () => ({ returning: async () => {
  rows = rows.map(row => ({ ...row, ...values, updatedAt: new Date() })); return rows;
} }) }) }));
mock.method(db, "delete", () => ({ where: async () => { rows = []; } }));
mock.method(db, "transaction", async (callback: (tx: typeof db) => Promise<unknown>) => {
  const rowSnapshot = rows.map(row => ({ ...row })); const auditSnapshot = audits.map(row => ({ ...row }));
  try { return await callback(db); } catch (error) { rows = rowSnapshot; audits = auditSnapshot; throw error; }
});

const app = express();
app.use(express.json({ limit: "256kb" }));
app.use((req, _res, next) => { req.user = { id: 7, role: "super_admin", isActive: true } as any; next(); });
const router = (await import("../src/routes/ai-personas")).default;
// Exercise the actual router separately, including its unconditional quarantine.
app.use("/api/quarantined", router);
// Keep regression coverage of the now-unmounted legacy handlers. This fixture
// alone omits the unconditional quarantine; production router has NO bypass.
const handlerRegressionRouter = express.Router();
handlerRegressionRouter.stack = router.stack.filter((layer: any) => layer.name !== "personaLegacyScopeQuarantine");
app.use("/api", handlerRegressionRouter);
app.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(500).json({ error: "fixture_failure" }));
const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
const port = (server.address() as { port: number }).port;
function request(method: string, path: string, body?: unknown): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const json = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request({ hostname: "127.0.0.1", port, path: `/api${path}`, method,
      headers: { "Content-Type": "application/json", ...(json ? { "Content-Length": Buffer.byteLength(json) } : {}) } }, res => {
      let text = ""; res.on("data", chunk => { text += chunk; });
      res.on("end", () => resolve({ status: res.statusCode!, data: text ? JSON.parse(text) : null }));
    }); req.on("error", reject); if (json) req.write(json); req.end();
  });
}

const existing = () => ({ id: 1, name: "Existing", slug: "existing", personaType: "operator", provider: "anthropic", model: "model",
  systemPrompt: "old", guidelines: "", negativePrompt: "", temperature: "0.7", maxTokens: 2048, allowedDataScopes: [],
  toolsEnabled: ["send_email"], triggerMode: "manual", scheduleCron: null, eventSubscriptions: null, outputTargets: [],
  monthlyCostCapUsd: null, isActive: false, createdAt: new Date(), updatedAt: new Date() });
const createBody = { name: "New", slug: "new", personaType: "advisor", provider: "anthropic", model: "model",
  systemPrompt: "confidential prompt", toolsEnabled: [] };
beforeEach(() => { rows = [existing()]; audits = []; failAudit = false; hasRun = false; hasAction = false; hasMessage = false; reviewAction = null; nextId = 10; });
after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await pool.end(); mock.restoreAll(); });

test("actual legacy router denies list/history/mutations before any persona DB access, even for super admin", async () => {
  const reads = (db.select as any).mock.calls.length;
  const executes = (db.execute as any).mock.calls.length;
  for (const [method,path] of [["GET",""],["GET","/1/runs"],["GET","/queue"],["POST",""],["POST","/1/run"],["POST","/queue/1/approve"],["PUT","/1"],["DELETE","/1"]]) {
    const result = await request(method, `/quarantined/ai-personas${path}`, {});
    assert.equal(result.status,409);
    assert.equal(result.data.error,"PERSONA_OWNERSHIP_ADOPTION_REQUIRED");
    assert.equal(result.data.executed,false);
  }
  assert.equal((db.select as any).mock.calls.length, reads);
  assert.equal((db.execute as any).mock.calls.length, executes);
  assert.equal(rows.length,1); assert.equal(audits.length,0);
});

test("Guardian manual, scanner and lifecycle entry points cannot read around quarantine", async () => {
  const { diagnosePortalSubmission, runPortalAiGuardianTick } = await import("../src/lib/portalAiGuardian");
  const { queuePortalLifecycleReview } = await import("../src/lib/portalLifecycleGuardian");
  const reads = (db.select as any).mock.calls.length;
  await assert.rejects(diagnosePortalSubmission(1,{triggeredBy:"manual"}), /GUARDIAN_INACTIVE/);
  await runPortalAiGuardianTick();
  const result = await queuePortalLifecycleReview({submissionId:1,applicationId:1,rawStatus:"synthetic",observationId:1,observationHash:"synthetic",identityVerified:true});
  assert.equal(result.queued,false);
  assert.equal(result.reason,"PERSONA_SCOPE_AND_BUDGET_BINDING_REQUIRED");
  assert.equal((db.select as any).mock.calls.length,reads);
});

test("create rolls back persona when audit fails", async () => {
  failAudit = true; const result = await request("POST", "/ai-personas", createBody);
  assert.equal(result.status, 503); assert.equal(rows.length, 1); assert.deepEqual(audits, []);
});
test("update rolls back persona when audit fails", async () => {
  failAudit = true; const result = await request("PUT", "/ai-personas/1", { description: "after" });
  assert.equal(result.status, 500); assert.equal(rows[0].description, undefined); assert.deepEqual(audits, []);
});
test("type-only update cannot leave advisor with a side-effect tool", async () => {
  const result = await request("PUT", "/ai-personas/1", { personaType: "advisor" });
  assert.equal(result.status, 400); assert.match(result.data.error, /send_email/); assert.equal(rows[0].personaType, "operator");
});
test("persona with run, action or conversation evidence cannot be deleted", async () => {
  hasAction = true; const result = await request("DELETE", "/ai-personas/1");
  assert.equal(result.status, 409); assert.equal(result.data.error, "AI_PERSONA_IN_USE"); assert.equal(rows.length, 1); assert.deepEqual(audits, []);
});
test("delete rolls back when audit fails", async () => {
  failAudit = true; const result = await request("DELETE", "/ai-personas/1");
  assert.equal(result.status, 500); assert.equal(rows.length, 1); assert.deepEqual(audits, []);
});
test("successful create writes bounded metadata without prompt content", async () => {
  const result = await request("POST", "/ai-personas", createBody);
  assert.equal(result.status, 201, JSON.stringify(result.data)); assert.equal(rows.length, 2); assert.equal(audits.length, 1);
  assert.equal(audits[0].action, "create_ai_persona"); assert.equal(JSON.stringify(audits[0]).includes("confidential prompt"), false);
});

test("advisor cannot acquire notification writes through persona configuration", async () => {
  const result = await request("POST", "/ai-personas", { ...createBody, toolsEnabled: ["notification"] });
  assert.equal(result.status, 400);
  assert.equal(rows.length, 1);
});

test("legacy execution rejects forged scope before provider or tool calls", async () => {
  rows[0].isActive = true;
  const { runPersona } = await import("../src/lib/personaService");
  const result = await runPersona({ personaId: 1, triggeredBy: "manual", triggerActor: 7,
    actionContext: { tenantId: "forged", projectId: "forged", approved: true } });
  assert.equal(result.status, "blocked");
  assert.equal(result.error, "PERSONA_SCOPE_AND_BUDGET_BINDING_REQUIRED");
  assert.deepEqual(result.toolResults, []);
  assert.equal(rows.length, 1);
});

test("unsupported persona provider is denied before global context loading", async () => {
  rows[0].isActive = true; rows[0].provider = "openai";
  const { runPersona } = await import("../src/lib/personaService");
  assert.equal((await runPersona({ personaId: 1, triggeredBy: "manual" })).error, "PERSONA_PROVIDER_UNSUPPORTED");
});

test("generic approval route cannot approve an unbound or model-approved payload", async () => {
  reviewAction = { id: 80, status: "pending_approval", actionType: "blog_draft", payload: { approved: true, context: { projectId: "forged" } } };
  const result = await request("POST", "/ai-personas/queue/actions/80/review", { decision: "approved" });
  assert.equal(result.status, 409);
  assert.equal(result.data.error, "PERSONA_VERSIONED_APPROVAL_REQUIRED");
  assert.equal(reviewAction.status, "pending_approval");
  assert.deepEqual(audits, []);
});
