import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  StudentJourneyReadinessContractError,
  buildStudentJourneyReadinessProjection,
  type StudentJourneyReadinessInput,
} from "../src/lib/studentJourneyReadinessProjection.js";

const EVALUATED_AT = "2026-09-01T12:00:00.000Z";

function input(overrides: Partial<StudentJourneyReadinessInput> = {}): StudentJourneyReadinessInput {
  return {
    requirementResolution: "resolved",
    requirementAuthority: "legacy_unversioned",
    requirementSetRef: null,
    evaluatorVersion: "journey_readiness_v1",
    evaluatedAt: EVALUATED_AT,
    requirements: [
      { documentType: "passport", mandatory: true, source: "program", sortOrder: 10 },
      { documentType: "bachelors_transcript", mandatory: true, source: "degree", sortOrder: 20 },
    ],
    documents: [],
    requests: [],
    ...overrides,
  };
}

function assertContractError(action: () => unknown, code: string) {
  assert.throws(
    action,
    (error: unknown) => error instanceof StudentJourneyReadinessContractError && error.code === code,
  );
}

test("missing mandatory evidence produces an actionable, deterministic requirement projection", () => {
  const projection = buildStudentJourneyReadinessProjection(input());

  assert.equal(projection.projectionType, "student.journey.readiness.v1");
  assert.equal(projection.evaluatedAt, EVALUATED_AT);
  assert.equal(projection.readiness, "action_required");
  assert.equal(projection.reason, "missing_or_rejected_evidence");
  assert.deepEqual(projection.coverage, {
    mandatory: 2,
    uploaded: 0,
    verified: 0,
    uploadComplete: false,
    verificationComplete: false,
  });
  assert.deepEqual(
    projection.requirementResults.map((result) => [result.documentType, result.result]),
    [["passport", "missing"], ["bachelors_transcript", "missing"]],
  );
});

test("equivalent document aliases satisfy upload coverage without fabricating verification", () => {
  const projection = buildStudentJourneyReadinessProjection(input({
    documents: [
      { type: "passport", status: "pending" },
      { type: "bachelor_transcript", status: "under_review" },
    ],
  }));

  assert.equal(projection.readiness, "review_required");
  assert.equal(projection.reason, "verification_pending");
  assert.equal(projection.coverage.uploadComplete, true);
  assert.equal(projection.coverage.verificationComplete, false);
  assert.equal(projection.milestoneEligibility.dossierVerified, false);
});

test("a verified replacement outranks rejected evidence for the same requirement", () => {
  const projection = buildStudentJourneyReadinessProjection(input({
    documents: [
      { type: "passport", status: "rejected" },
      { type: "passport", status: "verified" },
      { type: "bachelors_transcript_all_semesters", status: "approved" },
    ],
  }));

  assert.equal(projection.readiness, "document_package_ready");
  assert.equal(projection.coverage.verified, 2);
  assert.equal(projection.coverage.verificationComplete, true);
  assert.equal(projection.milestoneEligibility.dossierVerified, false);
  assert.equal(projection.milestoneEligibility.reason, "legacy_requirement_authority");
});

test("only a versioned requirement set can become eligible for a verified-dossier milestone", () => {
  const projection = buildStudentJourneyReadinessProjection(input({
    requirementAuthority: "versioned",
    requirementSetRef: "requirement-set:2026-09:v3",
    requirements: [
      { documentType: "passport", mandatory: true, source: "requirement_set", sortOrder: 10 },
    ],
    documents: [{ type: "passport", status: "approved" }],
  }));

  assert.equal(projection.readiness, "document_package_ready");
  assert.equal(projection.requirementSetRef, "requirement-set:2026-09:v3");
  assert.deepEqual(projection.milestoneEligibility, {
    dossierVerified: true,
    reason: "eligible",
  });
});

test("an unanswered request takes priority even when every requirement is verified", () => {
  const projection = buildStudentJourneyReadinessProjection(input({
    requirementAuthority: "versioned",
    requirementSetRef: "requirement-set:2026-09:v3",
    requirements: [
      { documentType: "passport", mandatory: true, source: "requirement_set", sortOrder: 10 },
    ],
    documents: [{ type: "passport", status: "verified" }],
    requests: [{ documentType: null, isCustom: true, fulfilled: false, responded: false }],
  }));

  assert.equal(projection.readiness, "action_required");
  assert.equal(projection.reason, "open_document_request");
  assert.equal(projection.requests.actionRequired, 1);
  assert.equal(projection.milestoneEligibility.reason, "open_request");
});

