import crypto from "node:crypto";
import { canonicalJson } from "./jsonCanonical.js";

export const CONSENT_RECEIPT_TYPE = "person.consent.receipt.v1";
export const COMMUNICATION_PREFERENCE_RECEIPT_TYPE =
  "person.communication.preference.receipt.v1";
export const COMMUNICATION_SUPPRESSION_RECEIPT_TYPE =
  "person.communication.suppression.receipt.v1";
export const COMMUNICATION_DECISION_TYPE =
  "notification.communication.decision.v1";

const CONSENT_HASH_DOMAIN = "FAS_CONSENT_RECEIPT\0v1\0";
const PREFERENCE_HASH_DOMAIN = "FAS_COMMUNICATION_PREFERENCE\0v1\0";
const SUPPRESSION_HASH_DOMAIN = "FAS_COMMUNICATION_SUPPRESSION\0v1\0";
const DECISION_INPUT_HASH_DOMAIN = "FAS_COMMUNICATION_DECISION_INPUT\0v1\0";
const DECISION_HASH_DOMAIN = "FAS_COMMUNICATION_DECISION\0v1\0";

const UUID_V7_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/;
const IDENTIFIER_RE = /^[a-z][a-z0-9._:-]{1,95}$/;
const OPAQUE_REF_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const LOCALE_RE = /^[a-z]{2,3}(?:-[A-Z]{2})?$/;
const MAX_CHAIN_LENGTH = 1_000;
const MAX_SUPPRESSIONS = 1_000;

export type ConsentAction = "CAPTURED" | "WITHDRAWN";
export type CommunicationPreferenceState = "ENABLED" | "DISABLED";
export type CommunicationSuppressionReason =
  | "UNSUBSCRIBE"
  | "COMPLAINT"
  | "HARD_BOUNCE";
export type NotificationCategory =
  | "ACTION_REQUIRED"
  | "APPROVAL_REQUIRED"
  | "DEADLINE"
  | "HANDOFF"
  | "SECURITY"
  | "DEGRADED"
  | "INFORMATIONAL";

export type ContractEvidenceRef = {
  id: string;
  sha256: string;
};

export type ConsentReceiptInput = {
  receiptId: string;
  tenantId: string;
  subjectRef: string;
  purpose: string;
  lawfulBasis: string;
  channel: string;
  locale: string;
  noticeVersion: string;
  policyVersion: string;
  retentionPolicyVersion: string;
  action: ConsentAction;
  sequence: number;
  effectiveAt: string;
  recordedAt: string;
  validUntil: string | null;
  previousReceiptHash: string | null;
  evidence: ContractEvidenceRef;
};

export type ConsentReceipt = ConsentReceiptInput & {
  schemaVersion: 1;
  receiptType: typeof CONSENT_RECEIPT_TYPE;
  receiptHash: string;
};

export type CommunicationPreferenceReceiptInput = {
  receiptId: string;
  tenantId: string;
  subjectRef: string;
  category: NotificationCategory;
  channel: string;
  state: CommunicationPreferenceState;
  sequence: number;
  effectiveAt: string;
  recordedAt: string;
  policyVersion: string;
  previousReceiptHash: string | null;
  evidence: ContractEvidenceRef;
};

export type CommunicationPreferenceReceipt =
  CommunicationPreferenceReceiptInput & {
    schemaVersion: 1;
    receiptType: typeof COMMUNICATION_PREFERENCE_RECEIPT_TYPE;
    receiptHash: string;
  };

export type CommunicationSuppressionReceiptInput = {
  receiptId: string;
  tenantId: string;
  subjectRef: string;
  channel: string;
  reason: CommunicationSuppressionReason;
  effectiveAt: string;
  recordedAt: string;
  retentionPolicyVersion: string;
  evidence: ContractEvidenceRef;
};

export type CommunicationSuppressionReceipt =
  CommunicationSuppressionReceiptInput & {
    schemaVersion: 1;
    receiptType: typeof COMMUNICATION_SUPPRESSION_RECEIPT_TYPE;
    receiptHash: string;
  };

