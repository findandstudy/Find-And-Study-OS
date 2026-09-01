import assert from "node:assert/strict";
import test from "node:test";
import {
  createCommunicationPreferenceReceipt,
  createCommunicationSuppressionReceipt,
  createConsentReceipt,
  type CommunicationPreferenceReceipt,
  type CommunicationSuppressionReceipt,
  type ConsentReceipt,
} from "../src/lib/consentCommunicationContract.js";
import {
  StudentPrivacySharingProjectionError,
  buildStudentPrivacySharingProjection,
} from "../src/lib/studentPrivacySharingProjection.js";

const ID = {
  tenant: "018f8500-0000-7000-8000-000000000001",
  otherTenant: "018f8500-0000-7000-8000-000000000002",
  consent1: "018f8500-0000-7000-8000-000000000011",
  consent2: "018f8500-0000-7000-8000-000000000012",
  preference1: "018f8500-0000-7000-8000-000000000021",
  suppression1: "018f8500-0000-7000-8000-000000000031",
} as const;
const SUBJECT = "student:synthetic-501";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const NOW = new Date("2026-09-01T12:00:00.000Z");

function consent(
  overrides: Partial<Parameters<typeof createConsentReceipt>[0]> = {},
): ConsentReceipt {
  return createConsentReceipt({
    receiptId: ID.consent1,
    tenantId: ID.tenant,
    subjectRef: SUBJECT,
    purpose: "journey_updates",
    lawfulBasis: "policy_input.consent",
    channel: "in_app",
    locale: "tr",
    noticeVersion: "journey_notice_v1",
    policyVersion: "consent_policy_v1",
    retentionPolicyVersion: "retention_policy_v1",
    action: "CAPTURED",
    sequence: 1,
    effectiveAt: "2026-09-01T09:00:00.000Z",
    recordedAt: "2026-09-01T09:00:01.000Z",
    validUntil: "2026-12-01T00:00:00.000Z",
    previousReceiptHash: null,
    evidence: { id: "private-evidence-ref:consent", sha256: HASH_A },
    ...overrides,
  });
}

function preference(
  overrides: Partial<
    Parameters<typeof createCommunicationPreferenceReceipt>[0]
  > = {},
): CommunicationPreferenceReceipt {
  return createCommunicationPreferenceReceipt({
    receiptId: ID.preference1,
    tenantId: ID.tenant,
    subjectRef: SUBJECT,
    category: "ACTION_REQUIRED",
    channel: "in_app",
    state: "ENABLED",
    sequence: 1,
    effectiveAt: "2026-09-01T09:05:00.000Z",
    recordedAt: "2026-09-01T09:05:01.000Z",
    policyVersion: "preference_policy_v1",
    previousReceiptHash: null,
    evidence: { id: "private-evidence-ref:preference", sha256: HASH_B },
    ...overrides,
  });
}

function suppression(
  overrides: Partial<
    Parameters<typeof createCommunicationSuppressionReceipt>[0]
  > = {},
): CommunicationSuppressionReceipt {
  return createCommunicationSuppressionReceipt({
    receiptId: ID.suppression1,
    tenantId: ID.tenant,
    subjectRef: SUBJECT,
    channel: "email",
    reason: "UNSUBSCRIBE",
    effectiveAt: "2026-09-01T09:10:00.000Z",
    recordedAt: "2026-09-01T09:10:01.000Z",
    retentionPolicyVersion: "suppression_retention_v1",
    evidence: { id: "private-evidence-ref:suppression", sha256: HASH_C },
    ...overrides,
  });
}

function project(overrides: {
  consentReceipts?: ConsentReceipt[];
  preferenceReceipts?: CommunicationPreferenceReceipt[];
  suppressionReceipts?: CommunicationSuppressionReceipt[];
} = {}) {
  return buildStudentPrivacySharingProjection({
    tenantId: ID.tenant,
    subjectRef: SUBJECT,
    consentReceipts: overrides.consentReceipts ?? [],
    preferenceReceipts: overrides.preferenceReceipts ?? [],
    suppressionReceipts: overrides.suppressionReceipts ?? [],
    generatedAt: NOW,
  });
}

function assertProjectionError(action: () => unknown, code: string): void {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof StudentPrivacySharingProjectionError);
    assert.equal(error.code, code);
    return true;
  });
}

test("empty projection is read-only and keeps every external sharing surface closed", () => {
  const result = project();
  assert.equal(result.accessMode, "READ_ONLY");
  assert.equal(result.authorizationEffect, "NONE");
  assert.equal(result.mutationStatus, "DISABLED_PENDING_COMMAND_CONTROLS");
  assert.equal(result.pilotBoundaries.inApp, "LOCAL_READ_ONLY");
  assert.equal(result.pilotBoundaries.email, "BLOCKED_PRIVACY_LEGAL_PENDING");
  assert.equal(result.pilotBoundaries.otherExternalChannels, "OUTSIDE_PILOT");
  assert.equal(result.pilotBoundaries.institutionSharing, "OUTSIDE_PILOT");
  assert.equal(result.pilotBoundaries.guardianSharing, "OUTSIDE_PILOT");
  assert.equal(result.pilotBoundaries.sponsorSharing, "OUTSIDE_PILOT");
});

