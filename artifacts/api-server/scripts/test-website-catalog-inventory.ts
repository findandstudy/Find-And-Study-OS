import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseCatalogInventoryQuery, catalogAvailability, catalogSourceEditPath } from "../src/lib/websiteCatalogInventoryContract";

test("catalogue inventory validates bounded explicit kinds, locales, search and pagination", () => {
  assert.deepEqual(parseCatalogInventoryQuery({}), { kind: "program", locale: "en", q: "", page: 1, pageSize: 25 });
  assert.deepEqual(parseCatalogInventoryQuery({ kind: "city", locale: "ar", page: "2", pageSize: "50", q: " London " }), { kind: "city", locale: "ar", page: 2, pageSize: 50, q: "London" });
  for (const bad of [{ kind: "users" }, { kind: ["city"] }, { locale: "xx" }, { page: "0" }, { page: "10001" }, { pageSize: "51" }, { pageSize: "-1" }, { q: "x".repeat(121) }, { q: "\n" }, { q: {} }, { status: "published" }]) assert.throws(() => parseCatalogInventoryQuery(bad));
});

test("inventory separates catalogue visibility, source activity and admissions", () => {
  assert.deepEqual(catalogAvailability({ kind: "university", active: false }), { visible: true, admissionsOpen: false, issues: ["SOURCE_INACTIVE"] });
  assert.equal(catalogAvailability({ kind: "program", active: true, parentActive: false }).visible, true);
  assert.equal(catalogAvailability({ kind: "program", active: true, parentActive: false }).admissionsOpen, false);
  assert.equal(catalogAvailability({ kind: "program", active: false }).visible, false);
  assert.equal(catalogAvailability({ kind: "university", active: true, policyVisible: false }).visible, false);
  assert.equal(catalogAvailability({ kind: "university", active: true, policyVisible: false }).admissionsOpen, true, "publication policy does not rewrite admissions state");
  assert.equal(catalogAvailability({ kind: "city", active: true, parentActive: false }).visible, false);
  assert.equal(catalogAvailability({ kind: "country", active: true, countryRoute: false }).visible, false);
});

test("source links preserve catalogue identity and never use public titles as record IDs", () => {
  const path = catalogSourceEditPath("program", 42, "A&B / Test");
  const url = new URL(path, "https://example.test");
  assert.equal(url.pathname, "/admin/catalog");
  assert.equal(url.searchParams.get("tab"), "programs");
  assert.equal(url.searchParams.get("sourceId"), "42");
  assert.equal(url.searchParams.get("q"), "A&B / Test");
});

test("inventory is admin-only, no-store, bounded and contains no catalogue or publication writer", () => {
  const routes = readFileSync(new URL("../src/routes/website.ts", import.meta.url), "utf8");
  assert.match(routes, /router.get\("\/website\/catalog-pages", \.\.\.adminOnly/);
  const route = routes.slice(routes.indexOf('router.get("/website/catalog-pages"'), routes.indexOf('router.get("/website/detail-layouts"'));
  assert.match(route, /private, no-store/);
  assert.match(route, /noindex, nofollow/);
  const model = readFileSync(new URL("../src/lib/websiteCatalogInventory.ts", import.meta.url), "utf8");
  assert.doesNotMatch(model, /\.(insert|update|delete)\(/);
  assert.doesNotMatch(model, /contactPerson|assignedStaff|commissionRate|sourceHash/);
  assert.match(model, /limit\(query.pageSize\)/);
  assert.match(model, /readPublicEntityPublicationSummaries/);
  assert.match(model, /resolvePublishedEntitySeoState/);
  assert.match(model, /NOT_EVALUATED/);
});
