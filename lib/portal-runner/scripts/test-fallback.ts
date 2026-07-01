/**
 * test-fallback.ts — program-fallback orchestrator (Phase 3)
 *
 * Unit (pure resolver — no DB):
 *   FB-U1 picks the FIRST open candidate (name match)
 *   FB-U2 skips a full/closed candidate, picks the next open one
 *   FB-U3 all full/closed → null
 *   FB-U4 order preserved — first open wins
 *   FB-U5 manual override resolves to a portal value
 *   FB-U6 unresolvable candidate (no match, no override) → null
 *
 * Integration (handleProgramFull — dry-safe, real DB):
 *   FB-I1 kill-switch off → disabled no-op
 *   FB-I2 mode!=real → not_real_mode no-op
 *   FB-I3 no rule → no_rule no-op
 *   FB-I4 happy path → supersede: old cancelled+linked, new app on fallback,
 *         new submission queued (mode=dry when autoSubmit=false), audit + notif
 *   FB-I5 idempotency → second call returns already_superseded, no duplicate
 *   FB-I6 loop guard → chain depth >= 2 → loop_guard no-op
 *   FB-I7 concurrency → exactly one supersession (advisory lock)
 *   FB-I8 wrong status → non-program_full submission never supersedes
 *   FB-I9 fee source → new app fees from fallback CATALOG, NOT copied from source
 *   FB-I10 transaction integrity → injected fault rolls back the WHOLE supersession
 *   FB-I11 disabled rule (enabled=false) → no_rule no-op
 *   FB-I12 empty meta.openPrograms → no_meta no-op
 *   FB-I13 fallback rule pointing at a non-existent program → no_open_fallback
 *   FB-I14 program_missing (not_in_dropdown) → SAME supersession via availablePrograms
 *   FB-I15 program_missing WITHOUT availablePrograms (dropdown unreached) → no_meta no-op
 *   FB-I16 handleProgramFull alias still supersedes a program_full submission
 *
 * Real submission is NEVER triggered — every integration path runs in dry/mock.
 *
 * Run:
 *   pnpm --filter @workspace/portal-runner test:fallback
 */

