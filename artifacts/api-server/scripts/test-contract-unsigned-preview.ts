/** Real route middleware + renderer boundaries; synthetic DB/browser, no network/providers/writes. */
import assert from "node:assert/strict";
import { after, beforeEach, mock, test } from "node:test";
import net from "node:net";
import http from "node:http";
import express from "express";
import cookieParser from "cookie-parser";
import { PDFDocument } from "pdf-lib";
import { JSDOM } from "jsdom";
import { chromium } from "playwright-core";
import { PgDialect } from "drizzle-orm/pg-core";
import { buildUnsignedContractPreview, MAX_PREVIEW_TEMPLATE_BYTES, UNSIGNED_PREVIEW_LABEL } from "../src/lib/contractUnsignedPreview";
import { buildUnsignedPreviewPdf } from "../src/lib/contractPdf";
import { tryWithRenderLock, withRenderLock } from "../src/lib/renderLock";
import { csrfProtection } from "../src/middlewares/csrf";

process.env.NODE_ENV = "test";
process.env.ALLOW_LIVE_INTEGRATIONS = "false";
process.env.CONTRACT_PDF_TRUSTED_LOGO_URLS = "[]";
process.env.DATABASE_URL = "postgres://fixture:fixture@127.0.0.1:1/fasos_apply_local";
mock.method(globalThis, "fetch", () => { throw new Error("EXTERNAL_REQUEST_FORBIDDEN"); });
const { db, pool, contractTemplatesTable } = await import("@workspace/db");
mock.method(pool, "connect", () => { throw new Error("DATABASE_FORBIDDEN"); });
mock.method(pool, "query", () => { throw new Error("DATABASE_FORBIDDEN"); });
for (const method of ["insert", "update", "delete", "execute", "transaction"] as const) mock.method(db, method, () => { throw new Error("WRITE_FORBIDDEN"); });
const template = () => ({ id: 18, name: "TEST draft", version: 1, language: "en", isActive: false, publicationStatus: "draft", deletedAt: null as Date | null, brandProfileId: null,
  bodyHtml: '<style>.title{color:#143591}</style><h1 class="title">Agreement {{agency_name}}</h1><p>{{contract.signerEmail}}</p><img src="{{signature}}"><img src="data:image/png;base64,UFJJVkFURVNJR05BVFVSRQ=="><a href="https://example.invalid">Terms</a>',
  signingPageConfig: { brandName: "TEST BRAND", companySignatureDataUrl: "data:image/png;base64,UFJJVkFURVNJR05BVFVSRQ==", logoUrl: "https://not-allowed.example/logo.png" },
});
let current = template();
let reads = 0;
const dialect = new PgDialect();
mock.method(db, "select", () => ({ from(table: unknown) {
  assert.equal(table, contractTemplatesTable, "no agent/session/signature lookup");
  return { async where(condition: any) {
    reads++;
    const query = dialect.sqlToQuery(condition);
    assert.match(query.sql, /"deleted_at" is null/);
    return query.params[0] === current.id && !current.deletedAt ? [current] : [];
  } };
} }));
const fixturePdf = await PDFDocument.create();
fixturePdf.addPage([595, 842]);
const pdfBytes = await fixturePdf.save();
let failure: string | null = null;
let closed = 0;
let lastHtml = "";
mock.method(chromium, "launch", async (options: any) => {
  assert.equal(options.timeout, 30_000);
  return {
    async newPage() { return {
      async route() {},
      async setContent(html: string) { lastHtml = html; if (failure === "load") throw new Error("load failed"); },
      async pdf() { if (failure === "timeout") return new Promise(() => {}); return pdfBytes; },
      async close() {},
    }; },
    async close() { closed++; },
  };
});

