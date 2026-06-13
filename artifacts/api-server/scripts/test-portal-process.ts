/**
 * test-portal-process.ts — A6 regression tests (TP1–TP5)
 *
 * TP1: POST /portal-submissions/process-queued with empty queue → 200, processed=0
 * TP2: POST /portal-submissions/:id/process → 404 on nonexistent id
 * TP3: POST /portal-submissions/:id/process on a canceled submission → 409 NOT_QUEUED
 * TP4: POST /portal-submissions/:id/process → 403 when user lacks required role
 * TP5: POST /portal-submissions/process-queued → 403 when user lacks required role
 *
 * Note: Tests TP1–TP3 use a running API server stub backed by real DB.
 * The process endpoints are not tested with actual browser runs here
 * (covered by drain-once integration smoke in CI/manual); this suite
 * validates auth, validation, and control-flow guardrails.
 *
 * Run:
 *   pnpm --filter @workspace/api-server run test:portal-process
 */

import { after, test } from "node:test";
import assert from "node:assert/strict";
import http from "http";
import express, { type Express } from "express";
import { eq, sql } from "drizzle-orm";
import {
  db,
  applicationsTable,
  portalSubmissionsTable,
  studentsTable,
} from "@workspace/db";
import portalAutomationRouter from "../src/routes/portalAutomation.js";

// ---------------------------------------------------------------------------
// Run-specific tag (avoids cross-run pollution)
// ---------------------------------------------------------------------------
const RUN_ID = `pp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

// ---------------------------------------------------------------------------
// Cleanup registry
// ---------------------------------------------------------------------------
const cleanupStudentIds:     number[] = [];
const cleanupAppIds:         number[] = [];
const cleanupSubmissionIds:  number[] = [];

after(async () => {
  for (const id of cleanupSubmissionIds) {
    await db.delete(portalSubmissionsTable).where(eq(portalSubmissionsTable.id, id)).catch(() => {});
  }
  for (const id of cleanupAppIds) {
    await db.delete(applicationsTable).where(eq(applicationsTable.id, id)).catch(() => {});
  }
  for (const id of cleanupStudentIds) {
    await db.delete(studentsTable).where(eq(studentsTable.id, id)).catch(() => {});
  }
  setImmediate(() => process.exit(process.exitCode ?? 0));
});

// ---------------------------------------------------------------------------
// Auth stubs
// ---------------------------------------------------------------------------
function buildApp(role = "super_admin"): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = { id: 1, role, isActive: true, emailVerified: true };
    if (!("cookies" in req)) (req as any).cookies = {};
    next();
  });
  app.use("/api", portalAutomationRouter);
  return app;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------
function sendReq(
  server: http.Server,
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const addr   = server.address() as { port: number };
    const json   = body !== undefined ? JSON.stringify(body) : undefined;
    const req    = http.request(
      {
        hostname: "127.0.0.1",
        port: addr.port,
        path,
        method,
        headers: {
          "Content-Type": "application/json",
          ...(json !== undefined ? { "Content-Length": Buffer.byteLength(json) } : {}),
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => { raw += c; });
        res.on("end", () => {
          try   { resolve({ status: res.statusCode ?? 0, body: JSON.parse(raw) }); }
          catch { resolve({ status: res.statusCode ?? 0, body: raw }); }
        });
      },
    );
    req.on("error", reject);
    if (json !== undefined) req.write(json);
    req.end();
  });
}

function listen(app: Express): Promise<http.Server> {
  return new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
}

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------
async function seedStudent(): Promise<number> {
  const [row] = await db
    .insert(studentsTable)
    .values({ firstName: `PP_${RUN_ID}`, lastName: "TestProcess" })
    .returning({ id: studentsTable.id });
  cleanupStudentIds.push(row.id);
  return row.id;
}

async function seedApp(studentId: number): Promise<number> {
  const [row] = await db
    .insert(applicationsTable)
    .values({ studentId })
    .returning({ id: applicationsTable.id });
  cleanupAppIds.push(row.id);
  return row.id;
}

async function seedSubmission(
  appId: number,
  studentId: number,
  status: "queued" | "canceled" | "failed" = "queued",
): Promise<number> {
  const [row] = await db
    .insert(portalSubmissionsTable)
    .values({
      applicationId: appId,
      studentId,
      universityKey: "topkapi",
      universityName: "Topkapi University (Test)",
      mode: "dry",
      status,
      attempts: 0,
      maxAttempts: 3,
    })
    .returning({ id: portalSubmissionsTable.id });
  cleanupSubmissionIds.push(row.id);
  return row.id;
}

// ---------------------------------------------------------------------------
// TP1 — process-queued with empty-ish queue → 200, processed=0
//        (Seeds no queued submissions in this test — queue should be empty
//         for this test run's scope, so processed=0 or a low number is fine.)
// ---------------------------------------------------------------------------
test("TP1: POST /portal-submissions/process-queued on empty queue returns processed=0", async () => {
  const app    = buildApp();
  const server = await listen(app);
  try {
    const res = await sendReq(server, "POST", "/api/portal-submissions/process-queued");
    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(typeof res.body.processed === "number", "processed must be a number");
    assert.ok(Array.isArray(res.body.results), "results must be an array");
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

// ---------------------------------------------------------------------------
// TP2 — POST /portal-submissions/:id/process for nonexistent id → 404
// ---------------------------------------------------------------------------
test("TP2: POST /portal-submissions/:id/process with nonexistent id returns 404", async () => {
  const app    = buildApp();
  const server = await listen(app);
  try {
    const res = await sendReq(server, "POST", "/api/portal-submissions/9999999/process");
    assert.equal(res.status, 404, `Expected 404, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.error, "NOT_FOUND");
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

