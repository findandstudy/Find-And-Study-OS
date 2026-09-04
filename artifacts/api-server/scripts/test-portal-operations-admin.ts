import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import http from "node:http";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import {
  applicationsTable,
  db,
  portalSubmissionsTable,
  studentsTable,
  usersTable,
} from "@workspace/db";
import portalAutomationRouter from "../src/routes/portalAutomation.js";
import { normalizePortalLifecycleObservation } from "../src/lib/portalLifecycleObservation.js";
import { recordPortalLifecycleObservation } from "../src/lib/portalLifecycleObservationStore.js";

const RUN = `portal_operations_${Date.now().toString(36)}`;
let server: http.Server;
let userId = 0;
let studentId = 0;
let applicationId = 0;
let submissionId = 0;
let role = "super_admin";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as { user: unknown }).user = {
      id: userId,
      role,
      isActive: true,
      emailVerified: true,
    };
    next();
  });
  app.use("/api", portalAutomationRouter);
  return app;
}

async function request(method: "GET" | "POST", path: string) {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server_not_listening");
  const response = await fetch(`http://127.0.0.1:${address.port}${path}`, { method });
  return {
    status: response.status,
    cacheControl: response.headers.get("cache-control"),
    body: await response.json() as any,
  };
}

before(async () => {
  const [user] = await db.insert(usersTable).values({
    email: `${RUN}@example.test`,
    role: "super_admin",
    isActive: true,
    emailVerified: true,
  }).returning({ id: usersTable.id });
  userId = user.id;
  const [student] = await db.insert(studentsTable).values({
    firstName: "Operations",
    lastName: "Fixture",
  }).returning({ id: studentsTable.id });
  studentId = student.id;
  const [application] = await db.insert(applicationsTable).values({
    studentId,
    stage: "submitted",
  }).returning({ id: applicationsTable.id });
  applicationId = application.id;
  const [submission] = await db.insert(portalSubmissionsTable).values({
    applicationId,
    studentId,
    universityKey: "operations-portal",
    universityName: "Operations Portal",
    adapterKey: "operations-adapter",
    externalRef: "operations-ref",
    status: "submitted",
    statusCheckAttempts: 8,
    statusCheckSuspendedAt: new Date(),
    statusCheckError: "STATUS_CHECK_TIMEOUT",
  }).returning({ id: portalSubmissionsTable.id });
  submissionId = submission.id;
  const observation = normalizePortalLifecycleObservation({
    submissionId,
    applicationId,
    adapterKey: "operations-adapter",
    result: { status: "Under Review" },
  });
  await recordPortalLifecycleObservation(observation);
  server = http.createServer(buildApp() as unknown as http.RequestListener);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
});

after(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (studentId) await db.delete(studentsTable).where(eq(studentsTable.id, studentId));
  if (userId) await db.delete(usersTable).where(eq(usersTable.id, userId));
  setImmediate(() => process.exit(process.exitCode ?? 0));
});

test("operations dashboard is private, aggregate and admin-only", async () => {
  const response = await request("GET", "/api/portal-automation/operations");
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.cacheControl, "private, no-store");
  assert.ok(response.body.summary.suspended >= 1);
  assert.ok(response.body.lanes.some((lane: any) => lane.universityKey === "operations-portal"));
  assert.ok(response.body.recentObservations.some((item: any) => item.submissionId === submissionId));

  role = "staff";
  const forbidden = await request("GET", "/api/portal-automation/operations");
  assert.equal(forbidden.status, 403);
  role = "super_admin";
});

test("a quarantined check resumes only once through an audited admin command", async () => {
  const resumed = await request(
    "POST",
    `/api/portal-submissions/${submissionId}/status-check/resume`,
  );
  assert.equal(resumed.status, 200, JSON.stringify(resumed.body));
  const [row] = await db.select({
    attempts: portalSubmissionsTable.statusCheckAttempts,
    suspendedAt: portalSubmissionsTable.statusCheckSuspendedAt,
  }).from(portalSubmissionsTable).where(eq(portalSubmissionsTable.id, submissionId));
  assert.equal(row.attempts, 0);
  assert.equal(row.suspendedAt, null);

  const duplicate = await request(
    "POST",
    `/api/portal-submissions/${submissionId}/status-check/resume`,
  );
  assert.equal(duplicate.status, 409);
});
