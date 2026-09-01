import {
  assertCommunicationPreferenceReceiptIntegrity,
  assertCommunicationSuppressionReceiptIntegrity,
  assertConsentReceiptIntegrity,
  type CommunicationPreferenceReceipt,
  type CommunicationSuppressionReceipt,
  type ConsentReceipt,
} from "./consentCommunicationContract.js";

const UUID_V7_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SUBJECT_REF_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_RECEIPTS_PER_KIND = 1_000;

export type StudentPrivacySharingProjectionInput = {
  tenantId: string;
  subjectRef: string;
  consentReceipts: ConsentReceipt[];
  preferenceReceipts: CommunicationPreferenceReceipt[];
  suppressionReceipts: CommunicationSuppressionReceipt[];
  generatedAt?: Date;
};

type ConsentTimelineEntry = {
  kind: "CONSENT";
  purpose: string;
  lawfulBasis: string;
  channel: "in_app" | "email";
  action: "CAPTURED" | "WITHDRAWN";
  sequence: number;
  effectiveAt: string;
  recordedAt: string;
  validUntil: string | null;
  noticeVersion: string;
  policyVersion: string;
  retentionPolicyVersion: string;
  receiptHash: string;
  evidenceSha256: string;
};

type PreferenceTimelineEntry = {
  kind: "PREFERENCE";
  category: CommunicationPreferenceReceipt["category"];
  channel: "in_app" | "email";
  state: "ENABLED" | "DISABLED";
  sequence: number;
  effectiveAt: string;
  recordedAt: string;
  policyVersion: string;
  receiptHash: string;
  evidenceSha256: string;
};

type SuppressionTimelineEntry = {
  kind: "SUPPRESSION";
  channel: "email";
  reason: CommunicationSuppressionReceipt["reason"];
  effectiveAt: string;
  recordedAt: string;
  retentionPolicyVersion: string;
  receiptHash: string;
  evidenceSha256: string;
};

export type StudentPrivacySharingProjection = {
  schemaVersion: 1;
  projectionType: "student.privacy-sharing.read-model.v1";
  generatedAt: string;
  accessMode: "READ_ONLY";
  authorizationEffect: "NONE";
  mutationStatus: "DISABLED_PENDING_COMMAND_CONTROLS";
  redaction: {
    tenantIdentifierIncluded: false;
    subjectIdentifierIncluded: false;
    evidenceReferenceIncluded: false;
    receiptHashesIncluded: true;
  };
  pilotBoundaries: {
    inApp: "LOCAL_READ_ONLY";
    email: "BLOCKED_PRIVACY_LEGAL_PENDING";
    otherExternalChannels: "OUTSIDE_PILOT";
    institutionSharing: "OUTSIDE_PILOT";
    guardianSharing: "OUTSIDE_PILOT";
    sponsorSharing: "OUTSIDE_PILOT";
  };
  sourceReceiptCounts: {
    consent: number;
    preference: number;
    suppression: number;
  };
  currentConsent: Array<{
    purpose: string;
    channel: "in_app" | "email";
    receiptState: "ACTIVE" | "WITHDRAWN" | "EXPIRED" | "NOT_YET_EFFECTIVE";
    deliveryEligibility: "NOT_AUTHORIZED_BY_READ_MODEL";
    effectiveAt: string;
    validUntil: string | null;
    receiptHash: string;
  }>;
  currentPreference: Array<{
    category: CommunicationPreferenceReceipt["category"];
    channel: "in_app" | "email";
    receiptState: "ENABLED" | "DISABLED" | "NOT_YET_EFFECTIVE";
    deliveryEligibility: "NOT_AUTHORIZED_BY_READ_MODEL";
    effectiveAt: string;
    receiptHash: string;
  }>;
  activeSuppressions: Array<{
    channel: "email";
    reason: CommunicationSuppressionReceipt["reason"];
    effectiveAt: string;
    receiptHash: string;
  }>;
  timeline: Array<
    ConsentTimelineEntry | PreferenceTimelineEntry | SuppressionTimelineEntry
  >;
};

export class StudentPrivacySharingProjectionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "StudentPrivacySharingProjectionError";
  }
}

function fail(code: string, message: string): never {
  throw new StudentPrivacySharingProjectionError(code, message);
}

function assertScope(
  receipt: { tenantId: string; subjectRef: string },
  tenantId: string,
  subjectRef: string,
): void {
  if (receipt.tenantId !== tenantId || receipt.subjectRef !== subjectRef) {
    fail("RECEIPT_SCOPE_MISMATCH", "receipt is outside the requested self scope");
  }
}

function assertPilotChannel(value: string): asserts value is "in_app" | "email" {
  if (!(value === "in_app" || value === "email")) {
    fail("CHANNEL_OUTSIDE_PILOT", "receipt channel is outside the G45 pilot");
  }
}

function assertUniqueReceipts(
  receipts: Array<{ receiptId: string; receiptHash: string }>,
  label: string,
): void {
  const ids = new Set<string>();
  const hashes = new Set<string>();
  for (const receipt of receipts) {
    if (ids.has(receipt.receiptId) || hashes.has(receipt.receiptHash)) {
      fail("DUPLICATE_RECEIPT", `${label} contains a duplicate receipt`);
    }
    ids.add(receipt.receiptId);
    hashes.add(receipt.receiptHash);
  }
}

