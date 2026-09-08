import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import {
  ACTIVE_CONTEXT_V2_ALGORITHM,
  fingerprintActiveContextPublicKey,
  issueVersionedActiveTenantContext,
  verifyVersionedActiveTenantContext,
  type ActiveContextExternalSigner,
  type ActiveContextVerificationKey,
  type ActiveContextVersionedSubject,
  type ResolvedActiveContextState,
  type VerifiedActiveTenantContext,
} from "../src/lib/activeTenantContext.js";
import {
  authorizePublicWebPublicationCommand,
  hashPublicWebPublicationCommand,
  type PublicWebPublicationCommand,
} from "../src/lib/publicWebPublicationCommand.js";

const NOW = 2_000_000_000_000;
const ID = {
  context: "018fa100-0000-7000-8000-000000000001",
  tenant: "018fa100-0000-7000-8000-000000000002",
  otherTenant: "018fa100-0000-7000-8000-000000000003",
  organization: "018fa100-0000-7000-8000-000000000004",
  principal: "018fa100-0000-7000-8000-000000000005",
  membership: "018fa100-0000-7000-8000-000000000006",
  assignment: "018fa100-0000-7000-8000-000000000007",
  package: "018fa100-0000-7000-8000-000000000008",
  policy: "018fa100-0000-7000-8000-000000000009",
  selection: "018fa100-0000-7000-8000-00000000000a",
  issuer: "018fa100-0000-7000-8000-00000000000b",
  content: "018fa100-0000-7000-8000-00000000000c",
  revision: "018fa100-0000-7000-8000-00000000000d",
} as const;
const pair = crypto.generateKeyPairSync("ed25519");
const publicKeyPem = pair.publicKey
  .export({ type: "spki", format: "pem" })
  .toString();
const key: ActiveContextVerificationKey = {
  keyId: "public-web-context-key-2026-09",
  algorithm: ACTIVE_CONTEXT_V2_ALGORITHM,
  state: "ACTIVE",
  issuerId: ID.issuer,
  environmentId: "test",
  cellId: "cell-a",
  publicKeyPem,
  publicKeyFingerprint: fingerprintActiveContextPublicKey(publicKeyPem),
  signFrom: NOW - 60_000,
  signUntil: NOW + 60_000,
  verifyUntil: NOW + 120_000,
};
const signer: ActiveContextExternalSigner = {
  async sign(input) {
    return crypto.sign(null, input.signingInput, pair.privateKey);
  },
};

async function context(): Promise<VerifiedActiveTenantContext> {
  const subject: ActiveContextVersionedSubject = {
    contextId: ID.context,
    tenantId: ID.tenant,
    organizationId: ID.organization,
    legacyBranchId: null,
    principalId: ID.principal,
    membershipId: ID.membership,
    assignmentIds: [ID.assignment],
    policyVersionId: ID.policy,
    policyVersion: 3,
    selectionId: ID.selection,
    sessionGeneration: 2,
  };
  const token = await issueVersionedActiveTenantContext({
    subject,
    audience: "fas.public-web.command",
    environmentId: "test",
    cellId: "cell-a",
    issuerId: ID.issuer,
    keyId: key.keyId,
    keyReference: "test-memory://public-web/key-a",
    keyRing: [key],
    signer,
    now: NOW,
    ttlMs: 60_000,
  });
  const verified = verifyVersionedActiveTenantContext({
    token,
    keyRing: [key],
    expected: {
      audience: "fas.public-web.command",
      environmentId: "test",
      cellId: "cell-a",
      issuerId: ID.issuer,
      tenantId: ID.tenant,
    },
    expectedSelection: { selectionId: ID.selection, sessionGeneration: 2 },
    now: NOW,
  });
  assert.equal(verified.ok, true);
  if (!verified.ok) throw new Error(verified.reason);
  return verified.context;
}

