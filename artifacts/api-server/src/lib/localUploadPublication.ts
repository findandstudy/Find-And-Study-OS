import { createHash } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const RESERVED_PREFIX = ".local-upload-";
type FileSystem = Pick<typeof fs, "lstat" | "realpath" | "mkdir" | "open" | "link" | "unlink" | "rmdir">;
type Identity = { path: string; stat: BigIntStats };

export class LocalUploadConflictError extends Error {
  constructor() { super("Upload target already exists with different or incomplete content"); }
}
export class LocalUploadBusyError extends Error {
  constructor() { super("Upload target is being published; retry shortly"); }
}
export class UnsafeLocalUploadPathError extends Error {
  constructor() { super("Unsafe local upload path"); }
}

/** Same relative-path/real-root discipline as ObjectStorageService, also denying
 * Windows aliases and our internal staging namespace on every platform. */
export function isValidLocalUploadPath(relativePath: string): boolean {
  return relativePath.length > 0 && relativePath.length <= 1024
    && /^[a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._-]+)*$/.test(relativePath)
    && relativePath.split("/").every((part) => part !== "." && part !== ".."
      && !part.endsWith(".") && !part.toLowerCase().startsWith(RESERVED_PREFIX)
      && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
}

function sameIdentity(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}
function isCode(error: unknown, code: string): boolean {
  return (error as NodeJS.ErrnoException)?.code === code;
}

/** Injectable filesystem is for isolated failure/race tests; the route uses the
 * real-filesystem instance below. This is not an authorization boundary: callers
 * must establish ownership and validate/process the bounded body first.
 *
 * An exclusive directory serializes writers across processes. Staged files are
 * complete and fsynced before hard-link publication (never rename/overwrite).
 * MIME is published first, body last: a visible body is never a partial write.
 * A crash can leave staging/sidecar debris; never steal an old lock automatically.
 * A trusted, application-owned storage root is required. Node does not provide
 * portable openat-style protection against a hostile OS user replacing parents.
 */
