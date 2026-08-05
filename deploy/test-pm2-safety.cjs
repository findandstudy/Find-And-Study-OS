#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const configPath = path.join(__dirname, "ecosystem.config.cjs");
const preflightPath = path.join(__dirname, "pm2-preflight.cjs");

function processEntry(name, script, port) {
  return {
    name,
    pm2_env: { name, pm_exec_path: script, exec_mode: "fork_mode", ...(port ? { PORT: port } : {}) },
  };
}

function runPreflight(processes, releaseLink) {
  const directory = mkdtempSync(path.join(tmpdir(), "fasos-pm2-test-"));
  const fixture = path.join(directory, "jlist.json");
  writeFileSync(fixture, JSON.stringify(processes));
  const args = [preflightPath, "--input", fixture];
  if (releaseLink) args.push("--release-link", releaseLink);
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    encoding: "utf8",
  });
  rmSync(directory, { recursive: true, force: true });
  return result;
}

const canonical = [
  processEntry("fasos-apply-api", "/app/artifacts/api-server/dist/index.cjs", 5000),
  processEntry(
    "findandstudy-portal-worker",
    "/app/artifacts/portal-automation-worker/src/worker.ts",
  ),
];

test("authoritative config uses canonical fork/1 topology", () => {
  const config = require(configPath);
  assert.deepEqual(config.processNames, {
    api: "fasos-apply-api",
    portalWorker: "findandstudy-portal-worker",
  });
  assert.equal(config.apps.length, 2);
  for (const app of config.apps) {
    assert.equal(app.exec_mode, "fork");
    assert.equal(app.instances, 1);
  }
  const api = config.apps.find((app) => app.name === config.processNames.api);
  const portalWorker = config.apps.find((app) => app.name === config.processNames.portalWorker);
  assert.equal(String(api?.env_production.PORT), process.env.PORT || "5000");
  assert.equal(portalWorker?.env_production.PORT, "");
  assert.equal(
    portalWorker?.interpreter,
    path.join(
      process.env.CURRENT_RELEASE_LINK
        ? path.resolve(process.env.CURRENT_RELEASE_LINK)
        : path.resolve(__dirname, ".."),
      "artifacts/portal-automation-worker/node_modules/.bin/tsx",
    ),
  );
});

test("valid existing canonical topology passes", () => {
  const result = runPreflight(canonical);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /OK: fasos-apply-api \(fork\/1/);
});

test("missing or duplicate canonical processes are rejected", () => {
  assert.equal(runPreflight(canonical.slice(0, 1)).status, 1);
  assert.equal(runPreflight([...canonical, canonical[0]]).status, 1);
  assert.equal(runPreflight([...canonical, canonical[1]]).status, 1);
});

test("legacy names, duplicate API port and alternate worker are rejected", () => {
  assert.equal(
    runPreflight([...canonical, processEntry("edconsult-os-api", "/app/api.cjs")]).status,
    1,
  );
  assert.equal(
    runPreflight([...canonical, processEntry("other-api", "/app/other.cjs", 5000)]).status,
    1,
  );
  assert.equal(
    runPreflight([
      ...canonical,
      processEntry("other-worker", "/app/artifacts/portal-automation-worker/src/worker.ts"),
    ]).status,
    1,
  );
});

test("non-fork canonical process is rejected", () => {
  const clusterApi = structuredClone(canonical[0]);
  clusterApi.pm2_env.exec_mode = "cluster_mode";
  assert.equal(runPreflight([clusterApi, canonical[1]]).status, 1);
});

test("release cutover rejects canonical processes outside the current symlink", () => {
  const underCurrent = [
    processEntry("fasos-apply-api", "/srv/fasos/current/artifacts/api-server/dist/index.cjs", 5000),
    processEntry(
      "findandstudy-portal-worker",
      "/srv/fasos/current/artifacts/portal-automation-worker/src/worker.ts",
    ),
  ];
  assert.equal(runPreflight(underCurrent, "/srv/fasos/current").status, 0);
  assert.equal(runPreflight(canonical, "/srv/fasos/current").status, 1);
});

test("deploy entrypoints use preflight and contain no blind fallback", () => {
  const deploy = readFileSync(path.join(__dirname, "deploy.sh"), "utf8");
  const compatibility = readFileSync(path.join(root, "scripts/deploy.sh"), "utf8");
  assert.match(deploy, /node deploy\/pm2-preflight\.cjs/);
  assert.match(deploy, /CANDIDATE_PORT/);
  assert.match(deploy, /rollback_code/);
  assert.match(deploy, /release_health_ready/);
  assert.match(deploy, /EXPECTED_RELEASE_ID/);
  assert.match(deploy, /git archive/);
  assert.doesNotMatch(deploy, /pm2 start|startOrRestart|pm2 restart all/);
  assert.match(deploy, /pm2 restart "\$PORTAL_WORKER_PROCESS_NAME"/);
  assert.match(deploy, /pm2 restart "\$API_PROCESS_NAME"/);
  assert.match(compatibility, /exec bash .*deploy\/deploy\.sh/);
  assert.doesNotMatch(compatibility, /pm2|migrate/);

  const standaloneWorker = readFileSync(path.join(root, "start-portal-worker.sh"), "utf8");
  assert.match(standaloneWorker, /Standalone portal worker startup is disabled/);
  assert.doesNotMatch(standaloneWorker, /pnpm run start|worker\.ts/);
});
