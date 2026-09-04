import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import {
  aiActionQueueTable,
  aiPersonasTable,
  applicationStageDocumentsTable,
  applicationsTable,
  db,
  pipelineStagesTable,
} from "@workspace/db";
import {
  planPortalLifecycle,
  type PortalLifecycleArtifact,
  type PortalLifecycleDecision,
} from "./portalLifecycleContract";
import { PORTAL_GUARDIAN_SLUG } from "./portalAiGuardian";
import type { PortalApplicationReferenceSyncOutcome } from "./portalApplicationReferenceSync";

export const PORTAL_LIFECYCLE_ACTION = "portal_lifecycle_proposal";

const documentStageToArtifact: Record<string, PortalLifecycleArtifact> = {
  offer_received: "offer_letter",
  upload_payment: "deposit_receipt",
  acceptance_letter: "acceptance_letter",
  final_acceptance: "final_acceptance",
  student_card: "student_card",
};

function proposalFingerprint(input: {
  submissionId: number;
  applicationId: number;
  rawStatus: string;
  currentStage: string;
  artifacts: PortalLifecycleArtifact[];
  decision: PortalLifecycleDecision;
  observationHash: string;
  applicationReferenceSync?: PortalApplicationReferenceSyncOutcome;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        submissionId: input.submissionId,
        applicationId: input.applicationId,
        rawStatus: input.rawStatus.trim().toLowerCase(),
        currentStage: input.currentStage,
        artifacts: [...input.artifacts].sort(),
        signal: input.decision.signal,
        action: input.decision.action,
        targetStage: input.decision.targetStage,
        observationHash: input.observationHash,
        applicationReferenceSync: input.applicationReferenceSync ?? null,
      }),
    )
    .digest("hex");
}

/**
 * Creates one idempotent Approval Queue item from a portal status change.
 * This path is intentionally deterministic and does not invoke an LLM. It
 * never changes a CRM stage, sends a message, forwards a payment, or mutates a
 * university portal.
 */
export async function queuePortalLifecycleReview(input: {
  submissionId: number;
  applicationId: number;
  rawStatus: string;
  observationId: number;
  observationHash: string;
  identityVerified: boolean;
  missingDocuments?: Array<{ code?: string; label: string }>;
  applicationReferenceSync?: PortalApplicationReferenceSyncOutcome;
}): Promise<{
  queued: boolean;
  actionId?: number;
  reason?: string;
  decision?: PortalLifecycleDecision;
}> {
  const [persona] = await db
    .select({ id: aiPersonasTable.id })
    .from(aiPersonasTable)
    .where(
      and(
        eq(aiPersonasTable.slug, PORTAL_GUARDIAN_SLUG),
        eq(aiPersonasTable.isActive, true),
      ),
    )
    .limit(1);
  if (!persona) return { queued: false, reason: "GUARDIAN_INACTIVE" };

  const [application] = await db
    .select({ stage: applicationsTable.stage })
    .from(applicationsTable)
    .where(
      and(
        eq(applicationsTable.id, input.applicationId),
        isNull(applicationsTable.deletedAt),
      ),
    )
    .limit(1);
  if (!application) {
    return { queued: false, reason: "APPLICATION_NOT_FOUND" };
  }

  const docs = await db
    .select({
      stage: applicationStageDocumentsTable.stage,
      fileData: applicationStageDocumentsTable.fileData,
      fileUrl: applicationStageDocumentsTable.fileUrl,
      isMissingDocNote: applicationStageDocumentsTable.isMissingDocNote,
    })
    .from(applicationStageDocumentsTable)
    .where(eq(applicationStageDocumentsTable.applicationId, input.applicationId));
  const stageRows = await db
    .select({ key: pipelineStagesTable.key })
    .from(pipelineStagesTable)
    .where(eq(pipelineStagesTable.entityType, "application"));
  const artifacts = [
    ...new Set(
      docs
        .filter(
          (doc) =>
            !doc.isMissingDocNote &&
            Boolean(doc.fileData || doc.fileUrl) &&
            documentStageToArtifact[doc.stage],
        )
        .map((doc) => documentStageToArtifact[doc.stage]),
    ),
  ];
  const plannedDecision = planPortalLifecycle({
    rawStatus: input.rawStatus,
    currentStage: application.stage,
    identityVerified: input.identityVerified,
    artifacts,
    availableStages: stageRows.map((stage) => stage.key),
  });
  const referenceConflict =
    input.applicationReferenceSync === "conflict" ||
    input.applicationReferenceSync === "concurrent_conflict";
  const decision: PortalLifecycleDecision = referenceConflict
    ? {
        ...plannedDecision,
        targetStage: null,
        action: "manual_review",
        requiredArtifact: null,
        artifactVerified: false,
        proposeStudentNotification: false,
        proposeUniversityForward: false,
        humanApprovalRequired: true,
        reason:
          "The portal's verified application number conflicts with the current Application tab value.",
      }
    : plannedDecision;
  if (decision.action === "none") {
    return { queued: false, reason: "NO_ACTION", decision };
  }

  const fingerprint = proposalFingerprint({
    ...input,
    currentStage: application.stage,
    artifacts,
    decision,
    observationHash: input.observationHash,
  });
  const idempotencyKey = `portal_lifecycle:${fingerprint}`;

  const [action] = await db
    .insert(aiActionQueueTable)
    .values({
      personaId: persona.id,
      actionType: PORTAL_LIFECYCLE_ACTION,
      idempotencyKey,
      payload: {
        context: {
          submissionId: input.submissionId,
          applicationId: input.applicationId,
          observationId: input.observationId,
          observationHash: input.observationHash,
          fingerprint,
          reviewOnly: true,
        },
        portalStatus: input.rawStatus.slice(0, 250),
        currentStage: application.stage,
        artifacts,
        missingDocuments: input.missingDocuments ?? [],
        applicationReferenceSync: input.applicationReferenceSync ?? null,
        decision,
      },
      preview: decision.reason.slice(0, 400),
      status: "pending_approval",
    })
    .onConflictDoNothing()
    .returning({ id: aiActionQueueTable.id });
  if (action) return { queued: true, actionId: action.id, decision };

  const [duplicate] = await db
    .select({ id: aiActionQueueTable.id })
    .from(aiActionQueueTable)
    .where(eq(aiActionQueueTable.idempotencyKey, idempotencyKey))
    .limit(1);
  return {
    queued: false,
    actionId: duplicate?.id,
    reason: "ALREADY_QUEUED",
    decision,
  };
}
