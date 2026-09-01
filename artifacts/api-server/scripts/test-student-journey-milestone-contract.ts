import assert from "node:assert/strict";
import test from "node:test";
import {
  StudentJourneyMilestoneContractError,
  calculateQavjp,
  createJourneyMilestoneEvent,
  freezeQavjpDenominator,
  type JourneyMilestoneEventInput,
  type QavjpDenominatorSnapshotInput,
} from "../src/lib/studentJourneyMilestoneContract.js";

const ID = {
  tenant: "018f4000-0000-7000-8000-000000000001",
  event1: "018f4000-0000-7000-8000-000000000002",
  event2: "018f4000-0000-7000-8000-000000000003",
  event3: "018f4000-0000-7000-8000-000000000004",
  snapshot: "018f4000-0000-7000-8000-000000000005",
};
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function eventInput(overrides: Partial<JourneyMilestoneEventInput> = {}): JourneyMilestoneEventInput {
  return {
    eventId: ID.event1,
    tenantId: ID.tenant,
    applicationRef: "application:101",
    lifecycleRef: "cycle:1",
    subjectRef: "student:501",
    aggregateVersion: 3,
    milestoneCode: "dossier_verified",
    ownerUserId: 42,
    nextAction: "prepare_submission",
    dueAt: "2026-09-10T12:00:00.000Z",
    completedAt: "2026-09-09T12:00:00.000Z",
    recordedAt: "2026-09-09T12:00:01.000Z",
    verificationKind: "VERIFIED_EVIDENCE",
    evidence: [{ kind: "VERIFIED_EVIDENCE", id: "evidence:701", sha256: HASH_A }],
    qualityFactorBps: 8_000,
    qualityPolicyVersion: "qavjp_quality_v1",
    qualityInputHash: HASH_B,
    ...overrides,
  };
}

function denominatorInput(
  overrides: Partial<QavjpDenominatorSnapshotInput> = {},
): QavjpDenominatorSnapshotInput {
  return {
    snapshotId: ID.snapshot,
    tenantId: ID.tenant,
    cohortId: "journey_pilot_2026",
    periodStartsAt: "2026-09-01T00:00:00.000Z",
    periodEndsAt: "2026-10-01T00:00:00.000Z",
    frozenAt: "2026-09-01T00:00:00.000Z",
    eligibilityPolicyVersion: "journey_eligibility_v1",
    sourceSnapshotHash: HASH_B,
    sourceRecordCount: 3,
    excludedRecordCount: 1,
    items: [
      {
        applicationRef: "application:101",
        lifecycleRef: "cycle:1",
        subjectRef: "student:501",
        milestoneCode: "dossier_verified",
        dueAt: "2026-09-10T12:00:00.000Z",
        ownerUserId: 42,
        nextAction: "prepare_submission",
        weightBps: 6_000,
        consentEvidence: { kind: "VERIFIED_EVIDENCE", id: "consent:501", sha256: HASH_A },
      },
      {
        applicationRef: "application:202",
        lifecycleRef: "cycle:1",
        subjectRef: "student:502",
        milestoneCode: "application_submitted",
        dueAt: "2026-09-20T12:00:00.000Z",
        ownerUserId: null,
        nextAction: null,
        weightBps: 4_000,
        consentEvidence: { kind: "VERIFIED_EVIDENCE", id: "consent:502", sha256: HASH_B },
      },
    ],
    ...overrides,
  };
}

function assertContractError(action: () => unknown, code: string) {
  assert.throws(action, (error: unknown) =>
    error instanceof StudentJourneyMilestoneContractError && error.code === code,
  );
}

test("verified milestone event derives on-time, dedup and immutable content hashes", () => {
  const event = createJourneyMilestoneEvent(eventInput());
  const replay = createJourneyMilestoneEvent(eventInput());

  assert.equal(event.schemaVersion, 1);
  assert.equal(event.eventType, "journey.milestone.completed.v1");
  assert.equal(event.onTime, true);
  assert.match(event.dedupKey, /^[0-9a-f]{64}$/);
  assert.match(event.eventHash, /^[0-9a-f]{64}$/);
  assert.equal(event.dedupKey, replay.dedupKey);
  assert.equal(event.eventHash, replay.eventHash);

  const correctedReceipt = createJourneyMilestoneEvent(eventInput({ eventId: ID.event2 }));
  assert.equal(correctedReceipt.dedupKey, event.dedupKey);
  assert.notEqual(correctedReceipt.eventHash, event.eventHash);
});

test("staff-only completion markers and evidence-kind mismatches are rejected", () => {
  assertContractError(
    () => createJourneyMilestoneEvent(eventInput({
      verificationKind: "STAFF_MARKED_COMPLETE" as never,
      evidence: [{ kind: "STAFF_MARKED_COMPLETE" as never, id: "staff:42", sha256: HASH_A }],
    })),
    "INVALID_EVIDENCE_KIND",
  );
  assertContractError(
    () => createJourneyMilestoneEvent(eventInput({
      verificationKind: "PARTNER_RECEIPT",
      evidence: [{ kind: "VERIFIED_EVIDENCE", id: "evidence:701", sha256: HASH_A }],
    })),
    "VERIFICATION_EVIDENCE_MISMATCH",
  );
});

