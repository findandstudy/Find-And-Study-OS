import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  assertPersonaScope,
  assertPersonaApproval,
  personaIntentDigest,
  legacyPersonaExecutionBlock,
  type PersonaApprovalIntent,
} from "../src/lib/personaSafety";
import { reservePersonaBudget } from "../src/lib/personaBudgetReservation";

const authority = {
  tenantId: "tenant-a",
  organizationId: "org-a",
  projectId: "project-a",
  principalId: "reviewer",
  principalType: "HUMAN" as const,
  capabilities: ["persona.approve", "persona.configure_authority"],
};
const intent: PersonaApprovalIntent = {
  ...authority,
  accountId: "account-a",
  action: "draft",
  target: "target-a",
  content: "draft text",
  version: 1,
  amountMicros: null,
  currency: null,
  makerPrincipalId: "maker",
};
test("scope denies absent tenant/project, cross-tenant, cross-project, cross-organization", () => {
  assert.throws(() => assertPersonaScope(null, intent, "persona.approve"));
  for (const field of ["tenantId", "projectId", "organizationId"]) {
    assert.throws(() =>
      assertPersonaScope(
        authority,
        { ...intent, [field]: "other" },
        "persona.approve",
      ),
    );
    assert.throws(() =>
      assertPersonaScope(
        authority,
        { ...intent, [field]: "" },
        "persona.approve",
      ),
    );
  }
});
test("AI cannot grant authority or approve itself even with a claimed capability", () => {
  for (const capability of authority.capabilities)
    assert.throws(
      () =>
        assertPersonaScope(
          { ...authority, principalType: "AI" },
          intent,
          capability,
        ),
      /HUMAN_REQUIRED/,
    );
  assert.throws(
    () =>
      assertPersonaScope(
        { ...authority, capabilities: [] },
        intent,
        "persona.approve",
      ),
    /CAPABILITY_DENIED/,
  );
});
test("approval binds exact content, target, account, version, amount, scope and human reviewer", () => {
  const receipt = {
    digest: personaIntentDigest(intent),
    reviewerPrincipalId: "reviewer",
    expiresAt: 200,
    status: "approved",
  };
  assertPersonaApproval(authority, intent, receipt, 100);
  for (const change of [
    { content: "changed" },
    { target: "changed" },
    { accountId: "changed" },
    { version: 2 },
    { amountMicros: 1, currency: "USD" },
    { projectId: "other" },
  ]) {
    assert.throws(() =>
      assertPersonaApproval(authority, { ...intent, ...change }, receipt, 100),
    );
  }
  assert.throws(() =>
    assertPersonaApproval(
      { ...authority, principalId: "maker" },
      intent,
      receipt,
      100,
    ),
  );
  assert.throws(() => assertPersonaApproval(authority, intent, receipt, 200));
  assert.throws(() =>
    assertPersonaApproval(
      authority,
      intent,
      { ...receipt, status: "model_says_approved" },
      100,
    ),
  );
});
test("unknown or unbound execution is denied, never enabled through actionContext", () => {
  assert.equal(
    legacyPersonaExecutionBlock("openai"),
    "PERSONA_PROVIDER_UNSUPPORTED",
  );
  assert.equal(
    legacyPersonaExecutionBlock("anthropic"),
    "PERSONA_SCOPE_AND_BUDGET_BINDING_REQUIRED",
  );
  const source = readFileSync(
    new URL("../src/lib/personaService.ts", import.meta.url),
    "utf8",
  );
  assert.ok(
    source.indexOf("const safetyBlock") <
      source.indexOf("const res = await entry.fn"),
  );
});
test("all existing writing tools are side effects", () => {
  const source = readFileSync(
    new URL("../src/lib/toolRegistry.ts", import.meta.url),
    "utf8",
  );
  assert.equal(source.includes("sideEffect: false"), false);
  for (const name of ["notification", "internal_msg", "blog_draft"])
    assert.match(
      source,
      new RegExp(`key: "${name}"[\\s\\S]*?sideEffect: true`),
    );
});
// Provider secret-reader changes are not part of this isolated release.
// Their coverage remains in the development checkout's original suite;
// this candidate tests only the persona modules actually shipped here.

