import crypto from "node:crypto";
import { canonicalJson } from "./jsonCanonical.js";

export const STUDENT_JOURNEY_EVALUATION_PLAN_TYPE =
  "journey.next_action.evaluation.plan.v1";
export const STUDENT_JOURNEY_EVALUATION_OUTCOME_TYPE =
  "journey.next_action.evaluation.outcome.v1";
export const STUDENT_JOURNEY_EVALUATION_REPORT_TYPE =
  "journey.next_action.evaluation.report.v1";

const PLAN_HASH_DOMAIN = "FAS_JOURNEY_NEXT_ACTION_EVALUATION_PLAN\0v1\0";
const OUTCOME_HASH_DOMAIN = "FAS_JOURNEY_NEXT_ACTION_EVALUATION_OUTCOME\0v1\0";
const UUID_V7_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/;
const IDENTIFIER_RE = /^[a-z][a-z0-9._:-]{1,95}$/;
const OPAQUE_REF_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_PLAN_ITEMS = 1_000;
const MAX_OUTCOMES = 2_000;

export type JourneyEvaluationEvidenceRef = {
  kind: "VERIFIED_EVIDENCE" | "SYSTEM_EVENT" | "PARTNER_RECEIPT";
  id: string;
  sha256: string;
};

export type StudentJourneyEvaluationPlanItemInput = {
  trialRef: string;
  pseudonymousSubjectRef: string;
  applicationRef: string;
  scenarioCode: string;
  expectedAction: string;
  consentEvidence: JourneyEvaluationEvidenceRef & {
    kind: "VERIFIED_EVIDENCE";
  };
};

export type StudentJourneyEvaluationPlanInput = {
  planId: string;
  tenantId: string;
  cohortRef: string;
  periodStartsAt: string;
  periodEndsAt: string;
  frozenAt: string;
  evaluationPolicyVersion: string;
  sourceSnapshotHash: string;
  sourceRecordCount: number;
  excludedRecordCount: number;
  minimumEligibleTrials: number;
  targetTaskSuccessBps: number;
  items: StudentJourneyEvaluationPlanItemInput[];
};

export type StudentJourneyEvaluationPlan = Omit<
  StudentJourneyEvaluationPlanInput,
  "items"
> & {
  schemaVersion: 1;
  planType: typeof STUDENT_JOURNEY_EVALUATION_PLAN_TYPE;
  items: StudentJourneyEvaluationPlanItemInput[];
  eligibleTrialCount: number;
  uniqueSubjectCount: number;
  planHash: string;
};

export type StudentJourneyEvaluationExceptionCode =
  | "WRONG_ACTION"
  | "ABANDONED"
  | "TECHNICAL_FAILURE"
  | "AUTHORIZATION_DENIED"
  | "CONTENT_UNCLEAR"
  | "HUMAN_ESCALATION"
  | "OTHER_REVIEW_REQUIRED";

export type StudentJourneyEvaluationOutcomeInput = {
  outcomeId: string;
  planId: string;
  planHash: string;
  trialRef: string;
  presentedAt: string;
  firstActionAt: string | null;
  selectedAction: string | null;
  completedAt: string | null;
  assisted: boolean;
  completionEvidence: JourneyEvaluationEvidenceRef | null;
  exceptionCode: StudentJourneyEvaluationExceptionCode | null;
  safetyViolation: boolean;
  recordedAt: string;
};

export type StudentJourneyEvaluationOutcome =
  StudentJourneyEvaluationOutcomeInput & {
    schemaVersion: 1;
    outcomeType: typeof STUDENT_JOURNEY_EVALUATION_OUTCOME_TYPE;
    outcomeHash: string;
  };

export type StudentJourneyEvaluationReport = {
  schemaVersion: 1;
  reportType: typeof STUDENT_JOURNEY_EVALUATION_REPORT_TYPE;
  planId: string;
  planHash: string;
  evaluationPolicyVersion: string;
  targetTaskSuccessBps: number;
  eligibleTrialCount: number;
  uniqueSubjectCount: number;
  recordedOutcomeCount: number;
  verifiedUnaidedSuccessCount: number;
  completedButNotSuccessfulCount: number;
  noOutcomeCount: number;
  wrongActionCount: number;
  assistedCount: number;
  exceptionCount: number;
  safetyViolationCount: number;
  measurementCoverageBps: number;
  taskSuccessBps: number;
  exceptionRateBps: number;
  medianTimeToSuccessSeconds: number | null;
  p90TimeToSuccessSeconds: number | null;
  minimumSampleMet: boolean;
  coverageComplete: boolean;
  guardrailStatus: "CLEAR" | "SAFETY_VIOLATION";
  targetComparison: "NOT_EVALUATED" | "AT_OR_ABOVE" | "BELOW";
  gateDecision: "NOT_AUTHORIZED_BY_EVALUATION_CONTRACT";
};

