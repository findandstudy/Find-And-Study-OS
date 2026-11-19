import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const catalog = readFileSync(
  new URL("../../edcons/src/pages/admin/Catalog.tsx", import.meta.url),
  "utf8",
);
const stagingCompose = readFileSync(
  new URL("../../../deploy/staging/compose.yml", import.meta.url),
  "utf8",
);

test("staging API keeps request capacity beyond dedicated LISTEN clients", () => {
  assert.match(stagingCompose, /DB_POOL_MAX:\s*"\$\{FASOS_STAGING_DB_POOL_MAX:-20\}"/);
});

test("all catalogue entity editors expose pending save feedback", () => {
  const pendingLabels = catalog.match(/save\.isPending \? t\("common\.saving"\) : t\("common\.save"\)/g) ?? [];
  assert.equal(pendingLabels.length, 4);
});

test("catalogue entity editors report save failures instead of failing silently", () => {
  const saveFailures = catalog.match(/title: t\("catalogPage\.saveFailed"\)/g) ?? [];
  assert.ok(saveFailures.length >= 4);
});
