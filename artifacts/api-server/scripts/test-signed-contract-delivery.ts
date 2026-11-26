/** Executes the real delivery sweep against an in-memory DB and mocked effects.
 * No database, socket, SMTP, storage, Chromium or notification side effects. */
import assert from "node:assert/strict";
import { after, beforeEach, mock, test } from "node:test";
import net from "node:net";
import { syncBuiltinESMExports } from "node:module";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { serializeEmailAttachments } from "../src/lib/emailDeliveryPolicy";

process.env.DATABASE_URL = "postgres://fixture:fixture@127.0.0.1:5433/fasos_apply_local";
process.env.NODE_ENV = "test";
process.env.EMAIL_DELIVERY_DISABLED = "true";
process.env.ALLOW_LIVE_INTEGRATIONS = "false";
mock.method(net.Socket.prototype, "connect", () => { throw new Error("NETWORK_FORBIDDEN_IN_CONTRACT_DELIVERY_TEST"); });
syncBuiltinESMExports();
const workspace = await import("@workspace/db");
const { db, pool, signedContractsTable, contractTemplatesTable, agentsTable, emailQueueTable } = workspace;
mock.method(pool, "connect", () => { throw new Error("DATABASE_FORBIDDEN_IN_CONTRACT_DELIVERY_TEST"); });
mock.method(pool, "query", () => { throw new Error("DATABASE_FORBIDDEN_IN_CONTRACT_DELIVERY_TEST"); });
const { deliverPendingSignedContracts } = await import("../src/lib/signedContractDelivery.js");
type Effects = import("../src/lib/signedContractDelivery.js").SignedContractDeliveryEffects;

const dialect = new PgDialect();
const validPdf = Buffer.from("%PDF-1.7\nSYNTHETIC TEST PDF\n%%EOF");
type Row = {
  id: number; signingSessionId: number; templateId: number; agentId: number | null;
  signerEmail: string; signerName: string; signedAt: Date; emailedAt: Date | null;
  deliveryClaimedAt: Date | null; pdfObjectKey: string | null; evidenceHash: string | null;
};
let rows: Row[];
let sendCalls: { key: string; pdf: Buffer }[];
let providerSends: number;
let queueState: "empty" | "sent" | "unknown" | "processing";
let failReceiptOnce: boolean;
let renderError: boolean;
let readError: boolean;
let pdfBytes: Buffer;
let noPdfAfterRender: boolean;
let notices: number;
let renders: number;
let beforeSend: (() => void | Promise<void>) | undefined;
let logs: unknown[][];
let templateName: string;
let builtEmails: number;
let receipt: {
  key: string; toEmail: string; status: string; sentAt: Date | null;
  attachments: ReturnType<typeof serializeEmailAttachments>;
} | null;

function storedReceipt(status: string) {
  return { key: "signed-contract:41:signer:v1", toEmail: "test@example.invalid", status, sentAt: status === "sent" ? new Date() : null,
    attachments: serializeEmailAttachments([{ filename: "original-template-name.pdf", content: validPdf, contentType: "application/pdf" }]) };
}

function match(row: Row, condition: SQL): boolean {
  const { sql, params } = dialect.sqlToQuery(condition);
  for (const field of ["id", "delivery_claimed_at"] as const) {
    const m = sql.match(new RegExp(`"${field}" = \\$(\\d+)`));
    if (m) {
      const actual = field === "id" ? row.id : row.deliveryClaimedAt;
      const expected = params[Number(m[1]) - 1];
      if (actual instanceof Date ? actual.toISOString() !== expected : actual !== expected) return false;
    }
  }
  if (sql.includes('"emailed_at" is null') && row.emailedAt !== null) return false;
  if (sql.includes('"emailed_at" is not null') && row.emailedAt === null) return false;
  if (sql.includes('"pdf_object_key" is null') && row.pdfObjectKey !== null) return false;
  const cutoff = sql.match(/"signed_at" > \$(\d+)/);
  if (cutoff && row.signedAt <= new Date(String(params[Number(cutoff[1]) - 1]))) return false;
  const lease = sql.match(/"delivery_claimed_at" < \$(\d+)/);
  if (lease && row.deliveryClaimedAt && row.deliveryClaimedAt >= new Date(String(params[Number(lease[1]) - 1]))) return false;
  return true;
}

