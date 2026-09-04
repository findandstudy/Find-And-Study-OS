export type PortalLifecycleSignal =
  | "submitted"
  | "missing_document"
  | "fee_required"
  | "offer_received"
  | "deposit_paid"
  | "acceptance_letter"
  | "final_acceptance"
  | "student_card"
  | "already_registered"
  | "quota_full"
  | "waitlisted"
  | "withdrawn"
  | "enrolled"
  | "rejected"
  | "unknown";

export type PortalLifecycleDisposition =
  | "SUBMITTED"
  | "UNDER_REVIEW"
  | "MISSING_DOCUMENT"
  | "FEE_REQUIRED"
  | "CONDITIONAL_OFFER"
  | "UNCONDITIONAL_OFFER"
  | "DEPOSIT_RECEIVED"
  | "WAITLISTED"
  | "REJECTED"
  | "FINAL_ACCEPTANCE"
  | "ENROLLED"
  | "FULL_QUOTA"
  | "DUPLICATE"
  | "ALREADY_REGISTERED"
  | "WITHDRAWN"
  | "UNKNOWN";

export type PortalLifecycleArtifact =
  | "offer_letter"
  | "deposit_receipt"
  | "acceptance_letter"
  | "final_acceptance"
  | "student_card";

export type PortalLifecycleAction =
  | "none"
  | "review_stage_transition"
  | "collect_portal_artifact"
  | "review_missing_documents"
  | "review_fee_request"
  | "review_payment_forward"
  | "manual_review";

export type PortalLifecycleDecision = {
  signal: PortalLifecycleSignal;
  disposition: PortalLifecycleDisposition;
  targetStage: string | null;
  action: PortalLifecycleAction;
  requiredArtifact: PortalLifecycleArtifact | null;
  artifactVerified: boolean;
  proposeStudentNotification: boolean;
  proposeUniversityForward: boolean;
  humanApprovalRequired: boolean;
  allowPortalMutation: false;
  reason: string;
};

export type PortalSubmissionTerminalStatus =
  | "accepted"
  | "rejected"
  | "program_full"
  | "already_exists"
  | "canceled";

const compact = (value: string): string =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Ordered, deterministic normalization used for durable portal observations. */
export function normalizePortalLifecycleDisposition(
  rawStatus: string,
): PortalLifecycleDisposition {
  const status = compact(rawStatus);
  if (!status) return "UNKNOWN";
  if (/\bmissing (?:document|documents|doc|docs)\b|\bdocument(?:s)? required\b|\badditional document(?:s)?\b|\bincomplete document(?:s)?\b/.test(status)) {
    return "MISSING_DOCUMENT";
  }
  if (/\bfinal acceptance\b|\bfinal admission\b|\bfinal letter\b/.test(status)) {
    return "FINAL_ACCEPTANCE";
  }
  if (/\bunconditional (?:offer|acceptance|admission)\b|\bacceptance letter\b|\badmission letter\b/.test(status)) {
    return "UNCONDITIONAL_OFFER";
  }
  if (/\bconditional (?:offer|acceptance|admission|accepted)\b|\bprovisional accept(?:ance|ed)?\b/.test(status)) {
    return "CONDITIONAL_OFFER";
  }
  if (/\bdeposit paid\b|\bpayment received\b|\bdeposit received\b/.test(status)) {
    return "DEPOSIT_RECEIVED";
  }
  if (/\bfee required\b|\bpayment required\b|\bapplication fee\b|\bawaiting payment\b/.test(status)) {
    return "FEE_REQUIRED";
  }
  if (/\bwaitlist(?:ed)?\b|\bwaiting list\b/.test(status)) return "WAITLISTED";
  if (/\bwithdrawn\b|\bwithdrawal\b|\bcancelled by applicant\b/.test(status)) {
    return "WITHDRAWN";
  }
  if (/\benrolled\b|\bregistration complete\b|\bstudent card\b|\bstudent id card\b/.test(status)) {
    return "ENROLLED";
  }
  if (/\balready registered\b|\balready enrolled\b|\bregistered by another\b/.test(status)) {
    return "ALREADY_REGISTERED";
  }
  if (/\bduplicate\b|\balready exists\b/.test(status)) return "DUPLICATE";
  if (/\bquota full\b|\bfull quota\b|\bprogram(?:me)? full\b|\bno seats?\b/.test(status)) {
    return "FULL_QUOTA";
  }
  if (/\breject(?:ed|ion)?\b|\bdeclin(?:ed|e)\b|\bunsuccessful\b/.test(status)) {
    return "REJECTED";
  }
  if (/^(?:accepted|approved)$/.test(status)) return "UNCONDITIONAL_OFFER";
  if (/\bpending review\b|\bunder review\b|\bin evaluation\b|\bin progress\b|\bwaiting approval\b/.test(status)) {
    return "UNDER_REVIEW";
  }
  if (/\bsubmitted\b|\bapplication received\b/.test(status)) return "SUBMITTED";
  if (/\boffer\b/.test(status)) return "CONDITIONAL_OFFER";
  return "UNKNOWN";
}

