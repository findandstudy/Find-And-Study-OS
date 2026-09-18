import crypto from "node:crypto";
import { types as utilTypes } from "node:util";

import { canonicalJson } from "./jsonCanonical.js";
import {
  PUBLIC_WEB_ENTITY_TYPES,
  type PublicWebEntityType,
  type PublicWebLocale,
} from "./publicWebContentContract.js";
import { PROGRAM_SUPPORTED_LOCALES } from "./programTranslationContract.js";

const REQUIRED_CAPABILITY = "public_web.import_adapter.use" as const;
const MAKER_CAPABILITY = "public_web.import_adapter.create" as const;
const CHECKER_CAPABILITY = "public_web.import_adapter.approve" as const;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const MAX_VALIDATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_APPROVAL_INPUT_BYTES = 32 * 1024;
const MAX_TIMESTAMP_BYTES = 32;
const MAX_COMPATIBLE_TARGETS = 100;
const UUID_V7_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/;
const ADAPTER_ID_RE = /^[a-z][a-z0-9._-]{2,63}$/;
const VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const RELEASE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const APPROVAL_SNAPSHOT_BRAND = Symbol("PublicWebImportAdapterApprovalSnapshot");
const verifiedApprovalSnapshots = new WeakSet<object>();

const REQUEST_KEYS = [
  "actorMembershipId",
  "actorPrincipalId",
  "adapterId",
  "adapterVersion",
  "contractVersion",
  "entityType",
  "locale",
  "mappingSchemaVersion",
  "mappingSha256",
  "organizationId",
  "registryGeneration",
  "runtimeReleaseId",
  "selectionId",
  "sessionGeneration",
  "tenantId",
] as const;
const AUTHORITY_KEYS = [
  "active",
  "actorMembershipId",
  "actorPrincipalId",
  "capability",
  "expiresAt",
  "organizationId",
  "principalType",
  "selectionId",
  "sessionGeneration",
  "tenantId",
] as const;
const REVIEW_AUTHORITY_KEYS = [
  "active",
  "capability",
  "expiresAt",
  "membershipId",
  "organizationId",
  "principalId",
  "principalType",
  "tenantId",
] as const;
const REGISTRY_KEYS = [
  "adapterId",
  "adapterVersion",
  "compatibleTargets",
  "contractVersion",
  "createdByMembershipId",
  "createdByPrincipalId",
  "generation",
  "mappingSchemaVersion",
  "mappingSha256",
  "organizationId",
  "quarantined",
  "registryContentSha256",
  "registryVersionId",
  "runtimeReleaseId",
  "status",
  "tenantId",
] as const;
const VALIDATION_KEYS = [
  "adapterId",
  "adapterVersion",
  "contractVersion",
  "expiresAt",
  "generation",
  "mappingSchemaVersion",
  "mappingSha256",
  "isLatestForRegistryGeneration",
  "organizationId",
  "outcome",
  "registryContentSha256",
  "registryVersionId",
  "runtimeReleaseId",
  "revoked",
  "status",
  "tenantId",
  "validatedAt",
  "validationReceiptId",
] as const;
const REVIEW_KEYS = [
  "adapterId",
  "adapterVersion",
  "checkerMembershipId",
  "checkerPrincipalId",
  "decision",
  "generation",
  "isLatestForRegistryGeneration",
  "makerMembershipId",
  "makerPrincipalId",
  "mappingSha256",
  "organizationId",
  "registryContentSha256",
  "registryVersionId",
  "reviewReceiptId",
  "reviewedAt",
  "revoked",
  "status",
  "tenantId",
  "validationReceiptId",
] as const;
const INPUT_KEYS = [
  "currentActorAuthority",
  "currentCheckerAuthority",
  "currentMakerAuthority",
  "currentRegistryVersion",
  "currentReviewReceipt",
  "currentValidationReceipt",
  "request",
] as const;
const SNAPSHOT_KEYS = [
  "actor",
  "adapter",
  "approvalSnapshotSha256",
  "compatibleTargets",
  "evidence",
  "kind",
  "requestedUse",
  "schemaVersion",
  "scope",
] as const;
const EXPECTATION_KEYS = [
  "actorAuthorityExpiresAt",
  "actorMembershipId",
  "actorPrincipalId",
  "adapterId",
  "adapterVersion",
  "contractVersion",
  "entityType",
  "generation",
  "mappingSchemaVersion",
  "mappingSha256",
  "locale",
  "organizationId",
  "registryVersionId",
  "registryContentSha256",
  "reviewReceiptId",
  "runtimeReleaseId",
  "selectionId",
  "sessionGeneration",
  "tenantId",
  "validationReceiptId",
] as const;
const POLICY_KEYS = [
  "currentRuntimeReleaseId",
  "now",
  "supportedContractVersion",
  "supportedMappingSchemaVersion",
] as const;
const VERIFICATION_KEYS = ["expected", "now"] as const;
const REQUEST_VERIFICATION_KEYS = ["now", "request"] as const;
const SNAPSHOT_SCOPE_KEYS = ["organizationId", "tenantId"] as const;
const SNAPSHOT_ACTOR_KEYS = [
  "authorityExpiresAt",
  "capability",
  "membershipId",
  "principalId",
  "selectionId",
  "sessionGeneration",
] as const;
const SNAPSHOT_REQUESTED_USE_KEYS = ["entityType", "locale"] as const;
const SNAPSHOT_ADAPTER_KEYS = [
  "adapterId",
  "adapterVersion",
  "contractVersion",
  "generation",
  "mappingSchemaVersion",
  "mappingSha256",
  "registryContentSha256",
  "registryVersionId",
  "runtimeReleaseId",
] as const;
const COMPATIBLE_TARGET_KEYS = ["entityType", "locale"] as const;
const SNAPSHOT_EVIDENCE_KEYS = [
  "checkerAuthorityExpiresAt",
  "checkerAuthoritySha256",
  "makerAuthorityExpiresAt",
  "makerAuthoritySha256",
  "reviewReceiptContentSha256",
  "reviewReceiptId",
  "reviewedAt",
  "validatedAt",
  "validationExpiresAt",
  "validationReceiptContentSha256",
  "validationReceiptId",
] as const;

