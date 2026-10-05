import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import type { ChannelAccount } from "@workspace/db";

// No connection is opened. Imported DB helpers require a URL; the fixture has no usable server.
process.env.DATABASE_URL = "postgresql://fixture:fixture@127.0.0.1:1/email_library_fixture";
process.env.ENCRYPTION_KEY = "synthetic-email-library-test-key";
process.env.NODE_ENV = "test";
process.env.ALLOW_LIVE_INTEGRATIONS = "false";
const library = await import("../src/lib/notifications/emailTemplateLibrary");
const senders = await import("../src/lib/notifications/emailSenderAccounts");
const policy = await import("../src/lib/notifications/emailAutomationPolicy");
const { serializeAccountConfig } = await import("../src/lib/inbox/channelAccountConfig");

const fields = { subject: "Hello {{studentName}}", content: "<p>{{studentName}}, {{programName}}</p>", language: "en" };
const sender = { displayName: "Synthetic", host: "smtp.example.com", port: 587, username: "fixture@example.com", password: "fixture-secret",
  fromEmail: "fixture@example.com", fromName: "Test Sender", replyTo: "support@example.com" };
const metadata = { revision: 1, fromEmail: sender.fromEmail, fromName: sender.fromName, replyTo: sender.replyTo,
  verified: true, createdById: 1, lastChangedById: 1, approvedById: 2 };
function row(overrides: Partial<ChannelAccount> = {}): ChannelAccount {
  return { id: 1, channel: "email", provider: "smtp", displayName: sender.displayName,
    configEncrypted: serializeAccountConfig({ host: sender.host, port: sender.port, username: sender.username, password: sender.password }),
    metadata: { emailSender: { ...metadata } }, externalAccountId: null, webhookSecret: null, status: "active", isActive: true, isDefault: false,
    lastSeenAt: null, createdAt: new Date(), updatedAt: new Date(), ...overrides };
}

