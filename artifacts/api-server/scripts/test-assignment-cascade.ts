/**
 * Cross-stage assignment cascade regression test.
 *
 * Task #310 made assigning a person at the Student stage propagate the assignee
 * back to the linked Lead and the student's Applications (and the existing
 * Lead -> Student cascade kept working). That behavior had only a one-off manual
 * verification, so this suite locks it down against future regressions by
 * driving the real Express route handlers in-process (no network/auth stack):
 *
 *   (a) Student PATCH assign -> linked lead AND applications get the same
 *       assignee.
 *   (b) Student PATCH unassign (assignedToId: null) -> lead AND applications
 *       are cleared to null.
 *   (c) Student bulk-action "assign" -> lead AND applications get the same
 *       assignee for every affected student.
 *   (d) Permission gate: with `records.cascade_assignment` the cascade runs;
 *       without it the student's own assignment still changes but the linked
 *       lead and applications are left untouched. The only override toggled
 *       between the two cases is `records.cascade_assignment`.
 *   (e) No-op: re-assigning a student to the SAME assignee cascades nothing,
 *       even when downstream records currently point at a different person.
 *   (f) The existing Lead -> Student direction still cascades down to the
 *       converted student and its applications.
 *   (g) Application PATCH assign -> student AND linked lead get the same
 *       assignee (cascadeApplicationAssignment).
 *   (h) Application PATCH assign without cascade permission -> app itself
 *       changes but student and lead are left untouched.
 *   (i) staffCards POST /assigned-students -> lead AND applications cascade.
 *   (j) staffCards DELETE /assigned-students/:id -> lead AND applications
 *       are cleared to null.
 *   (k) Leads bulk-assign with cascade permission -> each lead's converted
 *       student AND that student's applications get the same assignee.
 *   (l) sync-assignment-backfill is idempotent: first run fixes mismatched
 *       records; second run is a no-op (zero updates).
 *
 * Mounts the real students + leads + applications + staffCards routers and
 * injects a fake `req.user` (the same seam used by test-inbox-ai-actions).
 * For the permission-gate cases the injected user id matches a real DB user
 * row whose `permission_overrides` control the effective permission set
 * resolved by `userHasPermission`.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:assignment-cascade
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";

// Hard exit after all tests complete — the routers pull in the notification
// dispatcher / db pool which keep live handles open, so node would otherwise
// hang. Matches the pattern used by the other in-process router tests.
after(() => {
  setImmediate(() => process.exit(process.exitCode ?? 0));
});

import http from "http";
import express, { type Express, type Request } from "express";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  usersTable,
  leadsTable,
  studentsTable,
  applicationsTable,
} from "@workspace/db";

import studentsRouter from "../src/routes/students.js";
import leadsRouter from "../src/routes/leads.js";
import applicationsRouter from "../src/routes/applications.js";
import staffCardsRouter from "../src/routes/staffCards.js";
import { runBackfill } from "./sync-assignment-backfill.js";

const RUN_ID = `t326_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

type FakeUser = { id: number; role: string; isActive: boolean };

// Mutable holder swapped per-request so a single mounted app can act as
// different users (admin vs. permission-scoped consultant).
let currentUser: FakeUser = { id: 0, role: "admin", isActive: true };

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { user: FakeUser }).user = currentUser;
    next();
  });
  app.use("/api", studentsRouter);
  app.use("/api", leadsRouter);
  app.use("/api", applicationsRouter);
  app.use("/api", staffCardsRouter);
  return app;
}

const app = buildApp();

async function request(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  const server = http.createServer(app as unknown as (req: Request, res: unknown) => void);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("listen failed");
  const port = addr.port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let parsed: unknown = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

// ---------------------------------------------------------------------------
// Seeding helpers. All rows are tagged with RUN_ID so reruns never collide and
// cleanup is total.
// ---------------------------------------------------------------------------

const createdUserIds: number[] = [];
const createdLeadIds: number[] = [];
const createdStudentIds: number[] = [];

async function createUser(opts: {
  role: string;
  overrides?: Record<string, boolean> | null;
}): Promise<number> {
  const suffix = `${RUN_ID}_${Math.random().toString(36).slice(2, 8)}`;
  const [row] = await db
    .insert(usersTable)
    .values({
      email: `${suffix}@cascade-test.local`,
      firstName: "Cascade",
      lastName: `Test_${suffix}`,
      role: opts.role,
      isActive: true,
      permissionOverrides: opts.overrides ?? null,
    })
    .returning({ id: usersTable.id });
  createdUserIds.push(row.id);
  return row.id;
}

interface Scenario {
  studentId: number;
  leadId: number;
  appIds: number[];
}

/**
 * Create a converted lead -> student chain with two applications, optionally
 * pre-assigned to a given staff user (defaults to unassigned).
 */
