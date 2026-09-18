import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import { canonicalJson } from "../src/lib/jsonCanonical.js";
import {
  PUBLIC_WEB_DRAFT_PREVIEW_RECEIPT_ALGORITHM,
  PUBLIC_WEB_DRAFT_PREVIEW_RECEIPT_AUDIENCE,
  PUBLIC_WEB_DRAFT_PREVIEW_RECEIPT_CLOCK_SKEW_MS,
  PUBLIC_WEB_DRAFT_PREVIEW_RECEIPT_DOMAIN,
  PUBLIC_WEB_DRAFT_PREVIEW_RECEIPT_MAX_TTL_MS,
  fingerprintPublicWebDraftPreviewReceiptPublicKey,
  isVerifiedPublicWebDraftPreviewReceiptClaims,
  issuePublicWebDraftPreviewReceipt,
  verifyPublicWebDraftPreviewReceipt,
  type PublicWebDraftPreviewReceiptExpected,
  type PublicWebDraftPreviewReceiptExternalSigner,
  type PublicWebDraftPreviewReceiptIssuanceOptions,
  type PublicWebDraftPreviewReceiptSubject,
  type PublicWebDraftPreviewReceiptVerificationFailure,
  type PublicWebDraftPreviewReceiptVerificationKey,
} from "../src/lib/publicWebDraftPreviewReceipt.js";

const NOW = 2_000_000_000_000;
const ID = {
  tenant: "018f4000-0000-7000-8000-000000000001",
  organization: "018f4000-0000-7000-8000-000000000002",
  actor: "018f4000-0000-7000-8000-000000000003",
  membership: "018f4000-0000-7000-8000-000000000004",
  selection: "018f4000-0000-7000-8000-000000000005",
  issuer: "018f4000-0000-7000-8000-000000000006",
  alternate: "018f4000-0000-7000-8000-000000000007",
  activeContext: "018f4000-0000-7000-8000-000000000008",
};
const HASH = {
  manifest: "a".repeat(64),
  mapping: "b".repeat(64),
  plan: "c".repeat(64),
  alternate: "d".repeat(64),
  adapterApproval: "e".repeat(64),
  sessionFingerprint: "f".repeat(64),
};
const pair = crypto.generateKeyPairSync("ed25519");
const alternatePair = crypto.generateKeyPairSync("ed25519");
const publicKeyPem = pair.publicKey
  .export({ type: "spki", format: "pem" })
  .toString();
const alternatePublicKeyPem = alternatePair.publicKey
  .export({ type: "spki", format: "pem" })
  .toString();

function subject(
  overrides: Partial<PublicWebDraftPreviewReceiptSubject> = {},
): PublicWebDraftPreviewReceiptSubject {
  return {
    tenantId: ID.tenant,
    organizationId: ID.organization,
    actorLegacyUserId: 501,
    actorPrincipalId: ID.actor,
    membershipId: ID.membership,
    selectionId: ID.selection,
    sessionGeneration: 4,
    sessionFingerprint: HASH.sessionFingerprint,
    activeContextId: ID.activeContext,
    activeContextExpiresAt: NOW + 10 * 60 * 1000,
    manifestSha256: HASH.manifest,
    adapterId: "catalog.program-import",
    adapterVersion: "1.0.0",
    adapterApprovalSha256: HASH.adapterApproval,
    mappingSha256: HASH.mapping,
    planSha256: HASH.plan,
    runtimeReleaseId: "20260909T120000Z-c9292077",
    ...overrides,
  };
}

function key(
  overrides: Partial<PublicWebDraftPreviewReceiptVerificationKey> = {},
): PublicWebDraftPreviewReceiptVerificationKey {
  return {
    keyId: "preview-key-1",
    algorithm: PUBLIC_WEB_DRAFT_PREVIEW_RECEIPT_ALGORITHM,
    state: "ACTIVE",
    issuerId: ID.issuer,
    environmentId: "test",
    cellId: "cell-a",
    publicKeyPem,
    publicKeyFingerprint:
      fingerprintPublicWebDraftPreviewReceiptPublicKey(publicKeyPem),
    signFrom: NOW - 60_000,
    signUntil: NOW + 30 * 60 * 1000,
    verifyUntil: NOW + 60 * 60 * 1000,
    ...overrides,
  };
}

function signer(
  privateKey: crypto.KeyObject = pair.privateKey,
): PublicWebDraftPreviewReceiptExternalSigner {
  return {
    async sign(input) {
      return crypto.sign(null, input.signingInput, privateKey);
    },
  };
}

