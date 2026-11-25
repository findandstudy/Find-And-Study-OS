import { afterEach, before, mock, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import dns from "node:dns/promises";
import https from "node:https";
import net from "node:net";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { syncBuiltinESMExports } from "node:module";
import sharp from "sharp";
import {
  captureContractLogoSnapshot, validateContractLogoSnapshot, parseContractTrustedLogoUrls,
  MAX_CONTRACT_LOGO_BYTES, CONTRACT_LOGO_TIMEOUT_MS,
} from "../src/lib/contractPdfAssets";
import { safeOutboundRequest, type SafeOutboundResponse, type SafeOutboundRequestOptions } from "../src/lib/safeOutboundRequest";

const URL = "https://brand.example/logo.png";
let png: Buffer;
let jpeg: Buffer;
const originalEnv = { NODE_ENV: process.env.NODE_ENV, ALLOW_LIVE_INTEGRATIONS: process.env.ALLOW_LIVE_INTEGRATIONS,
  CONTRACT_PDF_TRUSTED_LOGO_URLS: process.env.CONTRACT_PDF_TRUSTED_LOGO_URLS };
before(async () => {
  png = await sharp({ create: { width: 2, height: 2, channels: 4, background: "#123456" } }).png().toBuffer();
  jpeg = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#123456" } }).jpeg().toBuffer();
});
afterEach(() => {
  mock.restoreAll();
  syncBuiltinESMExports();
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

function prohibitNetwork(): void {
  mock.method(net.Socket.prototype, "connect", () => { throw new Error("REAL_NETWORK_FORBIDDEN"); });
  mock.method(globalThis, "fetch", () => { throw new Error("REAL_FETCH_FORBIDDEN"); });
  mock.method(dns, "lookup", () => { throw new Error("REAL_DNS_FORBIDDEN"); });
  syncBuiltinESMExports();
  process.env.NODE_ENV = "test";
  process.env.ALLOW_LIVE_INTEGRATIONS = "false";
  delete process.env.CONTRACT_PDF_TRUSTED_LOGO_URLS;
}
function response(overrides: Partial<SafeOutboundResponse> = {}): SafeOutboundResponse {
  return { ok: true, status: 200, headers: { "content-type": "image/png", "content-length": String(png.length) },
    body: png, url: URL, ...overrides };
}
async function capture(overrides: Partial<SafeOutboundResponse> = {}) {
  return captureContractLogoSnapshot(URL, { trustedLogoUrls: [URL], request: async () => response(overrides) });
}

test("trust configuration is exact, bounded and empty by default", () => {
  prohibitNetwork();
  assert.deepEqual(parseContractTrustedLogoUrls(undefined), []);
  assert.deepEqual(parseContractTrustedLogoUrls(""), []);
  assert.deepEqual(parseContractTrustedLogoUrls(JSON.stringify([URL])), [URL]);
  for (const value of ["bad", "{}", JSON.stringify([URL, URL]), JSON.stringify(Array(9).fill(URL)),
    JSON.stringify(["http://brand.example/logo.png"]), JSON.stringify(["https://user:secret@brand.example/logo.png"]),
    JSON.stringify([`${URL}?token=secret`]), JSON.stringify([`${URL}#x`]), JSON.stringify([`${URL}?`]), JSON.stringify([`${URL}#`]),
    JSON.stringify(["https://brand.example:444/logo.png"]),
    JSON.stringify(["https://127.0.0.1/logo.png"]), JSON.stringify(["https://localhost/logo.png"]),
    JSON.stringify(["https://brand.example:443/logo.png"]), JSON.stringify([`${URL}/../other.png`]),
    JSON.stringify(["https://brand.example/" + "x".repeat(2000)])]) {
    assert.throws(() => parseContractTrustedLogoUrls(value), /^Error: contract_logo_trust_config_invalid$/);
  }
});

test("untrusted URLs and disabled live integrations never request assets", async () => {
  prohibitNetwork();
  let calls = 0;
  const request = async () => { calls++; return response(); };
  assert.equal(await captureContractLogoSnapshot(URL, { request }), undefined);
  for (const source of ["https://other.example/logo.png", `${URL}?x=1`, `${URL}/extra`, "data:image/png;base64,AAAA",
    "file:///logo.png", "https://127.0.0.1/logo.png", "/logo.png"]) {
    assert.equal(await captureContractLogoSnapshot(source, { trustedLogoUrls: [URL], request }), undefined);
  }
  assert.equal(await captureContractLogoSnapshot(URL, { trustedLogoUrls: [URL] }), undefined);
  assert.equal(calls, 0);
});

test("test transport cannot be used outside test or to invoke the live transport", async () => {
  prohibitNetwork();
  process.env.NODE_ENV = "production";
  await assert.rejects(captureContractLogoSnapshot(URL, { request: async () => response() }), /contract_logo_test_transport_forbidden/);
  process.env.NODE_ENV = "test";
  await assert.rejects(captureContractLogoSnapshot(URL, { request: safeOutboundRequest }), /contract_logo_test_transport_forbidden/);
});

test("approved PNG capture freezes bounded normalized bytes, source and hash", async () => {
  prohibitNetwork();
  let seen: SafeOutboundRequestOptions | undefined;
  const snapshot = await captureContractLogoSnapshot(URL, { trustedLogoUrls: [URL], request: async (url, options) => {
    assert.equal(url, URL); seen = options; return response();
  } });
  assert.ok(snapshot);
  assert.deepEqual(validateContractLogoSnapshot(snapshot, URL), snapshot);
  assert.deepEqual(seen?.allowedProtocols, ["https:"]);
  assert.deepEqual(seen?.allowedPorts, [443]);
  assert.deepEqual(seen?.allowedHostnames, ["brand.example"]);
  assert.equal(seen?.maxRedirects, 0);
  assert.equal(seen?.maxBytes, MAX_CONTRACT_LOGO_BYTES);
  assert.equal(seen?.timeoutMs, CONTRACT_LOGO_TIMEOUT_MS);
  assert.ok(seen?.signal);
  assert.equal(seen.signal.aborted, true, "completed capture cancels transport resources");
  assert.equal(Object.keys(seen.headers ?? {}).some(key => /authorization|cookie/i.test(key)), false);
  const bytes = Buffer.from(snapshot.dataUrl.split(",")[1], "base64");
  assert.equal(snapshot.sha256, createHash("sha256").update(bytes).digest("hex"));
  assert.equal((await sharp(bytes).metadata()).format, "png");
});

test("JPEG capture normalizes to a PNG snapshot", async () => {
  prohibitNetwork();
  const snapshot = await capture({ body: jpeg, headers: { "content-type": "image/jpeg" } });
  assert.ok(snapshot?.dataUrl.startsWith("data:image/png;base64,"));
});

test("status, redirect, URL drift, MIME, encoding and length failures are closed", async () => {
  prohibitNetwork();
  for (const change of [
    { status: 302 }, { status: 206 }, { ok: false }, { url: "https://other.example/logo.png" },
    { headers: { "content-type": "image/svg+xml" } }, { headers: { "content-type": "text/html" } },
    { headers: { "content-type": "image/jpeg" } }, { headers: { "content-type": "image/png", "content-encoding": "gzip" } },
    { headers: { "content-type": "image/png", "content-length": "0" } },
    { headers: { "content-type": "image/png", "content-length": String(png.length + 1) } },
    { headers: { "content-type": "image/png", "content-length": "100e3" } },
    { body: Buffer.alloc(0) }, { body: Buffer.alloc(MAX_CONTRACT_LOGO_BYTES + 1) },
    { body: Buffer.from("<svg></svg>") }, { body: png.subarray(0, 40), headers: { "content-type": "image/png" } },
  ]) {
    await assert.rejects(capture(change), /^Error: contract_logo_capture_failed$/);
  }
});

test("decompression-bomb dimensions are rejected before creating a snapshot", async () => {
  prohibitNetwork();
  const large = await sharp({ create: { width: 2001, height: 2000, channels: 3, background: "white" } }).png().toBuffer();
  assert.ok(large.length < MAX_CONTRACT_LOGO_BYTES);
  await assert.rejects(capture({ body: large, headers: { "content-type": "image/png" } }), /^Error: contract_logo_capture_failed$/);
});

test("provider errors are redacted and the deadline aborts even a stalled transport", async () => {
  prohibitNetwork();
  await assert.rejects(captureContractLogoSnapshot(URL, { trustedLogoUrls: [URL], request: async () => {
    throw new Error("provider secret address@example.invalid");
  } }), /^Error: contract_logo_capture_failed$/);
  let signal: AbortSignal | undefined;
  const started = Date.now();
  await assert.rejects(captureContractLogoSnapshot(URL, { trustedLogoUrls: [URL], request: async (_url, options) => {
    signal = options?.signal; return new Promise<SafeOutboundResponse>(() => {});
  } }), /^Error: contract_logo_capture_failed$/);
  assert.equal(signal?.aborted, true);
  assert.ok(Date.now() - started < CONTRACT_LOGO_TIMEOUT_MS + 2000);
});

test("historical snapshot validation never refreshes and rejects tamper or wrong source", async () => {
  prohibitNetwork();
  const snapshot = await capture();
  assert.ok(snapshot);
  process.env.CONTRACT_PDF_TRUSTED_LOGO_URLS = "[]";
  assert.deepEqual(validateContractLogoSnapshot(snapshot, URL), snapshot);
  for (const corrupt of [null, [], { ...snapshot, sha256: "0".repeat(64) },
    { ...snapshot, sourceUrl: "https://other.example/logo.png" },
    { ...snapshot, dataUrl: snapshot.dataUrl + "=" },
    { ...snapshot, dataUrl: "data:image/svg+xml;base64,AAAA" },
    { ...snapshot, dataUrl: "data:image/png;base64," + "A".repeat(MAX_CONTRACT_LOGO_BYTES * 2) }]) {
    assert.equal(validateContractLogoSnapshot(corrupt, URL), undefined);
  }
  assert.equal(validateContractLogoSnapshot(snapshot, "https://other.example/logo.png"), undefined);
});

test("aborted outbound request does not resolve DNS or create a socket", async () => {
  prohibitNetwork();
  const controller = new AbortController(); controller.abort();
  await assert.rejects(safeOutboundRequest(URL, { signal: controller.signal }), /outbound_request_aborted/);
});

test("deadline during DNS returns promptly and a late public answer opens no socket", async () => {
  prohibitNetwork();
  let resolveDns!: (value: any) => void;
  mock.method(dns, "lookup", () => new Promise(resolve => { resolveDns = resolve; }));
  let sockets = 0;
  mock.method(https, "request", () => { sockets++; throw new Error("SOCKET_FORBIDDEN"); });
  syncBuiltinESMExports();
  const controller = new AbortController();
  const pending = safeOutboundRequest(URL, { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, /outbound_request_aborted/);
  resolveDns([{ address: "8.8.8.8", family: 4 }]);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sockets, 0);
});

test("mixed public/private DNS still fails before connecting with a deadline", async () => {
  prohibitNetwork();
  mock.method(dns, "lookup", async () => [{ address: "8.8.8.8", family: 4 }, { address: "127.0.0.1", family: 4 }]);
  syncBuiltinESMExports();
  await assert.rejects(safeOutboundRequest(URL, { signal: new AbortController().signal }), /outbound_destination_not_allowed/);
});

test("synchronous abort during DNS registration handles the late rejected lookup", async () => {
  prohibitNetwork();
  const controller = new AbortController();
  mock.method(dns, "lookup", () => {
    controller.abort();
    return Promise.reject(new Error("LATE_DNS_REJECTION"));
  });
  syncBuiltinESMExports();
  await assert.rejects(safeOutboundRequest(URL, { signal: controller.signal }), /outbound_request_aborted/);
  await new Promise(resolve => setImmediate(resolve));
});

test("vetted DNS answer is socket-pinned, TLS-verified and cancellable during body", async () => {
  prohibitNetwork();
  mock.method(dns, "lookup", async () => [{ address: "8.8.8.8", family: 4 }]);
  const controller = new AbortController();
  let options: any;
  let destroyed = false;
  mock.method(https, "request", (input: any, onResponse: (incoming: any) => void) => {
    options = input;
    const request = new EventEmitter() as any;
    request.setTimeout = () => request;
    request.destroy = (error: Error) => { destroyed = true; request.emit("error", error); return request; };
    input.signal.addEventListener("abort", () => request.destroy(new Error("ABORT_ERR")), { once: true });
    request.end = () => {
      const incoming = new PassThrough() as any;
      incoming.statusCode = 200; incoming.headers = { "content-type": "image/png" };
      onResponse(incoming); incoming.write(png.subarray(0, 8)); controller.abort();
    };
    return request;
  });
  syncBuiltinESMExports();
  await assert.rejects(safeOutboundRequest(URL, { signal: controller.signal }), /ABORT_ERR/);
  assert.equal(options.hostname, "8.8.8.8");
  assert.equal(options.servername, "brand.example");
  assert.equal(options.headers.Host, "brand.example");
  assert.equal(options.rejectUnauthorized, true);
  assert.equal(options.signal, controller.signal);
  assert.equal(destroyed, true);
});

test("outbound requests without a signal preserve bounded response behavior", async () => {
  prohibitNetwork();
  mock.method(dns, "lookup", async () => [{ address: "8.8.8.8", family: 4 }]);
  mock.method(https, "request", (input: any, onResponse: (incoming: any) => void) => {
    assert.equal(input.signal, undefined);
    const request = new EventEmitter() as any;
    request.setTimeout = () => request;
    request.end = () => {
      const incoming = new PassThrough() as any;
      incoming.statusCode = 200; incoming.headers = { "content-type": "image/png" };
      onResponse(incoming); incoming.end(png);
    };
    return request;
  });
  syncBuiltinESMExports();
  const result = await safeOutboundRequest(URL);
  assert.equal(result.status, 200); assert.deepEqual(result.body, png);
});
