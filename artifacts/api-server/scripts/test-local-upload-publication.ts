import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test, { type TestContext } from "node:test";
import { promisify } from "node:util";
import {
  createLocalUploadPublisher,
  isValidLocalUploadPath,
  LocalUploadBusyError,
  LocalUploadConflictError,
  publishLocalUpload,
  UnsafeLocalUploadPathError,
} from "../src/lib/localUploadPublication.js";

const contentType = "application/pdf";
const body = Buffer.from("%PDF-synthetic-upload");
async function fixture(context: TestContext) {
  const root = await fs.mkdtemp(path.join(tmpdir(), "fasos-upload-publication-"));
  context.after(async () => {
    const resolved = path.resolve(root);
    assert.equal(path.dirname(resolved), path.resolve(tmpdir()));
    assert.ok(path.basename(resolved).startsWith("fasos-upload-publication-"));
    await fs.rm(resolved, { recursive: true, force: true });
  });
  return root;
}
async function exists(file: string) {
  try { await fs.lstat(file); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}
function upload(root: string, relativePath = "uploads/object") {
  return { root, relativePath, body, contentType };
}
function lockPath(root: string, relativePath: string) {
  return path.join(path.dirname(path.join(root, relativePath)), `.local-upload-${createHash("sha256").update(relativePath).digest("hex")}`);
}
async function assertPair(root: string, expectedBody = body, expectedType = contentType) {
  assert.deepEqual(await fs.readFile(path.join(root, "uploads/object")), expectedBody);
  assert.equal(await fs.readFile(path.join(root, "uploads/object.ct"), "utf8"), expectedType);
  assert.deepEqual((await fs.readdir(path.join(root, "uploads"))).sort(), ["object", "object.ct"]);
}

test("relative keys deny traversal, aliases and the internal staging namespace", () => {
  for (const value of ["", "/absolute", "../escape", "x/../y", "x/./y", "x//y", "x\\y", "x/", "x\0y", "C:/file", "x:stream", "x/CON.txt", "x/Lpt1", "trailing.", ".local-upload-lock/file", "x/.local-upload-lock", "x/.LOCAL-UPLOAD-lock"]) {
    assert.equal(isValidLocalUploadPath(value), false, value);
  }
  assert.equal(isValidLocalUploadPath("social-media/staging/a-b_123.456"), true);
});

test("new objects publish complete bytes and MIME and remove temporary files", async (context) => {
  const root = await fixture(context);
  assert.equal(await publishLocalUpload(upload(root)), "created");
  await assertPair(root);
  if (process.platform !== "win32") {
    assert.equal((await fs.stat(path.join(root, "uploads/object"))).mode & 0o777, 0o600);
    assert.equal((await fs.stat(path.join(root, "uploads/object.ct"))).mode & 0o777, 0o600);
  }
});

test("identical retry is a no-op; changing either bytes or MIME cannot overwrite", async (context) => {
  const root = await fixture(context);
  await publishLocalUpload(upload(root));
  const before = await fs.stat(path.join(root, "uploads/object"), { bigint: true });
  assert.equal(await publishLocalUpload(upload(root)), "unchanged");
  const after = await fs.stat(path.join(root, "uploads/object"), { bigint: true });
  assert.equal(after.ino, before.ino);
  assert.equal(after.mtimeNs, before.mtimeNs);
  assert.equal(after.ctimeNs, before.ctimeNs);
  await assert.rejects(publishLocalUpload({ ...upload(root), body: Buffer.from("changed") }), LocalUploadConflictError);
  await assert.rejects(publishLocalUpload({ ...upload(root), contentType: "image/png" }), LocalUploadConflictError);
  await assertPair(root);
});

test("simultaneous identical writers publish once, and busy callers can safely retry", async (context) => {
  const root = await fixture(context);
  const outcomes = await Promise.allSettled(Array.from({ length: 16 }, () => publishLocalUpload(upload(root))));
  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled" && outcome.value === "created").length, 1);
  for (const outcome of outcomes) {
    if (outcome.status === "rejected") assert.ok(outcome.reason instanceof LocalUploadBusyError);
    else assert.ok(outcome.value === "created" || outcome.value === "unchanged");
  }
  assert.equal(await publishLocalUpload(upload(root)), "unchanged");
  await assertPair(root);
});

test("competing bodies and MIME types never produce a mixed pair", async (context) => {
  const root = await fixture(context);
  const inputs = Array.from({ length: 16 }, (_, index) => ({
    ...upload(root), body: Buffer.from(`candidate-${index}`), contentType: `application/x-candidate-${index}`,
  }));
  const outcomes = await Promise.allSettled(inputs.map((input) => publishLocalUpload(input)));
  const winners = outcomes.flatMap((outcome, index) => outcome.status === "fulfilled" ? [index] : []);
  assert.equal(winners.length, 1);
  for (const outcome of outcomes) {
    if (outcome.status === "rejected") assert.ok(outcome.reason instanceof LocalUploadBusyError || outcome.reason instanceof LocalUploadConflictError);
  }
  const winner = inputs[winners[0]!]!;
  await assertPair(root, winner.body, winner.contentType);
});

test("independent processes share the same exclusive publication boundary", async (context) => {
  const root = await fixture(context);
  const helperUrl = new URL("../src/lib/localUploadPublication.ts", import.meta.url).href;
  const childSource = `
    import { publishLocalUpload, LocalUploadBusyError, LocalUploadConflictError } from ${JSON.stringify(helperUrl)};
    const [root, candidate] = process.argv.slice(1);
    try {
      const outcome = await publishLocalUpload({ root, relativePath: "uploads/object", body: Buffer.from(candidate), contentType: "application/pdf" });
      process.stdout.write(outcome);
    } catch (error) {
      if (error instanceof LocalUploadBusyError || error instanceof LocalUploadConflictError) process.stdout.write("not-published");
      else throw error;
    }
  `;
  const execute = promisify(execFile);
  const candidates = ["process-one", "process-two", "process-three", "process-four"];
  const outcomes = await Promise.all(candidates.map((candidate) => execute(process.execPath,
    ["--import", "tsx", "--input-type=module", "--eval", childSource, root, candidate],
    { timeout: 15_000, maxBuffer: 16_384, windowsHide: true, env: { ...process.env, ALLOW_LIVE_INTEGRATIONS: "false", NODE_ENV: "test", TSX_DISABLE_CACHE: "1" } })));
  const winners = outcomes.flatMap((outcome, index) => outcome.stdout === "created" ? [index] : []);
  assert.equal(winners.length, 1);
  await assertPair(root, Buffer.from(candidates[winners[0]!]!));
});

test("pre-existing body-only and sidecar-only targets fail closed without repair", async (context) => {
  const root = await fixture(context);
  await fs.mkdir(path.join(root, "uploads"));
  for (const suffix of ["", ".ct"]) {
    const relativePath = suffix ? "uploads/type-only" : "uploads/body-only";
    const existing = path.join(root, `${relativePath}${suffix}`);
    await fs.writeFile(existing, "existing");
    await assert.rejects(publishLocalUpload(upload(root, relativePath)), LocalUploadConflictError);
    assert.equal(await fs.readFile(existing, "utf8"), "existing");
    assert.equal(await exists(path.join(root, `${relativePath}${suffix ? "" : ".ct"}`)), false);
    assert.equal(await exists(lockPath(root, relativePath)), false);
  }
});

test("a crashed publisher lock is not stolen by age or overwrite", async (context) => {
  const root = await fixture(context);
  await fs.mkdir(path.join(root, "uploads"));
  const lock = lockPath(root, "uploads/object");
  await fs.mkdir(lock);
  await fs.writeFile(path.join(lock, "body"), "partial-synthetic");
  await fs.utimes(lock, new Date(0), new Date(0));
  await assert.rejects(publishLocalUpload(upload(root)), LocalUploadBusyError);
  assert.equal(await fs.readFile(path.join(lock, "body"), "utf8"), "partial-synthetic");
  assert.equal(await exists(path.join(root, "uploads/object")), false);
});

test("lock removal between EEXIST and inspection is retryable contention without publication", async (context) => {
  const root = await fixture(context);
  await fs.mkdir(path.join(root, "uploads"));
  const lock = lockPath(root, "uploads/object");
  await fs.mkdir(lock);
  let lockAttempts = 0;
  const publisher = createLocalUploadPublisher({
    ...fs,
    mkdir: (async (...args: Parameters<typeof fs.mkdir>) => {
      if (path.basename(String(args[0])) !== path.basename(lock)) return fs.mkdir(...args);
      lockAttempts++;
      try { return await fs.mkdir(...args); }
      catch (error) {
        assert.equal((error as NodeJS.ErrnoException).code, "EEXIST");
        // Deterministically model the successful competing writer releasing
        // its lock after this mkdir failed but before inspect(lock) runs.
        await fs.rmdir(lock);
        throw error;
      }
    }) as typeof fs.mkdir,
    open: async () => { throw new Error("contended writer must not open files"); },
    link: async () => { throw new Error("contended writer must not publish"); },
    unlink: async () => { throw new Error("contended writer must not clean up"); },
    rmdir: async () => { throw new Error("contended writer must not release another lock"); },
  });
  await assert.rejects(publisher(upload(root)), LocalUploadBusyError);
  assert.equal(lockAttempts, 1, "no implicit lock retry or stealing");
  assert.deepEqual(await fs.readdir(path.join(root, "uploads")), []);
  assert.equal(await publishLocalUpload(upload(root)), "created");
  await assertPair(root);
});

test("observed non-directory and symlink locks remain unsafe and are not removed", async (context) => {
  const root = await fixture(context);
  const outside = await fixture(context);
  await fs.mkdir(path.join(root, "uploads"));
  const lock = lockPath(root, "uploads/object");
  await fs.writeFile(lock, "foreign-lock");
  await assert.rejects(publishLocalUpload(upload(root)), UnsafeLocalUploadPathError);
  assert.equal(await fs.readFile(lock, "utf8"), "foreign-lock");
  await fs.unlink(lock);
  await fs.symlink(outside, lock, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(publishLocalUpload(upload(root)), UnsafeLocalUploadPathError);
  assert.equal((await fs.lstat(lock)).isSymbolicLink(), true);
  assert.deepEqual(await fs.readdir(outside), []);
  assert.equal(await exists(path.join(root, "uploads/object")), false);
});

test("symlink/junction parents are rejected without writes to their targets", async (context) => {
  const root = await fixture(context);
  const outside = await fixture(context);
  await fs.symlink(outside, path.join(root, "uploads"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(publishLocalUpload(upload(root)), UnsafeLocalUploadPathError);
  assert.deepEqual(await fs.readdir(outside), []);
});

test("symlink roots are rejected", async (context) => {
  const container = await fixture(context);
  const actualRoot = await fixture(context);
  const alias = path.join(container, "alias");
  await fs.symlink(actualRoot, alias, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(publishLocalUpload(upload(alias)), UnsafeLocalUploadPathError);
  assert.deepEqual(await fs.readdir(actualRoot), []);
});

test("body and MIME symlinks are never followed, including identical target bytes", async (context) => {
  const root = await fixture(context);
  await fs.mkdir(path.join(root, "uploads"));
  const externalBody = path.join(root, "external-body");
  const externalType = path.join(root, "external-type");
  await fs.writeFile(externalBody, body);
  await fs.writeFile(externalType, contentType);
  try { await fs.symlink(externalBody, path.join(root, "uploads/object")); }
  catch (error) {
    if (process.platform !== "win32" || (error as NodeJS.ErrnoException).code !== "EPERM") throw error;
    context.skip("Windows file-symlink privilege unavailable; junction coverage runs separately");
    return;
  }
  await fs.writeFile(path.join(root, "uploads/object.ct"), contentType);
  await assert.rejects(publishLocalUpload(upload(root)), UnsafeLocalUploadPathError);
  await fs.unlink(path.join(root, "uploads/object"));
  await fs.writeFile(path.join(root, "uploads/object"), body);
  await fs.unlink(path.join(root, "uploads/object.ct"));
  await fs.symlink(externalType, path.join(root, "uploads/object.ct"));
  await assert.rejects(publishLocalUpload(upload(root)), UnsafeLocalUploadPathError);
  assert.deepEqual(await fs.readFile(externalBody), body);
  assert.equal(await fs.readFile(externalType, "utf8"), contentType);
});

test("hard-linked existing objects cannot be accepted as trusted identical retries", async (context) => {
  const root = await fixture(context);
  await publishLocalUpload(upload(root));
  await fs.link(path.join(root, "uploads/object"), path.join(root, "other-reference"));
  await assert.rejects(publishLocalUpload(upload(root)), UnsafeLocalUploadPathError);
  await assertPair(root);
});

test("partial temporary write failure exposes no body or MIME and cleans only owned files", async (context) => {
  const root = await fixture(context);
  const publisher = createLocalUploadPublisher({ ...fs, open: async (...args: Parameters<typeof fs.open>) => {
    const handle = await fs.open(...args);
    if (String(args[0]).endsWith(`${path.sep}body`)) {
      const originalWrite = handle.writeFile.bind(handle);
      handle.writeFile = async () => {
        await originalWrite(Buffer.from("partial"));
        throw new Error("synthetic disk write failure");
      };
    }
    return handle;
  } });
  await assert.rejects(publisher(upload(root)), /synthetic disk write failure/);
  assert.deepEqual(await fs.readdir(path.join(root, "uploads")), []);
  assert.equal(await publishLocalUpload(upload(root)), "created");
});

test("temporary MIME write and fsync failures do not expose a body", async (context) => {
  const root = await fixture(context);
  for (const failure of ["mime-write", "fsync"] as const) {
    const publisher = createLocalUploadPublisher({ ...fs, open: async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args);
      if (failure === "mime-write" && String(args[0]).endsWith(`${path.sep}type`)) {
        handle.writeFile = async () => { throw new Error("synthetic MIME write failure"); };
      }
      if (failure === "fsync" && String(args[0]).endsWith(`${path.sep}body`)) {
        handle.sync = async () => { throw new Error("synthetic fsync failure"); };
      }
      return handle;
    } });
    await assert.rejects(publisher(upload(root)), /synthetic .* failure/);
    assert.deepEqual(await fs.readdir(path.join(root, "uploads")), []);
  }
});

test("cleanup failure preserves the complete committed pair and leaves the key locked", async (context) => {
  const root = await fixture(context);
  const publisher = createLocalUploadPublisher({ ...fs, unlink: async (file) => {
    if (String(file).endsWith(`${path.sep}body`)) throw new Error("synthetic cleanup failure");
    await fs.unlink(file);
  } });
  await assert.rejects(publisher(upload(root)), /synthetic cleanup failure/);
  assert.deepEqual(await fs.readFile(path.join(root, "uploads/object")), body);
  assert.equal(await fs.readFile(path.join(root, "uploads/object.ct"), "utf8"), contentType);
  assert.equal(await exists(lockPath(root, "uploads/object")), true);
  await assert.rejects(publishLocalUpload(upload(root)), LocalUploadBusyError);
});

test("cleanup refuses to unlink a sidecar replaced by another writer", async (context) => {
  const root = await fixture(context);
  const publisher = createLocalUploadPublisher({ ...fs, link: async (source, destination) => {
    if (String(destination).endsWith(`${path.sep}object`)) {
      const sidecar = path.join(root, "uploads/object.ct");
      await fs.unlink(sidecar);
      await fs.writeFile(sidecar, "foreign-metadata", { flag: "wx" });
      throw new Error("synthetic final publish failure");
    }
    await fs.link(source, destination);
  } });
  await assert.rejects(publisher(upload(root)), UnsafeLocalUploadPathError);
  assert.equal(await fs.readFile(path.join(root, "uploads/object.ct"), "utf8"), "foreign-metadata");
  assert.equal(await exists(path.join(root, "uploads/object")), false);
  assert.equal(await exists(lockPath(root, "uploads/object")), true);
});

test("sidecar publication failure exposes no body and preserves the pre-existing sidecar", async (context) => {
  const root = await fixture(context);
  const publisher = createLocalUploadPublisher({ ...fs, link: async (source, destination) => {
    if (String(destination).endsWith(".ct")) await fs.writeFile(destination, "do-not-replace", { flag: "wx" });
    await fs.link(source, destination);
  } });
  await assert.rejects(publisher(upload(root)), LocalUploadConflictError);
  assert.equal(await exists(path.join(root, "uploads/object")), false);
  assert.equal(await fs.readFile(path.join(root, "uploads/object.ct"), "utf8"), "do-not-replace");
  assert.deepEqual(await fs.readdir(path.join(root, "uploads")), ["object.ct"]);
});

test("body is absent until atomic publish; a failed final link rolls back only our MIME sidecar", async (context) => {
  const root = await fixture(context);
  let observedBoundary = false;
  const publisher = createLocalUploadPublisher({ ...fs, link: async (source, destination) => {
    if (String(destination).endsWith(`${path.sep}object`)) {
      observedBoundary = true;
      assert.equal(await exists(path.join(root, "uploads/object")), false);
      assert.equal(await fs.readFile(path.join(root, "uploads/object.ct"), "utf8"), contentType);
      assert.deepEqual(await fs.readFile(source), body);
      throw new Error("synthetic exclusive publication failure");
    }
    await fs.link(source, destination);
  } });
  await assert.rejects(publisher(upload(root)), /synthetic exclusive publication failure/);
  assert.equal(observedBoundary, true);
  assert.deepEqual(await fs.readdir(path.join(root, "uploads")), []);
});

test("a late competing target is neither overwritten nor deleted on failure", async (context) => {
  const root = await fixture(context);
  const publisher = createLocalUploadPublisher({ ...fs, link: async (source, destination) => {
    if (String(destination).endsWith(`${path.sep}object`)) await fs.writeFile(destination, "other-writer", { flag: "wx" });
    await fs.link(source, destination);
  } });
  await assert.rejects(publisher(upload(root)), LocalUploadConflictError);
  assert.equal(await fs.readFile(path.join(root, "uploads/object"), "utf8"), "other-writer");
  assert.deepEqual(await fs.readdir(path.join(root, "uploads")), ["object"]);
});

test("parent replacement while staging fails closed and does not follow the new parent", async (context) => {
  const root = await fixture(context);
  const outside = await fixture(context);
  let replaced = false;
  const publisher = createLocalUploadPublisher({ ...fs, link: async (source, destination) => {
    await fs.link(source, destination);
    if (!replaced && String(destination).endsWith(".ct")) {
      replaced = true;
      await fs.rename(path.join(root, "uploads"), path.join(root, "original-uploads"));
      await fs.symlink(outside, path.join(root, "uploads"), process.platform === "win32" ? "junction" : "dir");
    }
  } });
  await assert.rejects(publisher(upload(root)), UnsafeLocalUploadPathError);
  assert.equal(replaced, true);
  assert.deepEqual(await fs.readdir(outside), []);
  assert.equal(await exists(path.join(root, "original-uploads/object")), false);
});

test("staged body replacement is detected before it can be published", async (context) => {
  const root = await fixture(context);
  const publisher = createLocalUploadPublisher({ ...fs, link: async (source, destination) => {
    await fs.link(source, destination);
    if (String(destination).endsWith(".ct")) {
      const temporaryBody = path.join(path.dirname(String(source)), "body");
      await fs.rename(temporaryBody, `${temporaryBody}.original`);
      await fs.writeFile(temporaryBody, "foreign-body", { flag: "wx" });
    }
  } });
  await assert.rejects(publisher(upload(root)), UnsafeLocalUploadPathError);
  assert.equal(await exists(path.join(root, "uploads/object")), false);
  assert.equal(await exists(path.join(root, "uploads/object.ct")), false);
  assert.equal(await exists(lockPath(root, "uploads/object")), true);
  assert.equal(await fs.readFile(path.join(lockPath(root, "uploads/object"), "body"), "utf8"), "foreign-body");
});

test("PUT route retains auth, ownership and processing before exclusive publication", async () => {
  const source = await fs.readFile(new URL("../src/routes/storage.ts", import.meta.url), "utf8");
  const start = source.indexOf('router.put("/storage/local-upload/:encoded", requireAuth');
  assert.ok(start >= 0);
  const route = source.slice(start, source.indexOf('// Historical inbox rows', start));
  assert.match(route, /isValidLocalUploadPath\(relPath\)/);
  assert.match(route, /callerOwnsObject\(userId, relPath\)/);
  assert.match(route, /receivedBytes > LOCAL_UPLOAD_ABSOLUTE_MAX_BYTES/);
  assert.match(route, /processUpload\(rawBody/);
  assert.match(route, /publishLocalUpload\(\{ root: localDir, relativePath: relPath, body, contentType: finalContentType \}\)/);
  assert.ok(route.indexOf("callerOwnsObject") < route.indexOf("for await"));
  assert.ok(route.indexOf("processUpload(rawBody") < route.indexOf("await publishLocalUpload"));
  assert.doesNotMatch(route, /(?:writeFile|rename|mkdir)\(/);
  assert.match(route, /LocalUploadBusyError[\s\S]*?Retry-After[\s\S]*?status\(503\)/);
  assert.match(route, /LocalUploadConflictError[\s\S]*?status\(409\)/);
  assert.match(route, /UnsafeLocalUploadPathError[\s\S]*?status\(400\)/);
});

test("inbox same-URL retry includes busy publication responses", async () => {
  const source = await fs.readFile(new URL("../../edcons/src/pages/staff/Messages.tsx", import.meta.url), "utf8");
  assert.match(source, /TRANSIENT_MEDIA_STATUSES = new Set\(\[502, 503, 504\]\)/);
  assert.match(source, /function uploadInboxObject\(uploadURL: string,[\s\S]*?retryMediaPreparation\([\s\S]*?fetch\(uploadURL/);
});

test("local URL issuance rejects prefixes the publisher cannot accept before ownership grant", async () => {
  const source = await fs.readFile(new URL("../src/routes/storage.ts", import.meta.url), "utf8");
  const route = source.slice(source.indexOf('router.post("/storage/uploads/request-url"'), source.indexOf('// ── Local-driver'));
  assert.ok(route.includes('process.env.STORAGE_DRIVER === "local" && prefix'));
  assert.ok(route.indexOf("!isValidLocalUploadPath(prefix.replace") < route.indexOf("getObjectEntityUploadURL(prefix)"));
  assert.ok(route.indexOf('error: "Invalid upload prefix"') < route.indexOf("recordObjectOwner("));
  for (const prefix of ["inbox/", "student-documents", "staff-documents/123/", "social-media/staging/"]) {
    assert.equal(isValidLocalUploadPath(prefix.replace(/\/$/, "")), true);
  }
  for (const prefix of ["CON/", "trailing./", "inbox/../", ".local-upload-lock/"]) {
    assert.equal(isValidLocalUploadPath(prefix.replace(/\/$/, "")), false);
  }
});
