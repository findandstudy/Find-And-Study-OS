export type JourneyWaitingParty =
  | "student"
  | "find_and_study"
  | "university"
  | "external_authority"
  | "completed"
  | "unknown";

export type JourneyActionCode =
  | "explore_programs"
  | "upload_requested_documents"
  | "replace_rejected_documents"
  | "complete_dossier"
  | "await_document_review"
  | "await_submission"
  | "await_university_decision"
  | "review_offer"
  | "await_visa_decision"
  | "prepare_enrollment"
  | "journey_complete"
  | "contact_advisor"
  | "track_application";

export type JourneyApplicationInput = {
  id: number;
  stage: string;
  deadline?: string | null;
  universityName?: string | null;
  programName?: string | null;
  assignedToId?: number | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
};

export type JourneyPipelineStageInput = {
  key: string;
  label: string;
  sortOrder: number;
  variant?: string | null;
  isCaseClose?: boolean | null;
};

export type JourneyDocumentInput = {
  applicationId?: number | null;
  status: string;
};

export type JourneyMissingRequestInput = {
  applicationId: number;
  respondedAt?: Date | string | null;
};

export type StudentJourneyProjectionInput = {
  applications: JourneyApplicationInput[];
  pipelineStages: JourneyPipelineStageInput[];
  documents: JourneyDocumentInput[];
  missingRequests: JourneyMissingRequestInput[];
  now?: Date;
};

export type StudentJourneyProjection = {
  schemaVersion: 1;
  generatedAt: string;
  source: "pipeline_projection" | "legacy_fallback";
  fallbackReason: "unknown_stage" | "pipeline_unavailable" | null;
  applicationCount: number;
  application: {
    id: number;
    stage: string;
    universityName: string | null;
    programName: string | null;
    assignedToId: number | null;
  } | null;
  stage: {
    key: string;
    label: string;
    variant: string | null;
  };
  progress: {
    known: boolean;
    completedStages: number | null;
    totalStages: number | null;
    percent: number | null;
  };
  waitingParty: JourneyWaitingParty;
  nextAction: {
    code: JourneyActionCode;
    href: string;
    actionable: boolean;
    priority: "high" | "normal" | "low";
    dueAt: string | null;
    dueLabel: string | null;
    overdue: boolean;
    reason: "open_request" | "rejected_evidence" | "workflow_stage" | "no_application" | "unknown_stage";
    openRequestCount: number;
  };
  evidence: {
    basis: "observed_documents_and_open_requests";
    totalDocuments: number;
    verifiedDocuments: number;
    inReviewDocuments: number;
    rejectedDocuments: number;
    openRequests: number;
    status: "not_started" | "action_required" | "in_review" | "verified" | "unknown";
  };
};

const LEGACY_PIPELINE: JourneyPipelineStageInput[] = [
  { key: "inquiry", label: "Inquiry received", sortOrder: 10 },
  { key: "documents_collected", label: "Documents collected", sortOrder: 20 },
  { key: "submitted", label: "Submitted", sortOrder: 30 },
  { key: "offer_received", label: "Offer received", sortOrder: 40 },
  { key: "visa_applied", label: "Visa applied", sortOrder: 50 },
  { key: "visa_approved", label: "Visa approved", sortOrder: 60 },
  { key: "enrolled", label: "Enrolled", sortOrder: 70, variant: "won", isCaseClose: true },
  { key: "rejected", label: "Rejected", sortOrder: 80, variant: "lost", isCaseClose: true },
];

const VERIFIED_DOCUMENT_STATES = new Set(["approved", "verified"]);
const IN_REVIEW_DOCUMENT_STATES = new Set(["pending", "requested", "under_review"]);
const REJECTED_DOCUMENT_STATES = new Set(["rejected", "invalid", "expired"]);