export type PublicWebImportAdapterApprovalRequest = Readonly<{
  tenantId: string;
  organizationId: string;
  actorPrincipalId: string;
  actorMembershipId: string;
  selectionId: string;
  sessionGeneration: number;
  adapterId: string;
  adapterVersion: string;
  mappingSha256: string;
  contractVersion: string;
  mappingSchemaVersion: number;
  runtimeReleaseId: string;
  registryGeneration: number;
  entityType: PublicWebEntityType;
  locale: PublicWebLocale;
}>;

type ApprovalRequest = PublicWebImportAdapterApprovalRequest;

type CurrentAuthority = Pick<
  ApprovalRequest,
  | "tenantId"
  | "organizationId"
  | "actorPrincipalId"
  | "actorMembershipId"
  | "selectionId"
  | "sessionGeneration"
> & {
  principalType: "HUMAN";
  capability: typeof REQUIRED_CAPABILITY;
  active: true;
  expiresAt: string;
};

type CurrentReviewAuthority = {
  tenantId: string;
  organizationId: string;
  principalId: string;
  membershipId: string;
  principalType: "HUMAN";
  capability: typeof MAKER_CAPABILITY | typeof CHECKER_CAPABILITY;
  active: true;
  expiresAt: string;
};

type RegistryVersion = Pick<
  ApprovalRequest,
  | "tenantId"
  | "organizationId"
  | "adapterId"
  | "adapterVersion"
  | "mappingSha256"
  | "contractVersion"
  | "mappingSchemaVersion"
  | "runtimeReleaseId"
> & {
  registryVersionId: string;
  generation: number;
  registryContentSha256: string;
  status: "ACTIVE";
  quarantined: false;
  compatibleTargets: readonly Readonly<{
    entityType: PublicWebEntityType;
    locale: PublicWebLocale;
  }>[];
  createdByPrincipalId: string;
  createdByMembershipId: string;
};

type ValidationReceipt = Pick<
  RegistryVersion,
  | "tenantId"
  | "organizationId"
  | "registryVersionId"
  | "adapterId"
  | "adapterVersion"
  | "mappingSha256"
  | "contractVersion"
  | "mappingSchemaVersion"
  | "runtimeReleaseId"
  | "generation"
  | "registryContentSha256"
> & {
  validationReceiptId: string;
  outcome: "PASS";
  status: "CURRENT";
  isLatestForRegistryGeneration: true;
  revoked: false;
  validatedAt: string;
  expiresAt: string;
};

type ReviewReceipt = Pick<
  RegistryVersion,
  | "tenantId"
  | "organizationId"
  | "registryVersionId"
  | "adapterId"
  | "adapterVersion"
  | "mappingSha256"
  | "generation"
  | "registryContentSha256"
> & {
  validationReceiptId: string;
  reviewReceiptId: string;
  makerPrincipalId: string;
  makerMembershipId: string;
  checkerPrincipalId: string;
  checkerMembershipId: string;
  decision: "APPROVED";
  status: "CURRENT";
  isLatestForRegistryGeneration: true;
  revoked: false;
  reviewedAt: string;
};

export type PublicWebImportAdapterApprovalSnapshot = {
  readonly schemaVersion: 1;
  readonly kind: "FAS_PUBLIC_WEB_IMPORT_ADAPTER_APPROVAL";
  readonly scope: Readonly<{
    tenantId: string;
    organizationId: string;
  }>;
  readonly actor: Readonly<{
    principalId: string;
    membershipId: string;
    selectionId: string;
    sessionGeneration: number;
    capability: typeof REQUIRED_CAPABILITY;
    authorityExpiresAt: string;
  }>;
  readonly requestedUse: Readonly<{
    entityType: PublicWebEntityType;
    locale: PublicWebLocale;
  }>;
  readonly adapter: Readonly<{
    registryVersionId: string;
    adapterId: string;
    adapterVersion: string;
    mappingSha256: string;
    contractVersion: string;
    mappingSchemaVersion: number;
    runtimeReleaseId: string;
    generation: number;
    registryContentSha256: string;
  }>;
  readonly compatibleTargets: readonly Readonly<{
    entityType: PublicWebEntityType;
    locale: PublicWebLocale;
  }>[];
  readonly evidence: Readonly<{
    validationReceiptId: string;
    reviewReceiptId: string;
    validationReceiptContentSha256: string;
    reviewReceiptContentSha256: string;
    makerAuthoritySha256: string;
    checkerAuthoritySha256: string;
    validatedAt: string;
    validationExpiresAt: string;
    reviewedAt: string;
    makerAuthorityExpiresAt: string;
    checkerAuthorityExpiresAt: string;
  }>;
  readonly approvalSnapshotSha256: string;
};

export type PublicWebImportAdapterApprovalExpectation = Readonly<{
  tenantId: string;
  organizationId: string;
  actorPrincipalId: string;
  actorMembershipId: string;
  selectionId: string;
  sessionGeneration: number;
  actorAuthorityExpiresAt: string;
  registryVersionId: string;
  adapterId: string;
  adapterVersion: string;
  mappingSha256: string;
  contractVersion: string;
  mappingSchemaVersion: number;
  runtimeReleaseId: string;
  generation: number;
  registryContentSha256: string;
  entityType: PublicWebEntityType;
  locale: PublicWebLocale;
  validationReceiptId: string;
  reviewReceiptId: string;
}>;

export type PublicWebImportAdapterApprovalServerPolicy = Readonly<{
  now: number;
  supportedContractVersion: string;
  supportedMappingSchemaVersion: number;
  currentRuntimeReleaseId: string;
}>;

export type PublicWebImportAdapterApprovalVerification = Readonly<{
  now: number;
  expected: PublicWebImportAdapterApprovalExpectation;
}>;

