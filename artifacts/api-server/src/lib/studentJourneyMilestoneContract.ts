import crypto from "node:crypto";
import { canonicalJson } from "./jsonCanonical.js";

export const JOURNEY_MILESTONE_EVENT_TYPE = "journey.milestone.completed.v1";
export const QAVJP_DENOMINATOR_TYPE = "journey.qavjp.denominator.frozen.v1";
export const JOURNEY_MILESTONE_DEDUP_DOMAIN = "FAS_JOURNEY_MILESTONE\0v1\0";
export const JOURNEY_MILESTONE_EVENT_HASH_DOMAIN = "FAS_JOURNEY_MILESTONE_EVENT\0v1\0";
export const QAVJP_DENOMINATOR_HASH_DOMAIN = "FAS_QAVJP_DENOMINATOR\0v1\0";

const UUID_V7_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/;
const IDENTIFIER_RE = /^[a-z][a-z0-9._:-]{1,95}$/;
const OPAQUE_REF_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_EVIDENCE_REFS = 20;
const MAX_DENOMINATOR_ITEMS = 1_000;
const MAX_QAVJP_EVENTS = 5_000;
const MAX_ITEM_WEIGHT_BPS = 10_000;

export type JourneyMilestoneVerificationKind =
  | "SYSTEM_EVENT"
  | "VERIFIED_EVIDENCE"
  | "PARTNER_RECEIPT";

export type JourneyMilestoneEvidenceRef = {
  kind: JourneyMilestoneVerificationKind;
  id: string;
  sha256: string;
};

export type JourneyMilestoneEventInput = {
  eventId: string;
  tenantId: string;
  applicationRef: string;
  lifecycleRef: string;
  subjectRef: string;
  aggregateVersion: number;
  milestoneCode: string;
  ownerUserId: number | null;
  nextAction: string | null;
  dueAt: string;
  completedAt: string;
  recordedAt: string;
  verificationKind: JourneyMilestoneVerificationKind;
  evidence: JourneyMilestoneEvidenceRef[];
  qualityFactorBps: number;
  qualityPolicyVersion: string;
  qualityInputHash: string;
};

export type JourneyMilestoneEvent = JourneyMilestoneEventInput & {
  schemaVersion: 1;
  eventType: typeof JOURNEY_MILESTONE_EVENT_TYPE;
  onTime: boolean;
  dedupKey: string;
  eventHash: string;
};

export type QavjpDenominatorItemInput = {
  applicationRef: string;
  lifecycleRef: string;
  subjectRef: string;
  milestoneCode: string;
  dueAt: string;
  ownerUserId: number | null;
  nextAction: string | null;
  weightBps: number;
  consentEvidence: JourneyMilestoneEvidenceRef;
};

export type QavjpDenominatorSnapshotInput = {
  snapshotId: string;
  tenantId: string;
  cohortId: string;
  periodStartsAt: string;
  periodEndsAt: string;
  frozenAt: string;
  eligibilityPolicyVersion: string;
  sourceSnapshotHash: string;
  sourceRecordCount: number;
  excludedRecordCount: number;
  items: QavjpDenominatorItemInput[];
};

export type QavjpDenominatorItem = QavjpDenominatorItemInput & {
  dedupKey: string;
};

export type QavjpDenominatorSnapshot = Omit<QavjpDenominatorSnapshotInput, "items"> & {
  schemaVersion: 1;
  snapshotType: typeof QAVJP_DENOMINATOR_TYPE;
  items: QavjpDenominatorItem[];
  eligibleItemCount: number;
  denominatorWeightBps: number;
  ownerCoverageBps: number;
  nextActionCoverageBps: number;
  snapshotHash: string;
};

export type QavjpResult = {
  schemaVersion: 1;
  snapshotId: string;
  snapshotHash: string;
  scoreBps: number;
  denominatorWeightBps: number;
  verifiedOnTimeWeightBps: number;
  verifiedOnTimeCount: number;
  verifiedLateCount: number;
  incompleteCount: number;
  unmatchedEventCount: number;
};

export class StudentJourneyMilestoneContractError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "StudentJourneyMilestoneContractError";
  }
}

function fail(code: string, message: string): never {
  throw new StudentJourneyMilestoneContractError(code, message);
}

function assertUuidV7(value: string, field: string): string {
  if (!UUID_V7_RE.test(value)) fail("INVALID_UUID_V7", `${field} must be UUIDv7`);
  return value.toLowerCase();
}

function assertSha256(value: string, field: string): string {
  if (!SHA256_RE.test(value)) fail("INVALID_SHA256", `${field} must be lowercase SHA-256`);
  return value;
}

function assertIdentifier(value: string, field: string): string {
  if (!IDENTIFIER_RE.test(value)) fail("INVALID_IDENTIFIER", `${field} is invalid`);
  return value;
}

