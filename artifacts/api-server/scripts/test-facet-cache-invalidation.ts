import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  clearFacetCacheForTests,
  invalidateFacetCache,
  loadFacetValue,
} from "../src/lib/facetCache";

process.env.FACET_CACHE_ENABLED = "true";
process.env.FACET_CACHE_TTL_MS = "300000";

clearFacetCacheForTests();
let applicationLoads = 0;
const readApplications = () => loadFacetValue({
  namespace: "applications",
  scope: { tenantId: "tenant-a" },
  filters: {},
  load: async () => ({ generation: ++applicationLoads }),
});

assert.deepEqual(await readApplications(), { generation: 1 });
assert.deepEqual(await readApplications(), { generation: 1 });
invalidateFacetCache("students");
assert.deepEqual(await readApplications(), { generation: 1 });
invalidateFacetCache("applications");
assert.deepEqual(await readApplications(), { generation: 2 });
invalidateFacetCache();
assert.deepEqual(await readApplications(), { generation: 3 });

const migration = readFileSync(
  new URL("../../../lib/db/drizzle/0129_facet_cache_invalidation.sql", import.meta.url),
  "utf8",
);
for (const table of ["applications", "leads", "students"]) {
  assert.match(migration, new RegExp(`AFTER INSERT OR UPDATE OR DELETE ON ${table}`));
}
assert.match(migration, /FOR EACH STATEMENT/);
assert.match(migration, /pg_notify\([\s\S]*'facet_cache_invalidation'/);
assert.doesNotMatch(migration, /row_to_json|OLD\.|NEW\./);

const indexSource = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
assert.match(indexSource, /facetCacheInvalidationBus\.subscribe\(namespace =>/);
assert.match(indexSource, /invalidateFacetCache\(namespace\)/);
assert.match(indexSource, /facetCacheInvalidationBus\.shutdown\(\)/);

console.log("[facet-cache-invalidation] 13/13 PASS");
