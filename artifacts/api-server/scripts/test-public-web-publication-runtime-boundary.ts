import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import {
  ACTIVE_CONTEXT_V2_ALGORITHM,
  fingerprintActiveContextPublicKey,
  issueVersionedActiveTenantContext,
  type ActiveContextExternalSigner,
  type ActiveContextVerificationKey,
  type ActiveContextVersionedSubject,
  type ResolvedActiveContextState,
} from "../src/lib/activeTenantContext.js";
import {
  PUBLIC_WEB_PUBLICATION_CACHE_CONTROL,
  PUBLIC_WEB_PUBLICATION_WRITE_CAPABILITY,
  resolvePublicWebPublicationExecutionIdentity,
  type PublicWebPublicationCurrentAuthority,
} from "../src/lib/publicWebPublicationRuntimeBoundary.js";
import { ABSOLUTE_SESSION_TTL } from "../src/lib/sessionLifetime.js";

const NOW = 2_000_000_000_000;
const SID = "a".repeat(64);
const OTHER_SID = "b".repeat(64);
const CSRF = "c".repeat(64);
const OTHER_CSRF = "d".repeat(64);
const ORIGIN = "https://staging.findandstudy.test";
const USER_ID = 501;
const ID = {
  context: "018fac00-0000-7000-8000-000000000001",
  tenant: "018fac00-0000-7000-8000-000000000002",
  organization: "018fac00-0000-7000-8000-000000000003",
  principal: "018fac00-0000-7000-8000-000000000004",
  impersonator: "018fac00-0000-7000-8000-000000000005",
  membership: "018fac00-0000-7000-8000-000000000006",
  assignment: "018fac00-0000-7000-8000-000000000007",
  package: "018fac00-0000-7000-8000-000000000008",
  policy: "018fac00-0000-7000-8000-000000000009",
  selection: "018fac00-0000-7000-8000-00000000000a",
  otherSelection: "018fac00-0000-7000-8000-00000000000b",
  issuer: "018fac00-0000-7000-8000-00000000000c",
} as const;
const AUDIENCE = "fas.public-web.publication-runtime";
const ENVIRONMENT = "test";
const CELL = "cell-a";
const KEY_ID = "public-web-runtime-key-2026-09";
const KEY_REFERENCE = "test-memory://public-web/runtime-key";

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

function key(): ActiveContextVerificationKey {
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
  };
}

function subject(
  overrides: Partial<ActiveContextVersionedSubject> = {},
): ActiveContextVersionedSubject {
  return {
    contextId: ID.context,
    tenantId: ID.tenant,
    organizationId: ID.organization,
    legacyBranchId: null,
    principalId: ID.principal,
    membershipId: ID.membership,
    assignmentIds: [ID.assignment],
    policyVersionId: ID.policy,
    policyVersion: 4,
    selectionId: ID.selection,
    sessionGeneration: 4,
    ...overrides,
  };
}

async function issue(
  overrides: Partial<ActiveContextVersionedSubject> = {},
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
    now: NOW,
  });
}

function sessionFingerprint(sessionId = SID): string {
  return crypto.createHash("sha256").update(sessionId, "ascii").digest("hex");
}

function state(withCapability = true): ResolvedActiveContextState {
  return {
    tenant: { id: ID.tenant, status: "ACTIVE", policyVersion: 4 },
    principal: {
      id: ID.principal,
      principalType: "HUMAN",
      status: "ACTIVE",
      riskState: "NORMAL",
    },
    membership: {
      id: ID.membership,
      tenantId: ID.tenant,
      organizationId: ID.organization,
      legacyBranchId: null,
      principalId: ID.principal,
      status: "ACTIVE",
      validFrom: NOW - 60_000,
      validUntil: NOW + 60_000,
    },
    policy: {
      id: ID.policy,
      tenantId: ID.tenant,
      version: 4,
      state: "ACTIVE",
      effectiveAt: NOW - 60_000,
      revokedAt: null,
    },
    assignments: [{
      id: ID.assignment,
      tenantId: ID.tenant,
      membershipId: ID.membership,
      status: "ACTIVE",
      validFrom: NOW - 60_000,
      validUntil: NOW + 60_000,
      scopeType: "ORGANIZATION",
      organizationId: ID.organization,
      legacyBranchId: null,
      constraintDocument: {},
      rolePackageVersionId: ID.package,
      rolePackageStatus: "ACTIVE",
      rolePackagePrincipalType: "HUMAN",
      rolePackageEffectiveAt: NOW - 60_000,
      rolePackageDeprecatedAt: null,
      capabilities: withCapability
        ? [{
            key: PUBLIC_WEB_PUBLICATION_WRITE_CAPABILITY,
            effect: "ALLOW",
            status: "ACTIVE",
            stepUpRequired: false,
            approvalRequired: false,
          }]
        : [],
    }],
  };
}