export class StudentJourneyEvaluationContractError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "StudentJourneyEvaluationContractError";
  }
}

function fail(code: string, message: string): never {
  throw new StudentJourneyEvaluationContractError(code, message);
}

function hash(domain: string, value: unknown): string {
  return crypto
    .createHash("sha256")
    .update(domain, "utf8")
    .update(canonicalJson(value), "utf8")
    .digest("hex");
}

function uuidV7(value: string, field: string): string {
  if (!UUID_V7_RE.test(value))
    fail("INVALID_UUID_V7", `${field} must be UUIDv7`);
  return value.toLowerCase();
}

function sha256(value: string, field: string): string {
  if (!SHA256_RE.test(value)) {
    fail("INVALID_SHA256", `${field} must be lowercase SHA-256`);
  }
  return value;
}

function identifier(value: string, field: string): string {
  if (!IDENTIFIER_RE.test(value))
    fail("INVALID_IDENTIFIER", `${field} is invalid`);
  return value;
}

function opaqueRef(value: string, field: string): string {
  if (!OPAQUE_REF_RE.test(value))
    fail("INVALID_REFERENCE", `${field} is invalid`);
  return value;
}

function timestamp(value: string, field: string): string {
  if (!value) fail("INVALID_TIMESTAMP", `${field} must be an ISO timestamp`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    fail("INVALID_TIMESTAMP", `${field} must be an ISO timestamp`);
  }
  return parsed.toISOString();
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail(
      "INVALID_POSITIVE_INTEGER",
      `${field} must be a positive safe integer`,
    );
  }
  return value;
}

function nonNegativeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(
      "INVALID_NON_NEGATIVE_INTEGER",
      `${field} must be a non-negative safe integer`,
    );
  }
  return value;
}

function basisPoints(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 10_000) {
    fail("INVALID_BASIS_POINTS", `${field} must be in 0..10000`);
  }
  return value;
}

function normalizeEvidence(
  value: JourneyEvaluationEvidenceRef,
  field: string,
): JourneyEvaluationEvidenceRef {
  if (
    !value ||
    !["VERIFIED_EVIDENCE", "SYSTEM_EVENT", "PARTNER_RECEIPT"].includes(
      value.kind,
    )
  ) {
    fail("INVALID_EVIDENCE_KIND", `${field}.kind is invalid`);
  }
  return {
    kind: value.kind,
    id: opaqueRef(value.id, `${field}.id`),
    sha256: sha256(value.sha256, `${field}.sha256`),
  };
}

function normalizePlanItem(
  item: StudentJourneyEvaluationPlanItemInput,
  index: number,
): StudentJourneyEvaluationPlanItemInput {
  const consentEvidence = normalizeEvidence(
    item.consentEvidence,
    `items[${index}].consentEvidence`,
  );
  if (consentEvidence.kind !== "VERIFIED_EVIDENCE") {
    fail(
      "CONSENT_EVIDENCE_REQUIRED",
      `items[${index}] requires VERIFIED_EVIDENCE consent`,
    );
  }
  return {
    trialRef: opaqueRef(item.trialRef, `items[${index}].trialRef`),
    pseudonymousSubjectRef: opaqueRef(
      item.pseudonymousSubjectRef,
      `items[${index}].pseudonymousSubjectRef`,
    ),
    applicationRef: opaqueRef(
      item.applicationRef,
      `items[${index}].applicationRef`,
    ),
    scenarioCode: identifier(item.scenarioCode, `items[${index}].scenarioCode`),
    expectedAction: identifier(
      item.expectedAction,
      `items[${index}].expectedAction`,
    ),
    consentEvidence: {
      kind: "VERIFIED_EVIDENCE",
      id: consentEvidence.id,
      sha256: consentEvidence.sha256,
    },
  };
}

