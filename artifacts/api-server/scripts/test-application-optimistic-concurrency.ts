import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/routes/applications.ts", import.meta.url), "utf8");
const financeSource = readFileSync(new URL("../../../lib/portal-runner/src/applicationFinanceSync.ts", import.meta.url), "utf8");
const start = source.indexOf('router.patch("/applications/:id"');
const end = source.indexOf('router.patch("/applications/:id/origin"', start);
assert.ok(start >= 0 && end > start, "application PATCH corridor found");
const patch = source.slice(start, end);
const bulkStart = source.indexOf('router.post("/applications/bulk-action"');
const bulkEnd = source.indexOf('router.delete("/applications/:id"', bulkStart);
assert.ok(bulkStart >= 0 && bulkEnd > bulkStart, "application bulk corridor found");
const bulk = source.slice(bulkStart, bulkEnd);

assert.match(patch, /APPLICATION_VERSION_REQUIRED/, "stage and assignment writes require a version");
assert.match(patch, /eq\(applicationsTable\.updatedAt, expectedUpdatedAt\)/, "write predicate binds the expected version");
assert.match(patch, /APPLICATION_VERSION_CONFLICT/, "lost update returns an explicit conflict");
assert.ok(
  patch.indexOf('if (!app)') < patch.indexOf('dispatchNotification({'),
  "conflict exits before notification effects",
);
assert.match(
  patch,
  /await tx\.insert\(auditLogsTable\)\.values\(\{[\s\S]{0,180}action: "update_application"/,
  "application update and its audit receipt share the same transaction",
);
assert.match(
  patch,
  /await syncApplicationFinance\(updatedApp\.id, tx\);[\s\S]{0,120}return updatedApp/,
  "stage and canonical finance projection share the same transaction",
);
assert.doesNotMatch(
  patch,
  /await syncApplicationFinance\(id\);/,
  "single application stage command does not repeat canonical finance reconciliation after commit",
);
assert.match(
  bulk,
  /action: "bulk_move_application"[\s\S]{0,520}await syncApplicationFinance\(app\.id, tx\);[\s\S]{0,80}\}\);/,
  "bulk stage, audit receipt and canonical finance projection share one transaction",
);
assert.match(
  patch,
  /post-commit legacy finance reconciliation failed/,
  "temporary compatibility reconciliation cannot fail an already committed command",
);
assert.match(
  financeSource,
  /return executor \? reconcile\(executor\) : db\.transaction\(reconcile\)/,
  "canonical finance sync reuses a supplied application transaction instead of nesting one",
);
assert.doesNotMatch(
  patch,
  /logAudit\(req\.user!\.id, "update_application"/,
  "application update does not use the non-transactional legacy audit helper",
);
assert.match(
  source,
  /async function writeLostCascadeAudit[\s\S]*await executor\.insert\(auditLogsTable\)\.values/,
  "lost-cascade result audit uses the supplied transaction executor",
);
assert.equal(
  (source.match(/await writeLostCascadeAudit\(/g) ?? []).length,
  7,
  "every lost-cascade outcome awaits its transaction-bound audit",
);
assert.match(
  patch,
  /executor: tx,[\s\S]{0,160}cascadeApplicationLostStage\(lifecycleOpts\)/,
  "lost-cascade status and audit remain inside the application transaction",
);

console.log("[application-optimistic-concurrency] 14/14 PASS");
