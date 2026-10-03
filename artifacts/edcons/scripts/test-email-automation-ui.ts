import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { approvedEmailOptions, canApproveEmail, canVerifyEmailSender, canManageNotificationRules, emailAutomationCopy, emailStatusLabel, emailStageValid, emailTemplateVariables, safeEmailPreview, verifiedEmailSenders, EMAIL_AUTOMATION_PATH, type EmailTemplate, type EmailSender, type EmailTemplateVersion } from "../src/components/notifications/emailAutomationModel";

const version = (overrides: Partial<EmailTemplateVersion> = {}): EmailTemplateVersion => ({ id: 10, templateId: 1, version: 2, status: "approved", language: "tr", subject: "{{studentName}}", content: "Hello", variables: ["studentName"], createdById: 7, createdAt: "2026-09-21T10:00:00Z", ...overrides });
const template = (overrides: Partial<EmailTemplate> = {}): EmailTemplate => ({ id: 1, name: "Application", category: "applications", channel: "email", language: "tr", isActive: true, versions: [version()], ...overrides });
const sender = (overrides: Partial<EmailSender> = {}): EmailSender => ({ id: 2, displayName: "Admissions", fromEmail: "admissions@example.test", fromName: "Admissions", isActive: true, verified: true, revision: 3, createdById: 7, lastChangedById: 7, config: { host: "smtp.example.test", port: 587, username: "admissions", passwordConfigured: true }, ...overrides });
const source = (file: string) => readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");

