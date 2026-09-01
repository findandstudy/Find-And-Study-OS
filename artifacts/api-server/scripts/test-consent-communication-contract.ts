import assert from "node:assert/strict";
import test from "node:test";
import {
  ConsentCommunicationContractError,
  assertCommunicationDecisionIntegrity,
  createCommunicationPreferenceReceipt,
  createCommunicationSuppressionReceipt,
  createConsentReceipt,
  evaluateCommunicationIntent,
  type CommunicationDecisionInput,
  type CommunicationPreferenceReceipt,
  type ConsentReceipt,
} from "../src/lib/consentCommunicationContract.js";

const ID = {
  tenant: "018f5000-0000-7000-8000-000000000001",
  consent1: "018f5000-0000-7000-8000-000000000002",
  consent2: "018f5000-0000-7000-8000-000000000003",
  preference1: "018f5000-0000-7000-8000-000000000004",
  preference2: "018f5000-0000-7000-8000-000000000005",
  suppression: "018f5000-0000-7000-8000-000000000006",
  decision: "018f5000-0000-7000-8000-000000000007",
};
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

function capturedConsent(
  overrides: Partial<Parameters<typeof createConsentReceipt>[0]> = {},
): ConsentReceipt {
  return createConsentReceipt({
    receiptId: ID.consent1,
    tenantId: ID.tenant,
    subjectRef: "student:501",
    purpose: "journey_updates",
    lawfulBasis: "policy_input.consent",
    channel: "email",
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
    evidence: { id: "consent-evidence:501", sha256: HASH_A },
    ...overrides,
  });
}

function enabledPreference(
  overrides: Partial<
    Parameters<typeof createCommunicationPreferenceReceipt>[0]
  > = {},
): CommunicationPreferenceReceipt {
  return createCommunicationPreferenceReceipt({
    receiptId: ID.preference1,
    tenantId: ID.tenant,
    subjectRef: "student:501",
    category: "ACTION_REQUIRED",
    channel: "email",
    state: "ENABLED",
    sequence: 1,
    effectiveAt: "2026-09-01T09:00:00.000Z",
    recordedAt: "2026-09-01T09:00:01.000Z",
    policyVersion: "preference_policy_v1",
    previousReceiptHash: null,
    evidence: { id: "preference-evidence:501", sha256: HASH_B },
    ...overrides,
  });
}

function decisionInput(
  overrides: Partial<CommunicationDecisionInput> = {},
): CommunicationDecisionInput {
  return {
    decisionId: ID.decision,
    tenantId: ID.tenant,
    intentRef: "notification-intent:901",
    taskStateRef: "application-task:701",
    dedupKey: "journey-action:application-101:dossier",
    subjectRef: "student:501",
    purpose: "journey_updates",
    category: "ACTION_REQUIRED",
    channel: "email",
    locale: "tr",
    intendedAt: "2026-09-10T12:00:00.000Z",
    evaluatedAt: "2026-09-10T12:00:01.000Z",
    decisionPolicyVersion: "communication_decision_v1",
    consentReceipts: [capturedConsent()],
    preferenceReceipts: [enabledPreference()],
    suppressions: [],
    contactPoint: {
      verificationState: "VERIFIED",
      verifiedAt: "2026-08-20T12:00:00.000Z",
      evidenceHash: HASH_C,
    },
    quietHours: {
      policyVersion: "quiet_hours_v1",
      enforced: true,
      timeZone: "Europe/Istanbul",
      startsAtMinute: 22 * 60,
      endsAtMinute: 8 * 60,
    },
    frequency: {
      policyVersion: "frequency_v1",
      windowStartsAt: "2026-09-10T00:00:00.000Z",
      windowEndsAt: "2026-09-11T00:00:00.000Z",
      maxSuccessfulDeliveries: 3,
      observedSuccessfulDeliveries: 1,
      evidenceHash: HASH_A,
    },
    dedup: {
      policyVersion: "dedup_v1",
      alreadyDelivered: false,
      evidenceHash: HASH_B,
    },
    ...overrides,
  };
}

function assertContractError(action: () => unknown, code: string): void {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof ConsentCommunicationContractError);
    assert.equal(error.code, code);
    return true;
  });
}

test("verified contact plus current consent and enabled preference permits one bounded intent", () => {
  const decision = evaluateCommunicationIntent(decisionInput());
  assert.equal(decision.decision, "ALLOW");
  assert.equal(decision.reason, "ELIGIBLE");
  assert.match(decision.activeConsentReceiptHash!, /^[0-9a-f]{64}$/);
  assert.match(decision.activePreferenceReceiptHash!, /^[0-9a-f]{64}$/);
  assert.equal(decision.matchedSuppressionReceiptHash, null);
  assertCommunicationDecisionIntegrity(decision);
});

