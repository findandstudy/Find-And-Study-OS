/** Actual legacy route handlers, synthetic query executor, no DB/network/mail. */
import assert from "node:assert/strict";
import { after, beforeEach, mock, test } from "node:test";
import net from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import type { Request, Response } from "express";
import ExcelJS from "exceljs";
import { agentColumns, AGENTS_KIND, buildWorkbookBuffer } from "../src/lib/exportImportExcel";

process.env.NODE_ENV = "test";
process.env.ALLOW_LIVE_INTEGRATIONS = "false";
process.env.DATABASE_URL = "postgres://fixture:fixture@127.0.0.1:1/fasos_apply_local";
mock.method(net.Socket.prototype, "connect", () => { throw new Error("NETWORK_FORBIDDEN"); });
mock.method(globalThis, "fetch", () => { throw new Error("PROVIDER_FORBIDDEN"); });
const schema = await import("@workspace/db");
const { db, pool, contractTemplatesTable, agentsTable, auditLogsTable } = schema;
mock.method(pool, "connect", () => { throw new Error("DATABASE_FORBIDDEN"); });
mock.method(pool, "query", () => { throw new Error("DATABASE_FORBIDDEN"); });
for (const method of ["update", "delete", "execute", "transaction"] as const) {
  mock.method(db, method, () => { throw new Error("BUSINESS_WRITE_FORBIDDEN"); });
}

type Template = { id: number; name: string; language: string; entityType: string; version: number; isActive: boolean; publicationStatus: string; deletedAt: Date | null; brandProfileId: null; signingPageConfig: null };
const template = (overrides: Partial<Template> = {}): Template => ({ id: 4, name: "TEST published", language: "en", entityType: "company", version: 1, isActive: true, publicationStatus: "published", deletedAt: null, brandProfileId: null, signingPageConfig: null, ...overrides });
const blockedVariants: Array<[string, Partial<Template>]> = [
  ["draft", { publicationStatus: "draft" }],
  ["review pending", { publicationStatus: "review_pending" }],
  ["archived", { publicationStatus: "archived" }],
  ["inactive", { isActive: false }],
  ["deleted", { deletedAt: new Date("2026-01-01") }],
];
let templates: Template[], selectedIds: number[][], insertedAgents: unknown[];
let currentAgent: Record<string, unknown> | null;
const dialect = new PgDialect();
const columns: Record<string, keyof Template> = { id: "id", language: "language", entity_type: "entityType", version: "version", is_active: "isActive", publication_status: "publicationStatus", deleted_at: "deletedAt" };

// Evaluate the route's actual generated predicate. An omitted guard really
// admits the bad fixture, rather than being hidden by a pre-filtered DB mock.
function matchingTemplates(condition: SQL): Template[] {
  const query = dialect.sqlToQuery(condition);
  return templates.filter(row => {
    for (const match of query.sql.matchAll(/"contract_templates"\."([a-z_]+)" = \$(\d+)/g)) {
      assert.ok(columns[match[1]], `unsupported predicate column ${match[1]}`);
      if (row[columns[match[1]]] !== query.params[Number(match[2]) - 1]) return false;
    }
    if (/"contract_templates"\."deleted_at" is null/.test(query.sql) && row.deletedAt !== null) return false;
    return true;
  });
}

mock.method(db, "select", () => ({ from(table: unknown) {
  let condition: SQL, limit = Infinity;
  const chain: any = {
    where(value: SQL) { condition = value; return chain; },
    orderBy() { return chain; },
    limit(value: number) { limit = value; return chain; },
    then(resolve: any, reject: any) { return Promise.resolve().then(() => {
      if (table === contractTemplatesTable) {
        const rows = matchingTemplates(condition).sort((a, b) => b.version - a.version).slice(0, limit);
        selectedIds.push(rows.map(row => row.id));
        return rows;
      }
      if (table === agentsTable) return currentAgent ? [currentAgent] : [];
      throw new Error("UNEXPECTED_READ");
    }).then(resolve, reject); },
  };
  return chain;
} }));
mock.method(db, "insert", (table: unknown) => ({ values(value: unknown) {
  if (table === auditLogsTable) return Promise.resolve();
  assert.equal(table, agentsTable, "no signing session or delivery can be created by the fixture");
  insertedAgents.push(value);
  return { returning: async () => [{ id: 888 }] };
} }));

const { default: agentsRouter } = await import("../src/routes/agents");
const { default: onboardingRouter } = await import("../src/routes/agentOnboarding");
type Handler = (req: Request, res: Response) => Promise<void>;
function handler(router: unknown, path: string, method: string): Handler {
  const route = (router as { stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: Handler }> } }> })
    .stack.find(layer => layer.route?.path === path && layer.route.methods[method])?.route;
  assert.ok(route, `missing real route ${method} ${path}`);
  return route.stack.at(-1)!.handle;
}
const create = handler(agentsRouter, "/agents", "post");
const catalog = handler(agentsRouter, "/agents/template", "get");
const importAgents = handler(agentsRouter, "/agents/import", "post");
const resend = handler(onboardingRouter, "/contracts/agent/:agentId/resend-onboarding", "post");

