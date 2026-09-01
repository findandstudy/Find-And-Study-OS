import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  StudentJourneyEvaluationContractError,
  createStudentJourneyEvaluationOutcome,
  evaluateStudentJourneyNextAction,
  freezeStudentJourneyEvaluationPlan,
  type StudentJourneyEvaluationOutcomeInput,
  type StudentJourneyEvaluationPlan,
  type StudentJourneyEvaluationPlanInput,
} from "../src/lib/studentJourneyEvaluationContract.js";

const HASH_A = "a".repeat(64);

function uuid(sequence: number): string {
  return `018f0000-0000-7000-8000-${sequence.toString(16).padStart(12, "0")}`;
}

function planItem(sequence: number) {
  return {
    trialRef: `trial:${sequence}`,
    pseudonymousSubjectRef: `subject-hash:${sequence}`,
    applicationRef: `application:${sequence}`,
    scenarioCode: "document_request",
    expectedAction: "upload_requested_document",
    consentEvidence: {
      kind: "VERIFIED_EVIDENCE" as const,
      id: `consent:${sequence}`,
      sha256: sequence.toString(16).padStart(64, "0"),
    },
  };
}

function planInput(
  overrides: Partial<StudentJourneyEvaluationPlanInput> = {},
): StudentJourneyEvaluationPlanInput {
  const items =
    overrides.items ??
    Array.from({ length: 5 }, (_, index) => planItem(index + 1));
  return {
    planId: uuid(1),
    tenantId: uuid(2),
    cohortRef: "cohort:g45:pilot",
    periodStartsAt: "2026-09-01T00:00:00.000Z",
    periodEndsAt: "2026-09-02T00:00:00.000Z",
    frozenAt: "2026-08-31T23:59:00.000Z",
    evaluationPolicyVersion: "journey_eval_v1",
    sourceSnapshotHash: HASH_A,
    sourceRecordCount: items.length,
    excludedRecordCount: 0,
    minimumEligibleTrials: Math.min(4, items.length),
    targetTaskSuccessBps: 8_000,
    ...overrides,
    items,
  };
}

function freeze(
  overrides: Partial<StudentJourneyEvaluationPlanInput> = {},
): StudentJourneyEvaluationPlan {
  return freezeStudentJourneyEvaluationPlan(planInput(overrides));
}

function outcomeInput(
  plan: StudentJourneyEvaluationPlan,
  sequence: number,
  overrides: Partial<StudentJourneyEvaluationOutcomeInput> = {},
): StudentJourneyEvaluationOutcomeInput {
  return {
    outcomeId: uuid(100 + sequence),
    planId: plan.planId,
    planHash: plan.planHash,
    trialRef: `trial:${sequence}`,
    presentedAt: "2026-09-01T10:00:00.000Z",
    firstActionAt: "2026-09-01T10:00:10.000Z",
    selectedAction: "upload_requested_document",
    completedAt: "2026-09-01T10:01:00.000Z",
    assisted: false,
    completionEvidence: {
      kind: "SYSTEM_EVENT",
      id: `completion:${sequence}`,
      sha256: (sequence + 100).toString(16).padStart(64, "0"),
    },
    exceptionCode: null,
    safetyViolation: false,
    recordedAt: "2026-09-01T10:02:00.000Z",
    ...overrides,
  };
}

function outcome(
  plan: StudentJourneyEvaluationPlan,
  sequence: number,
  overrides: Partial<StudentJourneyEvaluationOutcomeInput> = {},
) {
  return createStudentJourneyEvaluationOutcome(
    outcomeInput(plan, sequence, overrides),
  );
}

function assertContractError(action: () => unknown, code: string) {
  assert.throws(
    action,
    (error: unknown) =>
      error instanceof StudentJourneyEvaluationContractError &&
      error.code === code,
  );
}

