import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseCourseFinderDetailContext } from "../src/lib/courseFinderDetailContext";

test("detail context is opt-in, strict and university-bound", () => {
  assert.equal(parseCourseFinderDetailContext({}), null);
  assert.equal(parseCourseFinderDetailContext({ scope: "public", universityId: "1563", detailUniversityId: "1563" }), 1563);
  for (const id of ["", "0", "-1", "01", "1,2", "1e2", "2147483648", ["1"], {}, 1]) {
    assert.throws(() => parseCourseFinderDetailContext({ scope: "public", universityId: id, detailUniversityId: id }));
  }
  for (const query of [
    { universityId: "1", detailUniversityId: "1" },
    { scope: "public", universityId: "2", detailUniversityId: "1" },
    { scope: "public", detailUniversityId: "1" },
    { scope: "internal", universityId: "1", detailUniversityId: "1" },
  ]) assert.throws(() => parseCourseFinderDetailContext(query));
});

test("detail eligibility precedes count/pagination and scopes every facet, including university", () => {
  const source = readFileSync(new URL("../src/routes/course-finder.ts", import.meta.url), "utf8");
  assert.ok(source.indexOf("conditions.push(detailScope.eligibility)") < source.indexOf("const where = and(...conditions)"));
  assert.match(source, /const policyOpts = \{ publicPolicy, detailScope \}/);
  assert.match(source, /conditions.push\(eq\(programsTable.universityId, opts.detailScope.universityId\)\)/);
  assert.equal(source.match(/detailScope\?\.key \?\? "default"/g)?.length, 2);
  assert.match(source, /Math.min\(pagination.limit, 64\)/);
  assert.match(source, /detailScope \? await readPublicCatalogPrices\(rows.map/);
  assert.match(source, /tuition: projectPublicTuition\(row, detailPrices.get\(row.id\) \?\? \[\]\)/);
});

test("published eligibility uses tenant-scoped university SQL and fails closed on overflow", () => {
  const source = readFileSync(new URL("../src/lib/publicWebDiscoveryReadModel.ts", import.meta.url), "utf8");
  const helper = source.split("export async function readIndexableUniversityProgramIds")[1].split("export async function readIndexableArticleIds")[0];
  assert.match(helper, /withPublicScope\(scope/);
  assert.match(helper, /program.university_id=\$4/);
  assert.match(helper, /content.tenant_id=\$1 AND content.organization_id=\$2/);
  assert.match(helper, /state.status='PUBLISHED' AND state.index_state='INDEX'/);
  assert.match(helper, /translation.status='published'/);
  assert.match(helper, /LIMIT 10001/);
  assert.match(helper, /result.rows.length > 10000\) throw/);
});

test("verified detail prices bypass completed list caches while default and facet caching remain", () => {
  const source = readFileSync(new URL("../src/routes/course-finder.ts", import.meta.url), "utf8");
  assert.match(source, /const cached = detailScope \? undefined : courseFinderListCache.get\(cacheKey\)/);
  assert.match(source, /if \(!detailScope\) cacheCourseFinderList\(cacheKey, nextPayload\)/);
  assert.match(source, /res.setHeader\("Cache-Control", detailScope \? "no-store" : "private, no-cache"\)/);
  assert.match(source, /namespace: "course-finder-list",\s*key: cacheKey,\s*enabled: true/);
  assert.match(source, /const cached = courseFinderFilterCache.get\(cacheKey\)/);
  assert.match(source, /cacheCourseFinderFilters\(cacheKey, payload\)/);
});