async function seedScenario(initialAssignee: number | null = null): Promise<Scenario> {
  const suffix = `${RUN_ID}_${Math.random().toString(36).slice(2, 8)}`;
  const [student] = await db
    .insert(studentsTable)
    .values({
      firstName: "Stu",
      lastName: `Test_${suffix}`,
      email: `stu_${suffix}@cascade-test.local`,
      assignedToId: initialAssignee,
    })
    .returning({ id: studentsTable.id });
  createdStudentIds.push(student.id);

  const [lead] = await db
    .insert(leadsTable)
    .values({
      firstName: "Stu",
      lastName: `Test_${suffix}`,
      email: `lead_${suffix}@cascade-test.local`,
      status: "converted",
      convertedStudentId: student.id,
      assignedToId: initialAssignee,
    })
    .returning({ id: leadsTable.id });
  createdLeadIds.push(lead.id);

  const appRows = await db
    .insert(applicationsTable)
    .values([
      { studentId: student.id, assignedToId: initialAssignee },
      { studentId: student.id, assignedToId: initialAssignee },
    ])
    .returning({ id: applicationsTable.id });

  return { studentId: student.id, leadId: lead.id, appIds: appRows.map(a => a.id) };
}

async function readAssignments(s: Scenario): Promise<{
  student: number | null;
  lead: number | null;
  apps: (number | null)[];
}> {
  const [student] = await db
    .select({ assignedToId: studentsTable.assignedToId })
    .from(studentsTable)
    .where(eq(studentsTable.id, s.studentId));
  const [lead] = await db
    .select({ assignedToId: leadsTable.assignedToId })
    .from(leadsTable)
    .where(eq(leadsTable.id, s.leadId));
  const apps = await db
    .select({ id: applicationsTable.id, assignedToId: applicationsTable.assignedToId })
    .from(applicationsTable)
    .where(inArray(applicationsTable.id, s.appIds))
    .orderBy(applicationsTable.id);
  return {
    student: student?.assignedToId ?? null,
    lead: lead?.assignedToId ?? null,
    apps: apps.map(a => a.assignedToId ?? null),
  };
}

// Cleanup deletes the lead first (it FK-references both the student and the
// assignee users), then the student (cascades its applications), then users.
after(async () => {
  try {
    if (createdLeadIds.length) await db.delete(leadsTable).where(inArray(leadsTable.id, createdLeadIds));
    if (createdStudentIds.length) await db.delete(studentsTable).where(inArray(studentsTable.id, createdStudentIds));
    if (createdUserIds.length) await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  } catch (err) {
    console.error("[cleanup] failed:", err);
  }
});

// ---------------------------------------------------------------------------
// (a) Student PATCH assign cascades down to lead + applications.
// ---------------------------------------------------------------------------
test("student PATCH assign cascades to linked lead and applications", async () => {
  const admin = await createUser({ role: "admin" });
  const staff = await createUser({ role: "staff" });
  currentUser = { id: admin, role: "admin", isActive: true };

  const s = await seedScenario(null);
  const res = await request("PATCH", `/api/students/${s.studentId}`, { assignedToId: staff });
  assert.equal(res.status, 200, `PATCH should succeed (got ${res.status}: ${JSON.stringify(res.body)})`);

  const after = await readAssignments(s);
  assert.equal(after.student, staff, "student assigned");
  assert.equal(after.lead, staff, "lead cascaded");
  assert.deepEqual(after.apps, [staff, staff], "applications cascaded");
});

// ---------------------------------------------------------------------------
// (b) Student PATCH unassign (null) clears lead + applications.
// ---------------------------------------------------------------------------
test("student PATCH unassign (null) clears lead and applications", async () => {
  const admin = await createUser({ role: "admin" });
  const staff = await createUser({ role: "staff" });
  currentUser = { id: admin, role: "admin", isActive: true };

  const s = await seedScenario(staff);
  const res = await request("PATCH", `/api/students/${s.studentId}`, { assignedToId: null });
  assert.equal(res.status, 200, `PATCH should succeed (got ${res.status}: ${JSON.stringify(res.body)})`);

  const after = await readAssignments(s);
  assert.equal(after.student, null, "student unassigned");
  assert.equal(after.lead, null, "lead cleared");
  assert.deepEqual(after.apps, [null, null], "applications cleared");
});

