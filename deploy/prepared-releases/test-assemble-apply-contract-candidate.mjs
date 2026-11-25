import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { APPLY_BASE, BRANDING_DRIFT, REQUIRED_DRIFT, REQUIRED_EXTRAS, assembleApplyCandidate, sha256 } from "./assemble-apply-contract-candidate.mjs";

test("offline Apply overlay preserves the deployed drift and migration prefix", async t => {
  const temporary = await mkdtemp(path.join(tmpdir(), "fas-apply-candidate-"));
  const root = await realpath(temporary);
  const snapshotRoot = path.join(root, "snapshot"), patchRoot = path.join(root, "patch");
  await mkdir(snapshotRoot); await mkdir(patchRoot);
  const names = [...REQUIRED_DRIFT, ...REQUIRED_EXTRAS, ".env.example"];
  while (names.length < 1803) names.push(`artifacts/api-server/src/fixture-${names.length}.ts`);
  const files = [];
  try {
    for (const name of names) {
      const bytes = Buffer.from(`TEST synthetic source ${name}\n`);
      const full = path.join(snapshotRoot, name); await mkdir(path.dirname(full), { recursive: true }); await writeFile(full, bytes);
      const gitBlob = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
      files.push({ path: name, bytes: bytes.length, sha256: sha256(bytes), gitBlob,
        baseBlob: REQUIRED_EXTRAS.includes(name) ? null : REQUIRED_DRIFT.includes(name) ? "0".repeat(40) : gitBlob });
    }
    const source = { baseCommit: APPLY_BASE, drift: REQUIRED_DRIFT, extras: REQUIRED_EXTRAS, files };
    const snapshotManifest = path.join(root, "source-manifest.json");
    const sourceBytes = Buffer.from(JSON.stringify(source)); await writeFile(snapshotManifest, sourceBytes);
    const patched = Buffer.from("TEST merged branding preserving defined fields\n");
    const patchPath = path.join(patchRoot, BRANDING_DRIFT); await mkdir(path.dirname(patchPath), { recursive: true }); await writeFile(patchPath, patched);
    const before = files.find(file => file.path === BRANDING_DRIFT).sha256;
    const patch = { schemaVersion: 1, baseCommit: APPLY_BASE, sourceManifestSha256: sha256(sourceBytes), patchCommit: "a".repeat(40),
      files: [{ path: BRANDING_DRIFT, beforeSha256: before, afterSha256: sha256(patched) }],
      brandingMerge: { preservesDefinedProfileValues: true, beforeSha256: before, afterSha256: sha256(patched), reviewReceiptSha256: "b".repeat(64) } };
    const patchManifest = path.join(root, "patch-manifest.json");
    const invoke = async (name, patchValue = patch, overrides = {}) => {
      const bytes = Buffer.from(JSON.stringify(patchValue)); await writeFile(patchManifest, bytes);
      return assembleApplyCandidate({ snapshotRoot, snapshotManifest, snapshotManifestSha256: sha256(sourceBytes), patchRoot,
        patchManifest, patchManifestSha256: sha256(bytes), outputRoot: path.join(root, name), ...overrides });
    };
    await t.test("exact1803 source + reviewed branding overlay succeeds; other drift/extras unchanged", async () => {
      const result = await invoke("candidate"); assert.equal(result.fileCount, 1803);
      assert.equal(result.status, "SOURCE_CANDIDATE_PREPARED_NOT_BUILT");
      assert.equal((await readFile(path.join(root, "candidate", BRANDING_DRIFT))).toString(), patched.toString());
      for (const name of [...REQUIRED_DRIFT.filter(file => file !== BRANDING_DRIFT), ...REQUIRED_EXTRAS]) {
        assert.deepEqual(await readFile(path.join(root, "candidate", name)), await readFile(path.join(snapshotRoot, name)));
      }
    });
    await t.test("existing output cannot be overwritten", async () => { await assert.rejects(invoke("candidate"), /output_must_not_exist/); });
    await t.test("source manifest drift stops before output", async () => {
      await assert.rejects(invoke("wrong-hash", patch, { snapshotManifestSha256: "c".repeat(64) }), /manifest_hash_mismatch/);
    });
    await t.test("0066 and journal cannot be patched", async () => {
      const entry = files.find(file => file.path === "lib/db/drizzle/meta/_journal.json");
      await assert.rejects(invoke("forbidden-journal", { ...patch, files: [{ path: entry.path, beforeSha256: entry.sha256, afterSha256: "d".repeat(64) }] }), /protected_or_duplicate_patch/);
    });
    await t.test("branding cannot overwrite deployed fix without merge review", async () => {
      await assert.rejects(invoke("unreviewed", { ...patch, brandingMerge: undefined }), /branding_merge_review_required/);
    });
    await t.test("patch before-hash is bound to actual deployed bytes", async () => {
      await assert.rejects(invoke("bad-before", { ...patch, files: [{ ...patch.files[0], beforeSha256: "f".repeat(64) }] }), /patch_before_mismatch/);
    });
    await t.test("unexpected file in snapshot is not copied or ignored", async () => {
      await writeFile(path.join(snapshotRoot, "unexpected.txt"), "TEST");
      await assert.rejects(invoke("extra-source"), /snapshot_membership_mismatch/);
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});
