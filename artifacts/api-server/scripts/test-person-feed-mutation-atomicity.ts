/** Person feed note/follow-up mutation audit tests with rollback-capable DB doubles. */
import assert from "node:assert/strict";
import { after, beforeEach, mock, test } from "node:test";
import express from "express";
import http from "node:http";
import { once } from "node:events";

process.env.DATABASE_URL = "postgres://fixture:fixture@127.0.0.1:5433/fasos_apply_local";
process.env.NODE_ENV = "test";
const schema = await import("@workspace/db");
const { db, pool } = schema;
mock.method(pool, "connect", () => { throw new Error("REAL_DATABASE_FORBIDDEN"); });
mock.method(pool, "query", () => { throw new Error("REAL_DATABASE_FORBIDDEN"); });

type Row = Record<string, any>;
let notes: Row[] = [];
let followUps: Row[] = [];
let audits: Row[] = [];
let failAudit = false;
let nextId = 20;

function rowsFor(table: unknown): Row[] {
  if (table === schema.notesTable) return notes;
  if (table === schema.followUpsTable) return followUps;
  if (table === schema.leadsTable) return [{ id: 1, convertedStudentId: null, deletedAt: null }];
  return [];
}

mock.method(db, "select", () => ({
  from: (table: unknown) => ({
    where: async () => rowsFor(table),
  }),
}));
mock.method(db, "insert", (table: unknown) => ({ values: (input: Row | Row[]) => {
  const values = Array.isArray(input) ? input : [input];
  if (table === schema.auditLogsTable) {
    if (failAudit) return Promise.reject(new Error("SYNTHETIC_AUDIT_FAILURE"));
    audits.push(...values.map(value => ({ ...value })));
    return Promise.resolve();
  }
  const target = rowsFor(table);
  const created = values.map(value => ({
    id: nextId++,
    createdAt: new Date("2026-09-29T00:00:00.000Z"),
    updatedAt: new Date("2026-09-29T00:00:00.000Z"),
    completed: false,
    ...value,
  }));
  target.push(...created);
  return { returning: async () => created };
} }));
mock.method(db, "update", (table: unknown) => ({ set: (values: Row) => ({ where: () => ({ returning: async () => {
  const target = rowsFor(table);
  target.splice(0, target.length, ...target.map(row => ({ ...row, ...values })));
  return target;
} }) }) }));
mock.method(db, "delete", (table: unknown) => ({ where: () => ({ returning: async () => {
  const target = rowsFor(table);
  const removed = target.splice(0, target.length);
  return removed.map(({ id }) => ({ id }));
} }) }));
mock.method(db, "transaction", async (callback: (tx: typeof db) => Promise<unknown>) => {
  const noteSnapshot = notes.map(row => ({ ...row }));
  const followUpSnapshot = followUps.map(row => ({ ...row }));
  const auditSnapshot = audits.map(row => ({ ...row }));
  try {
    return await callback(db);
  } catch (error) {
    notes = noteSnapshot;
    followUps = followUpSnapshot;
    audits = auditSnapshot;
    throw error;
  }
});

const { feedBus } = await import("../src/lib/feedBus");
mock.method(feedBus, "publish", () => undefined);

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.user = { id: 7, role: "super_admin", isActive: true, email: "admin@example.test" } as any;
  next();
});
const router = (await import("../src/routes/personFeed")).default;
app.use("/api", router);
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(500).json({ error: "fixture_failure", detail: error instanceof Error ? error.message : String(error) });
});
const server = app.listen(0, "127.0.0.1");
await once(server, "listening");
const port = (server.address() as { port: number }).port;

function request(method: string, path: string, body?: unknown): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const json = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path: `/api${path}`,
      method,
      headers: { "Content-Type": "application/json", ...(json ? { "Content-Length": Buffer.byteLength(json) } : {}) },
    }, res => {
      let text = "";
      res.on("data", chunk => { text += chunk; });
      res.on("end", () => resolve({ status: res.statusCode!, data: text ? JSON.parse(text) : null }));
    });
    req.on("error", reject);
    if (json) req.write(json);
    req.end();
  });
}

beforeEach(() => {
  notes = [{
    id: 10,
    content: "existing private note",
    authorId: 7,
    resourceType: "lead",
    resourceId: 1,
    isInternal: true,
    createdAt: new Date("2026-09-28T00:00:00.000Z"),
  }];
  followUps = [{
    id: 11,
    leadId: 1,
    studentId: null,
    resourceType: "lead",
    title: "Existing follow-up",
    scheduledAt: new Date("2026-10-01T00:00:00.000Z"),
    notes: "private follow-up note",
    assignedToId: 7,
    completed: false,
    createdAt: new Date("2026-09-28T00:00:00.000Z"),
  }];
  audits = [];
  failAudit = false;
  nextId = 20;
});

after(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  await pool.end();
  mock.restoreAll();
});

test("note create and delete roll back when audit persistence fails", async () => {
  failAudit = true;
  const created = await request("POST", "/persons/feed/notes?context=lead&id=1", {
    content: "new private note",
    isInternal: true,
  });
  assert.equal(created.status, 500);
  assert.equal(notes.length, 1);

  const deleted = await request("DELETE", "/persons/feed/notes/10?context=lead&id=1");
  assert.equal(deleted.status, 500);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].id, 10);
});

test("follow-up create and update roll back when audit persistence fails", async () => {
  failAudit = true;
  const created = await request("POST", "/persons/feed/follow-ups?context=lead&id=1", {
    title: "Call applicant",
    scheduledAt: "2026-10-02T12:00:00.000Z",
    notes: "private details",
  });
  assert.equal(created.status, 500);
  assert.equal(followUps.length, 1);

  const updated = await request("PATCH", "/persons/feed/follow-ups/11?context=lead&id=1", {
    completed: true,
    notes: "new private details",
  });
  assert.equal(updated.status, 500);
  assert.equal(followUps[0].completed, false);
  assert.equal(followUps[0].notes, "private follow-up note");
});

test("successful mutations audit identifiers and field names without note content", async () => {
  const noteResult = await request("POST", "/persons/feed/notes?context=lead&id=1", {
    content: "highly sensitive note body",
    isInternal: true,
  });
  assert.equal(noteResult.status, 201, JSON.stringify(noteResult.data));

  const updateResult = await request("PATCH", "/persons/feed/follow-ups/11?context=lead&id=1", {
    completed: true,
    notes: "highly sensitive follow-up body",
  });
  assert.equal(updateResult.status, 200, JSON.stringify(updateResult.data));
  assert.equal(audits.length, 2);
  assert.deepEqual(JSON.parse(audits[0].changes), { noteId: noteResult.data.data.noteId, isInternal: true });
  assert.deepEqual(JSON.parse(audits[1].changes), { followUpId: 11, fields: ["completed", "notes"] });
  assert.equal(audits.some(row => row.changes.includes("highly sensitive")), false);
});