const { default: router } = await import("../src/routes/contractTemplates");
const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(csrfProtection);
app.use((req, _res, next) => {
  const role = String(req.headers["x-test-role"] || "");
  if (role) req.user = { id: 999, role, isActive: req.headers["x-test-inactive"] !== "true", effectivePermissions: req.headers["x-test-denied"] ? [] : ["contract_templates.view"] } as any;
  next();
});
app.use("/api", router);
const server = app.listen(0, "127.0.0.1");
await new Promise<void>(resolve => server.once("listening", resolve));
const port = (server.address() as net.AddressInfo).port;
const originalConnect = net.Socket.prototype.connect;
mock.method(net.Socket.prototype, "connect", function (this: net.Socket, ...args: any[]) {
  const options = Array.isArray(args[0]) ? args[0][0] : args[0];
  assert.ok(options && options.host === "127.0.0.1" && Number(options.port) === port, "only isolated HTTP server is reachable");
  return originalConnect.apply(this, args as any);
});
const route = (router as any).stack.find((layer: any) => layer.route?.path === "/contract-templates/:id/unsigned-preview").route;
const limiter = route.stack[3].handle;
beforeEach(() => { current = template(); reads = 0; failure = null; closed = 0; lastHtml = ""; limiter.resetKey("unsigned-contract-preview"); });
after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await pool.end(); mock.restoreAll(); });

function request(body: unknown = { format: "html" }, role = "super_admin", extraHeaders: Record<string, string> = {}, id = "18") {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; bytes: Buffer; json: any }>((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request({ host: "127.0.0.1", port, path: `/api/contract-templates/${id}/unsigned-preview`, method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload), Cookie: "csrf_token=SYNTHETIC-TEST-CSRF", "x-csrf-token": "SYNTHETIC-TEST-CSRF", ...(role ? { "x-test-role": role } : {}), ...extraHeaders } }, res => {
      const chunks: Buffer[] = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => { const bytes = Buffer.concat(chunks); resolve({ status: res.statusCode!, headers: res.headers, bytes, json: res.headers["content-type"]?.includes("json") ? JSON.parse(bytes.toString()) : undefined }); });
    });
    req.on("error", reject); req.end(payload);
  });
}

test("real CSRF middleware rejects missing or mismatched tokens before preview lookup", async () => {
  assert.equal((await request({ format: "html" }, "super_admin", { "x-csrf-token": "" })).status, 403);
  assert.equal((await request({ format: "pdf" }, "super_admin", { "x-csrf-token": "wrong" })).status, 403);
  assert.equal(reads, 0);
});

test("preview route enforces active admin role and existing permission before any template lookup", async () => {
  assert.equal((await request({}, "")).status, 401);
  assert.equal((await request({}, "agent")).status, 403);
  assert.equal((await request({}, "staff")).status, 403);
  assert.equal((await request({}, "admin", { "x-test-inactive": "true" })).status, 403);
  assert.equal((await request({}, "admin", { "x-test-denied": "true" })).status, 403);
  assert.equal(reads, 0);
  assert.equal((await request({ format: "html" }, "admin")).status, 200);
});