mock.method(db, "select", () => ({ from: (table: unknown) => ({ where: (condition: SQL) => {
  const get = () => {
    if (table === contractTemplatesTable) return [{ name: templateName, language: "en" }];
    if (table === emailQueueTable) {
      const query = dialect.sqlToQuery(condition);
      assert.match(query.sql, /"email_queue"\."idempotency_key" = \$1/);
      return receipt && receipt.key === query.params[0] ? [receipt] : [];
    }
    return rows.filter(row => match(row, condition)).sort((a, b) => +a.signedAt - +b.signedAt);
  };
  const builder: any = {
    then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve().then(get).then(resolve, reject),
    orderBy: () => builder,
    limit: (n: number) => Promise.resolve(get().slice(0, n)),
  };
  return builder;
} }) }));
mock.method(db, "update", (table: unknown) => ({ set: (values: Partial<Row>) => ({ where: (condition: SQL) => {
  const perform = () => {
    if (table === agentsTable) return [];
    if (values.emailedAt && failReceiptOnce) { failReceiptOnce = false; throw new Error("SIMULATED_CRASH_AFTER_SMTP_RECEIPT"); }
    const selected = rows.filter(row => match(row, condition));
    selected.forEach(row => Object.assign(row, values));
    return selected.map(row => ({ id: row.id }));
  };
  return {
    returning: () => Promise.resolve().then(perform),
    then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve().then(perform).then(resolve, reject),
  };
} }) }));
mock.method(console, "log", (...args: unknown[]) => { logs.push(args); });
mock.method(console, "error", (...args: unknown[]) => { logs.push(args); });
mock.method(console, "warn", (...args: unknown[]) => { logs.push(args); });

const effects: Effects = {
  ensurePdf: async (id) => {
    renders++;
    if (renderError) throw new Error("SYNTHETIC_RENDER_FAILURE");
    const row = rows.find(r => r.id === id)!;
    if (!noPdfAfterRender) { row.pdfObjectKey ??= `/objects/signed-contracts/test-${id}.pdf`; row.evidenceHash ??= "a".repeat(64); }
    return { pdfObjectKey: row.pdfObjectKey!, evidenceHash: row.evidenceHash! };
  },
  readPdf: async () => { if (readError) throw new Error("SYNTHETIC_STORAGE_FAILURE"); return pdfBytes; },
  buildEmail: async () => { builtEmails++; return { subject: `TEST ${templateName}`, html: `<p>TEST ${templateName}</p>`, text: `TEST ${templateName}` }; },
  sendEmail: async (_to, _email, opts) => {
    assert.ok(opts?.idempotencyKey);
    assert.equal(opts.attachments?.length, 1);
    sendCalls.push({ key: opts.idempotencyKey, pdf: opts.attachments![0].content });
    await beforeSend?.();
    if (queueState === "sent") return true;
    if (queueState === "unknown" || queueState === "processing") return false;
    providerSends++;
    queueState = "sent";
    receipt = storedReceipt("sent");
    receipt.attachments = serializeEmailAttachments(opts.attachments);
    return true;
  },
  notify: async () => { notices++; return undefined as any; },
};

beforeEach(() => {
  rows = [{ id: 41, signingSessionId: 72, templateId: 4, agentId: null, signerEmail: "test@example.invalid", signerName: "TEST Agency",
    signedAt: new Date(), emailedAt: null, deliveryClaimedAt: null, pdfObjectKey: null, evidenceHash: null }];
  sendCalls = []; logs = []; providerSends = 0; queueState = "empty"; failReceiptOnce = false;
  renderError = false; readError = false; noPdfAfterRender = false; pdfBytes = validPdf;
  notices = 0; renders = 0; beforeSend = undefined;
  receipt = null; templateName = "TEST Agency Agreement"; builtEmails = 0;
});
after(() => mock.restoreAll());

test("real sweep delivers its stored PDF and marks delivered only after confirmed receipt", async () => {
  await deliverPendingSignedContracts(effects);
  assert.equal(providerSends, 1);
  assert.equal(sendCalls[0].key, "signed-contract:41:signer:v1");
  assert.deepEqual(sendCalls[0].pdf, validPdf);
  assert.ok(rows[0].emailedAt);
  assert.equal(rows[0].deliveryClaimedAt, null);
  assert.equal(notices, 1);
  await deliverPendingSignedContracts(effects);
  assert.equal(providerSends, 1);
});

test("renderer failure leaves signature delivery pending and sends nothing", async () => {
  renderError = true;
  await deliverPendingSignedContracts(effects);
  assert.equal(sendCalls.length, 0);
  assert.equal(rows[0].emailedAt, null);
  assert.equal(rows[0].deliveryClaimedAt, null);
});

for (const failure of ["unreadable", "missing", "invalid", "oversize"] as const) {
  test(`${failure} PDF cannot produce a completion email or delivery marker`, async () => {
    if (failure === "unreadable") readError = true;
    if (failure === "missing") noPdfAfterRender = true;
    if (failure === "invalid") pdfBytes = Buffer.from("not a PDF");
    if (failure === "oversize") pdfBytes = Buffer.alloc(10 * 1024 * 1024 + 1);
    await deliverPendingSignedContracts(effects);
    assert.equal(sendCalls.length, 0);
    assert.equal(rows[0].emailedAt, null);
    assert.equal(rows[0].deliveryClaimedAt, null);
  });
}

