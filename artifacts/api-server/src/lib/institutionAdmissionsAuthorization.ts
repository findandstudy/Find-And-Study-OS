import {
  evaluateActiveTenantCapability,
  isSelectionBoundActiveTenantContext,
  verifyVersionedActiveTenantContext,
  type ActiveContextDecision,
  type ActiveContextDecisionReason,
  type ActiveContextVerificationKey,
  type ActiveContextVersionedVerificationFailure,
  type ResolvedActiveContextState,
  type VerifiedActiveTenantContext,
} from "./activeTenantContext.js";
import type { InstitutionCapability } from "./institutionAdmissionsPolicy.js";

export const INSTITUTION_AUTHORITY_MAX_RESOLUTION_MS = 5_000;
const UUID_V7_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/;
const RESOURCE_TYPE_RE = /^[a-z][a-z0-9_]{1,63}$/;
const DATA_SCOPE_RE = /^[a-z][a-z0-9_.:-]{1,95}$/;

export type InstitutionMutationIdentity = {
  authenticatedUserId: number;
  authenticatedPrincipalId: string;
  tenantId: string;
  relationshipId: string;
  membershipId: string;
  sessionFingerprint: string;
  impersonatorPrincipalId: string | null;
};

export type InstitutionMutationResource = {
  tenantId: string;
  relationshipId: string;
  resourceType: string;
  resourceId: string;
  requestHash: string;
};

export type InstitutionCurrentSelection = {
  id: string;
  tenantId: string;
  relationshipId: string;
  membershipId: string;
  principalId: string;
  legacyUserId: number;
  sessionFingerprint: string;
  sessionGeneration: number;
  status: "ACTIVE" | "REVOKED" | "EXPIRED" | "REPLACED";
  expiresAt: number;
  impersonatorPrincipalId: string | null;
};

export type InstitutionCurrentRelationship = {
  id: string;
  tenantId: string;
  status: "ACTIVE" | "SUSPENDED" | "REVOKED" | "EXPIRED";
  purposeCode: string;
  dataScopes: readonly string[];
  policyVersion: number;
  validFrom: number;
  validUntil: number | null;
};

export type InstitutionStepUpReceipt = {
  id: string;
  tenantId: string;
  relationshipId: string;
  principalId: string;
  membershipId: string;
  selectionId: string;
  sessionGeneration: number;
  contextId: string;
  capabilityKey: string;
  resourceType: string;
  resourceId: string;
  requestHash: string;
  status: "ACTIVE" | "CONSUMED" | "REVOKED" | "EXPIRED";
  issuedAt: number;
  expiresAt: number;
  consumedAt: number | null;
};

export type InstitutionCurrentAuthority = {
  principalLegacyUserId: number;
  selection: InstitutionCurrentSelection;
  relationship: InstitutionCurrentRelationship;
  state: ResolvedActiveContextState;
  stepUpReceipt: InstitutionStepUpReceipt | null;
};

export type InstitutionAuthorityResolver = (input: {
  context: VerifiedActiveTenantContext & {
    tokenVersion: 2;
    selectionId: string;
    sessionGeneration: number;
  };
  identity: InstitutionMutationIdentity;
  resource: InstitutionMutationResource;
  capabilityKey: InstitutionCapability;
  stepUpReceiptId: string | null;
}) => Promise<InstitutionCurrentAuthority>;

export type InstitutionMutationAuthorizationOptions = {
  activeContextToken: string | undefined;
  stepUpReceiptId: string | null | undefined;
  versionedActiveContext: {
    audience: string;
    environmentId: string;
    cellId: string;
    issuerId: string;
    keyRing: readonly ActiveContextVerificationKey[];
  };
  requestIdentity: unknown;
  resource: unknown;
  capabilityKey: InstitutionCapability;
  requiredDataScope: string;
  approvalSatisfied: boolean;
  resolveCurrentAuthority: InstitutionAuthorityResolver;
  resolutionBudgetMs?: number;
  now?: () => number;
};