export function createLocalUploadPublisher(fileSystem: FileSystem = fs) {
  async function inspect(filePath: string): Promise<BigIntStats | undefined> {
    try { return await fileSystem.lstat(filePath, { bigint: true }); }
    catch (error) { if (isCode(error, "ENOENT")) return undefined; throw error; }
  }
  async function assertDirectories(directories: Identity[]): Promise<void> {
    for (const directory of directories) {
      const current = await inspect(directory.path);
      if (!current?.isDirectory() || current.isSymbolicLink() || !sameIdentity(current, directory.stat)) {
        throw new UnsafeLocalUploadPathError();
      }
    }
  }
  async function unlinkOwned(file: Identity): Promise<void> {
    const current = await inspect(file.path);
    if (!current) return;
    if (!current.isFile() || current.isSymbolicLink() || !sameIdentity(current, file.stat)) {
      throw new UnsafeLocalUploadPathError();
    }
    await fileSystem.unlink(file.path);
  }
  async function assertStagedFile(file: Identity): Promise<void> {
    const current = await inspect(file.path);
    if (!current?.isFile() || current.isSymbolicLink() || current.nlink !== 1n
      || !sameIdentity(current, file.stat) || current.size !== file.stat.size
      || current.mtimeNs !== file.stat.mtimeNs || current.ctimeNs !== file.stat.ctimeNs) {
      throw new UnsafeLocalUploadPathError();
    }
  }
  async function syncDirectory(directory: string): Promise<void> {
    // Windows does not support opening directories with fs.open. File fsync and
    // exclusive publication still apply; do not claim power-loss durability there.
    if (process.platform === "win32") return;
    const handle = await fileSystem.open(directory, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { await handle.sync(); } finally { await handle.close(); }
  }
  async function matches(filePath: string, expected: Buffer, before: BigIntStats): Promise<boolean> {
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n) throw new UnsafeLocalUploadPathError();
    if (before.size !== BigInt(expected.length)) return false;
    const handle = await fileSystem.open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const opened = await handle.stat({ bigint: true });
      if (!opened.isFile() || !sameIdentity(before, opened) || opened.nlink !== 1n) throw new UnsafeLocalUploadPathError();
      // Read only the expected length (+1), never an unbounded historical file.
      const actual = Buffer.alloc(expected.length + 1);
      let offset = 0;
      while (offset < actual.length) {
        const { bytesRead } = await handle.read(actual, offset, actual.length - offset, offset);
        if (bytesRead === 0) break;
        offset += bytesRead;
      }
      const after = await handle.stat({ bigint: true });
      const current = await inspect(filePath);
      if (!current || current.isSymbolicLink() || !sameIdentity(opened, current)
        || after.size !== opened.size || after.mtimeNs !== opened.mtimeNs || after.ctimeNs !== opened.ctimeNs) {
        throw new UnsafeLocalUploadPathError();
      }
      return offset === expected.length && actual.subarray(0, offset).equals(expected);
    } finally { await handle.close(); }
  }

  return async function publishLocalUpload(input: {
    root: string;
    relativePath: string;
    body: Buffer;
    contentType: string;
  }): Promise<"created" | "unchanged"> {
    if (!path.isAbsolute(input.root) || !isValidLocalUploadPath(input.relativePath)) throw new UnsafeLocalUploadPathError();
    if (input.body.length > 25 * 1024 * 1024 || input.contentType.length > 255
      || !/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/.test(input.contentType)) {
      throw new Error("Invalid local upload content");
    }
    const configuredRoot = await inspect(path.resolve(input.root));
    if (!configuredRoot?.isDirectory() || configuredRoot.isSymbolicLink()) throw new UnsafeLocalUploadPathError();
    const root = await fileSystem.realpath(input.root);
    const rootStat = await inspect(root);
    if (!rootStat || !sameIdentity(configuredRoot, rootStat)) throw new UnsafeLocalUploadPathError();
    const directories: Identity[] = [{ path: root, stat: rootStat }];
    const parts = input.relativePath.split("/");
    let parent = root;
    for (const part of parts.slice(0, -1)) {
      await assertDirectories(directories);
      parent = path.join(parent, part);
      try { await fileSystem.mkdir(parent, { mode: 0o700 }); }
      catch (error) { if (!isCode(error, "EEXIST")) throw error; }
      const stat = await inspect(parent);
      if (!stat?.isDirectory() || stat.isSymbolicLink()) throw new UnsafeLocalUploadPathError();
      directories.push({ path: parent, stat });
    }
    const target = path.resolve(root, input.relativePath);
    const relative = path.relative(root, target);
    if (!relative || relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
      throw new UnsafeLocalUploadPathError();
    }
    const sidecar = `${target}.ct`;
    const lock = path.join(parent, `${RESERVED_PREFIX}${createHash("sha256").update(input.relativePath).digest("hex")}`);
    await assertDirectories(directories);
    try { await fileSystem.mkdir(lock, { mode: 0o700 }); }
    catch (error) {
      if (!isCode(error, "EEXIST")) throw error;
      const existingLock = await inspect(lock);
      // The winning writer may finish and remove its lock between our failed
      // mkdir and this inspection. We never acquired the lock, so return busy
      // (caller may retry) without stealing it or publishing/cleaning anything.
      // An observed non-directory or symlink remains an unsafe path.
      if (existingLock && (!existingLock.isDirectory() || existingLock.isSymbolicLink())) throw new UnsafeLocalUploadPathError();
      throw new LocalUploadBusyError();
    }
    const lockStat = await inspect(lock);
    if (!lockStat?.isDirectory() || lockStat.isSymbolicLink()) throw new UnsafeLocalUploadPathError();
    directories.push({ path: lock, stat: lockStat });
    const staged: Identity[] = [];
    let publishedSidecar: Identity | undefined;
    let committed = false;
    try {
      await assertDirectories(directories);
      const [existingBody, existingType] = await Promise.all([inspect(target), inspect(sidecar)]);
      if (existingBody || existingType) {
        if (!existingBody || !existingType) throw new LocalUploadConflictError();
        if (!await matches(target, input.body, existingBody)
          || !await matches(sidecar, Buffer.from(input.contentType), existingType)) throw new LocalUploadConflictError();
        await assertDirectories(directories);
        return "unchanged";
      }
      for (const [name, content] of [["body", input.body], ["type", Buffer.from(input.contentType)]] as const) {
        await assertDirectories(directories);
        const temporaryPath = path.join(lock, name);
        const handle = await fileSystem.open(temporaryPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        try {
          const identity = { path: temporaryPath, stat: await handle.stat({ bigint: true }) };
          staged.push(identity);
          await handle.writeFile(content);
          await handle.sync();
          identity.stat = await handle.stat({ bigint: true });
          if (!identity.stat.isFile() || identity.stat.size !== BigInt(content.length)) throw new Error("Incomplete staged upload");
        } finally { await handle.close(); }
      }
      await assertDirectories(directories);
      await assertStagedFile(staged[1]!);
      await fileSystem.link(staged[1]!.path, sidecar);
      publishedSidecar = { path: sidecar, stat: staged[1]!.stat };
      await syncDirectory(parent);
      await assertDirectories(directories);
      await assertStagedFile(staged[0]!);
      await fileSystem.link(staged[0]!.path, target);
      committed = true;
      await syncDirectory(parent);
      return "created";
    } catch (error) {
      if (isCode(error, "EEXIST")) throw new LocalUploadConflictError();
      throw error;
    } finally {
      // No recursive cleanup, no age-based lock stealing, no unlink of an
      // existing object. If ownership/path validation fails, leave a locked key.
      await assertDirectories(directories);
      if (!committed && publishedSidecar) await unlinkOwned(publishedSidecar);
      for (const file of staged) await unlinkOwned(file);
      await fileSystem.rmdir(lock);
    }
  };
}

export const publishLocalUpload = createLocalUploadPublisher();