import { after, test } from "node:test";
import assert from "node:assert/strict";
import {
  db,
  studentsTable,
  usersTable,
  universitiesTable,
  programsTable,
  applicationsTable,
  portalSubmissionsTable,
  portalProgramFallbacksTable,
  portalProgramMappingTable,
  portalAutomationSettingsTable,
  auditLogsTable,
  notificationsTable,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import {
  handleProgramFull,
  handleNeedsFallback,
  selectFallbackCandidate,
  type OpenProgram,
  type FallbackCandidate,
} from "@workspace/portal-runner";

// ---------------------------------------------------------------------------
// Pure-resolver unit tests
// ---------------------------------------------------------------------------

const C = (programId: number, name: string): FallbackCandidate => ({ programId, name });
const O = (value: string, name: string, enabled: boolean): OpenProgram => ({ value, name, enabled });

test("FB-U1: picks the first open candidate (name match)", () => {
  const sel = selectFallbackCandidate(
    [C(1, "Computer Engineering"), C(2, "Medicine")],
    [O("c", "Computer Engineering", true), O("m", "Medicine", true)],
  );
  assert.ok(sel, "a candidate is selected");
  assert.equal(sel!.programId, 1);
  assert.equal(sel!.portalValue, "c");
});

test("FB-U2: skips full candidate, picks the next open one", () => {
  const sel = selectFallbackCandidate(
    [C(1, "Computer Engineering"), C(2, "Medicine")],
    [O("c", "Computer Engineering", false), O("m", "Medicine", true)],
  );
  assert.ok(sel);
  assert.equal(sel!.programId, 2);
  assert.equal(sel!.portalValue, "m");
});

test("FB-U3: every fallback full/closed → null", () => {
  const sel = selectFallbackCandidate(
    [C(1, "Computer Engineering"), C(2, "Medicine")],
    [O("c", "Computer Engineering", false), O("m", "Medicine", false)],
  );
  assert.equal(sel, null);
});

test("FB-U4: order preserved — first open wins even when both open", () => {
  const sel = selectFallbackCandidate(
    [C(1, "Computer Engineering"), C(2, "Medicine")],
    [O("c", "Computer Engineering", true), O("m", "Medicine", true)],
  );
  assert.equal(sel!.programId, 1);
});

test("FB-U5: manual override resolves to a portal value", () => {
  const sel = selectFallbackCandidate(
    [C(99, "Totally Unrelated Catalog Name")],
    [O("x", "Bilgisayar Mühendisliği", true)],
    { programOverrides: { "99": "x" } },
  );
  assert.ok(sel);
  assert.equal(sel!.programId, 99);
  assert.equal(sel!.portalValue, "x");
});

test("FB-U6: unresolvable candidate (no match, no override) → null", () => {
  const sel = selectFallbackCandidate(
    [C(1, "Zzz Unmatchable Qqq")],
    [O("a", "Medicine", true)],
  );
  assert.equal(sel, null);
});

// ---------------------------------------------------------------------------
// Integration helpers
// ---------------------------------------------------------------------------

const RUN = `fb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`;

const cleanupSubIds: number[] = [];
const cleanupAppIds: number[] = [];
const cleanupStudentIds: number[] = [];
const cleanupProgramIds: number[] = [];
const cleanupUniversityIds: number[] = [];
const cleanupUserIds: number[] = [];
const cleanupFallbackIds: number[] = [];
const cleanupMappingIds: number[] = [];
const cleanupAuditIds: number[] = [];

// Restore the global single-row kill-switch to its prior value.
let settingsRowId: number | null = null;
let priorFallbackEnabled: boolean | null = null;

async function setKillSwitch(on: boolean): Promise<void> {
  const [row] = await db
    .select({ id: portalAutomationSettingsTable.id, fb: portalAutomationSettingsTable.fallbackEnabled })
    .from(portalAutomationSettingsTable)
    .limit(1);
  if (row) {
    if (priorFallbackEnabled === null) {
      settingsRowId = row.id;
      priorFallbackEnabled = row.fb;
    }
    await db
      .update(portalAutomationSettingsTable)
      .set({ fallbackEnabled: on })
      .where(eq(portalAutomationSettingsTable.id, row.id));
  } else {
    const [ins] = await db
      .insert(portalAutomationSettingsTable)
      .values({ fallbackEnabled: on })
      .returning({ id: portalAutomationSettingsTable.id });
    settingsRowId = ins.id;
    priorFallbackEnabled = null; // we created it → delete on teardown
  }
}

after(async () => {
  for (const id of cleanupAuditIds)      await db.delete(auditLogsTable).where(eq(auditLogsTable.id, id)).catch(() => {});
  // Notifications cascade with users; delete explicitly anyway via user cleanup.
  for (const id of cleanupSubIds)        await db.delete(portalSubmissionsTable).where(eq(portalSubmissionsTable.id, id)).catch(() => {});
  // Clear supersede self-FKs before deleting applications.
  for (const id of cleanupAppIds)        await db.update(applicationsTable).set({ supersededByApplicationId: null, supersededFromApplicationId: null }).where(eq(applicationsTable.id, id)).catch(() => {});
  for (const id of cleanupAppIds)        await db.delete(applicationsTable).where(eq(applicationsTable.id, id)).catch(() => {});
  for (const id of cleanupFallbackIds)   await db.delete(portalProgramFallbacksTable).where(eq(portalProgramFallbacksTable.id, id)).catch(() => {});
  for (const id of cleanupMappingIds)    await db.delete(portalProgramMappingTable).where(eq(portalProgramMappingTable.id, id)).catch(() => {});
  for (const id of cleanupProgramIds)    await db.delete(programsTable).where(eq(programsTable.id, id)).catch(() => {});
  for (const id of cleanupUniversityIds) await db.delete(universitiesTable).where(eq(universitiesTable.id, id)).catch(() => {});
  for (const id of cleanupStudentIds)    await db.delete(studentsTable).where(eq(studentsTable.id, id)).catch(() => {});
  for (const id of cleanupUserIds)       await db.delete(usersTable).where(eq(usersTable.id, id)).catch(() => {});

  // Restore / remove the settings kill-switch.
  if (settingsRowId !== null) {
    if (priorFallbackEnabled === null) {
      await db.delete(portalAutomationSettingsTable).where(eq(portalAutomationSettingsTable.id, settingsRowId)).catch(() => {});
    } else {
      await db.update(portalAutomationSettingsTable).set({ fallbackEnabled: priorFallbackEnabled }).where(eq(portalAutomationSettingsTable.id, settingsRowId)).catch(() => {});
    }
  }
  setImmediate(() => process.exit(process.exitCode ?? 0));
});

interface Scenario {
  uniKey: string;
  universityId: number;
  sourceProgramId: number;
  fallbackProgramId: number;
  fallbackPortalValue: string;
  studentId: number;
  assignedToId: number;
  srcAppId: number;
  subId: number;
}

/**
 * Seed a full scenario: a source application stuck on a full programme, a
 * fallback rule pointing at an OPEN catalog programme, and a program_full
 * submission carrying the openPrograms meta. Uses a manual override so the
 * fallback resolves deterministically (no fuzzy dependence).
 */
async function seedScenario(opts?: {
  mode?: "dry" | "real";
  autoSubmit?: boolean;
  withRule?: boolean;
  fallbackEnabledMeta?: boolean;
  /**
   * Which structural trigger to seed. "program_full" (default) carries
   * meta.openPrograms; "program_missing" carries meta.availablePrograms +
   * resolution="not_in_dropdown" (program not found in the portal dropdown).
   * Both must drive the SAME supersession flow.
   */
  trigger?: "program_full" | "program_missing";
}): Promise<Scenario> {
  const mode = opts?.mode ?? "real";
  const autoSubmit = opts?.autoSubmit ?? false;
  const withRule = opts?.withRule ?? true;
  const trigger = opts?.trigger ?? "program_full";
  const uniKey = `${RUN}_${Math.random().toString(36).slice(2, 6)}`;

  const [user] = await db.insert(usersTable).values({
    email: `fb_${uniKey}@test.local`,
    role:  "consultant",
  }).returning({ id: usersTable.id });
  cleanupUserIds.push(user.id);

  const uniName = `FB Uni ${uniKey}`;
  const [uni] = await db.insert(universitiesTable).values({
    name:    uniName,
    country: "Turkey",
  }).returning({ id: universitiesTable.id });
  cleanupUniversityIds.push(uni.id);

  const [srcProg] = await db.insert(programsTable).values({
    universityId: uni.id,
    name:         `Source Full Program ${uniKey}`,
    degree:       "bachelor",
    language:     "English",
  }).returning({ id: programsTable.id });
  cleanupProgramIds.push(srcProg.id);

  const [fbProg] = await db.insert(programsTable).values({
    universityId:   uni.id,
    name:           `Fallback Program ${uniKey}`,
    degree:         "bachelor",
    language:       "English",
    tuitionFee:     5000,
    commissionRate: 12,
    currency:       "USD",
  }).returning({ id: programsTable.id });
  cleanupProgramIds.push(fbProg.id);

  const [student] = await db.insert(studentsTable).values({
    firstName: "FB",
    lastName:  `Student_${uniKey}`,
    email:     `fb_student_${uniKey}@test.local`,
  }).returning({ id: studentsTable.id });
  cleanupStudentIds.push(student.id);

  // Sentinel fees on the SOURCE app. The supersession must source the new app's
  // fees from the fallback CATALOG, never copy these — so any of these values
  // showing up on the new app is a regression (see FB-I9).
  const [srcApp] = await db.insert(applicationsTable).values({
    studentId:      student.id,
    programId:      srcProg.id,
    universityId:   uni.id,
    assignedToId:   user.id,
    stage:          "inquiry",
    season:         "2026",
    programName:    srcProg.name,
    universityName: uniName,
    country:        "Turkey",
    tuitionFee:     99999,
    discountedFee:  88888,
    commissionRate: 99,
  }).returning({ id: applicationsTable.id });
  cleanupAppIds.push(srcApp.id);

  const fallbackPortalValue = "fbval";

  if (withRule) {
    const [rule] = await db.insert(portalProgramFallbacksTable).values({
      universityKey:      uniKey,
      sourceProgramId:    srcProg.id,
      fallbackProgramIds: [fbProg.id],
      autoSubmit,
      enabled:            true,
    }).returning({ id: portalProgramFallbacksTable.id });
    cleanupFallbackIds.push(rule.id);

    const [map] = await db.insert(portalProgramMappingTable).values({
      universityKey:    uniKey,
      programOverrides: { [String(fbProg.id)]: fallbackPortalValue },
    }).returning({ id: portalProgramMappingTable.id });
    cleanupMappingIds.push(map.id);
  }

  // program_full → meta.openPrograms; program_missing → meta.availablePrograms
  // + resolution="not_in_dropdown". Both list the same two options so the
  // fallback resolves identically to the OPEN programme.
  const optionList = [
    { value: "src",               name: srcProg.name, enabled: false },
    { value: fallbackPortalValue, name: fbProg.name,  enabled: true  },
  ];
  const meta =
    trigger === "program_missing"
      ? {
          requestedProgram:  { name: srcProg.name },
          availablePrograms: optionList,
          resolution:        "not_in_dropdown",
          reason:            "Program portalda bulunamadı",
          detectedAt:        new Date().toISOString(),
        }
      : {
          requestedProgram: { value: "src", name: srcProg.name },
          openPrograms:     optionList,
          reason:           "Kontenjan dolu",
          detectedAt:       new Date().toISOString(),
        };

  const [sub] = await db.insert(portalSubmissionsTable).values({
    applicationId:  srcApp.id,
    studentId:      student.id,
    universityKey:  uniKey,
    universityName: uniName,
    mode,
    status:         trigger,
    meta,
  }).returning({ id: portalSubmissionsTable.id });
  cleanupSubIds.push(sub.id);

  return {
    uniKey,
    universityId: uni.id,
    sourceProgramId: srcProg.id,
    fallbackProgramId: fbProg.id,
    fallbackPortalValue,
    studentId: student.id,
    assignedToId: user.id,
    srcAppId: srcApp.id,
    subId: sub.id,
  };
}

// ---------------------------------------------------------------------------
// FB-I1 — kill-switch off
// ---------------------------------------------------------------------------

test("FB-I1: kill-switch off → disabled no-op", async () => {
  await setKillSwitch(false);
  const s = await seedScenario();
  const outcome = await handleProgramFull(s.subId);
  assert.equal(outcome.status, "disabled");

  const [app] = await db.select({ stage: applicationsTable.stage }).from(applicationsTable).where(eq(applicationsTable.id, s.srcAppId));
  assert.equal(app.stage, "inquiry", "source app untouched");
});

// ---------------------------------------------------------------------------
// FB-I2 — non-real mode
// ---------------------------------------------------------------------------

test("FB-I2: mode!=real → not_real_mode no-op", async () => {
  await setKillSwitch(true);
  const s = await seedScenario({ mode: "dry" });
  const outcome = await handleProgramFull(s.subId);
  assert.equal(outcome.status, "not_real_mode");
});

// ---------------------------------------------------------------------------
// FB-I3 — no rule
// ---------------------------------------------------------------------------

test("FB-I3: no fallback rule → no_rule no-op", async () => {
  await setKillSwitch(true);
  const s = await seedScenario({ withRule: false });
  const outcome = await handleProgramFull(s.subId);
  assert.equal(outcome.status, "no_rule");
});

// ---------------------------------------------------------------------------
// FB-I4 — happy path
// ---------------------------------------------------------------------------

test("FB-I4: happy path → supersede old, create new app + queued submission", async () => {
  await setKillSwitch(true);
  const s = await seedScenario({ autoSubmit: false });
  const outcome = await handleProgramFull(s.subId);

  assert.equal(outcome.status, "superseded");
  if (outcome.status !== "superseded") return;
  cleanupAppIds.push(outcome.newApplicationId);
  cleanupSubIds.push(outcome.newSubmissionId);
  assert.equal(outcome.fallbackProgramId, s.fallbackProgramId);

  // Old app cancelled + linked forward.
  const [oldApp] = await db.select().from(applicationsTable).where(eq(applicationsTable.id, s.srcAppId));
  assert.equal(oldApp.stage, "cancelled", "old app cancelled");
  assert.equal(oldApp.supersededByApplicationId, outcome.newApplicationId, "old app links to new");
  assert.ok(oldApp.supersedeReason, "supersede reason recorded");

  // New app on the fallback programme, linked back, fees from catalog.
  const [newApp] = await db.select().from(applicationsTable).where(eq(applicationsTable.id, outcome.newApplicationId));
  assert.equal(newApp.programId, s.fallbackProgramId, "new app on fallback program");
  assert.equal(newApp.supersededFromApplicationId, s.srcAppId, "new app links back to old");
  assert.equal(newApp.stage, "inquiry", "new app enters normal flow");
  assert.equal(newApp.assignedToId, s.assignedToId, "assignee carried over");
  assert.equal(newApp.tuitionFee, 5000, "tuition from fallback catalog");
  assert.equal(newApp.commissionRate, 12, "commission from fallback catalog");

  // New submission queued; autoSubmit=false → mode=dry.
  const [newSub] = await db.select().from(portalSubmissionsTable).where(eq(portalSubmissionsTable.id, outcome.newSubmissionId));
  assert.equal(newSub.status, "queued", "new submission queued");
  assert.equal(newSub.mode, "dry", "autoSubmit=false → dry mode");
  assert.equal(newSub.applicationId, outcome.newApplicationId, "submission points at new app");
  assert.equal((newSub.meta as { note?: string })?.note, `auto-fallback from #${s.srcAppId}`, "meta.note set");

  // Audit row.
  const audit = await db.select().from(auditLogsTable).where(
    and(eq(auditLogsTable.action, "program_fallback_supersede"), eq(auditLogsTable.resourceId, s.srcAppId)),
  );
  assert.equal(audit.length, 1, "one audit row written");
  audit.forEach((a) => cleanupAuditIds.push(a.id));

  // Notification to the assigned consultant.
  const notifs = await db.select().from(notificationsTable).where(eq(notificationsTable.userId, s.assignedToId));
  assert.ok(notifs.some((n) => n.type === "program_fallback"), "consultant notified");
});

// ---------------------------------------------------------------------------
// FB-I5 — idempotency
// ---------------------------------------------------------------------------

test("FB-I5: second call is idempotent (already_superseded, no duplicate)", async () => {
  await setKillSwitch(true);
  const s = await seedScenario({ autoSubmit: false });

  const first = await handleProgramFull(s.subId);
  assert.equal(first.status, "superseded");
  if (first.status !== "superseded") return;
  cleanupAppIds.push(first.newApplicationId);
  cleanupSubIds.push(first.newSubmissionId);

  const second = await handleProgramFull(s.subId);
  assert.equal(second.status, "already_superseded");
  if (second.status === "already_superseded") {
    assert.equal(second.newApplicationId, first.newApplicationId, "points at the same new app");
  }

  // Exactly one superseding application exists.
  const dupes = await db.select({ id: applicationsTable.id }).from(applicationsTable).where(
    and(eq(applicationsTable.supersededFromApplicationId, s.srcAppId), eq(applicationsTable.programId, s.fallbackProgramId)),
  );
  assert.equal(dupes.length, 1, "no duplicate supersession");

  const audit = await db.select().from(auditLogsTable).where(
    and(eq(auditLogsTable.action, "program_fallback_supersede"), eq(auditLogsTable.resourceId, s.srcAppId)),
  );
  audit.forEach((a) => cleanupAuditIds.push(a.id));
});

// ---------------------------------------------------------------------------
// FB-I6 — loop guard
// ---------------------------------------------------------------------------

test("FB-I6: chain depth >= 2 → loop_guard no-op", async () => {
  await setKillSwitch(true);
  const s = await seedScenario({ autoSubmit: false });

  // Build a supersession chain leading INTO the source app (depth 2):
  //   gpA → gpB → srcApp
  const [gpA] = await db.insert(applicationsTable).values({
    studentId: s.studentId, stage: "cancelled", season: "2026",
  }).returning({ id: applicationsTable.id });
  cleanupAppIds.push(gpA.id);
  const [gpB] = await db.insert(applicationsTable).values({
    studentId: s.studentId, stage: "cancelled", season: "2026",
    supersededFromApplicationId: gpA.id,
  }).returning({ id: applicationsTable.id });
  cleanupAppIds.push(gpB.id);
  await db.update(applicationsTable).set({ supersededFromApplicationId: gpB.id }).where(eq(applicationsTable.id, s.srcAppId));

  const outcome = await handleProgramFull(s.subId);
  assert.equal(outcome.status, "loop_guard");
});

// ---------------------------------------------------------------------------
// FB-I7 — concurrent invocations create exactly one supersession
// ---------------------------------------------------------------------------

test("FB-I7: concurrent calls → exactly one supersession (advisory lock)", async () => {
  await setKillSwitch(true);
  const s = await seedScenario({ autoSubmit: false });

  const [a, b] = await Promise.all([
    handleProgramFull(s.subId),
    handleProgramFull(s.subId),
  ]);

  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, ["already_superseded", "superseded"], "one supersedes, one no-ops");

  for (const o of [a, b]) {
    if (o.status === "superseded") {
      cleanupAppIds.push(o.newApplicationId);
      cleanupSubIds.push(o.newSubmissionId);
    }
  }

  // Exactly one superseding application exists for the source app.
  const children = await db.select({ id: applicationsTable.id }).from(applicationsTable).where(
    eq(applicationsTable.supersededFromApplicationId, s.srcAppId),
  );
  assert.equal(children.length, 1, "no duplicate supersession under concurrency");

  const audit = await db.select().from(auditLogsTable).where(
    and(eq(auditLogsTable.action, "program_fallback_supersede"), eq(auditLogsTable.resourceId, s.srcAppId)),
  );
  audit.forEach((x) => cleanupAuditIds.push(x.id));
  assert.equal(audit.length, 1, "exactly one audit row");
});

