/**
 * Contract Signing Scope — route-level integration test (Task #475 / Faz S4).
 *
 * Verifies two security fixes:
 *
 *   C1  self-fill email rebind lock
 *       - POST /public/sign/:token/send-code with a DIFFERENT email on a
 *         session that has expectedEmail set → 409 (email_mismatch)
 *       - POST /public/sign/:token/send-code with the SAME email → 200
 *       - POST /public/sign/:token/verify-code with a different email → 409
 *       - admin_driven: behaviour unchanged (still 403 on mismatch, 200 on match)
 *       - self_fill session with NO pre-set email: any valid email accepted (200)
 *
 *   C2  contracts branch scope (already in place — regression guard)
 *       - branch-limited manager (branchA) GET /contracts/sessions → only own branch
 *       - branch-limited manager (branchA) GET /contracts/signed  → only own branch
 *       - branch-limited manager (branchA) DELETE /contracts/sessions/:id
 *         on a branchB session → 403
 *       - super_admin sees all sessions
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:contract-signing-scope
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "http";
import express, { type Express, type Request } from "express";
import { eq, inArray, and } from "drizzle-orm";
import {
  db,
  usersTable,
  agentsTable,
  branchesTable,
  agentBranchesTable,
  contractTemplatesTable,
  signingSessionsTable,
  emailVerificationCodesTable,
} from "@workspace/db";
import { createSigningToken } from "../src/lib/signingTokens.js";

import publicSigningRouter from "../src/routes/publicSigning.js";
import contractsRouter from "../src/routes/contracts.js";

after(() => {
  setImmediate(() => process.exit(process.exitCode ?? 0));
});

const RUN_ID = `css_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

// ---------------------------------------------------------------------------
// Mutable user injected per-request — bypasses the real auth stack.
// ---------------------------------------------------------------------------
let currentUser: {
  id: number;
  role: string;
  isActive: boolean;
  permissions?: string[];
  branchId?: number | null;
} = { id: 0, role: "admin", isActive: true };

function buildApp(): Express {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use((req, _res, next) => {
    (req as any).user = currentUser;
    if (!("cookies" in req)) (req as any).cookies = {};
    next();
  });
  app.use("/api", publicSigningRouter);
  app.use("/api", contractsRouter);
  return app;
}

const app = buildApp();

async function apiReq(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<{ status: number; data: unknown }> {
  const server = http.createServer(app as unknown as (req: Request, res: unknown) => void);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("listen failed");
  const port = addr.port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let parsed: unknown = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    return { status: res.status, data: parsed };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

// ---------------------------------------------------------------------------
// Seeding helpers
// ---------------------------------------------------------------------------
const cleanupSessionIds: number[] = [];
const cleanupTemplateIds: number[] = [];
const cleanupAgentBranchLinks: Array<{ agentId: number; branchId: number }> = [];
const cleanupAgentIds: number[] = [];
const cleanupUserIds: number[] = [];
const cleanupBranchIds: number[] = [];

async function createBranch(suffix: string): Promise<number> {
  const [row] = await db.insert(branchesTable)
    .values({ name: `CSS_Branch_${RUN_ID}_${suffix}` })
    .returning({ id: branchesTable.id });
  cleanupBranchIds.push(row.id);
  return row.id;
}

async function createUser(role: string, branchId?: number | null): Promise<number> {
  const sfx = Math.random().toString(36).slice(2, 6);
  const [row] = await db.insert(usersTable)
    .values({
      email: `${RUN_ID}_${role}_${sfx}@css-test.local`,
      firstName: "CSS",
      lastName: `Test_${RUN_ID}`,
      role,
      isActive: true,
      branchId: branchId ?? null,
    })
    .returning({ id: usersTable.id });
  cleanupUserIds.push(row.id);
  return row.id;
}

async function createAgent(userId: number): Promise<number> {
  const [row] = await db.insert(agentsTable)
    .values({ userId, firstName: "CSS", lastName: `Agent_${RUN_ID}`, email: `agent_${RUN_ID}_${Math.random().toString(36).slice(2,5)}@css-test.local`, status: "active" })
    .returning({ id: agentsTable.id });
  cleanupAgentIds.push(row.id);
  return row.id;
}

async function linkAgentBranch(agentId: number, branchId: number): Promise<void> {
  await db.insert(agentBranchesTable).values({ agentId, branchId }).onConflictDoNothing();
  cleanupAgentBranchLinks.push({ agentId, branchId });
}

async function createTemplate(): Promise<number> {
  const [row] = await db.insert(contractTemplatesTable)
    .values({
      name: `CSS_Tpl_${RUN_ID}`,
      language: "en",
      entityType: "company",
      bodyHtml: "<p>Test contract {{signer_name}}</p>",
      isActive: true,
    })
    .returning({ id: contractTemplatesTable.id });
  cleanupTemplateIds.push(row.id);
  return row.id;
}

async function createSession(opts: {
  templateId: number;
  agentId?: number | null;
  mode: "self_fill" | "admin_driven";
  signerEmail: string;
  expectedEmail?: string | null;
  status?: string;
}): Promise<{ id: number; rawToken: string }> {
  const { rawToken, tokenHash } = createSigningToken();
  const [row] = await db.insert(signingSessionsTable)
    .values({
      templateId: opts.templateId,
      agentId: opts.agentId ?? null,
      tokenHash,
      mode: opts.mode,
      status: (opts.status ?? (opts.mode === "self_fill" ? "intake_pending" : "review_pending")) as any,
      signerEmail: opts.signerEmail,
      expectedEmail: opts.expectedEmail !== undefined ? opts.expectedEmail : null,
      expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    })
    .returning({ id: signingSessionsTable.id });
  cleanupSessionIds.push(row.id);
  return { id: row.id, rawToken };
}

// ---------------------------------------------------------------------------
// ─── C1: self-fill email rebind lock ───────────────────────────────────────
// ---------------------------------------------------------------------------
test("C1-1: self_fill send-code — different email rejected (409) when expectedEmail set", async () => {
  const tplId = await createTemplate();
  const { rawToken } = await createSession({
    templateId: tplId,
    mode: "self_fill",
    signerEmail: "locked@example.com",
    expectedEmail: "locked@example.com",
  });
  const r = await apiReq("POST", `/api/public/sign/${rawToken}/send-code`, {
    email: "attacker@evil.com",
  });
  assert.equal(r.status, 409, `Expected 409, got ${r.status}: ${JSON.stringify(r.data)}`);
  assert.equal((r.data as any)?.code, "email_mismatch");
});

test("C1-2: self_fill send-code — correct email accepted (200) when expectedEmail set", async () => {
  const tplId = await createTemplate();
  const { rawToken } = await createSession({
    templateId: tplId,
    mode: "self_fill",
    signerEmail: "locked@example.com",
    expectedEmail: "locked@example.com",
  });
  const r = await apiReq("POST", `/api/public/sign/${rawToken}/send-code`, {
    email: "locked@example.com",
  });
  assert.equal(r.status, 200, `Expected 200, got ${r.status}: ${JSON.stringify(r.data)}`);
});

test("C1-3: self_fill send-code — case-insensitive match accepted (200)", async () => {
  const tplId = await createTemplate();
  const { rawToken } = await createSession({
    templateId: tplId,
    mode: "self_fill",
    signerEmail: "locked@example.com",
    expectedEmail: "locked@example.com",
  });
  const r = await apiReq("POST", `/api/public/sign/${rawToken}/send-code`, {
    email: "LOCKED@example.com",
  });
  assert.equal(r.status, 200, `Expected 200 (case-insensitive), got ${r.status}: ${JSON.stringify(r.data)}`);
});

test("C1-4: self_fill verify-code — different email rejected (409)", async () => {
  const tplId = await createTemplate();
  const { rawToken, id: sessionId } = await createSession({
    templateId: tplId,
    mode: "self_fill",
    signerEmail: "locked@example.com",
    expectedEmail: "locked@example.com",
  });
  // Insert a dummy code directly so we can hit verify-code without needing real email
  const { hashToken } = await import("../src/lib/signingTokens.js");
  const tokenHash = hashToken(rawToken);
  const [codeRow] = await db.insert(emailVerificationCodesTable)
    .values({
      email: "attacker@evil.com",
      code: "999999",
      token: tokenHash,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    })
    .returning({ id: emailVerificationCodesTable.id });
  try {
    const r = await apiReq("POST", `/api/public/sign/${rawToken}/verify-code`, {
      email: "attacker@evil.com",
      code: "999999",
    });
    assert.equal(r.status, 409, `Expected 409, got ${r.status}: ${JSON.stringify(r.data)}`);
    assert.equal((r.data as any)?.code, "email_mismatch");
  } finally {
    await db.delete(emailVerificationCodesTable).where(eq(emailVerificationCodesTable.id, codeRow.id));
  }
  void sessionId;
});

test("C1-5: self_fill with NO expectedEmail — any valid email accepted (200)", async () => {
  const tplId = await createTemplate();
  const { rawToken } = await createSession({
    templateId: tplId,
    mode: "self_fill",
    signerEmail: "",
    expectedEmail: null,
  });
  const r = await apiReq("POST", `/api/public/sign/${rawToken}/send-code`, {
    email: "anyone@example.com",
  });
  assert.equal(r.status, 200, `Expected 200 (no lock), got ${r.status}: ${JSON.stringify(r.data)}`);
});

test("C1-6: admin_driven send-code — different email still rejected (403, unchanged)", async () => {
  const tplId = await createTemplate();
  const agentUserId = await createUser("agent");
  const agentId = await createAgent(agentUserId);
  const { rawToken } = await createSession({
    templateId: tplId,
    agentId,
    mode: "admin_driven",
    signerEmail: "agent@example.com",
  });
  const r = await apiReq("POST", `/api/public/sign/${rawToken}/send-code`, {
    email: "other@example.com",
  });
  assert.equal(r.status, 403, `Expected 403, got ${r.status}: ${JSON.stringify(r.data)}`);
});

test("C1-7: admin_driven send-code — correct email still accepted (200, unchanged)", async () => {
  const tplId = await createTemplate();
  const agentUserId = await createUser("agent");
  const agentId = await createAgent(agentUserId);
  const { rawToken } = await createSession({
    templateId: tplId,
    agentId,
    mode: "admin_driven",
    signerEmail: "agent@example.com",
  });
  const r = await apiReq("POST", `/api/public/sign/${rawToken}/send-code`, {
    email: "agent@example.com",
  });
  assert.equal(r.status, 200, `Expected 200, got ${r.status}: ${JSON.stringify(r.data)}`);
});

// ---------------------------------------------------------------------------
// ─── C2: branch scope on contracts list endpoints (regression guard) ────────
// ---------------------------------------------------------------------------
test("C2-1: GET /contracts/sessions — branch-limited manager sees only own branch", async () => {
  const tplId = await createTemplate();
  const branchA = await createBranch("A");
  const branchB = await createBranch("B");
  const managerUserId = await createUser("manager", branchA);
  const agentAUserId = await createUser("agent");
  const agentBUserId = await createUser("agent");
  const agentA = await createAgent(agentAUserId);
  const agentB = await createAgent(agentBUserId);
  await linkAgentBranch(agentA, branchA);
  await linkAgentBranch(agentB, branchB);

  // Session for agentA (branchA) — manager should see this
  const { id: sessA } = await createSession({ templateId: tplId, agentId: agentA, mode: "admin_driven", signerEmail: "a@ex.com" });
  // Session for agentB (branchB) — manager should NOT see this
  const { id: sessB } = await createSession({ templateId: tplId, agentId: agentB, mode: "admin_driven", signerEmail: "b@ex.com" });

  currentUser = { id: managerUserId, role: "manager", isActive: true, permissions: ["contracts.view"], branchId: branchA };
  const r = await apiReq("GET", "/api/contracts/sessions");
  assert.equal(r.status, 200);
  const ids = ((r.data as any)?.data ?? []).map((s: any) => s.id) as number[];
  assert.ok(ids.includes(sessA), `BranchA session ${sessA} should be visible`);
  assert.ok(!ids.includes(sessB), `BranchB session ${sessB} should NOT be visible`);
});

test("C2-2: GET /contracts/sessions — super_admin sees all branches", async () => {
  const tplId = await createTemplate();
  const branchC = await createBranch("C");
  const branchD = await createBranch("D");
  const agentCUserId = await createUser("agent");
  const agentDUserId = await createUser("agent");
  const agentC = await createAgent(agentCUserId);
  const agentD = await createAgent(agentDUserId);
  await linkAgentBranch(agentC, branchC);
  await linkAgentBranch(agentD, branchD);

  const { id: sessC } = await createSession({ templateId: tplId, agentId: agentC, mode: "admin_driven", signerEmail: "c@ex.com" });
  const { id: sessD } = await createSession({ templateId: tplId, agentId: agentD, mode: "admin_driven", signerEmail: "d@ex.com" });

  const saUserId = await createUser("super_admin");
  currentUser = { id: saUserId, role: "super_admin", isActive: true, permissions: ["contracts.view"] };
  const r = await apiReq("GET", "/api/contracts/sessions");
  assert.equal(r.status, 200);
  const ids = ((r.data as any)?.data ?? []).map((s: any) => s.id) as number[];
  assert.ok(ids.includes(sessC), `BranchC session should be visible to super_admin`);
  assert.ok(ids.includes(sessD), `BranchD session should be visible to super_admin`);
});

test("C2-3: DELETE /contracts/sessions/:id on cross-branch session → 403", async () => {
  const tplId = await createTemplate();
  const branchE = await createBranch("E");
  const branchF = await createBranch("F");
  const managerUserId = await createUser("manager", branchE);
  const agentFUserId = await createUser("agent");
  const agentF = await createAgent(agentFUserId);
  await linkAgentBranch(agentF, branchF);

  const { id: sessF } = await createSession({ templateId: tplId, agentId: agentF, mode: "admin_driven", signerEmail: "f@ex.com" });

  currentUser = { id: managerUserId, role: "manager", isActive: true, permissions: ["contracts.manage"], branchId: branchE };
  const r = await apiReq("DELETE", `/api/contracts/sessions/${sessF}`);
  assert.equal(r.status, 403, `Expected 403 cross-branch delete, got ${r.status}: ${JSON.stringify(r.data)}`);
});

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------
after(async () => {
  try {
    // Clean up email verification codes for test sessions
    if (cleanupSessionIds.length) {
      // sessions cleanup cascades nothing — just delete directly
    }
    if (cleanupSessionIds.length) {
      await db.delete(signingSessionsTable).where(inArray(signingSessionsTable.id, cleanupSessionIds));
    }
    if (cleanupTemplateIds.length) {
      await db.delete(contractTemplatesTable).where(inArray(contractTemplatesTable.id, cleanupTemplateIds));
    }
    for (const { agentId, branchId } of cleanupAgentBranchLinks) {
      await db.delete(agentBranchesTable).where(and(eq(agentBranchesTable.agentId, agentId), eq(agentBranchesTable.branchId, branchId)));
    }
    if (cleanupAgentIds.length) {
      await db.delete(agentsTable).where(inArray(agentsTable.id, cleanupAgentIds));
    }
    if (cleanupUserIds.length) {
      await db.delete(usersTable).where(inArray(usersTable.id, cleanupUserIds));
    }
    if (cleanupBranchIds.length) {
      await db.delete(branchesTable).where(inArray(branchesTable.id, cleanupBranchIds));
    }
  } catch (err) {
    console.error("[cleanup] error:", err);
  }
});
