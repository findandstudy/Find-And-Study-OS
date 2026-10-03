import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  emailDeliveryAllowed, serializeEmailAttachments, deserializeEmailAttachments,
  EMAIL_ATTACHMENT_LIMITS, isEmailMailbox, classifyEmailTransportError, emailRetryResult,
  executeClaimedEmail, stageEmailDeliveryErrorCode, type ClaimedEmail, type EmailAttemptResult,
} from "../src/lib/emailDeliveryPolicy.js";

const message: ClaimedEmail = {
  id: 1, claim_token: "test-claim", to_email: "recipient@example.test", subject: "Fixture",
  html_body: "<p>Fixture</p>", text_body: "Fixture", retry_count: 0, max_retries: 3,
  sender_account_id: null, sender_revision: null, template_version_id: null,
  idempotency_key: null, attachments: null,
};

test("stage delivery diagnostics preserve only explicitly allowlisted codes", () => {
  assert.equal(stageEmailDeliveryErrorCode("RECIPIENT_CHANGED"), "RECIPIENT_CHANGED");
  assert.equal(stageEmailDeliveryErrorCode("AUTOMATION_INACTIVE_OR_HISTORICAL"), "AUTOMATION_INACTIVE_OR_HISTORICAL");
  for (const value of [null, "SMTP_PASSWORD_SECRET", "recipient@example.test", "STAGE_POLICY_CHANGED\nsecret", {}]) {
    assert.equal(stageEmailDeliveryErrorCode(value), "STAGE_EMAIL_POLICY_BLOCKED");
  }
});

test("delivery guard: test/local cannot send accidentally; explicit production false is honored", () => {
  for (const env of [ {}, { NODE_ENV: "test", ALLOW_LIVE_INTEGRATIONS: "true" },
    { NODE_ENV: "development" }, { NODE_ENV: "production", ALLOW_LIVE_INTEGRATIONS: "false" },
    { NODE_ENV: "production", ALLOW_LIVE_INTEGRATIONS: "TRUE" },
    { NODE_ENV: "production", EMAIL_DELIVERY_DISABLED: "true" },
    { NODE_ENV: "production", EMAIL_DELIVERY_DISABLED: "invalid" } ]) assert.equal(emailDeliveryAllowed(env), false);
  assert.equal(emailDeliveryAllowed({ NODE_ENV: "production" }), true);
  assert.equal(emailDeliveryAllowed({ NODE_ENV: "production", ALLOW_LIVE_INTEGRATIONS: "true" }), true);
  assert.equal(emailDeliveryAllowed({ NODE_ENV: "development", ALLOW_LIVE_INTEGRATIONS: "true" }), true);
});

test("single-mailbox envelope rejects header injection and recipient expansion", () => {
  for (const value of ["a@example.test,b@example.test", "a@example.test\r\nBcc:x@example.test", "a@b@example.test", "A <a@example.test>", "a\0@example.test", ""]) assert.equal(isEmailMailbox(value), false);
  assert.equal(isEmailMailbox("first.last+tag@example.test"), true);
});

test("attachments retain binary bytes, type, name and checksum across durable retries", () => {
  const inputs = [{ filename: "signed-contract.pdf", content: Buffer.from([0, 1, 255, 4]), contentType: "application/pdf" }];
  const serialized = serializeEmailAttachments(inputs);
  assert.deepEqual(deserializeEmailAttachments(JSON.parse(JSON.stringify(serialized))), inputs);
  assert.equal(serializeEmailAttachments(), null);
  assert.equal(serializeEmailAttachments([]), null);
  assert.equal(deserializeEmailAttachments(null), undefined);
});

test("attachment count, byte, path, type and malformed collection bounds fail closed", () => {
  for (const value of [null, {}, "bad", [null], [{ filename: "../private", content: Buffer.from("x") }],
    [{ filename: "document.pdf", content: Buffer.from("x"), contentType: "application/pdf\r\nBad: x" }],
    Array.from({ length: EMAIL_ATTACHMENT_LIMITS.count + 1 }, () => ({ filename: "a.pdf", content: Buffer.alloc(0) })),
    [{ filename: "a.pdf", content: Buffer.alloc(EMAIL_ATTACHMENT_LIMITS.totalBytes + 1) }] ]) {
    assert.throws(() => serializeEmailAttachments(value as any), /EMAIL_ATTACHMENT_/);
  }
});

test("maximum supported PDF-sized attachment round-trips without regex stack overflow", () => {
  const content = Buffer.alloc(EMAIL_ATTACHMENT_LIMITS.totalBytes, 19);
  const serialized = serializeEmailAttachments([{ filename: "large.pdf", content }]);
  assert.deepEqual(deserializeEmailAttachments(serialized)?.[0].content, content);
});

test("retry refuses tampered, invalid-base64 or oversized persisted attachments", () => {
  const good = serializeEmailAttachments([{ filename: "a.pdf", content: Buffer.from("fixture") }])![0];
  for (const value of [[{ ...good, contentBase64: "%%%" }], [{ ...good, sha256: "bad" }],
    [{ ...good, contentBase64: "a".repeat(Math.ceil(EMAIL_ATTACHMENT_LIMITS.totalBytes / 3) * 4 + 1) }], {}, [null]]) {
    assert.throws(() => deserializeEmailAttachments(value), /EMAIL_ATTACHMENT_/);
  }
});

