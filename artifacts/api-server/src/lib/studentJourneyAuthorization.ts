import {
  evaluateActiveTenantCapability,
  verifyVersionedActiveTenantContext,
  type ActiveContextDecision,
  type ActiveContextDecisionReason,
  type ActiveContextVerificationKey,
  type ActiveContextVersionedVerificationFailure,
  type ResolvedActiveContextState,
  type VerifiedActiveTenantContext,
} from "./activeTenantContext.js";

export const STUDENT_JOURNEY_READ_CAPABILITY = "student.journey.read";
export const STUDENT_JOURNEY_RESOURCE_TYPE = "student_journey";
export const STUDENT_JOURNEY_AUTHORITY_MAX_RESOLUTION_MS = 5_000;

const UUID_V7_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type StudentJourneyServerIdentity = {
  authenticatedUserId: number;
  authenticatedPrincipalId: string;
  tenantId: string;
  organizationId: string | null;
  legacyBranchId: number | null;
  selectionId: string;
  sessionGeneration: number;
  impersonatorPrincipalId: string | null;
};

export type StudentJourneyServerResource = {
  tenantId: string;
  organizationId: string | null;
  legacyBranchId: number | null;
  studentId: number;
  studentOwnerUserId: number;
};

export type StudentJourneyCurrentSelection = {
  id: string;
  tenantId: string;
  principalId: string;
  membershipId: string;
  legacyUserId: number;
  sessionGeneration: number;
  status: "ACTIVE" | "REVOKED" | "EXPIRED" | "REPLACED";
  impersonatorPrincipalId: string | null;
};

export type StudentJourneyCurrentAuthority = {
  principalLegacyUserId: number;
  selection: StudentJourneyCurrentSelection;
  state: ResolvedActiveContextState;
};

export type StudentJourneyAuthorityResolver = (input: {
  context: VerifiedActiveTenantContext;
  identity: StudentJourneyServerIdentity;
}) => Promise<StudentJourneyCurrentAuthority>;

export type StudentJourneyAuthorizationOptions = {
  activeContextToken: string | undefined;
  versionedActiveContext: {
    audience: string;
    environmentId: string;
    cellId: string;
    issuerId: string;
    keyRing: readonly ActiveContextVerificationKey[];
  };
  requestIdentity: unknown;
  resource: unknown;
  resolveCurrentAuthority: StudentJourneyAuthorityResolver;
  resolutionBudgetMs?: number;
  now?: () => number;
};

export type StudentJourneyAuthorizationFailure =
  | { reason: "request_identity_invalid" }
  | { reason: "resource_invalid" }
  | { reason: "clock_invalid" }
  | {
      reason: "active_context_rejected";
      detail: ActiveContextVersionedVerificationFailure;
    }
  | { reason: "authenticated_principal_mismatch" }
  | { reason: "impersonation_forbidden" }
  | { reason: "resource_not_found" }
  | { reason: "authority_unavailable" }
  | { reason: "authority_resolution_timeout" }
  | { reason: "authority_state_invalid" }
  | { reason: "authority_not_current" }
  | { reason: "capability_denied"; detail: ActiveContextDecisionReason };

export type StudentJourneyAuthorizationReceipt = {
  schemaVersion: 1;
  capabilityKey: typeof STUDENT_JOURNEY_READ_CAPABILITY;
  resourceType: typeof STUDENT_JOURNEY_RESOURCE_TYPE;
  tenantId: string;
  contextId: string;
  selectionId: string;
  sessionGeneration: number;
  actorPrincipalId: string;
  actorMembershipId: string;
  authenticatedUserId: number;
  studentId: number;
  decision: "ALLOW";
  capabilityDecision: ActiveContextDecision;
};

export type StudentJourneyAuthorizationResult =
  | {
      ok: true;
      context: VerifiedActiveTenantContext;
      resource: StudentJourneyServerResource;
      receipt: StudentJourneyAuthorizationReceipt;
    }
  | { ok: false; error: StudentJourneyAuthorizationFailure };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  fields: readonly string[],
): boolean {
  return Object.keys(value).sort().join("\0") === [...fields].sort().join("\0");
}

