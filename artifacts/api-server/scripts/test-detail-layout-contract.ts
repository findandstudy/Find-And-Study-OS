import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DETAIL_LAYOUT_KINDS, defaultDetailLayout, parseDetailLayout } from "../src/lib/websiteDetailLayoutContract";
import { isReservedPublicPageSlug, renderPublicCatalogHtml, type PublicCatalogRenderModel } from "../src/lib/publicCatalogRenderContract";
test("four layouts preserve mandatory facts and reject arbitrary content", () => {
  for (const kind of DETAIL_LAYOUT_KINDS) {
    const layout = defaultDetailLayout(kind);
    assert.deepEqual(parseDetailLayout(layout), layout);
    for (const key of ["hero", "overview"]) assert.equal(parseDetailLayout({ ...layout, hidden: [key] }), null);
    assert.equal(parseDetailLayout({ ...layout, tuition: 99 }), null);
    assert.equal(parseDetailLayout({ ...layout, sections: [...layout.sections, "html"] }), null);
    assert.equal(parseDetailLayout({ ...layout, hidden: ["unknown"] }), null);
    assert.equal(isReservedPublicPageSlug(`_detail-layout-${kind}`), true);
  }
});
test("optional sections reorder without moving ahead of identity and facts", () => {
  const layout = defaultDetailLayout("city");
  const sections = ["hero", "navigation", "overview", "facts", "programs", "universities"];
  const upgraded = parseDetailLayout({ version: 2, kind: "city", sections, hidden: ["universities"] });
  assert.ok(upgraded);
  assert.equal(upgraded.version, 3);
  assert.deepEqual(upgraded.sections.filter(key => sections.includes(key)), sections, "v2 relative order survives additive sections");
  assert.deepEqual(new Set(upgraded.sections), new Set(layout.sections));
  assert.deepEqual(upgraded.hidden, ["universities"]);
  assert.deepEqual(parseDetailLayout(upgraded), upgraded, "complete v3 layout round trips");
  assert.equal(parseDetailLayout({ ...layout, sections, hidden: ["universities"] }), null, "v3 cannot omit additive section keys");
  assert.equal(parseDetailLayout({ ...layout, sections: ["hero", "navigation", "programs", "overview", "facts", "universities"] }), null);
  assert.equal(parseDetailLayout({ version: 2, kind: "city", hidden: [], sections: ["hero", "overview", "programs", "universities"] }), null, "v2 cannot silently omit its mandatory section set");
  assert.deepEqual(parseDetailLayout({ version: 1, kind: "city", sections: ["hero", "overview", "programs", "universities"], hidden: ["universities"] }),
    upgraded, "saved v1 layouts upgrade while preserving optional order and visibility");
  assert.equal(parseDetailLayout({ version: 1, kind: "city", sections: ["hero", "programs", "overview", "universities"], hidden: [] }), null);
});
test("server and browser module-local contracts stay byte-equivalent", () => {
  const normalize = (url: URL) => readFileSync(url, "utf8").replace(/\r\n/g, "\n").trim();
  assert.equal(normalize(new URL("../src/lib/websiteDetailLayoutContract.ts", import.meta.url)), normalize(new URL("../../edcons/src/lib/website/detailLayoutContract.ts", import.meta.url)));
});
test("SSR applies published layout without changing canonical facts or index policy", () => {
  const model: PublicCatalogRenderModel = { kind: "city_detail", locale: "ar", canonicalPath: "/ar/cities/city-1", title: "City", description: "Source description", indexable: false, alternatePaths: {},
    detailLayout: parseDetailLayout({ version: 2, kind: "city", sections: ["hero", "navigation", "overview", "facts", "programs", "universities"], hidden: [] })!,
    city: { id: 1, name: "City", country: "Country", countryCode: "TR", description: "Source description", universityCount: 1, programCount: 1,
      universities: [{ id: 2, name: "Real university", universityType: "Private", canonicalPath: "/ar/universities/real-2" }],
      programs: [{ id: 3, name: "Real program", universityName: "Real university", degree: "Bachelor", field: null, canonicalPath: "/ar/programs/real-3" }] } };
  const render = () => renderPublicCatalogHtml({ model, indexHtml: '<html lang="en"><head><title>Base</title></head><body><div id="root"></div></body></html>', nonce: "fixture", siteUrl: "https://example.test" });
  const html = render();
  assert.ok(html.indexOf('data-detail-section="programs"') < html.indexOf('data-detail-section="universities"'));
  assert.match(html, /noindex, follow/);
  assert.match(html, /dir="rtl"/);
  assert.match(html, /id="public-detail-layout"/);
  model.detailLayout!.hidden = ["programs"];
  const hidden = render();
  assert.doesNotMatch(hidden, /data-detail-section="programs"/);
  assert.match(hidden, /Real university/);
  assert.match(hidden, /Source description/);
});
