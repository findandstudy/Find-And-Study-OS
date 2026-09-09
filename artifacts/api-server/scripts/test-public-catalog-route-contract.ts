import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PUBLIC_CATALOG_RELATED_LIMIT,
  PUBLIC_CATALOG_UNIVERSITY_PROGRAM_LIMIT,
  parsePublicCatalogRouteKey,
  publicCatalogCanonicalState,
  publicCatalogPath,
  publicCatalogRouteKey,
  publicCatalogSlug,
} from "../src/lib/publicCatalogRouteContract";

const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

test("catalogue slugs are stable, bounded, and ASCII-safe", () => {
  assert.equal(publicCatalogSlug("İşletme ve Yönetim (MSc)"), "isletme-ve-yonetim-msc");
  assert.equal(publicCatalogRouteKey(42, "Computer Science"), "computer-science-42");
  assert.equal(publicCatalogSlug("***"), "item");
  assert.ok(publicCatalogSlug("a".repeat(300)).length <= 150);
});

test("route identities reject ambiguous and unsafe input", () => {
  assert.deepEqual(parsePublicCatalogRouteKey("computer-science-42"), {
    id: 42,
    slug: "computer-science",
    routeKey: "computer-science-42",
  });
  for (const invalid of ["42", "../program-42", "program-0", "program-999999999999", "Program 42", "x".repeat(181)]) {
    assert.equal(parsePublicCatalogRouteKey(invalid), null);
  }
});

test("canonical paths normalize locale and detect stale slugs", () => {
  assert.equal(
    publicCatalogPath({ locale: "tr-TR", entityType: "program", id: 7, name: "Tıp" }),
    "/tr/programs/tip-7",
  );
  assert.equal(
    publicCatalogPath({ locale: "xx", entityType: "university", id: 3, name: "Example University" }),
    "/en/universities/example-university-3",
  );
  assert.deepEqual(
    publicCatalogCanonicalState({
      requestedRouteKey: "old-name-7",
      locale: "tr",
      entityType: "program",
      id: 7,
      name: "Tıp",
    }),
    {
      routeKey: "tip-7",
      canonicalPath: "/tr/programs/tip-7",
      isCanonical: false,
    },
  );
});

test("public catalogue detail APIs are bounded and never select private CRM fields", () => {
  const route = read("../src/routes/public-catalog.ts");
  const destinations = read("../src/routes/destinations.ts");
  assert.equal(PUBLIC_CATALOG_RELATED_LIMIT, 8);
  assert.equal(PUBLIC_CATALOG_UNIVERSITY_PROGRAM_LIMIT, 12);
  assert.doesNotMatch(route, /commissionRate|serviceFeeAmount|contactPerson(Name|Phone|Email)/);
  assert.match(route, /isNotNull\(priceComponentsTable\.sourceVerifiedAt\)/);
  assert.match(route, /sourceExpiresAt/);
  assert.match(route, /Content-Location/);
  assert.match(destinations, /returnedUniversities/);
  assert.match(destinations, /returnedPrograms/);
  assert.match(destinations, /PUBLIC_DESTINATION_ROUTE_INVALID/);
  assert.match(destinations, /resolvePublishedEntitySeoState/);
  assert.match(destinations, /Content-Location/);
  assert.match(destinations, /alternatePaths/);
  assert.doesNotMatch(destinations, /\.limit\(50\)/);
});