function issuance(
  overrides: Partial<PublicWebDraftPreviewReceiptIssuanceOptions> = {},
): PublicWebDraftPreviewReceiptIssuanceOptions {
  return {
    subject: subject(),
    environmentId: "test",
    cellId: "cell-a",
    issuerId: ID.issuer,
    keyId: "preview-key-1",
    keyReference: "test-memory://preview/key-1",
    keyRing: [key()],
    signer: signer(),
    now: NOW,
    ...overrides,
  };
}

function expected(
  overrides: Partial<PublicWebDraftPreviewReceiptExpected> = {},
): PublicWebDraftPreviewReceiptExpected {
  return {
    ...subject(),
    audience: PUBLIC_WEB_DRAFT_PREVIEW_RECEIPT_AUDIENCE,
    environmentId: "test",
    cellId: "cell-a",
    issuerId: ID.issuer,
    ...overrides,
  };
}

function verify(
  token: string | null | undefined,
  options: {
    keyRing?: readonly PublicWebDraftPreviewReceiptVerificationKey[];
    expected?: PublicWebDraftPreviewReceiptExpected;
    now?: number;
  } = {},
) {
  return verifyPublicWebDraftPreviewReceipt({
    token,
    keyRing: options.keyRing ?? [key()],
    expected: options.expected ?? expected(),
    now: options.now ?? NOW,
  });
}

function tokenParts(token: string) {
  const [encodedHeader, encodedPayload] = token.split(".");
  return {
    header: JSON.parse(
      Buffer.from(encodedHeader, "base64url").toString("utf8"),
    ) as Record<string, unknown>,
    payload: JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as Record<string, unknown>,
  };
}

function signedToken(
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
  privateKey: crypto.KeyObject = pair.privateKey,
): string {
  const encodedHeader = Buffer.from(canonicalJson(header), "utf8").toString(
    "base64url",
  );
  const encodedPayload = Buffer.from(canonicalJson(payload), "utf8").toString(
    "base64url",
  );
  const signingInput = Buffer.from(
    `${PUBLIC_WEB_DRAFT_PREVIEW_RECEIPT_DOMAIN}${encodedHeader}.${encodedPayload}`,
    "utf8",
  );
  const signature = crypto.sign(null, signingInput, privateKey);
  return `${encodedHeader}.${encodedPayload}.${signature.toString("base64url")}`;
}

function mutateWithOriginalSignature(
  token: string,
  claim: string,
  value: unknown,
): string {
  const [encodedHeader, encodedPayload, encodedSignature] = token.split(".");
  const payload = JSON.parse(
    Buffer.from(encodedPayload, "base64url").toString("utf8"),
  ) as Record<string, unknown>;
  payload[claim] = value;
  return `${encodedHeader}.${Buffer.from(canonicalJson(payload), "utf8").toString(
    "base64url",
  )}.${encodedSignature}`;
}

function differentValue(value: unknown): unknown {
  if (typeof value === "number") return value + 1;
  if (typeof value !== "string") return "changed";
  if (/^[0-9a-f]{64}$/.test(value)) return HASH.alternate;
  if (/^[0-9a-f]{8}-/.test(value)) return ID.alternate;
  return `${value}-changed`;
}

test("issues a short-lived exact-shape Ed25519 receipt with hashes only", async () => {
  const issued = await issuePublicWebDraftPreviewReceipt(issuance());
  const result = verify(issued.token);
  if (!result.ok) assert.fail(result.reason);

  assert.equal(result.claims.tenantId, ID.tenant);
  assert.equal(result.claims.organizationId, ID.organization);
  assert.equal(result.claims.actorLegacyUserId, 501);
  assert.equal(result.claims.selectionId, ID.selection);
  assert.equal(result.claims.sessionGeneration, 4);
  assert.equal(result.claims.sessionFingerprint, HASH.sessionFingerprint);
  assert.equal(result.claims.activeContextId, ID.activeContext);
  assert.equal(result.claims.adapterApprovalSha256, HASH.adapterApproval);
  assert.equal(result.claims.runtimeReleaseId, "20260909T120000Z-c9292077");
  assert.equal(result.claims.manifestSha256, HASH.manifest);
  assert.equal(result.claims.mappingSha256, HASH.mapping);
  assert.equal(result.claims.planSha256, HASH.plan);
  assert.equal(result.claims.algorithm, "Ed25519");
  assert.equal(result.claims.expiresAt - result.claims.issuedAt, 2 * 60 * 1000);
  assert.match(result.claims.nonce, /^[A-Za-z0-9_-]{32,128}$/);

  const payload = tokenParts(issued.token).payload;
  assert.deepEqual(Object.keys(payload).sort(), [
    "activeContextExpiresAt",
    "activeContextId",
    "actorLegacyUserId",
    "actorPrincipalId",
    "adapterApprovalSha256",
    "adapterId",
    "adapterVersion",
    "algorithm",
    "audience",
    "cellId",
    "environmentId",
    "expiresAt",
    "issuedAt",
    "issuerId",
    "keyId",
    "manifestSha256",
    "mappingSha256",
    "membershipId",
    "nonce",
    "organizationId",
    "planSha256",
    "runtimeReleaseId",
    "schemaVersion",
    "selectionId",
    "sessionFingerprint",
    "sessionGeneration",
    "tenantId",
  ]);
  const serialized = canonicalJson(payload);
  assert.doesNotMatch(serialized, /rows|contentJson|structuredDataJson|seoJson/);
});