// ---------------------------------------------------------------------------
// FB-I8 — non-program_full submission never supersedes
// ---------------------------------------------------------------------------

test("FB-I8: submission status != program_full → wrong_status no-op", async () => {
  await setKillSwitch(true);
  const s = await seedScenario({ autoSubmit: false });

  // Flip the seeded submission out of program_full.
  await db.update(portalSubmissionsTable)
    .set({ status: "submitted" })
    .where(eq(portalSubmissionsTable.id, s.subId));

  const outcome = await handleProgramFull(s.subId);
  assert.equal(outcome.status, "wrong_status");

  const children = await db.select({ id: applicationsTable.id }).from(applicationsTable).where(
    eq(applicationsTable.supersededFromApplicationId, s.srcAppId),
  );
  assert.equal(children.length, 0, "no supersession for non-program_full submission");
});

// ---------------------------------------------------------------------------
// FB-I9 — fees come from the fallback catalog, never copied from the source app
// ---------------------------------------------------------------------------

test("FB-I9: new app fees from fallback catalog, NOT copied from source", async () => {
  await setKillSwitch(true);
  // Source app carries sentinel fees (99999 / 88888 / 99); the fallback CATALOG
  // program has tuition 5000, commission 12 and NO discounted fee.
  const s = await seedScenario({ autoSubmit: false });
  const outcome = await handleProgramFull(s.subId);

  assert.equal(outcome.status, "superseded");
  if (outcome.status !== "superseded") return;
  cleanupAppIds.push(outcome.newApplicationId);
  cleanupSubIds.push(outcome.newSubmissionId);

  const [newApp] = await db.select().from(applicationsTable).where(eq(applicationsTable.id, outcome.newApplicationId));

  // Sourced from the fallback catalog…
  assert.equal(newApp.tuitionFee, 5000, "tuition from fallback catalog");
  assert.equal(newApp.commissionRate, 12, "commission from fallback catalog");
  // …catalog gap stays null rather than inheriting the source's discounted fee.
  assert.equal(newApp.discountedFee, null, "missing catalog fee stays null, not copied");

  // …and explicitly NOT the source app's sentinel values.
  assert.notEqual(newApp.tuitionFee, 99999, "tuition not copied from source");
  assert.notEqual(newApp.discountedFee, 88888, "discounted fee not copied from source");
  assert.notEqual(newApp.commissionRate, 99, "commission not copied from source");

  const audit = await db.select().from(auditLogsTable).where(
    and(eq(auditLogsTable.action, "program_fallback_supersede"), eq(auditLogsTable.resourceId, s.srcAppId)),
  );
  audit.forEach((a) => cleanupAuditIds.push(a.id));
});

