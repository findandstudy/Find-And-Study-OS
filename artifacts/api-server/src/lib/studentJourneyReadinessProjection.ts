import { areEquivalentDocTypes } from "@workspace/doc-equivalence";

const MAX_REQUIREMENTS = 250;
const MAX_DOCUMENTS = 500;
const MAX_REQUESTS = 250;
const MAX_TEXT_LENGTH = 160;

const VERIFIED_DOCUMENT_STATES = new Set(["approved", "verified"]);
const IN_REVIEW_DOCUMENT_STATES = new Set(["pending", "requested", "under_review"]);
const REJECTED_DOCUMENT_STATES = new Set(["rejected", "invalid", "expired"]);

export type JourneyRequirementAuthority = "versioned" | "legacy_unversioned";
export type JourneyRequirementResolution = "resolved" | "unconfigured" | "unavailable";

export type JourneyReadinessRequirementInput = {
  documentType: string;
  mandatory: boolean;
  source: "program" | "degree" | "requirement_set";
  sortOrder: number;
};

export type JourneyReadinessDocumentInput = {
  type: string;
  status: string;
};

export type JourneyReadinessRequestInput = {
  documentType?: string | null;
  isCustom: boolean;
  fulfilled: boolean;
  responded: boolean;
};

export type StudentJourneyReadinessInput = {
  requirementResolution: JourneyRequirementResolution;
  requirementAuthority: JourneyRequirementAuthority;
  requirementSetRef?: string | null;
  evaluatorVersion: string;
  evaluatedAt: Date | string;
  requirements: JourneyReadinessRequirementInput[];
  documents: JourneyReadinessDocumentInput[];
  requests: JourneyReadinessRequestInput[];
};

export type JourneyRequirementResult =
  | "missing"
  | "rejected"
  | "in_review"
  | "verified"
  | "unknown";

export type StudentJourneyReadinessProjection = {
  schemaVersion: 1;
  projectionType: "student.journey.readiness.v1";
  evaluatedAt: string;
  evaluatorVersion: string;
  requirementAuthority: JourneyRequirementAuthority;
  requirementSetRef: string | null;
  readiness:
    | "action_required"
    | "review_required"
    | "document_package_ready"
    | "configuration_required"
    | "unknown";
  reason:
    | "missing_or_rejected_evidence"
    | "open_document_request"
    | "verification_pending"
    | "responded_request_pending_review"
    | "requirements_satisfied"
    | "requirements_unconfigured"
    | "requirements_unavailable";
  coverage: {
    mandatory: number;
    uploaded: number;
    verified: number;
    uploadComplete: boolean;
    verificationComplete: boolean;
  };
  requests: {
    actionRequired: number;
    awaitingReview: number;
  };
  milestoneEligibility: {
    dossierVerified: boolean;
    reason:
      | "eligible"
      | "requirements_not_resolved"
      | "legacy_requirement_authority"
      | "no_mandatory_requirements"
      | "verification_incomplete"
      | "open_request";
  };
  requirementResults: Array<{
    documentType: string;
    source: JourneyReadinessRequirementInput["source"];
    result: JourneyRequirementResult;
    reason:
      | "no_equivalent_evidence"
      | "only_rejected_evidence"
      | "evidence_awaiting_review"
      | "verified_evidence"
      | "unrecognized_evidence_state";
    equivalentEvidenceCount: number;
  }>;
};

export class StudentJourneyReadinessContractError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "StudentJourneyReadinessContractError";
  }
}

function boundedText(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new StudentJourneyReadinessContractError(`INVALID_${field.toUpperCase()}`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_TEXT_LENGTH || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new StudentJourneyReadinessContractError(`INVALID_${field.toUpperCase()}`);
  }
  return normalized;
}

function boundedArray<T>(value: T[], maximum: number, field: string): T[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new StudentJourneyReadinessContractError(`INVALID_${field.toUpperCase()}_COUNT`);
  }
  return value;
}

