import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import type { Request } from "express";
import { createPersonaCookieSession } from "../src/lib/personaCookieSession";
import { fingerprintActiveContextPublicKey } from "../src/lib/activeTenantContext";
import { ABSOLUTE_SESSION_TTL } from "../src/lib/sessionLifetime";
import { createPersonaRuntimeBoundary } from "../src/lib/personaRuntimeBoundary";

process.env.NODE_ENV = "test";
process.env.ALLOW_LIVE_INTEGRATIONS = "false";
const id = (n: number) => `018f6100-0000-7000-8000-${String(n).padStart(12, "0")}`;
const sid = "a".repeat(64), csrf = "c".repeat(64), origin = "http://127.0.0.1:9999";
function request(headers: Record<string, string> = {}) {
  return { headers: { cookie: `sid=${sid}; csrf_token=${csrf}`, origin, "x-csrf-token": csrf, ...headers } } as unknown as Request;
}
function fixture(staging = false) {
  const now = Date.now();
  const environmentId = staging ? "staging" : "test";
  const pair = crypto.generateKeyPairSync("ed25519");
  const publicKeyPem = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
  let sessionReads = 0, issuances = 0;
  const session: any = {
    selectionId: id(5), sessionFingerprint: crypto.createHash("sha256").update(sid).digest("hex"),
    sessionGeneration: 1, status: "ACTIVE", accountStatus: "ACTIVE", authenticatedPrincipalId: id(3),
    tenantId: id(1), organizationId: id(2), legacyBranchId: null, issuedAt: now - 10000,
    idleExpiresAt: now + 180000, absoluteExpiresAt: now - 10000 + ABSOLUTE_SESSION_TTL,
    impersonatorPrincipalId: null, originalSessionFingerprint: null,
  };
  const authority = {
    tenant: { id: id(1), status: "ACTIVE", policyVersion: 1 },
    principal: { id: id(3), principalType: "HUMAN", status: "ACTIVE", riskState: "NORMAL" },
    membership: { id: id(4), tenantId: id(1), organizationId: id(2), legacyBranchId: null, principalId: id(3), status: "ACTIVE", validFrom: now - 10000, validUntil: null },
    policy: { id: id(6), tenantId: id(1), version: 1, state: "ACTIVE", effectiveAt: now - 10000, revokedAt: null },
    assignments: [{ id: id(7), tenantId: id(1), membershipId: id(4), status: "ACTIVE", validFrom: now - 10000, validUntil: null }],
  };
  const key: any = { keyId: "persona-cookie-unit", algorithm: "Ed25519", state: "ACTIVE", issuerId: id(8), environmentId, cellId: "test", publicKeyPem, publicKeyFingerprint: fingerprintActiveContextPublicKey(publicKeyPem), signFrom: now - 10000, signUntil: now + 180000, verifyUntil: now + 240000 };
  const resolve = createPersonaCookieSession({
    trustedOrigins: [staging ? "https://staging.findandstudy.com" : origin],
    sessionRepository: {
      async withLockedCurrentSession(input, operation) {
        sessionReads++;
        assert.equal(input.sessionId, sid);
        return operation(structuredClone(session));
      },
    },
    rateLimiter: {
      async consume(input) {
        issuances++;
        return { allowed: true, permitId: id(9), subjectHash: input.subjectHash, issuedAt: input.observedAt, expiresAt: input.observedAt + 10000 };
      },
    },
    issuance: {
      repository: { async withLockedCurrentState(_input, operation) { return operation(structuredClone(authority)); } },
      audience: "persona-mock", environmentId, cellId: "test", issuerId: id(8), keyId: "persona-cookie-unit",
      // KMS is a test double here, not a configured/verified staging provider.
      keyReference: staging ? "kms://persona-cookie-unit" : "test-memory://persona-cookie-unit",
      keyRing: [key],
      signer: { async sign(input) { return crypto.sign(null, input.signingInput, pair.privateKey); } },
      nextUuidV7: () => id(10),
    },
  }, staging ? createPersonaRuntimeBoundary({
    mode: "staging-mock", publicOrigin: "https://staging.findandstudy.com",
    database: { name: "fasos_staging", host: "172.30.0.2", port: 5432, role: "fas_persona_staging_executor" },
  }) : undefined);
  return { resolve, session, key, counts: () => ({ sessionReads, issuances }) };
}
test("local autosave session reuse rechecks session without consuming an issuance per request", async () => {
  const f = fixture();
  const first = await f.resolve(request());
  for (let i = 0; i < 12; i++) assert.equal((await f.resolve(request())).token, first.token);
  assert.equal(f.counts().issuances, 1);
  assert.equal(f.counts().sessionReads, 13);
  await first.sessionBoundary!(async () => undefined);
  assert.equal(f.counts().sessionReads, 14);
});
test("concurrent local requests share one canonical issuance, not one authority check", async () => {
  const f = fixture();
  const result = await Promise.all(Array.from({ length: 12 }, () => f.resolve(request())));
  assert.equal(new Set(result.map((v) => v.token)).size, 1);
  assert.equal(f.counts().issuances, 1);
  assert.equal(f.counts().sessionReads, 12);
});
for (const [field, value] of [
  ["status", "REVOKED"], ["accountStatus", "INACTIVE"], ["selectionId", id(99)],
  ["sessionGeneration", 2], ["organizationId", id(99)], ["idleExpiresAt", 0],
] as const) test(`cached token denies current session change: ${field}`, async () => {
  const f = fixture(); await f.resolve(request()); f.session[field] = value;
  await assert.rejects(f.resolve(request()), /PERSONA_SESSION_REVOKED/);
});
test("cached token cannot skip canonical CSRF, origin, duplicate cookie or authorization checks", async () => {
  const f = fixture(); await f.resolve(request());
  for (const headers of [
    { "x-csrf-token": "d".repeat(64) },
    { origin: "https://untrusted.example.test" },
    { cookie: `sid=${sid}; sid=${sid}; csrf_token=${csrf}` },
    { authorization: "Bearer forged" },
  ]) await assert.rejects(f.resolve(request(headers)), /PERSONA_SESSION_/);
  assert.equal(f.counts().issuances, 1);
});
test("valid changed CSRF binding goes through canonical issuance again", async () => {
  const f = fixture(); await f.resolve(request());
  const changed = "d".repeat(64);
  await f.resolve(request({ cookie: `sid=${sid}; csrf_token=${changed}`, "x-csrf-token": changed }));
  assert.equal(f.counts().issuances, 2);
});
test("runtime mock kill-switch rejects both cached resolution and existing identity use", async () => {
  const f = fixture(), identity = await f.resolve(request());
  process.env.ALLOW_LIVE_INTEGRATIONS = "true";
  try {
    await assert.rejects(f.resolve(request()), /PERSONA_MOCK_ONLY/);
    await assert.rejects(identity.sessionBoundary!(async () => undefined), /PERSONA_MOCK_ONLY/);
  } finally { process.env.ALLOW_LIVE_INTEGRATIONS = "false"; }
});
test("revoked signing key cannot validate a cached envelope or issue a replacement", async () => {
  const f = fixture(); await f.resolve(request()); f.key.state = "REVOKED";
  await assert.rejects(f.resolve(request()), /PERSONA_SESSION_|PERSONA_AUTH_REQUIRED/);
});
test("staging policy uses the same canonical cookie issuance, current session locks and CSRF checks", async () => {
  const previousMode = process.env.PERSONA_RUNTIME_MODE, previousBase = process.env.APP_BASE_URL;
  process.env.NODE_ENV = "production";
  process.env.PERSONA_RUNTIME_MODE = "staging-mock";
  process.env.APP_BASE_URL = "https://staging.findandstudy.com";
  try {
    const f = fixture(true), valid = request({ origin: "https://staging.findandstudy.com" });
    const identity = await f.resolve(valid);
    assert.equal(identity.principalId, id(3));
    assert.equal((await f.resolve(valid)).token, identity.token);
    await identity.sessionBoundary!(async () => undefined);
    assert.deepEqual(f.counts(), { sessionReads: 3, issuances: 1 });
    await assert.rejects(f.resolve(request({ origin: "https://staging.findandstudy.com", "x-csrf-token": "forged" })), /PERSONA_SESSION_/);
    await assert.rejects(f.resolve(request({ origin: "https://apply.findandstudy.com" })), /PERSONA_SESSION_/);
    f.session.status = "REVOKED";
    await assert.rejects(f.resolve(valid), /PERSONA_SESSION_REVOKED/);
    await assert.rejects(identity.sessionBoundary!(async () => undefined), /PERSONA_SESSION_REVOKED/);
    process.env.PERSONA_RUNTIME_MODE = "off";
    await assert.rejects(f.resolve(valid), /PERSONA_STAGING_MOCK_ONLY/);
  } finally {
    process.env.NODE_ENV = "test";
    if (previousMode === undefined) delete process.env.PERSONA_RUNTIME_MODE; else process.env.PERSONA_RUNTIME_MODE = previousMode;
    if (previousBase === undefined) delete process.env.APP_BASE_URL; else process.env.APP_BASE_URL = previousBase;
  }
});
