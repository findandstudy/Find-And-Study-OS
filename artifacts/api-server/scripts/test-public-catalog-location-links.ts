import test from "node:test";
import assert from "node:assert/strict";
import { catalogCountryRoute, catalogCountryRouteAccessible, matchCatalogCountry } from "../src/lib/publicCatalogLocationLinks";
import { publicUniversityTypeAliases } from "../src/lib/publicCatalogQueryPolicy";
const gb = { id: 1, name: "United Kingdom", code: "GB", isActive: true };
const tr = { id: 2, name: "Türkiye", code: "TR", isActive: true };
test("country matching reuses code/name/normalized slug and known catalog aliases", () => {
  for (const value of ["UK", "GB", "United Kingdom", "united-kingdom"]) assert.equal(matchCatalogCountry(value, [gb, tr])?.id, 1);
  assert.equal(matchCatalogCountry("Turkey", [gb, tr])?.id, 2);
  assert.equal(matchCatalogCountry("unknown", [gb, tr]), null);
});
test("catalog fallback routes do not create a parallel ID namespace", () => {
  assert.equal(catalogCountryRoute(gb, [gb, tr], [], "en"), "/en/countries/united-kingdom");
  assert.equal(catalogCountryRoute(gb, [gb, tr], [{ id: 9, country: "UK", slug: "study-uk", isActive: true }], "tr"), "/tr/destinations/study-uk");
});
test("inactive destinations and ambiguous names/slugs fail closed", () => {
  assert.equal(catalogCountryRoute(gb, [gb], [{ id: 9, country: "UK", slug: "uk", isActive: false }], "en"), null);
  assert.equal(matchCatalogCountry("GB", [gb, { ...gb, id: 3 }]), null);
  assert.equal(catalogCountryRoute(gb, [gb], [{ id: 9, country: "Turkey", slug: "united-kingdom", isActive: true }], "en"), null);
  assert.equal(catalogCountryRoute({ ...gb, isActive: false }, [gb], [], "en"), null);
});
test("authored country pages can open independently while empty catalogue records stay closed", () => {
  assert.equal(catalogCountryRouteAccessible({ catalogEligible: true, editorialPublished: false }), true);
  assert.equal(catalogCountryRouteAccessible({ catalogEligible: false, editorialPublished: true }), true);
  assert.equal(catalogCountryRouteAccessible({ catalogEligible: false, editorialPublished: false }), false);
});
test("public university type policy maps regional foundation/state labels without guessing unrelated values", () => {
  assert.deepEqual(publicUniversityTypeAliases(["Private"]), ["Private", "Foundation", "Foundation University", "Vakıf", "Vakıf Üniversitesi"]);
  assert.deepEqual(publicUniversityTypeAliases(["Public"]), ["Public", "State", "State University", "Devlet", "Devlet Üniversitesi"]);
  assert.deepEqual(publicUniversityTypeAliases(["College"]), ["College"]);
});