test("brands claims only for the exact issued or Ed25519-verified token", async () => {
  const issued = await issuePublicWebDraftPreviewReceipt(issuance());
  assert.equal(isVerifiedPublicWebDraftPreviewReceiptClaims(
    issued.claims,
    { token: issued.token, now: NOW },
  ), true);
  assert.equal(isVerifiedPublicWebDraftPreviewReceiptClaims(
    { ...issued.claims },
    { token: issued.token, now: NOW },
  ), false);
  assert.equal(isVerifiedPublicWebDraftPreviewReceiptClaims(
    issued.claims,
    { token: "header.payload.signature", now: NOW },
  ), false);
  const verified = verify(issued.token);
  if (!verified.ok) assert.fail(verified.reason);
  assert.equal(isVerifiedPublicWebDraftPreviewReceiptClaims(
    verified.claims,
    { token: issued.token, now: NOW },
  ), true);
});

test("rejects mutation, missing claims, extra claims, and non-canonical JSON", async () => {
  const issued = await issuePublicWebDraftPreviewReceipt(issuance());
  for (const [claim, value] of Object.entries(issued.claims)) {
    assert.equal(
      verify(mutateWithOriginalSignature(issued.token, claim, differentValue(value)))
        .ok,
      false,
      `mutated signed claim must fail: ${claim}`,
    );
  }

  const { header, payload } = tokenParts(issued.token);
  const missing = { ...payload };
  delete missing.planSha256;
  assert.deepEqual(verify(signedToken(header, missing)), {
    ok: false,
    reason: "invalid_claims",
  });
  assert.deepEqual(
    verify(signedToken(header, { ...payload, rawManifest: { rows: [] } })),
    { ok: false, reason: "invalid_claims" },
  );

  const nonCanonicalPayload = JSON.stringify(
    Object.fromEntries(Object.entries(payload).reverse()),
  );
  assert.notEqual(nonCanonicalPayload, canonicalJson(payload));
  const encodedHeader = Buffer.from(canonicalJson(header), "utf8").toString(
    "base64url",
  );
  const encodedPayload = Buffer.from(nonCanonicalPayload, "utf8").toString(
    "base64url",
  );
  const signingInput = Buffer.from(
    `${PUBLIC_WEB_DRAFT_PREVIEW_RECEIPT_DOMAIN}${encodedHeader}.${encodedPayload}`,
    "utf8",
  );
  const signature = crypto.sign(null, signingInput, pair.privateKey);
  assert.deepEqual(
    verify(`${encodedHeader}.${encodedPayload}.${signature.toString("base64url")}`),
    { ok: false, reason: "malformed_token" },
  );
});

test("rejects wrong key, audience, environment, cell, and issuer", async () => {
  const issued = await issuePublicWebDraftPreviewReceipt(issuance());
  const wrongKeyId = key({
    keyId: "preview-key-2",
    publicKeyPem: alternatePublicKeyPem,
    publicKeyFingerprint:
      fingerprintPublicWebDraftPreviewReceiptPublicKey(alternatePublicKeyPem),
  });
  assert.deepEqual(verify(issued.token, { keyRing: [wrongKeyId] }), {
    ok: false,
    reason: "unknown_key",
  });
  const wrongKeyMaterial = key({
    publicKeyPem: alternatePublicKeyPem,
    publicKeyFingerprint:
      fingerprintPublicWebDraftPreviewReceiptPublicKey(alternatePublicKeyPem),
  });
  assert.deepEqual(verify(issued.token, { keyRing: [wrongKeyMaterial] }), {
    ok: false,
    reason: "invalid_signature",
  });

  const mismatches: Array<
    [Partial<PublicWebDraftPreviewReceiptExpected>, PublicWebDraftPreviewReceiptVerificationFailure]
  > = [
    [{ audience: "fas.public-web.other" }, "audience_mismatch"],
    [{ environmentId: "staging" }, "environment_mismatch"],
    [{ cellId: "cell-b" }, "cell_mismatch"],
    [{ issuerId: ID.alternate }, "issuer_mismatch"],
  ];
  for (const [override, reason] of mismatches) {
    assert.deepEqual(verify(issued.token, { expected: expected(override) }), {
      ok: false,
      reason,
    });
  }
});

