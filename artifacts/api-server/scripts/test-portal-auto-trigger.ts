/**
 * test-portal-auto-trigger.ts — TAT1 / TAT2 / TAT3 / TAT4
 *
 * TAT1: maybeEnqueuePortalSubmission enqueues when all gates pass
 *       (isEnabled, stage in triggerStages, active portal_uni, credentials, no dedup)
 *       → portal_submissions row inserted with correct mode/universityKey
 *
 * TAT2: Trigger-stage filter — does NOT enqueue when newStage is NOT in triggerStages
 *
 * TAT3: Scope filter — 'selected' scope skips when universityKey ∉ selectedUniversityKeys
 *
 * TAT4: Dedup — does NOT enqueue when an active submission (queued) already exists
 *       for the same application × universityKey
 *
 * Run:
 *   pnpm --filter @workspace/api-server test:portal-auto-trigger
 */

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  applicationsTable,
  studentsTable,
  portalAutomationSettingsTable,
  portalUniversitiesTable,
  portalSubmissionsTable,
} from "@workspace/db";
import { maybeEnqueuePortalSubmission } from "../src/lib/portalAutoTrigger.js";

// ---------------------------------------------------------------------------
// Run-specific unique key
// ---------------------------------------------------------------------------

const RUN = `tat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`;

// Adapter key derived from RUN (uppercase = env-var prefix)
const ADAPTER_KEY  = `test_${RUN}`;
const UNI_KEY      = `uni_${RUN}`;
const UNI_NAME     = `TAT Test University ${RUN}`;
const TRIGGER_STAGE = `tat_stage_${RUN}`;

// ---------------------------------------------------------------------------
// Credential injection — set env vars so hasPortalCredentials() returns true
// ---------------------------------------------------------------------------
const ENV_PREFIX = ADAPTER_KEY.toUpperCase().replace(/-/g, "_");
process.env[`${ENV_PREFIX}_USER`]     = "tat-test-user";
process.env[`${ENV_PREFIX}_PASSWORD`] = "tat-test-pass";

// ---------------------------------------------------------------------------
// Saved originals for settings restore
// ---------------------------------------------------------------------------
let savedSettings: { id: number; row: Record<string, unknown> } | null = null;

// ---------------------------------------------------------------------------
// Cleanup tracking
// ---------------------------------------------------------------------------
const cleanupStudentIds:   number[] = [];
const cleanupAppIds:       number[] = [];
const cleanupSubIds:       number[] = [];
const cleanupPortalUniIds: number[] = [];
let   settingsRowId: number | null  = null;

// ---------------------------------------------------------------------------
// before — create shared fixtures
// ---------------------------------------------------------------------------
before(async () => {
  // Save existing settings row (if any)
  const [existing] = await db.select().from(portalAutomationSettingsTable).limit(1);
  if (existing) {
    savedSettings = { id: existing.id, row: existing as Record<string, unknown> };
  }

  // Upsert settings: enabled, triggerStage = TRIGGER_STAGE, mode=dry, scope=only_applied
  if (existing) {
    await db.update(portalAutomationSettingsTable)
      .set({
        isEnabled:              true,
        triggerStages:          [TRIGGER_STAGE],
        mode:                   "dry",
        scope:                  "only_applied",
        selectedUniversityKeys: [],
      })
      .where(eq(portalAutomationSettingsTable.id, existing.id));
    settingsRowId = existing.id;
  } else {
    const [ins] = await db.insert(portalAutomationSettingsTable).values({
      isEnabled:              true,
      triggerStages:          [TRIGGER_STAGE],
      mode:                   "dry",
      scope:                  "only_applied",
      selectedUniversityKeys: [],
    }).returning({ id: portalAutomationSettingsTable.id });
    settingsRowId = ins.id;
  }

  // Create portal_universities row for test university
  const [pu] = await db.insert(portalUniversitiesTable).values({
    universityKey: UNI_KEY,
    universityName: UNI_NAME,
    adapterKey:    ADAPTER_KEY,
    isActive:      true,
  }).returning({ id: portalUniversitiesTable.id });
  cleanupPortalUniIds.push(pu.id);
});

// ---------------------------------------------------------------------------
// after — restore settings and clean test data
// ---------------------------------------------------------------------------
after(async () => {
  // Restore settings
  if (savedSettings && settingsRowId) {
    const { isEnabled, triggerStages, mode, scope, selectedUniversityKeys } =
      savedSettings.row as {
        isEnabled: boolean;
        triggerStages: string[];
        mode: "dry" | "real";
        scope: "only_applied" | "selected" | "all";
        selectedUniversityKeys: string[];
      };
    await db.update(portalAutomationSettingsTable)
      .set({ isEnabled, triggerStages, mode, scope, selectedUniversityKeys })
      .where(eq(portalAutomationSettingsTable.id, settingsRowId))
      .catch(() => {});
  } else if (settingsRowId && !savedSettings) {
    // We inserted it — remove it
    await db.delete(portalAutomationSettingsTable)
      .where(eq(portalAutomationSettingsTable.id, settingsRowId))
      .catch(() => {});
  }

  // Clean submissions
  for (const id of cleanupSubIds) {
    await db.delete(portalSubmissionsTable).where(eq(portalSubmissionsTable.id, id)).catch(() => {});
  }
  // Clean portal_universities
  for (const id of cleanupPortalUniIds) {
    await db.delete(portalUniversitiesTable).where(eq(portalUniversitiesTable.id, id)).catch(() => {});
  }
  // Clean apps + students
  for (const id of cleanupAppIds) {
    await db.delete(applicationsTable).where(eq(applicationsTable.id, id)).catch(() => {});
  }
  for (const id of cleanupStudentIds) {
    await db.delete(studentsTable).where(eq(studentsTable.id, id)).catch(() => {});
  }
  setImmediate(() => process.exit(process.exitCode ?? 0));
});

