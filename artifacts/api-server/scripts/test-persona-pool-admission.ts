import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { createPersonaScopedMock, type PersonaMockIdentity } from "../src/lib/personaScopedMock";

process.env.NODE_ENV = "test";
process.env.ALLOW_LIVE_INTEGRATIONS = "false";
const id = "018f6100-0000-7000-8000-000000000001";
const config = { audience: "test", environmentId: "test", cellId: "test", issuerId: id, keyRing: [] };
function fixture(max: number | undefined = 10) {
  const pool = {
    ...(max === undefined ? {} : { options: { max } }),
    async connect() { throw new Error("unexpected DB acquisition"); },
  } as unknown as Pick<Pool, "connect">;
  const gates: Array<() => void> = [];
  let active = 0, peak = 0;
  const identity: PersonaMockIdentity = {
    token: "invalid-test-token", tenantId: id, principalId: id, sessionFingerprint: "a".repeat(64),
    async sessionBoundary<T>(operation: () => Promise<T>) {
      active++; peak = Math.max(peak, active);
      await new Promise<void>((resolve) => gates.push(resolve));
      try { return await operation(); } finally { active--; }
    },
  };
  return { pool, identity, gates, peak: () => peak };
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
test("admission is shared across services and occurs before session locks", async () => {
  const f = fixture();
  const a = createPersonaScopedMock(f.pool, config), b = createPersonaScopedMock(f.pool, config);
  const pending = Array.from({ length: 8 }, (_, i) =>
    (i % 2 ? a : b).list(f.identity, id).catch((error: Error) => error.message));
  await tick(); assert.equal(f.gates.length, 2);
  for (let i = 0; i < 8; i++) { f.gates[i](); await tick(); }
  assert.deepEqual(await Promise.all(pending), Array(8).fill("PERSONA_AUTH_REQUIRED"));
  assert.equal(f.peak(), 2);
});
test("two-connection pool allows only one session-bound transaction", async () => {
  const f = fixture(2), service = createPersonaScopedMock(f.pool, config);
  const pending = [service.list(f.identity, id), service.list(f.identity, id)].map((promise) => promise.catch((e: Error) => e.message));
  await tick(); assert.equal(f.gates.length, 1);
  f.gates[0](); await tick(); assert.equal(f.gates.length, 2); f.gates[1]();
  assert.deepEqual(await Promise.all(pending), ["PERSONA_AUTH_REQUIRED", "PERSONA_AUTH_REQUIRED"]);
  assert.equal(f.peak(), 1);
});
test("capacity below two refuses session-bound work before acquiring a connection", async () => {
  const f = fixture(1);
  await assert.rejects(createPersonaScopedMock(f.pool, config).list(f.identity, id), /PERSONA_POOL_CAPACITY_REQUIRED/);
  assert.equal(f.gates.length, 0);
});
test("unknown pool capacity refuses nested session-bound acquisition", async () => {
  const f = fixture(); delete (f.pool as { options?: unknown }).options;
  await assert.rejects(createPersonaScopedMock(f.pool, config).list(f.identity, id), /PERSONA_POOL_CAPACITY_REQUIRED/);
  assert.equal(f.gates.length, 0);
});
test("queue is bounded and overflow is explicit, with no automatic retry", async () => {
  const f = fixture(), service = createPersonaScopedMock(f.pool, config);
  const pending = Array.from({ length: 34 }, () => service.list(f.identity, id).catch((e: Error) => e.message));
  await tick(); assert.equal(f.gates.length, 2);
  await assert.rejects(service.list(f.identity, id), /PERSONA_BUSY/);
  for (let i = 0; i < 34; i++) { f.gates[i](); await tick(); }
  assert.deepEqual(await Promise.all(pending), Array(34).fill("PERSONA_AUTH_REQUIRED"));
});
test("queued admission times out without ever taking the session lock", async () => {
  const f = fixture(2), service = createPersonaScopedMock(f.pool, config);
  const first = service.list(f.identity, id).catch((e: Error) => e.message);
  await tick();
  await assert.rejects(service.list(f.identity, id), /PERSONA_BUSY/);
  assert.equal(f.gates.length, 1);
  f.gates[0](); assert.equal(await first, "PERSONA_AUTH_REQUIRED");
});
