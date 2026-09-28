import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../src", import.meta.url));
const files: string[] = [];
function walk(dir: string): void {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.(?:ts|tsx)$/.test(entry)) files.push(full);
  }
}
walk(root);

const genericConsumers = files.filter((file) =>
  readFileSync(file, "utf8").includes("/api/storage/uploads/request-url"));
assert.ok(genericConsumers.length >= 18, "generic upload inventory unexpectedly shrank");
for (const file of genericConsumers) {
  const source = readFileSync(file, "utf8");
  assert.match(source, /uploadAndFinalizeObject|uploadDocumentFile/,
    `${path.relative(root, file)} must finalize its generic object upload`);
}

const rawUploadFetch = files
  .filter((file) => !file.endsWith(path.join("lib", "finalizeObjectUpload.ts")))
  .filter((file) => !file.endsWith(path.join("pages", "public", "AgencyApplication.tsx")))
  .flatMap((file) => {
    const source = readFileSync(file, "utf8");
    return /fetch\([^\n]*(?:uploadURL|uploadUrl|\.uploadURL)/.test(source)
      ? [path.relative(root, file)] : [];
  });
assert.deepEqual(rawUploadFetch, [], "generic object uploads cannot bypass finalization");

console.log(`[upload-finalization] ${genericConsumers.length} generic consumers PASS`);