/**
 * Only genuinely terminal external outcomes stop status monitoring. Offers and
 * final acceptance remain open because payment, enrolment or student-card
 * evidence can still arrive later in the same portal.
 */
export function mapPortalDispositionToSubmissionStatus(
  disposition: PortalLifecycleDisposition,
): PortalSubmissionTerminalStatus | null {
  if (disposition === "ENROLLED") return "accepted";
  if (disposition === "REJECTED") return "rejected";
  if (disposition === "FULL_QUOTA") return "program_full";
  if (disposition === "DUPLICATE" || disposition === "ALREADY_REGISTERED") {
    return "already_exists";
  }
  if (disposition === "WITHDRAWN") return "canceled";
  return null;
}

/** Backwards-compatible action grouping over the richer disposition vocabulary. */
export function normalizePortalLifecycleSignal(
  rawStatus: string,
): PortalLifecycleSignal {
  const status = compact(rawStatus);
  const disposition = normalizePortalLifecycleDisposition(rawStatus);
  if (/\bstudent card\b|\bstudent id card\b/.test(status)) return "student_card";
  if (disposition === "FINAL_ACCEPTANCE") return "final_acceptance";
  if (/\bacceptance letter\b|\badmission letter\b/.test(status)) return "acceptance_letter";
  switch (disposition) {
    case "MISSING_DOCUMENT": return "missing_document";
    case "FEE_REQUIRED": return "fee_required";
    case "CONDITIONAL_OFFER":
    case "UNCONDITIONAL_OFFER": return "offer_received";
    case "DEPOSIT_RECEIVED": return "deposit_paid";
    case "ENROLLED": return "enrolled";
    case "FULL_QUOTA": return "quota_full";
    case "DUPLICATE":
    case "ALREADY_REGISTERED": return "already_registered";
    case "WAITLISTED": return "waitlisted";
    case "WITHDRAWN": return "withdrawn";
    case "REJECTED": return "rejected";
    case "SUBMITTED":
    case "UNDER_REVIEW": return "submitted";
    default: return "unknown";
  }
}

const artifactForSignal: Partial<Record<PortalLifecycleSignal, PortalLifecycleArtifact>> = {
  offer_received: "offer_letter",
  deposit_paid: "deposit_receipt",
  acceptance_letter: "acceptance_letter",
  final_acceptance: "final_acceptance",
  student_card: "student_card",
};

const targetStageForSignal: Partial<Record<PortalLifecycleSignal, string>> = {
  submitted: "submitted",
  offer_received: "offer_received",
  deposit_paid: "upload_payment",
  acceptance_letter: "acceptance_letter",
  final_acceptance: "final_acceptance",
  student_card: "student_card",
  already_registered: "all_registered",
  quota_full: "quota_full",
  waitlisted: "waitlisted",
  withdrawn: "withdrawn",
  enrolled: "student_card",
  rejected: "rejected",
};

/**
 * Produces a fail-closed lifecycle plan. Status must be bound to one exact
 * application row. This function never authorizes a portal mutation and never
 * advances a document-bearing stage before the file is stored in the OS.
 */
