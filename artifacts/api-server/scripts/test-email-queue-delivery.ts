/** No live database, DNS or SMTP: actual queue functions execute against injected doubles. */
import assert from "node:assert/strict";
import { beforeEach, after, mock, test } from "node:test";
import dns from "node:dns/promises";
import net from "node:net";
import { syncBuiltinESMExports } from "node:module";
import nodemailer from "nodemailer";

process.env.DATABASE_URL = "postgres://fixture:fixture@127.0.0.1:5433/fasos_apply_local";
process.env.ENCRYPTION_KEY = "synthetic-email-test-key-never-used-outside-tests";
process.env.NODE_ENV = "test";
process.env.EMAIL_DELIVERY_DISABLED = "true";
let beforeDnsReturn: (() => void) | undefined;
mock.method(net.Socket.prototype, "connect", () => { throw new Error("NETWORK_FORBIDDEN_IN_EMAIL_TEST"); });
mock.method(dns, "lookup", async (host: string) => {
  assert.equal(host, "smtp.example.test");
  beforeDnsReturn?.();
  return [{ address: "93.184.216.34", family: 4 }];
});
syncBuiltinESMExports();

const workspace = await import("@workspace/db");
const { pool, db } = workspace;
const { encryptConfig } = await import("../src/lib/encryption.js");
const email = await import("../src/lib/email.js");
const fixtureContent = { subject: "Fixture", html: "<p>Fixture</p>", text: "Fixture" };
const recipient = "recipient@example.test";
type Row = Record<string, any>;
let rows: Row[] = [];
let sends: Row[] = [];
let queries: string[] = [];
let smtpOptions: any;
let smtpFailure: unknown;
let insertFailure = false;
let receiptFailure = false;
let approved = true;
let disabledOnTransport = false;
let loseClaimOnTransport = false;
let insertHook: (() => Promise<unknown>) | undefined;
let diagnostics: unknown[][] = [];
let senderRecord: Row | undefined;

mock.method(console, "error", (...args: unknown[]) => { diagnostics.push(args); });
mock.method(pool, "connect", () => { throw new Error("DATABASE_FORBIDDEN_IN_EMAIL_TEST"); });
mock.method(db, "select", () => ({ from: (table: unknown) => {
  const result = table === workspace.integrationsTable
    ? [{ isEnabled: true, config: encryptConfig({ host: "smtp.example.test", port: "587", username: "sender@example.test", password: "synthetic-password", fromEmail: "sender@example.test" }) }]
    : table === workspace.settingsTable ? [{ emailSenderName: "Fixture Sender", emailSenderEmail: "sender@example.test" }]
      : table === workspace.channelAccountsTable && senderRecord ? [senderRecord] : [];
  return { where: () => ({ limit: async () => result, then: (resolve: any) => Promise.resolve(result).then(resolve) }),
    then: (resolve: any) => Promise.resolve(result).then(resolve) };
} }));
mock.method(nodemailer, "createTransport", (options: unknown) => {
  smtpOptions = options;
  if (disabledOnTransport) process.env.EMAIL_DELIVERY_DISABLED = "true";
  if (loseClaimOnTransport) { rows[0].status = "unknown"; rows[0].claim_token = null; }
  return { close() {}, async sendMail(value: Row) { sends.push(value); if (smtpFailure) throw smtpFailure; return { accepted: [recipient], rejected: [] }; } };
});
mock.method(pool, "query", async (sql: string, args: any[] = []) => {
  queries.push(sql);
  if (sql.startsWith("INSERT INTO email_queue")) {
    if (insertFailure) throw new Error("synthetic database failure");
    const [to_email, subject, html_body, text_body, sender_account_id, sender_revision, template_version_id, idempotency_key, attachments] = args;
    if (idempotency_key && rows.some(row => row.idempotency_key === idempotency_key)) return { rows: [] };
    const row = { id: rows.length + 1, to_email, subject, html_body, text_body, sender_account_id, sender_revision, template_version_id,
      idempotency_key, attachments: attachments === null ? null : JSON.parse(attachments), status: "pending", retry_count: 0, max_retries: 3 };
    rows.push(row);
    if (insertHook) { const hook = insertHook; insertHook = undefined; await hook(); }
    return { rows: [{ id: row.id }] };
  }
  if (sql.startsWith("UPDATE email_queue SET status = 'processing'")) {
    assert.match(sql, /FOR UPDATE SKIP LOCKED/);
    const row = rows.find(row => row.status === "pending" && !row.next_retry_at && (args[1] == null || row.id === args[1]));
    if (!row) return { rows: [] };
    row.status = "processing"; row.claim_token = args[0]; row.claimed_at = new Date();
    return { rows: [{ ...row }] };
  }
  if (sql.startsWith("SELECT id FROM email_queue")) return { rows: rows.filter(row => row.id === args[0] && row.status === "processing" && row.claim_token === args[1]).map(row => ({ id: row.id })) };
  if (sql.startsWith("UPDATE email_queue SET status=$3")) {
    if (receiptFailure) throw new Error("lost persistence receipt");
    const row = rows.find(row => row.id === args[0] && row.status === "processing" && row.claim_token === args[1]);
    if (row) Object.assign(row, { status: args[2], retry_count: args[3], delivery_error_code: args[4], provider_message_id: args[5], next_retry_at: args[6], claim_token: null, claimed_at: null });
    return { rows: [], rowCount: row ? 1 : 0 };
  }
  if (sql.startsWith("UPDATE email_queue SET status='unknown'")) {
    for (const row of rows) if (row.status === "processing" && (!row.claimed_at || row.stale)) Object.assign(row, { status: "unknown", delivery_error_code: "EMAIL_CLAIM_STALE", claim_token: null });
    return { rows: [] };
  }
  if (sql.startsWith("SELECT id,status FROM email_queue")) {
    const row = rows.find(row => row.idempotency_key === args[0] && row.to_email === args[1] && row.subject === args[2]
      && row.html_body === args[3] && row.text_body === args[4] && row.sender_account_id === args[5] && row.sender_revision === args[6]
      && row.template_version_id === args[7] && JSON.stringify(row.attachments) === JSON.stringify(args[8] === null ? null : JSON.parse(args[8])));
    return { rows: row ? [{ id: row.id, status: row.status }] : [] };
  }
  if (sql.startsWith("SELECT v.id FROM message_template_email_versions")) return { rows: approved ? [{ id: args[0] }] : [] };
  if (sql.includes("FROM pipeline_stage_email_dispatches d")) return { rows: [] };
  throw new Error("UNEXPECTED_EMAIL_QUERY");
});