// ---------------------------------------------------------------------------
// FB-I10 — transaction integrity: an injected fault rolls back EVERYTHING
// ---------------------------------------------------------------------------

test("FB-I10: injected fault mid-supersession rolls back the whole transaction", async () => {
  await setKillSwitch(true);
  const s = await seedScenario({ autoSubmit: false });

  // Inject a deterministic fault that fires on the NEW submission INSERT (step d
  // of the supersession tx) for THIS scenario only. By then the old app has been
  // cancelled and the new app inserted within the same tx — so if rollback is not
  // atomic those partial writes would survive.
  // fn/trg names are derived from the numeric submission id, and uniKey is
  // generated as alphanumeric+underscore only, so both are safe to inline. DDL
  // with a dollar-quoted body can't carry a bound parameter, so use sql.raw.
  const fn = `fb_test_fail_${s.subId}`;
  const trg = `fb_test_trg_${s.subId}`;
  await db.execute(sql.raw(`
    CREATE FUNCTION ${fn}() RETURNS trigger AS $$
    BEGIN
      IF NEW.university_key = '${s.uniKey}' THEN
        RAISE EXCEPTION 'injected fault for rollback test';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `));
  await db.execute(sql.raw(`
    CREATE TRIGGER ${trg} BEFORE INSERT ON portal_submissions
    FOR EACH ROW EXECUTE FUNCTION ${fn}();
  `));

  try {
    await assert.rejects(
      () => handleProgramFull(s.subId),
      // drizzle wraps the DB error as "Failed query: …" and carries the real
      // RAISE EXCEPTION text on `.cause`, so check the whole error chain.
      (err: unknown) => {
        const top = String((err as Error)?.message ?? "");
        const cause = String(((err as { cause?: Error })?.cause)?.message ?? "");
        return /injected fault for rollback test/.test(top + cause);
      },
      "supersession must propagate the injected fault",
    );

    // Old app must be fully intact — NOT cancelled, NOT linked forward.
    const [oldApp] = await db.select().from(applicationsTable).where(eq(applicationsTable.id, s.srcAppId));
    assert.equal(oldApp.stage, "inquiry", "rollback: old app stage unchanged");
    assert.equal(oldApp.supersededByApplicationId, null, "rollback: no forward link");
    assert.equal(oldApp.supersedeReason, null, "rollback: no supersede reason");

    // No new application, submission, or audit row leaked from the aborted tx.
    const children = await db.select({ id: applicationsTable.id }).from(applicationsTable).where(
      eq(applicationsTable.supersededFromApplicationId, s.srcAppId),
    );
    assert.equal(children.length, 0, "rollback: no orphan new application");

    // Explicit: the in-tx new-submission insert (the faulting statement) left no
    // row behind for this scenario beyond the original program_full one.
    const subs = await db.select({ id: portalSubmissionsTable.id }).from(portalSubmissionsTable).where(
      eq(portalSubmissionsTable.universityKey, s.uniKey),
    );
    assert.equal(subs.length, 1, "rollback: only the original submission survives");
    assert.equal(subs[0].id, s.subId, "rollback: surviving submission is the seeded one");

    const audit = await db.select({ id: auditLogsTable.id }).from(auditLogsTable).where(
      and(eq(auditLogsTable.action, "program_fallback_supersede"), eq(auditLogsTable.resourceId, s.srcAppId)),
    );
    assert.equal(audit.length, 0, "rollback: no audit row written");
  } finally {
    await db.execute(sql`DROP TRIGGER IF EXISTS ${sql.raw(trg)} ON portal_submissions`);
    await db.execute(sql`DROP FUNCTION IF EXISTS ${sql.raw(fn)}()`);
  }
});