async function invoke(run: Handler, body: unknown = {}) {
  let status = 200, response: any;
  const req = { body, params: { agentId: "7" }, query: {}, user: { id: 11, role: "super_admin", branchId: null }, ip: "127.0.0.1" } as unknown as Request;
  const res = {
    status(value: number) { status = value; return this; },
    json(value: unknown) { response = value; return this; },
    send(value: unknown) { response = value; return this; },
    setHeader() { return this; },
  } as unknown as Response;
  await run(req, res);
  return { status, response };
}
beforeEach(() => {
  templates = [template()]; selectedIds = []; insertedAgents = [];
  currentAgent = { id: 7, email: "synthetic@example.test", preferredContractLanguage: "en", entityType: "company", assignedContractTemplateId: null };
});
after(async () => { await pool.end(); mock.restoreAll(); });

for (const [name, state] of blockedVariants) {
  test(`${name} templates cannot be selected for new agencies, explicit resend or assigned resend`, async () => {
    templates = [template(state), template({ id: 5, name: "TEST alternative published" })];
    assert.equal((await invoke(create, { firstName: "TEST", lastName: "Only", email: "synthetic@example.test", assignedContractTemplateId: 4 })).status, 404);
    assert.equal((await invoke(resend, { templateId: 4 })).status, 404);
    currentAgent!.assignedContractTemplateId = 4;
    assert.equal((await invoke(resend)).status, 404);
    assert.deepEqual(selectedIds, [[], [], []], "an unavailable exact assignment must not silently select another agreement");
    assert.deepEqual(insertedAgents, []);
  });
}

test("language/type fallback ignores newer drafts, archived, inactive and deleted rows", async () => {
  templates = [template(), ...blockedVariants.map(([, state], index) => template({ id: index + 10, version: index + 100, ...state })), template({ id: 30, version: 900, language: "tr" }), template({ id: 31, version: 901, entityType: "individual" })];
  const result = await invoke(resend);
  assert.equal(result.status, 409, "eligible template reaches the existing no-company-signature guard");
  assert.match(result.response.error, /no official company signature/);
  assert.deepEqual(selectedIds, [[4]]);
  assert.deepEqual(insertedAgents, []);
});

test("fallback with no eligible published template stops before creating a session", async () => {
  templates = blockedVariants.map(([, state], index) => template({ id: index + 10, ...state }));
  assert.equal((await invoke(resend)).status, 404);
  assert.deepEqual(selectedIds, [[]]);
});

test("published active exact selections retain the normal signature preflight", async () => {
  assert.equal((await invoke(create, { firstName: "TEST", lastName: "Only", email: "synthetic@example.test", assignedContractTemplateId: 4 })).status, 409);
  assert.equal((await invoke(resend, { templateId: 4 })).status, 409);
  currentAgent!.assignedContractTemplateId = 4;
  assert.equal((await invoke(resend)).status, 409);
  assert.deepEqual(selectedIds, [[4], [4], [4]]);
  assert.deepEqual(insertedAgents, []);
});

test("downloadable import catalog lists only published active non-deleted templates", async () => {
  currentAgent = null;
  templates.push(...blockedVariants.map(([, state], index) => template({ id: index + 10, name: `TEST blocked ${index}`, ...state })));
  const result = await invoke(catalog);
  assert.equal(result.status, 200);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(result.response);
  const sheet = workbook.getWorksheet("Contract templates")!;
  assert.ok(sheet);
  assert.equal(sheet.rowCount, 2);
  assert.equal(sheet.getCell("A2").value, 4);
  assert.equal(sheet.getCell("B2").value, "TEST published");
  assert.deepEqual(selectedIds, [[4]]);
});

test("actual workbook import rejects unavailable template references and retains valid imports", async () => {
  currentAgent = null;
  templates.push(...blockedVariants.map(([, state], index) => template({ id: index + 10, ...state })));
  const buffer = await buildWorkbookBuffer({
    sheets: [{ name: "Agents", columns: agentColumns(), rows: templates.map(row => ({ firstName: "TEST", lastName: "Only", email: `synthetic-${row.id}@example.test`, assignedContractTemplateId: row.id })) }],
    meta: { kind: AGENTS_KIND, version: "1", exportedAt: new Date().toISOString() },
  });
  const result = await invoke(importAgents, buffer);
  assert.equal(result.status, 200);
  assert.equal(result.response.created, 1);
  assert.equal(result.response.errors, blockedVariants.length);
  assert.equal(insertedAgents.length, 1);
  assert.equal((insertedAgents[0] as Record<string, unknown>).assignedContractTemplateId, 4);
  assert.deepEqual(selectedIds, [[4], ...blockedVariants.map(() => [])]);
});
