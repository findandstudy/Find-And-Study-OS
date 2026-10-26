import assert from "node:assert/strict";
import test from "node:test";
import { withPersonaSessionPreflight } from "../src/lib/personaSessionPreflight";
const input = { sessionId: "a".repeat(64), sessionFingerprint: "b".repeat(64), observedAt: 1 };
const conflict = () => Object.assign(new Error("synthetic serialization conflict"), { code: "40001" });
test("only a known serialization conflict before any operation gets one fresh canonical read", async () => {
  let reads = 0, operations = 0;
  const wrapped = withPersonaSessionPreflight({ async withLockedCurrentSession(actual, operation) {
    assert.equal(actual, input);
    if (++reads === 1) throw conflict();
    return operation({ status: "CURRENT" });
  } });
  assert.equal(await wrapped.withLockedCurrentSession(input, async state => { operations++; assert.deepEqual(state, { status: "CURRENT" }); return "ok"; }), "ok");
  assert.equal(reads, 2); assert.equal(operations, 1);
});
test("pre-operation retry is bounded and never reaches a callback on repeated conflict", async () => {
  let reads = 0;
  await assert.rejects(withPersonaSessionPreflight({ async withLockedCurrentSession() { reads++; throw conflict(); } })
    .withLockedCurrentSession(input, async () => { throw new Error("must not run"); }), /synthetic serialization/);
  assert.equal(reads, 2);
});
for (const code of ["08006", "40P01", "57014", undefined]) test(`unknown/connection/timeout ${code} does not retry`, async () => {
  let reads = 0;
  await assert.rejects(withPersonaSessionPreflight({ async withLockedCurrentSession() { reads++; throw Object.assign(new Error("unknown"), { code }); } })
    .withLockedCurrentSession(input, async () => "no"), /unknown/);
  assert.equal(reads, 1);
});
test("a serialization/commit error AFTER the operation never repeats it", async () => {
  let reads = 0, operations = 0;
  await assert.rejects(withPersonaSessionPreflight({ async withLockedCurrentSession(_input, operation) { reads++; await operation({}); throw conflict(); } })
    .withLockedCurrentSession(input, async () => { operations++; return "committed business effect"; }), /synthetic serialization/);
  assert.equal(reads, 1); assert.equal(operations, 1);
});
test("operation-thrown conflict is not a preflight conflict", async () => {
  let reads = 0;
  await assert.rejects(withPersonaSessionPreflight({ async withLockedCurrentSession(_input, operation) { reads++; return operation({}); } })
    .withLockedCurrentSession(input, async () => { throw conflict(); }), /synthetic serialization/);
  assert.equal(reads, 1);
});
test("the retry sees revoked state rather than reusing the earlier authorization", async () => {
  let reads = 0;
  const result = await withPersonaSessionPreflight({ async withLockedCurrentSession(_input, operation) { if (++reads === 1) throw conflict(); return operation({ status: "REVOKED" }); } })
    .withLockedCurrentSession(input, async state => { assert.deepEqual(state, { status: "REVOKED" }); return "denied"; });
  assert.equal(result, "denied");
});
test("invalid repository cannot call a business operation twice", async () => {
  let operations = 0;
  await assert.rejects(withPersonaSessionPreflight({ async withLockedCurrentSession(_input, operation) { await operation({}); return operation({}); } })
    .withLockedCurrentSession(input, async () => { operations++; return "ok"; }), /PERSONA_SESSION_CONTRACT_INVALID/);
  assert.equal(operations, 1);
});