function isoDate(value: Date | string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new StudentJourneyReadinessContractError("INVALID_EVALUATED_AT");
  }
  return parsed.toISOString();
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function classifyRequirement(
  requirement: JourneyReadinessRequirementInput,
  documents: JourneyReadinessDocumentInput[],
): StudentJourneyReadinessProjection["requirementResults"][number] {
  const equivalent = documents.filter((document) =>
    areEquivalentDocTypes(requirement.documentType, document.type),
  );
  const states = new Set(equivalent.map((document) => document.status));

  if (states.size === 0) {
    return {
      documentType: requirement.documentType,
      source: requirement.source,
      result: "missing",
      reason: "no_equivalent_evidence",
      equivalentEvidenceCount: 0,
    };
  }
  if ([...states].some((state) => VERIFIED_DOCUMENT_STATES.has(state))) {
    return {
      documentType: requirement.documentType,
      source: requirement.source,
      result: "verified",
      reason: "verified_evidence",
      equivalentEvidenceCount: equivalent.length,
    };
  }
  if ([...states].some((state) => IN_REVIEW_DOCUMENT_STATES.has(state))) {
    return {
      documentType: requirement.documentType,
      source: requirement.source,
      result: "in_review",
      reason: "evidence_awaiting_review",
      equivalentEvidenceCount: equivalent.length,
    };
  }
  if ([...states].every((state) => REJECTED_DOCUMENT_STATES.has(state))) {
    return {
      documentType: requirement.documentType,
      source: requirement.source,
      result: "rejected",
      reason: "only_rejected_evidence",
      equivalentEvidenceCount: equivalent.length,
    };
  }
  return {
    documentType: requirement.documentType,
    source: requirement.source,
    result: "unknown",
    reason: "unrecognized_evidence_state",
    equivalentEvidenceCount: equivalent.length,
  };
}

/**
 * Pure, read-only readiness projection for the Student Journey foundation.
 *
 * Callers must resolve and authorize the student/application scope before
 * passing rows here. This contract never reads the database, writes state,
 * emits an event or authorizes submission. In particular, upload coverage is
 * deliberately separate from server-verified evidence coverage.
 */