// ---------------------------------------------------------------------------
// (c) Student bulk-action "assign" cascades for every affected student.
// ---------------------------------------------------------------------------
test("student bulk-assign cascades to each student's lead and applications", async () => {
  const admin = await createUser({ role: "admin" });
  const staff = await createUser({ role: "staff" });
  currentUser = { id: admin, role: "admin", isActive: true };

  const s1 = await seedScenario(null);
  const s2 = await seedScenario(null);
  const res = await request("POST", `/api/students/bulk-action`, {
    ids: [s1.studentId, s2.studentId],
    action: "assign",
    assignedToId: staff,
  });
  assert.equal(res.status, 200, `bulk-action should succeed (got ${res.status}: ${JSON.stringify(res.body)})`);

  for (const s of [s1, s2]) {
    const after = await readAssignments(s);
    assert.equal(after.student, staff, "student assigned");
    assert.equal(after.lead, staff, "lead cascaded");
    assert.deepEqual(after.apps, [staff, staff], "applications cascaded");
  }
});

// ---------------------------------------------------------------------------
// (d) Permission gate — toggling ONLY records.cascade_assignment.
// ---------------------------------------------------------------------------
test("cascade runs only with records.cascade_assignment permission", async () => {
  const staff = await createUser({ role: "staff" });

  // Both consultants can view others' records and change the assignee; only the
  // first additionally holds the cascade permission.
  const withCascade = await createUser({
    role: "consultant",
    overrides: {
      "records.view_others": true,
      "records.change_assigned": true,
      "records.cascade_assignment": true,
    },
  });
  const withoutCascade = await createUser({
    role: "consultant",
    overrides: {
      "records.view_others": true,
      "records.change_assigned": true,
    },
  });

  // With the permission: full cascade.
  {
    const s = await seedScenario(null);
    currentUser = { id: withCascade, role: "consultant", isActive: true };
    const res = await request("PATCH", `/api/students/${s.studentId}`, { assignedToId: staff });
    assert.equal(res.status, 200, `PATCH should succeed (got ${res.status}: ${JSON.stringify(res.body)})`);
    const after = await readAssignments(s);
    assert.equal(after.student, staff, "student assigned (with perm)");
    assert.equal(after.lead, staff, "lead cascaded (with perm)");
    assert.deepEqual(after.apps, [staff, staff], "applications cascaded (with perm)");
  }

  // Without the permission: the student's own assignment changes, but the
  // linked lead and applications are left untouched.
  {
    const s = await seedScenario(null);
    currentUser = { id: withoutCascade, role: "consultant", isActive: true };
    const res = await request("PATCH", `/api/students/${s.studentId}`, { assignedToId: staff });
    assert.equal(res.status, 200, `PATCH should succeed (got ${res.status}: ${JSON.stringify(res.body)})`);
    const after = await readAssignments(s);
    assert.equal(after.student, staff, "student assigned (no perm)");
    assert.equal(after.lead, null, "lead NOT cascaded (no perm)");
    assert.deepEqual(after.apps, [null, null], "applications NOT cascaded (no perm)");
  }
});

// ---------------------------------------------------------------------------
// (e) No-op — re-assigning to the same assignee cascades nothing.
// ---------------------------------------------------------------------------
test("re-assigning a student to the same assignee cascades nothing", async () => {
  const admin = await createUser({ role: "admin" });
  const staffA = await createUser({ role: "staff" });
  const staffB = await createUser({ role: "staff" });
  currentUser = { id: admin, role: "admin", isActive: true };

  // Student already on staffA; downstream deliberately points at staffB so a
  // stray cascade would be observable.
  const s = await seedScenario(staffA);
  await db.update(leadsTable).set({ assignedToId: staffB }).where(eq(leadsTable.id, s.leadId));
  await db.update(applicationsTable).set({ assignedToId: staffB }).where(inArray(applicationsTable.id, s.appIds));

  const res = await request("PATCH", `/api/students/${s.studentId}`, { assignedToId: staffA });
  assert.equal(res.status, 200, `PATCH should succeed (got ${res.status}: ${JSON.stringify(res.body)})`);

  const after = await readAssignments(s);
  assert.equal(after.student, staffA, "student unchanged");
  assert.equal(after.lead, staffB, "lead untouched (no cascade on no-op)");
  assert.deepEqual(after.apps, [staffB, staffB], "applications untouched (no cascade on no-op)");
});