export function planPortalLifecycle(input: {
  rawStatus: string;
  currentStage: string;
  identityVerified?: boolean;
  artifacts?: Iterable<PortalLifecycleArtifact>;
  availableStages?: Iterable<string>;
}): PortalLifecycleDecision {
  const signal = normalizePortalLifecycleSignal(input.rawStatus);
  const disposition = normalizePortalLifecycleDisposition(input.rawStatus);
  const artifacts = new Set(input.artifacts ?? []);
  const requiredArtifact = artifactForSignal[signal] ?? null;
  const artifactVerified = requiredArtifact === null || artifacts.has(requiredArtifact);
  const targetStage = targetStageForSignal[signal] ?? null;
  const availableStages = input.availableStages
    ? new Set(input.availableStages)
    : null;

  if (input.identityVerified !== true) {
    return {
      signal,
      disposition,
      targetStage: null,
      action: "manual_review",
      requiredArtifact: null,
      artifactVerified: false,
      proposeStudentNotification: false,
      proposeUniversityForward: false,
      humanApprovalRequired: true,
      allowPortalMutation: false,
      reason: "Portal status is not bound to one verified student/application row.",
    };
  }

  if (signal === "unknown") {
    return {
      signal,
      disposition,
      targetStage: null,
      action: "manual_review",
      requiredArtifact: null,
      artifactVerified: false,
      proposeStudentNotification: false,
      proposeUniversityForward: false,
      humanApprovalRequired: true,
      allowPortalMutation: false,
      reason: "Portal status is not in the deterministic lifecycle vocabulary.",
    };
  }

  if (signal === "missing_document" || signal === "fee_required") {
    return {
      signal,
      disposition,
      targetStage: null,
      action: signal === "missing_document" ? "review_missing_documents" : "review_fee_request",
      requiredArtifact: null,
      artifactVerified: true,
      proposeStudentNotification: signal === "missing_document",
      proposeUniversityForward: false,
      humanApprovalRequired: true,
      allowPortalMutation: false,
      reason:
        signal === "missing_document"
          ? "The verified portal row requests additional documents; the exact list must be reviewed before contacting the student."
          : "The verified portal row requests a fee; payment and forwarding remain approval-gated.",
    };
  }

  if (targetStage && availableStages && !availableStages.has(targetStage)) {
    return {
      signal,
      disposition,
      targetStage: null,
      action: "manual_review",
      requiredArtifact,
      artifactVerified: false,
      proposeStudentNotification: false,
      proposeUniversityForward: false,
      humanApprovalRequired: true,
      allowPortalMutation: false,
      reason: `The mapped target stage "${targetStage}" is not present in the current application pipeline.`,
    };
  }

  if (requiredArtifact && !artifactVerified) {
    return {
      signal,
      disposition,
      targetStage,
      action: "collect_portal_artifact",
      requiredArtifact,
      artifactVerified: false,
      proposeStudentNotification: false,
      proposeUniversityForward: false,
      humanApprovalRequired: true,
      allowPortalMutation: false,
      reason: `The ${requiredArtifact} file must be stored and verified before the application stage can advance.`,
    };
  }

  if (targetStage === input.currentStage) {
    return {
      signal,
      disposition,
      targetStage,
      action: "none",
      requiredArtifact,
      artifactVerified,
      proposeStudentNotification: false,
      proposeUniversityForward: false,
      humanApprovalRequired: false,
      allowPortalMutation: false,
      reason: "The application is already at the verified target stage.",
    };
  }

  return {
    signal,
    disposition,
    targetStage,
    action: signal === "deposit_paid" ? "review_payment_forward" : "review_stage_transition",
    requiredArtifact,
    artifactVerified,
    proposeStudentNotification: [
      "offer_received",
      "acceptance_letter",
      "final_acceptance",
      "student_card",
      "enrolled",
      "rejected",
    ].includes(signal),
    proposeUniversityForward: signal === "deposit_paid",
    humanApprovalRequired: true,
    allowPortalMutation: false,
    reason:
      signal === "deposit_paid"
        ? "A verified receipt exists; forwarding payment evidence to the university still requires approval."
        : "The portal signal is deterministic; the CRM transition and outbound message remain reviewable actions.",
  };
}