export type QuietHoursPolicyInput = {
  policyVersion: string;
  enforced: boolean;
  timeZone: string;
  startsAtMinute: number;
  endsAtMinute: number;
};

export type FrequencyPolicyInput = {
  policyVersion: string;
  windowStartsAt: string;
  windowEndsAt: string;
  maxSuccessfulDeliveries: number;
  observedSuccessfulDeliveries: number;
  evidenceHash: string;
};

export type DedupPolicyInput = {
  policyVersion: string;
  alreadyDelivered: boolean;
  evidenceHash: string;
};

export type ContactPointStateInput = {
  verificationState: "VERIFIED" | "UNVERIFIED";
  verifiedAt: string | null;
  evidenceHash: string;
};

export type CommunicationDecisionInput = {
  decisionId: string;
  tenantId: string;
  intentRef: string;
  taskStateRef: string;
  dedupKey: string;
  subjectRef: string;
  purpose: string;
  category: NotificationCategory;
  channel: string;
  locale: string;
  intendedAt: string;
  evaluatedAt: string;
  decisionPolicyVersion: string;
  consentReceipts: ConsentReceipt[];
  preferenceReceipts: CommunicationPreferenceReceipt[];
  suppressions: CommunicationSuppressionReceipt[];
  contactPoint: ContactPointStateInput;
  quietHours: QuietHoursPolicyInput;
  frequency: FrequencyPolicyInput;
  dedup: DedupPolicyInput;
};

export type CommunicationDecisionReason =
  | "ELIGIBLE"
  | "SUPPRESSED"
  | "DUPLICATE_INTENT"
  | "CONTACT_UNVERIFIED"
  | "CONTACT_VERIFIED_AFTER_INTENT"
  | "CONSENT_MISSING"
  | "CONSENT_NOT_YET_EFFECTIVE"
  | "CONSENT_WITHDRAWN"
  | "CONSENT_EXPIRED"
  | "PREFERENCE_MISSING"
  | "PREFERENCE_NOT_YET_EFFECTIVE"
  | "PREFERENCE_DISABLED"
  | "QUIET_HOURS"
  | "FREQUENCY_CAP_REACHED";

export type CommunicationDecision = {
  schemaVersion: 1;
  decisionType: typeof COMMUNICATION_DECISION_TYPE;
  decisionId: string;
  tenantId: string;
  intentRef: string;
  taskStateRef: string;
  dedupKey: string;
  subjectRef: string;
  purpose: string;
  category: NotificationCategory;
  channel: string;
  locale: string;
  intendedAt: string;
  evaluatedAt: string;
  decisionPolicyVersion: string;
  decision: "ALLOW" | "DENY";
  reason: CommunicationDecisionReason;
  activeConsentReceiptHash: string | null;
  activePreferenceReceiptHash: string | null;
  matchedSuppressionReceiptHash: string | null;
  quietHoursPolicyVersion: string;
  frequencyPolicyVersion: string;
  dedupPolicyVersion: string;
  stateInputHash: string;
  decisionHash: string;
};

export class ConsentCommunicationContractError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ConsentCommunicationContractError";
  }
}

function fail(code: string, message: string): never {
  throw new ConsentCommunicationContractError(code, message);
}

function hash(domain: string, value: unknown): string {
  return crypto
    .createHash("sha256")
    .update(domain, "utf8")
    .update(canonicalJson(value), "utf8")
    .digest("hex");
}

function assertUuidV7(value: string, field: string): string {
  if (!UUID_V7_RE.test(value))
    fail("INVALID_UUID_V7", `${field} must be UUIDv7`);
  return value.toLowerCase();
}

function assertSha256(value: string, field: string): string {
  if (!SHA256_RE.test(value))
    fail("INVALID_SHA256", `${field} must be lowercase SHA-256`);
  return value;
}

function assertIdentifier(value: string, field: string): string {
  if (!IDENTIFIER_RE.test(value))
    fail("INVALID_IDENTIFIER", `${field} is invalid`);
  return value;
}

function assertOpaqueRef(value: string, field: string): string {
  if (!OPAQUE_REF_RE.test(value))
    fail("INVALID_REFERENCE", `${field} is invalid`);
  return value;
}

