/** Real temporary public logo objects; all network/DB/provider access prohibited. */
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, mock, test } from "node:test";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import fsPromises from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { tmpdir } from "node:os";
import net from "node:net";
import sharp from "sharp";
import { captureContractLogoSnapshot, validateContractLogoSnapshot, MAX_CONTRACT_LOGO_BYTES } from "../src/lib/contractPdfAssets";
import { ObjectStorageService } from "../src/lib/objectStorage";

const origin = "https://staging.example.test";
const keys = ["STORAGE_DRIVER", "STORAGE_LOCAL_DIR", "APP_BASE_URL", "ALLOW_LIVE_INTEGRATIONS", "CONTRACT_PDF_TRUSTED_LOGO_URLS"] as const;
const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
let root: string, png: Buffer;
const digest = (value: Buffer) => createHash("sha256").update(value).digest("hex");
const filename = (hash: string) => `contract-logo-${hash}.png`;
const logoUrl = (hash: string) => `${origin}/api/storage/public-branding/embed-widget/${filename(hash)}`;
const logoFile = (hash: string) => path.join(root, "branding", "embed-widget", filename(hash));
const allow = (url: string) => { process.env.CONTRACT_PDF_TRUSTED_LOGO_URLS = JSON.stringify([url]); };
const linuxOffline = { skip: process.platform !== "linux" ? "Offline logo capture requires Linux descriptor-path verification" : false };

