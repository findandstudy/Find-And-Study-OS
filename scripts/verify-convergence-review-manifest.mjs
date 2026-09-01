import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_MANIFEST = path.join(
  REPOSITORY_ROOT,
  "security",
  "convergence-review-manifest.json",
);

const REVIEW_GROUPS = [
  "migration_data_authority",
  "deployment_attestation",
  "student_journey",
  "control_plane_authorization",
  "live_api_boundary",
  "frontend",
  "security_inventory",
  "ci_supply_chain",
  "tests",
  "documentation",
  "other",
];

function normalizePath(value) {
  return value.replaceAll("\\", "/");
}

function canonicalRepositoryPath(value, field) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 512 ||
    value.startsWith("/") ||
    value.endsWith("/") ||
    value.includes("//") ||
    value.includes(":") ||
    value.includes("\0")
  ) {
    throw new Error(`${field} must be a canonical repository-relative path`);
  }
  const normalized = normalizePath(value);
  if (
    normalized !== value ||
    normalized.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    throw new Error(`${field} must be a canonical repository-relative path`);
  }
  return normalized;
}

function runGit(args, options = {}) {
  const result = spawnSync("git", args, {
    cwd: REPOSITORY_ROOT,
    encoding: options.buffer ? null : "utf8",
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    maxBuffer: 128 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const stderr = Buffer.isBuffer(result.stderr)
      ? result.stderr.toString("utf8")
      : result.stderr;
    throw new Error(`git ${args.join(" ")} failed: ${String(stderr).trim()}`);
  }
  return result.stdout;
}

function exactCommit(value, field) {
  if (typeof value !== "string" || !/^[0-9a-f]{40}$/.test(value)) {
    throw new Error(`${field} must be a lowercase 40-character commit id`);
  }
  const resolved = String(
    runGit(["rev-parse", "--verify", `${value}^{commit}`]),
  ).trim();
  if (resolved !== value) throw new Error(`${field} does not resolve exactly`);
  return value;
}

export function verifyTargetBase(targetBaseInput, expectedBaseCommit) {
  const targetBase = exactCommit(targetBaseInput, "targetBase");
  if (targetBase !== expectedBaseCommit) {
    throw new Error(
      `target base drift: expected ${expectedBaseCommit}, received ${targetBase}`,
    );
  }
  return targetBase;
}

export function verifyTargetBaseRef(targetBaseRefInput, expectedBaseRef) {
  if (
    typeof targetBaseRefInput !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$/.test(targetBaseRefInput) ||
    targetBaseRefInput.includes("..") ||
    targetBaseRefInput.includes("//") ||
    targetBaseRefInput.includes("@{") ||
    targetBaseRefInput.endsWith("/") ||
    targetBaseRefInput.endsWith(".") ||
    targetBaseRefInput.endsWith(".lock")
  ) {
    throw new Error("targetBaseRef must be a canonical Git branch name");
  }
  try {
    const checked = String(
      runGit(["check-ref-format", "--branch", targetBaseRefInput]),
    ).trim();
    if (checked !== targetBaseRefInput) {
      throw new Error("Git normalized the target branch name");
    }
  } catch {
    throw new Error("targetBaseRef must be a canonical Git branch name");
  }
  if (targetBaseRefInput !== expectedBaseRef) {
    throw new Error(
      `target base ref drift: expected ${expectedBaseRef}, received ${targetBaseRefInput}`,
    );
  }
  return targetBaseRefInput;
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export function classifyReviewPath(rawPath) {
  const file = normalizePath(rawPath);

  if (file.startsWith("lib/db/")) return "migration_data_authority";
  if (file.startsWith("deploy/")) return "deployment_attestation";
  if (
    /student[-_]?(?:journey|document|privacy)/i.test(file) ||
    file === "artifacts/api-server/src/routes/students.ts" ||
    file === "artifacts/edcons/src/pages/student/Dashboard.tsx"
  ) {
    return "student_journey";
  }
  if (
    /(?:active[-_]?context|active[-_]?tenant|change[-_]?set|control[-_]?plane|impersonation|session[-_]?lifetime|legacy[-_]?user[-_]?management)/i.test(
      file,
    ) ||
    file === "artifacts/api-server/src/lib/permissions.ts" ||
    file === "artifacts/api-server/src/lib/replitAuth.ts" ||
    file === "artifacts/api-server/src/middlewares/authMiddleware.ts"
  ) {
    return "control_plane_authorization";
  }
  if (file.startsWith("artifacts/api-server/src/")) return "live_api_boundary";
  if (file.startsWith("artifacts/edcons/")) return "frontend";
  if (
    file.startsWith("security/") ||
    file === "scripts/audit-legacy-role-gates.mjs" ||
    file === "scripts/audit-tenant-writers.mjs" ||
    file === "scripts/test-convergence-review-manifest.mjs" ||
    file === "scripts/verify-convergence-review-manifest.mjs"
  ) {
    return "security_inventory";
  }
  if (
    file.startsWith(".github/") ||
    file === ".env.example" ||
    file === "package.json" ||
    file === "pnpm-lock.yaml" ||
    file === "pnpm-workspace.yaml" ||
    file === "artifacts/api-server/package.json" ||
    file === "scripts/enforce-pnpm.cjs" ||
    file === "scripts/test-enforce-pnpm.cjs"
  ) {
    return "ci_supply_chain";
  }
  if (file.startsWith("artifacts/api-server/scripts/")) return "tests";
  if (file.startsWith("docs/")) return "documentation";
  return "other";
}

function parseNullSeparated(value) {
  return String(value).split("\0").filter(Boolean);
}

function diffStats(baseCommit, reviewedThroughCommit) {
  const records = parseNullSeparated(
    runGit([
      "diff",
      "--numstat",
      "-z",
      `${baseCommit}..${reviewedThroughCommit}`,
    ]),
  );
  let insertions = 0;
  let deletions = 0;
  for (const record of records) {
    const [added, removed] = record.split("\t", 3);
    if (added === "-" || removed === "-") {
      throw new Error(
        "binary files require an explicit review-manifest policy",
      );
    }
    insertions += Number.parseInt(added, 10);
    deletions += Number.parseInt(removed, 10);
  }
  return { fileCount: records.length, insertions, deletions };
}

function groupPaths(paths) {
  const groups = Object.fromEntries(REVIEW_GROUPS.map((group) => [group, []]));
  for (const file of paths) groups[classifyReviewPath(file)].push(file);
  return Object.fromEntries(
    REVIEW_GROUPS.map((group) => [group, groups[group].sort()]),
  );
}

export function verifyAllowedReviewInfrastructurePaths(
  changedPaths,
  allowedPaths,
) {
  const allowed = new Set(allowedPaths.map(normalizePath));
  const unexpected = changedPaths
    .map(normalizePath)
    .filter((file) => !allowed.has(file))
    .sort();
  if (unexpected.length > 0) {
    throw new Error(
      `unreviewed source changes after reviewedThroughCommit: ${unexpected.join(", ")}`,
    );
  }
}

export function compareExpected(actual, expected, field = "manifest") {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(
      `${field} drift: expected ${expectedJson}, received ${actualJson}`,
    );
  }
}

export function verifyPinnedPostReviewInfrastructure(
  sourceHeadInput,
  pinnedPathsInput,
  allowedPathsInput,
) {
  const sourceHead = exactCommit(sourceHeadInput, "sourceHead");
  if (
    !pinnedPathsInput ||
    typeof pinnedPathsInput !== "object" ||
    Array.isArray(pinnedPathsInput)
  ) {
    throw new Error("post-review pinned paths must be an object");
  }
  if (!Array.isArray(allowedPathsInput)) {
    throw new Error("allowed post-review paths must be an array");
  }
  const manifestPath = "security/convergence-review-manifest.json";
  const expectedPaths = allowedPathsInput
    .map((file, index) =>
      canonicalRepositoryPath(file, `allowedPostReviewPaths[${index}]`),
    )
    .filter((file) => file !== manifestPath)
    .sort();
  const pinnedPaths = Object.keys(pinnedPathsInput)
    .map((file, index) =>
      canonicalRepositoryPath(file, `pinnedPaths[${index}]`),
    )
    .sort();
  compareExpected(
    pinnedPaths,
    expectedPaths,
    "post-review pinned-path denominator",
  );
  const observed = {};
  for (const file of expectedPaths) {
    const expectedBlob = pinnedPathsInput[file];
    if (
      typeof expectedBlob !== "string" ||
      !/^[0-9a-f]{40}$/.test(expectedBlob)
    ) {
      throw new Error(
        `post-review blob for ${file} must be a lowercase Git id`,
      );
    }
    const actualBlob = String(
      runGit(["rev-parse", "--verify", `${sourceHead}:${file}`]),
    ).trim();
    if (!/^[0-9a-f]{40}$/.test(actualBlob)) {
      throw new Error(
        `post-review path ${file} did not resolve to a Git object`,
      );
    }
    const objectType = String(runGit(["cat-file", "-t", actualBlob])).trim();
    if (objectType !== "blob") {
      throw new Error(`post-review path ${file} must resolve to a blob`);
    }
    if (actualBlob !== expectedBlob) {
      throw new Error(
        `post-review infrastructure blob drift for ${file}: expected ${expectedBlob}, received ${actualBlob}`,
      );
    }
    observed[file] = actualBlob;
  }
  return observed;
}

export function buildReviewObservation(baseCommitInput, reviewedCommitInput) {
  const baseCommit = exactCommit(baseCommitInput, "baseCommit");
  const reviewedThroughCommit = exactCommit(
    reviewedCommitInput,
    "reviewedThroughCommit",
  );
  const mergeBase = String(
    runGit(["merge-base", baseCommit, reviewedThroughCommit]),
  ).trim();
  if (mergeBase !== baseCommit) {
    throw new Error("baseCommit must be the exact ancestor/merge base");
  }
  const reviewedTree = String(
    runGit(["rev-parse", `${reviewedThroughCommit}^{tree}`]),
  ).trim();
  const commitCount = Number.parseInt(
    String(
      runGit([
        "rev-list",
        "--count",
        `${baseCommit}..${reviewedThroughCommit}`,
      ]),
    ).trim(),
    10,
  );
  const paths = parseNullSeparated(
    runGit([
      "diff",
      "--name-only",
      "-z",
      `${baseCommit}..${reviewedThroughCommit}`,
    ]),
  )
    .map(normalizePath)
    .sort();
  const groups = groupPaths(paths);
  const groupCounts = Object.fromEntries(
    REVIEW_GROUPS.map((group) => [group, groups[group].length]),
  );
  const patch = runGit(
    [
      "diff",
      "--binary",
      "--full-index",
      "--no-ext-diff",
      `${baseCommit}..${reviewedThroughCommit}`,
    ],
    { buffer: true },
  );
  return {
    baseCommit,
    reviewedThroughCommit,
    reviewedTree,
    patchSha256: sha256(patch),
    commitCount,
    ...diffStats(baseCommit, reviewedThroughCommit),
    groupCounts,
    groups,
  };
}

function verifyManifest(manifest, sourceHeadInput) {
  if (manifest.schemaVersion !== 1)
    throw new Error("unsupported manifest schema");
  const observation = buildReviewObservation(
    manifest.baseCommit,
    manifest.reviewedThroughCommit,
  );
  compareExpected(
    {
      reviewedTree: observation.reviewedTree,
      patchSha256: observation.patchSha256,
      commitCount: observation.commitCount,
      fileCount: observation.fileCount,
      insertions: observation.insertions,
      deletions: observation.deletions,
      groupCounts: observation.groupCounts,
    },
    manifest.expected,
    "reviewed diff",
  );
  const requireTargetBaseValue =
    process.env.CONVERGENCE_REVIEW_REQUIRE_TARGET_BASE;
  if (
    requireTargetBaseValue !== undefined &&
    requireTargetBaseValue !== "0" &&
    requireTargetBaseValue !== "1"
  ) {
    throw new Error(
      "CONVERGENCE_REVIEW_REQUIRE_TARGET_BASE must be exactly 0 or 1",
    );
  }
  const targetBaseInput = process.env.CONVERGENCE_REVIEW_TARGET_BASE;
  const targetBaseRefInput = process.env.CONVERGENCE_REVIEW_TARGET_BASE_REF;
  if (
    requireTargetBaseValue === "1" &&
    (!targetBaseInput || !targetBaseRefInput)
  ) {
    throw new Error(
      "target base commit and ref are required for review verification",
    );
  }
  const targetBase = targetBaseInput
    ? verifyTargetBase(targetBaseInput, observation.baseCommit)
    : null;
  const targetBaseRef = targetBaseRefInput
    ? verifyTargetBaseRef(targetBaseRefInput, manifest.baseRef)
    : null;
  const sourceHead = exactCommit(sourceHeadInput, "sourceHead");
  const ancestor = spawnSync(
    "git",
    ["merge-base", "--is-ancestor", manifest.reviewedThroughCommit, sourceHead],
    {
      cwd: REPOSITORY_ROOT,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    },
  );
  if (ancestor.status !== 0) {
    throw new Error("sourceHead does not descend from reviewedThroughCommit");
  }
  const postReviewPaths = parseNullSeparated(
    runGit([
      "diff",
      "--name-only",
      "-z",
      `${manifest.reviewedThroughCommit}..${sourceHead}`,
    ]),
  );
  verifyAllowedReviewInfrastructurePaths(
    postReviewPaths,
    manifest.allowedPostReviewPaths,
  );
  const pinnedPostReviewInfrastructure = verifyPinnedPostReviewInfrastructure(
    sourceHead,
    manifest.postReviewInfrastructure?.pinnedPaths,
    manifest.allowedPostReviewPaths,
  );
  if (process.env.CONVERGENCE_REVIEW_REQUIRE_CLEAN === "1") {
    const status = String(runGit(["status", "--porcelain=v1"]));
    if (status !== "")
      throw new Error("review verification requires a clean worktree");
  }
  return {
    sourceHead,
    targetBase,
    targetBaseRef,
    reviewedThroughCommit: observation.reviewedThroughCommit,
    reviewedTree: observation.reviewedTree,
    patchSha256: observation.patchSha256,
    commitCount: observation.commitCount,
    fileCount: observation.fileCount,
    insertions: observation.insertions,
    deletions: observation.deletions,
    groupCounts: observation.groupCounts,
    postReviewPaths: postReviewPaths.map(normalizePath).sort(),
    pinnedPostReviewInfrastructure,
  };
}

function readManifest(manifestPath) {
  const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("review manifest must be an object");
  }
  return parsed;
}

function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--report") {
    if (args.length !== 3) {
      throw new Error(
        "usage: --report <base-commit> <reviewed-through-commit>",
      );
    }
    process.stdout.write(
      `${JSON.stringify(buildReviewObservation(args[1], args[2]), null, 2)}\n`,
    );
    return;
  }
  const manifestPath = args[0]
    ? path.resolve(REPOSITORY_ROOT, args[0])
    : DEFAULT_MANIFEST;
  const manifest = readManifest(manifestPath);
  const sourceHead =
    process.env.CONVERGENCE_REVIEW_SOURCE_HEAD ||
    String(runGit(["rev-parse", "HEAD"])).trim();
  const result = verifyManifest(manifest, sourceHead);
  process.stdout.write(`[convergence-review] PASS ${JSON.stringify(result)}\n`);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `[convergence-review] FAIL ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