test("milestone chronology and bounded quality factor fail closed", () => {
  assertContractError(
    () => createJourneyMilestoneEvent(eventInput({ recordedAt: "2026-09-08T12:00:00.000Z" })),
    "RECORDED_BEFORE_COMPLETION",
  );
  assertContractError(
    () => createJourneyMilestoneEvent(eventInput({ qualityFactorBps: 10_001 })),
    "INVALID_QUALITY_FACTOR",
  );
});

test("denominator freeze reconciles the source and exposes owner/action coverage", () => {
  const snapshot = freezeQavjpDenominator(denominatorInput());

  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.snapshotType, "journey.qavjp.denominator.frozen.v1");
  assert.equal(snapshot.eligibleItemCount, 2);
  assert.equal(snapshot.denominatorWeightBps, 10_000);
  assert.equal(snapshot.ownerCoverageBps, 5_000);
  assert.equal(snapshot.nextActionCoverageBps, 5_000);
  assert.equal(new Set(snapshot.items.map((item) => item.dedupKey)).size, 2);
  assert.match(snapshot.snapshotHash, /^[0-9a-f]{64}$/);
});

test("late, duplicated, unreconciled or non-consented denominator freezes are rejected", () => {
  assertContractError(
    () => freezeQavjpDenominator(denominatorInput({ frozenAt: "2026-09-02T00:00:00.000Z" })),
    "LATE_DENOMINATOR_FREEZE",
  );
  assertContractError(
    () => freezeQavjpDenominator(denominatorInput({ sourceRecordCount: 99 })),
    "DENOMINATOR_RECONCILIATION_FAILED",
  );
  const base = denominatorInput();
  assertContractError(
    () => freezeQavjpDenominator({ ...base, sourceRecordCount: 3, excludedRecordCount: 1, items: [base.items[0], base.items[0]] }),
    "DUPLICATE_DENOMINATOR_ITEM",
  );
  const nonConsented = denominatorInput();
  nonConsented.items[0] = {
    ...nonConsented.items[0],
    consentEvidence: { kind: "SYSTEM_EVENT", id: "consent:501", sha256: HASH_A },
  };
  assertContractError(() => freezeQavjpDenominator(nonConsented), "CONSENT_NOT_VERIFIED");
});

test("QAVJP counts only quality-adjusted verified on-time milestone weight", () => {
  const snapshot = freezeQavjpDenominator(denominatorInput());
  const onTime = createJourneyMilestoneEvent(eventInput());
  const late = createJourneyMilestoneEvent(eventInput({
    eventId: ID.event2,
    applicationRef: "application:202",
    subjectRef: "student:502",
    milestoneCode: "application_submitted",
    dueAt: "2026-09-20T12:00:00.000Z",
    completedAt: "2026-09-21T12:00:00.000Z",
    recordedAt: "2026-09-21T12:00:01.000Z",
    qualityFactorBps: 10_000,
  }));
  const unmatched = createJourneyMilestoneEvent(eventInput({
    eventId: ID.event3,
    applicationRef: "application:999",
  }));

  const result = calculateQavjp(snapshot, [onTime, late, unmatched]);
  assert.equal(result.scoreBps, 4_800);
  assert.equal(result.verifiedOnTimeWeightBps, 6_000);
  assert.equal(result.verifiedOnTimeCount, 1);
  assert.equal(result.verifiedLateCount, 1);
  assert.equal(result.incompleteCount, 0);
  assert.equal(result.unmatchedEventCount, 1);
});

test("conflicting receipts for one dedup key never produce a score", () => {
  const snapshot = freezeQavjpDenominator(denominatorInput());
  const first = createJourneyMilestoneEvent(eventInput());
  const conflicting = createJourneyMilestoneEvent(eventInput({ eventId: ID.event2 }));

  assertContractError(
    () => calculateQavjp(snapshot, [first, conflicting]),
    "CONFLICTING_MILESTONE_EVENTS",
  );
});

test("tampered milestone or denominator content is rejected before scoring", () => {
  const snapshot = freezeQavjpDenominator(denominatorInput());
  const event = createJourneyMilestoneEvent(eventInput());
  const tamperedEvent = { ...event, qualityFactorBps: 10_000 };
  assertContractError(
    () => calculateQavjp(snapshot, [tamperedEvent]),
    "MILESTONE_EVENT_INTEGRITY_FAILED",
  );

  const tamperedSnapshot = { ...snapshot, denominatorWeightBps: 1 };
  assertContractError(
    () => calculateQavjp(tamperedSnapshot, [event]),
    "DENOMINATOR_INTEGRITY_FAILED",
  );
});

test("QAVJP event input is hard bounded", () => {
  const snapshot = freezeQavjpDenominator(denominatorInput());
  const event = createJourneyMilestoneEvent(eventInput());
  assertContractError(
    () => calculateQavjp(snapshot, Array.from({ length: 5_001 }, () => event)),
    "INVALID_EVENT_COUNT",
  );
});