test("rejects tenant, organization, actor, membership, selection, session, and hash drift", async () => {
  const issued = await issuePublicWebDraftPreviewReceipt(issuance());
  const mismatches: Array<
    [Partial<PublicWebDraftPreviewReceiptExpected>, PublicWebDraftPreviewReceiptVerificationFailure]
  > = [
    [{ tenantId: ID.alternate }, "tenant_mismatch"],
    [{ organizationId: ID.alternate }, "organization_mismatch"],
    [{ actorLegacyUserId: 502 }, "actor_legacy_user_mismatch"],
    [{ actorPrincipalId: ID.alternate }, "actor_mismatch"],
    [{ membershipId: ID.alternate }, "membership_mismatch"],
    [{ selectionId: ID.alternate }, "selection_mismatch"],
    [{ sessionGeneration: 5 }, "session_generation_mismatch"],
    [{ sessionFingerprint: HASH.alternate }, "session_fingerprint_mismatch"],
    [{ activeContextId: ID.alternate }, "active_context_mismatch"],
    [{ activeContextExpiresAt: NOW + 9 * 60 * 1000 }, "active_context_expiry_mismatch"],
    [{ manifestSha256: HASH.alternate }, "manifest_hash_mismatch"],
    [{ adapterId: "catalog.other-import" }, "adapter_id_mismatch"],
    [{ adapterVersion: "2.0.0" }, "adapter_version_mismatch"],
    [{ adapterApprovalSha256: HASH.alternate }, "adapter_approval_hash_mismatch"],
    [{ mappingSha256: HASH.alternate }, "mapping_hash_mismatch"],
    [{ planSha256: HASH.alternate }, "plan_hash_mismatch"],
    [{ runtimeReleaseId: "20260909T120500Z-deadbeef" }, "runtime_release_mismatch"],
  ];
  for (const [override, reason] of mismatches) {
    assert.deepEqual(verify(issued.token, { expected: expected(override) }), {
      ok: false,
      reason,
    });
  }
});

test("enforces expiry, future issuance, maximum TTL, and key lifecycle", async () => {
  const issued = await issuePublicWebDraftPreviewReceipt(issuance());
  assert.deepEqual(verify(issued.token, { now: issued.claims.expiresAt }), {
    ok: false,
    reason: "expired",
  });

  const futureNow = NOW + PUBLIC_WEB_DRAFT_PREVIEW_RECEIPT_CLOCK_SKEW_MS + 1;
  const future = await issuePublicWebDraftPreviewReceipt(
    issuance({ now: futureNow }),
  );
  assert.deepEqual(verify(future.token), {
    ok: false,
    reason: "not_yet_valid",
  });

  await assert.rejects(
    issuePublicWebDraftPreviewReceipt(
      issuance({ ttlMs: PUBLIC_WEB_DRAFT_PREVIEW_RECEIPT_MAX_TTL_MS + 1 }),
    ),
    /public_web_draft_preview_receipt_issuance_invalid/,
  );
  assert.equal(verify(issued.token, { keyRing: [key({ state: "VERIFY_ONLY" })] }).ok, true);
  for (const state of ["REVOKED", "COMPROMISED"] as const) {
    assert.deepEqual(verify(issued.token, { keyRing: [key({ state })] }), {
      ok: false,
      reason: "key_inactive",
    });
  }
});

test("rejects legacy, HMAC, wrong-version, and malformed downgrade attempts", async () => {
  const issued = await issuePublicWebDraftPreviewReceipt(issuance());
  const { header, payload } = tokenParts(issued.token);
  assert.deepEqual(verify("legacy-payload.legacy-hmac"), {
    ok: false,
    reason: "malformed_token",
  });
  assert.deepEqual(
    verify(
      signedToken(
        { ...header, algorithm: "HS256" },
        { ...payload, algorithm: "HS256" },
      ),
    ),
    { ok: false, reason: "algorithm_mismatch" },
  );
  assert.deepEqual(
    verify(signedToken({ ...header, envelopeVersion: 0 }, payload)),
    { ok: false, reason: "malformed_token" },
  );
  assert.deepEqual(verify(`${issued.token}.extra`), {
    ok: false,
    reason: "malformed_token",
  });
});

test("fails closed when the external signer uses another key or leaks an error", async () => {
  await assert.rejects(
    issuePublicWebDraftPreviewReceipt(issuance({ signer: signer(alternatePair.privateKey) })),
    /public_web_draft_preview_receipt_signer_result_invalid/,
  );
  await assert.rejects(
    issuePublicWebDraftPreviewReceipt(
      issuance({
        signer: {
          async sign() {
            throw new Error("kms-secret-detail");
          },
        },
      }),
    ),
    (error: unknown) =>
      error instanceof Error &&
      error.message === "public_web_draft_preview_receipt_signing_failed",
  );
});