function assertLocale(value: string): string {
  if (!LOCALE_RE.test(value)) fail("INVALID_LOCALE", "locale is invalid");
  return value;
}

function assertNotificationCategory(value: string): NotificationCategory {
  if (
    ![
      "ACTION_REQUIRED",
      "APPROVAL_REQUIRED",
      "DEADLINE",
      "HANDOFF",
      "SECURITY",
      "DEGRADED",
      "INFORMATIONAL",
    ].includes(value)
  ) {
    fail(
      "INVALID_NOTIFICATION_CATEGORY",
      "category is outside the canonical notification taxonomy",
    );
  }
  return value as NotificationCategory;
}

function assertPositiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail(
      "INVALID_POSITIVE_INTEGER",
      `${field} must be a positive safe integer`,
    );
  }
  return value;
}

function assertNonNegativeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(
      "INVALID_NON_NEGATIVE_INTEGER",
      `${field} must be a non-negative safe integer`,
    );
  }
  return value;
}

function normalizeTimestamp(value: string, field: string): string {
  const parsed = new Date(value);
  if (!value || !Number.isFinite(parsed.getTime())) {
    fail("INVALID_TIMESTAMP", `${field} must be an ISO timestamp`);
  }
  return parsed.toISOString();
}

function normalizeEvidence(
  evidence: ContractEvidenceRef,
  field: string,
): ContractEvidenceRef {
  return {
    id: assertOpaqueRef(evidence.id, `${field}.id`),
    sha256: assertSha256(evidence.sha256, `${field}.sha256`),
  };
}

function normalizePreviousHash(
  value: string | null,
  sequence: number,
): string | null {
  if (sequence === 1) {
    if (value !== null)
      fail(
        "UNEXPECTED_PREVIOUS_RECEIPT",
        "sequence 1 cannot reference a previous receipt",
      );
    return null;
  }
  if (value === null)
    fail(
      "MISSING_PREVIOUS_RECEIPT",
      "sequence greater than 1 requires a previous receipt hash",
    );
  return assertSha256(value, "previousReceiptHash");
}

function assertRecordedAfterEffective(
  effectiveAt: string,
  recordedAt: string,
): void {
  if (new Date(recordedAt).getTime() < new Date(effectiveAt).getTime()) {
    fail("RECORDED_BEFORE_EFFECTIVE", "recordedAt cannot precede effectiveAt");
  }
}

export function createConsentReceipt(
  input: ConsentReceiptInput,
): ConsentReceipt {
  if (!(input.action === "CAPTURED" || input.action === "WITHDRAWN")) {
    fail("INVALID_CONSENT_ACTION", "action must be CAPTURED or WITHDRAWN");
  }
  const sequence = assertPositiveInteger(input.sequence, "sequence");
  const effectiveAt = normalizeTimestamp(input.effectiveAt, "effectiveAt");
  const recordedAt = normalizeTimestamp(input.recordedAt, "recordedAt");
  assertRecordedAfterEffective(effectiveAt, recordedAt);
  let validUntil: string | null = null;
  if (input.validUntil !== null) {
    validUntil = normalizeTimestamp(input.validUntil, "validUntil");
    if (new Date(validUntil).getTime() <= new Date(effectiveAt).getTime()) {
      fail("INVALID_CONSENT_VALIDITY", "validUntil must be after effectiveAt");
    }
  }
  if (input.action === "WITHDRAWN" && validUntil !== null) {
    fail(
      "WITHDRAWAL_CANNOT_EXPIRE",
      "withdrawal receipts cannot carry validUntil",
    );
  }
  const normalized: ConsentReceiptInput = {
    receiptId: assertUuidV7(input.receiptId, "receiptId"),
    tenantId: assertUuidV7(input.tenantId, "tenantId"),
    subjectRef: assertOpaqueRef(input.subjectRef, "subjectRef"),
    purpose: assertIdentifier(input.purpose, "purpose"),
    lawfulBasis: assertIdentifier(input.lawfulBasis, "lawfulBasis"),
    channel: assertIdentifier(input.channel, "channel"),
    locale: assertLocale(input.locale),
    noticeVersion: assertIdentifier(input.noticeVersion, "noticeVersion"),
    policyVersion: assertIdentifier(input.policyVersion, "policyVersion"),
    retentionPolicyVersion: assertIdentifier(
      input.retentionPolicyVersion,
      "retentionPolicyVersion",
    ),
    action: input.action,
    sequence,
    effectiveAt,
    recordedAt,
    validUntil,
    previousReceiptHash: normalizePreviousHash(
      input.previousReceiptHash,
      sequence,
    ),
    evidence: normalizeEvidence(input.evidence, "evidence"),
  };
  const withoutHash: Omit<ConsentReceipt, "receiptHash"> = {
    schemaVersion: 1,
    receiptType: CONSENT_RECEIPT_TYPE,
    ...normalized,
  };
  return {
    ...withoutHash,
    receiptHash: hash(CONSENT_HASH_DOMAIN, withoutHash),
  };
}

