import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  classifyReviewPath,
  compareExpected,
  verifyAllowedReviewInfrastructurePaths,
  verifyTargetBase,
  verifyTargetBaseRef,
} from "./verify-convergence-review-manifest.mjs";

const repositoryRoot = new URL("../", import.meta.url);
const manifest = JSON.parse(
  readFileSync(
    new URL("../security/convergence-review-manifest.json", import.meta.url),
    "utf8",
  ),
);

test("sensitive convergence paths are assigned to explicit review groups", () => {
  assert.equal(
    classifyReviewPath(
      "lib/db/drizzle/0066_authorization_corridor_foundation.sql",
    ),
    "migration_data_authority",
  );
  assert.equal(
    classifyReviewPath("deploy/production-readonly-attestation.mjs"),
    "deployment_attestation",
  );
  assert.equal(
    classifyReviewPath(
      "artifacts/api-server/src/lib/studentJourneyAuthorization.ts",
    ),
    "student_journey",
  );
  assert.equal(
    classifyReviewPath(
      "artifacts/api-server/src/lib/postgresChangeSetCommandStore.ts",
    ),
    "control_plane_authorization",
  );
  assert.equal(
    classifyReviewPath("artifacts/api-server/src/routes/settings.ts"),
    "live_api_boundary",
  );
  assert.equal(
    classifyReviewPath("artifacts/edcons/src/hooks/use-auth.ts"),
    "frontend",
  );
  assert.equal(
    classifyReviewPath("security/tenant-writer-registry.json"),
    "security_inventory",
  );
  assert.equal(
    classifyReviewPath(".github/workflows/live-first-convergence.yml"),
    "ci_supply_chain",
  );
});

test("post-review changes accept only the frozen review-infrastructure allowlist", () => {
  assert.doesNotThrow(() =>
    verifyAllowedReviewInfrastructurePaths(
      [
        "security/convergence-review-manifest.json",
        "scripts/verify-convergence-review-manifest.mjs",
      ],
      manifest.allowedPostReviewPaths,
    ),
  );
  assert.throws(
    () =>
      verifyAllowedReviewInfrastructurePaths(
        ["artifacts/api-server/src/routes/settings.ts"],
        manifest.allowedPostReviewPaths,
      ),
    /unreviewed source changes/,
  );
});

test("expected evidence comparison is exact and fails closed on aggregate drift", () => {
  assert.doesNotThrow(() => compareExpected({ files: 181 }, { files: 181 }));
  assert.throws(
    () => compareExpected({ files: 182 }, { files: 181 }),
    /manifest drift/,
  );
});

test("the event target base must equal the frozen review base", () => {
  assert.equal(
    verifyTargetBase(manifest.baseCommit, manifest.baseCommit),
    manifest.baseCommit,
  );
  assert.throws(
    () => verifyTargetBase(manifest.reviewedThroughCommit, manifest.baseCommit),
    /target base drift/,
  );
});

test("the event target ref must equal the frozen review branch", () => {
  assert.equal(
    verifyTargetBaseRef(manifest.baseRef, manifest.baseRef),
    manifest.baseRef,
  );
  assert.throws(
    () => verifyTargetBaseRef("master", manifest.baseRef),
    /target base ref drift/,
  );
  assert.throws(
    () => verifyTargetBaseRef("refs/heads/../master", manifest.baseRef),
    /canonical Git branch name/,
  );
  assert.throws(
    () => verifyTargetBaseRef(".hidden", manifest.baseRef),
    /canonical Git branch name/,
  );
});

test("the frozen review groups reconcile to the exact reviewed file denominator", () => {
  const counts = Object.values(manifest.expected.groupCounts);
  assert.equal(
    counts.reduce((total, count) => total + count, 0),
    181,
  );
  assert.equal(manifest.expected.groupCounts.other, 0);
  assert.equal(manifest.expected.commitCount, 60);
  assert.equal(manifest.expected.patchSha256.length, 64);
});

test("the repository verifier reconstructs the pinned base-to-reviewed patch", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/verify-convergence-review-manifest.mjs"],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        CONVERGENCE_REVIEW_REQUIRE_CLEAN: "0",
        CONVERGENCE_REVIEW_REQUIRE_TARGET_BASE: "1",
        CONVERGENCE_REVIEW_TARGET_BASE: manifest.baseCommit,
        CONVERGENCE_REVIEW_TARGET_BASE_REF: manifest.baseRef,
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\[convergence-review\] PASS/);
  assert.match(result.stdout, /"fileCount":181/);
  const payload = JSON.parse(
    result.stdout.replace(/^\[convergence-review\] PASS /, ""),
  );
  assert.equal(payload.reviewedThroughCommit, manifest.reviewedThroughCommit);
  assert.equal(payload.targetBase, manifest.baseCommit);
  assert.equal(payload.targetBaseRef, manifest.baseRef);
  assert.equal(
    payload.postReviewPaths.every((file) =>
      manifest.allowedPostReviewPaths.includes(file),
    ),
    true,
  );
});

test("required target-base evidence cannot be omitted", () => {
  const env = {
    ...process.env,
    CONVERGENCE_REVIEW_REQUIRE_CLEAN: "0",
    CONVERGENCE_REVIEW_REQUIRE_TARGET_BASE: "1",
  };
  delete env.CONVERGENCE_REVIEW_TARGET_BASE;
  const result = spawnSync(
    process.execPath,
    ["scripts/verify-convergence-review-manifest.mjs"],
    { cwd: repositoryRoot, encoding: "utf8", env },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /target base commit and ref are required/);
});

test("required target-base ref evidence cannot be omitted", () => {
  const env = {
    ...process.env,
    CONVERGENCE_REVIEW_REQUIRE_CLEAN: "0",
    CONVERGENCE_REVIEW_REQUIRE_TARGET_BASE: "1",
    CONVERGENCE_REVIEW_TARGET_BASE: manifest.baseCommit,
  };
  delete env.CONVERGENCE_REVIEW_TARGET_BASE_REF;
  const result = spawnSync(
    process.execPath,
    ["scripts/verify-convergence-review-manifest.mjs"],
    { cwd: repositoryRoot, encoding: "utf8", env },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /target base commit and ref are required/);
});