test("SMTP explicit rejection and proven pre-DATA failures are classified without raw error text", () => {
  assert.deepEqual(classifyEmailTransportError({ code: "EAUTH", message: "secret" }), { status: "failed", code: "SMTP_AUTH_FAILED" });
  assert.equal(classifyEmailTransportError({ responseCode: 450 }).status, "pending");
  assert.equal(classifyEmailTransportError({ responseCode: 550 }).status, "failed");
  assert.equal(classifyEmailTransportError({ code: "ETIMEDOUT", command: "CONN" }).status, "pending");
  assert.equal(classifyEmailTransportError({ code: "EENVELOPE" }).status, "failed");
});

test("ambiguous SMTP DATA/socket outcome is unknown and never blindly retryable", () => {
  for (const error of [{ code: "ETIMEDOUT", command: "DATA" }, { code: "ECONNRESET" }, new Error("lost SMTP acceptance")]) {
    const result = classifyEmailTransportError(error);
    assert.equal(result.status, "unknown");
    assert.equal(emailRetryResult(result, 0, 3).backoffSeconds, null);
    assert.equal(emailRetryResult(result, 0, 3).retryCount, 0);
  }
});

test("definite temporary failures have bounded exponential retries, kill-switch does not consume attempts", () => {
  assert.equal(emailRetryResult({ status: "pending", code: "SMTP_TEMPORARY_REJECTED" }, 0, 3).backoffSeconds, 120);
  assert.equal(emailRetryResult({ status: "pending", code: "SMTP_TEMPORARY_REJECTED" }, 2, 3).status, "failed");
  assert.equal(emailRetryResult({ status: "pending", code: "EMAIL_DELIVERY_DISABLED" }, 1, 3).retryCount, 1);
});

async function runAttempt(overrides: Partial<ClaimedEmail> = {}, result: EmailAttemptResult = { status: "sent", code: null }, allowed = true) {
  let sends = 0;
  let saved: ReturnType<typeof emailRetryResult> | undefined;
  let attachment: Buffer | undefined;
  const sent = await executeClaimedEmail({ ...message, ...overrides }, {
    allowed: () => allowed,
    send: async (_row, attachments) => { sends++; attachment = attachments?.[0].content; return result; },
    save: async (_row, value) => { saved = value; }, onSaveFailure: () => assert.fail("unexpected save failure"),
  });
  return { sent, sends, saved: saved!, attachment };
}

test("last-mile kill switch prevents provider invocation and releases the claim to pending", async () => {
  const result = await runAttempt({}, { status: "sent", code: null }, false);
  assert.equal(result.sends, 0); assert.equal(result.sent, false);
  assert.equal(result.saved.status, "pending"); assert.equal(result.saved.retryCount, 0);
});

test("claimed-row envelope/content/attachments are revalidated before provider invocation", async () => {
  for (const value of [{ to_email: "a@example.test,b@example.test" }, { subject: "header\r\nBad:x" },
    { subject: 12 as any }, { html_body: "x".repeat(2 * 1024 * 1024 + 1) }, { attachments: [{ filename: "broken" }] }]) {
    const result = await runAttempt(value);
    assert.equal(result.sends, 0); assert.equal(result.saved.status, "blocked");
  }
});

test("claimed retry passes exact persisted attachment bytes and retains boolean API semantics", async () => {
  const result = await runAttempt({ attachments: serializeEmailAttachments([{ filename: "a.pdf", content: Buffer.from("same bytes") }]) });
  assert.equal(result.sent, true); assert.equal(result.sends, 1);
  assert.equal(result.attachment?.toString(), "same bytes"); assert.equal(result.saved.status, "sent");
});

test("ambiguous provider exception is saved unknown without retrying in-process", async () => {
  let sends = 0;
  let status = "";
  const sent = await executeClaimedEmail(message, { allowed: () => true,
    send: async () => { sends++; throw new Error("secret provider diagnostic"); },
    save: async (_row, result) => { status = result.status; }, onSaveFailure: () => {} });
  assert.equal(sent, false); assert.equal(sends, 1); assert.equal(status, "unknown");
});

test("SMTP success with persistence failure never resends and still reports actual send to caller", async () => {
  let sends = 0, saveFailures = 0;
  const sent = await executeClaimedEmail(message, { allowed: () => true,
    send: async () => { sends++; return { status: "sent", code: null }; },
    save: async () => { throw new Error("database connection lost"); }, onSaveFailure: () => { saveFailures++; } });
  assert.equal(sent, true); assert.equal(sends, 1); assert.equal(saveFailures, 1);
});

test("legacy immediate and worker use one atomic durable claim; crashes are quarantined not requeued", () => {
  const source = readFileSync(new URL("../src/lib/email.ts", import.meta.url), "utf8");
  const index = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
  assert.match(source, /FOR UPDATE SKIP LOCKED/);
  assert.match(source, /status = 'processing', claim_token = \$1, claimed_at = NOW/);
  assert.match(source, /const claimed = await claimEmail\(queueId\)/);
  assert.match(source, /const item = await claimEmail\(\)/);
  assert.match(source, /status='unknown', delivery_error_code='EMAIL_CLAIM_STALE'/);
  assert.doesNotMatch(index, /UPDATE email_queue SET status = 'pending' WHERE status = 'processing'/);
  assert.match(source, /decryptConfig\(integration.config/);
  assert.match(source, /isEncrypted\(config.password\)/);
  assert.match(source, /v.status='approved' AND t.is_active=true/);
  assert.match(source, /validateStageEmailQueueItem\(item.id\)/);
  assert.match(source, /await processStageEmailOutbox\(\)/);
});