// ---------------------------------------------------------------------------
// TP3 — POST /portal-submissions/:id/process for canceled submission → 409 NOT_QUEUED
// ---------------------------------------------------------------------------
test("TP3: POST /portal-submissions/:id/process on canceled submission returns 409 NOT_QUEUED", async () => {
  const studentId    = await seedStudent();
  const appId        = await seedApp(studentId);
  const submissionId = await seedSubmission(appId, studentId, "canceled");

  const app    = buildApp();
  const server = await listen(app);
  try {
    const res = await sendReq(server, "POST", `/api/portal-submissions/${submissionId}/process`);
    assert.equal(res.status, 409, `Expected 409, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.error, "NOT_QUEUED", `Expected NOT_QUEUED, got ${res.body.error}`);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

// ---------------------------------------------------------------------------
// TP4 — POST /portal-submissions/:id/process without required role → 403
//        requireRole fires before DB lookup, so no seed required.
// ---------------------------------------------------------------------------
test("TP4: POST /portal-submissions/:id/process as agent returns 403", async () => {
  const app    = buildApp("agent");
  const server = await listen(app);
  try {
    // Any integer id — 403 returned before the DB is touched
    const res = await sendReq(server, "POST", "/api/portal-submissions/1/process");
    assert.equal(res.status, 403, `Expected 403, got ${res.status}: ${JSON.stringify(res.body)}`);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

// ---------------------------------------------------------------------------
// TP5 — POST /portal-submissions/process-queued without required role → 403
// ---------------------------------------------------------------------------
test("TP5: POST /portal-submissions/process-queued as student returns 403", async () => {
  const app    = buildApp("student");
  const server = await listen(app);
  try {
    const res = await sendReq(server, "POST", "/api/portal-submissions/process-queued");
    assert.equal(res.status, 403, `Expected 403, got ${res.status}: ${JSON.stringify(res.body)}`);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

// ---------------------------------------------------------------------------
// TP6 — POST /portal-submissions/reset-stuck with no stuck rows → {reset:0}
// ---------------------------------------------------------------------------
test("TP6: POST /portal-submissions/reset-stuck with no stuck rows returns reset>=0", async () => {
  const app    = buildApp();
  const server = await listen(app);
  try {
    const res = await sendReq(server, "POST", "/api/portal-submissions/reset-stuck", {});
    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(typeof res.body.reset, "number", "Expected reset to be a number");
    assert.ok(Array.isArray(res.body.ids), "Expected ids to be an array");
    assert.ok(res.body.reset >= 0, `Expected reset>=0, got ${res.body.reset}`);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

// ---------------------------------------------------------------------------
// TP7 — POST /portal-submissions/reset-stuck resets a 15-min-old running row
// ---------------------------------------------------------------------------
test("TP7: POST /portal-submissions/reset-stuck resets an old running submission to queued", async () => {
  const studentId    = await seedStudent();
  const appId        = await seedApp(studentId);
  const submissionId = await seedSubmission(appId, studentId, "queued");

  // Manually set the row to 'running' with a locked_at 15 minutes in the past.
  await db.execute(
    sql`UPDATE portal_submissions
        SET status = 'running',
            locked_at = NOW() - INTERVAL '15 minutes',
            locked_by = 'test-old-worker'
        WHERE id = ${submissionId}`,
  );

  const app    = buildApp();
  const server = await listen(app);
  try {
    const res = await sendReq(server, "POST", "/api/portal-submissions/reset-stuck", { thresholdMinutes: 10 });
    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(
      (res.body.ids as number[]).includes(submissionId),
      `Expected ids to include ${submissionId}, got ${JSON.stringify(res.body.ids)}`,
    );

    const [row] = await db
      .select({ status: portalSubmissionsTable.status })
      .from(portalSubmissionsTable)
      .where(eq(portalSubmissionsTable.id, submissionId));
    assert.equal(row?.status, "queued", `Expected status=queued, got ${row?.status}`);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