test("missing, future, withdrawn and expired consent all fail closed without retroactive authorization", () => {
  assert.equal(
    evaluateCommunicationIntent(decisionInput({ consentReceipts: [] })).reason,
    "CONSENT_MISSING",
  );

  const future = capturedConsent({
    effectiveAt: "2026-09-10T13:00:00.000Z",
    recordedAt: "2026-09-10T13:00:01.000Z",
  });
  assert.equal(
    evaluateCommunicationIntent(decisionInput({ consentReceipts: [future] }))
      .reason,
    "CONSENT_NOT_YET_EFFECTIVE",
  );

  const first = capturedConsent();
  const withdrawn = createConsentReceipt({
    ...first,
    receiptId: ID.consent2,
    action: "WITHDRAWN",
    sequence: 2,
    effectiveAt: "2026-09-05T10:00:00.000Z",
    recordedAt: "2026-09-05T10:00:01.000Z",
    validUntil: null,
    previousReceiptHash: first.receiptHash,
    evidence: { id: "withdrawal-evidence:501", sha256: HASH_C },
  });
  assert.equal(
    evaluateCommunicationIntent(
      decisionInput({ consentReceipts: [first, withdrawn] }),
    ).reason,
    "CONSENT_WITHDRAWN",
  );

  const expired = capturedConsent({ validUntil: "2026-09-10T11:59:59.000Z" });
  assert.equal(
    evaluateCommunicationIntent(decisionInput({ consentReceipts: [expired] }))
      .reason,
    "CONSENT_EXPIRED",
  );
});

test("preference is independent from consent and defaults closed", () => {
  assert.equal(
    evaluateCommunicationIntent(decisionInput({ preferenceReceipts: [] }))
      .reason,
    "PREFERENCE_MISSING",
  );
  const first = enabledPreference();
  const disabled = createCommunicationPreferenceReceipt({
    ...first,
    receiptId: ID.preference2,
    state: "DISABLED",
    sequence: 2,
    effectiveAt: "2026-09-05T10:00:00.000Z",
    recordedAt: "2026-09-05T10:00:01.000Z",
    previousReceiptHash: first.receiptHash,
    evidence: { id: "preference-disable:501", sha256: HASH_C },
  });
  assert.equal(
    evaluateCommunicationIntent(
      decisionInput({ preferenceReceipts: [first, disabled] }),
    ).reason,
    "PREFERENCE_DISABLED",
  );
});

test("unsubscribe, complaint or hard-bounce suppression takes precedence over all positive state", () => {
  for (const reason of ["UNSUBSCRIBE", "COMPLAINT", "HARD_BOUNCE"] as const) {
    const suppression = createCommunicationSuppressionReceipt({
      receiptId: ID.suppression,
      tenantId: ID.tenant,
      subjectRef: "student:501",
      channel: "email",
      reason,
      effectiveAt: "2026-09-09T08:00:00.000Z",
      recordedAt: "2026-09-09T08:00:01.000Z",
      retentionPolicyVersion: "suppression_retention_v1",
      evidence: { id: `suppression:${reason.toLowerCase()}`, sha256: HASH_C },
    });
    const decision = evaluateCommunicationIntent(
      decisionInput({
        suppressions: [suppression],
        dedup: {
          policyVersion: "dedup_v1",
          alreadyDelivered: true,
          evidenceHash: HASH_B,
        },
      }),
    );
    assert.equal(decision.reason, "SUPPRESSED");
    assert.equal(
      decision.matchedSuppressionReceiptHash,
      suppression.receiptHash,
    );
  }
});

test("contact verification is evidence-bound and cannot authorize an earlier intent", () => {
  assert.equal(
    evaluateCommunicationIntent(
      decisionInput({
        contactPoint: {
          verificationState: "UNVERIFIED",
          verifiedAt: null,
          evidenceHash: HASH_C,
        },
      }),
    ).reason,
    "CONTACT_UNVERIFIED",
  );
  assert.equal(
    evaluateCommunicationIntent(
      decisionInput({
        contactPoint: {
          verificationState: "VERIFIED",
          verifiedAt: "2026-09-10T12:00:00.001Z",
          evidenceHash: HASH_C,
        },
      }),
    ).reason,
    "CONTACT_VERIFIED_AFTER_INTENT",
  );
});