// ---------------------------------------------------------------------------
// (f) Existing Lead -> Student direction still cascades.
// ---------------------------------------------------------------------------
test("lead PATCH assign still cascades down to student and applications", async () => {
  const admin = await createUser({ role: "admin" });
  const staff = await createUser({ role: "staff" });
  currentUser = { id: admin, role: "admin", isActive: true };

  const s = await seedScenario(null);
  // The leads PATCH route accepts the assignee under `assignedTo` and maps it
  // to `assignedToId` internally.
  const res = await request("PATCH", `/api/leads/${s.leadId}`, { assignedTo: staff });
  assert.equal(res.status, 200, `PATCH should succeed (got ${res.status}: ${JSON.stringify(res.body)})`);

  const after = await readAssignments(s);
  assert.equal(after.lead, staff, "lead assigned");
  assert.equal(after.student, staff, "student cascaded");
  assert.deepEqual(after.apps, [staff, staff], "applications cascaded");
});

// ---------------------------------------------------------------------------
// (g) Application PATCH assign cascades UP to student and linked lead.
// ---------------------------------------------------------------------------
test("application PATCH assign cascades to student and linked lead", async () => {
  const admin = await createUser({ role: "admin" });
  const staff = await createUser({ role: "staff" });
  currentUser = { id: admin, role: "admin", isActive: true };

  const s = await seedScenario(null);
  // Patch the first application — only that app's assignedToId changes
  // explicitly; the cascade writes student + lead.
  const targetAppId = s.appIds[0];
  const res = await request("PATCH", `/api/applications/${targetAppId}`, { assignedToId: staff });
  assert.equal(res.status, 200, `PATCH should succeed (got ${res.status}: ${JSON.stringify(res.body)})`);

  const [patchedApp] = await db
    .select({ assignedToId: applicationsTable.assignedToId })
    .from(applicationsTable)
    .where(eq(applicationsTable.id, targetAppId));
  assert.equal(patchedApp?.assignedToId, staff, "patched application updated");

  const [studentRow] = await db
    .select({ assignedToId: studentsTable.assignedToId })
    .from(studentsTable)
    .where(eq(studentsTable.id, s.studentId));
  assert.equal(studentRow?.assignedToId, staff, "student cascaded from application");

  const [leadRow] = await db
    .select({ assignedToId: leadsTable.assignedToId })
    .from(leadsTable)
    .where(eq(leadsTable.id, s.leadId));
  assert.equal(leadRow?.assignedToId, staff, "lead cascaded from application");
});

// ---------------------------------------------------------------------------
// (h) Application PATCH assign without cascade permission — only the app
//     changes; student and lead are left untouched.
// ---------------------------------------------------------------------------
test("application PATCH assign without cascade permission leaves student and lead untouched", async () => {
  const staff = await createUser({ role: "staff" });

  // A consultant with the ability to change application assignment but without
  // the cascade permission.
  const withoutCascade = await createUser({
    role: "consultant",
    overrides: {
      "records.view_others": true,
      "records.change_assigned": true,
      "applications.change_assigned": true,
    },
  });
  currentUser = { id: withoutCascade, role: "consultant", isActive: true };

  const s = await seedScenario(null);
  const targetAppId = s.appIds[0];
  const res = await request("PATCH", `/api/applications/${targetAppId}`, { assignedToId: staff });
  assert.equal(res.status, 200, `PATCH should succeed (got ${res.status}: ${JSON.stringify(res.body)})`);

  const [patchedApp] = await db
    .select({ assignedToId: applicationsTable.assignedToId })
    .from(applicationsTable)
    .where(eq(applicationsTable.id, targetAppId));
  assert.equal(patchedApp?.assignedToId, staff, "patched application updated");

  const [studentRow] = await db
    .select({ assignedToId: studentsTable.assignedToId })
    .from(studentsTable)
    .where(eq(studentsTable.id, s.studentId));
  assert.equal(studentRow?.assignedToId, null, "student NOT cascaded (no cascade perm)");

  const [leadRow] = await db
    .select({ assignedToId: leadsTable.assignedToId })
    .from(leadsTable)
    .where(eq(leadsTable.id, s.leadId));
  assert.equal(leadRow?.assignedToId, null, "lead NOT cascaded (no cascade perm)");
});

// ---------------------------------------------------------------------------
// (i) staffCards POST /assigned-students cascades to lead + applications.
// ---------------------------------------------------------------------------
test("staffCards assign student cascades to linked lead and applications", async () => {
  const admin = await createUser({ role: "admin" });
  const staff = await createUser({ role: "staff" });
  currentUser = { id: admin, role: "admin", isActive: true };

  const s = await seedScenario(null);
  const res = await request("POST", `/api/staff-cards/${staff}/assigned-students`, { studentId: s.studentId });
  assert.equal(res.status, 200, `POST should succeed (got ${res.status}: ${JSON.stringify(res.body)})`);

  // Give the fire-and-forget cascade a moment to complete (it runs with .catch()).
  await new Promise(r => setTimeout(r, 200));

  const after = await readAssignments(s);
  assert.equal(after.student, staff, "student assigned via staffCards");
  assert.equal(after.lead, staff, "lead cascaded via staffCards");
  assert.deepEqual(after.apps, [staff, staff], "applications cascaded via staffCards");
});