test("saved inactive drafts preview with synthetic data, preserved CSS, CSP and no real signatures or links", async () => {
  const response = await request();
  assert.equal(response.status, 200);
  assert.equal(response.headers["cache-control"], "private, no-store");
  assert.equal(response.json.data.unsignedTestPreview, true);
  const html = response.json.data.html;
  assert.match(html, /\.title\{color:#143591\}/);
  assert.match(html, /TEST AGENCY/);
  assert.match(html, /unsigned-preview@example.invalid/);
  assert.match(html, /UNSIGNED TEST PREVIEW/);
  assert.match(html, /Content-Security-Policy/);
  assert.doesNotMatch(html, /UFJJVkFURVNJR05BVFVSRQ|src="https:|href=/);
  assert.equal(new JSDOM(html).window.document.images.length, 0);
  assert.equal(closed, 0, "HTML preview never launches Chromium");
});

test("preview refuses caller data, non-exact IDs and unsupported formats without reads", async () => {
  for (const body of [{ format: "html", agentId: 123 }, { format: "pdf", signerEmail: "real@example.invalid" }, { format: "signed" }, {}, [], { format: "html", intakeData: {} }]) assert.equal((await request(body)).status, 400);
  for (const id of ["18junk", "0", "-1"]) assert.equal((await request({ format: "html" }, "super_admin", {}, id)).status, 400);
  assert.equal(reads, 0);
});

test("deleted template and oversized template are rejected without rendering", async () => {
  current.deletedAt = new Date();
  assert.equal((await request()).status, 404);
  current = template(); current.bodyHtml = "x".repeat(MAX_PREVIEW_TEMPLATE_BYTES + 1);
  assert.equal((await request()).status, 413);
  assert.equal(closed, 0);
});

test("busy signing render yields immediate 429; preview is neither queued nor read", async () => {
  let release!: () => void;
  const held = withRenderLock(() => new Promise<void>(resolve => { release = resolve; }));
  await Promise.resolve();
  try {
    const response = await request();
    assert.equal(response.status, 429); assert.equal(reads, 0); assert.equal(response.headers["retry-after"], "5");
    assert.equal(tryWithRenderLock(async () => "must not run"), undefined);
  } finally { release(); await held; }
  assert.equal((await request()).status, 200);
});

test("unsigned PDF uses shared content, real page watermark and closes browser; no evidence page", async () => {
  const response = await request({ format: "pdf" });
  assert.equal(response.status, 200);
  assert.match(String(response.headers["content-type"]), /application\/pdf/);
  assert.match(String(response.headers["content-disposition"]), /UNSIGNED-TEST-template-18\.pdf/);
  assert.match(lastHtml, /UNSIGNED TEST PREVIEW/);
  assert.doesNotMatch(lastHtml, /Evidence hash|Delil Sayfası|UFJJVkFURVNJR05BVFVSRQ/);
  const pdf = await PDFDocument.load(response.bytes);
  assert.equal(pdf.getPageCount(), 1); assert.equal(pdf.getTitle(), "Unsigned contract TEST preview");
  assert.equal(closed, 1);
});

test("failed render closes browser and releases shared lock for the next request", async () => {
  failure = "load";
  assert.equal((await request({ format: "pdf" })).status, 503);
  assert.equal(closed, 1);
  failure = null;
  assert.equal((await request()).status, 200);
});

test("render timeout closes browser before releasing lock", async () => {
  const originalTimeout = globalThis.setTimeout;
  const timerMock = mock.method(globalThis, "setTimeout", ((callback: (...args: any[]) => void, delay: number, ...args: any[]) => originalTimeout(callback, delay > 10_000 ? 5 : delay, ...args)) as typeof setTimeout);
  failure = "timeout";
  try { await assert.rejects(withRenderLock(() => buildUnsignedPreviewPdf("<p>TEST</p>")), /timed out/); }
  finally { timerMock.mock.restore(); }
  assert.equal(closed, 1);
  assert.equal(await tryWithRenderLock(async () => "released"), "released");
});

test("preview rate budget is bounded and uses no durable writes", async () => {
  for (let i = 0; i < 10; i++) assert.equal((await request({}, "super_admin")).status, 400);
  assert.equal((await request()).status, 429);
  assert.equal(reads, 0);
});

test("HTML preview supports custom TEST fields and RTL without prototype or signature leakage", async () => {
  const html = await buildUnsignedContractPreview('<style>.box{background:#eef}</style><p class="box">{{custom.field}} {{constructor.name}} {{signature}}</p>', "ar", null);
  const dom = new JSDOM(html);
  try {
    assert.equal(dom.window.document.documentElement.dir, "rtl");
    assert.match(dom.window.document.body.textContent!, /TEST PREVIEW/);
    assert.match(dom.window.document.body.textContent!, new RegExp(UNSIGNED_PREVIEW_LABEL));
    assert.doesNotMatch(html, /function Object|\[native code\]/);
  } finally { dom.window.close(); }
});
