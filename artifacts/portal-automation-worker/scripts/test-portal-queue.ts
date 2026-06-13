/**
 * test-portal-queue.ts — TQ1 / TQ2 / TQ3
 *
 * TQ1: claimNext() transitions a queued submission → running, sets lockedBy/lockedAt, increments attempts
 * TQ2: claimNext() skips a submission whose attempts >= max_attempts
 * TQ3: releaseStale() resets a running submission whose locked_at is older than threshold → queued
 *
 * Run:
 *   pnpm --filter @workspace/portal-automation-worker test:queue
 */

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { db, portalSubmissionsTable, applicationsTable, studentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { claimNext, releaseStale } from "../src/queue.js";

type InsertPortalSubmission = typeof portalSubmissionsTable.$inferInsert;

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const RUN = `tq_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`;

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
    universityKey: `tq_uni_${RUN}`,
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

  const claimed = await claimNext(`worker-tq1-${RUN}`);

  // We may have claimed any queued row; find ours
  let row = claimed?.id === subId ? claimed : null;
  if (!row) {
    // Re-query to confirm our specific row was claimed by some concurrent call
    const [dbRow] = await db.select().from(portalSubmissionsTable).where(eq(portalSubmissionsTable.id, subId));
    // If someone else claimed it first that's fine for isolation — just verify the state
    if (dbRow.status === "running") {
      row = dbRow as typeof claimed;
    }
  }

  // If we claimed it ourselves, verify the returned struct
  if (claimed?.id === subId) {
    assert.equal(claimed.status, "queued", "returned row has pre-update status (SELECT before UPDATE)");
  }

  // Either way, verify DB state
  const [dbRow] = await db.select().from(portalSubmissionsTable).where(eq(portalSubmissionsTable.id, subId));
  assert.equal(dbRow.status, "running",    "status → running");
  assert.ok(dbRow.lockedAt !== null,       "lockedAt set");
  assert.ok(dbRow.lockedBy !== null,       "lockedBy set");
  assert.equal(dbRow.attempts, 1,          "attempts incremented to 1");
});

// ---------------------------------------------------------------------------
// TQ2 — claimNext skips exhausted rows
// ---------------------------------------------------------------------------

test("TQ2: claimNext() skips a queued submission where attempts >= maxAttempts", async () => {
  // Insert a submission that has already hit its max
  const subId = await seedSubmission({ status: "queued", attempts: 3, maxAttempts: 3 });

  const claimed = await claimNext(`worker-tq2-${RUN}`);

  // The row we inserted must NOT have been claimed
  const [dbRow] = await db.select().from(portalSubmissionsTable).where(eq(portalSubmissionsTable.id, subId));
  assert.notEqual(claimed?.id, subId, "exhausted row not returned");
  assert.equal(dbRow.status, "queued",  "exhausted row stays queued");
  assert.equal(dbRow.attempts, 3,       "attempts unchanged");
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

  assert.ok(released >= 1, `at least 1 row released (got ${released})`);

  const [dbRow] = await db.select().from(portalSubmissionsTable).where(eq(portalSubmissionsTable.id, subId));
  assert.equal(dbRow.status,   "queued", "stale row reset to queued");
  assert.equal(dbRow.lockedAt, null,     "lockedAt cleared");
  assert.equal(dbRow.lockedBy, null,     "lockedBy cleared");
});
