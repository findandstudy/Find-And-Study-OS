import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/routes/applications.ts", import.meta.url), "utf8");
const start = source.indexOf('router.patch("/applications/:id"');
const end = source.indexOf('router.patch("/applications/:id/origin"', start);
assert.ok(start >= 0 && end > start, "application PATCH corridor found");
const patch = source.slice(start, end);

assert.match(patch, /APPLICATION_VERSION_REQUIRED/, "stage and assignment writes require a version");
assert.match(patch, /eq\(applicationsTable\.updatedAt, expectedUpdatedAt\)/, "write predicate binds the expected version");
assert.match(patch, /APPLICATION_VERSION_CONFLICT/, "lost update returns an explicit conflict");
assert.ok(
  patch.indexOf('if (!app)') < patch.indexOf('syncApplicationFinance(id)'),
  "conflict exits before finance effects",
);
assert.ok(
  patch.indexOf('if (!app)') < patch.indexOf('dispatchNotification({'),
  "conflict exits before notification effects",
);
assert.match(
  patch,
  /await tx\.insert\(auditLogsTable\)\.values\(\{[\s\S]{0,180}action: "update_application"/,
  "application update and its audit receipt share the same transaction",
);
assert.doesNotMatch(
  patch,
  /logAudit\(req\.user!\.id, "update_application"/,
  "application update does not use the non-transactional legacy audit helper",
);

console.log("[application-optimistic-concurrency] 7/7 PASS");
