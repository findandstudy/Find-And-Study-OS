import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { catalogLimit, catalogLayoutClass, catalogParameters } from "../src/lib/website/catalogPresentation";
const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

test("legacy limits cannot create an out-of-range preview request", () => {
  for (const value of [0, -1, 13, 66, "66", NaN, Infinity, undefined]) {
    assert.ok(catalogLimit(value) >= 1 && catalogLimit(value) <= 12);
    assert.ok(Number(new URLSearchParams(catalogParameters({ limit: value }, "tr")).get("limit")) <= 12);
  }
  const params = new URLSearchParams(catalogParameters({ countryId: "1", cityId: "2", universityId: "3", degree: "Bachelor", language: "English" }, "tr"));
  assert.equal(params.get("countryId"), "1");
  assert.equal(params.get("language"), "English");
});
test("all layouts have responsive defaults and keyboard scroll semantics", () => {
  assert.match(catalogLayoutClass({}), /lg:grid-cols-3/);
  assert.match(catalogLayoutClass({ columns: 2 }), /sm:grid-cols-2/);
  assert.match(catalogLayoutClass({ columns: "4" }), /lg:grid-cols-4/);
  assert.match(catalogLayoutClass({ layout: "list" }), /grid-cols-1/);
  assert.match(catalogLayoutClass({ layout: "carousel" }), /overflow-x-auto.*snap/);
  for (const path of ["pages/public/PublicPage.tsx", "pages/admin/website/CatalogBlockPreview.tsx"]) {
    assert.match(source(path), /catalogLayoutClass\(content\)/);
    assert.match(source(path), /tabIndex=\{content.layout === "carousel" \? 0/);
  }
});
test("Home and About reuse published blocks while preserving static fallbacks and team fetch", () => {
  for (const name of ["Home", "About"]) {
    const code = source(`pages/public/${name}.tsx`);
    assert.match(code, /useTemplatePage\(/);
    assert.match(code, /if \(page\) return <main/);
    assert.match(code, /<Block key=/);
    assert.match(code, /useTemplatePageSeo\(page\)/);
    assert.match(code, /return \(\s*<>/);
  }
  assert.match(source("pages/public/About.tsx"), /\/api\/cms\/team-members\?lang=/);
  const hook = source("pages/public/useTemplatePage.ts");
  assert.match(hook, /!query.isError/);
  assert.match(hook, /refetchOnMount: "always"/);
  assert.match(source("App.tsx"), /segment === "about"/);
});
test("source-specific selectors load live definitions and show unmatched legacy values", () => {
  const fields = source("pages/admin/website/CatalogBlockFields.tsx");
  assert.match(fields, /\/api\/website\/catalog-filters/);
  assert.match(fields, /<select/);
  assert.match(fields, /matches.length === 1/);
  assert.match(fields, /unmatched, please reselect/);
  assert.match(source("pages/admin/website/CatalogBlockPreview.tsx"), /error.*data.*error/);
  assert.match(source("pages/admin/website/PageEditor.tsx"), /window.confirm/);
});
