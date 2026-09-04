import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseUniversityApplicationId,
  parseVerifiedApplicationNumber,
  planUniversityApplicationIdSync,
} from "../src/applicationReference.js";

const verified = (value: string) => ({
  value,
  source: "matched_application_row" as const,
  sourceLabel: "Applied Program Number",
  identityBound: true as const,
  targetBound: true as const,
  uniqueMatch: true as const,
});

test("normalizes manual university application IDs and supports clearing", () => {
  assert.deepEqual(parseUniversityApplicationId("  ABC-123/2026  "), {
    ok: true,
    value: "ABC-123/2026",
  });
  assert.deepEqual(parseUniversityApplicationId("   "), { ok: true, value: null });
  assert.deepEqual(parseUniversityApplicationId(null), { ok: true, value: null });
});

test("rejects non-string, oversized, and control-character values", () => {
  assert.equal(parseUniversityApplicationId(123).ok, false);
  assert.equal(parseUniversityApplicationId("x".repeat(129)).ok, false);
  assert.equal(parseUniversityApplicationId("ABC\n123").ok, false);
});

test("automation fills empty values but preserves conflicts", () => {
  assert.deepEqual(planUniversityApplicationIdSync(null, verified(" UNI-42 ")), {
    action: "set",
    value: "UNI-42",
  });
  assert.deepEqual(planUniversityApplicationIdSync("UNI-42", verified("UNI-42")), {
    action: "skip",
  });
  assert.deepEqual(planUniversityApplicationIdSync("MANUAL-9", verified("PORTAL-10")), {
    action: "conflict",
    current: "MANUAL-9",
    incoming: "PORTAL-10",
  });
});

test("never promotes an unproved locator or URL id", () => {
  assert.deepEqual(planUniversityApplicationIdSync(null, "internal-route-42"), {
    action: "skip",
  });
  assert.equal(parseVerifiedApplicationNumber({
    ...verified("APP-42"),
    source: "success_url",
  }).ok, false);
  assert.equal(parseVerifiedApplicationNumber({
    ...verified("APP-42"),
    targetBound: false,
  }).ok, false);
});
