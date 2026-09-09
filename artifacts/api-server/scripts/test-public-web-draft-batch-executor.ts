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
} from "../src/lib/activeTenantContext.js";
import { executePublicWebDraftBatch } from "../src/lib/publicWebDraftBatchExecutor.js";
import { planPublicWebDraftBatch } from "../src/lib/publicWebDraftBatchPlanner.js";
import type { PublicWebDraftIntakeRequest } from "../src/lib/publicWebDraftIntakeBuilder.js";

const NOW = 2_000_000_000_000;
const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const ID = {
  context: "018fa800-0000-7000-8000-000000000001",
  tenant: "018fa800-0000-7000-8000-000000000002",
  organization: "018fa800-0000-7000-8000-000000000003",
  principal: "018fa800-0000-7000-8000-000000000004",
  membership: "018fa800-0000-7000-8000-000000000005",
  assignment: "018fa800-0000-7000-8000-000000000006",
  package: "018fa800-0000-7000-8000-000000000007",
  policy: "018fa800-0000-7000-8000-000000000008",
  selection: "018fa800-0000-7000-8000-000000000009",
  issuer: "018fa800-0000-7000-8000-00000000000a",
} as const;

const pair = crypto.generateKeyPairSync("ed25519");
const publicKeyPem = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
const key: ActiveContextVerificationKey = {
  keyId: "public-web-batch-key-2026-09",
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

async function verifiedContext() {
  const token = await issueVersionedActiveTenantContext({
    subject: {
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
    },
    audience: "fas.public-web.draft-intake",
    environmentId: "test",
    cellId: "cell-a",
    issuerId: ID.issuer,
    keyId: key.keyId,
    keyReference: "test-memory://public-web/batch-key",
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
    expectedSelection: { selectionId: ID.selection, sessionGeneration: 2 },
    now: NOW,
  });
  assert.equal(verified.ok, true);
  if (!verified.ok) throw new Error(verified.reason);
  return verified.context;
}

function state(allowed = true): ResolvedActiveContextState {
  return {
    tenant: { id: ID.tenant, status: "ACTIVE", policyVersion: 3 },
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
      version: 3,
      state: "ACTIVE",
      effectiveAt: NOW - 60_000,
      revokedAt: null,
    },
    assignments: allowed ? [{
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
    }] : [],
  };
}

function request(entityId: number): PublicWebDraftIntakeRequest {
  return {
    entityType: "PROGRAM",
    entityId,
    locale: "en",
    canonicalSlug: `programme-${entityId}`,
    origin: "IMPORT",
    title: `Programme ${entityId}`,
    summary: null,
    contentJson: { body: `Programme ${entityId}` },
    seoJson: {},
    structuredDataJson: { "@type": "Course" },
    generatorReceiptSha256: null,
    idempotencyKey: `public-web.batch.execute-${String(entityId).padStart(4, "0")}`,
  };
}

function uuidFactory() {
  let counter = 100;
  return () => `018fa800-0000-7000-8000-${(counter += 1).toString(16).padStart(12, "0")}`;
}

const scope = { tenantId: ID.tenant, organizationId: ID.organization };
const source = async (entityType: "PROGRAM", entityId: number) => ({
  entityType,
  entityId,
  sourceSha256: SHA_A,
});

test("revalidates a matching plan and executes with at most two concurrent writes", async () => {
  const requests = Array.from({ length: 6 }, (_, index) => request(index + 1));
  const preview = await planPublicWebDraftBatch({ scope, requests, resolveSource: source });
  const context = await verifiedContext();
  let active = 0;
  let peak = 0;
  const result = await executePublicWebDraftBatch({
    scope,
    requests,
    expectedPlanSha256: preview.planSha256,
    actorLegacyUserId: 42,
    resolveSource: source,
    resolveCurrentAuthorization: async () => ({ context, state: state(), impersonating: false }),
    executeAuthorizedDraft: async ({ authorized }) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
      return {
        outcome: "APPLIED",
        intakeReceiptId: "018fa800-0000-7000-8000-0000000000ff",
        contentRecordId: authorized.command.contentRecordId,
        revisionId: authorized.command.revisionId,
        status: "DRAFT",
        indexState: "NOINDEX",
        version: 1,
      };
    },
    now: () => NOW,
    newUuidV7: uuidFactory(),
  });
  assert.equal(result.completed.length, 6);
  assert.equal(result.failed.length, 0);
  assert.equal(result.rejected.length, 0);
  assert.ok(peak <= 2);
  assert.ok(result.completed.every((item) => item.status === "DRAFT" && item.indexState === "NOINDEX"));
});

