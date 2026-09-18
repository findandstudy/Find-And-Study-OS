import test from "node:test";
import assert from "node:assert/strict";
import { runInboxBulkBlock } from "../lib/inboxBulkBlock";
test("bulk block counts actual success, isolates denial, deduplicates and never retries", async () => {
  const attempted: number[] = [];
  const result = await runInboxBulkBlock([1, 2, 3, 2], async id => { attempted.push(id); if (id === 2) throw new Error("not authorized"); });
  assert.deepEqual(attempted, [1, 2, 3]);
  assert.deepEqual(result, { succeeded: 2, failed: [2] });
});
test("bulk requests have bounded concurrency", async () => {
  let active = 0;
  let peak = 0;
  const result = await runInboxBulkBlock(Array.from({ length: 13 }, (_, i) => i + 1), async () => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 1)); active--;
  });
  assert.equal(peak, 4);
  assert.equal(result.succeeded, 13);
});
test("empty and invalid selections cannot trigger external actions", async () => {
  const action = async () => assert.fail("unexpected action");
  assert.deepEqual(await runInboxBulkBlock([], action), { succeeded: 0, failed: [] });
  await assert.rejects(() => runInboxBulkBlock([-1], action));
  await assert.rejects(() => runInboxBulkBlock(Array.from({ length: 101 }, (_, i) => i + 1), action));
});
