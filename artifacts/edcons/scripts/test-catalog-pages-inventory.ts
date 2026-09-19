import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseCatalogEntryNavigation } from "../src/lib/catalogEntryNavigation";

test("catalogue deep links validate stable source IDs and supported tabs", () => {
  assert.deepEqual(parseCatalogEntryNavigation("?tab=programs&sourceId=42&q=Test"), { tab: "programs", sourceId: 42, q: "Test" });
  for (const id of ["0", "-1", "1.5", "2147483648", "NaN"]) assert.equal(parseCatalogEntryNavigation(`?sourceId=${id}`).sourceId, null);
  assert.equal(parseCatalogEntryNavigation("?tab=users").tab, "countries");
  assert.equal(parseCatalogEntryNavigation(`?q=${"x".repeat(500)}`).q.length, 200);
});

test("Pages retains CMS and shared templates next to read-only catalogue inventory", () => {
  const pages = readFileSync(new URL("../src/pages/admin/website/Pages.tsx", import.meta.url), "utf8");
  assert.match(pages, /<CatalogPagesInventory \/>/);
  assert.match(pages, /<DetailTemplates \/>/);
  assert.match(pages, /customFetch\("\/api\/website\/pages"\)/);
  const inventory = readFileSync(new URL("../src/pages/admin/website/CatalogPagesInventory.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(inventory, /useMutation|method: "(?:POST|PUT|PATCH|DELETE)"/);
  for (const word of ["kind", "locale", "pageSize", "sourceId", "sourceEditPath", "revisionNumber", "NOT_EVALUATED", "admissionsOpen", "role=\"alert\"", "role=\"status\"", "noopener noreferrer"]) assert.ok(inventory.includes(word), word);
});