test("dedup, local quiet hours and evidence-bound frequency cap each block delivery", () => {
  assert.equal(
    evaluateCommunicationIntent(
      decisionInput({
        dedup: {
          policyVersion: "dedup_v1",
          alreadyDelivered: true,
          evidenceHash: HASH_B,
        },
      }),
    ).reason,
    "DUPLICATE_INTENT",
  );

  assert.equal(
    evaluateCommunicationIntent(
      decisionInput({
        intendedAt: "2026-09-10T20:00:00.000Z",
        evaluatedAt: "2026-09-10T20:00:01.000Z",
      }),
    ).reason,
    "QUIET_HOURS",
  );

  assert.equal(
    evaluateCommunicationIntent(
      decisionInput({
        frequency: {
          policyVersion: "frequency_v1",
          windowStartsAt: "2026-09-10T00:00:00.000Z",
          windowEndsAt: "2026-09-11T00:00:00.000Z",
          maxSuccessfulDeliveries: 3,
          observedSuccessfulDeliveries: 3,
          evidenceHash: HASH_A,
        },
      }),
    ).reason,
    "FREQUENCY_CAP_REACHED",
  );
});

test("receipt chains reject gaps, broken hashes and retroactive insertion", () => {
  const first = capturedConsent();
  const gap = createConsentReceipt({
    ...first,
    receiptId: ID.consent2,
    sequence: 3,
    effectiveAt: "2026-09-05T00:00:00.000Z",
    recordedAt: "2026-09-05T00:00:01.000Z",
    previousReceiptHash: first.receiptHash,
  });
  assertContractError(
    () =>
      evaluateCommunicationIntent(
        decisionInput({ consentReceipts: [first, gap] }),
      ),
    "NON_CONTIGUOUS_RECEIPT_CHAIN",
  );

  const retroactive = createConsentReceipt({
    ...first,
    receiptId: ID.consent2,
    sequence: 2,
    effectiveAt: "2026-08-31T00:00:00.000Z",
    recordedAt: "2026-09-02T00:00:00.000Z",
    previousReceiptHash: first.receiptHash,
  });
  assertContractError(
    () =>
      evaluateCommunicationIntent(
        decisionInput({ consentReceipts: [first, retroactive] }),
      ),
    "RETROACTIVE_RECEIPT",
  );
});

test("mixed tenant or subject receipts are rejected instead of silently filtered", () => {
  const wrongTenant = capturedConsent({
    tenantId: "018f5000-0000-7000-8000-000000000099",
  });
  assertContractError(
    () =>
      evaluateCommunicationIntent(
        decisionInput({ consentReceipts: [wrongTenant] }),
      ),
    "RECEIPT_SCOPE_MISMATCH",
  );
  const wrongSubject = enabledPreference({ subjectRef: "student:999" });
  assertContractError(
    () =>
      evaluateCommunicationIntent(
        decisionInput({ preferenceReceipts: [wrongSubject] }),
      ),
    "RECEIPT_SCOPE_MISMATCH",
  );
});

test("tampered receipts and decisions fail immutable integrity checks", () => {
  const consent = capturedConsent();
  const tamperedConsent = { ...consent, noticeVersion: "different_notice_v2" };
  assertContractError(
    () =>
      evaluateCommunicationIntent(
        decisionInput({ consentReceipts: [tamperedConsent] }),
      ),
    "CONSENT_RECEIPT_INTEGRITY_FAILED",
  );

  const decision = evaluateCommunicationIntent(decisionInput());
  assertContractError(
    () =>
      assertCommunicationDecisionIntegrity({
        ...decision,
        reason: "FREQUENCY_CAP_REACHED",
      }),
    "COMMUNICATION_DECISION_INTEGRITY_FAILED",
  );
});

test("policy values are versioned inputs and malformed timing or evidence fails closed", () => {
  assertContractError(
    () =>
      evaluateCommunicationIntent(
        decisionInput({ evaluatedAt: "2026-09-10T11:59:59.000Z" }),
      ),
    "DECISION_BEFORE_INTENT",
  );
  assertContractError(
    () =>
      evaluateCommunicationIntent(
        decisionInput({
          frequency: {
            ...decisionInput().frequency,
            evidenceHash: "not-a-hash",
          },
        }),
      ),
    "INVALID_SHA256",
  );
  assertContractError(
    () =>
      evaluateCommunicationIntent(
        decisionInput({
          quietHours: {
            ...decisionInput().quietHours,
            timeZone: "Not/A_Timezone",
          },
        }),
      ),
    "INVALID_TIME_ZONE",
  );
});