export type InstitutionMutationAuthorizationFailure =
  | { reason: "request_identity_invalid" }
  | { reason: "resource_invalid" }
  | { reason: "step_up_receipt_id_invalid" }
  | { reason: "clock_invalid" }
  | {
      reason: "active_context_rejected";
      detail: ActiveContextVersionedVerificationFailure;
    }
  | { reason: "selection_binding_required" }
  | { reason: "authenticated_principal_mismatch" }
  | { reason: "impersonation_forbidden" }
  | { reason: "resource_not_found" }
  | { reason: "authority_unavailable" }
  | { reason: "authority_resolution_timeout" }
  | { reason: "authority_state_invalid" }
  | { reason: "authority_not_current" }
  | { reason: "relationship_not_current" }
  | { reason: "step_up_receipt_invalid" }
  | { reason: "capability_denied"; detail: ActiveContextDecisionReason };

export type InstitutionMutationAuthorizationReceipt = {
  schemaVersion: 1;
  tenantId: string;
  relationshipId: string;
  contextId: string;
  selectionId: string;
  sessionGeneration: number;
  actorPrincipalId: string;
  actorMembershipId: string;
  authenticatedUserId: number;
  capabilityKey: InstitutionCapability;
  requiredDataScope: string;
  policyVersionId: string;
  policyVersion: number;
  resourceType: string;
  resourceId: string;
  requestHash: string;
  stepUpReceiptId: string | null;
  decision: "ALLOW";
  capabilityDecision: ActiveContextDecision;
};

export type InstitutionMutationAuthorizationResult =
  | {
      ok: true;
      context: VerifiedActiveTenantContext & {
        tokenVersion: 2;
        selectionId: string;
        sessionGeneration: number;
      };
      resource: InstitutionMutationResource;
      receipt: InstitutionMutationAuthorizationReceipt;
    }
  | { ok: false; error: InstitutionMutationAuthorizationFailure };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function isUuidV7(value: unknown): value is string {
  return typeof value === "string" && UUID_V7_RE.test(value);
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function isTimestamp(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function parseIdentity(value: unknown): InstitutionMutationIdentity | null {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "authenticatedPrincipalId",
      "authenticatedUserId",
      "impersonatorPrincipalId",
      "membershipId",
      "relationshipId",
      "sessionFingerprint",
      "tenantId",
    ]) ||
    !isPositiveInteger(value.authenticatedUserId) ||
    !isUuidV7(value.authenticatedPrincipalId) ||
    !isUuidV7(value.tenantId) ||
    !isUuidV7(value.relationshipId) ||
    !isUuidV7(value.membershipId) ||
    typeof value.sessionFingerprint !== "string" ||
    !SHA256_RE.test(value.sessionFingerprint) ||
    !(value.impersonatorPrincipalId === null || isUuidV7(value.impersonatorPrincipalId))
  ) return null;
  return {
    authenticatedUserId: Number(value.authenticatedUserId),
    authenticatedPrincipalId: value.authenticatedPrincipalId.toLowerCase(),
    tenantId: value.tenantId.toLowerCase(),
    relationshipId: value.relationshipId.toLowerCase(),
    membershipId: value.membershipId.toLowerCase(),
    sessionFingerprint: value.sessionFingerprint.toLowerCase(),
    impersonatorPrincipalId: value.impersonatorPrincipalId?.toLowerCase() ?? null,
  };
}