test("only active email identities and approved exact versions are selectable", () => {
  const options = approvedEmailOptions([template(), template({ isActive: false }), template({ channel: "whatsapp" }), template({ versions: [version({ status: "draft" }), version({ status: "review" }), version({ status: "retired" })] })]);
  assert.deepEqual(options, [{ id: 10, label: "Application · TR · v2", language: "tr" }]);
});
test("application stage variable filter excludes incompatible system templates", () => {
  const templates = [template(), template({ versions: [version({ id: 11, variables: ["amount"] })] })];
  assert.deepEqual(approvedEmailOptions(templates, ["studentName"]).map(item => item.id), [10]);
  assert.equal(approvedEmailOptions(templates, []).length, 0);
});
test("existing all-channel template identity reused without duplicate", () => {
  assert.equal(approvedEmailOptions([template({ channel: "all" })])[0].id, 10);
});
test("sender eligibility requires verified and active independently", () => {
  assert.deepEqual(verifiedEmailSenders([sender(), sender({ verified: false }), sender({ isActive: false })]).map(item => item.id), [2]);
});
test("approval and sender verification are fail-closed maker-checker", () => {
  assert.equal(canApproveEmail(version({ status: "review" }), 8), true);
  for (const id of [7, undefined, NaN]) assert.equal(canApproveEmail(version({ status: "review" }), id), false);
  for (const status of ["draft", "approved", "retired"]) assert.equal(canApproveEmail(version({ status }), 8), false);
  assert.equal(canApproveEmail(version({ status: "review", createdById: undefined as any }), 8), false);
  assert.equal(canVerifyEmailSender(sender(), 8), true);
  assert.equal(canVerifyEmailSender(sender(), 7), false);
  assert.equal(canVerifyEmailSender(sender({ lastChangedById: undefined as any }), 8), false);
});
test("stage setting requires IDs and valid nonempty origin selection", () => {
  const settings = { enabled: true, templateVersionId: 10, senderAccountId: 2, originTypes: ["direct"] };
  assert.equal(emailStageValid(settings), true);
  for (const id of [null, 0, -1, 1.5, NaN]) assert.equal(emailStageValid({ ...settings, templateVersionId: id }), false);
  for (const originTypes of [[], ["all"], null, undefined]) assert.equal(emailStageValid({ ...settings, originTypes: originTypes as any }), false);
  assert.equal(emailStageValid(null), true);
  assert.equal(emailStageValid({ ...settings, enabled: false, senderAccountId: null }), true);
});
test("detected variables deduplicate without evaluating template content", () => {
  assert.deepEqual(emailTemplateVariables("Hello {{ studentName }}", "{{studentName}} {{applicationId}}"), ["applicationId", "studentName"]);
  assert.deepEqual(emailTemplateVariables("${process.env.SECRET}", "{{constructor.prototype}}"), []);
});
test("preview is isolated by network-denying CSP and empty iframe sandbox", () => {
  const html = safeEmailPreview('<script>fetch("https://example.test")</script><form action="https://example.test"></form>');
  assert.ok(html.indexOf("Content-Security-Policy") < html.indexOf("<script>"));
  for (const directive of ["default-src 'none'", "script-src 'none'", "form-action 'none'", "base-uri 'none'"]) assert.ok(html.includes(directive));
  const manager = source("components/notifications/EmailAutomationManager.tsx");
  assert.match(manager, /sandbox="" referrerPolicy="no-referrer"/);
  assert.doesNotMatch(manager, /dangerouslySetInnerHTML|\/send-test|\/send-now/);
});
test("new library reuses Notifications and existing Messages entry point", () => {
  assert.equal(EMAIL_AUTOMATION_PATH, "/admin/settings?tab=notifications#notification-email");
  assert.match(source("components/NotificationRulesManager.tsx"), /<EmailAutomationManager/);
  assert.match(source("pages/staff/Messages.tsx"), /href=\{EMAIL_AUTOMATION_PATH\}/);
  assert.match(source("pages/staff/Settings.tsx"), /get\("tab"\) === "notifications"/);
});
test("existing rule legacy editor preserved; binding nullable and explicit", () => {
  const rules = source("components/NotificationRulesManager.tsx");
  assert.match(rules, /emailTemplateVersionId: useEmailLibrary \? emailBinding.templateVersionId : null/);
  assert.match(rules, /emailSenderAccountId: useEmailLibrary \? emailBinding.senderAccountId : null/);
  assert.match(rules, /translations\["en"\]/);
  assert.match(rules, /PASSIVE_CHANNELS = new Set\(\["telegram", "sms"\]\)/);
  assert.equal((rules.match(/expectedUpdatedAt: (?:rule|editingTemplate)\.updatedAt/g) ?? []).length, 3,
    "every rule mutation is bound to the version displayed by the administrator");
  assert.equal((rules.match(/catch \{[\s\S]{0,160}await fetchRules\(\)/g) ?? []).length, 3,
    "all rule write conflicts refresh authoritative server state");
});
test("email controls application only and WhatsApp config preserved", () => {
  const stages = source("components/EditStagesDialog.tsx");
  assert.match(stages, /isApplicationStage && \(\s*<>\s*<StageAutomaticEmailFields/);
  assert.match(stages, /automaticMessage: enabled \? \{/);
  const fields = source("components/notifications/EmailAutomationFields.tsx");
  assert.match(fields, /originTypes: value\?\.originTypes \?\? \["direct"\]/);
  assert.match(fields, /templateVersionId: value\?\.templateVersionId \?\? null/);
  assert.match(fields, /capabilities.data\?\.stageVariables \?\? \[\]/);
});
test("TR copy and safe English fallback preserve explicit delivery limits", () => {
  assert.equal(emailAutomationCopy("tr").title, "E-posta otomasyonu");
  for (const lang of ["en", "ar", "ru", "hi"]) assert.equal(emailAutomationCopy(lang).title, "Email automation");
  assert.match(emailAutomationCopy("en").historyNote, /not confirmed inbox delivery/);
  assert.match(emailAutomationCopy("en").stageNote, /No backfill/);
});
test("catalogue is bounded and pinned references hydrate through exact lookup", () => {
  const hook = source("components/notifications/useEmailLibrary.ts");
  assert.match(hook, /page < 20/);
  assert.match(hook, /seen.has\(result.nextCursor\)/);
  const fields = source("components/notifications/EmailAutomationFields.tsx");
  assert.match(fields, /\/notification-email\/versions\/\$\{templateVersionId\}/);
  assert.match(fields, /\/notification-email\/senders\/\$\{senderAccountId\}/);
});
test("actual delivery statuses are localized without claiming confirmed delivery", () => {
  for (const [status, en, tr] of [["unknown", "Delivery outcome unknown", "Gönderim sonucu bilinmiyor"], ["processing", "Processing", "İşleniyor"], ["enqueued", "Queued for sending", "Gönderim kuyruğuna alındı"]]) {
    assert.equal(emailStatusLabel(status, "en"), en);
    assert.equal(emailStatusLabel(status, "tr"), tr);
    assert.equal(emailStatusLabel(status, "ar"), en);
  }
  assert.equal(emailStatusLabel("sent", "en"), "SMTP accepted");
  assert.match(source("components/notifications/EmailAutomationManager.tsx"), /Only the latest 100 records are shown/);
});
test("legacy rule writes require confirmed active admin session, never manager or impersonation", () => {
  for (const role of ["admin", "super_admin"]) {
    assert.equal(canManageNotificationRules({ role, isActive: true }, true), true);
    assert.equal(canManageNotificationRules({ role, isActive: true }, false), false);
    assert.equal(canManageNotificationRules({ role, isActive: false }, true), false);
    assert.equal(canManageNotificationRules({ role, isActive: true, isImpersonating: true }, true), false);
  }
  for (const role of ["manager", "staff", "agent", "student", ""]) assert.equal(canManageNotificationRules({ role, isActive: true }, true), false);
  assert.equal(canManageNotificationRules(undefined, true), false);
  const rules = source("components/NotificationRulesManager.tsx");
  assert.match(rules, /notification-rule-write-authority/);
  assert.match(rules, /ruleAuthority\.isSuccess && !ruleAuthority\.isFetching && ruleAuthority\.data\.canManage === true/);
  assert.match(rules, /async function toggleChannel[^]*?if \(!canManageRules\) return/);
  assert.match(rules, /async function toggleActive[^]*?if \(!canManageRules\) return/);
  assert.match(rules, /function openTemplateEditor[^]*?if \(!canManageRules\) return/);
  assert.match(rules, /if \(!canManageRules \|\| !editingTemplate\) return/);
  assert.match(rules, /disabled=\{!canManageRules \|\| saving === rule.id \|\| !rule.isActive\}/);
});
