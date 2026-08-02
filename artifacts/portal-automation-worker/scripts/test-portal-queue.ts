/**
 * test-portal-queue.ts — canonical queue integration checks
 *
 * TQ1: claimNext() transitions a queued submission → running, sets lockedBy/lockedAt, increments attempts
 * TQ2: claimById() supports an explicit manual retry even at max_attempts
 * TQ3: releaseStale() crash-recovers a stale running submission → queued
 *
 * Run:
 *   pnpm --filter @workspace/portal-automation-worker test:queue
 */

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { db, portalSubmissionsTable, applicationsTable, studentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { claimById, claimNext, releaseStale } from "../src/queue.js";

type InsertPortalSubmission = typeof portalSubmissionsTable.$inferInsert;

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const RUN = `tq_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`;
const UNIVERSITY_KEY = `tq_uni_${RUN}`;

const cleanupSubIds: number[] = [];
const cleanupAppIds: number[] = [];
const cleanupStudentIds: number[] = [];

after(async () => {
  for (const id of cleanupSubIds)     await db.delete(portalSubmissionsTable).where(eq(portalSubmissionsTable.id, id)).catch(() => {});
  for (const id of cleanupAppIds)     await db.delete(applicationsTable).where(eq(applicationsTable.id, id)).catch(() => {});
  for (const id of cleanupStudentIds) await db.delete(studentsTable).where(eq(studentsTable.id, id)).catch(() => {});
  setImmediate(() => process.exit(process.exitCode ?? 0));
});

/** Create a minimal student → application → submission chain for testing. */
async function seedSubmission(opts: {
  status?: string;
  attempts?: number;
  maxAttempts?: number;
  lockedAt?: Date | null;
}): Promise<number> {
  const [student] = await db.insert(studentsTable).values({
    firstName: "TQ",
    lastName: `Test_${RUN}`,
    email: `tq_${Date.now()}@test.local`,
  }).returning({ id: studentsTable.id });
  cleanupStudentIds.push(student.id);

  const [app] = await db.insert(applicationsTable).values({
    studentId: student.id,
    stage: "inquiry",
    country: "Turkey",
    level: "bachelor",
    season: new Date().getFullYear().toString(),
    universityName: `TQ_Uni_${RUN}`,
  }).returning({ id: applicationsTable.id });
  cleanupAppIds.push(app.id);

  const values: InsertPortalSubmission = {
    applicationId: app.id,
    studentId:     student.id,
    universityKey: UNIVERSITY_KEY,
    universityName: `TQ_Uni_${RUN}`,
    mode:          "dry",
    status:        (opts.status ?? "queued") as InsertPortalSubmission["status"],
    attempts:      opts.attempts  ?? 0,
    maxAttempts:   opts.maxAttempts ?? 3,
    lockedAt:      opts.lockedAt ?? null,
  };

  const [sub] = await db.insert(portalSubmissionsTable).values(values).returning({ id: portalSubmissionsTable.id });
  cleanupSubIds.push(sub.id);
  return sub.id;
}

// ---------------------------------------------------------------------------
// TQ1 — claimNext happy path
// ---------------------------------------------------------------------------

test("TQ1: claimNext() claims a queued submission → running + increments attempts", async () => {
  const subId = await seedSubmission({ status: "queued", attempts: 0 });

  const claimed = await claimNext(`worker-tq1-${RUN}`, [UNIVERSITY_KEY]);

  assert.equal(claimed?.id, subId, "university-scoped claim returns the seeded submission");
  assert.equal(claimed?.status, "queued", "returned row has pre-update status (SELECT before UPDATE)");

  // Either way, verify DB state
  const [dbRow] = await db.select().from(portalSubmissionsTable).where(eq(portalSubmissionsTable.id, subId));
  assert.equal(dbRow.status, "running",    "status → running");
  assert.ok(dbRow.lockedAt !== null,       "lockedAt set");
  assert.ok(dbRow.lockedBy !== null,       "lockedBy set");
  assert.equal(dbRow.attempts, 1,          "attempts incremented to 1");
});

// ---------------------------------------------------------------------------
// TQ2 — an explicit manual retry remains claimable
// ---------------------------------------------------------------------------

test("TQ2: claimById() allows an explicit manual retry at maxAttempts", async () => {
  const subId = await seedSubmission({ status: "queued", attempts: 3, maxAttempts: 3 });

  const claimed = await claimById(subId, `worker-tq2-${RUN}`);

  assert.equal(claimed?.id, subId, "manual retry claims the requested submission");
  assert.equal(claimed?.status, "queued", "claim returns the pre-update status");
  const [dbRow] = await db.select().from(portalSubmissionsTable).where(eq(portalSubmissionsTable.id, subId));
  assert.equal(dbRow.status, "running", "manual retry transitions the row to running");
  assert.equal(dbRow.attempts, 4, "manual retry increments attempts for auditability");
});

// ---------------------------------------------------------------------------
// TQ3 — releaseStale resets stale running rows
// ---------------------------------------------------------------------------

test("TQ3: releaseStale() resets running submissions older than threshold → queued", async () => {
  // Insert a submission that appears stale (locked 10 minutes ago)
  const staleLockedAt = new Date(Date.now() - 10 * 60 * 1000);
  const subId = await seedSubmission({ status: "running", lockedAt: staleLockedAt, attempts: 1 });

  // Set lockedBy directly
  await db.update(portalSubmissionsTable)
    .set({ lockedBy: `worker-stale-${RUN}` })
    .where(eq(portalSubmissionsTable.id, subId));

  const released = await releaseStale(5 * 60 * 1000); // 5-min threshold

  assert.ok(released.includes(subId), `seeded stale row released (${released.join(",")})`);

  const [dbRow] = await db.select().from(portalSubmissionsTable).where(eq(portalSubmissionsTable.id, subId));
  assert.equal(dbRow.status,   "queued", "stale row reset to queued");
  assert.equal(dbRow.lockedAt, null,     "lockedAt cleared");
  assert.equal(dbRow.lockedBy, null,     "lockedBy cleared");
  assert.equal(dbRow.attempts, 0,        "attempts reset after crash recovery");
  assert.equal(Number((dbRow.meta as Record<string, unknown> | null)?.crash_recoveries), 1,
    "crash recovery count recorded in submission metadata");
});