export function buildStudentJourneyReadinessProjection(
  input: StudentJourneyReadinessInput,
): StudentJourneyReadinessProjection {
  if (!(["resolved", "unconfigured", "unavailable"] as const).includes(input.requirementResolution)) {
    throw new StudentJourneyReadinessContractError("INVALID_REQUIREMENT_RESOLUTION");
  }
  if (!(["versioned", "legacy_unversioned"] as const).includes(input.requirementAuthority)) {
    throw new StudentJourneyReadinessContractError("INVALID_REQUIREMENT_AUTHORITY");
  }
  const evaluatedAt = isoDate(input.evaluatedAt);
  const evaluatorVersion = boundedText(input.evaluatorVersion, "evaluator_version");
  const requirements = boundedArray(input.requirements, MAX_REQUIREMENTS, "requirement").map(
    (requirement) => {
      if (typeof requirement.mandatory !== "boolean") {
        throw new StudentJourneyReadinessContractError("INVALID_REQUIREMENT_MANDATORY");
      }
      if (!(["program", "degree", "requirement_set"] as const).includes(requirement.source)) {
        throw new StudentJourneyReadinessContractError("INVALID_REQUIREMENT_SOURCE");
      }
      if (!Number.isSafeInteger(requirement.sortOrder) || requirement.sortOrder < 0) {
        throw new StudentJourneyReadinessContractError("INVALID_REQUIREMENT_SORT_ORDER");
      }
      return {
        ...requirement,
        documentType: boundedText(requirement.documentType, "document_type"),
      };
    },
  );
  const documents = boundedArray(input.documents, MAX_DOCUMENTS, "document").map((document) => ({
    type: boundedText(document.type, "document_type"),
    status: boundedText(document.status, "document_status").toLowerCase(),
  }));
  const requests = boundedArray(input.requests, MAX_REQUESTS, "request").map((request) => {
    if (
      typeof request.isCustom !== "boolean"
      || typeof request.fulfilled !== "boolean"
      || typeof request.responded !== "boolean"
    ) {
      throw new StudentJourneyReadinessContractError("INVALID_REQUEST_STATE");
    }
    const documentType = request.documentType == null
      ? null
      : boundedText(request.documentType, "request_document_type");
    if (!request.isCustom && !documentType) {
      throw new StudentJourneyReadinessContractError("CATALOG_REQUEST_TYPE_REQUIRED");
    }
    return { ...request, documentType };
  });

  if (input.requirementResolution !== "resolved" && requirements.length > 0) {
    throw new StudentJourneyReadinessContractError("UNRESOLVED_REQUIREMENTS_FORBIDDEN");
  }
  for (let index = 0; index < requirements.length; index += 1) {
    for (let candidate = index + 1; candidate < requirements.length; candidate += 1) {
      if (areEquivalentDocTypes(requirements[index]!.documentType, requirements[candidate]!.documentType)) {
        throw new StudentJourneyReadinessContractError("DUPLICATE_EQUIVALENT_REQUIREMENT");
      }
    }
  }

  if (input.requirementAuthority === "versioned") {
    boundedText(input.requirementSetRef, "requirement_set_ref");
  } else if (input.requirementSetRef != null) {
    throw new StudentJourneyReadinessContractError("LEGACY_REQUIREMENT_SET_REF_FORBIDDEN");
  }

  const requirementSetRef = input.requirementAuthority === "versioned"
    ? String(input.requirementSetRef).trim()
    : null;
  const actionRequiredRequests = requests.filter(
    (request) => !request.fulfilled && !request.responded,
  ).length;
  const awaitingReviewRequests = requests.filter(
    (request) => !request.fulfilled && request.responded,
  ).length;

  if (input.requirementResolution !== "resolved") {
    return {
      schemaVersion: 1,
      projectionType: "student.journey.readiness.v1",
      evaluatedAt,
      evaluatorVersion,
      requirementAuthority: input.requirementAuthority,
      requirementSetRef,
      readiness: input.requirementResolution === "unconfigured" ? "configuration_required" : "unknown",
      reason: input.requirementResolution === "unconfigured"
        ? "requirements_unconfigured"
        : "requirements_unavailable",
      coverage: {
        mandatory: 0,
        uploaded: 0,
        verified: 0,
        uploadComplete: false,
        verificationComplete: false,
      },
      requests: {
        actionRequired: actionRequiredRequests,
        awaitingReview: awaitingReviewRequests,
      },
      milestoneEligibility: {
        dossierVerified: false,
        reason: "requirements_not_resolved",
      },
      requirementResults: [],
    };
  }

  const mandatoryRequirements = requirements
    .filter((requirement) => requirement.mandatory)
    .sort((left, right) =>
      left.sortOrder - right.sortOrder || compareText(left.documentType, right.documentType),
    );
  const requirementResults = mandatoryRequirements.map((requirement) =>
    classifyRequirement(requirement, documents),
  );
  const uploaded = requirementResults.filter(
    (result) => result.result === "in_review" || result.result === "verified",
  ).length;
  const verified = requirementResults.filter((result) => result.result === "verified").length;
  const uploadComplete = uploaded === mandatoryRequirements.length;
  const verificationComplete = verified === mandatoryRequirements.length;
  const hasActionableEvidenceGap = requirementResults.some(
    (result) => result.result === "missing" || result.result === "rejected",
  );
  const hasVerificationPending = requirementResults.some(
    (result) => result.result === "in_review" || result.result === "unknown",
  );

  let readiness: StudentJourneyReadinessProjection["readiness"];
  let reason: StudentJourneyReadinessProjection["reason"];
  if (actionRequiredRequests > 0) {
    readiness = "action_required";
    reason = "open_document_request";
  } else if (hasActionableEvidenceGap) {
    readiness = "action_required";
    reason = "missing_or_rejected_evidence";
  } else if (awaitingReviewRequests > 0) {
    readiness = "review_required";
    reason = "responded_request_pending_review";
  } else if (hasVerificationPending) {
    readiness = "review_required";
    reason = "verification_pending";
  } else {
    readiness = "document_package_ready";
    reason = "requirements_satisfied";
  }

  let milestoneReason: StudentJourneyReadinessProjection["milestoneEligibility"]["reason"];
  if (actionRequiredRequests > 0 || awaitingReviewRequests > 0) milestoneReason = "open_request";
  else if (mandatoryRequirements.length === 0) milestoneReason = "no_mandatory_requirements";
  else if (!verificationComplete) milestoneReason = "verification_incomplete";
  else if (input.requirementAuthority !== "versioned") milestoneReason = "legacy_requirement_authority";
  else milestoneReason = "eligible";

  return {
    schemaVersion: 1,
    projectionType: "student.journey.readiness.v1",
    evaluatedAt,
    evaluatorVersion,
    requirementAuthority: input.requirementAuthority,
    requirementSetRef,
    readiness,
    reason,
    coverage: {
      mandatory: mandatoryRequirements.length,
      uploaded,
      verified,
      uploadComplete,
      verificationComplete,
    },
    requests: {
      actionRequired: actionRequiredRequests,
      awaitingReview: awaitingReviewRequests,
    },
    milestoneEligibility: {
      dossierVerified: milestoneReason === "eligible",
      reason: milestoneReason,
    },
    requirementResults,
  };
}
