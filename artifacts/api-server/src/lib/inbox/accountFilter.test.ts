import test from "node:test";
import assert from "node:assert/strict";
import { parseInboxAccountFilter } from "./accountFilter";
test("all, unlinked, and specific receiving account remain distinct", () => {
  assert.equal(parseInboxAccountFilter(undefined), null);
  assert.equal(parseInboxAccountFilter("0"), 0);
  assert.equal(parseInboxAccountFilter("42"), 42);
});
test("malformed, duplicate, negative and overflowing account IDs fail closed", () => {
  for (const value of [null, "", " ", "-1", "1.5", "1e3", "2147483648", "9007199254740993", ["1"], ["1", "2"], {}, "1 OR 1=1"]) {
    assert.throws(() => parseInboxAccountFilter(value));
  }
});
