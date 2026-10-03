import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  assertLinux, childEnvironment, createPlan, evaluateResult, main, parseTap, runLinuxGate,
} from "./verify-security-linux.mjs";

const root = path.resolve(tmpdir(), "synthetic-checkout");
const fixture = path.resolve(tmpdir(), "synthetic-fixtures");
const runtime = { platform: "linux", arch: "x64", node: "v24.19.0", sharp: "0.35.4",
  portalSharp: "0.35.4", heif: "1.23.2", nodemailer: "9.1.1" };
function tap(count) {
  return ["TAP version 13", ...Array.from({ length: count }, (_, index) => `ok ${index + 1} - synthetic assertion`),
    `1..${count}`, `# tests ${count}`, "# suites 0", `# pass ${count}`, "# fail 0", "# cancelled 0", "# skipped 0", "# todo 0"].join("\n");
}
function result(stdout) { return { code: 0, signal: null, stdout, reason: null }; }
function harness(overrides = {}) {
  const calls = { snapshot: 0, fixture: 0, cleanup: 0, execute: [] };
  const options = {
    platform: "linux",
    snapshot: async () => { calls.snapshot++; return { root, fingerprints: { "pnpm-lock.yaml": "synthetic-hash" } }; },
    fixture: async () => { calls.fixture++; return { root: fixture, cleanup: async () => { calls.cleanup++; } }; },
    execute: async command => {
      calls.execute.push(command);
      return result(command.kind === "runtime" ? JSON.stringify(runtime) : tap(command.minimumTests));
    },
    ...overrides,
  };
  return { calls, options };
}

test("Windows and unsupported hosts fail before fixture, source reads or child launch", async () => {
  for (const platform of ["win32", "darwin", "", "Linux", undefined]) {
    if (platform === undefined && process.platform === "linux") continue;
    const { options, calls } = harness({ platform });
    await assert.rejects(runLinuxGate(options), /LINUX_RUNTIME_REQUIRED/);
    assert.deepEqual(calls, { snapshot: 0, fixture: 0, cleanup: 0, execute: [] });
  }
  assert.doesNotThrow(() => assertLinux("linux"));
});

test("CLI cannot choose a command, suite, platform, target or timeout", async () => {
  for (const args of [["--platform=linux"], ["--command=sh"], ["--test=other.ts"], ["--timeout=0"], ["--runtime-probe", "extra"]]) {
    await assert.rejects(main(args), /ARGUMENTS_NOT_SUPPORTED/);
  }
});

test("child environment is minimal and never copies inherited credentials or execution hooks", () => {
  const environment = childEnvironment(fixture);
  for (const key of ["DATABASE_URL", "PGHOST", "SMTP_PASSWORD", "GOOGLE_APPLICATION_CREDENTIALS", "AWS_SECRET_ACCESS_KEY",
    "NODE_OPTIONS", "NODE_PATH", "LD_PRELOAD", "HTTP_PROXY", "HTTPS_PROXY", "PRIVATE_OBJECT_DIR", "API_KEY"]) {
    assert.equal(Object.hasOwn(environment, key), false);
  }
  assert.equal(environment.ALLOW_LIVE_INTEGRATIONS, "false");
  assert.equal(environment.NODE_ENV, "test");
  assert.equal(environment.PATH, "/usr/local/bin:/usr/bin:/bin");
  assert.equal(environment.HOME, fixture);
  assert.equal(environment.TMPDIR, fixture);
  assert.equal(environment.STORAGE_LOCAL_DIR, path.join(fixture, "storage"));
  assert.throws(() => childEnvironment("relative"), /ABSOLUTE_FIXTURE_ROOT_REQUIRED/);
});

test("plan uses fixed source-anchored commands and exact five suites, never package hooks or shell", () => {
  const plan = createPlan(root, process.execPath, fixture);
  assert.equal(plan.length, 6);
  assert.deepEqual(plan[0].args, [path.join(root, "scripts/verify-security-linux.mjs"), "--runtime-probe"]);
  assert.deepEqual(plan.slice(1).map(command => command.name), ["test-security-dependency-runtime.ts", "test-local-upload-publication.ts",
    "test-student-photo-thumbnail.ts", "test-student-photo-thumbnail-limits.ts", "test-document-bytes-bounded-source.ts"]);
  assert.deepEqual(plan.slice(1).map(command => command.minimumTests), [4, 26, 9, 11, 11]);
  assert.throws(() => evaluateResult(plan[2], result(tap(24))), /INCOMPLETE_TEST_COVERAGE/,
    "the pre-race regression denominator must not pass the current gate");
  for (const command of plan) {
    assert.equal(command.executable, process.execPath);
    assert.equal(command.cwd, path.join(root, "artifacts/api-server"));
    assert.equal(command.timeoutMs, 90_000);
    assert.equal(command.env.ALLOW_LIVE_INTEGRATIONS, "false");
  }
  for (const paths of [["../other", process.execPath, fixture], [root, "node", fixture], [root, process.execPath, "tmp"]]) {
    assert.throws(() => createPlan(...paths), /ABSOLUTE_PATHS_REQUIRED/);
  }
});

