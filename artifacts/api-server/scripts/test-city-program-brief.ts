import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/lib/publicCatalogRenderReadModel.ts", import.meta.url), "utf8");
const city = source.split("async function readCityDetail(")[1].split("async function ")[0];

test("city cards project only safe bounded public facts with canonical tuition and requirements", () => {
  assert.match(city, /eq\(citiesTable.isActive, true\)/);
  assert.match(city, /eq\(countriesTable.isActive, true\)/);
  assert.match(city, /addPublicCatalogConditions\(universityConditions, policy\)/);
  assert.match(city, /universitiesTable.city/);
  assert.match(city, /countryAliases/);
  assert.match(city, /indexableProgramIds.has\(program.id\)/);
  assert.match(city, /slice\(0, PILOT_LIST_LIMIT\)/);
  assert.match(city, /readPublicCatalogPrices\(deliveredProgramRows.map\(program => program.id\)\)/);
  assert.match(city, /tuition: projectPublicTuition\(program, cityProgramPrices.get\(program.id\) \?\? \[\]\)/);
  assert.match(city, /requirements: publicCatalogRequirements\(program.requirements, \{ canonicalPath: programPath, id: program.id \}\)/);
  assert.match(city, /universityLogoUrl: courseFinderUniversityLogoUrl/);
  assert.match(city, /!parsed.username && !parsed.password/);
  const output = city.slice(city.indexOf("const programs = deliveredProgramRows"));
  for (const field of ["universityId", "universityPath", "universityType", "universityCity", "universityCountry", "universityIsActive", "isActive", "language", "duration", "description"]) assert.ok(output.includes(`${field}:`));
  assert.doesNotMatch(output, /\.\.\.program|tuitionFee:|discountedFee:|intakes:|commission|contactPerson|serviceFee/);
  assert.match(city, /deliveredProgramRows.map\(program => program.universityId\)/, "localization covers delivered program institutions in a separate bounded batch");
  assert.match(city, /selectLocalizedEntityDelivery\(localizedProgramUniversities, program.universityId\)/);
  assert.match(city, /readIndexableUniversityIds\(\{ locale: route.locale, universityIds: programUniversityIds \}\)/);
  assert.match(city, /universityPath: indexableProgramUniversityIds === null \|\| indexableProgramUniversityIds.has\(program.universityId\)[\s\S]*?: undefined/);
});

test("program and university targeted invalidation include city cards", () => {
  const invalidation = source.slice(source.indexOf("export function invalidatePublicCatalogRenderCache"));
  assert.match(invalidation, /input.entityType === "program"[\s\S]*?kind === "city_detail"/);
  assert.match(invalidation, /input.entityType === "university"[\s\S]*?kind === "city_detail"/);
});

test("time-bound city card facts bypass stale reads without changing other page caches", () => {
  const read = source.slice(source.indexOf("export async function getPublicCatalogRenderModel"));
  assert.ok(read.indexOf('if (route.kind === "city_detail" || route.kind === "program_detail")') < read.indexOf("const entry = cache.get(key)"));
  assert.match(read, /value: await refresh\(key, route\), cacheStatus: coalesced \? "COALESCED" : "MISS"/);
  assert.match(source, /generation === cacheGeneration && route.kind !== "city_detail"/);
  assert.match(source, /route.kind !== "city_detail" && route.kind !== "program_detail"/);
  const middleware = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
  assert.match(middleware, /rendered.value.kind === "program_detail" \|\| rendered.value.kind === "city_detail"\s*\? "no-store"/);
  const routes = readFileSync(new URL("../src/routes/public-web.ts", import.meta.url), "utf8");
  const cityRoute = routes.split('router.get("/public/web/cities/:routeKey"')[1].split('router.get(')[0];
  assert.match(cityRoute, /setPublicHeaders\(res\);\s*res.setHeader\("Cache-Control", "no-store"\)/);
});
