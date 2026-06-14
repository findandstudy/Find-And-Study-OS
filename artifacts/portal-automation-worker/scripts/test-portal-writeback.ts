/**
 * test-portal-writeback.ts — TW1 / TW2 / TW3 / TW4
 *
 * TW1: writebackResult(submitted=true)      → status='submitted',       stage='awaiting_offer_letter'
 * TW2: writebackResult(programMissing=true) → status='program_missing', stage='documents_collected'
 * TW3: writebackResult(alreadyExists=true)  → status='already_exists',  stage='already_registered'
 * TW4: writebackResult(null / error)        → status='failed', application stage unchanged
 *
 * Run:
 *   pnpm --filter @workspace/portal-automation-worker test:writeback
 */

import { after, test } from "node:test";
import assert from "node:assert/strict";
import {
  db,
  portalSubmissionsTable,
  applicationsTable,
  studentsTable,
  pipelineStagesTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { writebackResult, type RunResult } from "@workspace/portal-runner";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RUN = `tw_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`;

const cleanupSubIds: number[] = [];
const cleanupAppIds: number[] = [];
const cleanupStudentIds: number[] = [];

after(async () => {
  for (const id of cleanupSubIds)     await db.delete(portalSubmissionsTable).where(eq(portalSubmissionsTable.id, id)).catch(() => {});
  for (const id of cleanupAppIds)     await db.delete(applicationsTable).where(eq(applicationsTable.id, id)).catch(() => {});
  for (const id of cleanupStudentIds) await db.delete(studentsTable).where(eq(studentsTable.id, id)).catch(() => {});
  setImmediate(() => process.exit(process.exitCode ?? 0));
});

async function seedRunningSubmission(): Promise<{ subId: number; appId: number }> {
  const [student] = await db.insert(studentsTable).values({
    firstName: "TW",
    lastName:  `Test_${RUN}`,
    email:     `tw_${Date.now()}@test.local`,
  }).returning({ id: studentsTable.id });
  cleanupStudentIds.push(student.id);

  const [app] = await db.insert(applicationsTable).values({
    studentId:     student.id,
    stage:         "inquiry",
    country:       "Turkey",
    level:         "bachelor",
    season:        new Date().getFullYear().toString(),
    universityName: `TW_Uni_${RUN}`,
  }).returning({ id: applicationsTable.id });
  cleanupAppIds.push(app.id);

  const [sub] = await db.insert(portalSubmissionsTable).values({
    applicationId: app.id,
    studentId:     student.id,
    universityKey: `tw_uni_${RUN}`,
    universityName: `TW_Uni_${RUN}`,
    mode:          "dry",
    status:        "running",
    attempts:      1,
    lockedBy:      `worker-tw-${RUN}`,
    lockedAt:      new Date(),
  }).returning({ id: portalSubmissionsTable.id });
  cleanupSubIds.push(sub.id);

  return { subId: sub.id, appId: app.id };
}

function makeRunResult(result: { submitted?: boolean; alreadyExists?: boolean; programMissing?: boolean }): RunResult {
  return {
    result: {
      submitted:      result.submitted      ?? false,
      alreadyExists:  result.alreadyExists  ?? false,
      programMissing: result.programMissing ?? false,
    },
    screenshotUrls: [],
    meta: { adapterKey: "test", dryRun: true },
  };
}

/** Returns the stage key if it exists for entityType='application', or null. */
async function lookupStageKey(key: string): Promise<string | null> {
  const [row] = await db
    .select({ key: pipelineStagesTable.key })
    .from(pipelineStagesTable)
    .where(
      and(
        eq(pipelineStagesTable.entityType, "application"),
        eq(pipelineStagesTable.key, key),
      ),
    );
  return row?.key ?? null;
}

// ---------------------------------------------------------------------------
// TW1 — submitted
// ---------------------------------------------------------------------------

test("TW1: submitted=true → status=submitted, stage=awaiting_offer_letter (if stage exists)", async () => {
  const { subId, appId } = await seedRunningSubmission();

  await writebackResult(subId, makeRunResult({ submitted: true }));

  const [sub] = await db.select().from(portalSubmissionsTable).where(eq(portalSubmissionsTable.id, subId));
  assert.equal(sub.status, "submitted", "submission status=submitted");
  assert.equal(sub.lockedAt, null,      "lockedAt cleared");
  assert.equal(sub.lockedBy, null,      "lockedBy cleared");

  // Stage update is best-effort; verify state is consistent
  const [app] = await db.select({ stage: applicationsTable.stage }).from(applicationsTable).where(eq(applicationsTable.id, appId));
  const stageExists = await lookupStageKey("awaiting_offer_letter");
  if (stageExists) {
    assert.equal(app.stage, "awaiting_offer_letter", "app stage → awaiting_offer_letter");
  } else {
    // Stage not in pipeline → app stays at inquiry (best-effort)
    assert.equal(app.stage, "inquiry", "app stage unchanged (stage not in pipeline)");
  }
});

// ---------------------------------------------------------------------------
// TW2 — programMissing
// ---------------------------------------------------------------------------

test("TW2: programMissing=true → status=program_missing, stage=documents_collected (if stage exists)", async () => {
  const { subId, appId } = await seedRunningSubmission();

  await writebackResult(subId, makeRunResult({ programMissing: true }));

  const [sub] = await db.select().from(portalSubmissionsTable).where(eq(portalSubmissionsTable.id, subId));
  assert.equal(sub.status, "program_missing", "submission status=program_missing");

  const [app] = await db.select({ stage: applicationsTable.stage }).from(applicationsTable).where(eq(applicationsTable.id, appId));
  const stageExists = await lookupStageKey("documents_collected");
  if (stageExists) {
    assert.equal(app.stage, "documents_collected", "app stage → documents_collected");
  } else {
    assert.equal(app.stage, "inquiry", "app stage unchanged (stage not in pipeline)");
  }
});

// ---------------------------------------------------------------------------
// TW3 — alreadyExists
// ---------------------------------------------------------------------------

test("TW3: alreadyExists=true → status=already_exists, stage=already_registered (if stage exists)", async () => {
  const { subId, appId } = await seedRunningSubmission();

  await writebackResult(subId, makeRunResult({ alreadyExists: true }));

  const [sub] = await db.select().from(portalSubmissionsTable).where(eq(portalSubmissionsTable.id, subId));
  assert.equal(sub.status, "already_exists", "submission status=already_exists");

  const [app] = await db.select({ stage: applicationsTable.stage }).from(applicationsTable).where(eq(applicationsTable.id, appId));
  const stageExists = await lookupStageKey("already_registered");
  if (stageExists) {
    assert.equal(app.stage, "already_registered", "app stage → already_registered");
  } else {
    assert.equal(app.stage, "inquiry", "app stage unchanged (stage not in pipeline)");
  }
});

// ---------------------------------------------------------------------------
// TW4 — error / null result → failed, no stage change
// ---------------------------------------------------------------------------

test("TW4: null result (error) → status=failed, application stage unchanged", async () => {
  const { subId, appId } = await seedRunningSubmission();

  await writebackResult(subId, null, "ADAPTER_CRASH: connection refused");

  const [sub] = await db.select().from(portalSubmissionsTable).where(eq(portalSubmissionsTable.id, subId));
  assert.equal(sub.status, "failed",                               "submission status=failed");
  assert.ok(sub.error?.includes("ADAPTER_CRASH"),                  "error message stored");

  const [app] = await db.select({ stage: applicationsTable.stage }).from(applicationsTable).where(eq(applicationsTable.id, appId));
  assert.equal(app.stage, "inquiry", "application stage unchanged (stays inquiry)");
});
