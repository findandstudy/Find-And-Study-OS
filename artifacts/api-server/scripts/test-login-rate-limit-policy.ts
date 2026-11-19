import assert from "node:assert/strict";
import test from "node:test";
import {
  LOGIN_RATE_LIMIT_WINDOW_SECONDS,
  resolveLoginAttemptLimit,
} from "../src/lib/loginRateLimitPolicy";

test("login limiter allows ten failed attempts by default", () => {
  assert.equal(resolveLoginAttemptLimit(undefined), 10);
  assert.equal(LOGIN_RATE_LIMIT_WINDOW_SECONDS, 900);
});

test("login limiter accepts a bounded operator override", () => {
  assert.equal(resolveLoginAttemptLimit("12"), 12);
  assert.equal(resolveLoginAttemptLimit("2"), 5);
  assert.equal(resolveLoginAttemptLimit("100"), 20);
});

test("login limiter rejects invalid or unlimited-looking overrides", () => {
  assert.equal(resolveLoginAttemptLimit("0"), 5);
  assert.equal(resolveLoginAttemptLimit("unlimited"), 10);
  assert.equal(resolveLoginAttemptLimit("10.5"), 10);
});