test("a responded custom request waits for review and no longer asks the student to act", () => {
  const projection = buildStudentJourneyReadinessProjection(input({
    documents: [
      { type: "passport", status: "verified" },
      { type: "bachelors_transcript", status: "verified" },
    ],
    requests: [{ documentType: null, isCustom: true, fulfilled: false, responded: true }],
  }));

  assert.equal(projection.readiness, "review_required");
  assert.equal(projection.reason, "responded_request_pending_review");
  assert.equal(projection.requests.actionRequired, 0);
  assert.equal(projection.requests.awaitingReview, 1);
});

test("unconfigured and unavailable requirement sources never report readiness", () => {
  const unconfigured = buildStudentJourneyReadinessProjection(input({
    requirementResolution: "unconfigured",
    requirements: [],
  }));
  const unavailable = buildStudentJourneyReadinessProjection(input({
    requirementResolution: "unavailable",
    requirements: [],
  }));

  assert.equal(unconfigured.readiness, "configuration_required");
  assert.equal(unconfigured.milestoneEligibility.reason, "requirements_not_resolved");
  assert.equal(unavailable.readiness, "unknown");
  assert.equal(unavailable.coverage.uploadComplete, false);
});

test("a resolved set with no mandatory requirements cannot manufacture a verified milestone", () => {
  const projection = buildStudentJourneyReadinessProjection(input({
    requirementAuthority: "versioned",
    requirementSetRef: "requirement-set:optional-only:v1",
    requirements: [{ documentType: "photo", mandatory: false, source: "requirement_set", sortOrder: 10 }],
  }));

  assert.equal(projection.readiness, "document_package_ready");
  assert.equal(projection.coverage.mandatory, 0);
  assert.equal(projection.milestoneEligibility.dossierVerified, false);
  assert.equal(projection.milestoneEligibility.reason, "no_mandatory_requirements");
});

test("unknown evidence states fail closed into human review", () => {
  const projection = buildStudentJourneyReadinessProjection(input({
    requirements: [{ documentType: "passport", mandatory: true, source: "program", sortOrder: 10 }],
    documents: [{ type: "passport", status: "auto_accepted_by_partner" }],
  }));

  assert.equal(projection.readiness, "review_required");
  assert.equal(projection.coverage.uploaded, 0);
  assert.equal(projection.requirementResults[0]?.result, "unknown");
});

test("malformed authority, request and oversized inputs are rejected before projection", () => {
  assertContractError(
    () => buildStudentJourneyReadinessProjection(input({
      requirementAuthority: "versioned",
      requirementSetRef: null,
    })),
    "INVALID_REQUIREMENT_SET_REF",
  );
  assertContractError(
    () => buildStudentJourneyReadinessProjection(input({
      requests: [{ documentType: null, isCustom: false, fulfilled: false, responded: false }],
    })),
    "CATALOG_REQUEST_TYPE_REQUIRED",
  );
  assertContractError(
    () => buildStudentJourneyReadinessProjection(input({
      documents: Array.from({ length: 501 }, () => ({ type: "passport", status: "pending" })),
    })),
    "INVALID_DOCUMENT_COUNT",
  );
  assertContractError(
    () => buildStudentJourneyReadinessProjection(input({
      requirements: [
        { documentType: "bachelor_transcript", mandatory: true, source: "program", sortOrder: 10 },
        { documentType: "bachelors_transcript", mandatory: true, source: "degree", sortOrder: 20 },
      ],
    })),
    "DUPLICATE_EQUIVALENT_REQUIREMENT",
  );
  assertContractError(
    () => buildStudentJourneyReadinessProjection(input({
      requirementResolution: "unavailable",
    })),
    "UNRESOLVED_REQUIREMENTS_FORBIDDEN",
  );
});

test("readiness foundation remains absent from current Journey and mandatory-document runtime paths", () => {
  const currentRuntimeSources = [
    "../src/routes/students.ts",
    "../src/routes/effectiveDocRequirements.ts",
    "../src/lib/mandatoryDocs.ts",
  ].map((path) => readFileSync(new URL(path, import.meta.url), "utf8")).join("\n");

  assert.doesNotMatch(currentRuntimeSources, /studentJourneyReadinessProjection/);
  assert.doesNotMatch(currentRuntimeSources, /buildStudentJourneyReadinessProjection/);
});