export function freezeStudentJourneyEvaluationPlan(
  input: StudentJourneyEvaluationPlanInput,
): StudentJourneyEvaluationPlan {
  const planId = uuidV7(input.planId, "planId");
  const tenantId = uuidV7(input.tenantId, "tenantId");
  const cohortRef = opaqueRef(input.cohortRef, "cohortRef");
  const periodStartsAt = timestamp(input.periodStartsAt, "periodStartsAt");
  const periodEndsAt = timestamp(input.periodEndsAt, "periodEndsAt");
  const frozenAt = timestamp(input.frozenAt, "frozenAt");
  if (periodStartsAt >= periodEndsAt) {
    fail("INVALID_PERIOD", "periodStartsAt must precede periodEndsAt");
  }
  if (frozenAt > periodStartsAt) {
    fail(
      "LATE_PLAN_FREEZE",
      "the evaluation plan must be frozen before its period",
    );
  }
  const evaluationPolicyVersion = identifier(
    input.evaluationPolicyVersion,
    "evaluationPolicyVersion",
  );
  const sourceSnapshotHash = sha256(
    input.sourceSnapshotHash,
    "sourceSnapshotHash",
  );
  const sourceRecordCount = nonNegativeInteger(
    input.sourceRecordCount,
    "sourceRecordCount",
  );
  const excludedRecordCount = nonNegativeInteger(
    input.excludedRecordCount,
    "excludedRecordCount",
  );
  if (!Array.isArray(input.items) || input.items.length === 0) {
    fail("EMPTY_PLAN", "at least one eligible trial is required");
  }
  if (input.items.length > MAX_PLAN_ITEMS) {
    fail(
      "PLAN_TOO_LARGE",
      `a plan may contain at most ${MAX_PLAN_ITEMS} trials`,
    );
  }
  const items = input.items.map(normalizePlanItem);
  const trialRefs = new Set<string>();
  for (const item of items) {
    if (trialRefs.has(item.trialRef)) {
      fail("DUPLICATE_TRIAL", `duplicate trial ${item.trialRef}`);
    }
    trialRefs.add(item.trialRef);
  }
  if (sourceRecordCount !== items.length + excludedRecordCount) {
    fail(
      "SOURCE_RECONCILIATION_FAILED",
      "sourceRecordCount must equal eligible plus excluded trials",
    );
  }
  const minimumEligibleTrials = positiveInteger(
    input.minimumEligibleTrials,
    "minimumEligibleTrials",
  );
  if (minimumEligibleTrials > items.length) {
    fail(
      "UNREACHABLE_MINIMUM_SAMPLE",
      "minimumEligibleTrials cannot exceed the frozen denominator",
    );
  }
  const targetTaskSuccessBps = basisPoints(
    input.targetTaskSuccessBps,
    "targetTaskSuccessBps",
  );
  const withoutHash: Omit<StudentJourneyEvaluationPlan, "planHash"> = {
    schemaVersion: 1,
    planType: STUDENT_JOURNEY_EVALUATION_PLAN_TYPE,
    planId,
    tenantId,
    cohortRef,
    periodStartsAt,
    periodEndsAt,
    frozenAt,
    evaluationPolicyVersion,
    sourceSnapshotHash,
    sourceRecordCount,
    excludedRecordCount,
    minimumEligibleTrials,
    targetTaskSuccessBps,
    items,
    eligibleTrialCount: items.length,
    uniqueSubjectCount: new Set(
      items.map((item) => item.pseudonymousSubjectRef),
    ).size,
  };
  return {
    ...withoutHash,
    planHash: hash(PLAN_HASH_DOMAIN, withoutHash),
  };
}

