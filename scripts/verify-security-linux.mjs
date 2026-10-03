/**
 * Local-only gate. On an already provisioned, disposable Linux checkout run:
 *   node scripts/verify-security-linux.mjs
 * Requires the installed locked dependencies and pdftoppm or gs. It never
 * installs packages, starts services, contacts a DB, or deploys anything.
 * This is fixture/runtime evidence, NOT production or OS network-isolation proof.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const gateFile = fileURLToPath(import.meta.url);
const checkoutRoot = path.dirname(path.dirname(gateFile));
const CHILD_TIMEOUT_MS = 90_000;
const OUTPUT_LIMIT_BYTES = 256 * 1024;
const FIXTURE_PREFIX = "fas-security-linux-";
const API = "artifacts/api-server";
const suites = Object.freeze([
  ["test-security-dependency-runtime.ts", 4],
  ["test-local-upload-publication.ts", 26],
  ["test-student-photo-thumbnail.ts", 9],
  ["test-student-photo-thumbnail-limits.ts", 11],
  ["test-document-bytes-bounded-source.ts", 11],
].map(([file, minimumTests]) => Object.freeze({ file, minimumTests })));
const sourceFiles = Object.freeze([
  "package.json", "pnpm-lock.yaml", `${API}/package.json`, "lib/portal-runner/package.json",
  "scripts/verify-security-linux.mjs",
  ...suites.map(({ file }) => `${API}/scripts/${file}`),
  ...["localUploadPublication.ts", "studentPhotoThumbnail.ts", "studentPhotoThumbnailAdmission.ts",
    "documentBytes.ts", "documentByteLimits.ts", "objectStorage.ts", "uploads/processUpload.ts"]
    .map(file => `${API}/src/lib/${file}`),
]);

export class LinuxGateError extends Error {
  constructor(code) { super(code); this.name = "LinuxGateError"; this.code = code; }
}
const reject = code => { throw new LinuxGateError(code); };
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

export function assertLinux(platform) {
  if (platform !== "linux") reject("LINUX_RUNTIME_REQUIRED");
}

// No inherited environment: drops DATABASE_URL, provider credentials, proxy,
// LD_PRELOAD, NODE_OPTIONS, NODE_PATH, custom loaders, and cloud credential paths.
export function childEnvironment(fixtureRoot) {
  if (!path.isAbsolute(fixtureRoot)) reject("ABSOLUTE_FIXTURE_ROOT_REQUIRED");
  return {
    PATH: "/usr/local/bin:/usr/bin:/bin", HOME: fixtureRoot, TMPDIR: fixtureRoot,
    LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC", NODE_ENV: "test",
    ALLOW_LIVE_INTEGRATIONS: "false", ENABLE_BACKGROUND_JOBS: "false",
    STORAGE_DRIVER: "local", STORAGE_LOCAL_DIR: path.join(fixtureRoot, "storage"),
    TSX_DISABLE_CACHE: "1", UV_THREADPOOL_SIZE: "2",
  };
}

// There is no caller-supplied command, shell, test pattern, loader or test list.
export function createPlan(repoRoot, nodeExecutable, fixtureRoot) {
  if (![repoRoot, nodeExecutable, fixtureRoot].every(value => path.isAbsolute(value))) {
    reject("ABSOLUTE_PATHS_REQUIRED");
  }
  const cwd = path.join(repoRoot, API);
  const common = { executable: nodeExecutable, cwd, env: childEnvironment(fixtureRoot), timeoutMs: CHILD_TIMEOUT_MS };
  return [
    { ...common, kind: "runtime", name: "runtime", args: [path.join(repoRoot, "scripts/verify-security-linux.mjs"), "--runtime-probe"] },
    ...suites.map(suite => ({
      ...common, kind: "suite", name: suite.file, minimumTests: suite.minimumTests,
      args: ["--import", "tsx", "--test", "--test-reporter=tap", "--test-concurrency=1",
        "--test-timeout=60000", `./scripts/${suite.file}`],
    })),
  ];
}

export function parseTap(stdout, minimumTests) {
  if (typeof stdout !== "string" || Buffer.byteLength(stdout) > OUTPUT_LIMIT_BYTES) reject("INVALID_TEST_OUTPUT");
  if (/^\s*(?:Bail out!|not ok\b)/mi.test(stdout)) reject("TEST_FAILURE");
  if (/^\s*(?:not )?ok\b[^\n]*#\s*(?:SKIP|TODO)\b/im.test(stdout)) reject("SKIPPED_OR_TODO_ASSERTION");
  const lines = stdout.split(/\r?\n/);
  const number = key => {
    const matches = lines.filter(line => new RegExp(`^# ${key} [0-9]+$`).test(line));
    if (matches.length !== 1) reject("INCOMPLETE_TEST_SUMMARY");
    const value = Number(matches[0].split(" ").at(-1));
    if (!Number.isSafeInteger(value)) reject("INVALID_TEST_SUMMARY");
    return value;
  };
  const counts = Object.fromEntries(["tests", "suites", "pass", "fail", "cancelled", "skipped", "todo"].map(key => [key, number(key)]));
  const plans = lines.filter(line => /^1\.\.[0-9]+$/.test(line));
  const successes = lines.filter(line => /^ok [0-9]+ - /.test(line));
  if (lines.filter(line => line === "TAP version 13").length !== 1 || plans.length !== 1
    || Number(plans[0].slice(3)) !== counts.tests || successes.length !== counts.tests
    || counts.tests < minimumTests || counts.suites !== 0 || counts.pass !== counts.tests
    || counts.fail || counts.cancelled || counts.skipped || counts.todo) reject("INCOMPLETE_TEST_COVERAGE");
  return counts;
}

function validateRuntime(stdout) {
  let value;
  try { value = JSON.parse(stdout); } catch { reject("INVALID_RUNTIME_EVIDENCE"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) reject("INVALID_RUNTIME_EVIDENCE");
  const expected = ["platform", "arch", "node", "sharp", "portalSharp", "heif", "nodemailer"];
  if (Object.keys(value).sort().join() !== [...expected].sort().join()
    || value.platform !== "linux" || !["x64", "arm64"].includes(value.arch)
    || !/^v\d+\.\d+\.\d+$/.test(value.node)
    || value.sharp !== "0.35.4" || value.portalSharp !== "0.35.4" || value.nodemailer !== "9.1.1"
    || !/^\d+\.\d+\.\d+$/.test(value.heif)) reject("RUNTIME_DEPENDENCY_MISMATCH");
  return value;
}

export function evaluateResult(command, result) {
  if (result.reason) reject(result.reason);
  if (result.code !== 0 || result.signal) reject("CHILD_PROCESS_FAILED");
  return command.kind === "runtime" ? validateRuntime(result.stdout) : parseTap(result.stdout, command.minimumTests);
}

async function snapshotCheckout() {
  const root = await realpath(checkoutRoot);
  const fingerprints = {};
  for (const relative of sourceFiles) {
    // Reject source/manifest symlinks, aliases and missing files. pnpm's normal
    // dependency symlinks are intentionally outside this source-file check.
    let target = root;
    const pieces = relative.split("/");
    for (const [index, piece] of pieces.entries()) {
      target = path.join(target, piece);
      const stat = await lstat(target);
      if (stat.isSymbolicLink() || (index === pieces.length - 1 ? !stat.isFile() : !stat.isDirectory())) {
        reject("UNTRUSTED_SOURCE_PATH");
      }
      if (index === pieces.length - 1 && stat.size > 4 * 1024 * 1024) reject("SOURCE_FILE_TOO_LARGE");
    }
    fingerprints[relative] = sha256(await readFile(target));
  }
  const rootPackage = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const apiPackage = JSON.parse(await readFile(path.join(root, API, "package.json"), "utf8"));
  const portalPackage = JSON.parse(await readFile(path.join(root, "lib/portal-runner/package.json"), "utf8"));
  if (rootPackage.name !== "workspace" || rootPackage.packageManager !== "pnpm@10.33.2"
    || apiPackage.name !== "@workspace/api-server" || portalPackage.name !== "@workspace/portal-runner"
    || apiPackage.dependencies.sharp !== "0.35.4" || portalPackage.dependencies.sharp !== "0.35.4"
    || apiPackage.dependencies.nodemailer !== "9.1.1") reject("CHECKOUT_DEPENDENCY_MISMATCH");
  return { root, fingerprints };
}

// Fixed node executable, shell:false, detached Linux process group: a timeout
// terminates test grandchildren too (PDF tools / cross-process upload fixture).
function executeBounded(command) {
  assertLinux(process.platform);
  return new Promise(resolve => {
    let stdout = "", stderrBytes = 0, outputBytes = 0, reason = null, settled = false;
    const child = spawn(command.executable, command.args, {
      cwd: command.cwd, env: command.env, shell: false, detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const kill = code => {
      reason ??= code;
      if (Number.isSafeInteger(child.pid) && child.pid > 1) {
        try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
      }
    };
    const timer = setTimeout(() => kill("CHILD_TIMEOUT"), command.timeoutMs);
    const finish = (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, signal, reason, stdout, stderrBytes });
    };
    child.stdout.on("data", chunk => {
      outputBytes += chunk.length;
      if (outputBytes > OUTPUT_LIMIT_BYTES) kill("CHILD_OUTPUT_LIMIT");
      else stdout += chunk.toString("utf8");
    });
    // Never forward raw stderr / exception stacks from a runtime under test.
    child.stderr.on("data", chunk => {
      stderrBytes += chunk.length; outputBytes += chunk.length;
      if (outputBytes > OUTPUT_LIMIT_BYTES) kill("CHILD_OUTPUT_LIMIT");
    });
    child.on("error", () => { reason = "CHILD_START_FAILED"; finish(null, null); });
    child.on("close", finish);
  });
}

async function fixtureDirectory() {
  const parent = await realpath(tmpdir());
  const root = await mkdtemp(path.join(parent, FIXTURE_PREFIX));
  const identity = await lstat(root);
  await mkdir(path.join(root, "storage"), { mode: 0o700 });
  return {
    root,
    async cleanup() {
      const current = await lstat(root);
      if (path.dirname(root) !== parent || !path.basename(root).startsWith(FIXTURE_PREFIX)
        || current.isSymbolicLink() || !current.isDirectory() || current.dev !== identity.dev || current.ino !== identity.ino) {
        reject("FIXTURE_CLEANUP_IDENTITY_MISMATCH");
      }
      await rm(root, { recursive: true, force: false });
    },
  };
}

// Dependency injection is for the pure unit tests only. The CLI accepts no
// environment flags or command arguments capable of bypassing this gate.
export async function runLinuxGate({ platform = process.platform, execute = executeBounded,
  snapshot = snapshotCheckout, fixture = fixtureDirectory } = {}) {
  assertLinux(platform); // Must precede even fixture creation or source reads.
  const initial = await snapshot();
  const temporary = await fixture();
  const results = [];
  let runtime;
  try {
    for (const command of createPlan(initial.root, process.execPath, temporary.root)) {
      const result = await execute(command);
      const evidence = evaluateResult(command, result);
      if (command.kind === "runtime") runtime = evidence;
      else results.push({ suite: command.name, status: "PASS", ...evidence, outputSha256: sha256(result.stdout) });
    }
    const final = await snapshot();
    if (final.root !== initial.root || JSON.stringify(final.fingerprints) !== JSON.stringify(initial.fingerprints)) {
      reject("SOURCE_CHANGED_DURING_RUN");
    }
  } finally { await temporary.cleanup(); }
  return {
    schemaVersion: 1, status: "PASS", scope: "local-linux-synthetic-runtime",
    runtime, packageManager: "pnpm@10.33.2", sourceSha256: initial.fingerprints,
    suites: results, totals: { tests: results.reduce((n, suite) => n + suite.tests, 0), skipped: 0, failed: 0 },
    dbAccess: "none", providerDelivery: "none", osNetworkIsolation: "not-attested", deployment: "none",
  };
}

async function runtimeProbe() {
  assertLinux(process.platform);
  const requireApi = createRequire(path.join(checkoutRoot, API, "package.json"));
  const requirePortal = createRequire(path.join(checkoutRoot, "lib/portal-runner/package.json"));
  const sharp = requireApi("sharp");
  return {
    platform: process.platform, arch: process.arch, node: process.version,
    sharp: sharp.versions.sharp, portalSharp: requirePortal("sharp").versions.sharp,
    heif: sharp.versions.heif, nodemailer: requireApi("nodemailer/package.json").version,
  };
}

export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === "--runtime-probe") return runtimeProbe();
  if (args.length) reject("ARGUMENTS_NOT_SUPPORTED");
  return runLinuxGate();
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { process.stdout.write(`${JSON.stringify(await main())}\n`); }
  catch (error) {
    process.stdout.write(`${JSON.stringify({ schemaVersion: 1, status: "FAIL",
      code: error instanceof LinuxGateError ? error.code : "LINUX_GATE_SETUP_FAILED" })}\n`);
    process.exitCode = 1;
  }
}
