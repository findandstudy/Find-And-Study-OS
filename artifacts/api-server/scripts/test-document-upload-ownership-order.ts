/** Real route handlers and ownership query, synthetic DB/storage doubles only.
 * No listener, real database, stored user files or provider calls are allowed. */
import assert from "node:assert/strict";
import { after, beforeEach, mock, test } from "node:test";
import { syncBuiltinESMExports } from "node:module";
import net from "node:net";
import { setImmediate as nextImmediate } from "node:timers/promises";
import { PgDialect } from "drizzle-orm/pg-core";
import { PDFDocument } from "pdf-lib";
import type { NextFunction, Request, Response } from "express";

const previous = {
  NODE_ENV: process.env.NODE_ENV,
  ALLOW_LIVE_INTEGRATIONS: process.env.ALLOW_LIVE_INTEGRATIONS,
  DATABASE_URL: process.env.DATABASE_URL,
};
process.env.NODE_ENV = "test";
process.env.ALLOW_LIVE_INTEGRATIONS = "false";
process.env.DATABASE_URL = "postgres://fixture:fixture@127.0.0.1:1/fasos_apply_local";
mock.method(net.Socket.prototype, "connect", () => { throw new Error("REAL_NETWORK_FORBIDDEN"); });
syncBuiltinESMExports();
mock.method(globalThis, "fetch", async () => { throw new Error("REAL_FETCH_FORBIDDEN"); });
// Expected denials contain only synthetic fixture IDs; keep test output compact.
mock.method(console, "warn", () => {});

const { db, pool, studentsTable, leadsTable, agentsTable, objectOwnersTable, documentsTable, auditLogsTable } = await import("@workspace/db");
mock.method(pool, "connect", () => { throw new Error("REAL_DATABASE_FORBIDDEN"); });
mock.method(pool, "query", () => { throw new Error("REAL_DATABASE_FORBIDDEN"); });

const dialect = new PgDialect();
const userId = 7001;
const student = { id: 8001, userId, firstName: "SYNTHETIC", lastName: "FIXTURE", agentId: 9001 };
const agent = { id: 9001, userId, parentAgentId: 9000, planTier: "full", featureOverrides: { lead_document_upload: true } };
const lead = { id: 6001, agentId: agent.id, assignedToId: userId, convertedStudentId: null, firstName: "SYNTHETIC", lastName: "FIXTURE" };
const key = "/objects/student-documents/synthetic-known-key";
const canonicalKey = key.slice("/objects/".length);
const pdf = await PDFDocument.create();
pdf.addPage([100, 100]);
const validBody = Buffer.from(await pdf.save());
let owner: number | null | undefined = userId + 1;
let storedBody = Buffer.from("not-a-valid-pdf");
let events: string[] = [];
let inserted: Record<string, unknown> | undefined;
let finalizedGrant = true;

function queryRows(table: unknown, where: unknown): unknown[] {
  if (table === objectOwnersTable) {
    events.push("ownership");
    assert.ok(dialect.sqlToQuery(where as Parameters<PgDialect["sqlToQuery"]>[0]).params.includes(canonicalKey));
    return owner === undefined ? [] : [{ uploadedBy: owner }];
  }
  if (table === studentsTable) return [student];
  if (table === leadsTable) return [lead];
  if (table === agentsTable) return [agent];
  if (table === documentsTable) return [];
  throw new Error("UNEXPECTED_DATABASE_READ");
}
mock.method(db, "select", () => ({
  from: (table: unknown) => ({
    where: (where: unknown) => {
      const result = Promise.resolve(queryRows(table, where));
      return Object.assign(result, { limit: () => result });
    },
  }),
}));
mock.method(db, "insert", (table: unknown) => ({
  values: (value: Record<string, unknown>) => {
    if (table === auditLogsTable) {
      events.push("audit");
      return Promise.resolve([]);
    }
    assert.equal(table, documentsTable);
    events.push("insert-reference");
    inserted = value;
    const result = Promise.resolve([{ id: 5001, ...value }]);
    return Object.assign(result, { returning: () => result });
  },
}));
mock.method(db, "update", (table: unknown) => {
  assert.equal(table, documentsTable);
  events.push("retire-reference");
  return { set: () => ({ where: async () => [] }) };
});
mock.method(db, "transaction", async (fn: (tx: typeof db) => unknown) => {
  events.push("transaction");
  return fn(db);
});
mock.method(db, "delete", () => { throw new Error("UNEXPECTED_DATABASE_MUTATION"); });
mock.method(db, "execute", () => {
  events.push("consume-grant");
  return Promise.resolve({ rowCount: finalizedGrant ? 1 : 0, rows: [] });
});

const { ObjectStorageService } = await import("../src/lib/objectStorage");
mock.method(ObjectStorageService.prototype, "getObjectEntityFile", async (path: string) => {
  assert.equal(path, key);
  events.push("resolve-object");
  return {
    async download() { events.push("read-bytes"); return [storedBody]; },
    async getMetadata() {
      events.push("recompress-metadata");
      return [{ contentType: "application/pdf", size: String(storedBody.length) }];
    },
    async delete() { events.push("delete-bytes"); },
  };
});
mock.method(ObjectStorageService.prototype, "overwriteObjectBuffer", async () => { events.push("overwrite-bytes"); });
const { default: documentRouter } = await import("../src/routes/documents");
const { default: leadRouter } = await import("../src/routes/leads");

