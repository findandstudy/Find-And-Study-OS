import assert from "node:assert/strict";
import test from "node:test";
import {
  mapPortalDispositionToSubmissionStatus,
  normalizePortalLifecycleDisposition,
  normalizePortalLifecycleSignal,
  planPortalLifecycle,
} from "../src/lib/portalLifecycleContract";

test("normalizes the supported portal lifecycle vocabulary", () => {
  assert.equal(normalizePortalLifecycleSignal("Waiting Approval"), "submitted");
  assert.equal(
    normalizePortalLifecycleSignal("Conditional Acceptance"),
    "offer_received",
  );
  assert.equal(
    normalizePortalLifecycleSignal("Final Acceptance Letter Ready"),
    "final_acceptance",
  );
  assert.equal(
    normalizePortalLifecycleSignal("Registered by another agency"),
    "already_registered",
  );
  assert.equal(normalizePortalLifecycleSignal("No Seats Available"), "quota_full");
  assert.equal(normalizePortalLifecycleSignal("Some new status"), "unknown");
  assert.equal(normalizePortalLifecycleDisposition("Missing documents"), "MISSING_DOCUMENT");
  assert.equal(normalizePortalLifecycleDisposition("Application fee required"), "FEE_REQUIRED");
  assert.equal(normalizePortalLifecycleDisposition("Unconditional Offer"), "UNCONDITIONAL_OFFER");
  assert.equal(normalizePortalLifecycleDisposition("Approved"), "UNCONDITIONAL_OFFER");
  assert.equal(normalizePortalLifecycleDisposition("Duplicate application"), "DUPLICATE");
});

test("only closed-loop terminal dispositions stop portal monitoring", () => {
  assert.equal(mapPortalDispositionToSubmissionStatus("UNCONDITIONAL_OFFER"), null);
  assert.equal(mapPortalDispositionToSubmissionStatus("FINAL_ACCEPTANCE"), null);
  assert.equal(mapPortalDispositionToSubmissionStatus("ENROLLED"), "accepted");
  assert.equal(mapPortalDispositionToSubmissionStatus("REJECTED"), "rejected");
  assert.equal(mapPortalDispositionToSubmissionStatus("FULL_QUOTA"), "program_full");
  assert.equal(mapPortalDispositionToSubmissionStatus("DUPLICATE"), "already_exists");
  assert.equal(mapPortalDispositionToSubmissionStatus("WITHDRAWN"), "canceled");
});

test("offer never advances without a stored offer letter", () => {
  const blocked = planPortalLifecycle({
    rawStatus: "Offer Ready",
    currentStage: "submitted",
    identityVerified: true,
  });
  assert.equal(blocked.action, "collect_portal_artifact");
  assert.equal(blocked.requiredArtifact, "offer_letter");
  assert.equal(blocked.artifactVerified, false);
  assert.equal(blocked.proposeStudentNotification, false);
  assert.equal(blocked.allowPortalMutation, false);

  const proved = planPortalLifecycle({
    rawStatus: "Offer Ready",
    currentStage: "submitted",
    identityVerified: true,
    artifacts: ["offer_letter"],
  });
  assert.equal(proved.action, "review_stage_transition");
  assert.equal(proved.targetStage, "offer_received");
  assert.equal(proved.proposeStudentNotification, true);
  assert.equal(proved.humanApprovalRequired, true);
});

test("payment text alone never authorizes forwarding or a stage move", () => {
  const blocked = planPortalLifecycle({
    rawStatus: "Deposit Paid",
    currentStage: "offer_received",
    identityVerified: true,
  });
  assert.equal(blocked.action, "collect_portal_artifact");
  assert.equal(blocked.requiredArtifact, "deposit_receipt");
  assert.equal(blocked.proposeUniversityForward, false);

  const proved = planPortalLifecycle({
    rawStatus: "Payment Received",
    currentStage: "offer_received",
    identityVerified: true,
    artifacts: ["deposit_receipt"],
  });
  assert.equal(proved.action, "review_payment_forward");
  assert.equal(proved.targetStage, "upload_payment");
  assert.equal(proved.proposeUniversityForward, true);
  assert.equal(proved.allowPortalMutation, false);
});

test("final and student-card stages require their exact artifact", () => {
  const final = planPortalLifecycle({
    rawStatus: "Final Admission",
    currentStage: "acceptance_letter",
    identityVerified: true,
    artifacts: ["acceptance_letter"],
  });
  assert.equal(final.action, "collect_portal_artifact");
  assert.equal(final.requiredArtifact, "final_acceptance");

  const card = planPortalLifecycle({
    rawStatus: "Student ID Card",
    currentStage: "final_acceptance",
    identityVerified: true,
    artifacts: ["student_card"],
  });
  assert.equal(card.targetStage, "student_card");
  assert.equal(card.action, "review_stage_transition");
});

test("unknown fails closed; quota-full proposes the configured review stage", () => {
  const unknown = planPortalLifecycle({
    rawStatus: "Portal says xyz",
    currentStage: "submitted",
    identityVerified: true,
  });
  assert.equal(unknown.action, "manual_review");
  assert.equal(unknown.targetStage, null);
  assert.equal(unknown.humanApprovalRequired, true);
  assert.equal(unknown.allowPortalMutation, false);

  const quota = planPortalLifecycle({
    rawStatus: "Quota Full",
    currentStage: "submitted",
    identityVerified: true,
  });
  assert.equal(quota.action, "review_stage_transition");
  assert.equal(quota.targetStage, "quota_full");
  assert.equal(quota.humanApprovalRequired, true);
  assert.equal(quota.allowPortalMutation, false);
});

test("an already-applied target stage is idempotent", () => {
  const decision = planPortalLifecycle({
    rawStatus: "Application Submitted",
    currentStage: "submitted",
    identityVerified: true,
  });
  assert.equal(decision.action, "none");
  assert.equal(decision.humanApprovalRequired, false);
});

test("a recognized status without exact application identity fails closed", () => {
  const decision = planPortalLifecycle({
    rawStatus: "Unconditional Offer",
    currentStage: "submitted",
    identityVerified: false,
    artifacts: ["offer_letter"],
  });
  assert.equal(decision.disposition, "UNCONDITIONAL_OFFER");
  assert.equal(decision.action, "manual_review");
  assert.equal(decision.targetStage, null);
  assert.equal(decision.proposeStudentNotification, false);
});

test("missing documents and fee requests become explicit review actions", () => {
  const missing = planPortalLifecycle({
    rawStatus: "Missing Documents",
    currentStage: "submitted",
    identityVerified: true,
  });
  assert.equal(missing.action, "review_missing_documents");
  assert.equal(missing.disposition, "MISSING_DOCUMENT");
  assert.equal(missing.proposeStudentNotification, true);

  const fee = planPortalLifecycle({
    rawStatus: "Application Fee Required",
    currentStage: "submitted",
    identityVerified: true,
  });
  assert.equal(fee.action, "review_fee_request");
  assert.equal(fee.proposeUniversityForward, false);
});

test("a stale lifecycle mapping cannot propose a stage outside the live pipeline", () => {
  const decision = planPortalLifecycle({
    rawStatus: "Unconditional Offer",
    currentStage: "submitted",
    identityVerified: true,
    artifacts: ["offer_letter"],
    availableStages: ["inquiry", "submitted"],
  });
  assert.equal(decision.action, "manual_review");
  assert.equal(decision.targetStage, null);
  assert.equal(decision.proposeStudentNotification, false);
  assert.match(decision.reason, /not present/i);
});