function assertOpaqueRef(value: string, field: string): string {
  if (!OPAQUE_REF_RE.test(value)) fail("INVALID_REFERENCE", `${field} is invalid`);
  return value;
}

function assertPositiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail("INVALID_POSITIVE_INTEGER", `${field} must be a positive safe integer`);
  }
  return value;
}

function assertNonNegativeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail("INVALID_NON_NEGATIVE_INTEGER", `${field} must be a non-negative safe integer`);
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

function normalizeNullableOwner(value: number | null): number | null {
  return value == null ? null : assertPositiveInteger(value, "ownerUserId");
}

function normalizeNullableAction(value: string | null): string | null {
  return value == null ? null : assertIdentifier(value, "nextAction");
}

function normalizeEvidenceRef(
  evidence: JourneyMilestoneEvidenceRef,
  field: string,
): JourneyMilestoneEvidenceRef {
  if (!(["SYSTEM_EVENT", "VERIFIED_EVIDENCE", "PARTNER_RECEIPT"] as string[]).includes(evidence.kind)) {
    fail("INVALID_EVIDENCE_KIND", `${field}.kind is invalid`);
  }
  return {
    kind: evidence.kind,
    id: assertOpaqueRef(evidence.id, `${field}.id`),
    sha256: assertSha256(evidence.sha256, `${field}.sha256`),
  };
}

function milestoneDedupKey(input: {
  tenantId: string;
  applicationRef: string;
  lifecycleRef: string;
  milestoneCode: string;
}): string {
  const exactIdentity = {
    tenantId: input.tenantId,
    applicationRef: input.applicationRef,
    lifecycleRef: input.lifecycleRef,
    milestoneCode: input.milestoneCode,
  };
  return crypto
    .createHash("sha256")
    .update(JOURNEY_MILESTONE_DEDUP_DOMAIN, "utf8")
    .update(canonicalJson(exactIdentity), "utf8")
    .digest("hex");
}

function eventHash(event: Omit<JourneyMilestoneEvent, "eventHash">): string {
  return crypto
    .createHash("sha256")
    .update(JOURNEY_MILESTONE_EVENT_HASH_DOMAIN, "utf8")
    .update(canonicalJson(event), "utf8")
    .digest("hex");
}

export function createJourneyMilestoneEvent(
  input: JourneyMilestoneEventInput,
): JourneyMilestoneEvent {
  if (!Array.isArray(input.evidence) || input.evidence.length === 0 || input.evidence.length > MAX_EVIDENCE_REFS) {
    fail("INVALID_EVIDENCE_COUNT", `evidence must contain 1-${MAX_EVIDENCE_REFS} references`);
  }
  const evidence = input.evidence.map((item, index) => normalizeEvidenceRef(item, `evidence[${index}]`));
  if (!evidence.some((item) => item.kind === input.verificationKind)) {
    fail("VERIFICATION_EVIDENCE_MISMATCH", "verificationKind requires a matching evidence reference");
  }

  const dueAt = normalizeTimestamp(input.dueAt, "dueAt");
  const completedAt = normalizeTimestamp(input.completedAt, "completedAt");
  const recordedAt = normalizeTimestamp(input.recordedAt, "recordedAt");
  if (new Date(recordedAt).getTime() < new Date(completedAt).getTime()) {
    fail("RECORDED_BEFORE_COMPLETION", "recordedAt cannot precede completedAt");
  }
  const qualityFactorBps = assertNonNegativeInteger(input.qualityFactorBps, "qualityFactorBps");
  if (qualityFactorBps > 10_000) fail("INVALID_QUALITY_FACTOR", "qualityFactorBps cannot exceed 10000");

  const normalizedInput: JourneyMilestoneEventInput = {
    eventId: assertUuidV7(input.eventId, "eventId"),
    tenantId: assertUuidV7(input.tenantId, "tenantId"),
    applicationRef: assertOpaqueRef(input.applicationRef, "applicationRef"),
    lifecycleRef: assertOpaqueRef(input.lifecycleRef, "lifecycleRef"),
    subjectRef: assertOpaqueRef(input.subjectRef, "subjectRef"),
    aggregateVersion: assertPositiveInteger(input.aggregateVersion, "aggregateVersion"),
    milestoneCode: assertIdentifier(input.milestoneCode, "milestoneCode"),
    ownerUserId: normalizeNullableOwner(input.ownerUserId),
    nextAction: normalizeNullableAction(input.nextAction),
    dueAt,
    completedAt,
    recordedAt,
    verificationKind: input.verificationKind,
    evidence,
    qualityFactorBps,
    qualityPolicyVersion: assertIdentifier(input.qualityPolicyVersion, "qualityPolicyVersion"),
    qualityInputHash: assertSha256(input.qualityInputHash, "qualityInputHash"),
  };
  const withoutHash: Omit<JourneyMilestoneEvent, "eventHash"> = {
    schemaVersion: 1,
    eventType: JOURNEY_MILESTONE_EVENT_TYPE,
    ...normalizedInput,
    onTime: new Date(completedAt).getTime() <= new Date(dueAt).getTime(),
    dedupKey: milestoneDedupKey(normalizedInput),
  };
  return { ...withoutHash, eventHash: eventHash(withoutHash) };
}