export function createCommunicationPreferenceReceipt(
  input: CommunicationPreferenceReceiptInput,
): CommunicationPreferenceReceipt {
  if (!(input.state === "ENABLED" || input.state === "DISABLED")) {
    fail("INVALID_PREFERENCE_STATE", "state must be ENABLED or DISABLED");
  }
  const sequence = assertPositiveInteger(input.sequence, "sequence");
  const effectiveAt = normalizeTimestamp(input.effectiveAt, "effectiveAt");
  const recordedAt = normalizeTimestamp(input.recordedAt, "recordedAt");
  assertRecordedAfterEffective(effectiveAt, recordedAt);
  const normalized: CommunicationPreferenceReceiptInput = {
    receiptId: assertUuidV7(input.receiptId, "receiptId"),
    tenantId: assertUuidV7(input.tenantId, "tenantId"),
    subjectRef: assertOpaqueRef(input.subjectRef, "subjectRef"),
    category: assertNotificationCategory(input.category),
    channel: assertIdentifier(input.channel, "channel"),
    state: input.state,
    sequence,
    effectiveAt,
    recordedAt,
    policyVersion: assertIdentifier(input.policyVersion, "policyVersion"),
    previousReceiptHash: normalizePreviousHash(
      input.previousReceiptHash,
      sequence,
    ),
    evidence: normalizeEvidence(input.evidence, "evidence"),
  };
  const withoutHash: Omit<CommunicationPreferenceReceipt, "receiptHash"> = {
    schemaVersion: 1,
    receiptType: COMMUNICATION_PREFERENCE_RECEIPT_TYPE,
    ...normalized,
  };
  return {
    ...withoutHash,
    receiptHash: hash(PREFERENCE_HASH_DOMAIN, withoutHash),
  };
}

export function createCommunicationSuppressionReceipt(
  input: CommunicationSuppressionReceiptInput,
): CommunicationSuppressionReceipt {
  if (
    !(
      input.reason === "UNSUBSCRIBE" ||
      input.reason === "COMPLAINT" ||
      input.reason === "HARD_BOUNCE"
    )
  ) {
    fail("INVALID_SUPPRESSION_REASON", "suppression reason is invalid");
  }
  const effectiveAt = normalizeTimestamp(input.effectiveAt, "effectiveAt");
  const recordedAt = normalizeTimestamp(input.recordedAt, "recordedAt");
  assertRecordedAfterEffective(effectiveAt, recordedAt);
  const normalized: CommunicationSuppressionReceiptInput = {
    receiptId: assertUuidV7(input.receiptId, "receiptId"),
    tenantId: assertUuidV7(input.tenantId, "tenantId"),
    subjectRef: assertOpaqueRef(input.subjectRef, "subjectRef"),
    channel: assertIdentifier(input.channel, "channel"),
    reason: input.reason,
    effectiveAt,
    recordedAt,
    retentionPolicyVersion: assertIdentifier(
      input.retentionPolicyVersion,
      "retentionPolicyVersion",
    ),
    evidence: normalizeEvidence(input.evidence, "evidence"),
  };
  const withoutHash: Omit<CommunicationSuppressionReceipt, "receiptHash"> = {
    schemaVersion: 1,
    receiptType: COMMUNICATION_SUPPRESSION_RECEIPT_TYPE,
    ...normalized,
  };
  return {
    ...withoutHash,
    receiptHash: hash(SUPPRESSION_HASH_DOMAIN, withoutHash),
  };
}