export function createStudentJourneyEvaluationOutcome(
  input: StudentJourneyEvaluationOutcomeInput,
): StudentJourneyEvaluationOutcome {
  const outcomeId = uuidV7(input.outcomeId, "outcomeId");
  const planId = uuidV7(input.planId, "planId");
  const planHash = sha256(input.planHash, "planHash");
  const trialRef = opaqueRef(input.trialRef, "trialRef");
  const presentedAt = timestamp(input.presentedAt, "presentedAt");
  const firstActionAt =
    input.firstActionAt === null
      ? null
      : timestamp(input.firstActionAt, "firstActionAt");
  const selectedAction =
    input.selectedAction === null
      ? null
      : identifier(input.selectedAction, "selectedAction");
  const completedAt =
    input.completedAt === null
      ? null
      : timestamp(input.completedAt, "completedAt");
  const recordedAt = timestamp(input.recordedAt, "recordedAt");
  if (
    typeof input.assisted !== "boolean" ||
    typeof input.safetyViolation !== "boolean"
  ) {
    fail("INVALID_BOOLEAN", "assisted and safetyViolation must be boolean");
  }
  if ((firstActionAt === null) !== (selectedAction === null)) {
    fail(
      "ACTION_TIMESTAMP_MISMATCH",
      "firstActionAt and selectedAction must both be present or absent",
    );
  }
  if (firstActionAt !== null && firstActionAt < presentedAt) {
    fail("INVALID_CHRONOLOGY", "firstActionAt cannot precede presentedAt");
  }
  if (completedAt !== null && completedAt < (firstActionAt ?? presentedAt)) {
    fail(
      "INVALID_CHRONOLOGY",
      "completedAt cannot precede the observed action",
    );
  }
  if (recordedAt < (completedAt ?? firstActionAt ?? presentedAt)) {
    fail("INVALID_CHRONOLOGY", "recordedAt cannot precede observed activity");
  }
  if ((completedAt === null) !== (input.completionEvidence === null)) {
    fail(
      "COMPLETION_EVIDENCE_MISMATCH",
      "completedAt and completionEvidence must both be present or absent",
    );
  }
  const completionEvidence = input.completionEvidence
    ? normalizeEvidence(input.completionEvidence, "completionEvidence")
    : null;
  const allowedExceptionCodes: StudentJourneyEvaluationExceptionCode[] = [
    "WRONG_ACTION",
    "ABANDONED",
    "TECHNICAL_FAILURE",
    "AUTHORIZATION_DENIED",
    "CONTENT_UNCLEAR",
    "HUMAN_ESCALATION",
    "OTHER_REVIEW_REQUIRED",
  ];
  if (
    input.exceptionCode !== null &&
    !allowedExceptionCodes.includes(input.exceptionCode)
  ) {
    fail("INVALID_EXCEPTION_CODE", "exceptionCode is invalid");
  }
  const withoutHash: Omit<StudentJourneyEvaluationOutcome, "outcomeHash"> = {
    schemaVersion: 1,
    outcomeType: STUDENT_JOURNEY_EVALUATION_OUTCOME_TYPE,
    outcomeId,
    planId,
    planHash,
    trialRef,
    presentedAt,
    firstActionAt,
    selectedAction,
    completedAt,
    assisted: input.assisted,
    completionEvidence,
    exceptionCode: input.exceptionCode,
    safetyViolation: input.safetyViolation,
    recordedAt,
  };
  return {
    ...withoutHash,
    outcomeHash: hash(OUTCOME_HASH_DOMAIN, withoutHash),
  };
}

function assertPlanIntegrity(plan: StudentJourneyEvaluationPlan): void {
  const { planHash: _planHash, ...inputWithDerived } = plan;
  const {
    schemaVersion: _schemaVersion,
    planType: _planType,
    eligibleTrialCount: _eligibleTrialCount,
    uniqueSubjectCount: _uniqueSubjectCount,
    ...input
  } = inputWithDerived;
  const rebuilt = freezeStudentJourneyEvaluationPlan(input);
  if (canonicalJson(rebuilt) !== canonicalJson(plan)) {
    fail("PLAN_INTEGRITY_FAILED", "evaluation plan integrity check failed");
  }
}

function assertOutcomeIntegrity(
  outcome: StudentJourneyEvaluationOutcome,
): void {
  const {
    schemaVersion: _schemaVersion,
    outcomeType: _outcomeType,
    outcomeHash: _outcomeHash,
    ...input
  } = outcome;
  const rebuilt = createStudentJourneyEvaluationOutcome(input);
  if (canonicalJson(rebuilt) !== canonicalJson(outcome)) {
    fail(
      "OUTCOME_INTEGRITY_FAILED",
      "evaluation outcome integrity check failed",
    );
  }
}

function rateBps(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Math.round((numerator * 10_000) / denominator);
}

function nearestRank(values: number[], percentile: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(percentile * sorted.length) - 1);
  return sorted[index] ?? null;
}

