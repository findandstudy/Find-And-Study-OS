import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyPortalStatusFailure,
  MAX_PORTAL_STATUS_FAILURES,
  planPortalStatusRetry,
  planPortalStatusSuccess,
} from "@workspace/portal-runner";

test("status polling retry is deterministic, bounded and eventually suspended", () => {
  const now = new Date("2026-09-04T12:00:00.000Z");
  const first = planPortalStatusRetry({ submissionId: 41, failedAttempts: 1, now });
  const repeat = planPortalStatusRetry({ submissionId: 41, failedAttempts: 1, now });
  assert.deepEqual(first, repeat);
  assert.equal(first.suspended, false);
  assert.ok(first.nextCheckAt.getTime() >= now.getTime() + 60_000);
  assert.ok(first.nextCheckAt.getTime() <= now.getTime() + 75_000);

  const capped = planPortalStatusRetry({ submissionId: 41, failedAttempts: 20, now });
  assert.equal(capped.suspended, true);
  assert.ok(capped.nextCheckAt.getTime() <= now.getTime() + 7.5 * 60 * 60_000);

  const threshold = planPortalStatusRetry({
    submissionId: 41,
    failedAttempts: MAX_PORTAL_STATUS_FAILURES,
    now,
  });
  assert.equal(threshold.suspended, true);
});

test("invalid scheduler bounds fail closed", () => {
  assert.throws(
    () => planPortalStatusRetry({ submissionId: 0, failedAttempts: 1 }),
    /submissionId/,
  );
  assert.throws(
    () => planPortalStatusRetry({ submissionId: 1, failedAttempts: 0 }),
    /failedAttempts/,
  );
});

test("untrusted portal errors collapse to fixed PII-free categories", () => {
  assert.equal(
    classifyPortalStatusFailure(
      "Login failed for alice@example.com with password=supersecret at https://portal.test/auth?token=abc",
    ),
    "STATUS_CHECK_AUTHENTICATION",
  );
  assert.equal(classifyPortalStatusFailure(new Error("locator('#offer') timed out")), "STATUS_CHECK_TIMEOUT");
  assert.equal(classifyPortalStatusFailure("selector .decision no longer exists"), "STATUS_CHECK_PORTAL_DRIFT");
  assert.equal(classifyPortalStatusFailure("ECONNRESET socket closed"), "STATUS_CHECK_NETWORK");
  assert.equal(classifyPortalStatusFailure("PORTAL_STATUS_CHECK_LEASE_LOST"), "STATUS_CHECK_LEASE_LOST");
  assert.equal(classifyPortalStatusFailure("student name and arbitrary provider html"), "STATUS_CHECK_FAILED");
});

test("successful polling cadence is adaptive, deterministic and jittered", () => {
  const now = new Date("2026-09-04T00:00:00.000Z");
  const unknown = planPortalStatusSuccess({
    submissionId: 41,
    disposition: "UNKNOWN",
    now,
  });
  const review = planPortalStatusSuccess({
    submissionId: 41,
    disposition: "UNDER_REVIEW",
    now,
  });
  const waitlisted = planPortalStatusSuccess({
    submissionId: 41,
    disposition: "WAITLISTED",
    now,
  });
  assert.deepEqual(
    planPortalStatusSuccess({ submissionId: 41, disposition: "UNDER_REVIEW", now }),
    review,
  );
  assert.ok(unknown.getTime() > now.getTime() + 2 * 60 * 60_000);
  assert.ok(unknown.getTime() < now.getTime() + 2.4 * 60 * 60_000);
  assert.ok(review.getTime() > now.getTime() + 6 * 60 * 60_000);
  assert.ok(review.getTime() < now.getTime() + 7.2 * 60 * 60_000);
  assert.ok(waitlisted.getTime() > now.getTime() + 24 * 60 * 60_000);
  assert.ok(waitlisted.getTime() < now.getTime() + 28.8 * 60 * 60_000);
});