export type PublicWebImportAdapterApprovalRequestVerification = Readonly<{
  now: number;
  request: PublicWebImportAdapterApprovalRequest;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  try {
    if (
      value === null ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      utilTypes.isProxy(value)
    ) return false;
    const prototype = Reflect.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function snapshotExactDataRecord(
  value: unknown,
  expected: readonly string[],
): Readonly<Record<string, unknown>> | null {
  if (!isRecord(value)) return null;
  try {
    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.length !== expected.length ||
      ownKeys.some((key) => typeof key !== "string")
    ) return null;
    const actual = (ownKeys as string[]).sort();
    const wanted = [...expected].sort();
    if (!actual.every((key, index) => key === wanted[index])) return null;

    const snapshot: Record<string, unknown> = Object.create(null);
    for (const key of expected) {
      const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        !("value" in descriptor) ||
        descriptor.enumerable !== true
      ) return null;
      snapshot[key] = descriptor.value;
    }
    return Object.freeze(snapshot);
  } catch {
    return null;
  }
}

function hasExactFrozenDataRecord(
  value: unknown,
  expected: readonly string[],
): value is Readonly<Record<string, unknown>> {
  if (!isRecord(value) || !Object.isFrozen(value)) return false;
  return snapshotExactDataRecord(value, expected) !== null;
}

function boundedString(
  value: unknown,
  maximumBytes: number,
  pattern: RegExp,
): value is string {
  return typeof value === "string" &&
    Buffer.byteLength(value, "utf8") <= maximumBytes &&
    pattern.test(value);
}

function isUuidV7(value: unknown): value is string {
  return boundedString(value, 36, UUID_V7_RE);
}

function isSha256(value: unknown): value is string {
  return boundedString(value, 64, SHA256_RE);
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1;
}

function timestamp(value: unknown): number | null {
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value, "utf8") > MAX_TIMESTAMP_BYTES
  ) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  try {
    return new Date(parsed).toISOString() === value ? parsed : null;
  } catch {
    return null;
  }
}

function exactUuid(value: unknown): string | null {
  return isUuidV7(value) ? value.toLowerCase() : null;
}

function parsePolicy(
  value: unknown,
): PublicWebImportAdapterApprovalServerPolicy | null {
  const record = snapshotExactDataRecord(value, POLICY_KEYS);
  if (!record) return null;
  const {
    now,
    supportedContractVersion,
    supportedMappingSchemaVersion,
    currentRuntimeReleaseId,
  } = record;
  if (
    !Number.isSafeInteger(now) ||
    Number(now) < 0 ||
    !boundedString(supportedContractVersion, 64, VERSION_RE) ||
    !positiveInteger(supportedMappingSchemaVersion) ||
    !boundedString(currentRuntimeReleaseId, 128, RELEASE_ID_RE)
  ) return null;
  return Object.freeze({
    now: Number(now),
    supportedContractVersion,
    supportedMappingSchemaVersion: Number(supportedMappingSchemaVersion),
    currentRuntimeReleaseId,
  });
}

function parseRequest(
  value: unknown,
  policy: PublicWebImportAdapterApprovalServerPolicy,
): ApprovalRequest | null {
  const record = snapshotExactDataRecord(value, REQUEST_KEYS);
  if (!record) return null;
  const {
    sessionGeneration,
    registryGeneration,
    adapterId,
    adapterVersion,
    mappingSha256,
    contractVersion,
    mappingSchemaVersion,
    runtimeReleaseId,
    entityType,
    locale,
  } = record;
  const tenantId = exactUuid(record.tenantId);
  const organizationId = exactUuid(record.organizationId);
  const actorPrincipalId = exactUuid(record.actorPrincipalId);
  const actorMembershipId = exactUuid(record.actorMembershipId);
  const selectionId = exactUuid(record.selectionId);
  if (
    !tenantId || !organizationId || tenantId === organizationId ||
    !actorPrincipalId || !actorMembershipId || !selectionId ||
    !positiveInteger(sessionGeneration) ||
    !positiveInteger(registryGeneration) ||
    !boundedString(adapterId, 64, ADAPTER_ID_RE) ||
    !boundedString(adapterVersion, 64, VERSION_RE) ||
    !isSha256(mappingSha256) ||
    !boundedString(contractVersion, 64, VERSION_RE) ||
    !positiveInteger(mappingSchemaVersion) ||
    !boundedString(runtimeReleaseId, 128, RELEASE_ID_RE) ||
    contractVersion !== policy.supportedContractVersion ||
    mappingSchemaVersion !== policy.supportedMappingSchemaVersion ||
    runtimeReleaseId !== policy.currentRuntimeReleaseId ||
    !PUBLIC_WEB_ENTITY_TYPES.includes(entityType as PublicWebEntityType) ||
    !PROGRAM_SUPPORTED_LOCALES.includes(locale as PublicWebLocale)
  ) return null;
  return Object.freeze({
    tenantId,
    organizationId,
    actorPrincipalId,
    actorMembershipId,
    selectionId,
    sessionGeneration,
    adapterId,
    adapterVersion,
    mappingSha256,
    contractVersion,
    mappingSchemaVersion,
    runtimeReleaseId,
    registryGeneration,
    entityType: entityType as PublicWebEntityType,
    locale: locale as PublicWebLocale,
  });
}

function parseAuthority(value: unknown, now: number): CurrentAuthority | null {
  const record = snapshotExactDataRecord(value, AUTHORITY_KEYS);
  if (!record) return null;
  const expiresAt = timestamp(record.expiresAt);
  const tenantId = exactUuid(record.tenantId);
  const organizationId = exactUuid(record.organizationId);
  const actorPrincipalId = exactUuid(record.actorPrincipalId);
  const actorMembershipId = exactUuid(record.actorMembershipId);
  const selectionId = exactUuid(record.selectionId);
  if (
    !tenantId || !organizationId || tenantId === organizationId ||
    !actorPrincipalId || !actorMembershipId || !selectionId ||
    !positiveInteger(record.sessionGeneration) ||
    record.principalType !== "HUMAN" ||
    record.capability !== REQUIRED_CAPABILITY ||
    record.active !== true ||
    expiresAt === null ||
    expiresAt <= now
  ) return null;
  return Object.freeze({
    tenantId,
    organizationId,
    actorPrincipalId,
    actorMembershipId,
    selectionId,
    sessionGeneration: record.sessionGeneration,
    principalType: "HUMAN",
    capability: REQUIRED_CAPABILITY,
    active: true,
    expiresAt: record.expiresAt as string,
  });
}

