import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  createEmbedLeadDocumentSessionToken,
  verifyEmbedLeadDocumentSessionToken,
} from "../src/lib/embedLeadDocumentSession";

const secret = "local-test-secret";
const now = Date.UTC(2026, 7, 4, 12, 0, 0);

test("round-trips a slug-bound lead document session", () => {
  const token = createEmbedLeadDocumentSessionToken(secret, "okan-programs", 3399, now);
  assert.deepEqual(
    verifyEmbedLeadDocumentSessionToken(secret, token, "okan-programs", now + 1000),
    { leadId: 3399 },
  );
});

test("rejects tampered, cross-widget and expired sessions", () => {
  const token = createEmbedLeadDocumentSessionToken(secret, "okan-programs", 3399, now);
  assert.equal(verifyEmbedLeadDocumentSessionToken(secret, `${token}x`, "okan-programs", now), null);
  assert.equal(verifyEmbedLeadDocumentSessionToken(secret, token, "another-widget", now), null);
  assert.equal(verifyEmbedLeadDocumentSessionToken(secret, token, "okan-programs", now + 3 * 60 * 60 * 1000), null);
});

test("final widget submit reuses persisted documents instead of retransmitting base64", () => {
  const routeSource = readFileSync(
    fileURLToPath(new URL("../src/routes/embed.ts", import.meta.url)),
    "utf8",
  );

  assert.match(routeSource, /ewPersistLeadDocuments\(docPayload\)\.then\(function\(\)\{/);
  assert.match(routeSource, /persistedDocumentFingerprints\[item\.doc\.label\]!==item\.fingerprint/);
  assert.match(routeSource, /documents:\[item\.doc\]/);
  assert.match(routeSource, /embedDocumentSubmitLimiter/);
  assert.match(routeSource, /embedApplicationSubmitLimiter/);
  assert.match(routeSource, /data\.documentSessionToken=leadDocumentSessionToken;/);
  assert.match(routeSource, /data\.documentLabels=docPayload\.map/);
  assert.match(routeSource, /readEmbedLeadDraftDocuments\(\{/);
  assert.match(routeSource, /preparedDocuments = await prepareEmbedDocuments\(documents\);/);
});
