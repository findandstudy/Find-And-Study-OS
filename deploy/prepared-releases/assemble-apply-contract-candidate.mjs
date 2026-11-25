/** Offline source assembly only. No Docker, DB, network or deployment actions. */
import { createHash } from "node:crypto";
import { lstat, mkdir, open, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const APPLY_BASE = "a5f31e06568229d5f61fa29a1416dd46b83119b0";
export const VERIFIED_SOURCE_MANIFEST_SHA256 = "9d940fdc7536e6dffc2519b30fd489379bc1ccc32391491e07cb6f54f1492109";
export const BRANDING_DRIFT = "artifacts/api-server/src/lib/contractTemplateBranding.ts";
export const REQUIRED_DRIFT = [BRANDING_DRIFT,
  "artifacts/api-server/src/lib/educationExtraction.ts", "artifacts/api-server/src/routes/academySso.ts",
  "lib/db/drizzle/meta/_journal.json", "lib/db/src/academicLevels.ts", "lib/db/src/schema/studentEducationRecords.ts",
  "lib/portal-adapters/src/preflight.ts", "lib/portal-adapters/src/universities/altinbas/adapter.ts",
  "lib/portal-adapters/src/universities/altinbas/altinbasLogin.ts", "lib/portal-adapters/src/universities/altinbas/altinbasProgram.ts",
  "lib/portal-adapters/src/universities/altinbas/altinbasWizard.ts", "lib/portal-adapters/src/universities/sit/helpers.ts",
  "lib/portal-runner/src/profile.ts"];
export const REQUIRED_EXTRAS = ["artifacts/api-server/src/lib/academyProfileClaims.ts",
  "lib/db/drizzle/0066_education_country.sql", "lib/db/drizzle/meta/0066_snapshot.json",
  "lib/portal-adapters/src/universities/altinbas/altinbasCountry.ts"];
const PROTECTED = new Set([...REQUIRED_DRIFT.filter(file => file !== BRANDING_DRIFT), ...REQUIRED_EXTRAS]);
const HASH = /^[a-f0-9]{64}$/;
const BLOB = /^[a-f0-9]{40}$/;
const LIMIT = 64 * 1024 * 1024;
const fail = code => { throw new Error(`apply_candidate:${code}`); };
export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const gitBlob = bytes => createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
const sameList = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
function safePath(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._/-]+$/.test(value) || value.startsWith("/")
    || value.split("/").some(part => !part || part === "." || part === ".." || [".git", "node_modules", "storage", "dist"].includes(part))
    || value.split("/").some(part => part === ".env" || (part.startsWith(".env.") && part !== ".env.example"))
    || /\.(?:dump|log|sqlite|backup|bak)$/i.test(value)) fail("source_path_forbidden");
  return value;
}
async function verifiedFile(root, relative, expected, expectedBytes) {
  safePath(relative);
  let cursor = root;
  for (const part of relative.split("/")) {
    cursor = path.join(cursor, part);
    const info = await lstat(cursor);
    if (info.isSymbolicLink()) fail("source_symlink_forbidden");
  }
  const info = await lstat(cursor);
  if (!info.isFile() || info.nlink !== 1 || info.size > LIMIT || (expectedBytes !== undefined && info.size !== expectedBytes)) fail("source_size_or_type_mismatch");
  const fd = await open(cursor, "r");
  try {
    const opened = await fd.stat();
    if (!opened.isFile() || opened.dev !== info.dev || opened.ino !== info.ino || opened.size !== info.size) fail("source_changed");
    const bytes = await fd.readFile();
    if (bytes.length !== info.size || sha256(bytes) !== expected || await realpath(cursor) !== cursor) fail("source_digest_mismatch");
    return bytes;
  } finally { await fd.close(); }
}
async function enumerate(root, prefix = "", state = { count: 0 }) {
  const output = [];
  for (const entry of await readdir(path.join(root, prefix), { withFileTypes: true })) {
    if (++state.count > 10000) fail("snapshot_tree_limit");
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) fail("source_symlink_forbidden");
    if (entry.isDirectory()) output.push(...await enumerate(root, rel, state));
    else if (entry.isFile()) output.push(safePath(rel));
    else fail("source_type_forbidden");
  }
  return output;
}
function externalOutput(output, roots) {
  for (const root of roots) {
    const relative = path.relative(root, output);
    const reverse = path.relative(output, root);
    if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
      || (!reverse.startsWith(`..${path.sep}`) && reverse !== ".." && !path.isAbsolute(reverse))) fail("output_overlaps_input");
  }
}

