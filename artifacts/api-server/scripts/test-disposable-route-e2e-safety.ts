import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { assertDisposableDatabaseIdentity, assertDisposableRouteEnvironment,
  assertEmptyBusinessRows, assertLoopbackSocketTarget, bindRollbackOnlyPool,
  createLocalRouteSocketPolicy, EMPTY_BUSINESS_TABLES, localCorridorUrl, resolveLoopbackLookup } from "./disposable-route-e2e-safety";

const runId = "5048c6ab-bcd4-4124-97f6-b966fb73110a";
const pgdata = path.resolve("disposable-pgdata");
const safe = { LOCAL_ROUTE_E2E_ALLOW_MUTATION: "1", LOCAL_E2E_RUN_ID: runId,
  LOCAL_E2E_PGDATA: pgdata, DATABASE_URL: "postgres://postgres@127.0.0.1:5433/fasos_apply_local",
  NODE_ENV: "test", ALLOW_LIVE_INTEGRATIONS: "false", EMAIL_DELIVERY_DISABLED: "true" };

test("exact local mutation opt-in, UUID and delivery fences are mandatory", () => {
  assert.equal(assertDisposableRouteEnvironment(safe).runId, runId);
  for (const field of Object.keys(safe)) {
    assert.throws(() => assertDisposableRouteEnvironment({ ...safe, [field]: undefined }));
  }
  for (const value of ["production", "development", "Test"]) {
    assert.throws(() => assertDisposableRouteEnvironment({ ...safe, NODE_ENV: value }));
  }
  assert.throws(() => assertDisposableRouteEnvironment({ ...safe, LOCAL_E2E_RUN_ID: "123" }));
});

test("alternate DB hosts, ports, paths, connection overrides and schemes are denied", () => {
  for (const url of [
    "postgres://postgres@localhost:5433/fasos_apply_local", "postgres://postgres@127.0.0.1:5432/fasos_apply_local",
    "postgres://postgres@127.0.0.1:5433/fasos_apply", "postgres://postgres@127.0.0.2:5433/fasos_apply_local",
    "postgres://postgres@[::1]:5433/fasos_apply_local", "postgres://postgres@127.0.0.1:5433/fasos_apply_local?host=example.test",
    "postgres://postgres@127.0.0.1:5433/fasos_apply_local#fragment", "http://postgres@127.0.0.1:5433/fasos_apply_local",
  ]) assert.throws(() => assertDisposableRouteEnvironment({ ...safe, DATABASE_URL: url }));
});

test("PostgreSQL-reported exact endpoint, run comment and cluster directory must match", () => {
  const identity = { name: "fasos_apply_local", host: "127.0.0.1/32", port: 5433,
    comment: `fas-disposable-route-e2e:${runId}`, dataDirectory: pgdata };
  assertDisposableDatabaseIdentity(identity, { runId, pgdata });
  for (const field of Object.keys(identity)) {
    assert.throws(() => assertDisposableDatabaseIdentity({ ...identity, [field]: "wrong" }, { runId, pgdata }));
  }
});

test("existing business records, missing counts and string-zero all fail closed", () => {
  const empty = Object.fromEntries(EMPTY_BUSINESS_TABLES.map(name => [name, 0]));
  assertEmptyBusinessRows(empty);
  for (const name of EMPTY_BUSINESS_TABLES) assert.throws(() => assertEmptyBusinessRows({ ...empty, [name]: 1 }));
  assert.throws(() => assertEmptyBusinessRows({}));
  assert.throws(() => assertEmptyBusinessRows({ ...empty, users: "0" } as any));
});

test("socket target allows only explicit literal loopback on two approved ports", () => {
  const ports = new Set([5433, 43210]);
  assertLoopbackSocketTarget([{ host: "127.0.0.1", port: 5433 }], ports);
  assertLoopbackSocketTarget([43210, "127.0.0.1"], ports);
  assertLoopbackSocketTarget([[{ host: "127.0.0.1", port: 5433 }, undefined]], ports);
  for (const args of [
    [{ host: "example.test", port: 443 }], [{ host: "127.0.0.1", port: 5432 }],
    [{ host: "localhost", port: 5433 }], [{ port: 5433 }], ["/tmp/pg.sock"],
    [{ host: "127.0.0.1", port: 5433, path: "/tmp/pg.sock" }],
  ]) assert.throws(() => assertLoopbackSocketTarget(args, ports));
});

test("HTTP transport denies external, admin/purge and encoded traversal paths", () => {
  assert.equal(localCorridorUrl("http://127.0.0.1:43210", "/api/auth/me").pathname, "/api/auth/me");
  for (const route of ["https://example.test/api/auth/me", "//example.test/api/auth/me", "/api/students/1/purge",
    "/api/storage/objects/../private", "/api/storage/objects/%2e%2e/private", "/api/auth/me?token=a"]) {
    assert.throws(() => localCorridorUrl("http://127.0.0.1:43210", route));
  }
  assert.throws(() => localCorridorUrl("https://staging.findandstudy.com", "/api/auth/me"));
});

