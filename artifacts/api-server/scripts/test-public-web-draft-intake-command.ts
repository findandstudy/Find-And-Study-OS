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
  type ResolvedActiveContextState,
  type VerifiedActiveTenantContext,
} from "../src/lib/activeTenantContext.js";
import {
  authorizePublicWebDraftIntakeCommand,
  hashPublicWebDraftIntakeCommand,
  hashPublicWebDraftRevision,
  parsePublicWebDraftIntakeCommand,
  type PublicWebDraftIntakeCommand,
} from "../src/lib/publicWebDraftIntakeCommand.js";

const NOW = 2_000_000_000_000;
const SESSION_ID = "1".repeat(64);
const sessionBinding = {
  sessionId: SESSION_ID,
  sessionFingerprint: crypto.createHash("sha256").update(SESSION_ID, "utf8").digest("hex"),
};
const ID = {
  context: "018fa200-0000-7000-8000-000000000001",
  tenant: "018fa200-0000-7000-8000-000000000002",
  otherTenant: "018fa200-0000-7000-8000-000000000003",
  organization: "018fa200-0000-7000-8000-000000000004",
  principal: "018fa200-0000-7000-8000-000000000005",
  membership: "018fa200-0000-7000-8000-000000000006",
  assignment: "018fa200-0000-7000-8000-000000000007",
  package: "018fa200-0000-7000-8000-000000000008",
  policy: "018fa200-0000-7000-8000-000000000009",
  selection: "018fa200-0000-7000-8000-00000000000a",
  issuer: "018fa200-0000-7000-8000-00000000000b",
  content: "018fa200-0000-7000-8000-00000000000c",
  revision: "018fa200-0000-7000-8000-00000000000d",
} as const;

const pair = crypto.generateKeyPairSync("ed25519");
const publicKeyPem = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
const key: ActiveContextVerificationKey = {
  keyId: "public-web-draft-key-2026-09",
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

async function context(legacyBranchId: number | null = null): Promise<VerifiedActiveTenantContext> {
  const token = await issueVersionedActiveTenantContext({
    subject: {
      contextId: ID.context,
      tenantId: ID.tenant,
      organizationId: ID.organization,
      legacyBranchId,
      principalId: ID.principal,
      membershipId: ID.membership,
      assignmentIds: [ID.assignment],
      policyVersionId: ID.policy,
      policyVersion: 4,
      selectionId: ID.selection,
      sessionGeneration: 3,
    },
    audience: "fas.public-web.draft-intake",
    environmentId: "test",
    cellId: "cell-a",
    issuerId: ID.issuer,
    keyId: key.keyId,
    keyReference: "test-memory://public-web/draft-key",
    keyRing: [key],
    signer,
    now: NOW,
    ttlMs: 60_000,
  });
  const verified = verifyVersionedActiveTenantContext({
    token,
    keyRing: [key],
    expected: {
      audience: "fas.public-web.draft-intake",
      environmentId: "test",
      cellId: "cell-a",
      issuerId: ID.issuer,
      tenantId: ID.tenant,
    },
    expectedSelectionBinding: { selectionId: ID.selection, sessionGeneration: 3 },
    now: NOW,
  });
  assert.equal(verified.ok, true);
  if (!verified.ok) throw new Error(verified.reason);
  return verified.context;
}

function state(): ResolvedActiveContextState {
  return {
    tenant: { id: ID.tenant, status: "ACTIVE", policyVersion: 4 },
    principal: { id: ID.principal, principalType: "HUMAN", status: "ACTIVE", riskState: "NORMAL" },
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
      capabilities: [{
        key: "public_web.content.write",
        effect: "ALLOW",
        status: "ACTIVE",
        stepUpRequired: false,
        approvalRequired: false,
      }],
    }],
  };
}

function command(overrides: Partial<PublicWebDraftIntakeCommand> = {}): PublicWebDraftIntakeCommand {
  const base = {
    tenantId: ID.tenant,
    organizationId: ID.organization,
    contentRecordId: ID.content,
    revisionId: ID.revision,
    entityType: "PAGE" as const,
    entityId: 41,
    locale: "en" as const,
    canonicalSlug: "student-guidance",
    canonicalPath: "/en/student-guidance",
    origin: "HUMAN" as const,
    title: "Student guidance",
    summary: "A governed draft.",
    contentJson: { blocks: [{ type: "rich_text", text: "Safe content" }] },
    seoJson: { title: "Student guidance" },
    structuredDataJson: { "@type": "WebPage" },
    sourceSha256: "a".repeat(64),
    contentSha256: "",
    generatorReceiptSha256: null,
    idempotencyKey: "public-web.draft.fixture-1",
    ...overrides,
  };
  return { ...base, contentSha256: overrides.contentSha256 ?? hashPublicWebDraftRevision(base) };
}

