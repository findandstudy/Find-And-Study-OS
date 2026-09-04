import { createHash } from "node:crypto";
import {
  parseVerifiedApplicationNumber,
  type PortalMissingDocument,
  type PortalStatusCheckResult,
  type PortalStatusIdentityProof,
  type VerifiedUniversityApplicationNumber,
} from "@workspace/portal-adapters";
import { canonicalJson } from "./jsonCanonical";
import { redactString } from "./piiRedaction";
import {
  normalizePortalLifecycleDisposition,
  normalizePortalLifecycleSignal,
  type PortalLifecycleDisposition,
  type PortalLifecycleSignal,
} from "./portalLifecycleContract";

const MAX_STATUS_LENGTH = 250;
const MAX_MISSING_DOCUMENTS = 50;
const MAX_DOCUMENT_LABEL_LENGTH = 160;
const DOCUMENT_CODE_RE = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,63}$/;
const IDENTITY_SOURCES = new Set([
  "matched_application_row",
  "labeled_portal_field",
  "structured_portal_field",
]);

export type PortalLifecycleObservationInput = {
  submissionId: number;
  applicationId: number;
  adapterKey: string;
  result: PortalStatusCheckResult;
  observedAt?: Date;
};

export type NormalizedPortalLifecycleObservation = {
  submissionId: number;
  applicationId: number;
  adapterKey: string;
  rawStatus: string;
  signal: PortalLifecycleSignal;
  disposition: PortalLifecycleDisposition;
  identityVerified: boolean;
  identitySource: PortalStatusIdentityProof["source"] | null;
  missingDocuments: PortalMissingDocument[];
  verifiedApplicationNumber: VerifiedUniversityApplicationNumber | null;
  evidence: Record<string, unknown>;
  observationHash: string;
  observedAt: Date;
};

function cleanRequiredText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string") throw new Error(`${label}_invalid`);
  const text = redactString(value).replace(/\s+/g, " ").trim();
  if (!text || text.length > maxLength || /[\u0000-\u001f\u007f]/u.test(text)) {
    throw new Error(`${label}_invalid`);
  }
  return text;
}

export function parsePortalStatusIdentityProof(
  value: unknown,
): PortalStatusIdentityProof | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const proof = value as Partial<PortalStatusIdentityProof>;
  if (
    !IDENTITY_SOURCES.has(String(proof.source)) ||
    proof.identityBound !== true ||
    proof.targetBound !== true ||
    proof.uniqueMatch !== true
  ) {
    return null;
  }
  let sourceLabel: string;
  try {
    sourceLabel = cleanRequiredText(proof.sourceLabel, "identity_source_label", 160);
  } catch {
    return null;
  }
  return {
    source: proof.source!,
    sourceLabel,
    identityBound: true,
    targetBound: true,
    uniqueMatch: true,
  };
}

function normalizeMissingDocuments(value: unknown): PortalMissingDocument[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_MISSING_DOCUMENTS) {
    throw new Error("missing_documents_invalid");
  }
  const unique = new Map<string, PortalMissingDocument>();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("missing_document_invalid");
    }
    const candidate = item as Partial<PortalMissingDocument>;
    const label = cleanRequiredText(
      candidate.label,
      "missing_document_label",
      MAX_DOCUMENT_LABEL_LENGTH,
    );
    let code: string | undefined;
    if (candidate.code !== undefined) {
      if (typeof candidate.code !== "string" || !DOCUMENT_CODE_RE.test(candidate.code)) {
        throw new Error("missing_document_code_invalid");
      }
      code = candidate.code;
    }
    const key = `${code ?? ""}\u0000${label.toLocaleLowerCase("en")}`;
    if (!unique.has(key)) unique.set(key, { ...(code ? { code } : {}), label });
  }
  return [...unique.values()].sort((a, b) =>
    `${a.code ?? ""}:${a.label}`.localeCompare(`${b.code ?? ""}:${b.label}`),
  );
}

export function normalizePortalLifecycleObservation(
  input: PortalLifecycleObservationInput,
): NormalizedPortalLifecycleObservation {
  if (!Number.isInteger(input.submissionId) || input.submissionId <= 0) {
    throw new Error("submission_id_invalid");
  }
  if (!Number.isInteger(input.applicationId) || input.applicationId <= 0) {
    throw new Error("application_id_invalid");
  }
  const adapterKey = cleanRequiredText(input.adapterKey, "adapter_key", 100);
  const rawStatus = cleanRequiredText(input.result.status, "portal_status", MAX_STATUS_LENGTH);
  const identityProof = parsePortalStatusIdentityProof(input.result.identityProof);
  const missingDocuments = normalizeMissingDocuments(input.result.missingDocuments);
  const verified = parseVerifiedApplicationNumber(input.result.verifiedApplicationNumber);
  const verifiedApplicationNumber = verified.ok ? verified.value : null;
  const observedAt = input.observedAt ?? new Date();
  if (!Number.isFinite(observedAt.getTime())) throw new Error("observed_at_invalid");
  const signal = normalizePortalLifecycleSignal(rawStatus);
  const disposition = normalizePortalLifecycleDisposition(rawStatus);
  const evidence = {
    contract: "portal.lifecycle.observation.v1",
    identity: identityProof
      ? {
          verified: true,
          source: identityProof.source,
          sourceLabel: identityProof.sourceLabel,
        }
      : { verified: false },
    applicationNumberVerified: verifiedApplicationNumber !== null,
    missingDocumentCount: missingDocuments.length,
  };
  const observationHash = createHash("sha256")
    .update(
      canonicalJson({
        submissionId: input.submissionId,
        applicationId: input.applicationId,
        adapterKey,
        rawStatus: rawStatus.toLocaleLowerCase("en"),
        signal,
        disposition,
        identitySource: identityProof?.source ?? null,
        missingDocuments,
        applicationNumberVerified: verifiedApplicationNumber !== null,
      }),
      "utf8",
    )
    .digest("hex");

  return {
    submissionId: input.submissionId,
    applicationId: input.applicationId,
    adapterKey,
    rawStatus,
    signal,
    disposition,
    identityVerified: identityProof !== null,
    identitySource: identityProof?.source ?? null,
    missingDocuments,
    verifiedApplicationNumber,
    evidence,
    observationHash,
    observedAt,
  };
}