beforeEach(() => {
  email.invalidateSmtpCache(); rows = []; sends = []; queries = []; diagnostics = [];
  smtpFailure = undefined; smtpOptions = undefined; insertFailure = false; receiptFailure = false;
  approved = true; disabledOnTransport = false; loseClaimOnTransport = false; insertHook = undefined;
  senderRecord = undefined; beforeDnsReturn = undefined;
  // The only enabled transport is the above fake. Socket and DNS guards remain installed.
  process.env.NODE_ENV = "production";
  process.env.ALLOW_LIVE_INTEGRATIONS = "true";
  process.env.EMAIL_DELIVERY_DISABLED = "false";
});
after(async () => { email.invalidateSmtpCache(); await pool.end(); mock.restoreAll(); syncBuiltinESMExports(); });

test("durable insertion precedes SMTP; encrypted legacy secret is decrypted; pinned TLS stays enforced", async () => {
  assert.equal(await email.sendEmail(recipient, fixtureContent), true);
  assert.equal(rows[0].status, "sent"); assert.equal(sends.length, 1);
  assert.equal(smtpOptions.auth.pass, "synthetic-password");
  assert.equal(smtpOptions.host, "93.184.216.34"); assert.equal(smtpOptions.tls.servername, "smtp.example.test");
  assert.equal(smtpOptions.tls.rejectUnauthorized, true); assert.equal(smtpOptions.requireTLS, true);
  assert.equal(smtpOptions.disableFileAccess, true); assert.equal(smtpOptions.disableUrlAccess, true);
  assert.ok(queries[0].startsWith("INSERT INTO email_queue"));
});

test("queue insert failure never falls through to SMTP", async () => {
  insertFailure = true;
  assert.equal(await email.sendEmail(recipient, fixtureContent), false); assert.equal(sends.length, 0);
});

test("worker winning after insert cannot duplicate the immediate send", async () => {
  insertHook = () => email.processEmailQueue();
  await email.sendEmail(recipient, fixtureContent);
  assert.equal(sends.length, 1); assert.equal(rows[0].status, "sent");
});

test("same-key concurrent calls send once and changed content cannot replay", async () => {
  const options = { idempotencyKey: "fixture:one" };
  await Promise.all([email.sendEmail(recipient, fixtureContent, options), email.sendEmail(recipient, fixtureContent, options)]);
  assert.equal(sends.length, 1); assert.equal(rows.length, 1);
  assert.equal(await email.sendEmail(recipient, fixtureContent, options), true);
  assert.equal(await email.sendEmail(recipient, { ...fixtureContent, subject: "Changed" }, options), false);
  assert.equal(sends.length, 1);
});

