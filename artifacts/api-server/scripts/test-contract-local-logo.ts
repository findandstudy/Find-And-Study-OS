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
import { buildUnsignedContractPreview } from "../src/lib/contractUnsignedPreview";
import { JSDOM } from "jsdom";

const origin = "https://staging.example.test";
const keys = ["NODE_ENV", "STORAGE_DRIVER", "STORAGE_LOCAL_DIR", "APP_BASE_URL", "ALLOW_LIVE_INTEGRATIONS", "CONTRACT_PDF_TRUSTED_LOGO_URLS"] as const;
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
  process.env.NODE_ENV = "test";
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

test("unsigned preview keeps only the approved local logo and never the inline or configured signature", linuxOffline, async () => {
  const url = logoUrl(digest(png)); allow(url);
  await fs.writeFile(logoFile(digest(png)), png);
  const signature = `data:image/png;base64,${(await sharp({ create: { width: 42, height: 17, channels: 4, background: "#cc0000" } }).png().toBuffer()).toString("base64")}`;
  const html = await buildUnsignedContractPreview(`<style>.box{color:#143591}</style><img src="${url}"><img src="${signature}"><img src="{{main_agency_signature}}">`, "en", { logoUrl: url, companySignatureDataUrl: signature });
  assert.match(html, /data:image\/png;base64/);
  assert.match(html, /UNSIGNED TEST PREVIEW/);
  assert.doesNotMatch(html, new RegExp(signature.split(",")[1].replace(/[+]/g, "\\+")));
  assert.match(html, /\.box\{color:#143591\}/);
  assert.equal(process.env.ALLOW_LIVE_INTEGRATIONS, "false");
});

test("local-only preview refuses even allowlisted remote logos when integrations are enabled", async () => {
  const url = "https://trusted.example.test/logo.png"; allow(url);
  process.env.ALLOW_LIVE_INTEGRATIONS = "true";
  let requests = 0;
  assert.equal(await captureContractLogoSnapshot(url, { localOnly: true, request: async () => { requests++; throw new Error("REMOTE_FORBIDDEN"); } }), undefined);
  assert.equal(requests, 0);
});

test("unsigned preview captures an inline-only approved public logo without profile branding", linuxOffline, async () => {
  const url = logoUrl(digest(png)); allow(url);
  await fs.writeFile(logoFile(digest(png)), png);
  const html = await buildUnsignedContractPreview(`<header><img src="${url}"></header>`, "en", null);
  const dom = new JSDOM(html);
  try {
    assert.equal(dom.window.document.images.length, 1);
    assert.match(dom.window.document.images[0].getAttribute("src")!, /^data:image\/png;base64,/);
    assert.doesNotMatch(html, /IMAGE OMITTED/);
  } finally { dom.window.close(); }
});

test("unsigned preview permits embedded PNG only after exact public-logo hash and stored bytes are verified", linuxOffline, async () => {
  const url = logoUrl(digest(png)); allow(url); await fs.writeFile(logoFile(digest(png)), png);
  const logoData = `data:image/png;base64,${png.toString("base64")}`;
  const signatureBytes = await sharp({ create: { width: 40, height: 16, channels: 4, background: "#ff0000" } }).png().toBuffer();
  const signatureData = `data:image/png;base64,${signatureBytes.toString("base64")}`;
  const html = await buildUnsignedContractPreview(`<img src="${logoData}"><img src="${signatureData}"><img src="{{signature}}">`, "en", null);
  const dom = new JSDOM(html);
  try {
    assert.equal(dom.window.document.images.length, 1);
    const emitted = Buffer.from(dom.window.document.images[0].getAttribute("src")!.split(",")[1], "base64");
    assert.deepEqual(await sharp(emitted).raw().toBuffer(), await sharp(png).raw().toBuffer());
    assert.ok(!html.includes(signatureData));
  } finally { dom.window.close(); }
  // A matching URL/hash declaration alone must never authorize the input bytes.
  await fs.unlink(logoFile(digest(png)));
  await assert.rejects(buildUnsignedContractPreview(`<img src="${logoData}">`, "en", null), /contract_logo_capture_failed/);
});

test("embedded PNG with no exact current public-logo allowlist entry remains omitted", async () => {
  const logoData = `data:image/png;base64,${png.toString("base64")}`;
  process.env.CONTRACT_PDF_TRUSTED_LOGO_URLS = JSON.stringify([logoUrl(digest(png)).replace(origin, "https://other.example.test")]);
  const open = mock.method(ObjectStorageService.prototype, "getObjectEntityFile", async () => { throw new Error("STORAGE_FORBIDDEN"); });
  const html = await buildUnsignedContractPreview(`<img src="${logoData}">`, "en", null);
  const dom = new JSDOM(html);
  try { assert.equal(dom.window.document.images.length, 0); assert.equal(open.mock.callCount(), 0); }
  finally { dom.window.close(); }
});

test("unsigned preview retains distinct approved profile and inline logos, deduplicating repeated sources", linuxOffline, async () => {
  const second = await sharp({ create: { width: 40, height: 16, channels: 4, background: "#ffffff" } }).png().toBuffer();
  const url = logoUrl(digest(png)), whiteUrl = logoUrl(digest(second));
  process.env.CONTRACT_PDF_TRUSTED_LOGO_URLS = JSON.stringify([url, whiteUrl]);
  await fs.writeFile(logoFile(digest(png)), png); await fs.writeFile(logoFile(digest(second)), second);
  const resolve = ObjectStorageService.prototype.getObjectEntityFile;
  const opened: string[] = [];
  mock.method(ObjectStorageService.prototype, "getObjectEntityFile", async function (key, options) {
    opened.push(key); return resolve.call(this, key, options);
  });
  const html = await buildUnsignedContractPreview(`<div style="background:#143591"><img src="${whiteUrl}"><img src="${whiteUrl}"></div>`, "en", { logoUrl: url });
  const dom = new JSDOM(html);
  try {
    assert.equal(dom.window.document.images.length, 3);
    assert.equal(new Set(Array.from(dom.window.document.images, image => image.src)).size, 2);
    assert.equal(opened.length, 2);
    assert.doesNotMatch(html, /IMAGE OMITTED|src="https:/);
  } finally { dom.window.close(); }
});

test("unsigned preview never reads arbitrary remote, private or embedded signature images", async () => {
  const privateUrl = `${origin}/api/storage/objects/signatures/real.png`;
  const remoteUrl = "https://trusted.example.test/logo.png";
  process.env.CONTRACT_PDF_TRUSTED_LOGO_URLS = JSON.stringify([privateUrl, remoteUrl]);
  process.env.ALLOW_LIVE_INTEGRATIONS = "true";
  const open = mock.method(ObjectStorageService.prototype, "getObjectEntityFile", async () => { throw new Error("PRIVATE_STORAGE_FORBIDDEN"); });
  const html = await buildUnsignedContractPreview(`<img src="${privateUrl}"><img src="${remoteUrl}"><img src="data:image/png;base64,${png.toString("base64")}">`, "en", null);
  const dom = new JSDOM(html);
  try { assert.equal(dom.window.document.images.length, 0); assert.equal(open.mock.callCount(), 0); }
  finally { dom.window.close(); }
});

test("unsigned preview bounds unique logos before any storage reads", async () => {
  const urls = Array.from({ length: 5 }, (_, index) => logoUrl(String(index).repeat(64)));
  process.env.CONTRACT_PDF_TRUSTED_LOGO_URLS = JSON.stringify(urls);
  const open = mock.method(ObjectStorageService.prototype, "getObjectEntityFile", async () => { throw new Error("STORAGE_FORBIDDEN"); });
  await assert.rejects(buildUnsignedContractPreview(urls.map(url => `<img src="${url}">`).join(""), "en", null), /preview_template_too_complex/);
  assert.equal(open.mock.callCount(), 0);
});

test("unsigned preview bounds repeated logo expansion before serializing an oversized document", linuxOffline, async () => {
  const large = await sharp({ create: { width: 1024, height: 1024, channels: 4, background: "#ffffff" } }).png().toBuffer();
  const url = logoUrl(digest(large)); allow(url);
  await fs.writeFile(logoFile(digest(large)), large);
  await assert.rejects(buildUnsignedContractPreview(`<img src="${url}">`.repeat(1000), "en", null), /preview_html_too_large/);
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
