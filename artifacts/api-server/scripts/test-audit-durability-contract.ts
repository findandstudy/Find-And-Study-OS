import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const auth = source("../src/lib/auth.ts");
const tokens = source("../src/routes/apiTokens.ts");
const email = source("../src/routes/emailAutomation.ts");
const agents = source("../src/routes/agents.ts");
const applications = source("../src/routes/applications.ts");

assert.match(auth, /\): Promise<void> \{\s*return db\.insert\(auditLogsTable\)/,
  "audit insert exposes a real awaitable completion boundary");
assert.doesNotMatch(auth, /setImmediate\s*\(/,
  "audit persistence is not deferred beyond the request lifecycle");
assert.doesNotMatch(tokens, /logAudit\(/, "API token mutations do not use the non-transactional legacy helper");
assert.equal((tokens.match(/await tx\.insert\(auditLogsTable\)\.values\(\{/g) ?? []).length, 3,
  "API token create, revoke and rotate write their audit result inside the mutation transaction");
for (const action of ["create", "revoke", "rotate"]) {
  assert.match(tokens, new RegExp(`action: "${action}"[\\s\\S]{0,100}resource: "api_token"`),
    `API token ${action} persists a bounded result receipt`);
}
for (const action of ["sender_created", "sender_updated", "sender_verified", "template_created", "version_created"]) {
  assert.match(email, new RegExp(`await logAudit\\(req\\.user!\\.id, "notification_email\\.${action}"`),
    `email ${action} awaits audit persistence`);
}
assert.match(email, /await logAudit\(req\.user!\.id, `notification_email\.version_\$\{action\}`/,
  "email approval lifecycle awaits audit persistence");
assert.equal((agents.match(/await logAudit\([^\n]+"auth\.impersonate\.(?:start|end)"/g) ?? []).length, 3,
  "all three legacy impersonation start/end paths await audit persistence");
assert.match(agents, /await logAudit\(actor\.id, "agent\.academy_access\.update"/,
  "Academy privilege change awaits audit persistence");
const destructiveApplicationRoutes = applications.slice(
  applications.indexOf('router.delete("/applications/:id"'),
  applications.indexOf('router.get("/applications/:id/notes"'),
);
assert.equal((destructiveApplicationRoutes.match(/await tx\.insert\(auditLogsTable\)\.values\(\{/g) ?? []).length, 2,
  "application soft-delete and purge write audit in their mutation transaction");
for (const action of ["delete_application", "purge_application"]) {
  assert.match(destructiveApplicationRoutes, new RegExp(`action: "${action}"[\\s\\S]{0,100}resource: "application"`),
    `${action} has a transaction-bound result receipt`);
}
assert.match(destructiveApplicationRoutes, /\.for\("update"\)/,
  "hard purge locks and proves the application exists before deletion");
assert.doesNotMatch(destructiveApplicationRoutes, /logAudit\(/,
  "destructive application routes do not use the non-transactional legacy helper");
assert.match(destructiveApplicationRoutes, /if \(!purged\) \{ res\.status\(404\)/,
  "hard purge does not report success for a missing application");

console.log("[audit-durability-contract] 21/21 PASS");