function coverageBps(count: number, total: number): number {
  return total === 0 ? 0 : Math.round((count * 10_000) / total);
}

export function freezeQavjpDenominator(
  input: QavjpDenominatorSnapshotInput,
): QavjpDenominatorSnapshot {
  if (!Array.isArray(input.items) || input.items.length === 0 || input.items.length > MAX_DENOMINATOR_ITEMS) {
    fail("INVALID_DENOMINATOR_SIZE", `items must contain 1-${MAX_DENOMINATOR_ITEMS} eligible milestones`);
  }
  const periodStartsAt = normalizeTimestamp(input.periodStartsAt, "periodStartsAt");
  const periodEndsAt = normalizeTimestamp(input.periodEndsAt, "periodEndsAt");
  const frozenAt = normalizeTimestamp(input.frozenAt, "frozenAt");
  const periodStartMs = new Date(periodStartsAt).getTime();
  const periodEndMs = new Date(periodEndsAt).getTime();
  if (periodEndMs <= periodStartMs) fail("INVALID_PERIOD", "periodEndsAt must be after periodStartsAt");
  if (new Date(frozenAt).getTime() > periodStartMs) {
    fail("LATE_DENOMINATOR_FREEZE", "denominator must be frozen no later than periodStartsAt");
  }

  const tenantId = assertUuidV7(input.tenantId, "tenantId");
  const items: QavjpDenominatorItem[] = input.items.map((item, index) => {
    const dueAt = normalizeTimestamp(item.dueAt, `items[${index}].dueAt`);
    const dueMs = new Date(dueAt).getTime();
    if (dueMs < periodStartMs || dueMs >= periodEndMs) {
      fail("DUE_OUTSIDE_PERIOD", `items[${index}].dueAt must fall inside the frozen period`);
    }
    const weightBps = assertPositiveInteger(item.weightBps, `items[${index}].weightBps`);
    if (weightBps > MAX_ITEM_WEIGHT_BPS) {
      fail("INVALID_ITEM_WEIGHT", `items[${index}].weightBps cannot exceed ${MAX_ITEM_WEIGHT_BPS}`);
    }
    const applicationRef = assertOpaqueRef(item.applicationRef, `items[${index}].applicationRef`);
    const lifecycleRef = assertOpaqueRef(item.lifecycleRef, `items[${index}].lifecycleRef`);
    const milestoneCode = assertIdentifier(item.milestoneCode, `items[${index}].milestoneCode`);
    const consentEvidence = normalizeEvidenceRef(item.consentEvidence, `items[${index}].consentEvidence`);
    if (consentEvidence.kind !== "VERIFIED_EVIDENCE") {
      fail("CONSENT_NOT_VERIFIED", `items[${index}] requires VERIFIED_EVIDENCE consent`);
    }
    return {
      applicationRef,
      lifecycleRef,
      subjectRef: assertOpaqueRef(item.subjectRef, `items[${index}].subjectRef`),
      milestoneCode,
      dueAt,
      ownerUserId: normalizeNullableOwner(item.ownerUserId),
      nextAction: normalizeNullableAction(item.nextAction),
      weightBps,
      consentEvidence,
      dedupKey: milestoneDedupKey({ tenantId, applicationRef, lifecycleRef, milestoneCode }),
    };
  });
  const uniqueKeys = new Set(items.map((item) => item.dedupKey));
  if (uniqueKeys.size !== items.length) fail("DUPLICATE_DENOMINATOR_ITEM", "denominator contains a duplicate milestone");

  const sourceRecordCount = assertNonNegativeInteger(input.sourceRecordCount, "sourceRecordCount");
  const excludedRecordCount = assertNonNegativeInteger(input.excludedRecordCount, "excludedRecordCount");
  if (sourceRecordCount !== items.length + excludedRecordCount) {
    fail("DENOMINATOR_RECONCILIATION_FAILED", "sourceRecordCount must equal eligible plus excluded records");
  }
  const denominatorWeightBps = items.reduce((sum, item) => sum + item.weightBps, 0);
  const withoutHash: Omit<QavjpDenominatorSnapshot, "snapshotHash"> = {
    schemaVersion: 1,
    snapshotType: QAVJP_DENOMINATOR_TYPE,
    snapshotId: assertUuidV7(input.snapshotId, "snapshotId"),
    tenantId,
    cohortId: assertIdentifier(input.cohortId, "cohortId"),
    periodStartsAt,
    periodEndsAt,
    frozenAt,
    eligibilityPolicyVersion: assertIdentifier(input.eligibilityPolicyVersion, "eligibilityPolicyVersion"),
    sourceSnapshotHash: assertSha256(input.sourceSnapshotHash, "sourceSnapshotHash"),
    sourceRecordCount,
    excludedRecordCount,
    items,
    eligibleItemCount: items.length,
    denominatorWeightBps,
    ownerCoverageBps: coverageBps(items.filter((item) => item.ownerUserId != null).length, items.length),
    nextActionCoverageBps: coverageBps(items.filter((item) => item.nextAction != null).length, items.length),
  };
  const snapshotHash = crypto
    .createHash("sha256")
    .update(QAVJP_DENOMINATOR_HASH_DOMAIN, "utf8")
    .update(canonicalJson(withoutHash), "utf8")
    .digest("hex");
  return { ...withoutHash, snapshotHash };
}

