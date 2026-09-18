import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJson } from "../src/lib/jsonCanonical.js";

test("canonicalJson ignores nested object-key order", () => {
  const fromFile = {
    meta: { key: "okan", experimental: true },
    steps: [{ action: "navigate", options: { b: 2, a: 1 } }],
  };
  const fromJsonb = {
    steps: [{ options: { a: 1, b: 2 }, action: "navigate" }],
    meta: { experimental: true, key: "okan" },
  };
  assert.equal(canonicalJson(fromFile), canonicalJson(fromJsonb));
});

test("canonicalJson still detects a material spec change", () => {
  assert.notEqual(
    canonicalJson({ enabled: false, selector: "#old" }),
    canonicalJson({ enabled: false, selector: "#new" }),
  );
});

test("canonicalJson sorts Unicode keys by deterministic UTF-16 code units", () => {
  const firstSupplementaryCodePoint = "\u{10000}";
  const grinningFace = "\u{1F600}";
  const privateUseBmp = "\uE000";
  const values = {
    [privateUseBmp]: 7,
    [grinningFace]: 6,
    [firstSupplementaryCodePoint]: 5,
    "\u4E2D": 4,
    "\u00E9": 3,
    a: 2,
    Z: 1,
  };

  assert.equal(
    canonicalJson(values),
    `{${JSON.stringify("Z")}:1,${JSON.stringify("a")}:2,${JSON.stringify("\u00E9")}:3,${JSON.stringify("\u4E2D")}:4,${JSON.stringify(firstSupplementaryCodePoint)}:5,${JSON.stringify(grinningFace)}:6,${JSON.stringify(privateUseBmp)}:7}`,
  );
  assert.equal(
    canonicalJson(values),
    canonicalJson(Object.fromEntries(Object.entries(values).reverse())),
  );
});
