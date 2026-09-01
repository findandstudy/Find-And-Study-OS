import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  ACTIVE_CONTEXT_V2_ALGORITHM,
  fingerprintActiveContextPublicKey,
  issueVersionedActiveTenantContext,
  signActiveTenantContext,
  type ActiveContextExternalSigner,
  type ActiveContextVerificationKey,
  type ActiveContextVersionedSubject,
  type ActiveTenantContextClaims,
  type ResolvedActiveContextState,
} from "../src/lib/activeTenantContext.js";
import {
  STUDENT_JOURNEY_READ_CAPABILITY,
  authorizeStudentJourneyRequest,
  type StudentJourneyAuthorizationOptions,
  type StudentJourneyCurrentAuthority,
  type StudentJourneyServerIdentity,
  type StudentJourneyServerResource,
} from "../src/lib/studentJourneyAuthorization.js";

const NOW = 2_000_000_000_000;
const ID = {
  context: "018f6000-0000-7000-8000-000000000001",
  tenant: "018f6000-0000-7000-8000-000000000002",
  otherTenant: "018f6000-0000-7000-8000-000000000003",
  organization: "018f6000-0000-7000-8000-000000000004",
  principal: "018f6000-0000-7000-8000-000000000005",
  otherPrincipal: "018f6000-0000-7000-8000-000000000006",
  membership: "018f6000-0000-7000-8000-000000000007",
  assignment: "018f6000-0000-7000-8000-000000000008",
  package: "018f6000-0000-7000-8000-000000000009",
  policy: "018f6000-0000-7000-8000-00000000000a",
  selection: "018f6000-0000-7000-8000-00000000000b",
  otherSelection: "018f6000-0000-7000-8000-00000000000c",
  issuer: "018f6000-0000-7000-8000-00000000000d",
};
const USER_ID = 501;
const STUDENT_ID = 701;
const AUDIENCE = "fas.student-journey.request";
const ENVIRONMENT = "test";
const CELL = "cell-a";
const KEY_ID = "student-journey-context-2026-09-a";
const KEY_REFERENCE = "test-memory://student-journey/key-a";
const LEGACY_SECRET = "legacy-student-journey-secret-at-least-thirty-two-bytes";

const pair = crypto.generateKeyPairSync("ed25519");
const publicKeyPem = pair.publicKey
  .export({ type: "spki", format: "pem" })
  .toString();
const signer: ActiveContextExternalSigner = {
  async sign(input) {
    assert.equal(input.keyReference, KEY_REFERENCE);
    assert.equal(input.algorithm, ACTIVE_CONTEXT_V2_ALGORITHM);
    return crypto.sign(null, input.signingInput, pair.privateKey);
  },
};

function key(
  overrides: Partial<ActiveContextVerificationKey> = {},
): ActiveContextVerificationKey {
  return {
    keyId: KEY_ID,
    algorithm: ACTIVE_CONTEXT_V2_ALGORITHM,
    state: "ACTIVE",
    issuerId: ID.issuer,
    environmentId: ENVIRONMENT,
    cellId: CELL,
    publicKeyPem,
    publicKeyFingerprint: fingerprintActiveContextPublicKey(publicKeyPem),
    signFrom: NOW - 60_000,
    signUntil: NOW + 60_000,
    verifyUntil: NOW + 120_000,
    ...overrides,
  };
}

function subject(
  overrides: Partial<ActiveContextVersionedSubject> = {},
): ActiveContextVersionedSubject {
  return {
    contextId: ID.context,
    tenantId: ID.tenant,
    organizationId: ID.organization,
    legacyBranchId: 41,
    principalId: ID.principal,
    membershipId: ID.membership,
    assignmentIds: [ID.assignment],
    policyVersionId: ID.policy,
    policyVersion: 3,
    selectionId: ID.selection,
    sessionGeneration: 4,
    ...overrides,
  };
}