function isUuidV7(value: unknown): value is string {
  return typeof value === "string" && UUID_V7_RE.test(value);
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function isNullableUuidV7(value: unknown): value is string | null {
  return value === null || isUuidV7(value);
}

function isNullableBranchId(value: unknown): value is number | null {
  return value === null || isPositiveInteger(value);
}

function parseIdentity(value: unknown): StudentJourneyServerIdentity | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "authenticatedPrincipalId",
      "authenticatedUserId",
      "impersonatorPrincipalId",
      "legacyBranchId",
      "organizationId",
      "selectionId",
      "sessionGeneration",
      "tenantId",
    ]) ||
    !isPositiveInteger(value.authenticatedUserId) ||
    !isUuidV7(value.authenticatedPrincipalId) ||
    !isUuidV7(value.tenantId) ||
    !isNullableUuidV7(value.organizationId) ||
    !isNullableBranchId(value.legacyBranchId) ||
    !isUuidV7(value.selectionId) ||
    !isPositiveInteger(value.sessionGeneration) ||
    !isNullableUuidV7(value.impersonatorPrincipalId) ||
    (value.legacyBranchId !== null && value.organizationId === null)
  ) {
    return null;
  }
  return {
    authenticatedUserId: value.authenticatedUserId,
    authenticatedPrincipalId: value.authenticatedPrincipalId.toLowerCase(),
    tenantId: value.tenantId.toLowerCase(),
    organizationId: value.organizationId?.toLowerCase() ?? null,
    legacyBranchId: value.legacyBranchId,
    selectionId: value.selectionId.toLowerCase(),
    sessionGeneration: value.sessionGeneration,
    impersonatorPrincipalId:
      value.impersonatorPrincipalId?.toLowerCase() ?? null,
  };
}

function parseResource(value: unknown): StudentJourneyServerResource | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "legacyBranchId",
      "organizationId",
      "studentId",
      "studentOwnerUserId",
      "tenantId",
    ]) ||
    !isUuidV7(value.tenantId) ||
    !isNullableUuidV7(value.organizationId) ||
    !isNullableBranchId(value.legacyBranchId) ||
    !isPositiveInteger(value.studentId) ||
    !isPositiveInteger(value.studentOwnerUserId) ||
    (value.legacyBranchId !== null && value.organizationId === null)
  ) {
    return null;
  }
  return {
    tenantId: value.tenantId.toLowerCase(),
    organizationId: value.organizationId?.toLowerCase() ?? null,
    legacyBranchId: value.legacyBranchId,
    studentId: value.studentId,
    studentOwnerUserId: value.studentOwnerUserId,
  };
}

function validVersionedConfig(
  value: unknown,
): value is StudentJourneyAuthorizationOptions["versionedActiveContext"] {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "audience",
      "cellId",
      "environmentId",
      "issuerId",
      "keyRing",
    ]) &&
    typeof value.audience === "string" &&
    typeof value.environmentId === "string" &&
    typeof value.cellId === "string" &&
    typeof value.issuerId === "string" &&
    Array.isArray(value.keyRing)
  );
}

function parseCurrentSelection(
  value: unknown,
): StudentJourneyCurrentSelection | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "id",
      "impersonatorPrincipalId",
      "legacyUserId",
      "membershipId",
      "principalId",
      "sessionGeneration",
      "status",
      "tenantId",
    ]) ||
    !isUuidV7(value.id) ||
    !isUuidV7(value.tenantId) ||
    !isUuidV7(value.principalId) ||
    !isUuidV7(value.membershipId) ||
    !isPositiveInteger(value.legacyUserId) ||
    !isPositiveInteger(value.sessionGeneration) ||
    !["ACTIVE", "REVOKED", "EXPIRED", "REPLACED"].includes(
      String(value.status),
    ) ||
    !isNullableUuidV7(value.impersonatorPrincipalId)
  ) {
    return null;
  }
  return {
    id: value.id.toLowerCase(),
    tenantId: value.tenantId.toLowerCase(),
    principalId: value.principalId.toLowerCase(),
    membershipId: value.membershipId.toLowerCase(),
    legacyUserId: value.legacyUserId,
    sessionGeneration: value.sessionGeneration,
    status: value.status as StudentJourneyCurrentSelection["status"],
    impersonatorPrincipalId:
      value.impersonatorPrincipalId?.toLowerCase() ?? null,
  };
}

function parseCurrentAuthority(
  value: unknown,
): StudentJourneyCurrentAuthority | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["principalLegacyUserId", "selection", "state"]) ||
    !isPositiveInteger(value.principalLegacyUserId) ||
    !isRecord(value.state)
  ) {
    return null;
  }
  const selection = parseCurrentSelection(value.selection);
  if (!selection) return null;
  return {
    principalLegacyUserId: value.principalLegacyUserId,
    selection,
    state: value.state as ResolvedActiveContextState,
  };
}

function sameScope(
  left: {
    tenantId: string;
    organizationId: string | null;
    legacyBranchId: number | null;
  },
  right: {
    tenantId: string;
    organizationId: string | null;
    legacyBranchId: number | null;
  },
): boolean {
  return (
    left.tenantId === right.tenantId &&
    left.organizationId === right.organizationId &&
    left.legacyBranchId === right.legacyBranchId
  );
}

