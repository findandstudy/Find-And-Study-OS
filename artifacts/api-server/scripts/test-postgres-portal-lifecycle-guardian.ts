import assert from "node:assert/strict";
import test, { after } from "node:test";
import { count, eq } from "drizzle-orm";
import {
  aiActionQueueTable,
  aiPersonasTable,
  applicationsTable,
  db,
  pool,
  portalSubmissionsTable,
  portalLifecycleProposalsTable,
  studentsTable,
} from "@workspace/db";
import { queuePortalLifecycleReview } from "../src/lib/portalLifecycleGuardian";
import { PORTAL_GUARDIAN_SLUG } from "../src/lib/portalAiGuardian";
import { normalizePortalLifecycleObservation } from "../src/lib/portalLifecycleObservation";
import { recordPortalLifecycleObservation } from "../src/lib/portalLifecycleObservationStore";
import { planPortalLifecycle } from "../src/lib/portalLifecycleContract";

after(async () => {
  await pool.end();
});

test("an active legacy Guardian remains quarantined; independent proposal storage still deduplicates", async () => {
  const [persona] = await db.insert(aiPersonasTable).values({
    name: "Portal Guardian Fixture",
    slug: PORTAL_GUARDIAN_SLUG,
    model: "fixture",
    isActive: true,
  }).returning({ id: aiPersonasTable.id });
  const [student] = await db.insert(studentsTable).values({
    firstName: "Guardian",
    lastName: "Fixture",
  }).returning({ id: studentsTable.id });

  try {
    const [application] = await db.insert(applicationsTable).values({
      studentId: student.id,
      stage: "submitted",
    }).returning({ id: applicationsTable.id });
    const [submission] = await db.insert(portalSubmissionsTable).values({
      applicationId: application.id,
      studentId: student.id,
      universityKey: "guardian-fixture",
      universityName: "Guardian Fixture",
      adapterKey: "guardian-fixture",
      externalRef: "guardian-ref",
      status: "submitted",
    }).returning({ id: portalSubmissionsTable.id });
    const observation = normalizePortalLifecycleObservation({
      submissionId: submission.id,
      applicationId: application.id,
      adapterKey: "guardian-fixture",
      result: { status: "Missing Documents" },
    });
    const recorded = await recordPortalLifecycleObservation(observation);
    const calls = Array.from({ length: 8 }, () =>
      queuePortalLifecycleReview({
        submissionId: submission.id,
        applicationId: application.id,
        rawStatus: observation.rawStatus,
        observationId: recorded.id,
        observationHash: observation.observationHash,
        identityVerified: observation.identityVerified,
        missingDocuments: observation.missingDocuments,
        applicationReferenceSync: "invalid",
      }),
    );
    const results = await Promise.all(calls);
    for (const result of results) {
      assert.deepEqual(result, {
        queued: false,
        reason: "PERSONA_SCOPE_AND_BUDGET_BINDING_REQUIRED",
      });
    }
    const [blockedProposals] = await db.select({ value: count() })
      .from(portalLifecycleProposalsTable)
      .where(eq(portalLifecycleProposalsTable.applicationId, application.id));
    const [blockedActions] = await db.select({ value: count() })
      .from(aiActionQueueTable)
      .where(eq(aiActionQueueTable.personaId, persona.id));
    assert.equal(blockedProposals?.value, 0);
    assert.equal(blockedActions?.value, 0);
    const [unchanged] = await db.select({ stage: applicationsTable.stage })
      .from(applicationsTable).where(eq(applicationsTable.id, application.id));
    assert.equal(unchanged?.stage, "submitted");

    // Exercise the reviewed database contract directly with synthetic fixture
    // records. This is NOT an authorized Guardian path, an approval, or a bypass.
    const decision = planPortalLifecycle({
      rawStatus: observation.rawStatus,
      currentStage: "submitted",
      identityVerified: observation.identityVerified,
      artifacts: [],
      availableStages: [],
    });
    assert.equal(decision.action, "manual_review");
    const proposalKey = `portal_lifecycle:${observation.observationHash}`;
    const storageCalls = await Promise.all(Array.from({ length: 8 }, () =>
      db.insert(portalLifecycleProposalsTable).values({
        submissionId: submission.id,
        applicationId: application.id,
        observationId: recorded.id,
        proposalKey,
        observationHash: observation.observationHash,
        rawStatus: observation.rawStatus,
        currentStage: "submitted",
        decision,
        status: "pending_review",
        proposedByService: "synthetic-storage-contract-test",
      }).onConflictDoNothing().returning({ id: portalLifecycleProposalsTable.id }),
    ));
    assert.equal(storageCalls.flat().length, 1);

    const [stored] = await db
      .select({ value: count() })
      .from(portalLifecycleProposalsTable)
      .where(
        eq(portalLifecycleProposalsTable.proposalKey, proposalKey),
      );
    assert.equal(stored?.value, 1);
    const [durable] = await db.select().from(portalLifecycleProposalsTable)
      .where(eq(portalLifecycleProposalsTable.proposalKey, proposalKey));
    assert.equal(durable?.id, storageCalls.flat()[0]?.id);
    assert.equal(durable?.observationId, recorded.id);
    assert.equal(durable?.observationHash, observation.observationHash);
    assert.deepEqual(durable?.decision, decision);
    assert.equal(durable?.status, "pending_review");
    assert.equal(durable?.reviewedBy, null);
    assert.equal(durable?.executedAt, null);
  } finally {
    await db.delete(aiPersonasTable).where(eq(aiPersonasTable.id, persona.id));
    await db.delete(studentsTable).where(eq(studentsTable.id, student.id));
  }
});