test("a pre-period frozen plan reconciles its denominator and pseudonymous subjects", () => {
  const plan = freeze();

  assert.equal(plan.planType, "journey.next_action.evaluation.plan.v1");
  assert.equal(plan.eligibleTrialCount, 5);
  assert.equal(plan.uniqueSubjectCount, 5);
  assert.match(plan.planHash, /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(plan).includes("studentName"), false);
  assert.equal(JSON.stringify(plan).includes("email"), false);
  assert.deepEqual(plan, freeze());
});

test("verified unaided task success, delay and exception rate use the frozen denominator", () => {
  const plan = freeze();
  const durations = [30, 60, 90, 120];
  const successes = durations.map((seconds, index) =>
    outcome(plan, index + 1, {
      completedAt: new Date(
        Date.parse("2026-09-01T10:00:00.000Z") + seconds * 1_000,
      ).toISOString(),
      recordedAt: "2026-09-01T10:03:00.000Z",
    }),
  );
  const wrong = outcome(plan, 5, {
    selectedAction: "contact_advisor",
    exceptionCode: "WRONG_ACTION",
  });
  const report = evaluateStudentJourneyNextAction(plan, [...successes, wrong]);

  assert.equal(report.reportType, "journey.next_action.evaluation.report.v1");
  assert.equal(report.verifiedUnaidedSuccessCount, 4);
  assert.equal(report.completedButNotSuccessfulCount, 1);
  assert.equal(report.wrongActionCount, 1);
  assert.equal(report.exceptionCount, 1);
  assert.equal(report.measurementCoverageBps, 10_000);
  assert.equal(report.taskSuccessBps, 8_000);
  assert.equal(report.exceptionRateBps, 2_000);
  assert.equal(report.medianTimeToSuccessSeconds, 60);
  assert.equal(report.p90TimeToSuccessSeconds, 120);
  assert.equal(report.targetComparison, "AT_OR_ABOVE");
  assert.equal(report.gateDecision, "NOT_AUTHORIZED_BY_EVALUATION_CONTRACT");
});

test("missing outcomes remain visible and prevent target evaluation", () => {
  const plan = freeze();
  const report = evaluateStudentJourneyNextAction(plan, [outcome(plan, 1)]);

  assert.equal(report.recordedOutcomeCount, 1);
  assert.equal(report.noOutcomeCount, 4);
  assert.equal(report.measurementCoverageBps, 2_000);
  assert.equal(report.taskSuccessBps, 2_000);
  assert.equal(report.minimumSampleMet, false);
  assert.equal(report.coverageComplete, false);
  assert.equal(report.targetComparison, "NOT_EVALUATED");
});

test("assistance, explicit exceptions and safety violations never count as unaided success", () => {
  const plan = freeze({ minimumEligibleTrials: 1 });
  const assisted = outcome(plan, 1, { assisted: true });
  const technical = outcome(plan, 2, { exceptionCode: "TECHNICAL_FAILURE" });
  const safety = outcome(plan, 3, { safetyViolation: true });
  const abandoned = outcome(plan, 4, {
    firstActionAt: null,
    selectedAction: null,
    completedAt: null,
    completionEvidence: null,
    exceptionCode: "ABANDONED",
  });
  const success = outcome(plan, 5);
  const report = evaluateStudentJourneyNextAction(plan, [
    assisted,
    technical,
    safety,
    abandoned,
    success,
  ]);

  assert.equal(report.verifiedUnaidedSuccessCount, 1);
  assert.equal(report.assistedCount, 1);
  assert.equal(report.exceptionCount, 3);
  assert.equal(report.safetyViolationCount, 1);
  assert.equal(report.guardrailStatus, "SAFETY_VIOLATION");
  assert.equal(report.targetComparison, "NOT_EVALUATED");
});

test("completion requires immutable evidence and coherent chronology", () => {
  const plan = freeze();
  assertContractError(
    () =>
      createStudentJourneyEvaluationOutcome(
        outcomeInput(plan, 1, { completionEvidence: null }),
      ),
    "COMPLETION_EVIDENCE_MISMATCH",
  );
  assertContractError(
    () =>
      createStudentJourneyEvaluationOutcome(
        outcomeInput(plan, 1, {
          firstActionAt: "2026-09-01T09:59:59.000Z",
        }),
      ),
    "INVALID_CHRONOLOGY",
  );
  assertContractError(
    () =>
      createStudentJourneyEvaluationOutcome(
        outcomeInput(plan, 1, {
          selectedAction: null,
        }),
      ),
    "ACTION_TIMESTAMP_MISMATCH",
  );
});

