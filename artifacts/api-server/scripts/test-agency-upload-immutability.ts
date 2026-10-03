/** Real PUT handler, signed synthetic tickets and temporary files; no DB/provider. */
import assert from "node:assert/strict";
import { after, mock, test, type TestContext } from "node:test";
import * as fs from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import net from "node:net";
import { createHash } from "node:crypto";
import type { Request, Response } from "express";
import sharp from "sharp";

process.env.NODE_ENV = "test";
process.env.ALLOW_LIVE_INTEGRATIONS = "false";
process.env.STORAGE_DRIVER = "local";
process.env.DATABASE_URL = "postgres://synthetic:synthetic@127.0.0.1:1/fasos_apply_local";
process.env.AGENT_APPLICATION_TOKEN_SECRET = "synthetic-agency-upload-test-secret";
mock.method(net.Socket.prototype, "connect", () => { throw new Error("NETWORK_FORBIDDEN"); });
mock.method(globalThis, "fetch", () => { throw new Error("PROVIDER_FORBIDDEN"); });
const { db, pool } = await import("@workspace/db");
mock.method(pool, "connect", () => { throw new Error("DATABASE_FORBIDDEN"); });
mock.method(pool, "query", () => { throw new Error("DATABASE_FORBIDDEN"); });
for (const method of ["select", "insert", "update", "delete", "execute", "transaction"] as const) {
  mock.method(db, method, () => { throw new Error("DATABASE_FORBIDDEN"); });
}
const { ObjectStorageService } = await import("../src/lib/objectStorage");
mock.method(ObjectStorageService.prototype, "overwriteObjectBuffer", () => { throw new Error("OVERWRITE_FORBIDDEN"); });
const { agentApplicationUploadPrefix, issueAgentApplicationUploadTicket } = await import("../src/lib/agentApplicationTokens");
const { default: router } = await import("../src/routes/agentApplications");
type Handler = (req: Request, res: Response) => Promise<void>;
const route = (router as unknown as { stack: Array<{ route?: { path: string; stack: Array<{ handle: Handler }> } }> })
  .stack.find(layer => layer.route?.path === "/public/agent-applications/uploads/local/:encoded")?.route;
assert.ok(route);
const handler = route.stack.at(-1)!.handle;
const email = "synthetic-applicant@example.test";
const relativePath = `${agentApplicationUploadPrefix(email)}/logo/fixture-object`;
const objectPath = `/objects/${relativePath}`;
const encoded = Buffer.from(relativePath).toString("base64url");
const png = await sharp({ create: { width: 32, height: 32, channels: 3, background: "#173b92" } }).png().toBuffer();
const otherPng = await sharp({ create: { width: 32, height: 32, channels: 3, background: "#ffffff" } }).png().toBuffer();
const ticket = () => issueAgentApplicationUploadTicket({ email, objectPath, documentKind: "logo" });
after(async () => { await pool.end(); mock.restoreAll(); });

async function fixture(context: TestContext) {
  const root = await fs.mkdtemp(path.join(tmpdir(), "fas-agency-immutable-"));
  process.env.STORAGE_LOCAL_DIR = root;
  context.after(async () => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(tmpdir()));
    assert.ok(path.basename(root).startsWith("fas-agency-immutable-"));
    await fs.rm(root, { recursive: true, force: true });
  });
  return root;
}
async function invoke(body = png, uploadTicket = ticket(), key = encoded, mime = "image/png") {
  let status = 200, response: unknown;
  const headers: Record<string, string> = {};
  const req = { body, params: { encoded: key }, headers: { "x-upload-ticket": uploadTicket, "content-type": mime, "x-file-name": "fixture.png" } } as unknown as Request;
  const res = {
    status(value: number) { status = value; return this; },
    json(value: unknown) { response = value; return this; },
    end() { return this; },
    setHeader(name: string, value: string) { headers[name.toLowerCase()] = value; return this; },
  } as unknown as Response;
  await handler(req, res);
  return { status, response, headers };
}

test("valid ticket publishes once; identical retries retain 204 without rewriting evidence", async context => {
  const root = await fixture(context);
  assert.equal((await invoke()).status, 204);
  const file = path.join(root, relativePath);
  const before = await fs.stat(file, { bigint: true });
  assert.equal((await invoke()).status, 204);
  const after = await fs.stat(file, { bigint: true });
  assert.equal(after.ino, before.ino);
  assert.equal(after.mtimeNs, before.mtimeNs);
  assert.deepEqual(await fs.readFile(file), png);
  assert.equal(await fs.readFile(`${file}.ct`, "utf8"), "image/png");
});

test("a still-valid ticket cannot replace previously uploaded application evidence", async context => {
  const root = await fixture(context);
  const uploadTicket = ticket();
  assert.equal((await invoke(png, uploadTicket)).status, 204);
  assert.equal((await invoke(otherPng, uploadTicket)).status, 409);
  assert.deepEqual(await fs.readFile(path.join(root, relativePath)), png);
});

test("missing, tampered, expired and cross-key tickets create no files", async context => {
  const root = await fixture(context);
  assert.equal((await invoke(png, "")).status, 403);
  assert.equal((await invoke(png, `${ticket()}tampered`)).status, 403);
  const clock = mock.method(Date, "now", () => 1);
  const expiredTicket = ticket();
  clock.mock.restore();
  assert.equal((await invoke(png, expiredTicket)).status, 403);
  assert.equal((await invoke(png, ticket(), Buffer.from(`${relativePath}-other`).toString("base64url"))).status, 403);
  assert.deepEqual(await fs.readdir(root), []);
});

test("invalid bytes and path aliases are rejected without publication", async context => {
  const root = await fixture(context);
  assert.equal((await invoke(Buffer.from("not an image"))).status, 400);
  const alias = `${agentApplicationUploadPrefix(email)}/logo/CON.txt`;
  const aliasTicket = issueAgentApplicationUploadTicket({ email, objectPath: `/objects/${alias}`, documentKind: "logo" });
  assert.equal((await invoke(png, aliasTicket, Buffer.from(alias).toString("base64url"))).status, 400);
  assert.deepEqual(await fs.readdir(root), []);
});

test("concurrent ticket reuse cannot mix or overwrite successful evidence", async context => {
  const root = await fixture(context);
  const results = await Promise.all([invoke(png), invoke(otherPng)]);
  assert.equal(results.filter(result => result.status === 204).length, 1);
  const denied = results.find(result => result.status !== 204)!;
  assert.ok([409, 503].includes(denied.status));
  if (denied.status === 503) assert.equal(denied.headers["retry-after"], "1");
  const winner = results[0].status === 204 ? png : otherPng;
  assert.deepEqual(await fs.readFile(path.join(root, relativePath)), winner);
});

test("abandoned publisher locks are not stolen; caller gets retryable busy response", async context => {
  const root = await fixture(context);
  const lock = path.join(root, path.dirname(relativePath), `.local-upload-${createHash("sha256").update(relativePath).digest("hex")}`);
  await fs.mkdir(lock, { recursive: true });
  const result = await invoke();
  assert.equal(result.status, 503);
  assert.equal(result.headers["retry-after"], "1");
  assert.equal((await fs.stat(lock)).isDirectory(), true);
});

test("disabled local driver and missing storage configuration fail closed", async context => {
  const root = await fixture(context);
  process.env.STORAGE_DRIVER = "replit";
  try { assert.equal((await invoke()).status, 404); }
  finally { process.env.STORAGE_DRIVER = "local"; }
  delete process.env.STORAGE_LOCAL_DIR;
  assert.equal((await invoke()).status, 503);
  assert.deepEqual(await fs.readdir(root), []);
});