function assertChain<T extends {
  sequence: number;
  effectiveAt: string;
  previousReceiptHash: string | null;
  receiptHash: string;
}>(receipts: T[], label: string): T[] {
  const ordered = [...receipts].sort((left, right) => left.sequence - right.sequence);
  for (let index = 0; index < ordered.length; index += 1) {
    const receipt = ordered[index]!;
    const previous = ordered[index - 1] ?? null;
    if (receipt.sequence !== index + 1) {
      fail("NON_CONTIGUOUS_RECEIPT_CHAIN", `${label} sequence is not contiguous`);
    }
    if (receipt.previousReceiptHash !== (previous?.receiptHash ?? null)) {
      fail("BROKEN_RECEIPT_CHAIN", `${label} previous receipt hash does not match`);
    }
    if (
      previous &&
      new Date(receipt.effectiveAt).getTime() <
        new Date(previous.effectiveAt).getTime()
    ) {
      fail("RETROACTIVE_RECEIPT", `${label} contains retroactive state`);
    }
  }
  return ordered;
}

function groupAndValidateChains<T extends {
  sequence: number;
  effectiveAt: string;
  previousReceiptHash: string | null;
  receiptHash: string;
}>(receipts: T[], keyOf: (receipt: T) => string, label: string): T[] {
  const groups = new Map<string, T[]>();
  for (const receipt of receipts) {
    const key = keyOf(receipt);
    groups.set(key, [...(groups.get(key) ?? []), receipt]);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([key, chain]) => assertChain(chain, `${label}:${key}`));
}

function latestByGroup<T>(
  receipts: T[],
  keyOf: (receipt: T) => string,
  effectiveAtOf: (receipt: T) => string,
  generatedAtMs: number,
): Array<{ latest: T; isEffective: boolean }> {
  const groups = new Map<string, T[]>();
  for (const receipt of receipts) {
    const key = keyOf(receipt);
    groups.set(key, [...(groups.get(key) ?? []), receipt]);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, group]) => {
      const effective = group.filter(
        (receipt) => new Date(effectiveAtOf(receipt)).getTime() <= generatedAtMs,
      );
      return {
        latest: (effective.at(-1) ?? group[0])!,
        isEffective: effective.length > 0,
      };
    });
}