test("tampered plans and outcomes fail immutable integrity reconstruction", () => {
  const plan = freeze();
  const validOutcome = outcome(plan, 1);

  assertContractError(
    () =>
      evaluateStudentJourneyNextAction(
        { ...plan, targetTaskSuccessBps: 1 },
        [],
      ),
    "PLAN_INTEGRITY_FAILED",
  );
  assertContractError(
    () =>
      evaluateStudentJourneyNextAction(plan, [
        { ...validOutcome, assisted: true },
      ]),
    "OUTCOME_INTEGRITY_FAILED",
  );
});

test("outcomes are exact-plan-bound, denominator-bound and unique per trial", () => {
  const plan = freeze();
  const otherPlan = freeze({ planId: uuid(9), cohortRef: "cohort:other" });

  assertContractError(
    () => evaluateStudentJourneyNextAction(plan, [outcome(otherPlan, 1)]),
    "PLAN_BINDING_MISMATCH",
  );
  assertContractError(
    () =>
      evaluateStudentJourneyNextAction(plan, [
        outcome(plan, 1, { trialRef: "trial:outside" }),
      ]),
    "UNMATCHED_TRIAL",
  );
  const duplicate = outcome(plan, 1);
  assertContractError(
    () => evaluateStudentJourneyNextAction(plan, [duplicate, duplicate]),
    "DUPLICATE_OUTCOME",
  );
});

test("late freeze, denominator shrinkage and non-verified consent fail closed", () => {
  assertContractError(
    () => freeze({ frozenAt: "2026-09-01T00:00:01.000Z" }),
    "LATE_PLAN_FREEZE",
  );
  assertContractError(
    () => freeze({ sourceRecordCount: 6 }),
    "SOURCE_RECONCILIATION_FAILED",
  );
  const invalidItems = [
    {
      ...planItem(1),
      consentEvidence: {
        kind: "SYSTEM_EVENT" as "VERIFIED_EVIDENCE",
        id: "consent:1",
        sha256: HASH_A,
      },
    },
  ];
  assertContractError(
    () =>
      freeze({
        items: invalidItems,
        sourceRecordCount: 1,
        minimumEligibleTrials: 1,
      }),
    "CONSENT_EVIDENCE_REQUIRED",
  );
});

test("hard budgets and measurement-period bounds reject distorted reports", () => {
  assertContractError(
    () =>
      freeze({
        items: Array.from({ length: 1_001 }, (_, index) => planItem(index + 1)),
        sourceRecordCount: 1_001,
        minimumEligibleTrials: 1,
      }),
    "PLAN_TOO_LARGE",
  );
  const plan = freeze();
  assertContractError(
    () =>
      evaluateStudentJourneyNextAction(plan, [
        outcome(plan, 1, {
          presentedAt: "2026-09-02T00:00:01.000Z",
          firstActionAt: "2026-09-02T00:00:02.000Z",
          completedAt: "2026-09-02T00:00:03.000Z",
          recordedAt: "2026-09-02T00:00:04.000Z",
        }),
      ]),
    "OUTCOME_OUTSIDE_PERIOD",
  );
});

test("the evaluation contract remains absent from current route and analytics runtime", () => {
  const runtimeSources = [
    "../src/index.ts",
    "../src/routes/students.ts",
    "../src/lib/studentJourneyFeature.ts",
  ]
    .map((path) => readFileSync(new URL(path, import.meta.url), "utf8"))
    .join("\n");

  assert.doesNotMatch(runtimeSources, /studentJourneyEvaluationContract/);
  assert.doesNotMatch(runtimeSources, /journey\.next_action\.evaluation/);
});
