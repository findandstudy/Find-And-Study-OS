/** Read-only status projection, synthetic DB rows; network and real DB forbidden. */
import assert from "node:assert/strict";
import { after, beforeEach, mock, test } from "node:test";
import net from "node:net";
process.env.DATABASE_URL = "postgres://test@127.0.0.1:1/fas_contract_status_test";
process.env.NODE_ENV = "test";
mock.method(net.Socket.prototype, "connect", () => { throw new Error("NETWORK_FORBIDDEN"); });
const { pool } = await import("@workspace/db");
const { readContractDeliveryStatus: readStatus } = await import("../src/lib/contractDeliveryStatus");
const pdfBytes = Buffer.from("%PDF-1.7 TEST ONLY");
let storedPdf = pdfBytes;
const readContractDeliveryStatus = (session: number, agent?: number) => readStatus(session, agent, async () => storedPdf);
const { serializeEmailAttachments } = await import("../src/lib/emailDeliveryPolicy");
let row: any;
let unavailable = false;
let reads = 0;
mock.method(pool, "connect", () => { throw new Error("DATABASE_FORBIDDEN"); });
mock.method(pool, "query", async (sql: string, args: any[]) => {
  reads++;
  assert.match(sql, /q\.idempotency_key=\('signed-contract:'\|\|sc.id::text\|\|':signer:v1'\)/);
  assert.match(sql, /q.to_email=sc.signer_email/);
  assert.match(sql, /ss.status='signed' AND ss.revoked_at IS NULL/);
  assert.match(sql, /sc.agent_id=\$2/);
  assert.doesNotMatch(sql, /UPDATE|INSERT|DELETE|emailed_at/i);
  if (unavailable) throw new Error("TEST DB unavailable");
  return { rows: row && args[0] === 72 && (args[1] === null || args[1] === 7) ? [row] : [] };
});
beforeEach(() => {
  unavailable = false; reads = 0; storedPdf = pdfBytes;
  row = { id: 8, status: "sent", sent_at: new Date("2026-11-25T12:00:00Z"), provider_message_id: "<fas-email-8@example.invalid>",
    attachments: serializeEmailAttachments([{ filename: "TEST.pdf", content: Buffer.from("%PDF-1.7 TEST ONLY"), contentType: "application/pdf" }]),
    pdf_object_key: "/objects/signed-contracts/TEST.pdf", evidence_hash: "a".repeat(64) };
});
after(async () => { await pool.end(); mock.restoreAll(); });
test("authorized own and token-resolved status projects only the durable mail receipt", async () => {
  assert.equal((await readContractDeliveryStatus(72, 7)).state, "sent");
  assert.equal((await readContractDeliveryStatus(72)).state, "sent");
  assert.deepEqual(Object.keys(await readContractDeliveryStatus(72, 7)).sort(), ["acceptedAt", "state"]);
  assert.equal((await readContractDeliveryStatus(72, 8)).state, "unconfirmed");
  assert.equal((await readContractDeliveryStatus(73, 7)).state, "unconfirmed");
});
test("pending, processing and uncertain outcomes never claim sent", async () => {
  for (const status of ["pending", "processing", "unknown", "blocked", "failed"]) {
    row.status = status;
    const summary = await readContractDeliveryStatus(72, 7);
    assert.equal(summary.state, ["pending", "processing"].includes(status) ? "pending" : "attention");
    assert.equal(summary.acceptedAt, null);
  }
});
test("missing, corrupt or unrelated PDF/receipt data stays unconfirmed", async () => {
  for (const patch of [{ attachments: null }, { provider_message_id: null }, { provider_message_id: "<fas-email-9@example.invalid>" },
    { sent_at: "invalid" }, { pdf_object_key: null }, { evidence_hash: null }]) {
    const original = row; row = { ...row, ...patch };
    assert.equal((await readContractDeliveryStatus(72, 7)).state, "unconfirmed"); row = original;
  }
  storedPdf = Buffer.from("%PDF-1.7 OTHER VALID TEST PDF");
  assert.equal((await readContractDeliveryStatus(72, 7)).state, "unconfirmed");
  storedPdf = pdfBytes;
  assert.equal((await readStatus(72, 7, async () => { throw new Error("TEST STORAGE unavailable"); })).state, "unconfirmed");
  row.attachments[0].sha256 = "changed";
  assert.equal((await readContractDeliveryStatus(72, 7)).state, "unconfirmed");
  row = null; assert.equal((await readContractDeliveryStatus(72, 7)).state, "unconfirmed");
  unavailable = true; assert.equal((await readContractDeliveryStatus(72, 7)).state, "unconfirmed");
});
test("invalid ownership input never reads the queue", async () => {
  for (const [session, agent] of [[0, 7], [72, 0], [NaN, 7], [72, -1]]) {
    assert.equal((await readContractDeliveryStatus(session, agent)).state, "unconfirmed");
  }
  assert.equal(reads, 0);
});