async function issue(
  overrides: Partial<ActiveContextVersionedSubject> = {},
  now = NOW,
): Promise<string> {
  return issueVersionedActiveTenantContext({
    subject: subject(overrides),
    audience: AUDIENCE,
    environmentId: ENVIRONMENT,
    cellId: CELL,
    issuerId: ID.issuer,
    keyId: KEY_ID,
    keyReference: KEY_REFERENCE,
    keyRing: [key()],
    signer,
    ttlMs: 60_000,
    now,
  });
}

function identity(
  overrides: Partial<StudentJourneyServerIdentity> = {},
): StudentJourneyServerIdentity {
  return {
    authenticatedUserId: USER_ID,
    authenticatedPrincipalId: ID.principal,
    tenantId: ID.tenant,
    organizationId: ID.organization,
    legacyBranchId: 41,
    selectionId: ID.selection,
    sessionGeneration: 4,
    impersonatorPrincipalId: null,
    ...overrides,
  };
}

function resource(
  overrides: Partial<StudentJourneyServerResource> = {},
): StudentJourneyServerResource {
  return {
    tenantId: ID.tenant,
    organizationId: ID.organization,
    legacyBranchId: 41,
    studentId: STUDENT_ID,
    studentOwnerUserId: USER_ID,
    ...overrides,
  };
}

function state(
  overrides: {
    principal?: Partial<ResolvedActiveContextState["principal"]>;
    membership?: Partial<ResolvedActiveContextState["membership"]>;
    assignment?: Partial<ResolvedActiveContextState["assignments"][number]>;
    capability?: Partial<
      ResolvedActiveContextState["assignments"][number]["capabilities"][number]
    >;
  } = {},
): ResolvedActiveContextState {
  return {
    tenant: { id: ID.tenant, status: "ACTIVE", policyVersion: 3 },
    principal: {
      id: ID.principal,
      principalType: "HUMAN",
      status: "ACTIVE",
      riskState: "NORMAL",
      ...overrides.principal,
    },
    membership: {
      id: ID.membership,
      tenantId: ID.tenant,
      organizationId: ID.organization,
      legacyBranchId: 41,
      principalId: ID.principal,
      status: "ACTIVE",
      validFrom: NOW - 10_000,
      validUntil: NOW + 60_000,
      ...overrides.membership,
    },
    policy: {
      id: ID.policy,
      tenantId: ID.tenant,
      version: 3,
      state: "ACTIVE",
      effectiveAt: NOW - 10_000,
      revokedAt: null,
    },
    assignments: [
      {
        id: ID.assignment,
        tenantId: ID.tenant,
        membershipId: ID.membership,
        status: "ACTIVE",
        validFrom: NOW - 10_000,
        validUntil: NOW + 60_000,
        scopeType: "LEGACY_BRANCH",
        organizationId: ID.organization,
        legacyBranchId: 41,
        constraintDocument: {},
        rolePackageVersionId: ID.package,
        rolePackageStatus: "ACTIVE",
        rolePackagePrincipalType: "HUMAN",
        rolePackageEffectiveAt: NOW - 10_000,
        rolePackageDeprecatedAt: null,
        capabilities: [
          {
            key: STUDENT_JOURNEY_READ_CAPABILITY,
            effect: "ALLOW",
            status: "ACTIVE",
            stepUpRequired: false,
            approvalRequired: false,
            ...overrides.capability,
          },
        ],
        ...overrides.assignment,
      },
    ],
  };
}

function authority(
  overrides: Partial<StudentJourneyCurrentAuthority> & {
    selection?: Partial<StudentJourneyCurrentAuthority["selection"]>;
  } = {},
): StudentJourneyCurrentAuthority {
  return {
    principalLegacyUserId: overrides.principalLegacyUserId ?? USER_ID,
    selection: {
      id: ID.selection,
      tenantId: ID.tenant,
      principalId: ID.principal,
      membershipId: ID.membership,
      legacyUserId: USER_ID,
      sessionGeneration: 4,
      status: "ACTIVE",
      impersonatorPrincipalId: null,
      ...overrides.selection,
    },
    state: overrides.state ?? state(),
  };
}

