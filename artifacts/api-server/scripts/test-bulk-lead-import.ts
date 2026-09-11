import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  findBulkLeadIdentityConflict,
  normalizeBulkLeadEmail,
  rememberBulkLeadIdentity,
} from "../src/lib/bulkLeadImport";

test("normalizes email identities without creating empty keys", () => {
  assert.equal(
    normalizeBulkLeadEmail("  Person@Example.COM "),
    "person@example.com",
  );
  assert.equal(normalizeBulkLeadEmail("   "), null);
  assert.equal(normalizeBulkLeadEmail(undefined), null);
});

test("detects duplicates already stored or repeated within the same upload", () => {
  const existing = {
    emails: new Set(["existing@example.com"]),
    phones: new Set(["+905551112233"]),
  };

  assert.equal(
    findBulkLeadIdentityConflict(
      { email: "existing@example.com", phoneE164: null },
      existing,
    ),
    "email",
  );
  assert.equal(
    findBulkLeadIdentityConflict(
      { email: null, phoneE164: "+905551112233" },
      existing,
    ),
    "phone",
  );
  assert.equal(
    findBulkLeadIdentityConflict(
      { email: "existing@example.com", phoneE164: "+905551112233" },
      existing,
    ),
    "email and phone",
  );

  const newIdentity = { email: "new@example.com", phoneE164: "+905559998877" };
  assert.equal(findBulkLeadIdentityConflict(newIdentity, existing), null);
  rememberBulkLeadIdentity(newIdentity, existing);
  assert.equal(
    findBulkLeadIdentityConflict(newIdentity, existing),
    "email and phone",
  );
});

test("bulk lead UI uses CSRF-aware requests and 200-row batches", () => {
  const source = readFileSync(
    fileURLToPath(
      new URL("../../edcons/src/pages/staff/Leads.tsx", import.meta.url),
    ),
    "utf8",
  );

  assert.match(
    source,
    /customFetch<\{ records\?: any\[\]; students\?: any\[\] \}>\(`\$\{BASE_URL\}\/api\/ai\/extract-bulk-csv`/,
  );
  assert.match(source, /const LEAD_BULK_IMPORT_BATCH_SIZE = 200;/);
  assert.match(
    source,
    /preview\.slice\(offset, offset \+ LEAD_BULK_IMPORT_BATCH_SIZE\)/,
  );
  assert.match(
    source,
    /customFetch<\{ success: number; errors\?: unknown\[\] \}>\(`\$\{BASE_URL\}\/api\/leads\/bulk`/,
  );
});
