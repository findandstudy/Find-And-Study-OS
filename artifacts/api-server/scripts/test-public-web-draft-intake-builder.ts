import assert from "node:assert/strict";
import test from "node:test";

import {
  buildServerBoundPublicWebDraftIntake,
  type PublicWebDraftIntakeRequest,
} from "../src/lib/publicWebDraftIntakeBuilder.js";
import { hashPublicWebDraftRevision } from "../src/lib/publicWebDraftIntakeCommand.js";

const TENANT_ID = "018fa400-0000-7000-8000-000000000001";
const ORGANIZATION_ID = "018fa400-0000-7000-8000-000000000002";
const CONTENT_ID = "018fa400-0000-7000-8000-000000000003";
const REVISION_ID = "018fa400-0000-7000-8000-000000000004";
const SHA = "a".repeat(64);

function request(
  overrides: Partial<PublicWebDraftIntakeRequest> = {},
): PublicWebDraftIntakeRequest {
  return {
    entityType: "PROGRAM",
    entityId: 42,
    locale: "en",
    canonicalSlug: "computer-science",
    origin: "HUMAN",
    title: "Computer Science",
    summary: "Governed programme draft.",
    contentJson: { overview: "Evidence-bound content" },
    seoJson: { title: "Study Computer Science" },
    structuredDataJson: { "@type": "Course" },
    generatorReceiptSha256: null,
    idempotencyKey: "public-web.draft.builder-1",
    ...overrides,
  };
}

function build(raw: unknown = request(), generated = [CONTENT_ID, REVISION_ID]) {
  return buildServerBoundPublicWebDraftIntake({
    scope: { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
    source: { entityType: "PROGRAM", entityId: 42, sourceSha256: SHA },
    request: raw,
    now: 2_000_000_000_000,
    newUuidV7: () => generated.shift() ?? REVISION_ID,
  });
}

test("builds canonical command from server scope, source binding and identities", () => {
  const result = build();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.command.tenantId, TENANT_ID);
  assert.equal(result.command.organizationId, ORGANIZATION_ID);
  assert.equal(result.command.contentRecordId, CONTENT_ID);
  assert.equal(result.command.revisionId, REVISION_ID);
  assert.equal(result.command.canonicalPath, "/en/programs/computer-science-42");
  assert.equal(result.command.sourceSha256, SHA);
  assert.equal(
    result.command.contentSha256,
    hashPublicWebDraftRevision(result.command),
  );
  assert.match(result.requestHash, /^[0-9a-f]{64}$/);
});

test("rejects client attempts to choose internal scope, path, hashes or identities", () => {
  for (const injected of [
    { tenantId: TENANT_ID },
    { organizationId: ORGANIZATION_ID },
    { canonicalPath: "/en/admin" },
    { sourceSha256: "b".repeat(64) },
    { contentRecordId: CONTENT_ID },
    { revisionId: REVISION_ID },
  ]) {
    assert.deepEqual(build({ ...request(), ...injected }), {
      ok: false,
      reason: "request_invalid",
    });
  }
});

test("rejects mismatched source identity and unsafe generated identifiers", () => {
  assert.deepEqual(build(request({ entityId: 43 })), {
    ok: false,
    reason: "source_binding_invalid",
  });
  assert.deepEqual(build(request(), [CONTENT_ID, CONTENT_ID]), {
    ok: false,
    reason: "generated_identity_invalid",
  });
  assert.deepEqual(build(request(), ["not-a-uuid", REVISION_ID]), {
    ok: false,
    reason: "generated_identity_invalid",
  });
});

test("keeps AI provenance and reserved PAGE routes fail closed", () => {
  assert.deepEqual(build(request({
    origin: "AI_ASSISTED",
    generatorReceiptSha256: null,
  })), { ok: false, reason: "request_invalid" });

  const page = buildServerBoundPublicWebDraftIntake({
    scope: { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
    source: { entityType: "PAGE", entityId: 9, sourceSha256: SHA },
    request: request({
      entityType: "PAGE",
      entityId: 9,
      canonicalSlug: "admin",
    }),
    now: 2_000_000_000_000,
    newUuidV7: (() => {
      const ids = [CONTENT_ID, REVISION_ID];
      return () => ids.shift() ?? REVISION_ID;
    })(),
  });
  assert.deepEqual(page, { ok: false, reason: "request_invalid" });
});