// ---------------------------------------------------------------------------
// Seed helper
// ---------------------------------------------------------------------------
async function seedApp(): Promise<{ studentId: number; appId: number }> {
  const [student] = await db.insert(studentsTable).values({
    firstName: `TAT`,
    lastName:  `Test_${RUN}`,
    email:     `tat_${Date.now()}@test.local`,
  }).returning({ id: studentsTable.id });
  cleanupStudentIds.push(student.id);

  const [app] = await db.insert(applicationsTable).values({
    studentId:     student.id,
    universityName: UNI_NAME,
    stage:         "inquiry",
    season:        "2026",
  }).returning({ id: applicationsTable.id });
  cleanupAppIds.push(app.id);

  return { studentId: student.id, appId: app.id };
}

// Helper: find the auto-enqueued submission for a given app
async function findSub(appId: number): Promise<typeof portalSubmissionsTable.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(portalSubmissionsTable)
    .where(
      and(
        eq(portalSubmissionsTable.applicationId, appId),
        eq(portalSubmissionsTable.universityKey, UNI_KEY),
        isNull(portalSubmissionsTable.deletedAt),
      ),
    )
    .limit(1);
  if (row) cleanupSubIds.push(row.id);
  return row ?? null;
}

// ---------------------------------------------------------------------------
// TAT1 — happy path: all gates pass → submission enqueued
// ---------------------------------------------------------------------------
test("TAT1: enqueues when isEnabled + stage in triggerStages + active uni + credentials + no dedup", async () => {
  const { studentId, appId } = await seedApp();

  await maybeEnqueuePortalSubmission({
    applicationId: appId,
    studentId,
    newStage:      TRIGGER_STAGE,
    universityName: UNI_NAME,
    universityId:  null,
    actorUserId:   1,
  });

  const sub = await findSub(appId);
  assert.ok(sub !== null,            "submission was enqueued");
  assert.equal(sub!.status,          "queued",     "status=queued");
  assert.equal(sub!.mode,            "dry",         "mode=dry (from settings)");
  assert.equal(sub!.universityKey,   UNI_KEY,       "universityKey correct");
  assert.equal(sub!.universityName,  UNI_NAME,      "universityName correct");
  assert.equal(sub!.applicationId,   appId,         "applicationId correct");
  assert.equal(sub!.studentId,       studentId,     "studentId correct");
  assert.equal(sub!.enqueuedBy,      1,             "enqueuedBy=actorUserId");
});

// ---------------------------------------------------------------------------
// TAT2 — trigger-stage filter: stage NOT in triggerStages → no enqueue
// ---------------------------------------------------------------------------
test("TAT2: does NOT enqueue when newStage is not in triggerStages", async () => {
  const { studentId, appId } = await seedApp();

  await maybeEnqueuePortalSubmission({
    applicationId: appId,
    studentId,
    newStage:      "some_other_stage",   // NOT in triggerStages
    universityName: UNI_NAME,
    universityId:  null,
    actorUserId:   1,
  });

  const sub = await findSub(appId);
  assert.equal(sub, null, "no submission when stage not in triggerStages");
});

// ---------------------------------------------------------------------------
// TAT3 — scope='selected': universityKey NOT in selectedUniversityKeys → skip
// ---------------------------------------------------------------------------
test("TAT3: scope=selected skips when universityKey is not in selectedUniversityKeys", async () => {
  const { studentId, appId } = await seedApp();

  // Update settings to scope=selected with DIFFERENT key list
  await db.update(portalAutomationSettingsTable)
    .set({ scope: "selected", selectedUniversityKeys: ["some_other_uni_key"] })
    .where(eq(portalAutomationSettingsTable.id, settingsRowId!));

  try {
    await maybeEnqueuePortalSubmission({
      applicationId: appId,
      studentId,
      newStage:      TRIGGER_STAGE,
      universityName: UNI_NAME,
      universityId:  null,
      actorUserId:   1,
    });

    const sub = await findSub(appId);
    assert.equal(sub, null, "no submission when universityKey not in selectedUniversityKeys");
  } finally {
    // Restore scope=only_applied
    await db.update(portalAutomationSettingsTable)
      .set({ scope: "only_applied", selectedUniversityKeys: [] })
      .where(eq(portalAutomationSettingsTable.id, settingsRowId!));
  }
});

// ---------------------------------------------------------------------------
// TAT4 — dedup: active submission exists → second call skips
// ---------------------------------------------------------------------------
test("TAT4: dedup — skips enqueue when an active submission already exists", async () => {
  const { studentId, appId } = await seedApp();

  // First call → enqueues
  await maybeEnqueuePortalSubmission({
    applicationId: appId,
    studentId,
    newStage:      TRIGGER_STAGE,
    universityName: UNI_NAME,
    universityId:  null,
    actorUserId:   1,
  });
  const first = await findSub(appId);
  assert.ok(first !== null, "first submission created");

  // Second call → dedup kicks in (status=queued counts as active)
  await maybeEnqueuePortalSubmission({
    applicationId: appId,
    studentId,
    newStage:      TRIGGER_STAGE,
    universityName: UNI_NAME,
    universityId:  null,
    actorUserId:   1,
  });

  // Count submissions for this app
  const all = await db
    .select({ id: portalSubmissionsTable.id })
    .from(portalSubmissionsTable)
    .where(
      and(
        eq(portalSubmissionsTable.applicationId, appId),
        eq(portalSubmissionsTable.universityKey, UNI_KEY),
        isNull(portalSubmissionsTable.deletedAt),
      ),
    );
  assert.equal(all.length, 1, "only one submission — dedup prevented duplicate");
});
