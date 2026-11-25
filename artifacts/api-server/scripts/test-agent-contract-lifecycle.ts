/** Runs the actual reconciliation command against a serializing, rollback-capable DB double. No DB or provider calls. */
import assert from "node:assert/strict";
import { after, beforeEach, mock, test } from "node:test";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { agentSignedContractSummary } from "../src/lib/agentSignedContractSummary";

process.env.DATABASE_URL = "postgres://fixture:fixture@127.0.0.1:1/contract_fixture";
process.env.NODE_ENV = "test";
const schema = await import("@workspace/db");
const { db, pool } = schema;
mock.method(pool, "connect", () => { throw new Error("REAL_DATABASE_FORBIDDEN"); });
mock.method(pool, "query", () => { throw new Error("REAL_DATABASE_FORBIDDEN"); });
mock.method(db, "select", () => { throw new Error("READ_OUTSIDE_LOCKED_TRANSACTION"); });
const { reconcileAgentApplicationSignature, reconcileAgentApplicationRestriction } = await import("../src/lib/agentApplicationLifecycle");

type Row = Record<string, any>;
let application: Row, session: Row, signed: Row | null, agent: Row;
let writes: string[], failAgentWrite: boolean;
let lockTail = Promise.resolve();
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };
const chain = (value: () => unknown) => {
  const query: any = { then: (resolve: any, reject: any) => Promise.resolve().then(value).then(resolve, reject) };
  for (const method of ["where", "innerJoin", "limit"]) query[method] = () => query;
  return query;
};

mock.method(db, "transaction", async (callback: (tx: any) => Promise<any>) => {
  let release: (() => void) | undefined;
  let snapshot: any;
  const tx = {
    execute: async (statement: Parameters<PgDialect["sqlToQuery"]>[0]) => {
      const query = new PgDialect().sqlToQuery(statement);
      assert.match(query.sql, /SELECT id FROM agent_applications WHERE id = \$1 FOR UPDATE/);
      assert.deepEqual(query.params, [12]);
      const previous = lockTail;
      const held = deferred();
      lockTail = held.promise;
      await previous;
      release = held.resolve;
      snapshot = structuredClone({ application, agent, writes });
    },
    select: () => ({ from: (table: unknown) => chain(() => {
      assert.ok(release, "all reads must follow the same application row lock used by approval");
      if (table === schema.agentApplicationsTable) return [structuredClone(application)];
      if (table === schema.agentsTable) return [structuredClone(agent)];
      if (table === schema.signingSessionsTable) return [structuredClone(session)];
      if (table === schema.signedContractsTable) return signed ? [structuredClone(signed)] : [];
      throw new Error("Unexpected table");
    }) }),
    update: (table: unknown) => ({ set: (values: Row) => ({ where: async () => {
      assert.ok(release);
      if (table === schema.agentApplicationsTable) { application = { ...application, ...values }; writes.push("application"); }
      else if (table === schema.agentsTable) {
        if (failAgentWrite) throw new Error("SYNTHETIC_WRITE_FAILURE");
        agent = { ...agent, ...values }; writes.push("agent");
      } else throw new Error("Unexpected update");
    } }) }),
  };
  try { return await callback(tx); }
  catch (error) { if (snapshot) { application = snapshot.application; agent = snapshot.agent; writes = snapshot.writes; } throw error; }
  finally { release?.(); }
});

beforeEach(() => {
  application = { id: 12, signingSessionId: 44, approvedAgentId: null, provisionalAgentId: 7, status: "awaiting_signature", contractTemplateId: 3, email: "agency@example.test", contractDataHash: "TEST-HASH", submittedAt: new Date("2026-01-01") };
  session = { id: 44, status: "signed", signedAt: new Date("2026-01-02"), subjectType: "agent_application", subjectId: 12, templateId: 3, verifiedEmail: "agency@example.test", intakeData: { agentApplicationContractHash: "TEST-HASH" } };
  signed = { id: 88 };
  agent = { id: 7, status: "provisional", accessTier: "provisional" };
  writes = []; failAgentWrite = false; lockTail = Promise.resolve();
});
after(async () => { mock.restoreAll(); await pool.end(); });

test("reconciliation records signature without activating commercial access", async () => {
  await reconcileAgentApplicationSignature(12);
  assert.equal(application.status, "signed");
  assert.equal(application.signedContractId, 88);
  assert.equal(application.portalAccessStatus, "signed_pending_approval");
  assert.equal(agent.accessTier, "provisional");
});