export function buildStudentPrivacySharingProjection(
  input: StudentPrivacySharingProjectionInput,
): StudentPrivacySharingProjection {
  if (!UUID_V7_RE.test(input.tenantId)) {
    fail("INVALID_TENANT_ID", "tenantId must be UUIDv7");
  }
  if (!SUBJECT_REF_RE.test(input.subjectRef)) {
    fail("INVALID_SUBJECT_REF", "subjectRef must be an opaque reference");
  }
  if (
    !Array.isArray(input.consentReceipts) ||
    !Array.isArray(input.preferenceReceipts) ||
    !Array.isArray(input.suppressionReceipts) ||
    input.consentReceipts.length > MAX_RECEIPTS_PER_KIND ||
    input.preferenceReceipts.length > MAX_RECEIPTS_PER_KIND ||
    input.suppressionReceipts.length > MAX_RECEIPTS_PER_KIND
  ) {
    fail("INVALID_RECEIPT_COUNT", "receipt inputs must be bounded arrays");
  }
  const generatedAt = input.generatedAt ?? new Date();
  if (!Number.isFinite(generatedAt.getTime())) {
    fail("INVALID_GENERATED_AT", "generatedAt must be a valid date");
  }
  const generatedAtMs = generatedAt.getTime();

  assertUniqueReceipts(input.consentReceipts, "consentReceipts");
  assertUniqueReceipts(input.preferenceReceipts, "preferenceReceipts");
  assertUniqueReceipts(input.suppressionReceipts, "suppressionReceipts");

  for (const receipt of input.consentReceipts) {
    assertConsentReceiptIntegrity(receipt);
    assertScope(receipt, input.tenantId, input.subjectRef);
    assertPilotChannel(receipt.channel);
  }
  for (const receipt of input.preferenceReceipts) {
    assertCommunicationPreferenceReceiptIntegrity(receipt);
    assertScope(receipt, input.tenantId, input.subjectRef);
    assertPilotChannel(receipt.channel);
  }
  for (const receipt of input.suppressionReceipts) {
    assertCommunicationSuppressionReceiptIntegrity(receipt);
    assertScope(receipt, input.tenantId, input.subjectRef);
    if (receipt.channel !== "email") {
      fail("CHANNEL_OUTSIDE_PILOT", "suppression channel must be email in G45");
    }
  }

  const consents = groupAndValidateChains(
    input.consentReceipts,
    (receipt) => `${receipt.purpose}\0${receipt.channel}`,
    "consent",
  );
  const preferences = groupAndValidateChains(
    input.preferenceReceipts,
    (receipt) => `${receipt.category}\0${receipt.channel}`,
    "preference",
  );

  const currentConsent = latestByGroup(
    consents,
    (receipt) => `${receipt.purpose}\0${receipt.channel}`,
    (receipt) => receipt.effectiveAt,
    generatedAtMs,
  ).map(({ latest, isEffective }) => ({
    purpose: latest.purpose,
    channel: latest.channel as "in_app" | "email",
    receiptState: !isEffective
      ? ("NOT_YET_EFFECTIVE" as const)
      : latest.action === "WITHDRAWN"
        ? ("WITHDRAWN" as const)
        : latest.validUntil !== null &&
            new Date(latest.validUntil).getTime() <= generatedAtMs
          ? ("EXPIRED" as const)
          : ("ACTIVE" as const),
    deliveryEligibility: "NOT_AUTHORIZED_BY_READ_MODEL" as const,
    effectiveAt: latest.effectiveAt,
    validUntil: latest.validUntil,
    receiptHash: latest.receiptHash,
  }));

  const currentPreference = latestByGroup(
    preferences,
    (receipt) => `${receipt.category}\0${receipt.channel}`,
    (receipt) => receipt.effectiveAt,
    generatedAtMs,
  ).map(({ latest, isEffective }) => ({
    category: latest.category,
    channel: latest.channel as "in_app" | "email",
    receiptState: isEffective
      ? latest.state
      : ("NOT_YET_EFFECTIVE" as const),
    deliveryEligibility: "NOT_AUTHORIZED_BY_READ_MODEL" as const,
    effectiveAt: latest.effectiveAt,
    receiptHash: latest.receiptHash,
  }));

  const activeSuppressions = input.suppressionReceipts
    .filter((receipt) => new Date(receipt.effectiveAt).getTime() <= generatedAtMs)
    .sort((left, right) => left.effectiveAt.localeCompare(right.effectiveAt))
    .map((receipt) => ({
      channel: "email" as const,
      reason: receipt.reason,
      effectiveAt: receipt.effectiveAt,
      receiptHash: receipt.receiptHash,
    }));

  const timeline: StudentPrivacySharingProjection["timeline"] = [
    ...consents.map((receipt): ConsentTimelineEntry => ({
      kind: "CONSENT",
      purpose: receipt.purpose,
      lawfulBasis: receipt.lawfulBasis,
      channel: receipt.channel as "in_app" | "email",
      action: receipt.action,
      sequence: receipt.sequence,
      effectiveAt: receipt.effectiveAt,
      recordedAt: receipt.recordedAt,
      validUntil: receipt.validUntil,
      noticeVersion: receipt.noticeVersion,
      policyVersion: receipt.policyVersion,
      retentionPolicyVersion: receipt.retentionPolicyVersion,
      receiptHash: receipt.receiptHash,
      evidenceSha256: receipt.evidence.sha256,
    })),
    ...preferences.map((receipt): PreferenceTimelineEntry => ({
      kind: "PREFERENCE",
      category: receipt.category,
      channel: receipt.channel as "in_app" | "email",
      state: receipt.state,
      sequence: receipt.sequence,
      effectiveAt: receipt.effectiveAt,
      recordedAt: receipt.recordedAt,
      policyVersion: receipt.policyVersion,
      receiptHash: receipt.receiptHash,
      evidenceSha256: receipt.evidence.sha256,
    })),
    ...input.suppressionReceipts.map((receipt): SuppressionTimelineEntry => ({
      kind: "SUPPRESSION",
      channel: "email",
      reason: receipt.reason,
      effectiveAt: receipt.effectiveAt,
      recordedAt: receipt.recordedAt,
      retentionPolicyVersion: receipt.retentionPolicyVersion,
      receiptHash: receipt.receiptHash,
      evidenceSha256: receipt.evidence.sha256,
    })),
  ].sort((left, right) => {
    const recorded = right.recordedAt.localeCompare(left.recordedAt);
    return recorded !== 0 ? recorded : right.receiptHash.localeCompare(left.receiptHash);
  });

  return {
    schemaVersion: 1,
    projectionType: "student.privacy-sharing.read-model.v1",
    generatedAt: generatedAt.toISOString(),
    accessMode: "READ_ONLY",
    authorizationEffect: "NONE",
    mutationStatus: "DISABLED_PENDING_COMMAND_CONTROLS",
    redaction: {
      tenantIdentifierIncluded: false,
      subjectIdentifierIncluded: false,
      evidenceReferenceIncluded: false,
      receiptHashesIncluded: true,
    },
    pilotBoundaries: {
      inApp: "LOCAL_READ_ONLY",
      email: "BLOCKED_PRIVACY_LEGAL_PENDING",
      otherExternalChannels: "OUTSIDE_PILOT",
      institutionSharing: "OUTSIDE_PILOT",
      guardianSharing: "OUTSIDE_PILOT",
      sponsorSharing: "OUTSIDE_PILOT",
    },
    sourceReceiptCounts: {
      consent: consents.length,
      preference: preferences.length,
      suppression: input.suppressionReceipts.length,
    },
    currentConsent,
    currentPreference,
    activeSuppressions,
    timeline,
  };
}