function asTimestamp(value: Date | string | null | undefined): number {
  if (!value) return 0;
  const parsed = value instanceof Date ? value : new Date(value);
  const timestamp = parsed.getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function normalizeDueDate(value: string | null | undefined, now: Date) {
  const dueLabel = value?.trim() || null;
  if (!dueLabel) return { dueAt: null, dueLabel: null, overdue: false };
  const parsed = new Date(dueLabel);
  if (!Number.isFinite(parsed.getTime())) {
    return { dueAt: null, dueLabel, overdue: false };
  }
  return {
    dueAt: parsed.toISOString(),
    dueLabel,
    overdue: parsed.getTime() < now.getTime(),
  };
}

function applicationAttentionScore(
  application: JourneyApplicationInput,
  missingRequests: JourneyMissingRequestInput[],
  stagesByKey: Map<string, JourneyPipelineStageInput>,
): number {
  if (missingRequests.some((request) => request.applicationId === application.id && !request.respondedAt)) return 100;
  if (application.stage === "offer_received") return 90;
  const stage = stagesByKey.get(application.stage);
  if (application.stage === "rejected" || stage?.variant === "lost") return 80;
  if (["inquiry", "documents_collected"].includes(application.stage)) return 70;
  if (!stage) return 60;
  if (application.stage === "enrolled" || stage.variant === "won" || stage.isCaseClose) return 10;
  return 40;
}

function selectPrimaryApplication(
  applications: JourneyApplicationInput[],
  missingRequests: JourneyMissingRequestInput[],
  stagesByKey: Map<string, JourneyPipelineStageInput>,
): JourneyApplicationInput | null {
  return [...applications]
    .sort((left, right) => {
      const priorityDifference =
        applicationAttentionScore(right, missingRequests, stagesByKey)
        - applicationAttentionScore(left, missingRequests, stagesByKey);
      if (priorityDifference !== 0) return priorityDifference;
      return asTimestamp(right.updatedAt ?? right.createdAt) - asTimestamp(left.updatedAt ?? left.createdAt);
    })[0] ?? null;
}

function evidenceForApplication(
  applicationId: number,
  documents: JourneyDocumentInput[],
  missingRequests: JourneyMissingRequestInput[],
) {
  const scopedDocuments = documents.filter(
    (document) => document.applicationId == null || document.applicationId === applicationId,
  );
  const verifiedDocuments = scopedDocuments.filter((document) => VERIFIED_DOCUMENT_STATES.has(document.status)).length;
  const inReviewDocuments = scopedDocuments.filter((document) => IN_REVIEW_DOCUMENT_STATES.has(document.status)).length;
  const rejectedDocuments = scopedDocuments.filter((document) => REJECTED_DOCUMENT_STATES.has(document.status)).length;
  const openRequests = missingRequests.filter(
    (request) => request.applicationId === applicationId && !request.respondedAt,
  ).length;

  let status: StudentJourneyProjection["evidence"]["status"] = "unknown";
  if (openRequests > 0 || rejectedDocuments > 0) status = "action_required";
  else if (inReviewDocuments > 0) status = "in_review";
  else if (verifiedDocuments > 0) status = "verified";
  else if (scopedDocuments.length === 0) status = "not_started";

  return {
    basis: "observed_documents_and_open_requests" as const,
    totalDocuments: scopedDocuments.length,
    verifiedDocuments,
    inReviewDocuments,
    rejectedDocuments,
    openRequests,
    status,
  };
}

function resolveNextAction(
  application: JourneyApplicationInput,
  stage: JourneyPipelineStageInput | undefined,
  evidence: StudentJourneyProjection["evidence"],
  now: Date,
): Pick<StudentJourneyProjection, "waitingParty" | "nextAction"> {
  const due = normalizeDueDate(application.deadline, now);
  const makeAction = (
    waitingParty: JourneyWaitingParty,
    code: JourneyActionCode,
    href: string,
    actionable: boolean,
    priority: "high" | "normal" | "low",
    reason: StudentJourneyProjection["nextAction"]["reason"] = "workflow_stage",
  ): Pick<StudentJourneyProjection, "waitingParty" | "nextAction"> => ({
    waitingParty,
    nextAction: {
      code,
      href,
      actionable,
      priority: due.overdue ? "high" : priority,
      ...due,
      reason,
      openRequestCount: evidence.openRequests,
    },
  });

  if (evidence.openRequests > 0) {
    return makeAction("student", "upload_requested_documents", "/student/account", true, "high", "open_request");
  }
  if (evidence.rejectedDocuments > 0) {
    return makeAction("student", "replace_rejected_documents", "/student/account", true, "high", "rejected_evidence");
  }
  if (!stage) {
    return makeAction("unknown", "contact_advisor", "/student/messages", true, "high", "unknown_stage");
  }
  if (application.stage === "rejected" || stage.variant === "lost") {
    return makeAction("student", "contact_advisor", "/student/messages", true, "high");
  }
  if (application.stage === "enrolled" || stage.variant === "won" || stage.isCaseClose) {
    return makeAction("completed", "journey_complete", "/student/applications", false, "low");
  }
  if (application.stage === "offer_received") {
    return makeAction("student", "review_offer", "/student/applications", true, "high");
  }
  if (application.stage === "submitted") {
    return makeAction("university", "await_university_decision", "/student/applications", false, "normal");
  }
  if (application.stage === "visa_applied") {
    return makeAction("external_authority", "await_visa_decision", "/student/applications", false, "normal");
  }
  if (application.stage === "visa_approved") {
    return makeAction("student", "prepare_enrollment", "/student/applications", true, "normal");
  }
  if (application.stage === "documents_collected") {
    return evidence.inReviewDocuments > 0
      ? makeAction("find_and_study", "await_document_review", "/student/applications", false, "normal")
      : makeAction("find_and_study", "await_submission", "/student/applications", false, "normal");
  }
  if (application.stage === "inquiry") {
    if (evidence.inReviewDocuments > 0) {
      return makeAction("find_and_study", "await_document_review", "/student/account", false, "normal");
    }
    return makeAction("student", "complete_dossier", "/student/account", true, "normal");
  }
  return makeAction("find_and_study", "track_application", "/student/applications", false, "normal");
}

export function buildStudentJourneyProjection(
  input: StudentJourneyProjectionInput,
): StudentJourneyProjection {
  const now = input.now ?? new Date();
  const configuredStages = input.pipelineStages
    .filter((stage) => stage.key.trim().length > 0)
    .sort((left, right) => left.sortOrder - right.sortOrder);
  const pipelineAvailable = configuredStages.length > 0;
  const stageCatalog = pipelineAvailable ? configuredStages : LEGACY_PIPELINE;
  const stagesByKey = new Map(stageCatalog.map((stage) => [stage.key, stage]));
  const application = selectPrimaryApplication(input.applications, input.missingRequests, stagesByKey);

  if (!application) {
    return {
      schemaVersion: 1,
      generatedAt: now.toISOString(),
      source: pipelineAvailable ? "pipeline_projection" : "legacy_fallback",
      fallbackReason: pipelineAvailable ? null : "pipeline_unavailable",
      applicationCount: 0,
      application: null,
      stage: { key: "discover", label: "Discover", variant: null },
      progress: { known: true, completedStages: 0, totalStages: stageCatalog.length, percent: 0 },
      waitingParty: "student",
      nextAction: {
        code: "explore_programs",
        href: "/student/course-finder",
        actionable: true,
        priority: "normal",
        dueAt: null,
        dueLabel: null,
        overdue: false,
        reason: "no_application",
        openRequestCount: 0,
      },
      evidence: {
        basis: "observed_documents_and_open_requests",
        totalDocuments: input.documents.filter((document) => document.applicationId == null).length,
        verifiedDocuments: input.documents.filter(
          (document) => document.applicationId == null && VERIFIED_DOCUMENT_STATES.has(document.status),
        ).length,
        inReviewDocuments: input.documents.filter(
          (document) => document.applicationId == null && IN_REVIEW_DOCUMENT_STATES.has(document.status),
        ).length,
        rejectedDocuments: input.documents.filter(
          (document) => document.applicationId == null && REJECTED_DOCUMENT_STATES.has(document.status),
        ).length,
        openRequests: 0,
        status: input.documents.some((document) => document.applicationId == null) ? "unknown" : "not_started",
      },
    };
  }

  const stage = stagesByKey.get(application.stage);
  const evidence = evidenceForApplication(application.id, input.documents, input.missingRequests);
  const action = resolveNextAction(application, stage, evidence, now);
  const progressStages = stageCatalog.filter((item) => item.variant !== "lost");
  const stageIndex = progressStages.findIndex((item) => item.key === application.stage);
  const progressKnown = stageIndex >= 0 && progressStages.length > 0;
  const percent = progressKnown
    ? progressStages.length === 1
      ? 100
      : Math.round((stageIndex / (progressStages.length - 1)) * 100)
    : null;
  const usesFallback = !pipelineAvailable || !stage;

  return {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    source: usesFallback ? "legacy_fallback" : "pipeline_projection",
    fallbackReason: !pipelineAvailable ? "pipeline_unavailable" : !stage ? "unknown_stage" : null,
    applicationCount: input.applications.length,
    application: {
      id: application.id,
      stage: application.stage,
      universityName: application.universityName ?? null,
      programName: application.programName ?? null,
      assignedToId: application.assignedToId ?? null,
    },
    stage: {
      key: application.stage,
      label: stage?.label ?? application.stage,
      variant: stage?.variant ?? null,
    },
    progress: {
      known: progressKnown,
      completedStages: progressKnown ? stageIndex : null,
      totalStages: progressKnown ? progressStages.length : null,
      percent,
    },
    ...action,
    evidence,
  };
}