test("complete TAP summary accepts CRLF and rejects missing or contradictory coverage", () => {
  assert.equal(parseTap(tap(24).replaceAll("\n", "\r\n"), 24).pass, 24);
  for (const body of ["", tap(0), tap(23), tap(24).replace("1..24", "1..25"), tap(24).replace("# pass 24", "# pass 23"),
    tap(24).replace("# fail 0", "# fail 1"), tap(24).replace("# cancelled 0", "# cancelled 1"),
    tap(24).replace("# tests 24", ""), `${tap(24)}\n# tests 24`, tap(24).replace("ok 1 -", "not ok 1 -"),
    `${tap(24)}\nBail out! runtime failed`, "x".repeat(256 * 1024 + 1)]) {
    assert.throws(() => parseTap(body, 24));
  }
});

test("any skipped native/symlink/PDF assertion or TODO fails even with process exit zero", () => {
  const command = { kind: "suite", minimumTests: 24 };
  for (const stdout of [tap(24).replace("# skipped 0", "# skipped 1"), tap(24).replace("# todo 0", "# todo 1"),
    tap(24).replace("ok 1 - synthetic assertion", "ok 1 - PDF renderer # SKIP missing"),
    tap(24).replace("ok 1 - synthetic assertion", "ok 1 - symlink # TODO later")]) {
    assert.throws(() => evaluateResult(command, result(stdout)));
  }
});

test("process failure, signal, timeout and output overflow cannot become a PASS", () => {
  const command = { kind: "suite", minimumTests: 24 };
  for (const invalid of [{ code: 1 }, { code: null }, { signal: "SIGKILL" }, { reason: "CHILD_TIMEOUT" },
    { reason: "CHILD_START_FAILED" }, { reason: "CHILD_OUTPUT_LIMIT" }]) {
    assert.throws(() => evaluateResult(command, { ...result(tap(24)), ...invalid }));
  }
});

test("runtime evidence must attest Linux and exact installed patched versions, without extra fields", () => {
  const command = { kind: "runtime" };
  assert.deepEqual(evaluateResult(command, result(JSON.stringify(runtime))), runtime);
  for (const value of [{ ...runtime, platform: "win32" }, { ...runtime, sharp: "0.34.0" }, { ...runtime, portalSharp: "0.35.3" },
    { ...runtime, nodemailer: "9.1.0" }, { ...runtime, secret: "must-not-be-emitted" }, [], null]) {
    assert.throws(() => evaluateResult(command, result(JSON.stringify(value))));
  }
});

test("aggregate passes only all 61 assertions and cleans exactly its disposable fixture", async () => {
  const { calls, options } = harness();
  const evidence = await runLinuxGate(options);
  assert.equal(evidence.status, "PASS");
  assert.equal(evidence.totals.tests, 61);
  assert.equal(evidence.suites.length, 5);
  assert.equal(evidence.osNetworkIsolation, "not-attested");
  assert.equal(calls.snapshot, 2);
  assert.equal(calls.fixture, 1);
  assert.equal(calls.cleanup, 1);
  for (const suite of evidence.suites) assert.match(suite.outputSha256, /^[a-f0-9]{64}$/);
});

test("failed suite stops the sequence and cleanup still runs", async () => {
  const { options, calls } = harness({ execute: async () => result("not valid runtime JSON") });
  await assert.rejects(runLinuxGate(options), /INVALID_RUNTIME_EVIDENCE/);
  assert.equal(calls.snapshot, 1);
  assert.equal(calls.cleanup, 1);
});

test("source changes or cleanup failure suppress a successful test result", async () => {
  let snapshots = 0;
  const drift = harness({ snapshot: async () => ({ root, fingerprints: { source: ++snapshots } }) });
  await assert.rejects(runLinuxGate(drift.options), /SOURCE_CHANGED_DURING_RUN/);
  assert.equal(drift.calls.cleanup, 1);
  const cleanupFailure = harness({ fixture: async () => ({ root: fixture, cleanup: async () => { throw new Error("FIXTURE_CLEANUP_IDENTITY_MISMATCH"); } }) });
  await assert.rejects(runLinuxGate(cleanupFailure.options), /FIXTURE_CLEANUP_IDENTITY_MISMATCH/);
});
