import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("../src/components/PortalSubmissionPanel.tsx", import.meta.url),
  "utf8",
);

test("routed aggregator portal is selected when university label has no direct portal", () => {
  assert.match(source, /resolveInfo\?\.portalKey/);
  assert.match(source, /selectedKey \|\| defaultKey \|\| routedKey/);
});

test("manual enqueue surfaces structured document and preflight failures", () => {
  assert.match(source, /error instanceof ApiError/);
  assert.match(source, /MISSING_MANDATORY_DOCUMENTS/);
  assert.match(source, /PORTAL_PREFLIGHT_NOT_READY/);
  assert.match(source, /portalQueueErrorDescription\(error, t\)/);
});