function authority(overrides: {
  principalLegacyUserId?: number;
  session?: Partial<PublicWebPublicationCurrentAuthority["session"]>;
  selection?: Partial<PublicWebPublicationCurrentAuthority["selection"]>;
  state?: ResolvedActiveContextState;
} = {}): PublicWebPublicationCurrentAuthority {
  const issuedAt = NOW - 60_000;
  return {
    principalLegacyUserId: overrides.principalLegacyUserId ?? USER_ID,
    session: {
      selectionId: ID.selection,
      sessionFingerprint: sessionFingerprint(),
      sessionGeneration: 4,
      status: "ACTIVE",
      accountStatus: "ACTIVE",
      authenticatedPrincipalId: ID.principal,
      tenantId: ID.tenant,
      organizationId: ID.organization,
      legacyBranchId: null,
      issuedAt,
      idleExpiresAt: NOW + 60_000,
      absoluteExpiresAt: issuedAt + ABSOLUTE_SESSION_TTL,
      impersonatorPrincipalId: null,
      originalSessionFingerprint: null,
      ...overrides.session,
    },
    selection: {
      id: ID.selection,
      tenantId: ID.tenant,
      organizationId: ID.organization,
      legacyBranchId: null,
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

function serverAuth(
  activeContextToken: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    activeContextToken,
    apiTokenAuth: false,
    authorizationHeader: null,
    csrfCookie: CSRF,
    csrfHeader: CSRF,
    impersonating: false,
    origin: ORIGIN,
    rawCookieHeader: `sid=${SID}; csrf_token=${CSRF}; locale=en`,
    requestUserLegacyId: USER_ID,
    sessionCookie: SID,
    ...overrides,
  };
}

function runtimeOptions(
  activeContextToken: string,
  overrides: {
    serverAuth?: unknown;
    requestBody?: unknown;
    resolveCurrentAuthority?: () => Promise<unknown>;
  } = {},
) {
  return {
    serverAuth:
      overrides.serverAuth ?? serverAuth(activeContextToken),
    requestBody: overrides.requestBody ?? { manifest: { schemaVersion: 1 } },
    trustedOrigins: [ORIGIN],
    versionedActiveContext: {
      audience: AUDIENCE,
      environmentId: ENVIRONMENT,
      cellId: CELL,
      issuerId: ID.issuer,
      keyRing: [key()],
    },
    resolveCurrentAuthority:
      overrides.resolveCurrentAuthority ?? (async () => authority()),
    now: () => NOW,
  };
}

test("returns only the minimal server-derived execution identity and no-store policy", async () => {
  const token = await issue();
  const calls: unknown[] = [];
  const result = await resolvePublicWebPublicationExecutionIdentity(
    runtimeOptions(token, {
      requestBody: {
        manifest: {
          tenantId: "client-nested-value-is-not-an-authority-input",
        },
      },
      resolveCurrentAuthority: async (...args: unknown[]) => {
        calls.push(args);
        return authority();
      },
    }),
  );

  assert.deepEqual(result, {
    ok: true,
    identity: {
      tenantId: ID.tenant,
      organizationId: ID.organization,
      actorLegacyUserId: USER_ID,
      principalId: ID.principal,
      membershipId: ID.membership,
      selectionId: ID.selection,
      sessionGeneration: 4,
      sessionFingerprint: sessionFingerprint(),
      activeContextId: ID.context,
      activeContextExpiresAt: NOW + 60_000,
      responsePolicy: {
        cacheControl: PUBLIC_WEB_PUBLICATION_CACHE_CONTROL,
      },
    },
  });
  assert.equal(calls.length, 1);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(SID), false);
  assert.equal(serialized.includes(CSRF), false);
  assert.equal(serialized.includes(token), false);
});

test("rejects bearer, API-token, cookie, CSRF, origin, and request impersonation before authority access", async () => {
  const token = await issue();
  const cases: Array<{
    name: string;
    overrides: Record<string, unknown>;
    reason: string;
  }> = [
    {
      name: "authorization bearer",
      overrides: { authorizationHeader: "Bearer private-token" },
      reason: "authorization_header_forbidden",
    },
    {
      name: "api token middleware",
      overrides: { apiTokenAuth: true },
      reason: "api_token_forbidden",
    },
    {
      name: "duplicate session cookie",
      overrides: {
        rawCookieHeader:
          `sid=${SID}; sid=${OTHER_SID}; csrf_token=${CSRF}`,
      },
      reason: "session_invalid",
    },
    {
      name: "missing normalized session",
      overrides: { sessionCookie: null },
      reason: "session_invalid",
    },
    {
      name: "malformed session",
      overrides: { sessionCookie: "short" },
      reason: "session_invalid",
    },
    {
      name: "csrf mismatch",
      overrides: { csrfHeader: OTHER_CSRF },
      reason: "csrf_invalid",
    },
    {
      name: "untrusted origin",
      overrides: { origin: "https://evil.example" },
      reason: "origin_untrusted",
    },
    {
      name: "request impersonation",
      overrides: { impersonating: true },
      reason: "impersonation_forbidden",
    },
  ];

  for (const scenario of cases) {
    let resolverCalls = 0;
    const result = await resolvePublicWebPublicationExecutionIdentity(
      runtimeOptions(token, {
        serverAuth: serverAuth(token, scenario.overrides),
        resolveCurrentAuthority: async () => {
          resolverCalls += 1;
          return authority();
        },
      }),
    );
    assert.deepEqual(
      result,
      { ok: false, reason: scenario.reason },
      scenario.name,
    );
    assert.equal(resolverCalls, 0, scenario.name);
  }
});

test("rejects top-level body scope and actor overrides before authority access", async () => {
  const token = await issue();
  for (const requestBody of [
    { manifest: {}, tenantId: ID.tenant },
    { manifest: {}, scope: { tenantId: ID.tenant } },
    { manifest: {}, actorLegacyUserId: USER_ID },
    { manifest: {}, sessionFingerprint: sessionFingerprint() },
    { manifest: {}, activeContextId: ID.context },
    { manifest: {}, activeContextExpiresAt: NOW + 60_000 },
    { manifest: {}, adapterApprovalSha256: "e".repeat(64) },
    { manifest: {}, runtimeReleaseId: "client-selected-release" },
  ]) {
    let resolverCalls = 0;
    const result = await resolvePublicWebPublicationExecutionIdentity(
      runtimeOptions(token, {
        requestBody,
        resolveCurrentAuthority: async () => {
          resolverCalls += 1;
          return authority();
        },
      }),
    );
    assert.deepEqual(result, {
      ok: false,
      reason: "request_body_authority_forbidden",
    });
    assert.equal(resolverCalls, 0);
  }
});

test("fails closed for missing, malformed, or unavailable server sessions", async () => {
  const token = await issue();
  for (const resolved of [null, {}, { session: null }]) {
    const result = await resolvePublicWebPublicationExecutionIdentity(
      runtimeOptions(token, {
        resolveCurrentAuthority: async () => resolved,
      }),
    );
    assert.deepEqual(result, { ok: false, reason: "session_invalid" });
  }
  const unavailable = await resolvePublicWebPublicationExecutionIdentity(
    runtimeOptions(token, {
      resolveCurrentAuthority: async () => {
        throw new Error("private session repository detail");
      },
    }),
  );
  assert.deepEqual(unavailable, { ok: false, reason: "session_unavailable" });
  assert.equal(
    JSON.stringify(unavailable).includes("private session repository detail"),
    false,
  );
});

test("rejects server-side impersonation and all legacy-branch scope", async () => {
  const token = await issue();
  const impersonated = await resolvePublicWebPublicationExecutionIdentity(
    runtimeOptions(token, {
      resolveCurrentAuthority: async () => authority({
        session: { impersonatorPrincipalId: ID.impersonator },
      }),
    }),
  );
  assert.deepEqual(impersonated, {
    ok: false,
    reason: "impersonation_forbidden",
  });

  const branchScoped = await resolvePublicWebPublicationExecutionIdentity(
    runtimeOptions(token, {
      resolveCurrentAuthority: async () => authority({
        session: { legacyBranchId: 41 },
        selection: { legacyBranchId: 41 },
      }),
    }),
  );
  assert.deepEqual(branchScoped, {
    ok: false,
    reason: "legacy_branch_scope_forbidden",
  });
});

test("binds req.user legacy identity to the current principal and selection", async () => {
  const token = await issue();
  const principalMappingDrift =
    await resolvePublicWebPublicationExecutionIdentity(
      runtimeOptions(token, {
        resolveCurrentAuthority: async () => authority({
          principalLegacyUserId: USER_ID + 1,
        }),
      }),
    );
  assert.deepEqual(principalMappingDrift, {
    ok: false,
    reason: "identity_mismatch",
  });

  const selectionMappingDrift =
    await resolvePublicWebPublicationExecutionIdentity(
      runtimeOptions(token, {
        resolveCurrentAuthority: async () => authority({
          selection: { legacyUserId: USER_ID + 1 },
        }),
      }),
    );
  assert.deepEqual(selectionMappingDrift, {
    ok: false,
    reason: "identity_mismatch",
  });
});

test("rejects stale current selections and stale token session generations", async () => {
  const token = await issue();
  const staleSelection = await resolvePublicWebPublicationExecutionIdentity(
    runtimeOptions(token, {
      resolveCurrentAuthority: async () => authority({
        selection: { id: ID.otherSelection },
      }),
    }),
  );
  assert.deepEqual(staleSelection, {
    ok: false,
    reason: "authority_not_current",
  });

  const staleGenerationToken = await issue({ sessionGeneration: 3 });
  const staleGeneration =
    await resolvePublicWebPublicationExecutionIdentity(
      runtimeOptions(staleGenerationToken),
    );
  assert.deepEqual(staleGeneration, {
    ok: false,
    reason: "active_context_rejected",
  });
});

test("denies a current identity when public web write capability is absent", async () => {
  const token = await issue();
  const result = await resolvePublicWebPublicationExecutionIdentity(
    runtimeOptions(token, {
      resolveCurrentAuthority: async () => authority({ state: state(false) }),
    }),
  );
  assert.deepEqual(result, { ok: false, reason: "capability_denied" });
});
