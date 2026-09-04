import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, get as httpGet, type Server } from "node:http";
import { Readable } from "node:stream";
import { mkdtemp, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import type { Request, Response } from "express";
import {
  LocalStorageFile,
  ObjectNotFoundError,
  ObjectStorageService,
  type ObjectFileHandle,
} from "../src/lib/objectStorage.js";

const storage = new ObjectStorageService();
let directory = "";
let server: Server;
let baseUrl = "";
const largeSize = 24 * 1024 * 1024;
let routedStreamErrors = 0;

function asExpressResponse(res: import("node:http").ServerResponse): Response {
  (res as unknown as { status(code: number): typeof res }).status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  return res as unknown as Response;
}

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "fasos-object-stream-"));
  process.env.STORAGE_DRIVER = "local";
  process.env.STORAGE_LOCAL_DIR = directory;
  await writeFile(path.join(directory, "small.pdf"), Buffer.from("%PDF-stream-fixture"));
  await writeFile(path.join(directory, "small.pdf.ct"), "application/pdf");
  await writeFile(path.join(directory, "sample.docx"), Buffer.from("PK\u0003\u0004docx"));
  await writeFile(path.join(directory, "image.png"), Buffer.from("\x89PNG\r\n\x1a\n", "binary"));
  await writeFile(path.join(directory, "empty.txt"), "");
  await writeFile(path.join(directory, "large.bin"), "");
  await truncate(path.join(directory, "large.bin"), largeSize);

  server = createServer(async (req, res) => {
    try {
      const name = decodeURIComponent(new URL(req.url ?? "/", "http://local").pathname.slice(1));
      const file: ObjectFileHandle = name === "stream-error"
        ? {
            async getMetadata() { return [{ contentType: "application/octet-stream", size: 1 }]; },
            createReadStream() {
              return new Readable({ read() { this.destroy(new Error("fixture stream failure")); } });
            },
            async download() { return [Buffer.alloc(0)]; },
            async delete() {},
            async exists() { return [true]; },
          }
        : await storage.getObjectEntityFile(`/objects/${name}`);
      await storage.streamObjectToResponse(req as Request, asExpressResponse(res), file);
    } catch (error) {
      if (!(error instanceof ObjectNotFoundError)) routedStreamErrors += 1;
      if (error instanceof ObjectNotFoundError) res.writeHead(404).end("Object not found");
      else if (!res.headersSent) res.writeHead(500).end("stream failure");
      else res.destroy(error as Error);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
  await rm(directory, { recursive: true, force: true });
});

async function fetchBytes(name: string, range?: string) {
  const response = await fetch(`${baseUrl}/${name}`, { headers: range ? { Range: range } : {} });
  return { response, bytes: Buffer.from(await response.arrayBuffer()) };
}

test("small and large full downloads preserve bytes and SHA-256", async () => {
  const small = await fetchBytes("small.pdf");
  assert.equal(small.response.status, 200);
  assert.equal(small.response.headers.get("accept-ranges"), "bytes");
  assert.equal(small.response.headers.get("content-type"), "application/pdf");
  assert.equal(small.response.headers.get("content-length"), String(small.bytes.length));
  assert.equal(createHash("sha256").update(small.bytes).digest("hex"), createHash("sha256").update("%PDF-stream-fixture").digest("hex"));

  const large = await fetchBytes("large.bin");
  assert.equal(large.bytes.length, largeSize);
  assert.equal(createHash("sha256").update(large.bytes).digest("hex"), createHash("sha256").update(Buffer.alloc(largeSize)).digest("hex"));
});

test("first, middle, open-ended and suffix ranges use inclusive byte bounds", async () => {
  for (const [header, expected, contentRange] of [
    ["bytes=0-3", Buffer.from("%PDF"), "bytes 0-3/19"],
    ["bytes=5-10", Buffer.from("stream"), "bytes 5-10/19"],
    ["bytes=15-", Buffer.from("ture"), "bytes 15-18/19"],
    ["bytes=-4", Buffer.from("ture"), "bytes 15-18/19"],
  ] as const) {
    const result = await fetchBytes("small.pdf", header);
    assert.equal(result.response.status, 206);
    assert.equal(result.response.headers.get("content-range"), contentRange);
    assert.equal(result.response.headers.get("content-length"), String(expected.length));
    assert.deepEqual(result.bytes, expected);
  }
});

test("invalid and out-of-bounds ranges return 416 without a body", async () => {
  for (const range of ["bytes=99-100", "bytes=8-4", "bytes=", "items=0-1", "bytes=0-1,4-5"]) {
    const { response, bytes } = await fetchBytes("small.pdf", range);
    assert.equal(response.status, 416);
    assert.equal(response.headers.get("content-range"), "bytes */19");
    assert.equal(bytes.length, 0);
  }
});

test("empty, missing, PDF, DOCX and image responses keep their contracts", async () => {
  const empty = await fetchBytes("empty.txt");
  assert.equal(empty.response.status, 200);
  assert.equal(empty.response.headers.get("content-length"), "0");
  assert.equal(empty.bytes.length, 0);
  assert.equal((await fetch(`${baseUrl}/missing.pdf`)).status, 404);
  assert.equal((await fetch(`${baseUrl}/small.pdf`)).headers.get("content-type"), "application/pdf");
  assert.equal((await fetch(`${baseUrl}/sample.docx`)).headers.get("content-type"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  assert.equal((await fetch(`${baseUrl}/image.png`)).headers.get("content-type"), "image/png");
});

test("path traversal and symlink escape are rejected", async (context) => {
  await writeFile(path.join(directory, "..outside.txt"), "safe but invalid path name");
  assert.equal((await fetch(`${baseUrl}/..%2Foutside.txt`)).status, 404);
  const outside = path.join(tmpdir(), `fasos-outside-${process.pid}.txt`);
  const escapeLink = path.join(directory, "escape.txt");
  await writeFile(outside, "outside");
  try {
    try {
      await symlink(outside, escapeLink);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
      context.diagnostic("Symlink escape assertion unavailable: Windows symlink privilege is disabled.");
      return;
    }
    assert.equal((await fetch(`${baseUrl}/escape.txt`)).status, 404);
  } finally {
    await rm(escapeLink, { force: true });
    await rm(outside, { force: true });
  }
});

test("stream errors reject to the route layer without an unhandled exception", async () => {
  await assert.rejects(fetch(`${baseUrl}/stream-error`));
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(routedStreamErrors, 1);
});

test("client disconnect closes the filesystem stream", async () => {
  const file = new LocalStorageFile(path.join(directory, "large.bin"), "large.bin");
  let closed = false;
  const original = file.createReadStream.bind(file);
  file.createReadStream = (options) => {
    const stream = original(options);
    stream.once("close", () => { closed = true; });
    return stream;
  };
  const disconnectServer = createServer(async (req, res) => {
    await storage.streamObjectToResponse(req as Request, asExpressResponse(res), file);
  });
  await new Promise<void>((resolve) => disconnectServer.listen(0, "127.0.0.1", resolve));
  const address = disconnectServer.address();
  assert(address && typeof address !== "string");
  await new Promise<void>((resolve) => {
    const request = httpGet(`http://127.0.0.1:${address.port}`, (response) => {
      response.once("data", () => { request.destroy(); resolve(); });
    });
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(closed, true);
  await new Promise<void>((resolve) => disconnectServer.close(() => resolve()));
});

test("concurrent large downloads stay streaming instead of retaining file-sized buffers", async () => {
  const beforeRss = process.memoryUsage().rss;
  async function hashDownload(): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = createHash("sha256");
      httpGet(`${baseUrl}/large.bin`, (response) => {
        response.on("data", (chunk) => hash.update(chunk));
        response.on("end", () => resolve(hash.digest("hex")));
        response.on("error", reject);
      }).on("error", reject);
    });
  }
  const hashes = await Promise.all(Array.from({ length: 4 }, () => hashDownload()));
  assert.equal(new Set(hashes).size, 1);
  const rssGrowth = process.memoryUsage().rss - beforeRss;
  console.log(`[object-storage-test] 4 x ${largeSize} bytes; RSS growth=${rssGrowth} bytes`);
  assert(rssGrowth < largeSize * 3, `RSS grew by ${rssGrowth} bytes for ${largeSize * 4} streamed bytes`);
});
