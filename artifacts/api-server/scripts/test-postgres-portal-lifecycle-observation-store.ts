import assert from "node:assert/strict";
import test, { after } from "node:test";
import { and, count, eq } from "drizzle-orm";
import {
  applicationsTable,
  db,
  pool,
  portalLifecycleObservationsTable,
  portalSubmissionsTable,
  studentsTable,
} from "@workspace/db";
import { normalizePortalLifecycleObservation } from "../src/lib/portalLifecycleObservation";
import { recordPortalLifecycleObservation } from "../src/lib/portalLifecycleObservationStore";

after(async () => {
  await pool.end();
});

test("portal lifecycle observations deduplicate and stay bound to the submission application", async () => {
  const [student] = await db
    .insert(studentsTable)
    .values({ firstName: "Lifecycle", lastName: "Fixture" })
    .returning({ id: studentsTable.id });
  assert.ok(student);

  try {
    const applications = await db
      .insert(applicationsTable)
      .values([
        { studentId: student.id, stage: "submitted" },
        { studentId: student.id, stage: "submitted" },
      ])
      .returning({ id: applicationsTable.id });
    assert.equal(applications.length, 2);

    const [submission] = await db
      .insert(portalSubmissionsTable)
      .values({
        applicationId: applications[0]!.id,
        studentId: student.id,
        universityKey: "lifecycle-fixture",
        universityName: "Lifecycle Fixture",
        adapterKey: "lifecycle-fixture",
        status: "submitted",
      })
      .returning({ id: portalSubmissionsTable.id });
    assert.ok(submission);

    const normalized = normalizePortalLifecycleObservation({
      submissionId: submission.id,
      applicationId: applications[0]!.id,
      adapterKey: "lifecycle-fixture",
      observedAt: new Date("2026-09-04T12:00:00.000Z"),
      result: {
        status: "Missing Documents",
        identityProof: {
          source: "matched_application_row",
          sourceLabel: "Exact application row",
          identityBound: true,
          targetBound: true,
          uniqueMatch: true,
        },
        missingDocuments: [{ code: "passport", label: "Passport Copy" }],
      },
    });
    const first = await recordPortalLifecycleObservation(normalized);
    const duplicate = await recordPortalLifecycleObservation(normalized);
    assert.equal(first.created, true);
    assert.deepEqual(duplicate, { id: first.id, created: false });

    const [storedCount] = await db
      .select({ value: count() })
      .from(portalLifecycleObservationsTable)
      .where(
        and(
          eq(portalLifecycleObservationsTable.submissionId, submission.id),
          eq(
            portalLifecycleObservationsTable.observationHash,
            normalized.observationHash,
          ),
        ),
      );
    assert.equal(storedCount?.value, 1);

    const wrongApplication = normalizePortalLifecycleObservation({
      ...normalized,
      applicationId: applications[1]!.id,
      result: { status: "Under Review" },
    });
    await assert.rejects(
      recordPortalLifecycleObservation(wrongApplication),
      (error: unknown) => {
        if (!error || typeof error !== "object") return false;
        const candidate = error as {
          code?: string;
          cause?: { code?: string };
        };
        return candidate.code === "23503" || candidate.cause?.code === "23503";
      },
    );
  } finally {
    await db.delete(studentsTable).where(eq(studentsTable.id, student.id));
  }
});