before(async () => {
  png = await sharp({ create: { width: 40, height: 16, channels: 4, background: "#173b92" } }).png().toBuffer();
});
beforeEach(async () => {
  mock.method(net.Socket.prototype, "connect", () => { throw new Error("NETWORK_FORBIDDEN"); });
  mock.method(globalThis, "fetch", () => { throw new Error("PROVIDER_FORBIDDEN"); });
  root = await fs.mkdtemp(path.join(tmpdir(), "fas-contract-logo-"));
  await fs.mkdir(path.join(root, "branding", "embed-widget"), { recursive: true });
  process.env.STORAGE_DRIVER = "local";
  process.env.STORAGE_LOCAL_DIR = root;
  process.env.APP_BASE_URL = origin;
  process.env.ALLOW_LIVE_INTEGRATIONS = "false";
  delete process.env.CONTRACT_PDF_TRUSTED_LOGO_URLS;
});
afterEach(async () => {
  assert.equal(path.dirname(path.resolve(root)), path.resolve(tmpdir()));
  assert.ok(path.basename(root).startsWith("fas-contract-logo-"));
  await fs.rm(root, { recursive: true, force: true });
  mock.restoreAll();
  syncBuiltinESMExports();
});
after(() => {
  for (const key of keys) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

test("exact approved public local PNG becomes a frozen snapshot with integrations disabled", linuxOffline, async () => {
  const url = logoUrl(digest(png)); allow(url);
  await fs.writeFile(logoFile(digest(png)), png);
  await fs.writeFile(`${logoFile(digest(png))}.ct`, "image/png");
  const snapshot = await captureContractLogoSnapshot(url);
  assert.ok(snapshot);
  assert.deepEqual(validateContractLogoSnapshot(snapshot, url), snapshot);
  assert.equal(process.env.ALLOW_LIVE_INTEGRATIONS, "false");
  const bytes = Buffer.from(snapshot.dataUrl.split(",")[1], "base64");
  assert.equal((await sharp(bytes).metadata()).format, "png");
  assert.equal(snapshot.sha256, digest(bytes));
});

test("empty trust set, another origin, private/signature namespaces and non-addressed paths never open storage", async () => {
  const open = mock.method(ObjectStorageService.prototype, "getObjectEntityFile", async () => { throw new Error("STORAGE_MUST_NOT_BE_OPENED"); });
  const hash = digest(png);
  assert.equal(await captureContractLogoSnapshot(logoUrl(hash)), undefined);
  for (const url of [
    `https://other.example.test/api/storage/public-branding/embed-widget/${filename(hash)}`,
    `${origin}/api/storage/objects/private/${filename(hash)}`,
    `${origin}/objects/signatures/${filename(hash)}`,
    `${origin}/api/storage/public-branding/signatures/${filename(hash)}`,
    `${origin}/api/storage/public-branding/embed-widget/ordinary.png`,
    `${origin}/api/storage/public-branding/embed-widget/%63ontract-logo-${hash}.png`,
  ]) {
    allow(url);
    assert.equal(await captureContractLogoSnapshot(url), undefined, url);
  }
  assert.equal(open.mock.callCount(), 0);
});

test("canonical aliases, query tokens and traversal cannot match the approved URL", async () => {
  const hash = digest(png), url = logoUrl(hash); allow(url);
  const open = mock.method(ObjectStorageService.prototype, "getObjectEntityFile", async () => { throw new Error("STORAGE_MUST_NOT_BE_OPENED"); });
  for (const value of [`${url}?token=secret`, `${url}#fragment`, url.replace("/embed-widget/", "/embed-widget/../private/"), url.replace("/embed-widget/", "/embed-widget/%2e%2e/"), url.replace("/embed-widget/", "/embed-widget\\"), url.replace("https:", "http:")]) {
    assert.equal(await captureContractLogoSnapshot(value), undefined);
  }
  assert.equal(open.mock.callCount(), 0);
});

test("missing storage object and changed bytes fail closed without leaking paths", linuxOffline, async () => {
  const hash = digest(png), url = logoUrl(hash); allow(url);
  await assert.rejects(captureContractLogoSnapshot(url), /^Error: contract_logo_capture_failed$/);
  const changed = await sharp({ create: { width: 40, height: 16, channels: 4, background: "#ff0000" } }).png().toBuffer();
  await fs.writeFile(logoFile(hash), changed);
  await assert.rejects(captureContractLogoSnapshot(url), /^Error: contract_logo_capture_failed$/);
});

test("PNG extension and sidecar cannot authorize HTML, JPEG, corrupt images or excessive bytes", linuxOffline, async () => {
  const jpeg = await sharp(png).jpeg().toBuffer();
  for (const bytes of [Buffer.from("TEST only non-image payload"), jpeg, png.subarray(0, 40), Buffer.alloc(MAX_CONTRACT_LOGO_BYTES + 1)]) {
    const hash = digest(bytes); allow(logoUrl(hash));
    await fs.writeFile(logoFile(hash), bytes);
    await fs.writeFile(`${logoFile(hash)}.ct`, "image/png");
    await assert.rejects(captureContractLogoSnapshot(logoUrl(hash)), /^Error: contract_logo_capture_failed$/);
  }
});

test("content-addressed images still obey decompression pixel ceiling", linuxOffline, async () => {
  const bytes = await sharp({ create: { width: 2001, height: 2000, channels: 3, background: "white" } }).png().toBuffer();
  assert.ok(bytes.length < MAX_CONTRACT_LOGO_BYTES);
  const hash = digest(bytes); allow(logoUrl(hash)); await fs.writeFile(logoFile(hash), bytes);
  await assert.rejects(captureContractLogoSnapshot(logoUrl(hash)), /^Error: contract_logo_capture_failed$/);
});

test("hard links into a private object cannot be captured through the public namespace", linuxOffline, async () => {
  const hash = digest(png); allow(logoUrl(hash));
  const privateFile = path.join(root, "TEST-private-image.png");
  await fs.writeFile(privateFile, png); await fs.link(privateFile, logoFile(hash));
  await assert.rejects(captureContractLogoSnapshot(logoUrl(hash)), /^Error: contract_logo_capture_failed$/);
});

test("symlink aliases into private storage cannot be captured", linuxOffline, async context => {
  const hash = digest(png); allow(logoUrl(hash));
  const privateFile = path.join(root, "TEST-private-image.png"); await fs.writeFile(privateFile, png);
  try { await fs.symlink(privateFile, logoFile(hash)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "EPERM") { context.skip("Host does not permit symlink fixtures"); return; } throw error; }
  await assert.rejects(captureContractLogoSnapshot(logoUrl(hash)), /^Error: contract_logo_capture_failed$/);
});

test("different storage driver or absent application origin does not enable offline object capture", async () => {
  const hash = digest(png), url = logoUrl(hash); allow(url); await fs.writeFile(logoFile(hash), png);
  process.env.STORAGE_DRIVER = "replit";
  assert.equal(await captureContractLogoSnapshot(url), undefined);
  process.env.STORAGE_DRIVER = "local"; delete process.env.APP_BASE_URL;
  assert.equal(await captureContractLogoSnapshot(url), undefined);
});

test("historical snapshots remain independent of today's storage and trust configuration", linuxOffline, async () => {
  const hash = digest(png), url = logoUrl(hash); allow(url); await fs.writeFile(logoFile(hash), png);
  const snapshot = await captureContractLogoSnapshot(url); assert.ok(snapshot);
  await fs.unlink(logoFile(hash)); process.env.CONTRACT_PDF_TRUSTED_LOGO_URLS = "[]";
  assert.deepEqual(validateContractLogoSnapshot(snapshot, url), snapshot);
});

test("unsupported platforms fail before opening any offline storage", { skip: process.platform === "linux" }, async () => {
  const url = logoUrl(digest(png)); allow(url);
  const open = mock.method(ObjectStorageService.prototype, "getObjectEntityFile", async () => { throw new Error("STORAGE_MUST_NOT_BE_OPENED"); });
  await assert.rejects(captureContractLogoSnapshot(url), /^Error: contract_logo_capture_failed$/);
  assert.equal(open.mock.callCount(), 0);
});

function observeFileReads() {
  const originalOpen = fsPromises.open;
  let reads = 0;
  mock.method(fsPromises, "open", async (...args: Parameters<typeof fsPromises.open>) => {
    const flags = Number(args[1]);
    assert.equal(flags & fsConstants.O_NOFOLLOW, fsConstants.O_NOFOLLOW);
    assert.equal(flags & fsConstants.O_NONBLOCK, fsConstants.O_NONBLOCK);
    const handle = await originalOpen(...args);
    const originalStream = handle.createReadStream.bind(handle);
    mock.method(handle, "createReadStream", (...streamArgs: Parameters<typeof handle.createReadStream>) => {
      reads++;
      return originalStream(...streamArgs);
    });
    return handle;
  });
  syncBuiltinESMExports();
  return () => reads;
}

test("a parent directory replaced after resolution cannot expose a private PNG even with the approved hash", linuxOffline, async () => {
  const hash = digest(png), url = logoUrl(hash); allow(url);
  await fs.writeFile(logoFile(hash), png);
  const privateDir = path.join(root, "TEST-private"); await fs.mkdir(privateDir);
  await fs.writeFile(path.join(privateDir, filename(hash)), png);
  const publicDir = path.dirname(logoFile(hash));
  const resolve = ObjectStorageService.prototype.getObjectEntityFile;
  mock.method(ObjectStorageService.prototype, "getObjectEntityFile", async function (objectPath, options) {
    const file = await resolve.call(this, objectPath, options);
    await fs.rename(publicDir, `${publicDir}-original`);
    await fs.symlink(privateDir, publicDir, "dir");
    return file;
  });
  const reads = observeFileReads();
  await assert.rejects(captureContractLogoSnapshot(url), /^Error: contract_logo_capture_failed$/);
  assert.equal(reads(), 0, "descriptor identity must be checked before any private bytes are read");
});

test("a leaf replaced with a symlink after lstat is rejected by the open flags", linuxOffline, async () => {
  const hash = digest(png), url = logoUrl(hash); allow(url);
  const publicFile = logoFile(hash), privateFile = path.join(root, "TEST-private.png");
  await fs.writeFile(publicFile, png); await fs.writeFile(privateFile, png);
  const originalOpen = fsPromises.open;
  mock.method(fsPromises, "open", async (...args: Parameters<typeof fsPromises.open>) => {
    assert.equal(Number(args[1]) & fsConstants.O_NOFOLLOW, fsConstants.O_NOFOLLOW);
    await fs.unlink(publicFile);
    await fs.symlink(privateFile, publicFile);
    return originalOpen(...args);
  });
  syncBuiltinESMExports();
  await assert.rejects(captureContractLogoSnapshot(url), /^Error: contract_logo_capture_failed$/);
});

test("unavailable descriptor identity fails closed before reading a public logo", linuxOffline, async () => {
  const hash = digest(png), url = logoUrl(hash); allow(url); await fs.writeFile(logoFile(hash), png);
  const originalRealpath = fsPromises.realpath;
  mock.method(fsPromises, "realpath", async (...args: Parameters<typeof fsPromises.realpath>) => {
    if (String(args[0]).startsWith("/proc/self/fd/")) throw new Error("TEST_PROC_UNAVAILABLE");
    return originalRealpath(...args);
  });
  const reads = observeFileReads();
  await assert.rejects(captureContractLogoSnapshot(url), /^Error: contract_logo_capture_failed$/);
  assert.equal(reads(), 0);
});