function command(
  overrides: Partial<PublicWebPublicationCommand> = {},
): PublicWebPublicationCommand {
  return {
    type: "PUBLISH",
    tenantId: ID.tenant,
    organizationId: ID.organization,
    contentRecordId: ID.content,
    revisionId: ID.revision,
    expectedVersion: 3,
    idempotencyKey: "public-web.publish.fixture-1",
    evidenceSha256: "a".repeat(64),
    staleReasonCode: null,
    ...overrides,
  };
}

function state(
  capability = "public_web.content.publish",
  overrides: Partial<
    ResolvedActiveContextState["assignments"][number]["capabilities"][number]
  > = {},
): ResolvedActiveContextState {
  return {
    tenant: { id: ID.tenant, status: "ACTIVE", policyVersion: 3 },
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
      version: 3,
      state: "ACTIVE",
      effectiveAt: NOW - 60_000,
      revokedAt: null,
    },
    assignments: [
      {
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
        capabilities: [
          {
            key: capability,
            effect: "ALLOW",
            status: "ACTIVE",
            stepUpRequired: true,
            approvalRequired: true,
            ...overrides,
          },
        ],
      },
    ],
  };
}

test("selection-bound active context authorizes exact publish scope", async () => {
  const result = authorizePublicWebPublicationCommand({
    context: await context(),
    state: state(),
    command: command(),
    assurance: {
      stepUpSatisfied: true,
      approvalSatisfied: true,
      impersonating: false,
    },
    now: NOW,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.capabilityKey, "public_web.content.publish");
  assert.equal(result.value.decisionReceipt.resourceId, ID.content);
  assert.match(result.value.requestHash, /^[0-9a-f]{64}$/);
});

test("cross-tenant and cross-organization resources fail closed", async () => {
  for (const attempted of [
    command({ tenantId: ID.otherTenant }),
    command({ organizationId: ID.otherTenant }),
  ]) {
    const result = authorizePublicWebPublicationCommand({
      context: await context(),
      state: state(),
      command: attempted,
      assurance: {
        stepUpSatisfied: true,
        approvalSatisfied: true,
        impersonating: false,
      },
      now: NOW,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "authorization_denied");
      assert.equal(result.detail, "resource_not_found");
    }
  }
});

test("publish requires step-up and approval and rejects impersonation", async () => {
  for (const [assurance, expected] of [
    [
      {
        stepUpSatisfied: false,
        approvalSatisfied: true,
        impersonating: false,
      },
      "step_up_required",
    ],
    [
      {
        stepUpSatisfied: true,
        approvalSatisfied: false,
        impersonating: false,
      },
      "approval_required",
    ],
  ] as const) {
    const result = authorizePublicWebPublicationCommand({
      context: await context(),
      state: state(),
      command: command(),
      assurance,
      now: NOW,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.detail, expected);
  }

  const impersonated = authorizePublicWebPublicationCommand({
    context: await context(),
    state: state(),
    command: command(),
    assurance: {
      stepUpSatisfied: true,
      approvalSatisfied: true,
      impersonating: true,
    },
    now: NOW,
  });
  assert.deepEqual(impersonated, {
    ok: false,
    reason: "impersonation_forbidden",
  });
});

test("command parsing is exact and request hashes expose idempotency conflicts", async () => {
  const valid = command();
  const extra = { ...valid, clientRole: "super_admin" };
  const malformed = authorizePublicWebPublicationCommand({
    context: await context(),
    state: state(),
    command: extra,
    assurance: {
      stepUpSatisfied: true,
      approvalSatisfied: true,
      impersonating: false,
    },
    now: NOW,
  });
  assert.deepEqual(malformed, { ok: false, reason: "invalid_command" });
  assert.notEqual(
    hashPublicWebPublicationCommand(valid),
    hashPublicWebPublicationCommand(command({ expectedVersion: 4 })),
  );
  assert.equal(
    hashPublicWebPublicationCommand(valid),
    hashPublicWebPublicationCommand(
      command({ idempotencyKey: "public-web.publish.fixture-retry" }),
    ),
  );
});