// ---------------------------------------------------------------------------
// FB-I11 — a disabled rule (enabled=false) is ignored
// ---------------------------------------------------------------------------

test("FB-I11: disabled fallback rule → no_rule no-op", async () => {
  await setKillSwitch(true);
  const s = await seedScenario({ autoSubmit: false });

  // Disable the seeded rule.
  await db.update(portalProgramFallbacksTable)
    .set({ enabled: false })
    .where(eq(portalProgramFallbacksTable.sourceProgramId, s.sourceProgramId));

  const outcome = await handleProgramFull(s.subId);
  assert.equal(outcome.status, "no_rule");

  const [app] = await db.select({ stage: applicationsTable.stage }).from(applicationsTable).where(eq(applicationsTable.id, s.srcAppId));
  assert.equal(app.stage, "inquiry", "disabled rule leaves source app untouched");
});

// ---------------------------------------------------------------------------
// FB-I12 — empty meta.openPrograms short-circuits before any rule lookup
// ---------------------------------------------------------------------------

test("FB-I12: empty meta.openPrograms → no_meta no-op", async () => {
  await setKillSwitch(true);
  const s = await seedScenario({ autoSubmit: false });

  await db.update(portalSubmissionsTable)
    .set({ meta: { openPrograms: [], reason: "Kontenjan dolu" } })
    .where(eq(portalSubmissionsTable.id, s.subId));

  const outcome = await handleProgramFull(s.subId);
  assert.equal(outcome.status, "no_meta");
});