function parseResource(value: unknown): InstitutionMutationResource | null {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "relationshipId",
      "requestHash",
      "resourceId",
      "resourceType",
      "tenantId",
    ]) ||
    !isUuidV7(value.tenantId) ||
    !isUuidV7(value.relationshipId) ||
    typeof value.resourceType !== "string" ||
    !RESOURCE_TYPE_RE.test(value.resourceType) ||
    typeof value.resourceId !== "string" ||
    value.resourceId.length < 1 ||
    value.resourceId.length > 200 ||
    typeof value.requestHash !== "string" ||
    !SHA256_RE.test(value.requestHash)
  ) return null;
  return {
    tenantId: value.tenantId.toLowerCase(),
    relationshipId: value.relationshipId.toLowerCase(),
    resourceType: value.resourceType,
    resourceId: value.resourceId,
    requestHash: value.requestHash.toLowerCase(),
  };
}

function parseSelection(value: unknown): InstitutionCurrentSelection | null {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "expiresAt",
      "id",
      "impersonatorPrincipalId",
      "legacyUserId",
      "membershipId",
      "principalId",
      "relationshipId",
      "sessionFingerprint",
      "sessionGeneration",
      "status",
      "tenantId",
    ]) ||
    !isUuidV7(value.id) ||
    !isUuidV7(value.tenantId) ||
    !isUuidV7(value.relationshipId) ||
    !isUuidV7(value.membershipId) ||
    !isUuidV7(value.principalId) ||
    !isPositiveInteger(value.legacyUserId) ||
    typeof value.sessionFingerprint !== "string" ||
    !SHA256_RE.test(value.sessionFingerprint) ||
    !isPositiveInteger(value.sessionGeneration) ||
    !["ACTIVE", "REVOKED", "EXPIRED", "REPLACED"].includes(String(value.status)) ||
    !isTimestamp(value.expiresAt) ||
    !(value.impersonatorPrincipalId === null || isUuidV7(value.impersonatorPrincipalId))
  ) return null;
  return {
    id: value.id.toLowerCase(),
    tenantId: value.tenantId.toLowerCase(),
    relationshipId: value.relationshipId.toLowerCase(),
    membershipId: value.membershipId.toLowerCase(),
    principalId: value.principalId.toLowerCase(),
    legacyUserId: Number(value.legacyUserId),
    sessionFingerprint: value.sessionFingerprint.toLowerCase(),
    sessionGeneration: Number(value.sessionGeneration),
    status: value.status as InstitutionCurrentSelection["status"],
    expiresAt: Number(value.expiresAt),
    impersonatorPrincipalId: value.impersonatorPrincipalId?.toLowerCase() ?? null,
  };
}

function parseRelationship(value: unknown): InstitutionCurrentRelationship | null {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "dataScopes",
      "id",
      "policyVersion",
      "purposeCode",
      "status",
      "tenantId",
      "validFrom",
      "validUntil",
    ]) ||
    !isUuidV7(value.id) ||
    !isUuidV7(value.tenantId) ||
    !["ACTIVE", "SUSPENDED", "REVOKED", "EXPIRED"].includes(String(value.status)) ||
    typeof value.purposeCode !== "string" ||
    value.purposeCode !== "admissions.review" ||
    !Array.isArray(value.dataScopes) ||
    value.dataScopes.length < 1 ||
    value.dataScopes.length > 64 ||
    !value.dataScopes.every((scope) => typeof scope === "string" && scope.length <= 96) ||
    !isPositiveInteger(value.policyVersion) ||
    !isTimestamp(value.validFrom) ||
    !(value.validUntil === null || isTimestamp(value.validUntil))
  ) return null;
  return {
    id: value.id.toLowerCase(),
    tenantId: value.tenantId.toLowerCase(),
    status: value.status as InstitutionCurrentRelationship["status"],
    purposeCode: value.purposeCode,
    dataScopes: [...new Set(value.dataScopes as string[])].sort(),
    policyVersion: Number(value.policyVersion),
    validFrom: Number(value.validFrom),
    validUntil: value.validUntil === null ? null : Number(value.validUntil),
  };
}

