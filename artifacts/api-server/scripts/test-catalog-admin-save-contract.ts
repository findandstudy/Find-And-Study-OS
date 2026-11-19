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
const catalogRoutes = readFileSync(
  new URL("../src/routes/catalog.ts", import.meta.url),
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

test("direct catalogue links open an editor only once", () => {
  assert.match(catalog, /if \(!id \|\| opened\.current \|\| !\["programs", "universities"\]\.includes\(tab\)\) return;/);
});

test("university editor resolves localized country aliases before loading cities", () => {
  assert.match(catalog, /function findCatalogCountry\(/);
  assert.match(catalog, /countryNameToIso\(raw\)/);
  assert.match(catalog, /setSelCountryId\(findCatalogCountry\(allCountries, university\.country\)\?\.id \?\? null\)/);
});

test("country details and public university-type policy save atomically", () => {
  assert.match(catalog, /publicUniversityTypes:\s*\{/);
  assert.doesNotMatch(catalog, /await api\(`\/api\/countries\/\$\{saved\.id\}\/public-university-types`/);
  assert.match(catalogRoutes, /await db\.transaction\(async tx => \{[\s\S]*?persistCountryUniversityTypeRule\(tx, created, publicUniversityTypes\)/);
  assert.match(catalogRoutes, /await db\.transaction\(async tx => \{[\s\S]*?persistCountryUniversityTypeRule\(tx, updated, publicUniversityTypes\)/);
});
