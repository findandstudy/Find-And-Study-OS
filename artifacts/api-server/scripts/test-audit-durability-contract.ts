import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const auth = source("../src/lib/auth.ts");
const tokens = source("../src/routes/apiTokens.ts");
const email = source("../src/routes/emailAutomation.ts");
const agents = source("../src/routes/agents.ts");
const applications = source("../src/routes/applications.ts");
const channelAccounts = source("../src/routes/channelAccounts.ts");
const integrations = source("../src/routes/integrations.ts");
const pipeline = source("../src/routes/pipeline.ts");
const courseFinder = source("../src/routes/course-finder.ts");
const apiIndex = source("../src/index.ts");
const aiDefaults = source("../src/routes/ai-defaults.ts");
const aiDefaultsUi = source("../../edcons/src/pages/admin/AiBuiltinDefaults.tsx");
const aiExtractors = source("../src/routes/ai-extractors.ts");
const aiPersonas = source("../src/routes/ai-personas.ts");
const leadAssignmentRules = source("../src/routes/leadAssignmentRules.ts");
const leads = source("../src/routes/leads.ts");
const tasks = source("../src/routes/tasks.ts");
const campaigns = source("../src/routes/campaigns.ts");
const cms = source("../src/routes/cms.ts");

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
const applicationPatchRoute = applications.slice(
  applications.indexOf('router.patch("/applications/:id"'),
  applications.indexOf('router.post("/applications/bulk-action"'),
);
assert.match(applicationPatchRoute, /await tx\.insert\(auditLogsTable\)\.values\(\{[\s\S]{0,180}action: "update_application"/,
  "application patch persists its audit receipt before the mutation transaction commits");
assert.doesNotMatch(applicationPatchRoute, /logAudit\(req\.user!\.id, "update_application"/,
  "application patch does not use the non-transactional legacy helper");
const applicationBulkRoute = applications.slice(
  applications.indexOf('router.post("/applications/bulk-action"'),
  applications.indexOf('router.delete("/applications/:id"'),
);
assert.match(applicationBulkRoute, /if \(ids\.length > 500\)[\s\S]{0,120}BULK_APPLICATION_LIMIT/,
  "application bulk mutations have a hard request-size ceiling");
assert.match(applicationBulkRoute, /\[\.\.\.new Set\(ids\.map\(Number\)/,
  "application bulk mutations deduplicate normalized positive identifiers");
for (const action of ["delete_application", "bulk_assign_applications", "bulk_move_application"]) {
  assert.match(applicationBulkRoute, new RegExp(`await tx\\.insert\\(auditLogsTable\\)\\.values\\([^;]{0,700}action: "${action}"`),
    `${action} persists its audit receipt inside the mutation transaction`);
}
for (const action of ["delete_application", "bulk_assign_applications", "bulk_move_application"]) {
  assert.doesNotMatch(applicationBulkRoute, new RegExp(`logAudit\\([^;]{0,180}"${action}"`),
    `${action} does not use the non-transactional legacy helper`);
}
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
assert.doesNotMatch(channelAccounts, /logAudit\(/,
  "channel account mutations do not use the non-transactional legacy helper");
assert.match(channelAccounts, /async function writeAccountAudit[\s\S]*await tx\.insert\(auditLogsTable\)\.values/,
  "channel account audit helper requires the active transaction");
for (const action of [
  "create_channel_account", "update_channel_account", "toggle_channel_account",
  "set_default_channel_account", "delete_channel_account",
]) {
  assert.match(channelAccounts, new RegExp(`await writeAccountAudit\\(tx, req, "${action}"`),
    `${action} writes its result before transaction commit`);
}
assert.doesNotMatch(integrations, /logAudit\(/,
  "integration config mutations do not use the non-transactional legacy helper");
assert.match(integrations, /async function writeIntegrationAudit[\s\S]*await tx\.insert\(auditLogsTable\)\.values/,
  "integration audit helper requires the active transaction");
for (const action of ["update_integration", "toggle_integration"]) {
  assert.match(integrations, new RegExp(`await writeIntegrationAudit\\(tx, req, "${action}"`),
    `${action} writes its result before transaction commit`);
}
assert.equal((integrations.match(/integration_version_conflict/g) ?? []).length, 2,
  "integration update and toggle both reject stale writes");
assert.doesNotMatch(pipeline, /logAudit\(/,
  "pipeline replacement does not use the non-transactional legacy helper");
for (const action of ["pipeline_stages.updated", "pipeline_stage_email.configured"]) {
  assert.match(pipeline, new RegExp(`await tx\\.insert\\(auditLogsTable\\)\\.values\\(\\{[\\s\\S]{0,180}action: "${action}"`),
    `${action} is persisted before the stage replacement transaction commits`);
}
assert.match(pipeline, /if \(stages\.length > 100\)/,
  "pipeline audit and replacement input has a hard stage-count ceiling");
const publicSettingsRoute = courseFinder.slice(courseFinder.indexOf("router.patch("), courseFinder.indexOf('router.get("/course-finder/students"'));
assert.doesNotMatch(publicSettingsRoute, /logAudit\(/,
  "public catalogue settings do not use the non-transactional legacy helper");
assert.match(publicSettingsRoute, /await tx\.insert\(auditLogsTable\)\.values\([\s\S]*action: "update_public_catalog_settings"/,
  "public catalogue settings persist audit before the mutation transaction commits");
assert.match(publicSettingsRoute, /public_catalog_settings_version_conflict/,
  "public catalogue settings reject stale overwrites");
assert.match(publicSettingsRoute, /invalidatePublicCatalogRenderCache\(\{ entityType: "catalog" \}\)/,
  "public catalogue policy updates publish cross-process invalidation");
assert.match(apiIndex, /publicCatalogInvalidationBus\.subscribe\([\s\S]{0,400}clearPublicCatalogPolicyCache\(\)/,
  "cross-process catalogue invalidation also clears the policy cache");
assert.doesNotMatch(aiDefaults, /logAudit\(/,
  "AI default mutations do not use the non-transactional legacy helper");
for (const action of ["update_ai_default", "reset_ai_default"]) {
  assert.match(aiDefaults, new RegExp(`await tx\\.insert\\(auditLogsTable\\)\\.values\\(\\{[\\s\\S]{0,180}action: "${action}"`),
    `${action} is persisted before the AI config transaction commits`);
}
assert.match(aiDefaults, /pg_advisory_xact_lock\(hashtext\('ai-default-config'\)/,
  "AI config writes are serialized per key");
assert.match(aiDefaults, /Buffer\.byteLength\(JSON\.stringify\(value\)[\s\S]{0,80}> 65_536/,
  "AI config payload has a hard serialized-size ceiling");
assert.equal((aiDefaultsUi.match(/expectedUpdatedAt: entry\.updatedAt/g) ?? []).length, 2,
  "AI defaults UI binds both save and reset to the version it displayed");
assert.doesNotMatch(aiExtractors, /logAudit\(/,
  "AI extractor mutations do not use the non-transactional legacy helper");
for (const action of ["create_ai_extractor", "update_ai_extractor", "delete_ai_extractor"]) {
  assert.match(aiExtractors, new RegExp(`await tx\\.insert\\(auditLogsTable\\)\\.values\\(\\{[^;]{0,260}action: "${action}"`),
    `${action} is persisted before the extractor transaction commits`);
}
assert.match(aiExtractors, /AI_EXTRACTOR_IN_USE/,
  "extractor deletion preserves run evidence and active widget references");
assert.match(aiExtractors, /configJsonBody = json\(\{ limit: "256kb" \}\)/,
  "extractor management payload has an early parser ceiling");
assert.doesNotMatch(aiExtractors, /res\.status\(500\)\.json\(\{ error: msg \}\)/,
  "extractor management does not disclose raw database errors");
const personaCrud = aiPersonas.slice(aiPersonas.indexOf("// Create"), aiPersonas.indexOf("// Manual run"));
assert.doesNotMatch(personaCrud, /logAudit\(/,
  "AI persona CRUD does not use the non-transactional legacy helper");
for (const action of ["create_ai_persona", "update_ai_persona", "delete_ai_persona"]) {
  assert.match(personaCrud, new RegExp(`await tx\\.insert\\(auditLogsTable\\)\\.values\\(\\{[^;]{0,300}action: "${action}"`),
    `${action} is persisted before the persona transaction commits`);
}
assert.match(personaCrud, /AI_PERSONA_IN_USE/,
  "persona deletion preserves run, action and conversation evidence");
assert.match(aiPersonas, /personaConfigBody = json\(\{ limit: "256kb" \}\)/,
  "persona management payload has an early parser ceiling");
assert.match(aiPersonas, /await logAudit\(req\.user!\.id, "run_ai_persona"/,
  "manual persona runs await their result audit attempt");
assert.doesNotMatch(personaCrud, /res\.status\(500\)\.json\(\{ error: msg \}\)/,
  "persona management does not disclose raw database errors");
assert.doesNotMatch(leadAssignmentRules, /logAudit\(/,
  "lead assignment rule mutations do not use the non-transactional legacy helper");
assert.match(leadAssignmentRules, /async function writeRuleAudit[\s\S]*await tx\.insert\(auditLogsTable\)\.values/,
  "lead assignment rule audit helper requires the active transaction");
for (const action of ["create_lead_assignment_rule", "update_lead_assignment_rule", "delete_lead_assignment_rule"]) {
  assert.match(leadAssignmentRules, new RegExp(`await writeRuleAudit\\(tx, req, "${action}"`),
    `${action} persists its audit receipt before transaction commit`);
}
const leadBulkRoute = leads.slice(
  leads.indexOf('router.post("/leads/bulk-action"'),
  leads.indexOf('router.post("/leads/:id/convert"'),
);
assert.match(leadBulkRoute, /if \(ids\.length > 500\)[\s\S]{0,120}BULK_LEAD_LIMIT/,
  "lead bulk mutations have a hard request-size ceiling");
assert.match(leadBulkRoute, /\[\.\.\.new Set\(ids\.map\(Number\)/,
  "lead bulk mutations deduplicate normalized positive identifiers");
for (const action of ["delete_lead", "bulk_assign_leads", "bulk_move_leads"]) {
  assert.match(leadBulkRoute, new RegExp(`await tx\\.insert\\(auditLogsTable\\)\\.values\\([^;]{0,700}action: "${action}"`),
    `${action} persists its audit receipt inside the mutation transaction`);
  assert.doesNotMatch(leadBulkRoute, new RegExp(`logAudit\\([^;]{0,180}"${action}"`),
    `${action} does not use the non-transactional legacy helper`);
}
const destructiveLeadRoutes = leads.slice(
  leads.indexOf('router.delete("/leads/:id"'),
  leads.indexOf('router.post("/leads/bulk-action"'),
);
for (const action of ["delete_lead", "purge_lead"]) {
  assert.match(destructiveLeadRoutes, new RegExp(`await tx\\.insert\\(auditLogsTable\\)\\.values\\(\\{[^;]{0,400}action: "${action}"`),
    `${action} persists its audit receipt inside the destructive transaction`);
}
assert.match(destructiveLeadRoutes, /\.for\("update"\)/,
  "lead purge locks and proves the lead exists before deletion");
assert.doesNotMatch(destructiveLeadRoutes, /logAudit\(/,
  "destructive lead routes do not use the non-transactional legacy helper");
assert.doesNotMatch(tasks, /logAudit\(/,
  "task mutations do not use the non-transactional legacy helper");
assert.match(tasks, /async function writeTaskAudit[\s\S]*await tx\.insert\(auditLogsTable\)\.values/,
  "task audit helper requires the active transaction");
for (const action of ["task.create", "task.update", "task.archive", "task.restore"]) {
  assert.match(tasks, new RegExp(`await writeTaskAudit\\(tx, req, "${action}"`),
    `${action} persists its audit receipt before transaction commit`);
}
assert.match(tasks, /await tx\.insert\(auditLogsTable\)\.values\(rows\.map\(task => \(\{[\s\S]{0,220}action: "task\.archive"/,
  "bulk task archive persists every result audit in its mutation transaction");
assert.doesNotMatch(campaigns, /logAudit\(/,
  "campaign mutations do not use the non-transactional legacy helper");
assert.match(campaigns, /async function writeCampaignAudit[\s\S]*await tx\.insert\(auditLogsTable\)\.values/,
  "campaign audit helper requires the active transaction");
for (const action of ["campaign.create", "campaign.update", "campaign.archive", "campaign.restore"]) {
  assert.match(campaigns, new RegExp(`await writeCampaignAudit\\(tx, req, "${action}"`),
    `${action} persists its audit receipt before transaction commit`);
}
assert.doesNotMatch(cms, /logAudit\(/,
  "public CMS mutations do not use the non-transactional legacy helper");
assert.match(cms, /async function writeCmsAudit[\s\S]*await tx\.insert\(auditLogsTable\)\.values/,
  "public CMS audit helper requires the active transaction");
for (const action of [
  "cms.team_member.create", "cms.team_member.update", "cms.team_member.delete",
  "cms.office.create", "cms.office.update", "cms.office.delete",
]) {
  assert.match(cms, new RegExp(`await writeCmsAudit\\(tx, req, "${action}"`),
    `${action} persists its audit receipt before transaction commit`);
}

console.log("[audit-durability-contract] 111/111 PASS");