function parseStepUp(value: unknown): InstitutionStepUpReceipt | null {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "capabilityKey",
      "consumedAt",
      "contextId",
      "expiresAt",
      "id",
      "issuedAt",
      "membershipId",
      "principalId",
      "relationshipId",
      "requestHash",
      "resourceId",
      "resourceType",
      "selectionId",
      "sessionGeneration",
      "status",
      "tenantId",
    ]) ||
    !isUuidV7(value.id) ||
    !isUuidV7(value.tenantId) ||
    !isUuidV7(value.relationshipId) ||
    !isUuidV7(value.principalId) ||
    !isUuidV7(value.membershipId) ||
    !isUuidV7(value.selectionId) ||
    !isPositiveInteger(value.sessionGeneration) ||
    !isUuidV7(value.contextId) ||
    typeof value.capabilityKey !== "string" ||
    typeof value.resourceType !== "string" ||
    typeof value.resourceId !== "string" ||
    typeof value.requestHash !== "string" ||
    !SHA256_RE.test(value.requestHash) ||
    !["ACTIVE", "CONSUMED", "REVOKED", "EXPIRED"].includes(String(value.status)) ||
    !isTimestamp(value.issuedAt) ||
    !isTimestamp(value.expiresAt) ||
    !(value.consumedAt === null || isTimestamp(value.consumedAt))
  ) return null;
  return {
    id: value.id.toLowerCase(),
    tenantId: value.tenantId.toLowerCase(),
    relationshipId: value.relationshipId.toLowerCase(),
    principalId: value.principalId.toLowerCase(),
    membershipId: value.membershipId.toLowerCase(),
    selectionId: value.selectionId.toLowerCase(),
    sessionGeneration: Number(value.sessionGeneration),
    contextId: value.contextId.toLowerCase(),
    capabilityKey: value.capabilityKey,
    resourceType: value.resourceType,
    resourceId: value.resourceId,
    requestHash: value.requestHash.toLowerCase(),
    status: value.status as InstitutionStepUpReceipt["status"],
    issuedAt: Number(value.issuedAt),
    expiresAt: Number(value.expiresAt),
    consumedAt: value.consumedAt === null ? null : Number(value.consumedAt),
  };
}

function parseCurrentAuthority(value: unknown): InstitutionCurrentAuthority | null {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "principalLegacyUserId",
      "relationship",
      "selection",
      "state",
      "stepUpReceipt",
    ]) ||
    !isPositiveInteger(value.principalLegacyUserId) ||
    !isRecord(value.state)
  ) return null;
  const selection = parseSelection(value.selection);
  const relationship = parseRelationship(value.relationship);
  const stepUpReceipt = value.stepUpReceipt === null ? null : parseStepUp(value.stepUpReceipt);
  if (!selection || !relationship || (value.stepUpReceipt !== null && !stepUpReceipt)) return null;
  return {
    principalLegacyUserId: Number(value.principalLegacyUserId),
    selection,
    relationship,
    state: value.state as ResolvedActiveContextState,
    stepUpReceipt,
  };
}

function validConfig(value: unknown): value is InstitutionMutationAuthorizationOptions["versionedActiveContext"] {
  return isRecord(value) && exactKeys(value, ["audience", "cellId", "environmentId", "issuerId", "keyRing"]) &&
    typeof value.audience === "string" && typeof value.environmentId === "string" &&
    typeof value.cellId === "string" && typeof value.issuerId === "string" &&
    Array.isArray(value.keyRing);
}