// Transaction/row-lock double: no real DB, no network/provider invocation.
function fixture() {
  let tail = Promise.resolve();
  const rows: any[] = [];
  let unknown = "0";
  let failCommit = false;
  const pool = {
    async connect() {
      let releaseLock: (() => void) | undefined;
      return {
        release() {
          releaseLock?.();
          releaseLock = undefined;
        },
        async query(sql: string, args: any[] = []) {
          if (sql.includes("FOR UPDATE")) {
            const previous = tail;
            tail = new Promise<void>((resolve) => {
              releaseLock = resolve;
            });
            await previous;
            return { rows: [{ cap: "1000000" }] };
          }
          if (sql.startsWith("SELECT id,"))
            return { rows: rows.filter((r) => r.key === args[1]) };
          if (sql.includes("AS spent"))
            return {
              rows: [
                {
                  spent: String(rows.reduce((n, r) => n + Number(r.bound), 0)),
                  unknown,
                },
              ],
            };
          if (sql.startsWith("INSERT")) {
            const metadata = JSON.parse(args[1]).budgetReservationV1;
            const row = {
              id: rows.length + 1,
              key: metadata.requestKey,
              digest: metadata.intentDigest,
              bound: String(metadata.upperBoundMicros),
            };
            rows.push(row);
            return { rows: [row] };
          }
          if (sql === "COMMIT" && failCommit)
            throw new Error("synthetic SQL secret must not escape");
          return { rows: [] };
        },
      };
    },
  };
  return {
    pool: pool as any,
    rows,
    setUnknown() {
      unknown = "1";
    },
    setAmbiguousCommit() {
      failCommit = true;
    },
  };
}
const request = {
  personaId: 1,
  requestKey: "request-a",
  intentDigest: "a".repeat(64),
  upperBoundMicros: 600000,
};
test("parallel reservations do not exceed cap (transaction double)", async () => {
  const f = fixture();
  const outcomes = await Promise.allSettled([
    reservePersonaBudget(f.pool, request),
    reservePersonaBudget(f.pool, { ...request, requestKey: "request-b" }),
  ]);
  assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(f.rows.length, 1);
});
test("same request replays existing reservation, changed intent rejects", async () => {
  const f = fixture();
  const results = await Promise.all([
    reservePersonaBudget(f.pool, request),
    reservePersonaBudget(f.pool, request),
  ]);
  assert.equal(f.rows.length, 1);
  assert.equal(results[1].replay, true);
  await assert.rejects(
    reservePersonaBudget(f.pool, { ...request, intentDigest: "b".repeat(64) }),
    /REPLAY_CONFLICT/,
  );
});
test("unknown cost and missing bound deny before paid execution", async () => {
  const f = fixture();
  f.setUnknown();
  await assert.rejects(
    reservePersonaBudget(f.pool, request),
    /RECONCILIATION_REQUIRED/,
  );
  for (const cost of [NaN, 0, -1, Infinity])
    await assert.rejects(
      reservePersonaBudget(f.pool, { ...request, upperBoundMicros: cost }),
      /BOUND_REQUIRED/,
    );
  assert.equal(f.rows.length, 0);
});
test("ambiguous commit/timeout retains reservation and returns sanitized reconciliation error", async () => {
  const f = fixture();
  f.setAmbiguousCommit();
  await assert.rejects(reservePersonaBudget(f.pool, request), {
    message: "PERSONA_BUDGET_UNAVAILABLE_RECONCILE_BEFORE_RETRY",
  });
  assert.equal(f.rows.length, 1); // unknown outcome is NOT a free retry
});
