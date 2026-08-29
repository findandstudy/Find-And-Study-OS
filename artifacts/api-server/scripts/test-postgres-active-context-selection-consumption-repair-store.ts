import assert from "node:assert/strict";
import test from "node:test";

import { ACTIVE_SESSION_SELECTION_COMMAND_RECEIPT_V1 } from "../src/lib/activeContextSelectionConsumptionAttempt.js";
import { PostgresActiveContextSelectionConsumptionRepairStore } from "../src/lib/postgresActiveContextSelectionConsumptionRepairStore.js";

const ID = {
  attempt: "018fc000-0000-7000-8000-000000000001",
  tenant: "018fc000-0000-7000-8000-000000000002",
  context: "018fc000-0000-7000-8000-000000000003",
  selection: "018fc000-0000-7000-8000-000000000004",
  principal: "018fc000-0000-7000-8000-000000000005",
  membership: "018fc000-0000-7000-8000-000000000006",
} as const;

function fakePool() {
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  let released: unknown;
  const client = {
    async query<T extends Record<string, unknown>>(text: string, values?: unknown[]) {
      queries.push({ text, values });
      if (text.includes("current_user")) {
        return {
          rows: [{ current_user: "fas_session_repair_executor", tenant_setting: null }],
          rowCount: 1,
        } as unknown as { rows: T[]; rowCount: number };
      }
      if (text.includes("claim_due_attempt")) {
        return {
          rows: [{
            result: {
              attemptId: ID.attempt,
              tenantId: ID.tenant,
              contextId: ID.context,
              selectionId: ID.selection,
              sessionGeneration: 2,
              principalId: ID.principal,
              membershipId: ID.membership,
              idempotencyKeyHash: "a".repeat(64),
              requestHash: "b".repeat(64),
              environmentId: "test",
              cellId: "test-cell",
              outcomeSource: ACTIVE_SESSION_SELECTION_COMMAND_RECEIPT_V1,
              status: "PENDING",
              attemptCount: 1,
              maxAttempts: 5,
            },
          }],
          rowCount: 1,
        } as unknown as { rows: T[]; rowCount: number };
      }
      if (text.includes("load_selection_command_outcome")) {
        return {
          rows: [{ result: { state: "COMPLETED", resultHash: "c".repeat(64) } }],
          rowCount: 1,
        } as unknown as { rows: T[]; rowCount: number };
      }
      if (text.includes("reschedule_attempt") || text.includes("complete_attempt")) {
        return { rows: [{ result: null }], rowCount: 1 } as unknown as {
          rows: T[];
          rowCount: number;
        };
      }
      return { rows: [], rowCount: 0 } as { rows: T[]; rowCount: number };
    },
    release(error?: unknown) { released = error; },
  };
  return {
    pool: { connect: async () => client } as never,
    queries,
    get released() { return released; },
  };
}

test("claims, verifies and resolves through exact repair RPCs", async () => {
  const fixture = fakePool();
  const store = new PostgresActiveContextSelectionConsumptionRepairStore({
    pool: fixture.pool,
    expectedRole: "fas_session_repair_executor",
  });
  const attempt = await store.claimDue(ID.tenant);
  assert.ok(attempt);
  assert.match(attempt.leaseToken, /^[0-9a-f]{64}$/);
  assert.deepEqual(await store.loadOutcome(attempt), {
    state: "COMPLETED",
    resultHash: "c".repeat(64),
  });
  await store.resolve(attempt);
  assert.equal(fixture.released, undefined);
  assert.equal(fixture.queries.filter((query) => query.text === "BEGIN").length, 3);
  assert.equal(fixture.queries.filter((query) => query.text === "COMMIT").length, 3);
  assert.ok(fixture.queries.some((query) => query.text.includes("claim_due_attempt")));
  assert.ok(fixture.queries.some((query) => query.text.includes("load_selection_command_outcome")));
  assert.ok(fixture.queries.some((query) => query.text.includes("complete_attempt")));
});

test("uses bounded exponential backoff and fixed error codes", async () => {
  const fixture = fakePool();
  const store = new PostgresActiveContextSelectionConsumptionRepairStore({
    pool: fixture.pool,
    expectedRole: "fas_session_repair_executor",
  });
  const attempt = await store.claimDue(ID.tenant);
  assert.ok(attempt);
  await store.reschedule({ ...attempt, attemptCount: 4 }, "NOT_FOUND");
  const retry = fixture.queries.find((query) => query.text.includes("reschedule_attempt"));
  assert.deepEqual(retry?.values?.slice(-2), [40, "OUTCOME_NOT_FOUND"]);
});

test("rejects malformed tenant before opening a transaction", async () => {
  const fixture = fakePool();
  const store = new PostgresActiveContextSelectionConsumptionRepairStore({
    pool: fixture.pool,
    expectedRole: "fas_session_repair_executor",
  });
  await assert.rejects(store.claimDue("not-a-tenant"), /tenant_invalid/);
  assert.equal(fixture.queries.some((query) => query.text === "BEGIN"), false);
});