test("temporary failure retries exact attachments; ambiguous failure never retries", async () => {
  smtpFailure = { responseCode: 451, command: "DATA", message: "provider includes recipient and secret" };
  const attachment = { filename: "signed.pdf", content: Buffer.from([1, 255, 4]), contentType: "application/pdf" };
  assert.equal(await email.sendEmail(recipient, fixtureContent, { attachments: [attachment] }), false);
  assert.equal(rows[0].status, "pending"); assert.equal(rows[0].retry_count, 1);
  smtpFailure = undefined; rows[0].next_retry_at = null;
  assert.equal(await email.processEmailQueue(), 1);
  assert.deepEqual(sends[1].attachments, [attachment]);
  assert.equal(sends[0].messageId, sends[1].messageId);
  smtpFailure = { code: "ETIMEDOUT", command: "DATA", message: "private recipient/subject" };
  await email.sendEmail(recipient, fixtureContent);
  assert.equal(rows[1].status, "unknown");
  assert.equal(await email.processEmailQueue(), 0); assert.equal(sends.length, 3);
  assert.ok(!JSON.stringify(diagnostics).includes("private recipient"));
});

test("SMTP acceptance with lost receipt is never blindly requeued on restart", async () => {
  receiptFailure = true;
  assert.equal(await email.sendEmail(recipient, fixtureContent), true);
  assert.equal(rows[0].status, "processing"); rows[0].stale = true;
  receiptFailure = false;
  assert.equal(await email.processEmailQueue(), 0);
  assert.equal(rows[0].status, "unknown"); assert.equal(sends.length, 1);
});

test("actual-send kill switch after resolving transport blocks SMTP and consumes no retry", async () => {
  disabledOnTransport = true;
  assert.equal(await email.sendEmail(recipient, fixtureContent), false);
  assert.equal(rows[0].status, "pending"); assert.equal(rows[0].retry_count, 0); assert.equal(sends.length, 0);
});

test("lease lost while resolving SMTP cannot later send after stale recovery", async () => {
  loseClaimOnTransport = true;
  assert.equal(await email.sendEmail(recipient, fixtureContent), false);
  assert.equal(rows[0].status, "unknown"); assert.equal(sends.length, 0);
});

test("disabled worker makes no DB/provider calls even with copied queue rows", async () => {
  process.env.ALLOW_LIVE_INTEGRATIONS = "false";
  assert.equal(await email.processEmailQueue(), 0);
  assert.equal(await email.sendEmail(recipient, fixtureContent), false);
  assert.equal(queries.length, 0); assert.equal(sends.length, 0);
});

test("retired template, inactive pinned sender and stage without intent fail closed without fallback", async () => {
  approved = false;
  await email.sendEmail(recipient, fixtureContent, { templateVersionId: 42 });
  assert.equal(rows[0].delivery_error_code, "EMAIL_TEMPLATE_NOT_APPROVED");
  await email.sendEmail(recipient, fixtureContent, { senderAccountId: 2, senderRevision: 1 });
  assert.equal(rows[1].delivery_error_code, "EMAIL_SENDER_UNAVAILABLE");
  await email.sendEmail(recipient, fixtureContent, { idempotencyKey: "stage-email:42" });
  assert.equal(rows[2].delivery_error_code, "STAGE_INTENT_NOT_FOUND");
  assert.equal(sends.length, 0);
});

function approvedSender(): Row {
  return { id: 2, displayName: "Fixture Sender", channel: "email", provider: "smtp", isActive: true, status: "active",
    configEncrypted: JSON.stringify(encryptConfig({ host: "smtp.example.test", port: 587, username: "sender@example.test", password: "synthetic-password" })),
    metadata: { emailSender: { revision: 1, fromEmail: "sender@example.test", fromName: "Fixture Sender", replyTo: "",
      verified: true, createdById: 1, lastChangedById: 1, approvedById: 2 } } };
}

test("unchanged approved pinned sender survives last-boundary verification", async () => {
  senderRecord = approvedSender();
  assert.equal(await email.sendEmail(recipient, fixtureContent, { senderAccountId: 2, senderRevision: 1 }), true);
  assert.equal(sends.length, 1);
});

test("sender deactivation, revision or metadata change during DNS blocks generic SMTP without fallback", async () => {
  for (const mutate of [() => { senderRecord!.isActive = false; },
    () => { senderRecord!.metadata.emailSender.revision = 2; },
    () => { senderRecord!.metadata.emailSender.fromName = "Changed identity"; }]) {
    senderRecord = approvedSender(); beforeDnsReturn = mutate;
    assert.equal(await email.sendEmail(recipient, fixtureContent, { senderAccountId: 2, senderRevision: 1 }), false);
    assert.equal(rows.at(-1)?.delivery_error_code, "EMAIL_SENDER_CHANGED_OR_UNVERIFIED");
  }
  assert.equal(sends.length, 0);
});