function stepUpMatches(input: {
  receipt: InstitutionStepUpReceipt;
  identity: InstitutionMutationIdentity;
  selection: InstitutionCurrentSelection;
  context: VerifiedActiveTenantContext & { tokenVersion: 2; selectionId: string; sessionGeneration: number };
  resource: InstitutionMutationResource;
  capabilityKey: InstitutionCapability;
  now: number;
}): boolean {
  const { receipt, identity, selection, context, resource, capabilityKey, now } = input;
  return receipt.status === "ACTIVE" && receipt.consumedAt === null &&
    receipt.issuedAt <= now && now < receipt.expiresAt && receipt.expiresAt <= context.expiresAt &&
    receipt.tenantId === identity.tenantId && receipt.relationshipId === identity.relationshipId &&
    receipt.principalId === identity.authenticatedPrincipalId && receipt.membershipId === identity.membershipId &&
    receipt.selectionId === selection.id && receipt.sessionGeneration === selection.sessionGeneration &&
    receipt.contextId === context.contextId && receipt.capabilityKey === capabilityKey &&
    receipt.resourceType === resource.resourceType && receipt.resourceId === resource.resourceId &&
    receipt.requestHash === resource.requestHash;
}

export async function authorizeInstitutionMutation(
  options: InstitutionMutationAuthorizationOptions,
): Promise<InstitutionMutationAuthorizationResult> {
  if (
    !options || !validConfig(options.versionedActiveContext) ||
    typeof options.resolveCurrentAuthority !== "function" ||
    typeof options.requiredDataScope !== "string" ||
    !DATA_SCOPE_RE.test(options.requiredDataScope) ||
    typeof options.approvalSatisfied !== "boolean" ||
    (options.now !== undefined && typeof options.now !== "function")
  ) throw new Error("institution_authorization_configuration_invalid");
  const budget = options.resolutionBudgetMs ?? 2_500;
  if (!Number.isSafeInteger(budget) || budget < 1 || budget > INSTITUTION_AUTHORITY_MAX_RESOLUTION_MS) {
    throw new Error("institution_authorization_configuration_invalid");
  }
  const identity = parseIdentity(options.requestIdentity);
  if (!identity) return { ok: false, error: { reason: "request_identity_invalid" } };
  const resource = parseResource(options.resource);
  if (!resource) return { ok: false, error: { reason: "resource_invalid" } };
  if (resource.tenantId !== identity.tenantId || resource.relationshipId !== identity.relationshipId) {
    return { ok: false, error: { reason: "resource_not_found" } };
  }
  const stepUpReceiptId = options.stepUpReceiptId ?? null;
  if (stepUpReceiptId !== null && !isUuidV7(stepUpReceiptId)) {
    return { ok: false, error: { reason: "step_up_receipt_id_invalid" } };
  }
  const now = options.now ?? Date.now;
  const startedAt = now();
  if (!isTimestamp(startedAt)) return { ok: false, error: { reason: "clock_invalid" } };
  const verification = verifyVersionedActiveTenantContext({
    token: options.activeContextToken,
    keyRing: options.versionedActiveContext.keyRing,
    expected: {
      audience: options.versionedActiveContext.audience,
      environmentId: options.versionedActiveContext.environmentId,
      cellId: options.versionedActiveContext.cellId,
      issuerId: options.versionedActiveContext.issuerId,
      tenantId: identity.tenantId,
    },
    now: startedAt,
  });
  if (!verification.ok) {
    return { ok: false, error: { reason: "active_context_rejected", detail: verification.reason } };
  }
  if (!isSelectionBoundActiveTenantContext(verification.context, startedAt)) {
    return { ok: false, error: { reason: "selection_binding_required" } };
  }
  const context = verification.context;
  if (context.principalId !== identity.authenticatedPrincipalId || context.membershipId !== identity.membershipId) {
    return { ok: false, error: { reason: "authenticated_principal_mismatch" } };
  }
  if (context.organizationId !== null || context.legacyBranchId !== null) {
    return { ok: false, error: { reason: "authority_not_current" } };
  }
  if (identity.impersonatorPrincipalId !== null) {
    return { ok: false, error: { reason: "impersonation_forbidden" } };
  }

  let raw: InstitutionCurrentAuthority;
  try {
    raw = await options.resolveCurrentAuthority({
      context,
      identity,
      resource,
      capabilityKey: options.capabilityKey,
      stepUpReceiptId,
    });
  } catch {
    return { ok: false, error: { reason: "authority_unavailable" } };
  }
  const completedAt = now();
  if (!isTimestamp(completedAt) || completedAt < startedAt) {
    return { ok: false, error: { reason: "clock_invalid" } };
  }
  if (completedAt - startedAt > budget) {
    return { ok: false, error: { reason: "authority_resolution_timeout" } };
  }
  const authority = parseCurrentAuthority(raw);
  if (!authority) return { ok: false, error: { reason: "authority_state_invalid" } };
  const selection = authority.selection;
  if (
    authority.principalLegacyUserId !== identity.authenticatedUserId ||
    selection.status !== "ACTIVE" || completedAt >= selection.expiresAt ||
    selection.id !== context.selectionId || selection.sessionGeneration !== context.sessionGeneration ||
    selection.tenantId !== identity.tenantId || selection.relationshipId !== identity.relationshipId ||
    selection.membershipId !== identity.membershipId || selection.principalId !== identity.authenticatedPrincipalId ||
    selection.legacyUserId !== identity.authenticatedUserId ||
    selection.sessionFingerprint !== identity.sessionFingerprint
  ) return { ok: false, error: { reason: "authority_not_current" } };
  if (selection.impersonatorPrincipalId !== null) {
    return { ok: false, error: { reason: "impersonation_forbidden" } };
  }
  const relationship = authority.relationship;
  if (
    relationship.id !== identity.relationshipId || relationship.tenantId !== identity.tenantId ||
    relationship.status !== "ACTIVE" || relationship.validFrom > completedAt ||
    (relationship.validUntil !== null && completedAt >= relationship.validUntil) ||
    relationship.policyVersion !== context.policyVersion ||
    !relationship.dataScopes.includes(options.requiredDataScope)
  ) return { ok: false, error: { reason: "relationship_not_current" } };

  let stepUpSatisfied = false;
  if (stepUpReceiptId !== null) {
    if (
      authority.stepUpReceipt === null || authority.stepUpReceipt.id !== stepUpReceiptId.toLowerCase() ||
      !stepUpMatches({ receipt: authority.stepUpReceipt, identity, selection, context, resource,
        capabilityKey: options.capabilityKey, now: completedAt })
    ) return { ok: false, error: { reason: "step_up_receipt_invalid" } };
    stepUpSatisfied = true;
  } else if (authority.stepUpReceipt !== null) {
    return { ok: false, error: { reason: "authority_state_invalid" } };
  }

  const capabilityDecision = evaluateActiveTenantCapability({
    context,
    state: authority.state,
    capabilityKey: options.capabilityKey,
    resource: {
      type: resource.resourceType,
      id: resource.resourceId,
      tenantId: resource.tenantId,
      organizationId: null,
      legacyBranchId: null,
    },
    stepUpSatisfied,
    approvalSatisfied: options.approvalSatisfied,
    now: completedAt,
  });
  if (!capabilityDecision.allowed) {
    return { ok: false, error: { reason: "capability_denied", detail: capabilityDecision.reason } };
  }
  return {
    ok: true,
    context,
    resource,
    receipt: {
      schemaVersion: 1,
      tenantId: identity.tenantId,
      relationshipId: identity.relationshipId,
      contextId: context.contextId,
      selectionId: selection.id,
      sessionGeneration: selection.sessionGeneration,
      actorPrincipalId: identity.authenticatedPrincipalId,
      actorMembershipId: identity.membershipId,
      authenticatedUserId: identity.authenticatedUserId,
      capabilityKey: options.capabilityKey,
      requiredDataScope: options.requiredDataScope,
      policyVersionId: context.policyVersionId,
      policyVersion: context.policyVersion,
      resourceType: resource.resourceType,
      resourceId: resource.resourceId,
      requestHash: resource.requestHash,
      stepUpReceiptId,
      decision: "ALLOW",
      capabilityDecision,
    },
  };
}