async function authorize(
  overrides: Partial<StudentJourneyAuthorizationOptions> = {},
) {
  return authorizeStudentJourneyRequest({
    activeContextToken: await issue(),
    versionedActiveContext: {
      audience: AUDIENCE,
      environmentId: ENVIRONMENT,
      cellId: CELL,
      issuerId: ID.issuer,
      keyRing: [key()],
    },
    requestIdentity: identity(),
    resource: resource(),
    resolveCurrentAuthority: async () => authority(),
    now: () => NOW,
    ...overrides,
  });
}

test("strict versioned selection-bound context authorizes only the current student's journey", async () => {
  const result = await authorize();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.resource.studentId, STUDENT_ID);
  assert.equal(result.receipt.capabilityKey, STUDENT_JOURNEY_READ_CAPABILITY);
  assert.equal(result.receipt.selectionId, ID.selection);
  assert.equal(result.receipt.authenticatedUserId, USER_ID);
  assert.equal(result.receipt.decision, "ALLOW");
  assert.equal(result.receipt.capabilityDecision.allowed, true);
});

test("legacy HMAC contexts are rejected by the Journey boundary", async () => {
  const legacyClaims: ActiveTenantContextClaims = {
    tokenVersion: 2,
    ...subject(),
    issuedAt: NOW - 1_000,
    expiresAt: NOW + 60_000,
  };
  const result = await authorize({
    activeContextToken: signActiveTenantContext(legacyClaims, LEGACY_SECRET),
  });
  assert.deepEqual(result, {
    ok: false,
    error: { reason: "active_context_rejected", detail: "malformed_token" },
  });
});

test("selection id and session generation are absolute request bindings", async () => {
  const wrongSelection = await authorize({
    requestIdentity: identity({ selectionId: ID.otherSelection }),
  });
  assert.deepEqual(wrongSelection, {
    ok: false,
    error: {
      reason: "active_context_rejected",
      detail: "selection_binding_mismatch",
    },
  });
  const wrongGeneration = await authorize({
    requestIdentity: identity({ sessionGeneration: 5 }),
  });
  assert.deepEqual(wrongGeneration, {
    ok: false,
    error: {
      reason: "active_context_rejected",
      detail: "selection_binding_mismatch",
    },
  });
});

test("authenticated principal and principal-to-user mapping cannot drift", async () => {
  const principalMismatch = await authorize({
    requestIdentity: identity({ authenticatedPrincipalId: ID.otherPrincipal }),
  });
  assert.deepEqual(principalMismatch, {
    ok: false,
    error: { reason: "authenticated_principal_mismatch" },
  });

  const mappingMismatch = await authorize({
    resolveCurrentAuthority: async () =>
      authority({ principalLegacyUserId: USER_ID + 1 }),
  });
  assert.deepEqual(mappingMismatch, {
    ok: false,
    error: { reason: "authority_not_current" },
  });
});

test("student Journey self mode forbids both request and persisted impersonation", async () => {
  const requestImpersonation = await authorize({
    requestIdentity: identity({ impersonatorPrincipalId: ID.otherPrincipal }),
  });
  assert.deepEqual(requestImpersonation, {
    ok: false,
    error: { reason: "impersonation_forbidden" },
  });

  const persistedImpersonation = await authorize({
    resolveCurrentAuthority: async () =>
      authority({ selection: { impersonatorPrincipalId: ID.otherPrincipal } }),
  });
  assert.deepEqual(persistedImpersonation, {
    ok: false,
    error: { reason: "impersonation_forbidden" },
  });
});

test("same visible student id in another tenant or branch is hidden before authority lookup", async () => {
  let resolverCalls = 0;
  const resolveCurrentAuthority = async () => {
    resolverCalls += 1;
    return authority();
  };
  const otherTenant = await authorize({
    resource: resource({ tenantId: ID.otherTenant }),
    resolveCurrentAuthority,
  });
  assert.deepEqual(otherTenant, {
    ok: false,
    error: { reason: "resource_not_found" },
  });
  const otherBranch = await authorize({
    resource: resource({ legacyBranchId: 42 }),
    resolveCurrentAuthority,
  });
  assert.deepEqual(otherBranch, {
    ok: false,
    error: { reason: "resource_not_found" },
  });
  assert.equal(resolverCalls, 0);
});