// ---------------------------------------------------------------------------
// FB-I13 — a rule pointing only at a non-existent program resolves to nothing
// ---------------------------------------------------------------------------

test("FB-I13: rule with only a non-existent fallback program → no_open_fallback", async () => {
  await setKillSwitch(true);
  const s = await seedScenario({ autoSubmit: false });

  // Repoint the rule at a program id that doesn't exist in the catalog.
  await db.update(portalProgramFallbacksTable)
    .set({ fallbackProgramIds: [999_000_001] })
    .where(eq(portalProgramFallbacksTable.sourceProgramId, s.sourceProgramId));

  const outcome = await handleProgramFull(s.subId);
  assert.equal(outcome.status, "no_open_fallback");

  const children = await db.select({ id: applicationsTable.id }).from(applicationsTable).where(
    eq(applicationsTable.supersededFromApplicationId, s.srcAppId),
  );
  assert.equal(children.length, 0, "no supersession when no real fallback program resolves");
});

// ---------------------------------------------------------------------------
// FB-I14 — "not in dropdown" (program_missing) drives the SAME supersession
// ---------------------------------------------------------------------------

test("FB-I14: program_missing (not_in_dropdown) → supersede via availablePrograms", async () => {
  await setKillSwitch(true);
  const s = await seedScenario({ autoSubmit: false, trigger: "program_missing" });
  const outcome = await handleNeedsFallback(s.subId);

  assert.equal(outcome.status, "superseded");
  if (outcome.status !== "superseded") return;
  cleanupAppIds.push(outcome.newApplicationId);
  cleanupSubIds.push(outcome.newSubmissionId);
  assert.equal(outcome.fallbackProgramId, s.fallbackProgramId);

  // Old app cancelled + linked forward.
  const [oldApp] = await db.select().from(applicationsTable).where(eq(applicationsTable.id, s.srcAppId));
  assert.equal(oldApp.stage, "cancelled", "old app cancelled");
  assert.equal(oldApp.supersededByApplicationId, outcome.newApplicationId, "old app links to new");

  // New app on the fallback programme with catalog fees.
  const [newApp] = await db.select().from(applicationsTable).where(eq(applicationsTable.id, outcome.newApplicationId));
  assert.equal(newApp.programId, s.fallbackProgramId, "new app on fallback program");
  assert.equal(newApp.supersededFromApplicationId, s.srcAppId, "new app links back to old");
  assert.equal(newApp.tuitionFee, 5000, "tuition from fallback catalog");

  const audit = await db.select().from(auditLogsTable).where(
    and(eq(auditLogsTable.action, "program_fallback_supersede"), eq(auditLogsTable.resourceId, s.srcAppId)),
  );
  assert.equal(audit.length, 1, "one audit row written");
  audit.forEach((a) => cleanupAuditIds.push(a.id));

  const notifs = await db.select().from(notificationsTable).where(eq(notificationsTable.userId, s.assignedToId));
  assert.ok(notifs.some((n) => n.type === "program_fallback"), "consultant notified");
});