for (const state of ["unknown", "processing"] as const) {
  test(`${state} email receipt is neither marked delivered nor resent`, async () => {
    queueState = state;
    receipt = storedReceipt(state);
    await deliverPendingSignedContracts(effects);
    await deliverPendingSignedContracts(effects);
    assert.equal(rows[0].emailedAt, null);
    assert.equal(providerSends, 0);
    assert.equal(notices, 0);
    assert.equal(sendCalls.length, 0, "existing queue owner is not replaced or resent");
    queueState = "sent";
    receipt.status = "sent"; receipt.sentAt = new Date();
    await deliverPendingSignedContracts(effects);
    assert.ok(rows[0].emailedAt, "later confirmed durable receipt reconciles without resending");
    assert.equal(providerSends, 0);
  });
}

test("crash after SMTP acceptance reconciles the same durable message without duplicate delivery", async () => {
  failReceiptOnce = true;
  await deliverPendingSignedContracts(effects);
  assert.equal(providerSends, 1);
  assert.equal(rows[0].emailedAt, null);
  assert.equal(notices, 0);
  await deliverPendingSignedContracts(effects);
  assert.ok(rows[0].emailedAt);
  assert.equal(providerSends, 1);
  assert.equal(notices, 1);
  assert.equal(new Set(sendCalls.map(call => call.key)).size, 1);
});

test("branding and template changes after SMTP acceptance do not block the immutable delivery receipt", async () => {
  failReceiptOnce = true;
  await deliverPendingSignedContracts(effects);
  assert.equal(providerSends, 1);
  assert.equal(rows[0].emailedAt, null);
  templateName = "CHANGED brand and template";
  await deliverPendingSignedContracts(effects);
  assert.ok(rows[0].emailedAt);
  assert.equal(sendCalls.length, 1);
  assert.equal(builtEmails, 1, "do not rebuild mutable content for an already-queued contract");
  assert.equal(providerSends, 1);
});

test("pending receipt keeps its frozen payload until the queue worker confirms delivery", async () => {
  receipt = storedReceipt("pending");
  templateName = "CHANGED brand and template";
  await deliverPendingSignedContracts(effects);
  assert.equal(rows[0].emailedAt, null);
  assert.equal(builtEmails, 0); assert.equal(sendCalls.length, 0);
  receipt.status = "sent"; receipt.sentAt = new Date();
  await deliverPendingSignedContracts(effects);
  assert.ok(rows[0].emailedAt);
  assert.equal(providerSends, 0);
});

for (const mismatch of ["recipient", "pdf", "checksum", "missing", "multiple", "type", "missing-sent-at", "invalid-sent-at", "failed"] as const) {
  test(`existing receipt ${mismatch} fails closed without sending or marking delivered`, async () => {
    receipt = storedReceipt("sent");
    if (mismatch === "recipient") receipt.toEmail = "other@example.invalid";
    if (mismatch === "pdf") receipt.attachments = serializeEmailAttachments([{ filename: "other.pdf", content: Buffer.from("%PDF-1.7\nOTHER TEST PDF"), contentType: "application/pdf" }]);
    if (mismatch === "checksum") receipt.attachments![0].sha256 = "bad";
    if (mismatch === "missing") receipt.attachments = null;
    if (mismatch === "multiple") receipt.attachments!.push({ ...receipt.attachments![0] });
    if (mismatch === "type") receipt.attachments![0].contentType = "text/plain";
    if (mismatch === "missing-sent-at") receipt.sentAt = null;
    if (mismatch === "invalid-sent-at") receipt.sentAt = new Date("invalid");
    if (mismatch === "failed") receipt.status = "failed";
    await deliverPendingSignedContracts(effects);
    assert.equal(rows[0].emailedAt, null);
    assert.equal(rows[0].deliveryClaimedAt, null);
    assert.equal(sendCalls.length, 0); assert.equal(builtEmails, 0);
    assert.equal(notices, 0);
  });
}

test("simultaneous sweeps claim a single delivery", async () => {
  await Promise.all([deliverPendingSignedContracts(effects), deliverPendingSignedContracts(effects)]);
  assert.equal(providerSends, 1);
  assert.equal(sendCalls.length, 1);
  assert.equal(notices, 1);
});

test("a stale owner cannot clear or complete a replacement lease", async () => {
  const replacement = new Date(Date.now() + 30_000);
  beforeSend = () => { rows[0].deliveryClaimedAt = replacement; };
  await deliverPendingSignedContracts(effects);
  assert.equal(rows[0].emailedAt, null);
  assert.equal(rows[0].deliveryClaimedAt, replacement);
  assert.equal(notices, 0);
});

test("historical unemailed rows are not added to automatic email delivery", async () => {
  rows[0].signedAt = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000);
  await deliverPendingSignedContracts(effects);
  assert.equal(renders, 0);
  assert.equal(providerSends, 0);
  assert.equal(rows[0].emailedAt, null);
});

test("invalid signer mailbox cannot be marked delivered", async () => {
  rows[0].signerEmail = "first@example.invalid,second@example.invalid";
  await deliverPendingSignedContracts(effects);
  assert.equal(sendCalls.length, 0);
  assert.equal(rows[0].emailedAt, null);
});