function isSafeClock(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

export async function authorizeStudentJourneyRequest(
  options: StudentJourneyAuthorizationOptions,
): Promise<StudentJourneyAuthorizationResult> {
  if (
    !options ||
    !validVersionedConfig(options.versionedActiveContext) ||
    typeof options.resolveCurrentAuthority !== "function" ||
    (options.now !== undefined && typeof options.now !== "function")
  ) {
    throw new Error("student_journey_authorization_configuration_invalid");
  }
  const budget = options.resolutionBudgetMs ?? 2_000;
  if (
    !Number.isSafeInteger(budget) ||
    budget < 1 ||
    budget > STUDENT_JOURNEY_AUTHORITY_MAX_RESOLUTION_MS
  ) {
    throw new Error("student_journey_authorization_configuration_invalid");
  }
  const identity = parseIdentity(options.requestIdentity);
  if (!identity)
    return { ok: false, error: { reason: "request_identity_invalid" } };
  const resource = parseResource(options.resource);
  if (!resource) return { ok: false, error: { reason: "resource_invalid" } };

  const now = options.now ?? Date.now;
  const startedAt = now();
  if (!isSafeClock(startedAt))
    return { ok: false, error: { reason: "clock_invalid" } };
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
    expectedSelectionBinding: {
      selectionId: identity.selectionId,
      sessionGeneration: identity.sessionGeneration,
    },
    now: startedAt,
  });
  if (!verification.ok) {
    return {
      ok: false,
      error: { reason: "active_context_rejected", detail: verification.reason },
    };
  }
  const context = verification.context;
  if (context.principalId !== identity.authenticatedPrincipalId) {
    return { ok: false, error: { reason: "authenticated_principal_mismatch" } };
  }
  if (identity.impersonatorPrincipalId !== null) {
    return { ok: false, error: { reason: "impersonation_forbidden" } };
  }
  if (!sameScope(context, identity)) {
    return { ok: false, error: { reason: "authority_not_current" } };
  }
  if (!sameScope(context, resource)) {
    return { ok: false, error: { reason: "resource_not_found" } };
  }
  if (resource.studentOwnerUserId !== identity.authenticatedUserId) {
    return { ok: false, error: { reason: "resource_not_found" } };
  }

  let resolvedRaw: StudentJourneyCurrentAuthority;
  try {
    resolvedRaw = await options.resolveCurrentAuthority({ context, identity });
  } catch {
    return { ok: false, error: { reason: "authority_unavailable" } };
  }
  const completedAt = now();
  if (!isSafeClock(completedAt) || completedAt < startedAt) {
    return { ok: false, error: { reason: "clock_invalid" } };
  }
  if (completedAt - startedAt > budget) {
    return { ok: false, error: { reason: "authority_resolution_timeout" } };
  }
  const resolved = parseCurrentAuthority(resolvedRaw);
  if (!resolved)
    return { ok: false, error: { reason: "authority_state_invalid" } };

  const selection = resolved.selection;
  if (
    resolved.principalLegacyUserId !== identity.authenticatedUserId ||
    selection.status !== "ACTIVE" ||
    selection.id !== identity.selectionId ||
    selection.tenantId !== identity.tenantId ||
    selection.principalId !== identity.authenticatedPrincipalId ||
    selection.membershipId !== context.membershipId ||
    selection.legacyUserId !== identity.authenticatedUserId ||
    selection.sessionGeneration !== identity.sessionGeneration
  ) {
    return { ok: false, error: { reason: "authority_not_current" } };
  }
  if (selection.impersonatorPrincipalId !== null) {
    return { ok: false, error: { reason: "impersonation_forbidden" } };
  }

  const capabilityDecision = evaluateActiveTenantCapability({
    context,
    state: resolved.state,
    capabilityKey: STUDENT_JOURNEY_READ_CAPABILITY,
    resource: {
      type: STUDENT_JOURNEY_RESOURCE_TYPE,
      id: `student:${resource.studentId}`,
      tenantId: resource.tenantId,
      organizationId: resource.organizationId,
      legacyBranchId: resource.legacyBranchId,
    },
    now: completedAt,
  });
  if (!capabilityDecision.allowed) {
    return {
      ok: false,
      error: { reason: "capability_denied", detail: capabilityDecision.reason },
    };
  }

  return {
    ok: true,
    context,
    resource,
    receipt: {
      schemaVersion: 1,
      capabilityKey: STUDENT_JOURNEY_READ_CAPABILITY,
      resourceType: STUDENT_JOURNEY_RESOURCE_TYPE,
      tenantId: context.tenantId,
      contextId: context.contextId,
      selectionId: identity.selectionId,
      sessionGeneration: identity.sessionGeneration,
      actorPrincipalId: context.principalId,
      actorMembershipId: context.membershipId,
      authenticatedUserId: identity.authenticatedUserId,
      studentId: resource.studentId,
      decision: "ALLOW",
      capabilityDecision,
    },
  };
}