// ---------------------------------------------------------------------------
// FB-I15 — program_missing with NO availablePrograms (dropdown unreached) no-ops
// ---------------------------------------------------------------------------

test("FB-I15: program_missing without availablePrograms → no_meta no-op", async () => {
  await setKillSwitch(true);
  const s = await seedScenario({ autoSubmit: false, trigger: "program_missing" });

  // Dropdown never reached → alternatives unknown. Must NOT guess a fallback.
  await db.update(portalSubmissionsTable)
    .set({ meta: { reason: "Program bulunamadı" } })
    .where(eq(portalSubmissionsTable.id, s.subId));

  const outcome = await handleNeedsFallback(s.subId);
  assert.equal(outcome.status, "no_meta");

  const [app] = await db.select({ stage: applicationsTable.stage }).from(applicationsTable).where(eq(applicationsTable.id, s.srcAppId));
  assert.equal(app.stage, "inquiry", "source app untouched when alternatives unknown");
});

// ---------------------------------------------------------------------------
// FB-I16 — handleProgramFull alias still routes program_full (regression)
// ---------------------------------------------------------------------------

test("FB-I16: handleProgramFull alias still supersedes a program_full submission", async () => {
  await setKillSwitch(true);
  const s = await seedScenario({ autoSubmit: false, trigger: "program_full" });
  const outcome = await handleProgramFull(s.subId);

  assert.equal(outcome.status, "superseded", "alias preserves quota-full behavior");
  if (outcome.status !== "superseded") return;
  cleanupAppIds.push(outcome.newApplicationId);
  cleanupSubIds.push(outcome.newSubmissionId);
  assert.equal(outcome.fallbackProgramId, s.fallbackProgramId);
});