test("receipt history is deterministic and redacts tenant, subject and evidence references", () => {
  const result = project({
    consentReceipts: [consent()],
    preferenceReceipts: [preference()],
    suppressionReceipts: [suppression()],
  });
  assert.deepEqual(result.sourceReceiptCounts, {
    consent: 1,
    preference: 1,
    suppression: 1,
  });
  assert.deepEqual(result.timeline.map((entry) => entry.kind), [
    "SUPPRESSION",
    "PREFERENCE",
    "CONSENT",
  ]);
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, new RegExp(ID.tenant, "i"));
  assert.doesNotMatch(serialized, /student:synthetic-501/);
  assert.doesNotMatch(serialized, /private-evidence-ref/);
  assert.match(serialized, new RegExp(HASH_A));
});

test("latest effective consent and preference state are projected without authorizing delivery", () => {
  const first = consent();
  const withdrawn = consent({
    receiptId: ID.consent2,
    action: "WITHDRAWN",
    sequence: 2,
    effectiveAt: "2026-09-01T10:00:00.000Z",
    recordedAt: "2026-09-01T10:00:01.000Z",
    validUntil: null,
    previousReceiptHash: first.receiptHash,
    evidence: { id: "private-evidence-ref:withdrawal", sha256: HASH_C },
  });
  const result = project({
    consentReceipts: [withdrawn, first],
    preferenceReceipts: [preference()],
  });
  assert.equal(result.currentConsent[0]?.receiptState, "WITHDRAWN");
  assert.equal(
    result.currentConsent[0]?.deliveryEligibility,
    "NOT_AUTHORIZED_BY_READ_MODEL",
  );
  assert.equal(result.currentPreference[0]?.receiptState, "ENABLED");
  assert.equal(result.pilotBoundaries.email, "BLOCKED_PRIVACY_LEGAL_PENDING");
  assert.doesNotMatch(JSON.stringify(result), /"ALLOW"/);
});

test("future receipts remain visibly not effective", () => {
  const result = project({
    consentReceipts: [
      consent({
        effectiveAt: "2026-09-02T09:00:00.000Z",
        recordedAt: "2026-09-02T09:00:01.000Z",
      }),
    ],
    preferenceReceipts: [
      preference({
        effectiveAt: "2026-09-02T09:05:00.000Z",
        recordedAt: "2026-09-02T09:05:01.000Z",
      }),
    ],
  });
  assert.equal(result.currentConsent[0]?.receiptState, "NOT_YET_EFFECTIVE");
  assert.equal(
    result.currentPreference[0]?.receiptState,
    "NOT_YET_EFFECTIVE",
  );
});

test("active email suppression is surfaced but never converted to a mutation control", () => {
  const result = project({ suppressionReceipts: [suppression()] });
  assert.deepEqual(result.activeSuppressions, [
    {
      channel: "email",
      reason: "UNSUBSCRIBE",
      effectiveAt: "2026-09-01T09:10:00.000Z",
      receiptHash: suppression().receiptHash,
    },
  ]);
  assert.equal(result.mutationStatus, "DISABLED_PENDING_COMMAND_CONTROLS");
});

test("cross-tenant and cross-subject receipt inputs fail closed", () => {
  assertProjectionError(
    () => project({ consentReceipts: [consent({ tenantId: ID.otherTenant })] }),
    "RECEIPT_SCOPE_MISMATCH",
  );
  assertProjectionError(
    () => project({ preferenceReceipts: [preference({ subjectRef: "student:other" })] }),
    "RECEIPT_SCOPE_MISMATCH",
  );
});

test("tampered content and independently valid broken chains fail closed", () => {
  const first = consent();
  assert.throws(
    () => project({ consentReceipts: [{ ...first, noticeVersion: "tampered_v2" }] }),
    /consent receipt content does not match its hash/,
  );
  const broken = consent({
    receiptId: ID.consent2,
    sequence: 2,
    effectiveAt: "2026-09-01T10:00:00.000Z",
    recordedAt: "2026-09-01T10:00:01.000Z",
    previousReceiptHash: HASH_C,
  });
  assertProjectionError(
    () => project({ consentReceipts: [first, broken] }),
    "BROKEN_RECEIPT_CHAIN",
  );
});

test("unknown channels and non-email suppressions remain outside the pilot", () => {
  assertProjectionError(
    () => project({ consentReceipts: [consent({ channel: "sms" })] }),
    "CHANNEL_OUTSIDE_PILOT",
  );
  assertProjectionError(
    () => project({ suppressionReceipts: [suppression({ channel: "in_app" })] }),
    "CHANNEL_OUTSIDE_PILOT",
  );
});

test("duplicate receipt identities cannot inflate the read model", () => {
  const repeated = consent();
  assertProjectionError(
    () => project({ consentReceipts: [repeated, repeated] }),
    "DUPLICATE_RECEIPT",
  );
});