function assertConsentIntegrity(receipt: ConsentReceipt): void {
  const {
    schemaVersion: _schemaVersion,
    receiptType: _receiptType,
    receiptHash: _receiptHash,
    ...input
  } = receipt;
  if (canonicalJson(createConsentReceipt(input)) !== canonicalJson(receipt)) {
    fail(
      "CONSENT_RECEIPT_INTEGRITY_FAILED",
      "consent receipt content does not match its hash",
    );
  }
}

function assertPreferenceIntegrity(
  receipt: CommunicationPreferenceReceipt,
): void {
  const {
    schemaVersion: _schemaVersion,
    receiptType: _receiptType,
    receiptHash: _receiptHash,
    ...input
  } = receipt;
  if (
    canonicalJson(createCommunicationPreferenceReceipt(input)) !==
    canonicalJson(receipt)
  ) {
    fail(
      "PREFERENCE_RECEIPT_INTEGRITY_FAILED",
      "preference receipt content does not match its hash",
    );
  }
}

function assertSuppressionIntegrity(
  receipt: CommunicationSuppressionReceipt,
): void {
  const {
    schemaVersion: _schemaVersion,
    receiptType: _receiptType,
    receiptHash: _receiptHash,
    ...input
  } = receipt;
  if (
    canonicalJson(createCommunicationSuppressionReceipt(input)) !==
    canonicalJson(receipt)
  ) {
    fail(
      "SUPPRESSION_RECEIPT_INTEGRITY_FAILED",
      "suppression receipt content does not match its hash",
    );
  }
}

function validateReceiptChain<
  T extends {
    sequence: number;
    effectiveAt: string;
    receiptHash: string;
    previousReceiptHash: string | null;
  },
>(receipts: T[], integrity: (receipt: T) => void, chainName: string): T[] {
  if (!Array.isArray(receipts) || receipts.length > MAX_CHAIN_LENGTH) {
    fail(
      "INVALID_RECEIPT_CHAIN_SIZE",
      `${chainName} cannot exceed ${MAX_CHAIN_LENGTH} receipts`,
    );
  }
  const ordered = [...receipts].sort(
    (left, right) => left.sequence - right.sequence,
  );
  let previous: T | null = null;
  for (let index = 0; index < ordered.length; index += 1) {
    const receipt = ordered[index]!;
    integrity(receipt);
    if (receipt.sequence !== index + 1) {
      fail(
        "NON_CONTIGUOUS_RECEIPT_CHAIN",
        `${chainName} sequences must start at 1 and be contiguous`,
      );
    }
    if (previous === null) {
      if (receipt.previousReceiptHash !== null) {
        fail(
          "BROKEN_RECEIPT_CHAIN",
          `${chainName} first receipt cannot reference a previous hash`,
        );
      }
    } else {
      if (receipt.previousReceiptHash !== previous.receiptHash) {
        fail(
          "BROKEN_RECEIPT_CHAIN",
          `${chainName} previous receipt hash does not match`,
        );
      }
      if (
        new Date(receipt.effectiveAt).getTime() <
        new Date(previous.effectiveAt).getTime()
      ) {
        fail(
          "RETROACTIVE_RECEIPT",
          `${chainName} cannot insert retroactive state`,
        );
      }
    }
    previous = receipt;
  }
  return ordered;
}

function assertScope(value: string, expected: string, field: string): void {
  if (value !== expected)
    fail(
      "RECEIPT_SCOPE_MISMATCH",
      `${field} does not match the notification intent`,
    );
}

function localMinute(timestamp: string, timeZone: string): number {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    fail(
      "INVALID_TIME_ZONE",
      "quietHours.timeZone must be a valid IANA time zone",
    );
  }
  const parts = formatter.formatToParts(new Date(timestamp));
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  if (!Number.isInteger(hour) || !Number.isInteger(minute))
    fail("INVALID_LOCAL_TIME", "could not resolve local time");
  return (hour % 24) * 60 + minute;
}