test("a valid tenant resource owned by another legacy user is hidden", async () => {
  let resolverCalls = 0;
  const result = await authorize({
    resource: resource({ studentOwnerUserId: USER_ID + 1 }),
    resolveCurrentAuthority: async () => {
      resolverCalls += 1;
      return authority();
    },
  });
  assert.deepEqual(result, {
    ok: false,
    error: { reason: "resource_not_found" },
  });
  assert.equal(resolverCalls, 0);
});

test("replaced, revoked or differently bound current selections invalidate a signed token", async () => {
  for (const selection of [
    { status: "REPLACED" as const },
    { status: "REVOKED" as const },
    { sessionGeneration: 5 },
    { id: ID.otherSelection },
    { membershipId: ID.otherSelection },
  ]) {
    const result = await authorize({
      resolveCurrentAuthority: async () => authority({ selection }),
    });
    assert.deepEqual(result, {
      ok: false,
      error: { reason: "authority_not_current" },
    });
  }
});

test("revocation, explicit deny and stale policy remain authoritative at request time", async () => {
  const revoked = await authorize({
    resolveCurrentAuthority: async () =>
      authority({ state: state({ membership: { status: "REVOKED" } }) }),
  });
  assert.deepEqual(revoked, {
    ok: false,
    error: { reason: "capability_denied", detail: "membership_inactive" },
  });

  const denied = await authorize({
    resolveCurrentAuthority: async () =>
      authority({ state: state({ capability: { effect: "DENY" } }) }),
  });
  assert.deepEqual(denied, {
    ok: false,
    error: { reason: "capability_denied", detail: "explicit_deny" },
  });

  const stale = state();
  stale.tenant.policyVersion = 4;
  const staleResult = await authorize({
    resolveCurrentAuthority: async () => authority({ state: stale }),
  });
  assert.deepEqual(staleResult, {
    ok: false,
    error: { reason: "capability_denied", detail: "policy_mismatch" },
  });
});

test("authority resolver errors, malformed state and hard time budget fail closed", async () => {
  assert.deepEqual(
    await authorize({
      resolveCurrentAuthority: async () => {
        throw new Error("database unavailable");
      },
    }),
    { ok: false, error: { reason: "authority_unavailable" } },
  );

  assert.deepEqual(
    await authorize({
      resolveCurrentAuthority: async () =>
        ({
          principalLegacyUserId: USER_ID,
          selection: { invalid: true },
          state: {},
        }) as never,
    }),
    { ok: false, error: { reason: "authority_state_invalid" } },
  );

  let clockCalls = 0;
  assert.deepEqual(
    await authorize({
      resolutionBudgetMs: 10,
      now: () => (clockCalls++ === 0 ? NOW : NOW + 11),
    }),
    { ok: false, error: { reason: "authority_resolution_timeout" } },
  );
});

test("request and resource envelopes reject extra or client-shaped identity fields", async () => {
  assert.deepEqual(
    await authorize({
      requestIdentity: { ...identity(), studentId: STUDENT_ID },
    }),
    { ok: false, error: { reason: "request_identity_invalid" } },
  );
  assert.deepEqual(
    await authorize({ resource: { ...resource(), applicationId: 999 } }),
    { ok: false, error: { reason: "resource_invalid" } },
  );
});

test("expired keys and contexts cannot reach the authority resolver", async () => {
  let resolverCalls = 0;
  const result = await authorize({
    activeContextToken: await issue(),
    now: () => NOW + 60_000,
    resolveCurrentAuthority: async () => {
      resolverCalls += 1;
      return authority();
    },
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.reason, "active_context_rejected");
  assert.equal(resolverCalls, 0);
});