test("fails the whole execution before writes when the reviewed plan has changed", async () => {
  const requests = [request(1)];
  const preview = await planPublicWebDraftBatch({ scope, requests, resolveSource: source });
  let writes = 0;
  await assert.rejects(executePublicWebDraftBatch({
    scope,
    requests,
    expectedPlanSha256: preview.planSha256,
    actorLegacyUserId: 42,
    resolveSource: async (entityType, entityId) => ({ entityType, entityId, sourceSha256: SHA_B }),
    resolveCurrentAuthorization: async () => { throw new Error("must not authorize"); },
    executeAuthorizedDraft: async () => { writes += 1; throw new Error("must not write"); },
  }), /batch_plan_changed/);
  assert.equal(writes, 0);
});

test("isolates rejected, unavailable-authority, denied and failed rows without leaking details", async () => {
  const requests = [request(1), request(2), request(3), request(4), request(5)];
  const resolveSource = async (entityType: "PROGRAM", entityId: number) => entityId === 5
    ? null
    : { entityType, entityId, sourceSha256: SHA_A };
  const preview = await planPublicWebDraftBatch({ scope, requests, resolveSource });
  const context = await verifiedContext();
  const result = await executePublicWebDraftBatch({
    scope,
    requests,
    expectedPlanSha256: preview.planSha256,
    actorLegacyUserId: 42,
    resolveSource,
    resolveCurrentAuthorization: async ({ request: row }) => {
      if (row.entityId === 2) throw new Error("private authority backend detail");
      return { context, state: state(row.entityId !== 3), impersonating: false };
    },
    executeAuthorizedDraft: async ({ authorized }) => {
      if (authorized.command.entityId === 4) throw new Error("private database detail");
      return {
        outcome: "REPLAY",
        intakeReceiptId: "018fa800-0000-7000-8000-0000000000fe",
        contentRecordId: authorized.command.contentRecordId,
        revisionId: authorized.command.revisionId,
        status: "DRAFT",
        indexState: "NOINDEX",
        version: 1,
      };
    },
    now: () => NOW,
    newUuidV7: uuidFactory(),
  });
  assert.deepEqual(result.completed.map(({ index }) => index), [0]);
  assert.deepEqual(result.failed, [
    { index: 1, reason: "authority_unavailable" },
    { index: 2, reason: "authorization_denied" },
    { index: 3, reason: "execution_failed" },
  ]);
  assert.deepEqual(result.rejected, [{ index: 4, reason: "source_missing" }]);
  assert.equal(JSON.stringify(result).includes("private"), false);
});

test("rejects invalid execution identity and plan hash before planning", async () => {
  await assert.rejects(executePublicWebDraftBatch({
    scope,
    requests: [request(1)],
    expectedPlanSha256: "invalid",
    actorLegacyUserId: 0,
    resolveSource: source,
    resolveCurrentAuthorization: async () => { throw new Error("unreachable"); },
    executeAuthorizedDraft: async () => { throw new Error("unreachable"); },
  }), /batch_execution_input_invalid/);
});

test("rejects a malformed or cross-record store success as an execution failure", async () => {
  const requests = [request(1)];
  const preview = await planPublicWebDraftBatch({ scope, requests, resolveSource: source });
  const context = await verifiedContext();
  const result = await executePublicWebDraftBatch({
    scope,
    requests,
    expectedPlanSha256: preview.planSha256,
    actorLegacyUserId: 42,
    resolveSource: source,
    resolveCurrentAuthorization: async () => ({ context, state: state(), impersonating: false }),
    executeAuthorizedDraft: async () => ({
      outcome: "APPLIED",
      intakeReceiptId: "018fa800-0000-7000-8000-0000000000fd",
      contentRecordId: "018fa800-0000-7000-8000-0000000000fc",
      revisionId: "018fa800-0000-7000-8000-0000000000fb",
      status: "DRAFT",
      indexState: "NOINDEX",
      version: 1,
    }),
    now: () => NOW,
    newUuidV7: uuidFactory(),
  });
  assert.deepEqual(result.completed, []);
  assert.deepEqual(result.failed, [{ index: 0, reason: "execution_failed" }]);
});