test("reuses 23 locales and existing event categories plus general", () => {
  assert.equal(library.EMAIL_TEMPLATE_LANGUAGES.length, 23);
  assert.ok(library.EMAIL_TEMPLATE_CATEGORIES.includes("applications"));
  assert.ok(library.EMAIL_TEMPLATE_CATEGORIES.includes("general"));
  assert.ok(library.EMAIL_TEMPLATE_VARIABLES.includes("senderName"));
  assert.equal(library.STAGE_EMAIL_TEMPLATE_VARIABLES.length, 8);
});
test("strict variable catalogue rejects helpers, nested lookup and unbalanced tokens", () => {
  for (const content of ["{{password}}", "{{student.name}}", "{{__proto__}}", "{{studentName", "{{{studentName}}}"]) {
    assert.throws(() => library.validateEmailVersion({ ...fields, content }), /VARIABLE_INVALID/);
  }
  assert.deepEqual(library.validateEmailVersion(fields).variables, ["programName", "studentName"]);
});
test("template fields reject oversized content, unsupported locale and subject header injection", () => {
  for (const patch of [{ content: "a".repeat(20_001) }, { language: "xx" }, { subject: "Bcc:\r\nx@example.com" }, { subject: "" }]) {
    assert.throws(() => library.validateEmailVersion({ ...fields, ...patch }), /EMAIL_TEMPLATE_INVALID/);
  }
});
test("active HTML removed before storing immutable snapshot", () => {
  const value = library.validateEmailVersion({ ...fields, content: '<p onclick="evil()">Hello</p><script>alert(1)</script><iframe src="https://evil.example"></iframe>' });
  assert.equal(value.content, "<p>Hello</p>");
});
test("render escapes values and sanitizes after substitution", () => {
  const value = library.renderEmailVersionFields(fields, { studentName: '<img src=x onerror="evil()">', programName: "Medicine & health" });
  assert.ok(value.bodyHtml.includes("&lt;img"));
  assert.ok(!value.bodyHtml.includes("<img"));
  const url = library.renderEmailVersionFields({ subject: "Test", content: '<a href="{{contractLink}}">View</a>' }, { contractLink: "javascript:alert(1)" });
  assert.equal(url.bodyHtml, "<a>View</a>");
});
test("missing/blank, inherited or control-character variables fail closed", () => {
  for (const values of [{ studentName: "A" }, { studentName: "A", programName: "" }, { studentName: "A\nB", programName: "Test" }, Object.create({ studentName: "A", programName: "B" })]) {
    assert.throws(() => library.renderEmailVersionFields(fields, values), /VARIABLE_MISSING/);
  }
  assert.throws(() => library.renderEmailVersionFields(fields, { studentName: "A", programName: "B", secret: "hidden" }), /VARIABLE_INVALID/);
});
test("immutable versions follow draft-review-approved-retired with separate checker", () => {
  assert.equal(library.canTransitionEmailVersion("draft", "review", 1, 1), true);
  assert.equal(library.canTransitionEmailVersion("review", "approved", 1, 1), false);
  assert.equal(library.canTransitionEmailVersion("review", "approved", 1, 2), true);
  assert.equal(library.canTransitionEmailVersion("approved", "retired", 1, 2), true);
  for (const [from, to] of [["draft", "approved"], ["retired", "approved"], ["approved", "draft"], ["review", "draft"]]) assert.equal(library.canTransitionEmailVersion(from, to, 1, 2), false);
});
test("strict integer IDs reject malformed and oversized references", () => {
  assert.equal(library.positiveEmailId("123"), 123);
  for (const value of ["1abc", "1.2", "-1", 0, Infinity, 2147483648, null]) assert.throws(() => library.positiveEmailId(value), /EMAIL_INVALID_ID/);
});
test("human actor requires a matching active unimpersonated admin session", () => {
  const user = { id: 1, role: "admin", isActive: true };
  assert.equal(policy.isEmailAutomationHumanSnapshot(user, false, { user: { id: 1 } }), true);
  for (const [actor, token, session] of [[user, true, { user }], [user, false, null], [user, false, { user: { id: 2 } }],
    [user, false, { user, originalSid: "parent" }], [{ ...user, role: "manager" }, false, { user }], [{ ...user, isActive: false }, false, { user }]] as const) {
    assert.equal(policy.isEmailAutomationHumanSnapshot(actor, token, session), false);
  }
});
test("sender validation disallows extra mailbox, unsafe host, ports and masked secret", () => {
  for (const patch of [{ fromEmail: "a@example.com,b@example.com" }, { replyTo: "a@example.com\r\nBcc:x@example.com" }, { host: "localhost" }, { host: "https://smtp.example.com" }, { port: 25 }, { password: "••••••••" }]) {
    assert.throws(() => senders.validateEmailSender({ ...sender, ...patch }), /EMAIL_SENDER_/);
  }
  assert.equal(senders.validateEmailSender({ password: "", expectedRevision: 1 }, sender).password, sender.password);
});
test("password is encrypted and safe projection never exposes stored secret", () => {
  const value = row();
  assert.ok(!value.configEncrypted!.includes(sender.password));
  const projected = senders.safeEmailSender(value);
  assert.equal(projected.config.passwordConfigured, true);
  assert.ok(!JSON.stringify(projected).includes(sender.password));
  assert.ok(!JSON.stringify(projected).includes("enc::"));
});
test("pinned sender rejects missing/wrong revision, disabled, wrong provider and self-verified", () => {
  assert.equal(senders.resolveEmailSenderRow(row(), 1)?.fromEmail, sender.fromEmail);
  for (const value of [undefined, row({ isActive: false }), row({ status: "inactive" }), row({ provider: "direct" }),
    row({ metadata: { emailSender: { ...metadata, approvedById: 1 } } }), row({ metadata: { emailSender: { ...metadata, verified: false } } })]) {
    assert.equal(senders.resolveEmailSenderRow(value, 1), null);
  }
  assert.equal(senders.resolveEmailSenderRow(row(), 2), null);
});
test("bad/missing encrypted credentials do not fall back to shared SMTP", () => {
  assert.equal(senders.resolveEmailSenderRow(row({ configEncrypted: '{"password":"enc::v1::corrupt"}' }), 1), null);
  assert.equal(senders.resolveEmailSenderRow(row({ configEncrypted: null }), 1), null);
});
test("verification kill switch prevents even transporter construction", async () => {
  let calls = 0;
  await assert.rejects(senders.verifyEmailSenderConnection(100, sender, async () => { calls++; throw new Error("unused"); }), /EMAIL_VERIFICATION_DISABLED/);
  assert.equal(calls, 0);
});
test("bounded verification closes transport, redacts failures, rejects repeat attempts", async () => {
  const disabled = process.env.EMAIL_DELIVERY_DISABLED;
  process.env.NODE_ENV = "development"; process.env.ALLOW_LIVE_INTEGRATIONS = "true";
  process.env.EMAIL_DELIVERY_DISABLED = "false"; // Transport factory below is fake: no DNS/SMTP path exists.
  try {
    let close = 0;
    await senders.verifyEmailSenderConnection(101, sender, async () => ({ verify: async () => true, close: () => { close++; } }));
    assert.equal(close, 1);
    await assert.rejects(senders.verifyEmailSenderConnection(101, sender, async () => { throw new Error("not-called"); }), /RATE_LIMITED/);
    await assert.rejects(senders.verifyEmailSenderConnection(102, sender, async () => ({ verify: async () => { throw new Error("secret credential and real recipient"); }, close() {} })), { message: "EMAIL_VERIFICATION_FAILED" });
  } finally { process.env.NODE_ENV = "test"; process.env.ALLOW_LIVE_INTEGRATIONS = "false";
    if (disabled === undefined) delete process.env.EMAIL_DELIVERY_DISABLED; else process.env.EMAIL_DELIVERY_DISABLED = disabled; }
});
test("timeout retains bounded pending slots and late DNS cannot trigger verification", async () => {
  const disabled = process.env.EMAIL_DELIVERY_DISABLED;
  process.env.NODE_ENV = "development"; process.env.ALLOW_LIVE_INTEGRATIONS = "true";
  process.env.EMAIL_DELIVERY_DISABLED = "false"; // Injected unresolved fake factory, never the real SMTP constructor.
  try {
    let verified = 0, closed = 0;
    let release!: (value: { verify(): Promise<unknown>; close(): void }) => void;
    const pending = new Promise<{ verify(): Promise<unknown>; close(): void }>(resolve => { release = resolve; });
    await assert.rejects(senders.verifyEmailSenderConnection(103, sender, () => pending, 5), /TIMEOUT/);
    release({ verify: async () => { verified++; }, close: () => { closed++; } });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(verified, 0); assert.equal(closed, 1);
  } finally { process.env.NODE_ENV = "test"; process.env.ALLOW_LIVE_INTEGRATIONS = "false";
    if (disabled === undefined) delete process.env.EMAIL_DELIVERY_DISABLED; else process.env.EMAIL_DELIVERY_DISABLED = disabled; }
});
test("legacy account mutations and template edits cannot bypass managed approval", async () => {
  const channels = await readFile(new URL("../src/routes/channelAccounts.ts", import.meta.url), "utf8");
  assert.equal((channels.match(/managed_email_sender/g) ?? []).length, 5);
  assert.match(channels, /rows\.filter\(row => row\.channel !== "email"\)/);
  const messages = await readFile(new URL("../src/routes/messages.ts", import.meta.url), "utf8");
  assert.match(messages, /EMAIL_IMMUTABLE_VERSION_REQUIRED/);
  assert.match(messages, /EMAIL_VERSIONED_TEMPLATE_CANNOT_DELETE/);
});
test("API uses no-store bounded history without recipient, body, provider response or secrets", async () => {
  const source = await readFile(new URL("../src/routes/emailAutomation.ts", import.meta.url), "utf8");
  const history = source.slice(source.indexOf('router.get("/notification-email/history"'));
  assert.match(source, /private, no-store/); assert.match(history, /limit\(101\)/);
  assert.ok(!/toEmail|htmlBody|textBody|providerMessageId|configEncrypted/.test(history));
  assert.match(source, /current\.configEncrypted !== old\.configEncrypted/);
  assert.match(source, /currentMeta\.revision !== expected/);
});
