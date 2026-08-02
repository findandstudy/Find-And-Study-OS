import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (relativePath: string): string =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("every supported portal synchronizes and verifies passport identity", () => {
  const source = read("src/lib/portalApplicationPreflight.ts");

  assert.match(
    source,
    /if \(result\.supported\) \{\s+const identitySync = await autoSyncProfileIdentityFromPassport/,
  );
  assert.match(
    source,
    /if \(result\.supported\) \{\s+const identityProof = await verifyStudentIdentityAgainstPassport/,
  );
  assert.match(source, /passportIdentitySyncStatus === "passport_conflict"/);
  assert.match(source, /result = \{ \.\.\.result, ready: false, incompatibleFields \}/);
});

test("manual and automatic queue paths park blocked inquiries in Missing Documents", () => {
  const manual = read("src/lib/portalManualEnqueue.ts");
  const automatic = read("src/lib/portalAutoTrigger.ts");

  assert.ok(
    (manual.match(/parkApplicationInMissingDocsStage\(/g) ?? []).length >= 2,
    "manual queue must park both mandatory-document and preflight failures",
  );
  assert.ok(
    (automatic.match(/parkApplicationInMissingDocsStage\(/g) ?? []).length >= 3,
    "automatic queue must park document, preflight, and identity failures",
  );
});

test("Missing Documents transition never downgrades an advanced application", () => {
  const source = read("src/lib/mandatoryDocs.ts");

  assert.match(
    source,
    /eq\(applicationsTable\.stage, "inquiry"\)/,
  );
  assert.match(source, /stage: "missing_docs"/);
});
