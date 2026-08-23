import assert from "node:assert/strict";
import { test } from "node:test";

import { emuAdapter } from "./adapter.js";

test("EMU routing accepts only canonical names and rejects partial/blank names", () => {
  assert.equal(emuAdapter.matches("Eastern Mediterranean University"), true);
  assert.equal(emuAdapter.matches("Doğu Akdeniz Üniversitesi"), true);
  assert.equal(emuAdapter.matches("EMU"), true);
  assert.equal(emuAdapter.matches(""), false);
  assert.equal(emuAdapter.matches("em"), false);
  assert.equal(emuAdapter.matches("EMU Technical College"), false);
});

test("EMU submission fails closed until a verified live contract exists", async () => {
  await assert.rejects(
    emuAdapter.submit(
      {} as never,
      {} as never,
      {},
      false,
    ),
    /EMU_ADAPTER_NOT_PRODUCTION_READY/,
  );
});
