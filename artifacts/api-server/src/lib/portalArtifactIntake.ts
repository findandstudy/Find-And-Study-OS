import { createHash } from "node:crypto";
import { and, eq, isNotNull, or } from "drizzle-orm";
import {
  applicationStageDocumentsTable,
  db,
  pipelineStagesTable,
  portalLifecycleObservationsTable,
} from "@workspace/db";
import type {
  PortalStatusArtifact,
  PortalStatusArtifactKind,
} from "@workspace/portal-adapters";
import { ObjectStorageService } from "./objectStorage";

const MAX_PORTAL_ARTIFACT_BYTES = 15 * 1024 * 1024;

const artifactStage: Record<PortalStatusArtifactKind, string> = {
  offer_letter: "offer_received",
  deposit_receipt: "upload_payment",
  acceptance_letter: "acceptance_letter",
  final_acceptance: "final_acceptance",
  student_card: "student_card",
};

export async function hasStoredPortalLifecycleArtifact(
  applicationId: number,
  kind: PortalStatusArtifactKind,
): Promise<boolean> {
  if (!Number.isSafeInteger(applicationId) || applicationId <= 0) {
    throw new Error("application_id_invalid");
  }
  const [row] = await db
    .select({ id: applicationStageDocumentsTable.id })
    .from(applicationStageDocumentsTable)
    .where(
      and(
        eq(applicationStageDocumentsTable.applicationId, applicationId),
        eq(applicationStageDocumentsTable.stage, artifactStage[kind]),
        eq(applicationStageDocumentsTable.isMissingDocNote, false),
        or(
          isNotNull(applicationStageDocumentsTable.fileData),
          isNotNull(applicationStageDocumentsTable.fileUrl),
        ),
      ),
    )
    .limit(1);
  return Boolean(row);
}

const artifactExtension: Record<PortalStatusArtifact["contentType"], ".pdf" | ".jpg" | ".png"> = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/png": ".png",
};

function hasExpectedMagic(artifact: PortalStatusArtifact): boolean {
  const bytes = artifact.bytes;
  if (artifact.contentType === "application/pdf") {
    return bytes.length >= 5 && Buffer.from(bytes.subarray(0, 5)).toString("ascii") === "%PDF-";
  }
  if (artifact.contentType === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  return (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  );
}

export function validatePortalArtifactForStorage(artifact: PortalStatusArtifact): {
  buffer: Buffer;
  sha256: string;
  stage: string;
  extension: ".pdf" | ".jpg" | ".png";
  fileName: string;
} {
  if (!(artifact.bytes instanceof Uint8Array)) throw new Error("portal_artifact_bytes_invalid");
  if (artifact.bytes.byteLength < 5 || artifact.bytes.byteLength > MAX_PORTAL_ARTIFACT_BYTES) {
    throw new Error("portal_artifact_size_invalid");
  }
  if (!(artifact.contentType in artifactExtension) || !hasExpectedMagic(artifact)) {
    throw new Error("portal_artifact_content_mismatch");
  }
  const sourceLabel = artifact.sourceLabel.replace(/\s+/g, " ").trim();
  if (!sourceLabel || sourceLabel.length > 160 || /[\u0000-\u001f\u007f]/u.test(sourceLabel)) {
    throw new Error("portal_artifact_source_invalid");
  }
  const extension = artifactExtension[artifact.contentType];
  const safeName = artifact.fileName
    .replaceAll("\\", "/")
    .split("/")
    .pop()!
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 160);
  const fileName = safeName.toLocaleLowerCase("en").endsWith(extension)
    ? safeName
    : `portal-${artifact.kind}${extension}`;
  const buffer = Buffer.from(artifact.bytes);
  return {
    buffer,
    sha256: createHash("sha256").update(buffer).digest("hex"),
    stage: artifactStage[artifact.kind],
    extension,
    fileName,
  };
}