export function evaluateStudentJourneyNextAction(
  plan: StudentJourneyEvaluationPlan,
  outcomes: StudentJourneyEvaluationOutcome[],
): StudentJourneyEvaluationReport {
  assertPlanIntegrity(plan);
  if (!Array.isArray(outcomes) || outcomes.length > MAX_OUTCOMES) {
    fail(
      "OUTCOME_BUDGET_EXCEEDED",
      `at most ${MAX_OUTCOMES} outcomes are allowed`,
    );
  }
  const items = new Map(plan.items.map((item) => [item.trialRef, item]));
  const outcomesByTrial = new Map<string, StudentJourneyEvaluationOutcome>();
  for (const outcome of outcomes) {
    assertOutcomeIntegrity(outcome);
    if (outcome.planId !== plan.planId || outcome.planHash !== plan.planHash) {
      fail("PLAN_BINDING_MISMATCH", "outcome is not bound to this exact plan");
    }
    if (!items.has(outcome.trialRef)) {
      fail(
        "UNMATCHED_TRIAL",
        "outcome trial is outside the frozen denominator",
      );
    }
    if (outcomesByTrial.has(outcome.trialRef)) {
      fail("DUPLICATE_OUTCOME", "a frozen trial may have only one outcome");
    }
    if (
      outcome.presentedAt < plan.periodStartsAt ||
      outcome.presentedAt > plan.periodEndsAt ||
      (outcome.firstActionAt !== null &&
        outcome.firstActionAt > plan.periodEndsAt) ||
      (outcome.completedAt !== null && outcome.completedAt > plan.periodEndsAt)
    ) {
      fail(
        "OUTCOME_OUTSIDE_PERIOD",
        "observed activity must be inside the plan period",
      );
    }
    outcomesByTrial.set(outcome.trialRef, outcome);
  }

  let verifiedUnaidedSuccessCount = 0;
  let completedButNotSuccessfulCount = 0;
  let wrongActionCount = 0;
  let assistedCount = 0;
  let exceptionCount = 0;
  let safetyViolationCount = 0;
  const timeToSuccessSeconds: number[] = [];

  for (const item of plan.items) {
    const outcome = outcomesByTrial.get(item.trialRef);
    if (!outcome) continue;
    const wrongAction =
      outcome.selectedAction !== null &&
      outcome.selectedAction !== item.expectedAction;
    const correctAction = outcome.selectedAction === item.expectedAction;
    const success =
      correctAction &&
      outcome.completedAt !== null &&
      outcome.completionEvidence !== null &&
      !outcome.assisted &&
      outcome.exceptionCode === null &&
      !outcome.safetyViolation;
    if (wrongAction) wrongActionCount += 1;
    if (outcome.assisted) assistedCount += 1;
    if (outcome.safetyViolation) safetyViolationCount += 1;
    if (
      wrongAction ||
      outcome.exceptionCode !== null ||
      outcome.safetyViolation
    ) {
      exceptionCount += 1;
    }
    if (success) {
      verifiedUnaidedSuccessCount += 1;
      timeToSuccessSeconds.push(
        Math.floor(
          (new Date(outcome.completedAt as string).getTime() -
            new Date(outcome.presentedAt).getTime()) /
            1_000,
        ),
      );
    } else if (outcome.completedAt !== null) {
      completedButNotSuccessfulCount += 1;
    }
  }

  const eligibleTrialCount = plan.eligibleTrialCount;
  const recordedOutcomeCount = outcomesByTrial.size;
  const measurementCoverageBps = rateBps(
    recordedOutcomeCount,
    eligibleTrialCount,
  );
  const taskSuccessBps = rateBps(
    verifiedUnaidedSuccessCount,
    eligibleTrialCount,
  );
  const minimumSampleMet = recordedOutcomeCount >= plan.minimumEligibleTrials;
  const coverageComplete = recordedOutcomeCount === eligibleTrialCount;
  const guardrailStatus =
    safetyViolationCount === 0 ? "CLEAR" : "SAFETY_VIOLATION";
  const targetComparison =
    !minimumSampleMet || !coverageComplete || guardrailStatus !== "CLEAR"
      ? "NOT_EVALUATED"
      : taskSuccessBps >= plan.targetTaskSuccessBps
        ? "AT_OR_ABOVE"
        : "BELOW";

  return {
    schemaVersion: 1,
    reportType: STUDENT_JOURNEY_EVALUATION_REPORT_TYPE,
    planId: plan.planId,
    planHash: plan.planHash,
    evaluationPolicyVersion: plan.evaluationPolicyVersion,
    targetTaskSuccessBps: plan.targetTaskSuccessBps,
    eligibleTrialCount,
    uniqueSubjectCount: plan.uniqueSubjectCount,
    recordedOutcomeCount,
    verifiedUnaidedSuccessCount,
    completedButNotSuccessfulCount,
    noOutcomeCount: eligibleTrialCount - recordedOutcomeCount,
    wrongActionCount,
    assistedCount,
    exceptionCount,
    safetyViolationCount,
    measurementCoverageBps,
    taskSuccessBps,
    exceptionRateBps: rateBps(exceptionCount, eligibleTrialCount),
    medianTimeToSuccessSeconds: nearestRank(timeToSuccessSeconds, 0.5),
    p90TimeToSuccessSeconds: nearestRank(timeToSuccessSeconds, 0.9),
    minimumSampleMet,
    coverageComplete,
    guardrailStatus,
    targetComparison,
    gateDecision: "NOT_AUTHORIZED_BY_EVALUATION_CONTRACT",
  };
}