type Handler = (req: Request, res: Response, next: NextFunction) => unknown;
type RouterStack = { stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: Handler }> } }> };
async function invoke(target: "document" | "lead", role: string, userPresent = true) {
  const router = (target === "document" ? documentRouter : leadRouter) as unknown as RouterStack;
  const path = target === "document" ? "/documents" : "/leads/:id/documents";
  const route = router.stack.find(layer => layer.route?.path === path && layer.route.methods.post)?.route;
  assert.ok(route);
  let body: any, status = 200;
  const req = {
    user: userPresent ? { id: userId, role, isActive: true } : undefined,
    params: { id: String(lead.id) },
    ip: "127.0.0.1",
    // No application/student target is needed for this object-boundary fixture;
    // student identity is still resolved by the real student ownership branch.
    body: { name: "Synthetic passport", type: "passport", fileKey: key, mimeType: "application/pdf", sizeBytes: storedBody.length, originalFileName: "fixture.pdf" },
  } as unknown as Request;
  const res = {
    status(value: number) { status = value; return this; },
    json(value: unknown) { body = value; return this; },
  } as unknown as Response;
  for (const layer of route.stack) {
    let advanced = false;
    await layer.handle(req, res, ((error?: unknown) => { if (error) throw error; advanced = true; }) as NextFunction);
    if (body !== undefined) break;
    assert.equal(advanced, true, "middleware must terminate or advance");
  }
  await nextImmediate(); // Drain the route's deferred audit against the double.
  return { status, body };
}

beforeEach(() => {
  owner = userId + 1;
  storedBody = Buffer.from("not-a-valid-pdf");
  events = [];
  inserted = undefined;
  finalizedGrant = true;
});
after(async () => {
  await pool.end();
  mock.restoreAll();
  syncBuiltinESMExports();
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
});

for (const [target, role] of [["document", "student"], ["document", "agent"], ["lead", "agent"]] as const) {
  test(`${target}: ${role} foreign/missing/null-owner keys are denied before object I/O or reference effects`, async () => {
    for (const recordedOwner of [userId + 1, null, undefined]) {
      owner = recordedOwner;
      for (const bytes of [validBody, Buffer.from("not-a-valid-pdf")]) {
        storedBody = bytes;
        events = [];
        const result = await invoke(target, role);
        assert.equal(result.status, 403);
        assert.match(result.body.error, /only attach files that you have uploaded/);
        assert.deepEqual(events, ["ownership"], "no read, cleanup, recompression, reference write or audit may precede rejection");
        assert.equal(inserted, undefined);
      }
    }
  });

  test(`${target}: ${role} owned valid file retains successful registration`, async () => {
    owner = userId;
    storedBody = validBody;
    const result = await invoke(target, role);
    assert.equal(result.status, 201);
    assert.equal(result.body.fileKey, key);
    assert.equal(inserted?.fileKey, key);
    assert.equal(events[0], "ownership");
    assert.ok(events.includes("read-bytes"));
    assert.ok(events.includes("recompress-metadata"));
    assert.ok(events.includes("consume-grant"));
    assert.ok(events.includes("insert-reference"));
    assert.equal(events.includes("delete-bytes"), false);
  });
}

for (const [target, role] of [["document", "student"], ["lead", "agent"]] as const) {
  test(`${target}: unfinalized or consumed grant cannot register a reference`, async () => {
    owner = userId;
    storedBody = validBody;
    finalizedGrant = false;
    const result = await invoke(target, role);
    assert.equal(result.status, 409);
    assert.equal(result.body.code, "UPLOAD_GRANT_NOT_FINALIZED");
    assert.ok(events.includes("consume-grant"));
    assert.equal(events.includes("insert-reference"), false);
    assert.equal(inserted, undefined);
  });
}

for (const target of ["document", "lead"] as const) {
  test(`${target}: existing staff allowance is unchanged`, async () => {
    storedBody = validBody;
    const result = await invoke(target, "admin");
    assert.equal(result.status, 201);
    assert.equal(result.body.fileKey, key);
    assert.equal(events.includes("ownership"), false);
    assert.ok(events.includes("insert-reference"));
  });
  test(`${target}: unauthenticated calls stop before all fixture access`, async () => {
    assert.equal((await invoke(target, "agent", false)).status, 401);
    assert.deepEqual(events, []);
  });
  test(`${target}: owned invalid file retains validation failure without registering a reference`, async () => {
    owner = userId;
    assert.equal((await invoke(target, "agent")).status, 400);
    assert.equal(events[0], "ownership");
    assert.ok(events.includes("read-bytes"));
    assert.ok(events.includes("delete-bytes"));
    assert.equal(events.includes("recompress-metadata"), false);
    assert.equal(events.includes("insert-reference"), false);
  });
}