function parseReviewAuthority(
  value: unknown,
  now: number,
  requiredCapability: typeof MAKER_CAPABILITY | typeof CHECKER_CAPABILITY,
): CurrentReviewAuthority | null {
  const record = snapshotExactDataRecord(value, REVIEW_AUTHORITY_KEYS);
  if (!record) return null;
  const tenantId = exactUuid(record.tenantId);
  const organizationId = exactUuid(record.organizationId);
  const principalId = exactUuid(record.principalId);
  const membershipId = exactUuid(record.membershipId);
  const expiresAt = timestamp(record.expiresAt);
  if (
    !tenantId || !organizationId || tenantId === organizationId ||
    !principalId || !membershipId ||
    record.principalType !== "HUMAN" ||
    record.capability !== requiredCapability ||
    record.active !== true ||
    expiresAt === null ||
    expiresAt <= now
  ) return null;
  return Object.freeze({
    tenantId,
    organizationId,
    principalId,
    membershipId,
    principalType: "HUMAN",
    capability: requiredCapability,
    active: true,
    expiresAt: record.expiresAt as string,
  });
}

function snapshotExactDataArray(
  value: unknown,
  maximumLength: number,
): readonly unknown[] | null {
  try {
    if (!Array.isArray(value) || utilTypes.isProxy(value)) return null;
    const lengthDescriptor = Reflect.getOwnPropertyDescriptor(value, "length");
    const rawLength = lengthDescriptor && "value" in lengthDescriptor
      ? lengthDescriptor.value
      : undefined;
    if (
      lengthDescriptor === undefined ||
      !("value" in lengthDescriptor) ||
      typeof rawLength !== "number" ||
      !Number.isSafeInteger(rawLength) ||
      rawLength < 1 ||
      rawLength > maximumLength
    ) return null;
    const length = rawLength;
    const expectedKeys = [
      ...Array.from({ length }, (_, index) => String(index)),
      "length",
    ];
    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.length !== expectedKeys.length ||
      ownKeys.some((key) => typeof key !== "string") ||
      !(ownKeys as string[]).sort().every(
        (key, index) => key === [...expectedKeys].sort()[index],
      )
    ) return null;
    const snapshot: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Reflect.getOwnPropertyDescriptor(value, String(index));
      if (
        descriptor === undefined ||
        !("value" in descriptor) ||
        descriptor.enumerable !== true
      ) return null;
      snapshot.push(descriptor.value);
    }
    return Object.freeze(snapshot);
  } catch {
    return null;
  }
}

