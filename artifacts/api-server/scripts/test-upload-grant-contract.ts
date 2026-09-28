import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../../../lib/db/drizzle/0128_object_upload_grants.sql", import.meta.url), "utf8");
const columnNames = [...migration.matchAll(/^\s+"([a-z_]+)"\s+(?:text|integer|timestamptz)/gm)]
  .map((match) => match[1]);
const helper = readFileSync(new URL("../src/lib/uploadGrant.ts", import.meta.url), "utf8");
const storage = readFileSync(new URL("../src/routes/storage.ts", import.meta.url), "utf8");
const documentClient = readFileSync(new URL("../../edcons/src/lib/uploadDocumentFile.ts", import.meta.url), "utf8");
const socialClient = readFileSync(new URL("../../edcons/src/lib/uploadSocialMediaFile.ts", import.meta.url), "utf8");

assert.match(migration, /PRIMARY KEY REFERENCES "object_owners"/, "one grant is bound to one owned object key");
assert.match(migration, /CHECK \("status" IN \('ISSUED', 'FINALIZED', 'CONSUMED'\)\)/, "grant lifecycle is bounded");
assert.match(migration, /content_sha256/, "finalization persists exact content digest");
assert.ok(!columnNames.some((name) => /original_file_name|signed_url|secret|token/i.test(name)), "grant table retains no filename, URL or secret");
assert.match(helper, /15 \* 60 \* 1000/, "grant expires after a bounded fifteen-minute window");
assert.match(helper, /WHERE object_key = \$1 AND uploaded_by = \$2 AND status = 'ISSUED'/,
  "finalization uses one atomic conditional claim");
assert.match(helper, /AND expires_at >= \$7 AND expected_size = \$3/,
  "atomic claim binds expiry and declared size");
assert.match(helper, /expected_size[^]*expected_content_type/, "declared metadata is bound to the grant");
assert.match(storage, /router\.post\("\/storage\/uploads\/finalize"/, "authenticated finalization route exists");
assert.ok(storage.indexOf("getMetadata()") < storage.indexOf("file.download()", storage.indexOf("uploads/finalize")), "provider size is checked before bytes are downloaded");
assert.match(storage, /await finalizeUploadGrant\(/, "local upload finalizes inside its authenticated PUT handler");
assert.match(documentClient, /await finalizeObjectUpload\(objectPath\)/, "canonical document helper finalizes before registration");
assert.match(socialClient, /await finalizeObjectUpload\(prepared\.objectPath\)/, "social helper finalizes before registration");

console.log("[upload-grant-contract] 13/13 PASS");