export async function assembleApplyCandidate(options) {
  const { snapshotRoot: inputSnapshot, snapshotManifest, snapshotManifestSha256, patchRoot: inputPatch,
    patchManifest, patchManifestSha256, outputRoot } = options;
  if (!HASH.test(snapshotManifestSha256) || !HASH.test(patchManifestSha256)) fail("reviewed_manifest_hashes_required");
  const [snapshotRoot, patchRoot] = await Promise.all([realpath(inputSnapshot), realpath(inputPatch)]);
  const parent = await realpath(path.dirname(outputRoot));
  const output = path.join(parent, path.basename(outputRoot));
  if (output !== outputRoot) fail("canonical_output_required");
  for (const forbidden of ["/srv/academy160-preview", "/opt/findandstudy", "/var/lib/findandstudy"]) {
    if (output === forbidden || output.startsWith(`${forbidden}/`)) fail("production_output_forbidden");
  }
  externalOutput(output, [snapshotRoot, patchRoot]);
  try { await lstat(output); fail("output_must_not_exist"); } catch (error) { if (error.code !== "ENOENT") throw error; }
  const [sourceInfo, patchInfo] = await Promise.all([lstat(snapshotManifest), lstat(patchManifest)]);
  if (!sourceInfo.isFile() || sourceInfo.isSymbolicLink() || sourceInfo.size > 4 * 1024 * 1024
    || !patchInfo.isFile() || patchInfo.isSymbolicLink() || patchInfo.size > 1024 * 1024) fail("manifest_size_or_type_invalid");
  const [sourceBytes, patchBytes] = await Promise.all([readFile(snapshotManifest), readFile(patchManifest)]);
  if (sourceBytes.length > 4 * 1024 * 1024 || patchBytes.length > 1024 * 1024
    || sha256(sourceBytes) !== snapshotManifestSha256 || sha256(patchBytes) !== patchManifestSha256) fail("manifest_hash_mismatch");
  const source = JSON.parse(sourceBytes.toString("utf8"));
  const patch = JSON.parse(patchBytes.toString("utf8"));
  if (source.baseCommit !== APPLY_BASE || patch.baseCommit !== APPLY_BASE || patch.schemaVersion !== 1
    || patch.sourceManifestSha256 !== snapshotManifestSha256 || !BLOB.test(patch.patchCommit)
    || !Array.isArray(source.files) || source.files.length !== 1803
    || !Array.isArray(patch.files) || patch.files.length === 0 || patch.files.length > 200) fail("manifest_identity_invalid");
  const paths = source.files.map(entry => safePath(entry.path));
  if (new Set(paths).size !== paths.length || !sameList(await enumerate(snapshotRoot), paths)) fail("snapshot_membership_mismatch");
  const recordedDrift = source.drift.map(item => typeof item === "string" ? item : item.path);
  const recordedExtras = source.extras.map(item => typeof item === "string" ? item : item.path);
  const derivedExtras = source.files.filter(entry => entry.baseBlob === null).map(entry => entry.path);
  const derivedDrift = source.files.filter(entry => entry.baseBlob !== null && entry.gitBlob !== entry.baseBlob).map(entry => entry.path);
  if (!sameList(recordedDrift, REQUIRED_DRIFT) || !sameList(derivedDrift, REQUIRED_DRIFT)
    || !sameList(recordedExtras, REQUIRED_EXTRAS) || !sameList(derivedExtras, REQUIRED_EXTRAS)) fail("live_drift_inventory_mismatch");
  const content = new Map();
  let totalBytes = 0;
  for (const entry of source.files) {
    if (!HASH.test(entry.sha256) || !BLOB.test(entry.gitBlob) || (entry.baseBlob !== null && !BLOB.test(entry.baseBlob))
      || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0) fail("source_entry_invalid");
    if ((totalBytes += entry.bytes) > 256 * 1024 * 1024) fail("snapshot_size_limit");
    const bytes = await verifiedFile(snapshotRoot, entry.path, entry.sha256, entry.bytes);
    if (gitBlob(bytes) !== entry.gitBlob) fail("source_git_blob_mismatch");
    content.set(entry.path, bytes);
  }
  const patchPaths = new Set();
  for (const entry of patch.files) {
    const file = safePath(entry.path);
    if (patchPaths.has(file) || PROTECTED.has(file) || (file.startsWith("lib/db/drizzle/") && !PROTECTED.has(file))) fail("protected_or_duplicate_patch");
    patchPaths.add(file);
    if (!HASH.test(entry.afterSha256) || (entry.beforeSha256 !== null && !HASH.test(entry.beforeSha256))) fail("patch_entry_invalid");
    const before = content.get(file);
    if ((before ? sha256(before) : null) !== entry.beforeSha256) fail("patch_before_mismatch");
    if (file === BRANDING_DRIFT && (patch.brandingMerge?.preservesDefinedProfileValues !== true
      || patch.brandingMerge.beforeSha256 !== entry.beforeSha256 || patch.brandingMerge.afterSha256 !== entry.afterSha256
      || !HASH.test(patch.brandingMerge.reviewReceiptSha256 ?? ""))) fail("branding_merge_review_required");
    content.set(file, await verifiedFile(patchRoot, file, entry.afterSha256));
  }
  // All bytes are verified before creating the output; no source is modified.
  await mkdir(output, { mode: 0o700 });
  for (const [file, bytes] of content) {
    const target = path.join(output, file);
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, bytes, { flag: "wx", mode: 0o600 });
  }
  const files = [...content].map(([file, bytes]) => ({ path: file, sha256: sha256(bytes), bytes: bytes.length })).sort((a, b) => a.path.localeCompare(b.path));
  const receipt = { schemaVersion: 1, baseCommit: APPLY_BASE, sourceManifestSha256: snapshotManifestSha256,
    patchManifestSha256, patchCommit: patch.patchCommit, fileCount: files.length,
    sourceTreeSha256: sha256(JSON.stringify(files)), preservedDrift: [...PROTECTED].sort(),
    migrationPolicy: "PRESERVE_LIVE_67_PREFIX_NO_MIGRATION", files };
  await writeFile(path.join(output, ".apply-candidate-receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  return { status: "SOURCE_CANDIDATE_PREPARED_NOT_BUILT", fileCount: files.length, sourceTreeSha256: receipt.sourceTreeSha256 };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const flags = new Map();
  const allowed = new Set(["--snapshot-root", "--snapshot-manifest", "--patch-root", "--patch-manifest", "--patch-manifest-sha256", "--output-root"]);
  try {
    for (let i = 2; i < process.argv.length; i += 2) {
      const key = process.argv[i], value = process.argv[i + 1];
      if (!allowed.has(key) || flags.has(key) || !value || value.startsWith("--")) fail("arguments_invalid");
      flags.set(key, value);
    }
    if (flags.size !== allowed.size) fail("arguments_missing");
    const result = await assembleApplyCandidate({ snapshotRoot: flags.get("--snapshot-root"), snapshotManifest: flags.get("--snapshot-manifest"),
      snapshotManifestSha256: VERIFIED_SOURCE_MANIFEST_SHA256, patchRoot: flags.get("--patch-root"), patchManifest: flags.get("--patch-manifest"),
      patchManifestSha256: flags.get("--patch-manifest-sha256"), outputRoot: flags.get("--output-root") });
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(/^apply_candidate:[a-z_]+$/.test(error.message ?? "") ? error.message : "apply_candidate:preparation_failed_inspect_privately");
    process.exitCode = 1;
  }
}
