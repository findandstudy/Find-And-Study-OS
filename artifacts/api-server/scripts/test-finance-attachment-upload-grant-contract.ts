import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/routes/finance.ts", import.meta.url), "utf8");
const start = source.indexOf('router.post("/financial-transactions"');
const end = source.indexOf('router.', start + 20);
const boundary = source.slice(start, end > start ? end : undefined);

test("finance attachments are owner-bound and checked from stored bytes", () => {
  assert.match(source, /callerOwnsObject\(actorUserId, fileUrl\)/);
  assert.match(source, /await file\.getMetadata\(\)/);
  assert.match(source, /await file\.download\(\)/);
  assert.match(source, /bytes\.length > 10 \* 1024 \* 1024/);
  assert.match(source, /validateUploadedFileBuffer\(`receipt\.\$\{extension\}`, contentType, bytes\)/);
});
test("finance attachment grant is consumed inside the idempotent mutation transaction", () => {
  const transactionAt = boundary.indexOf("await db.transaction(async (databaseTx) =>");
  const replayAt = boundary.indexOf("if (mutation.replay)");
  const consumeAt = boundary.indexOf("consumeFinalizedUploadGrantInDrizzle(databaseTx,");
  const insertAt = boundary.indexOf("databaseTx.insert(financialTransactionsTable)");
  const receiptAt = boundary.indexOf("persistFinanceMutation(databaseTx");
  assert.ok(transactionAt >= 0 && replayAt > transactionAt && consumeAt > replayAt);
  assert.ok(insertAt > consumeAt && receiptAt > insertAt);
  assert.match(boundary, /Finance attachment is not finalized or has already been used/);
});