test("DB admission is irrevocably closed before exactly one HTTP port is admitted", () => {
  const policy = createLocalRouteSocketPolicy();
  policy.assertTarget([{ host: "127.0.0.1", port: 5433 }]);
  assert.throws(() => policy.allowHttpPort(43210));
  policy.closeDatabaseAdmission();
  assert.throws(() => policy.assertTarget([{ host: "127.0.0.1", port: 5433 }]));
  assert.throws(() => policy.allowHttpPort(5433));
  policy.allowHttpPort(43210);
  policy.assertTarget([{ host: "127.0.0.1", port: 43210 }]);
  assert.throws(() => policy.allowHttpPort(43211));
  policy.closeDatabaseAdmission();
  assert.throws(() => policy.assertTarget([{ host: "127.0.0.1", port: 5433 }]));
});

test("only canonical IPv4 loopback resolves locally, with Node lookup family/all semantics", () => {
  const answer = { address: "127.0.0.1", family: 4 };
  assert.deepEqual(resolveLoopbackLookup("127.0.0.1"), answer);
  assert.deepEqual(resolveLoopbackLookup("127.0.0.1", 4), answer);
  assert.deepEqual(resolveLoopbackLookup("127.0.0.1", { family: 0, all: true }), [answer]);
  assert.deepEqual(resolveLoopbackLookup("127.0.0.1", { family: 4, all: false }), answer);
  for (const hostname of ["localhost", "127.1", "127.0.0.2", "::1", "example.test", "127.0.0.1.", 2130706433]) {
    assert.throws(() => resolveLoopbackLookup(hostname));
  }
  for (const options of [6, { family: 6 }, { all: "true" }, "4"]) {
    assert.throws(() => resolveLoopbackLookup("127.0.0.1", options));
  }
});

test("rollback pool never delegates to old pool or permits DDL/transaction escape", async () => {
  let calls = 0;
  const original = () => { throw new Error("escaped original pool"); };
  const pool = { query: original as (...args: any[]) => any, connect: original };
  const binding = bindRollbackOnlyPool(pool, async () => { calls++; return { rows: [] }; });
  await pool.query("SELECT 1");
  await pool.query({ text: "INSERT INTO fixture(a) VALUES($1)", values: [1] });
  for (const text of ["COMMIT", "ROLLBACK", "DROP TABLE fixture", "SET ROLE postgres", "SELECT 1; COMMIT", "-- comment\nCOMMIT"]) {
    await assert.rejects(pool.query(text), /OUTSIDE_CORRIDOR/);
  }
  assert.throws(() => pool.connect(), /ADDITIONAL_CONNECTION/);
  await binding.close();
  await assert.rejects(pool.query("INSERT INTO fixture VALUES(2)"), /TRANSACTION_CLOSED/);
  assert.equal(calls, 2);
  assert.equal(binding.lateQueries, 1);
});

test("close drains in-flight transaction work while denying new work", async () => {
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const pool = { query: (() => {}) as (...args: any[]) => any, connect: () => {} };
  const binding = bindRollbackOnlyPool(pool, () => pending);
  const query = pool.query("UPDATE fixture SET a=2");
  let closed = false;
  const close = binding.close().then(() => { closed = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(closed, false);
  await assert.rejects(pool.query("DELETE FROM fixture"), /TRANSACTION_CLOSED/);
  finish(); await query; await close;
  assert.equal(closed, true);
});

test("installed fence blocks new DB sockets, provider transports, DNS and child processes in an isolated child", () => {
  const helper = new URL("./disposable-route-e2e-safety.ts", import.meta.url).href;
  const probe = `
    import assert from 'node:assert/strict';
    import net from 'node:net';
    import tls from 'node:tls';
    import dns from 'node:dns';
    import childProcess from 'node:child_process';
    import { installLocalRouteFence } from ${JSON.stringify(helper)};
    const fence = installLocalRouteFence();
    fence.closeDatabaseAdmission();
    let synchronous = true;
    const lookup = new Promise((resolve,reject) => dns.lookup('127.0.0.1',(error,address,family) => {
      if(error) return reject(error);
      assert.equal(synchronous,false);
      assert.equal(address,'127.0.0.1'); assert.equal(family,4); resolve();
    }));
    synchronous=false; await lookup;
    assert.deepEqual(await dns.promises.lookup('127.0.0.1',{all:true}),[{address:'127.0.0.1',family:4}]);
    for (const attempt of [
      () => net.connect({host:'127.0.0.1',port:5433}),
      () => net.connect({host:'example.test',port:443}),
      () => net.connect({path:'/tmp/database.sock'}),
      () => tls.connect({host:'127.0.0.1',port:443}),
      () => dns.lookup('example.test',()=>{}),
      () => dns.promises.resolve4('example.test'),
      () => childProcess.spawn(process.execPath,['--version']),
    ]) assert.throws(attempt,/E2E_EXTERNAL_EFFECT_DENIED/);
    assert.equal(fence.denied,7);
    console.log('FENCE_PASS:7');
  `;
  const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", probe], {
    cwd: process.cwd(), encoding: "utf8", timeout: 10_000,
    env: { ...process.env, NODE_OPTIONS: "" },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /FENCE_PASS:7/);
});