export async function persistPortalStatusArtifacts(input: {
  submissionId: number;
  applicationId: number;
  observationId: number;
  observationHash: string;
  identityVerified: boolean;
  artifacts: PortalStatusArtifact[];
}): Promise<Array<{ id: number; kind: PortalStatusArtifactKind; created: boolean }>> {
  if (input.identityVerified !== true) throw new Error("portal_artifact_identity_unverified");
  for (const [name, value] of [
    ["submission_id", input.submissionId],
    ["application_id", input.applicationId],
    ["observation_id", input.observationId],
  ] as const) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name}_invalid`);
  }
  if (!/^[0-9a-f]{64}$/.test(input.observationHash)) {
    throw new Error("observation_hash_invalid");
  }
  if (input.artifacts.length > 5) throw new Error("portal_artifacts_too_many");
  const [boundObservation] = await db
    .select({ id: portalLifecycleObservationsTable.id })
    .from(portalLifecycleObservationsTable)
    .where(
      and(
        eq(portalLifecycleObservationsTable.id, input.observationId),
        eq(portalLifecycleObservationsTable.submissionId, input.submissionId),
        eq(portalLifecycleObservationsTable.applicationId, input.applicationId),
        eq(portalLifecycleObservationsTable.observationHash, input.observationHash),
        eq(portalLifecycleObservationsTable.identityVerified, true),
      ),
    )
    .limit(1);
  if (!boundObservation) throw new Error("portal_artifact_observation_mismatch");
  const seenKinds = new Set<PortalStatusArtifactKind>();
  const storage = new ObjectStorageService();
  const outcomes: Array<{ id: number; kind: PortalStatusArtifactKind; created: boolean }> = [];

  for (const artifact of input.artifacts) {
    if (seenKinds.has(artifact.kind)) throw new Error("portal_artifact_kind_duplicate");
    seenKinds.add(artifact.kind);
    const validated = validatePortalArtifactForStorage(artifact);
    const [stage] = await db
      .select({ key: pipelineStagesTable.key })
      .from(pipelineStagesTable)
      .where(
        and(
          eq(pipelineStagesTable.entityType, "application"),
          eq(pipelineStagesTable.key, validated.stage),
        ),
      )
      .limit(1);
    if (!stage) throw new Error("portal_artifact_stage_unavailable");

    const existingWhere = and(
      eq(applicationStageDocumentsTable.applicationId, input.applicationId),
      eq(applicationStageDocumentsTable.sourcePortalSubmissionId, input.submissionId),
      eq(applicationStageDocumentsTable.stage, validated.stage),
      eq(applicationStageDocumentsTable.sourceContentSha256, validated.sha256),
      eq(applicationStageDocumentsTable.sourceType, "portal_automation"),
    );
    const [existing] = await db
      .select({ id: applicationStageDocumentsTable.id })
      .from(applicationStageDocumentsTable)
      .where(existingWhere)
      .limit(1);
    if (existing) {
      outcomes.push({ id: existing.id, kind: artifact.kind, created: false });
      continue;
    }

    const objectPath = await storage.uploadContentAddressedBuffer({
      subdir: `portal-artifacts/application-${input.applicationId}`,
      contentSha256: validated.sha256,
      buffer: validated.buffer,
      contentType: artifact.contentType,
      extension: validated.extension,
    });
    const [inserted] = await db
      .insert(applicationStageDocumentsTable)
      .values({
        applicationId: input.applicationId,
        stage: validated.stage,
        fileName: validated.fileName,
        fileData: null,
        fileUrl: objectPath,
        mimeType: artifact.contentType,
        sizeBytes: validated.buffer.byteLength,
        uploadedBy: null,
        uploadedByRole: "portal_automation",
        uploadedByName: "Portal Automation",
        isMissingDocNote: false,
        sourceType: "portal_automation",
        sourcePortalSubmissionId: input.submissionId,
        sourcePortalObservationId: input.observationId,
        sourceContentSha256: validated.sha256,
        sourceEvidence: {
          contract: "portal.application.artifact.v1",
          observationHash: input.observationHash,
          artifactKind: artifact.kind,
          identityVerified: true,
        },
      })
      .onConflictDoNothing()
      .returning({ id: applicationStageDocumentsTable.id });
    if (inserted) {
      outcomes.push({ id: inserted.id, kind: artifact.kind, created: true });
      continue;
    }
    const [concurrent] = await db
      .select({ id: applicationStageDocumentsTable.id })
      .from(applicationStageDocumentsTable)
      .where(existingWhere)
      .limit(1);
    if (!concurrent) throw new Error("portal_artifact_insert_conflict");
    outcomes.push({ id: concurrent.id, kind: artifact.kind, created: false });
  }
  return outcomes;
}
