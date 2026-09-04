import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { and, count, eq } from "drizzle-orm";
import {
  applicationStageDocumentsTable,
  aiActionQueueTable,
  aiPersonasTable,
  applicationsTable,
  db,
  pipelineStagesTable,
  pool,
  portalSubmissionsTable,
  studentsTable,
} from "@workspace/db";
import { buildPortalStatusArtifact } from "@workspace/portal-adapters";
import { normalizePortalLifecycleObservation } from "../src/lib/portalLifecycleObservation.js";
import { recordPortalLifecycleObservation } from "../src/lib/portalLifecycleObservationStore.js";
import { persistPortalStatusArtifacts } from "../src/lib/portalArtifactIntake.js";
import { PORTAL_GUARDIAN_SLUG } from "../src/lib/portalAiGuardian.js";
import { queuePortalLifecycleReview } from "../src/lib/portalLifecycleGuardian.js";

const tempRoot = await mkdtemp(join(tmpdir(), "fas-portal-artifact-db-"));
const previousDriver = process.env.STORAGE_DRIVER;
const previousDir = process.env.STORAGE_LOCAL_DIR;
process.env.STORAGE_DRIVER = "local";
process.env.STORAGE_LOCAL_DIR = tempRoot;

after(async () => {
  if (previousDriver === undefined) delete process.env.STORAGE_DRIVER;
  else process.env.STORAGE_DRIVER = previousDriver;
  if (previousDir === undefined) delete process.env.STORAGE_LOCAL_DIR;
  else process.env.STORAGE_LOCAL_DIR = previousDir;
  await pool.end();
  await rm(tempRoot, { recursive: true, force: true });
});

test("verified portal artifacts persist once and remain bound to observation, submission and application", async () => {
  const [stage] = await db
    .insert(pipelineStagesTable)
    .values({
      entityType: "application",
      key: "offer_received",
      label: "Offer Received",
      uploadPermissionLevel: "admin_only",
    })
    .onConflictDoNothing()
    .returning({ id: pipelineStagesTable.id });
  const [student] = await db
    .insert(studentsTable)
    .values({ firstName: "Artifact", lastName: "Fixture" })
    .returning({ id: studentsTable.id });
  const [persona] = await db
    .insert(aiPersonasTable)
    .values({
      name: "Artifact Guardian Fixture",
      slug: PORTAL_GUARDIAN_SLUG,
      model: "fixture",
      isActive: true,
    })
    .returning({ id: aiPersonasTable.id });
  try {
    const [application] = await db
      .insert(applicationsTable)
      .values({ studentId: student.id, stage: "submitted" })
      .returning({ id: applicationsTable.id });
    const [otherApplication] = await db
      .insert(applicationsTable)
      .values({ studentId: student.id, stage: "submitted" })
      .returning({ id: applicationsTable.id });
    const [submission] = await db
      .insert(portalSubmissionsTable)
      .values({
        applicationId: application.id,
        studentId: student.id,
        universityKey: "artifact-fixture",
        universityName: "Artifact Fixture",
        adapterKey: "artifact-fixture",
        externalRef: "fixture-ref-42",
        status: "submitted",
      })
      .returning({ id: portalSubmissionsTable.id });
    const observation = normalizePortalLifecycleObservation({
      submissionId: submission.id,
      applicationId: application.id,
      adapterKey: "artifact-fixture",
      result: {
        status: "Conditional Offer",
        identityProof: {
          source: "matched_application_row",
          sourceLabel: "Exact application row",
          identityBound: true,
          targetBound: true,
          uniqueMatch: true,
        },
      },
    });
    const recorded = await recordPortalLifecycleObservation(observation);
    const artifact = buildPortalStatusArtifact({
      kind: "offer_letter",
      fileName: "offer.pdf",
      contentType: "application/pdf",
      bytes: Buffer.from("%PDF-1.7\nfixture\n%%EOF\n", "ascii"),
      sourceLabel: "Offer download control",
      maxBytes: 1024,
    });
    const first = await persistPortalStatusArtifacts({
      submissionId: submission.id,
      applicationId: application.id,
      observationId: recorded.id,
      observationHash: observation.observationHash,
      identityVerified: observation.identityVerified,
      artifacts: [artifact],
    });
    const duplicate = await persistPortalStatusArtifacts({
      submissionId: submission.id,
      applicationId: application.id,
      observationId: recorded.id,
      observationHash: observation.observationHash,
      identityVerified: observation.identityVerified,
      artifacts: [artifact],
    });
    assert.equal(first.length, 1);
    assert.equal(first[0]?.created, true);
    assert.deepEqual(duplicate, [{ ...first[0]!, created: false }]);

    const [stored] = await db
      .select()
      .from(applicationStageDocumentsTable)
      .where(eq(applicationStageDocumentsTable.id, first[0]!.id));
    assert.equal(stored?.uploadedBy, null);
    assert.equal(stored?.uploadedByRole, "portal_automation");
    assert.equal(stored?.sourceType, "portal_automation");
    assert.equal(stored?.sourcePortalObservationId, recorded.id);
    assert.equal(stored?.sourcePortalSubmissionId, submission.id);
    assert.match(stored?.fileUrl ?? "", /^\/objects\/portal-artifacts\/application-\d+\/[0-9a-f]{64}\.pdf$/);

    const [storedCount] = await db
      .select({ value: count() })
      .from(applicationStageDocumentsTable)
      .where(
        and(
          eq(applicationStageDocumentsTable.applicationId, application.id),
          eq(applicationStageDocumentsTable.sourceType, "portal_automation"),
        ),
      );
    assert.equal(storedCount?.value, 1);

    const review = await queuePortalLifecycleReview({
      submissionId: submission.id,
      applicationId: application.id,
      rawStatus: observation.rawStatus,
      observationId: recorded.id,
      observationHash: observation.observationHash,
      identityVerified: observation.identityVerified,
      applicationReferenceSync: "unchanged",
    });
    assert.equal(review.queued, true);
    assert.equal(review.decision?.action, "review_stage_transition");
    assert.equal(review.decision?.targetStage, "offer_received");
    assert.equal(review.decision?.artifactVerified, true);

    await assert.rejects(
      persistPortalStatusArtifacts({
        submissionId: submission.id,
        applicationId: application.id,
        observationId: recorded.id,
        observationHash: observation.observationHash,
        identityVerified: false,
        artifacts: [artifact],
      }),
      /identity_unverified/,
    );
    await assert.rejects(
      persistPortalStatusArtifacts({
        submissionId: submission.id,
        applicationId: otherApplication.id,
        observationId: recorded.id,
        observationHash: observation.observationHash,
        identityVerified: true,
        artifacts: [artifact],
      }),
      /observation_mismatch/,
    );
    await db
      .delete(applicationStageDocumentsTable)
      .where(eq(applicationStageDocumentsTable.id, first[0]!.id));
  } finally {
    await db.delete(aiActionQueueTable).where(eq(aiActionQueueTable.personaId, persona.id));
    await db.delete(aiPersonasTable).where(eq(aiPersonasTable.id, persona.id));
    await db.delete(studentsTable).where(eq(studentsTable.id, student.id));
    if (stage) {
      await db.delete(pipelineStagesTable).where(eq(pipelineStagesTable.id, stage.id));
    }
  }
});