test("parses one bounded draft and produces stable content and request hashes", () => {
  const input = command();
  assert.deepEqual(parsePublicWebDraftIntakeCommand(input), input);
  assert.match(input.contentSha256, /^[0-9a-f]{64}$/);
  assert.equal(
    hashPublicWebDraftIntakeCommand(input),
    hashPublicWebDraftIntakeCommand(command({
      contentRecordId: "018fa200-0000-7000-8000-00000000000e",
      revisionId: "018fa200-0000-7000-8000-00000000000f",
      idempotencyKey: "public-web.draft.retry-0001",
    })),
  );
  assert.notEqual(
    hashPublicWebDraftIntakeCommand(input),
    hashPublicWebDraftIntakeCommand(command({ title: "Changed student guidance" })),
  );
});

test("rejects hash drift, route spoofing, reserved pages and unsafe JSON shapes", () => {
  assert.equal(parsePublicWebDraftIntakeCommand(command({ contentSha256: "b".repeat(64) })), null);
  assert.equal(parsePublicWebDraftIntakeCommand(command({ canonicalPath: "/en/admin" })), null);
  assert.equal(parsePublicWebDraftIntakeCommand(command({ canonicalSlug: "admin", canonicalPath: "/en/admin" })), null);
  assert.equal(parsePublicWebDraftIntakeCommand({ ...command(), clientRole: "super_admin" }), null);
  const polluted = JSON.parse('{"__proto__":{"polluted":true}}') as Record<string, unknown>;
  assert.equal(parsePublicWebDraftIntakeCommand(command({ contentJson: polluted })), null);
  assert.equal(parsePublicWebDraftIntakeCommand(command({
    origin: "AI_ASSISTED",
    generatorReceiptSha256: null,
  })), null);
});

test("authorizes exact tenant scope and denies impersonation", async () => {
  const allowed = authorizePublicWebDraftIntakeCommand({
    context: await context(),
    sessionBinding,
    state: state(),
    command: command(),
    impersonating: false,
    now: NOW,
  });
  assert.equal(allowed.ok, true);
  if (allowed.ok) {
    assert.equal(allowed.value.capabilityKey, "public_web.content.write");
    assert.equal(allowed.value.decisionReceipt.resourceId, ID.content);
  }
  assert.deepEqual(authorizePublicWebDraftIntakeCommand({
    context: await context(), sessionBinding, state: state(), command: command(), impersonating: true, now: NOW,
  }), { ok: false, reason: "impersonation_forbidden" });
});

test("denies cross-tenant intake and capability configurations requiring missing assurance", async () => {
  const crossTenant = authorizePublicWebDraftIntakeCommand({
    context: await context(),
    sessionBinding,
    state: state(),
    command: command({ tenantId: ID.otherTenant }),
    impersonating: false,
    now: NOW,
  });
  assert.equal(crossTenant.ok, false);
  if (!crossTenant.ok) assert.equal(crossTenant.detail, "resource_not_found");

  const guarded = state();
  guarded.assignments[0]!.capabilities[0]!.stepUpRequired = true;
  const missingAssurance = authorizePublicWebDraftIntakeCommand({
    context: await context(), sessionBinding, state: guarded, command: command(), impersonating: false, now: NOW,
  });
  assert.equal(missingAssurance.ok, false);
  if (!missingAssurance.ok) assert.equal(missingAssurance.detail, "step_up_required");
});

test("fails closed for legacy-branch active contexts until DB support exists", async () => {
  const branchContext = await context(17);
  const denied = authorizePublicWebDraftIntakeCommand({
    context: branchContext,
    sessionBinding,
    state: state(),
    command: command(),
    impersonating: false,
    now: NOW,
  });
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.detail, "legacy_branch_scope_forbidden");
});

test("binds the raw server session to its fingerprint and rejects substitution", async () => {
  const allowed = authorizePublicWebDraftIntakeCommand({
    context: await context(), sessionBinding, state: state(), command: command(),
    impersonating: false, now: NOW,
  });
  assert.equal(allowed.ok, true);
  if (allowed.ok) {
    assert.deepEqual(allowed.value.executionBinding, {
      contextId: ID.context,
      contextIssuedAt: NOW,
      contextExpiresAt: NOW + 60_000,
      selectionId: ID.selection,
      sessionGeneration: 3,
      ...sessionBinding,
    });
  }
  const denied = authorizePublicWebDraftIntakeCommand({
    context: await context(),
    sessionBinding: { ...sessionBinding, sessionFingerprint: "f".repeat(64) },
    state: state(), command: command(), impersonating: false, now: NOW,
  });
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.reason, "context_not_selection_bound");
});
