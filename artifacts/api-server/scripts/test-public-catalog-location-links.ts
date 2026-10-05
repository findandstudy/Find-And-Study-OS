import test from "node:test";
import assert from "node:assert/strict";
import { catalogCountryRoute, matchCatalogCountry } from "../src/lib/publicCatalogLocationLinks";
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
