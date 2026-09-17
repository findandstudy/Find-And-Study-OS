import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseUniversityBulkStatus } from "./universityBulkStatus";

test("single, multiple and duplicate university selections have one canonical ID set", () => {
  assert.deepEqual(parseUniversityBulkStatus({ ids: [7], isActive: false }), { ids: [7], isActive: false });
  assert.deepEqual(parseUniversityBulkStatus({ ids: [7, 8, 7], isActive: true }), { ids: [7, 8], isActive: true });
  assert.equal(parseUniversityBulkStatus({ ids: Array.from({ length: 5000 }, (_, i) => i + 1), isActive: false }).ids.length, 5000);
});
test("invalid status, empty, overflowing and non-integer university selections are rejected", () => {
  for (const body of [null, {}, { ids: [], isActive: true }, { ids: [1], isActive: "false" }, { ids: ["1"], isActive: false }, { ids: [0], isActive: false }, { ids: [-1], isActive: false }, { ids: [1.5], isActive: false }, { ids: [2147483648], isActive: false }, { ids: Array(5001).fill(1), isActive: true }]) {
    assert.throws(() => parseUniversityBulkStatus(body));
  }
});

const route = readFileSync(new URL("../routes/universities.ts", import.meta.url), "utf8");
const policy = readFileSync(new URL("./publicCatalogQueryPolicy.ts", import.meta.url), "utf8");
const finder = readFileSync(new URL("../routes/course-finder.ts", import.meta.url), "utf8");
test("bulk status is manager-only and never rewrites programs or historical applications", () => {
  const start = route.indexOf('router.patch("/universities/bulk-status"');
  const handler = route.slice(start, route.indexOf('router.get("/universities/:id"', start));
  assert.match(handler, /requireAuth, requireRole\(\.\.\.MANAGER_ROLES\)/);
  assert.match(handler, /db.update\(universitiesTable\)/);
  assert.match(handler, /inArray\(universitiesTable.id, input.ids\)/);
  assert.doesNotMatch(handler, /update\((programsTable|applicationsTable)\)|\.delete\(/);
  assert.match(handler, /invalidatePublicCatalogRenderCache/);
  assert.match(handler, /invalidatePublicWebDiscoveryCache/);
  assert.match(handler, /updated: updated.length/);
  assert.match(handler, /logAudit/);
});
test("parent active predicate applies even to staff Course Finder with null public policy", () => {
  const fn = policy.slice(policy.indexOf("export function addPublicCatalogConditions"));
  assert.ok(fn.indexOf("eq(universitiesTable.isActive, true)") < fn.indexOf("if (!policy) return"));
  assert.match(finder, /addPublicCatalogConditions\(conditions, publicPolicy\)/);
  assert.match(finder, /addPublicCatalogConditions\(conditions, opts\?\.publicPolicy \?\? null\)/);
});
test("Course Finder list and facet cache keys follow catalogue mutation generation", () => {
  assert.equal((finder.match(/const cacheKey = `\$\{getPublicCatalogCacheGeneration\(\)\}/g) ?? []).length, 2);
  const render = readFileSync(new URL("./publicCatalogRenderReadModel.ts", import.meta.url), "utf8");
  const invalidation = render.slice(render.indexOf("export function invalidatePublicCatalogRenderCache"));
  assert.match(invalidation, /cacheGeneration \+= 1/);
  assert.doesNotMatch(invalidation, /if \(removed > 0\) cacheGeneration/);
});
test("public canonical detail queries continue using active-university policy", () => {
  const catalog = readFileSync(new URL("../routes/public-catalog.ts", import.meta.url), "utf8");
  assert.match(catalog, /addPublicCatalogConditions\(conditions, policy\)/);
  assert.match(route, /!req.user && !uni.isActive/);
  assert.match(route, /!prog.isActive \|\| !parent\?\.isActive/);
});