function isQuietTime(
  timestamp: string,
  policy: QuietHoursPolicyInput,
): boolean {
  if (!policy.enforced) return false;
  if (policy.startsAtMinute === policy.endsAtMinute) {
    fail("AMBIGUOUS_QUIET_HOURS", "equal quiet-hour bounds are not allowed");
  }
  const minute = localMinute(timestamp, policy.timeZone);
  return policy.startsAtMinute < policy.endsAtMinute
    ? minute >= policy.startsAtMinute && minute < policy.endsAtMinute
    : minute >= policy.startsAtMinute || minute < policy.endsAtMinute;
}

function decisionHash(
  decision: Omit<CommunicationDecision, "decisionHash">,
): string {
  return hash(DECISION_HASH_DOMAIN, decision);
}

export function evaluateCommunicationIntent(
  input: CommunicationDecisionInput,
): CommunicationDecision {
  if (
    !Array.isArray(input.suppressions) ||
    input.suppressions.length > MAX_SUPPRESSIONS
  ) {
    fail(
      "INVALID_SUPPRESSION_COUNT",
      `suppressions cannot exceed ${MAX_SUPPRESSIONS}`,
    );
  }
  const decisionId = assertUuidV7(input.decisionId, "decisionId");
  const tenantId = assertUuidV7(input.tenantId, "tenantId");
  const intentRef = assertOpaqueRef(input.intentRef, "intentRef");
  const taskStateRef = assertOpaqueRef(input.taskStateRef, "taskStateRef");
  const dedupKey = assertOpaqueRef(input.dedupKey, "dedupKey");
  const subjectRef = assertOpaqueRef(input.subjectRef, "subjectRef");
  const purpose = assertIdentifier(input.purpose, "purpose");
  const category = assertNotificationCategory(input.category);
  const channel = assertIdentifier(input.channel, "channel");
  const locale = assertLocale(input.locale);
  const intendedAt = normalizeTimestamp(input.intendedAt, "intendedAt");
  const evaluatedAt = normalizeTimestamp(input.evaluatedAt, "evaluatedAt");
  if (new Date(evaluatedAt).getTime() < new Date(intendedAt).getTime()) {
    fail(
      "DECISION_BEFORE_INTENT",
      "communication must be evaluated at execution time, not before intendedAt",
    );
  }
  const decisionPolicyVersion = assertIdentifier(
    input.decisionPolicyVersion,
    "decisionPolicyVersion",
  );

  const consentReceipts = validateReceiptChain(
    input.consentReceipts,
    assertConsentIntegrity,
    "consentReceipts",
  );
  const preferenceReceipts = validateReceiptChain(
    input.preferenceReceipts,
    assertPreferenceIntegrity,
    "preferenceReceipts",
  );
  if (consentReceipts.length > 0 && consentReceipts[0]!.action !== "CAPTURED") {
    fail(
      "CONSENT_CHAIN_WITHOUT_CAPTURE",
      "the first consent receipt must capture consent",
    );
  }
  for (const receipt of consentReceipts) {
    assertScope(receipt.tenantId, tenantId, "consent.tenantId");
    assertScope(receipt.subjectRef, subjectRef, "consent.subjectRef");
    assertScope(receipt.purpose, purpose, "consent.purpose");
    assertScope(receipt.channel, channel, "consent.channel");
  }
  for (const receipt of preferenceReceipts) {
    assertScope(receipt.tenantId, tenantId, "preference.tenantId");
    assertScope(receipt.subjectRef, subjectRef, "preference.subjectRef");
    assertScope(receipt.category, category, "preference.category");
    assertScope(receipt.channel, channel, "preference.channel");
  }

  const suppressions = input.suppressions.map((receipt) => {
    assertSuppressionIntegrity(receipt);
    assertScope(receipt.tenantId, tenantId, "suppression.tenantId");
    assertScope(receipt.subjectRef, subjectRef, "suppression.subjectRef");
    assertScope(receipt.channel, channel, "suppression.channel");
    return receipt;
  });
  const suppression =
    suppressions
      .filter(
        (receipt) =>
          new Date(receipt.effectiveAt).getTime() <=
          new Date(intendedAt).getTime(),
      )
      .sort(
        (left, right) =>
          new Date(right.effectiveAt).getTime() -
          new Date(left.effectiveAt).getTime(),
      )[0] ?? null;

  const contactPoint: ContactPointStateInput = {
    verificationState: input.contactPoint.verificationState,
    verifiedAt:
      input.contactPoint.verifiedAt === null
        ? null
        : normalizeTimestamp(
            input.contactPoint.verifiedAt,
            "contactPoint.verifiedAt",
          ),
    evidenceHash: assertSha256(
      input.contactPoint.evidenceHash,
      "contactPoint.evidenceHash",
    ),
  };
  if (
    !(
      contactPoint.verificationState === "VERIFIED" ||
      contactPoint.verificationState === "UNVERIFIED"
    )
  ) {
    fail("INVALID_CONTACT_STATE", "contactPoint.verificationState is invalid");
  }
  if (
    contactPoint.verificationState === "VERIFIED" &&
    contactPoint.verifiedAt === null
  ) {
    fail(
      "MISSING_CONTACT_VERIFICATION_TIME",
      "verified contacts require verifiedAt",
    );
  }
  if (
    contactPoint.verificationState === "UNVERIFIED" &&
    contactPoint.verifiedAt !== null
  ) {
    fail(
      "UNEXPECTED_CONTACT_VERIFICATION_TIME",
      "unverified contacts cannot carry verifiedAt",
    );
  }

  const quietHours: QuietHoursPolicyInput = {
    policyVersion: assertIdentifier(
      input.quietHours.policyVersion,
      "quietHours.policyVersion",
    ),
    enforced: input.quietHours.enforced,
    timeZone: input.quietHours.timeZone,
    startsAtMinute: assertNonNegativeInteger(
      input.quietHours.startsAtMinute,
      "quietHours.startsAtMinute",
    ),
    endsAtMinute: assertNonNegativeInteger(
      input.quietHours.endsAtMinute,
      "quietHours.endsAtMinute",
    ),
  };
  if (quietHours.startsAtMinute > 1_439 || quietHours.endsAtMinute > 1_439) {
    fail(
      "INVALID_QUIET_HOURS",
      "quiet-hour minute bounds must be between 0 and 1439",
    );
  }
  localMinute(intendedAt, quietHours.timeZone);

  const frequency: FrequencyPolicyInput = {
    policyVersion: assertIdentifier(
      input.frequency.policyVersion,
      "frequency.policyVersion",
    ),
    windowStartsAt: normalizeTimestamp(
      input.frequency.windowStartsAt,
      "frequency.windowStartsAt",
    ),
    windowEndsAt: normalizeTimestamp(
      input.frequency.windowEndsAt,
      "frequency.windowEndsAt",
    ),
    maxSuccessfulDeliveries: assertPositiveInteger(
      input.frequency.maxSuccessfulDeliveries,
      "frequency.maxSuccessfulDeliveries",
    ),
    observedSuccessfulDeliveries: assertNonNegativeInteger(
      input.frequency.observedSuccessfulDeliveries,
      "frequency.observedSuccessfulDeliveries",
    ),
    evidenceHash: assertSha256(
      input.frequency.evidenceHash,
      "frequency.evidenceHash",
    ),
  };
  const intendedMs = new Date(intendedAt).getTime();
  if (
    new Date(frequency.windowStartsAt).getTime() > intendedMs ||
    new Date(frequency.windowEndsAt).getTime() <= intendedMs
  ) {
    fail(
      "FREQUENCY_WINDOW_MISMATCH",
      "frequency window must contain intendedAt",
    );
  }

  const dedup: DedupPolicyInput = {
    policyVersion: assertIdentifier(
      input.dedup.policyVersion,
      "dedup.policyVersion",
    ),
    alreadyDelivered: input.dedup.alreadyDelivered,
    evidenceHash: assertSha256(input.dedup.evidenceHash, "dedup.evidenceHash"),
  };
  if (typeof dedup.alreadyDelivered !== "boolean") {
    fail("INVALID_DEDUP_STATE", "dedup.alreadyDelivered must be boolean");
  }

  const latestConsent =
    consentReceipts
      .filter(
        (receipt) => new Date(receipt.effectiveAt).getTime() <= intendedMs,
      )
      .at(-1) ?? null;
  const latestPreference =
    preferenceReceipts
      .filter(
        (receipt) => new Date(receipt.effectiveAt).getTime() <= intendedMs,
      )
      .at(-1) ?? null;

  let decision: "ALLOW" | "DENY" = "DENY";
  let reason: CommunicationDecisionReason;
  if (suppression) reason = "SUPPRESSED";
  else if (dedup.alreadyDelivered) reason = "DUPLICATE_INTENT";
  else if (contactPoint.verificationState !== "VERIFIED")
    reason = "CONTACT_UNVERIFIED";
  else if (new Date(contactPoint.verifiedAt!).getTime() > intendedMs)
    reason = "CONTACT_VERIFIED_AFTER_INTENT";
  else if (consentReceipts.length === 0) reason = "CONSENT_MISSING";
  else if (!latestConsent) reason = "CONSENT_NOT_YET_EFFECTIVE";
  else if (latestConsent.action === "WITHDRAWN") reason = "CONSENT_WITHDRAWN";
  else if (
    latestConsent.validUntil !== null &&
    new Date(latestConsent.validUntil).getTime() <= intendedMs
  ) {
    reason = "CONSENT_EXPIRED";
  } else if (preferenceReceipts.length === 0) reason = "PREFERENCE_MISSING";
  else if (!latestPreference) reason = "PREFERENCE_NOT_YET_EFFECTIVE";
  else if (latestPreference.state === "DISABLED")
    reason = "PREFERENCE_DISABLED";
  else if (isQuietTime(intendedAt, quietHours)) reason = "QUIET_HOURS";
  else if (
    frequency.observedSuccessfulDeliveries >= frequency.maxSuccessfulDeliveries
  ) {
    reason = "FREQUENCY_CAP_REACHED";
  } else {
    decision = "ALLOW";
    reason = "ELIGIBLE";
  }

  const normalizedInput = {
    decisionId,
    tenantId,
    intentRef,
    taskStateRef,
    dedupKey,
    subjectRef,
    purpose,
    category,
    channel,
    locale,
    intendedAt,
    evaluatedAt,
    decisionPolicyVersion,
    consentReceipts,
    preferenceReceipts,
    suppressions,
    contactPoint,
    quietHours,
    frequency,
    dedup,
  };
  const withoutHash: Omit<CommunicationDecision, "decisionHash"> = {
    schemaVersion: 1,
    decisionType: COMMUNICATION_DECISION_TYPE,
    decisionId,
    tenantId,
    intentRef,
    taskStateRef,
    dedupKey,
    subjectRef,
    purpose,
    category,
    channel,
    locale,
    intendedAt,
    evaluatedAt,
    decisionPolicyVersion,
    decision,
    reason,
    activeConsentReceiptHash: latestConsent?.receiptHash ?? null,
    activePreferenceReceiptHash: latestPreference?.receiptHash ?? null,
    matchedSuppressionReceiptHash: suppression?.receiptHash ?? null,
    quietHoursPolicyVersion: quietHours.policyVersion,
    frequencyPolicyVersion: frequency.policyVersion,
    dedupPolicyVersion: dedup.policyVersion,
    stateInputHash: hash(DECISION_INPUT_HASH_DOMAIN, normalizedInput),
  };
  return { ...withoutHash, decisionHash: decisionHash(withoutHash) };
}

export function assertCommunicationDecisionIntegrity(
  decision: CommunicationDecision,
): void {
  const { decisionHash: suppliedHash, ...withoutHash } = decision;
  if (decisionHash(withoutHash) !== suppliedHash) {
    fail(
      "COMMUNICATION_DECISION_INTEGRITY_FAILED",
      "communication decision content does not match its hash",
    );
  }
}