function parseCompatibleTargets(
  value: unknown,
): RegistryVersion["compatibleTargets"] | null {
  const items = snapshotExactDataArray(value, MAX_COMPATIBLE_TARGETS);
  if (!items) return null;
  const parsed: Array<Readonly<{
    entityType: PublicWebEntityType;
    locale: PublicWebLocale;
  }>> = [];
  const seen = new Set<string>();
  for (const item of items) {
    const record = snapshotExactDataRecord(item, COMPATIBLE_TARGET_KEYS);
    if (
      !record ||
      !PUBLIC_WEB_ENTITY_TYPES.includes(record.entityType as PublicWebEntityType) ||
      !PROGRAM_SUPPORTED_LOCALES.includes(record.locale as PublicWebLocale)
    ) return null;
    const key = `${String(record.entityType)}\0${String(record.locale)}`;
    if (seen.has(key)) return null;
    seen.add(key);
    parsed.push(Object.freeze({
      entityType: record.entityType as PublicWebEntityType,
      locale: record.locale as PublicWebLocale,
    }));
  }
  return Object.freeze(parsed.sort((left, right) => {
    const leftKey = `${left.entityType}\0${left.locale}`;
    const rightKey = `${right.entityType}\0${right.locale}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  }));
}

function registryContentSha256(registry: RegistryVersion): string {
  return crypto
    .createHash("sha256")
    .update("fas.public-web.import-adapter-registry-content.v1\0", "utf8")
    .update(canonicalJson({
      tenantId: registry.tenantId,
      organizationId: registry.organizationId,
      registryVersionId: registry.registryVersionId,
      adapterId: registry.adapterId,
      adapterVersion: registry.adapterVersion,
      mappingSha256: registry.mappingSha256,
      contractVersion: registry.contractVersion,
      mappingSchemaVersion: registry.mappingSchemaVersion,
      runtimeReleaseId: registry.runtimeReleaseId,
      generation: registry.generation,
      compatibleTargets: registry.compatibleTargets,
      createdByPrincipalId: registry.createdByPrincipalId,
      createdByMembershipId: registry.createdByMembershipId,
    }), "utf8")
    .digest("hex");
}

function parseRegistry(value: unknown): RegistryVersion | null {
  const record = snapshotExactDataRecord(value, REGISTRY_KEYS);
  if (!record) return null;
  const tenantId = exactUuid(record.tenantId);
  const organizationId = exactUuid(record.organizationId);
  const registryVersionId = exactUuid(record.registryVersionId);
  const createdByPrincipalId = exactUuid(record.createdByPrincipalId);
  const createdByMembershipId = exactUuid(record.createdByMembershipId);
  const compatibleTargets = parseCompatibleTargets(record.compatibleTargets);
  if (
    !tenantId || !organizationId || tenantId === organizationId ||
    !registryVersionId || !createdByPrincipalId || !createdByMembershipId ||
    !boundedString(record.adapterId, 64, ADAPTER_ID_RE) ||
    !boundedString(record.adapterVersion, 64, VERSION_RE) ||
    !isSha256(record.mappingSha256) ||
    !boundedString(record.contractVersion, 64, VERSION_RE) ||
    !positiveInteger(record.mappingSchemaVersion) ||
    !boundedString(record.runtimeReleaseId, 128, RELEASE_ID_RE) ||
    !positiveInteger(record.generation) ||
    !isSha256(record.registryContentSha256) ||
    record.status !== "ACTIVE" ||
    record.quarantined !== false ||
    !compatibleTargets
  ) return null;
  const registry: RegistryVersion = Object.freeze({
    tenantId,
    organizationId,
    registryVersionId,
    adapterId: record.adapterId,
    adapterVersion: record.adapterVersion,
    mappingSha256: record.mappingSha256,
    contractVersion: record.contractVersion,
    mappingSchemaVersion: record.mappingSchemaVersion,
    runtimeReleaseId: record.runtimeReleaseId,
    generation: record.generation,
    registryContentSha256: record.registryContentSha256,
    status: "ACTIVE",
    quarantined: false,
    compatibleTargets,
    createdByPrincipalId,
    createdByMembershipId,
  });
  return registryContentSha256(registry) === registry.registryContentSha256
    ? registry
    : null;
}

function parseValidation(value: unknown, now: number): ValidationReceipt | null {
  const record = snapshotExactDataRecord(value, VALIDATION_KEYS);
  if (!record) return null;
  const tenantId = exactUuid(record.tenantId);
  const organizationId = exactUuid(record.organizationId);
  const registryVersionId = exactUuid(record.registryVersionId);
  const validationReceiptId = exactUuid(record.validationReceiptId);
  const validatedAt = timestamp(record.validatedAt);
  const expiresAt = timestamp(record.expiresAt);
  if (
    !tenantId || !organizationId || tenantId === organizationId ||
    !registryVersionId || !validationReceiptId ||
    !boundedString(record.adapterId, 64, ADAPTER_ID_RE) ||
    !boundedString(record.adapterVersion, 64, VERSION_RE) ||
    !isSha256(record.mappingSha256) ||
    !boundedString(record.contractVersion, 64, VERSION_RE) ||
    !positiveInteger(record.mappingSchemaVersion) ||
    !boundedString(record.runtimeReleaseId, 128, RELEASE_ID_RE) ||
    !positiveInteger(record.generation) ||
    !isSha256(record.registryContentSha256) ||
    record.outcome !== "PASS" ||
    record.status !== "CURRENT" ||
    record.isLatestForRegistryGeneration !== true ||
    record.revoked !== false ||
    validatedAt === null ||
    expiresAt === null ||
    validatedAt > now + MAX_CLOCK_SKEW_MS ||
    expiresAt <= now ||
    expiresAt <= validatedAt ||
    expiresAt - validatedAt > MAX_VALIDATION_LIFETIME_MS
  ) return null;
  return Object.freeze({
    tenantId,
    organizationId,
    registryVersionId,
    validationReceiptId,
    adapterId: record.adapterId,
    adapterVersion: record.adapterVersion,
    mappingSha256: record.mappingSha256,
    contractVersion: record.contractVersion,
    mappingSchemaVersion: record.mappingSchemaVersion,
    runtimeReleaseId: record.runtimeReleaseId,
    generation: record.generation,
    registryContentSha256: record.registryContentSha256,
    outcome: "PASS",
    status: "CURRENT",
    isLatestForRegistryGeneration: true,
    revoked: false,
    validatedAt: record.validatedAt as string,
    expiresAt: record.expiresAt as string,
  });
}

function parseReview(value: unknown, now: number): ReviewReceipt | null {
  const record = snapshotExactDataRecord(value, REVIEW_KEYS);
  if (!record) return null;
  const tenantId = exactUuid(record.tenantId);
  const organizationId = exactUuid(record.organizationId);
  const registryVersionId = exactUuid(record.registryVersionId);
  const validationReceiptId = exactUuid(record.validationReceiptId);
  const reviewReceiptId = exactUuid(record.reviewReceiptId);
  const makerPrincipalId = exactUuid(record.makerPrincipalId);
  const makerMembershipId = exactUuid(record.makerMembershipId);
  const checkerPrincipalId = exactUuid(record.checkerPrincipalId);
  const checkerMembershipId = exactUuid(record.checkerMembershipId);
  const reviewedAt = timestamp(record.reviewedAt);
  if (
    !tenantId || !organizationId || tenantId === organizationId ||
    !registryVersionId || !validationReceiptId || !reviewReceiptId ||
    !makerPrincipalId || !makerMembershipId ||
    !checkerPrincipalId || !checkerMembershipId ||
    makerPrincipalId === checkerPrincipalId ||
    makerMembershipId === checkerMembershipId ||
    !boundedString(record.adapterId, 64, ADAPTER_ID_RE) ||
    !boundedString(record.adapterVersion, 64, VERSION_RE) ||
    !isSha256(record.mappingSha256) ||
    !positiveInteger(record.generation) ||
    !isSha256(record.registryContentSha256) ||
    record.decision !== "APPROVED" ||
    record.status !== "CURRENT" ||
    record.isLatestForRegistryGeneration !== true ||
    record.revoked !== false ||
    reviewedAt === null ||
    reviewedAt > now + MAX_CLOCK_SKEW_MS
  ) return null;
  return Object.freeze({
    tenantId,
    organizationId,
    registryVersionId,
    validationReceiptId,
    reviewReceiptId,
    adapterId: record.adapterId,
    adapterVersion: record.adapterVersion,
    mappingSha256: record.mappingSha256,
    generation: record.generation,
    registryContentSha256: record.registryContentSha256,
    makerPrincipalId,
    makerMembershipId,
    checkerPrincipalId,
    checkerMembershipId,
    decision: "APPROVED",
    status: "CURRENT",
    isLatestForRegistryGeneration: true,
    revoked: false,
    reviewedAt: record.reviewedAt as string,
  });
}

function sameIdentity(left: ApprovalRequest, right: CurrentAuthority): boolean {
  return left.tenantId === right.tenantId &&
    left.organizationId === right.organizationId &&
    left.actorPrincipalId === right.actorPrincipalId &&
    left.actorMembershipId === right.actorMembershipId &&
    left.selectionId === right.selectionId &&
    left.sessionGeneration === right.sessionGeneration;
}

function registryMatchesRequest(registry: RegistryVersion, request: ApprovalRequest): boolean {
  return registry.tenantId === request.tenantId &&
    registry.organizationId === request.organizationId &&
    registry.adapterId === request.adapterId &&
    registry.adapterVersion === request.adapterVersion &&
    registry.mappingSha256 === request.mappingSha256 &&
    registry.contractVersion === request.contractVersion &&
    registry.mappingSchemaVersion === request.mappingSchemaVersion &&
    registry.runtimeReleaseId === request.runtimeReleaseId &&
    registry.generation === request.registryGeneration &&
    registry.compatibleTargets.some(
      (target) =>
        target.entityType === request.entityType &&
        target.locale === request.locale,
    );
}

function validationMatchesRegistry(receipt: ValidationReceipt, registry: RegistryVersion): boolean {
  return receipt.tenantId === registry.tenantId &&
    receipt.organizationId === registry.organizationId &&
    receipt.registryVersionId === registry.registryVersionId &&
    receipt.adapterId === registry.adapterId &&
    receipt.adapterVersion === registry.adapterVersion &&
    receipt.mappingSha256 === registry.mappingSha256 &&
    receipt.contractVersion === registry.contractVersion &&
    receipt.mappingSchemaVersion === registry.mappingSchemaVersion &&
    receipt.runtimeReleaseId === registry.runtimeReleaseId &&
    receipt.generation === registry.generation &&
    receipt.registryContentSha256 === registry.registryContentSha256;
}

function reviewMatchesRegistry(
  receipt: ReviewReceipt,
  registry: RegistryVersion,
  validation: ValidationReceipt,
): boolean {
  return receipt.tenantId === registry.tenantId &&
    receipt.organizationId === registry.organizationId &&
    receipt.registryVersionId === registry.registryVersionId &&
    receipt.validationReceiptId === validation.validationReceiptId &&
    receipt.adapterId === registry.adapterId &&
    receipt.adapterVersion === registry.adapterVersion &&
    receipt.mappingSha256 === registry.mappingSha256 &&
    receipt.generation === registry.generation &&
    receipt.registryContentSha256 === registry.registryContentSha256 &&
    receipt.makerPrincipalId === registry.createdByPrincipalId &&
    receipt.makerMembershipId === registry.createdByMembershipId &&
    timestamp(receipt.reviewedAt)! >= timestamp(validation.validatedAt)! &&
    timestamp(receipt.reviewedAt)! < timestamp(validation.expiresAt)!;
}

function reviewAuthoritiesMatch(
  maker: CurrentReviewAuthority,
  checker: CurrentReviewAuthority,
  registry: RegistryVersion,
  review: ReviewReceipt,
): boolean {
  return maker.tenantId === registry.tenantId &&
    maker.organizationId === registry.organizationId &&
    maker.principalId === registry.createdByPrincipalId &&
    maker.membershipId === registry.createdByMembershipId &&
    maker.principalId === review.makerPrincipalId &&
    maker.membershipId === review.makerMembershipId &&
    checker.tenantId === registry.tenantId &&
    checker.organizationId === registry.organizationId &&
    checker.principalId === review.checkerPrincipalId &&
    checker.membershipId === review.checkerMembershipId &&
    maker.principalId !== checker.principalId &&
    maker.membershipId !== checker.membershipId;
}

function contentSha256(domain: string, value: unknown): string {
  return crypto
    .createHash("sha256")
    .update(domain, "utf8")
    .update(canonicalJson(value), "utf8")
    .digest("hex");
}

function approvalSnapshotUnsigned(snapshot: PublicWebImportAdapterApprovalSnapshot) {
  return {
    schemaVersion: snapshot.schemaVersion,
    kind: snapshot.kind,
    scope: snapshot.scope,
    actor: snapshot.actor,
    requestedUse: snapshot.requestedUse,
    adapter: snapshot.adapter,
    compatibleTargets: snapshot.compatibleTargets,
    evidence: snapshot.evidence,
  };
}

function approvalSnapshotSha256(snapshot: PublicWebImportAdapterApprovalSnapshot): string {
  return contentSha256(
    "fas.public-web.import-adapter-approval.v1\0",
    approvalSnapshotUnsigned(snapshot),
  );
}

function requestMatchesSnapshot(
  snapshot: PublicWebImportAdapterApprovalSnapshot,
  request: unknown,
): boolean {
  const record = snapshotExactDataRecord(request, REQUEST_KEYS);
  if (!record) return false;
  return record.tenantId === snapshot.scope.tenantId &&
    record.organizationId === snapshot.scope.organizationId &&
    record.actorPrincipalId === snapshot.actor.principalId &&
    record.actorMembershipId === snapshot.actor.membershipId &&
    record.selectionId === snapshot.actor.selectionId &&
    record.sessionGeneration === snapshot.actor.sessionGeneration &&
    record.adapterId === snapshot.adapter.adapterId &&
    record.adapterVersion === snapshot.adapter.adapterVersion &&
    record.mappingSha256 === snapshot.adapter.mappingSha256 &&
    record.contractVersion === snapshot.adapter.contractVersion &&
    record.mappingSchemaVersion === snapshot.adapter.mappingSchemaVersion &&
    record.runtimeReleaseId === snapshot.adapter.runtimeReleaseId &&
    record.registryGeneration === snapshot.adapter.generation &&
    record.entityType === snapshot.requestedUse.entityType &&
    record.locale === snapshot.requestedUse.locale;
}

function expectationMatches(
  snapshot: PublicWebImportAdapterApprovalSnapshot,
  expected: unknown,
): boolean {
  const record = snapshotExactDataRecord(expected, EXPECTATION_KEYS);
  if (!record) return false;
  return record.tenantId === snapshot.scope.tenantId &&
    record.organizationId === snapshot.scope.organizationId &&
    record.actorPrincipalId === snapshot.actor.principalId &&
    record.actorMembershipId === snapshot.actor.membershipId &&
    record.selectionId === snapshot.actor.selectionId &&
    record.sessionGeneration === snapshot.actor.sessionGeneration &&
    record.actorAuthorityExpiresAt === snapshot.actor.authorityExpiresAt &&
    record.registryVersionId === snapshot.adapter.registryVersionId &&
    record.adapterId === snapshot.adapter.adapterId &&
    record.adapterVersion === snapshot.adapter.adapterVersion &&
    record.mappingSha256 === snapshot.adapter.mappingSha256 &&
    record.contractVersion === snapshot.adapter.contractVersion &&
    record.mappingSchemaVersion === snapshot.adapter.mappingSchemaVersion &&
    record.runtimeReleaseId === snapshot.adapter.runtimeReleaseId &&
    record.generation === snapshot.adapter.generation &&
    record.registryContentSha256 === snapshot.adapter.registryContentSha256 &&
    record.entityType === snapshot.requestedUse.entityType &&
    record.locale === snapshot.requestedUse.locale &&
    record.validationReceiptId === snapshot.evidence.validationReceiptId &&
    record.reviewReceiptId === snapshot.evidence.reviewReceiptId;
}

function hasExactBrandedSnapshotRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || !Object.isFrozen(value)) return false;
  try {
    const ownKeys = Reflect.ownKeys(value);
    const stringKeys = ownKeys.filter((key): key is string => typeof key === "string");
    const symbolKeys = ownKeys.filter((key): key is symbol => typeof key === "symbol");
    if (
      stringKeys.length !== SNAPSHOT_KEYS.length ||
      symbolKeys.length !== 1 ||
      symbolKeys[0] !== APPROVAL_SNAPSHOT_BRAND
    ) return false;
    const actual = [...stringKeys].sort();
    const wanted = [...SNAPSHOT_KEYS].sort();
    if (!actual.every((key, index) => key === wanted[index])) return false;
    for (const key of SNAPSHOT_KEYS) {
      const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        !("value" in descriptor) ||
        descriptor.enumerable !== true
      ) return false;
    }
    const brandDescriptor = Reflect.getOwnPropertyDescriptor(
      value,
      APPROVAL_SNAPSHOT_BRAND,
    );
    return brandDescriptor !== undefined &&
      "value" in brandDescriptor &&
      brandDescriptor.value === true &&
      brandDescriptor.enumerable === false &&
      brandDescriptor.configurable === false &&
      brandDescriptor.writable === false;
  } catch {
    return false;
  }
}

function resolveFreshVerifiedApprovalSnapshot(
  value: unknown,
  now: unknown,
): PublicWebImportAdapterApprovalSnapshot | null {
  if (
    !Number.isSafeInteger(now) ||
    Number(now) < 0 ||
    value === null ||
    typeof value !== "object" ||
    !verifiedApprovalSnapshots.has(value)
  ) return null;
  if (
    !hasExactBrandedSnapshotRecord(value) ||
    !hasExactFrozenDataRecord(value.scope, SNAPSHOT_SCOPE_KEYS) ||
    !hasExactFrozenDataRecord(value.actor, SNAPSHOT_ACTOR_KEYS) ||
    !hasExactFrozenDataRecord(value.requestedUse, SNAPSHOT_REQUESTED_USE_KEYS) ||
    !hasExactFrozenDataRecord(value.adapter, SNAPSHOT_ADAPTER_KEYS) ||
    !Array.isArray(value.compatibleTargets) ||
    utilTypes.isProxy(value.compatibleTargets) ||
    !Object.isFrozen(value.compatibleTargets) ||
    !parseCompatibleTargets(value.compatibleTargets) ||
    !(value.compatibleTargets as unknown[]).every(
      (target) =>
        Object.isFrozen(target) &&
        hasExactFrozenDataRecord(target, COMPATIBLE_TARGET_KEYS),
    ) ||
    !hasExactFrozenDataRecord(value.evidence, SNAPSHOT_EVIDENCE_KEYS) ||
    !isSha256(value.approvalSnapshotSha256)
  ) return null;
  const snapshot = value as PublicWebImportAdapterApprovalSnapshot;
  const authorityExpiresAt = timestamp(snapshot.actor.authorityExpiresAt);
  const validationExpiresAt = timestamp(snapshot.evidence.validationExpiresAt);
  const makerAuthorityExpiresAt = timestamp(
    snapshot.evidence.makerAuthorityExpiresAt,
  );
  const checkerAuthorityExpiresAt = timestamp(
    snapshot.evidence.checkerAuthorityExpiresAt,
  );
  if (
    authorityExpiresAt === null ||
    validationExpiresAt === null ||
    makerAuthorityExpiresAt === null ||
    checkerAuthorityExpiresAt === null ||
    Math.min(
      authorityExpiresAt,
      validationExpiresAt,
      makerAuthorityExpiresAt,
      checkerAuthorityExpiresAt,
    ) <= Number(now) ||
    !snapshot.compatibleTargets.some(
      (target) =>
        target.entityType === snapshot.requestedUse.entityType &&
        target.locale === snapshot.requestedUse.locale,
    ) ||
    approvalSnapshotSha256(snapshot) !== snapshot.approvalSnapshotSha256
  ) return null;
  return snapshot;
}

/**
 * Process-local transient authenticity guard. Structural clones, JSON round-
 * trips, worker messages and caller-forged objects cannot join this exact
 * module instance's private WeakSet. This is deliberately not a durable or
 * cross-process receipt. Every use must supply the current server clock and an
 * exact expected binding; authority and validation expiry are rechecked.
 */
export function isVerifiedPublicWebImportAdapterApprovalSnapshot(
  value: unknown,
  verification: PublicWebImportAdapterApprovalVerification,
): value is PublicWebImportAdapterApprovalSnapshot {
  const verificationRecord = snapshotExactDataRecord(
    verification,
    VERIFICATION_KEYS,
  );
  if (
    !verificationRecord ||
    !Number.isSafeInteger(verificationRecord.now) ||
    Number(verificationRecord.now) < 0
  ) return false;
  const snapshot = resolveFreshVerifiedApprovalSnapshot(
    value,
    verificationRecord.now,
  );
  if (!snapshot) return false;
  return expectationMatches(snapshot, verificationRecord.expected);
}

/**
 * Request-bound process-local guard for preview/preflight callers. Callers pass
 * only the request they already know; they must not inspect an unknown
 * candidate to manufacture a full expectation. Private WeakSet membership is
 * checked before any candidate property or descriptor is read, then the same
 * exact shape, digest and expiry checks as the full-evidence guard run.
 */
export function isVerifiedPublicWebImportAdapterApprovalSnapshotForRequest(
  value: unknown,
  verification: PublicWebImportAdapterApprovalRequestVerification,
): value is PublicWebImportAdapterApprovalSnapshot {
  const verificationRecord = snapshotExactDataRecord(
    verification,
    REQUEST_VERIFICATION_KEYS,
  );
  if (!verificationRecord) return false;
  const snapshot = resolveFreshVerifiedApprovalSnapshot(
    value,
    verificationRecord.now,
  );
  return snapshot !== null &&
    requestMatchesSnapshot(snapshot, verificationRecord.request);
}

/**
 * Pure, default-unwired approval resolver. The current* names are a strict
 * contract: callers must select and lock the current registry generation, the
 * latest non-revoked validation/review receipts and all three live authorities
 * in one exact tenant/organization-scoped transaction. This pure function
 * cannot prove that no newer DB row exists. It does no I/O and accepts no
 * mapping, script, URL, secret or content.
 */
export function resolvePublicWebImportAdapterApproval(
  value: unknown,
  serverPolicy: PublicWebImportAdapterApprovalServerPolicy,
): PublicWebImportAdapterApprovalSnapshot | null {
  const policy = parsePolicy(serverPolicy);
  const input = snapshotExactDataRecord(value, INPUT_KEYS);
  if (!policy || !input) return null;
  const request = parseRequest(input.request, policy);
  const authority = parseAuthority(input.currentActorAuthority, policy.now);
  const registry = parseRegistry(input.currentRegistryVersion);
  const validation = parseValidation(
    input.currentValidationReceipt,
    policy.now,
  );
  const review = parseReview(input.currentReviewReceipt, policy.now);
  const makerAuthority = parseReviewAuthority(
    input.currentMakerAuthority,
    policy.now,
    MAKER_CAPABILITY,
  );
  const checkerAuthority = parseReviewAuthority(
    input.currentCheckerAuthority,
    policy.now,
    CHECKER_CAPABILITY,
  );
  if (
    !request || !authority || !registry || !validation || !review ||
    !makerAuthority || !checkerAuthority ||
    !sameIdentity(request, authority) ||
    !registryMatchesRequest(registry, request) ||
    !validationMatchesRegistry(validation, registry) ||
    !reviewMatchesRegistry(review, registry, validation) ||
    !reviewAuthoritiesMatch(makerAuthority, checkerAuthority, registry, review) ||
    new Set([
      registry.registryVersionId,
      validation.validationReceiptId,
      review.reviewReceiptId,
    ]).size !== 3
  ) return null;
  try {
    const boundedInput = {
      request,
      authority,
      registry,
      validation,
      review,
      makerAuthority,
      checkerAuthority,
    };
    if (
      Buffer.byteLength(canonicalJson(boundedInput), "utf8") >
      MAX_APPROVAL_INPUT_BYTES
    ) return null;
  } catch {
    return null;
  }

  const validationReceiptContentSha256 = contentSha256(
    "fas.public-web.import-adapter-validation-receipt.v1\0",
    validation,
  );
  const reviewReceiptContentSha256 = contentSha256(
    "fas.public-web.import-adapter-review-receipt.v1\0",
    review,
  );
  const makerAuthoritySha256 = contentSha256(
    "fas.public-web.import-adapter-maker-authority.v1\0",
    makerAuthority,
  );
  const checkerAuthoritySha256 = contentSha256(
    "fas.public-web.import-adapter-checker-authority.v1\0",
    checkerAuthority,
  );

  const unsigned = {
    schemaVersion: 1 as const,
    kind: "FAS_PUBLIC_WEB_IMPORT_ADAPTER_APPROVAL" as const,
    scope: {
      tenantId: request.tenantId,
      organizationId: request.organizationId,
    },
    actor: {
      principalId: request.actorPrincipalId,
      membershipId: request.actorMembershipId,
      selectionId: request.selectionId,
      sessionGeneration: request.sessionGeneration,
      capability: REQUIRED_CAPABILITY,
      authorityExpiresAt: authority.expiresAt,
    },
    requestedUse: {
      entityType: request.entityType,
      locale: request.locale,
    },
    adapter: {
      registryVersionId: registry.registryVersionId,
      adapterId: registry.adapterId,
      adapterVersion: registry.adapterVersion,
      mappingSha256: registry.mappingSha256,
      contractVersion: registry.contractVersion,
      mappingSchemaVersion: registry.mappingSchemaVersion,
      runtimeReleaseId: registry.runtimeReleaseId,
      generation: registry.generation,
      registryContentSha256: registry.registryContentSha256,
    },
    compatibleTargets: Object.freeze(
      registry.compatibleTargets.map((target) => Object.freeze({ ...target })),
    ),
    evidence: {
      validationReceiptId: validation.validationReceiptId,
      reviewReceiptId: review.reviewReceiptId,
      validationReceiptContentSha256,
      reviewReceiptContentSha256,
      makerAuthoritySha256,
      checkerAuthoritySha256,
      validatedAt: validation.validatedAt,
      validationExpiresAt: validation.expiresAt,
      reviewedAt: review.reviewedAt,
      makerAuthorityExpiresAt: makerAuthority.expiresAt,
      checkerAuthorityExpiresAt: checkerAuthority.expiresAt,
    },
  };
  const frozenUnsigned = {
    ...unsigned,
    scope: Object.freeze(unsigned.scope),
    actor: Object.freeze(unsigned.actor),
    requestedUse: Object.freeze(unsigned.requestedUse),
    adapter: Object.freeze(unsigned.adapter),
    compatibleTargets: unsigned.compatibleTargets,
    evidence: Object.freeze(unsigned.evidence),
  };
  const snapshot = {
    ...frozenUnsigned,
    approvalSnapshotSha256: contentSha256(
      "fas.public-web.import-adapter-approval.v1\0",
      frozenUnsigned,
    ),
  } as PublicWebImportAdapterApprovalSnapshot;
  Object.defineProperty(snapshot, APPROVAL_SNAPSHOT_BRAND, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  Object.freeze(snapshot);
  verifiedApprovalSnapshots.add(snapshot);
  return snapshot;
}