function assertMilestoneEventIntegrity(event: JourneyMilestoneEvent): void {
  const {
    schemaVersion: _schemaVersion,
    eventType: _eventType,
    onTime: _onTime,
    dedupKey: _dedupKey,
    eventHash: _eventHash,
    ...input
  } = event;
  const rebuilt = createJourneyMilestoneEvent(input);
  if (canonicalJson(rebuilt) !== canonicalJson(event)) {
    fail("MILESTONE_EVENT_INTEGRITY_FAILED", "milestone event content does not match its derived fields");
  }
}

function assertDenominatorIntegrity(snapshot: QavjpDenominatorSnapshot): void {
  const {
    schemaVersion: _schemaVersion,
    snapshotType: _snapshotType,
    eligibleItemCount: _eligibleItemCount,
    denominatorWeightBps: _denominatorWeightBps,
    ownerCoverageBps: _ownerCoverageBps,
    nextActionCoverageBps: _nextActionCoverageBps,
    snapshotHash: _snapshotHash,
    items,
    ...input
  } = snapshot;
  const rebuilt = freezeQavjpDenominator({
    ...input,
    items: items.map(({ dedupKey: _dedupKey, ...item }) => item),
  });
  if (canonicalJson(rebuilt) !== canonicalJson(snapshot)) {
    fail("DENOMINATOR_INTEGRITY_FAILED", "denominator content does not match its frozen hash and derived fields");
  }
}

export function calculateQavjp(
  snapshot: QavjpDenominatorSnapshot,
  events: JourneyMilestoneEvent[],
): QavjpResult {
  if (!Array.isArray(events) || events.length > MAX_QAVJP_EVENTS) {
    fail("INVALID_EVENT_COUNT", `events cannot exceed ${MAX_QAVJP_EVENTS}`);
  }
  assertDenominatorIntegrity(snapshot);
  const matchingEvents = new Map<string, JourneyMilestoneEvent>();
  let unmatchedEventCount = 0;
  const denominatorKeys = new Set(snapshot.items.map((item) => item.dedupKey));
  for (const event of events) {
    assertMilestoneEventIntegrity(event);
    if (event.tenantId !== snapshot.tenantId || !denominatorKeys.has(event.dedupKey)) {
      unmatchedEventCount += 1;
      continue;
    }
    const existing = matchingEvents.get(event.dedupKey);
    if (existing && existing.eventHash !== event.eventHash) {
      fail("CONFLICTING_MILESTONE_EVENTS", "multiple non-identical events share one milestone dedup key");
    }
    matchingEvents.set(event.dedupKey, event);
  }

  let weightedQualityNumerator = 0;
  let verifiedOnTimeWeightBps = 0;
  let verifiedOnTimeCount = 0;
  let verifiedLateCount = 0;
  for (const item of snapshot.items) {
    const event = matchingEvents.get(item.dedupKey);
    if (!event) continue;
    if (!event.onTime) {
      verifiedLateCount += 1;
      continue;
    }
    verifiedOnTimeCount += 1;
    verifiedOnTimeWeightBps += item.weightBps;
    weightedQualityNumerator += item.weightBps * event.qualityFactorBps;
  }

  return {
    schemaVersion: 1,
    snapshotId: snapshot.snapshotId,
    snapshotHash: snapshot.snapshotHash,
    scoreBps: Math.round(weightedQualityNumerator / snapshot.denominatorWeightBps),
    denominatorWeightBps: snapshot.denominatorWeightBps,
    verifiedOnTimeWeightBps,
    verifiedOnTimeCount,
    verifiedLateCount,
    incompleteCount: snapshot.items.length - verifiedOnTimeCount - verifiedLateCount,
    unmatchedEventCount,
  };
}