// ---------------------------------------------------------------------------
// (j) staffCards DELETE /assigned-students/:id cascades null.
// ---------------------------------------------------------------------------
test("staffCards unassign student cascades null to lead and applications", async () => {
  const admin = await createUser({ role: "admin" });
  const staff = await createUser({ role: "staff" });
  currentUser = { id: admin, role: "admin", isActive: true };

  const s = await seedScenario(staff);
  const res = await request("DELETE", `/api/staff-cards/${staff}/assigned-students/${s.studentId}`);
  assert.equal(res.status, 204, `DELETE should succeed (got ${res.status}: ${JSON.stringify(res.body)})`);

  // Give the fire-and-forget cascade a moment to complete.
  await new Promise(r => setTimeout(r, 200));

  const after = await readAssignments(s);
  assert.equal(after.student, null, "student unassigned via staffCards");
  assert.equal(after.lead, null, "lead cleared via staffCards");
  assert.deepEqual(after.apps, [null, null], "applications cleared via staffCards");
});

// ---------------------------------------------------------------------------
// (k) Leads bulk-assign cascades to converted student + their applications.
// ---------------------------------------------------------------------------
test("leads bulk-assign cascades to each lead's student and applications", async () => {
  const admin = await createUser({ role: "admin" });
  const staff = await createUser({ role: "staff" });
  currentUser = { id: admin, role: "admin", isActive: true };

  const s1 = await seedScenario(null);
  const s2 = await seedScenario(null);

  const res = await request("POST", `/api/leads/bulk-action`, {
    ids: [s1.leadId, s2.leadId],
    action: "assign",
    assignedToId: staff,
  });
  assert.equal(res.status, 200, `bulk-action should succeed (got ${res.status}: ${JSON.stringify(res.body)})`);

  for (const s of [s1, s2]) {
    const after = await readAssignments(s);
    assert.equal(after.lead, staff, "lead assigned via bulk-action");
    assert.equal(after.student, staff, "student cascaded via leads bulk-assign");
    assert.deepEqual(after.apps, [staff, staff], "applications cascaded via leads bulk-assign");
  }
});

// ---------------------------------------------------------------------------
// (l) sync-assignment-backfill is idempotent.
//
// Arrange: student assigned to staffA; linked lead and apps deliberately point
// at staffB (simulating drift). First run should fix lead + apps; second run
// should touch nothing.
// ---------------------------------------------------------------------------
test("sync-assignment-backfill is idempotent", async () => {
  const staffA = await createUser({ role: "staff" });
  const staffB = await createUser({ role: "staff" });

  const s = await seedScenario(staffA);

  // Introduce drift: lead + apps point at staffB while student stays on staffA.
  await db.update(leadsTable).set({ assignedToId: staffB }).where(eq(leadsTable.id, s.leadId));
  await db.update(applicationsTable).set({ assignedToId: staffB }).where(inArray(applicationsTable.id, s.appIds));

  // First run — scoped to this specific student so the count is deterministic.
  const first = await runBackfill({ studentIds: [s.studentId] });
  assert.equal(first.studentsScanned, 1, "exactly one student scanned on first run");
  assert.equal(first.leadsUpdated, 1, "one lead fixed on first run");
  assert.equal(first.appsUpdated, 2, "two apps fixed on first run");

  // Verify DB state is now consistent.
  const afterFirst = await readAssignments(s);
  assert.equal(afterFirst.student, staffA, "student still on staffA");
  assert.equal(afterFirst.lead, staffA, "lead corrected to staffA");
  assert.deepEqual(afterFirst.apps, [staffA, staffA], "apps corrected to staffA");

  // Second run — everything is already in sync, so zero updates.
  const second = await runBackfill({ studentIds: [s.studentId] });
  assert.equal(second.studentsScanned, 1, "exactly one student scanned on second run");
  assert.equal(second.leadsUpdated, 0, "no lead updates on second run (idempotent)");
  assert.equal(second.appsUpdated, 0, "no app updates on second run (idempotent)");

  // DB state should be unchanged.
  const afterSecond = await readAssignments(s);
  assert.equal(afterSecond.lead, staffA, "lead unchanged after second run");
  assert.deepEqual(afterSecond.apps, [staffA, staffA], "apps unchanged after second run");
});