test("approval holding the row lock wins over queued reconciliation", async () => {
  const entered = deferred(), finish = deferred();
  const approval = db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM agent_applications WHERE id = ${12} FOR UPDATE`);
    entered.resolve();
    await finish.promise;
    application = { ...application, status: "approved", approvedAgentId: 7, portalAccessStatus: "active" };
    agent = { ...agent, status: "active", accessTier: "full" };
  });
  await entered.promise;
  const reconciliation = reconcileAgentApplicationSignature(12);
  finish.resolve();
  await Promise.all([approval, reconciliation]);
  assert.equal(application.status, "approved");
  assert.equal(agent.accessTier, "full");
  assert.deepEqual(writes, []);
});

test("repeated reconciliation never changes an already approved account", async () => {
  application.approvedAgentId = 7; application.status = "approved";
  agent.accessTier = "full";
  await Promise.all([reconcileAgentApplicationSignature(12), reconcileAgentApplicationSignature(12)]);
  assert.equal(agent.accessTier, "full"); assert.deepEqual(writes, []);
});

test("rejected and changes-requested applications cannot be revived by a signed session", async () => {
  for (const status of ["rejected", "changes_requested"]) {
    application.status = status;
    await reconcileAgentApplicationSignature(12);
    assert.equal(application.status, status);
  }
  assert.deepEqual(writes, []);
});

test("changed content or another application's signing evidence cannot reconcile", async () => {
  session.intakeData.agentApplicationContractHash = "OTHER-HASH";
  await reconcileAgentApplicationSignature(12);
  session.intakeData.agentApplicationContractHash = "TEST-HASH";
  session.subjectId = 99;
  await reconcileAgentApplicationSignature(12);
  assert.deepEqual(writes, []);
});

test("failed account write rolls back the signed application projection", async () => {
  failAgentWrite = true;
  await assert.rejects(reconcileAgentApplicationSignature(12), /SYNTHETIC_WRITE_FAILURE/);
  assert.equal(application.status, "awaiting_signature"); assert.deepEqual(writes, []);
});

test("deadline enforcement waiting behind approval returns fresh full access and cannot restrict it", async () => {
  application.contractDeadlineAt = new Date("2020-01-01");
  session.status = "expired"; signed = null;
  const entered = deferred(), finish = deferred();
  const approval = db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM agent_applications WHERE id = ${12} FOR UPDATE`);
    entered.resolve(); await finish.promise;
    application = { ...application, status: "approved", approvedAgentId: 7, portalAccessStatus: "active" };
    agent = { ...agent, status: "active", accessTier: "full" };
  });
  await entered.promise;
  const restriction = reconcileAgentApplicationRestriction(12, 7);
  finish.resolve();
  const [, current] = await Promise.all([approval, restriction]);
  assert.equal(current?.agent.accessTier, "full");
  assert.equal(current?.application.portalAccessStatus, "active");
  assert.deepEqual(writes, []);
});

test("expired unsigned provisional account is restricted, but signed account is not", async () => {
  application.contractDeadlineAt = new Date("2020-01-01");
  await reconcileAgentApplicationRestriction(12, 7);
  assert.equal(agent.accessTier, "provisional");
  assert.deepEqual(writes, []);
  session.status = "expired"; signed = null;
  const current = await reconcileAgentApplicationRestriction(12, 7);
  assert.equal(current?.agent.accessTier, "restricted");
  assert.equal(current?.application.accessRestrictionReason, "contract_expired");
});

test("restriction rejects another agency's application without changing either record", async () => {
  application.provisionalAgentId = 99;
  application.contractDeadlineAt = new Date("2020-01-01");
  assert.equal(await reconcileAgentApplicationRestriction(12, 7), null);
  assert.deepEqual(writes, []);
});

const contract = (pdfObjectKey: string | null) => ({ signed: { agentId: 7, signingSessionId: 44, signedAt: new Date("2026-01-02"), pdfObjectKey }, session: { id: 44, status: "signed" } });
test("signed contract stays visible while PDF is pending or its cache is regenerated", () => {
  assert.equal(agentSignedContractSummary(7, contract(null))?.status, "signed");
  assert.equal(agentSignedContractSummary(7, contract(null))?.pdfStatus, "pending");
  assert.equal(agentSignedContractSummary(7, contract(null))?.downloadUrl, null);
});
test("ready PDF uses authenticated own-contract route without exposing storage keys", () => {
  const summary = agentSignedContractSummary(7, contract("/objects/private-test.pdf"));
  assert.equal(summary?.downloadUrl, "/api/contracts/me/pdf");
  assert.equal(summary?.pdfStatus, "ready");
  assert.ok(!JSON.stringify(summary).includes("private-test"));
});
test("different owner, mismatched session and unsigned records never yield a signed summary", () => {
  assert.equal(agentSignedContractSummary(8, contract(null)), null);
  const other = contract(null); other.session.id = 99;
  assert.equal(agentSignedContractSummary(7, other), null);
  other.session.id = 44; other.session.status = "review_pending";
  assert.equal(agentSignedContractSummary(7, other), null);
  assert.equal(agentSignedContractSummary(7, null), null);
});
