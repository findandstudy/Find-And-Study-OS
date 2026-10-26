import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DETAIL_LAYOUT_KINDS, DETAIL_TEMPLATE_VARIABLES, defaultDetailLayout, detailTemplateSectionsForLocale, parseDetailLayout, resolveDetailTemplateText, validDetailTemplateText } from "../src/lib/websiteDetailLayoutContract";
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
  assert.equal(upgraded.version, 5);
  assert.deepEqual(upgraded.sections.filter(key => sections.includes(key)), sections, "v2 relative order survives additive sections");
  assert.deepEqual(new Set(upgraded.sections), new Set(layout.sections));
  assert.deepEqual(upgraded.hidden, ["universities"]);
  assert.deepEqual(parseDetailLayout(upgraded), upgraded, "complete v5 layout round trips");
  assert.equal(parseDetailLayout({ ...layout, sections, hidden: ["universities"] }), null, "v5 cannot omit additive section keys");
  const preWeatherV5 = { ...layout, sections: layout.sections.filter(key => key !== "weather") };
  assert.deepEqual(parseDetailLayout(preWeatherV5)?.sections, layout.sections, "the newly added weather section upgrades existing v5 layouts in place");
  assert.equal(parseDetailLayout({ ...layout, sections: ["hero", "navigation", "programs", "overview", "facts", "universities"] }), null);
  assert.equal(parseDetailLayout({ version: 2, kind: "city", hidden: [], sections: ["hero", "overview", "programs", "universities"] }), null, "v2 cannot silently omit its mandatory section set");
  assert.deepEqual(parseDetailLayout({ version: 1, kind: "city", sections: ["hero", "overview", "programs", "universities"], hidden: ["universities"] }),
    upgraded, "saved v1 layouts upgrade while preserving optional order and visibility");
  assert.equal(parseDetailLayout({ version: 1, kind: "city", sections: ["hero", "programs", "overview", "universities"], hidden: [] }), null);
});
test("section presentation and localized shared copy are bounded without catalogue facts", () => {
  const layout = defaultDetailLayout("destination");
  const styled = parseDetailLayout({ ...layout, presentation: { hero: { tone: "dark", width: "wide" }, "editorial-climate": { tone: "sky", spacing: "compact", align: "center", minHeight: "tall", backgroundColor: "#123456", textColor: "#ffffff", accentColor: "#abcdef", backgroundImageUrl: "/assets/climate.jpg", backgroundImageFit: "cover", backgroundImagePosition: "top", backgroundImageRepeat: "no-repeat", overlayColor: "#000000", overlayOpacity: 45 } } });
  assert.ok(styled);
  assert.equal(styled.presentation.hero.tone, "dark");
  assert.equal(styled.presentation["editorial-climate"].backgroundImageUrl, "/assets/climate.jpg");
  assert.equal(parseDetailLayout({ ...layout, presentation: { hero: { title: "Injected" } } }), null);
  assert.equal(parseDetailLayout({ ...layout, presentation: { unknown: { tone: "sky" } } }), null);
  assert.equal(parseDetailLayout({ ...layout, presentation: { hero: { tone: "red" } } }), null);
  assert.equal(parseDetailLayout({ ...layout, presentation: { hero: { backgroundColor: "red" } } }), null);
  assert.equal(parseDetailLayout({ ...layout, presentation: { hero: { backgroundImageUrl: "javascript:alert(1)" } } }), null);
  assert.equal(parseDetailLayout({ ...layout, presentation: { hero: { overlayOpacity: 101 } } }), null);
  const withCopy = parseDetailLayout({ ...layout, copy: { en: { overview: { title: "Study overview", body: "Shared introduction." }, "editorial-climate": { title: "Climate" }, hero: { body: "Shared supporting text." } }, tr: { overview: { title: "Eğitime genel bakış" } } } });
  assert.ok(withCopy);
  assert.deepEqual(detailTemplateSectionsForLocale(withCopy, "en"), [
    { key: "hero", body: "Shared supporting text." },
    { key: "overview", title: "Study overview", body: "Shared introduction." },
    { key: "climate", title: "Climate" },
  ]);
  assert.deepEqual(detailTemplateSectionsForLocale(withCopy, "tr"), [
    { key: "overview", title: "Eğitime genel bakış" },
  ], "shared visible copy stays locale-owned while layout structure remains common");
  const cleaned = parseDetailLayout({ ...layout, copy: { en: { hero: { body: "Live catalogue facts for students." }, overview: { title: "Catalogue overview" } } } });
  assert.equal(cleaned?.copy.en.hero.body, "Live facts for students.");
  assert.equal(cleaned?.copy.en.overview.title, "overview");
  assert.equal(parseDetailLayout({ ...layout, copy: { de: { overview: { title: "Invalid locale" } } } }), null);
  assert.equal(parseDetailLayout({ ...layout, copy: { en: { hero: { title: "Must not replace entity name" } } } }), null);
  assert.equal(parseDetailLayout({ ...layout, copy: { en: { overview: { body: "<script>" } } } }), null);
});
test("shared copy accepts only kind-scoped public variables and resolves fallbacks", () => {
  assert.ok(DETAIL_TEMPLATE_VARIABLES.city.some(item => item.key === "city.programCount"));
  assert.equal(DETAIL_TEMPLATE_VARIABLES.city.some(item => item.key === "program.tuitionFee"), false);
  assert.equal(validDetailTemplateText("Explore {{city.programCount}} programs in {{city.name}}.", "city", 160), true);
  assert.equal(validDetailTemplateText("{{program.tuitionFee}}", "city", 160), false);
  assert.equal(validDetailTemplateText("{{city.name", "city", 160), false);
  assert.equal(resolveDetailTemplateText("Explore {{city.programCount}} programs in {{city.name}}.", "city", { "city.programCount": "42", "city.name": "Istanbul" }), "Explore 42 programs in Istanbul.");
  assert.equal(resolveDetailTemplateText("Climate: {{city.climateSummary|Information coming soon}}", "city", {}), "Climate: Information coming soon");
  assert.equal(resolveDetailTemplateText("Value: {{city.climateSummary}}", "city", {}), "Value:");
  const layout = defaultDetailLayout("city");
  assert.ok(parseDetailLayout({ ...layout, copy: { en: { overview: { title: "Study in {{city.name}}", body: "Compare {{city.programCount}} programs." } } } }));
  assert.equal(parseDetailLayout({ ...layout, copy: { en: { overview: { body: "Fee {{program.tuitionFee}}" } } } }), null);
});
test("server and browser module-local contracts stay byte-equivalent", () => {
  const normalize = (url: URL) => readFileSync(url, "utf8").replace(/\r\n/g, "\n").trim();
  assert.equal(normalize(new URL("../src/lib/websiteDetailLayoutContract.ts", import.meta.url)), normalize(new URL("../../edcons/src/lib/website/detailLayoutContract.ts", import.meta.url)));
});
test("published layouts use a bounded coalesced cache cleared by render invalidation", () => {
  const reader = readFileSync(new URL("../src/lib/websiteDetailLayouts.ts", import.meta.url), "utf8");
  const invalidation = readFileSync(new URL("../src/lib/publicCatalogRenderReadModel.ts", import.meta.url), "utf8");
  assert.match(reader, /PUBLISHED_LAYOUT_TTL_MS = 60_000/);
  assert.match(reader, /publishedLayoutInFlight\.get\(kind\)/);
  assert.match(reader, /publishedLayoutGeneration\.get\(kind\)/);
  assert.match(reader, /export function invalidatePublishedDetailLayout/);
  assert.match(invalidation, /if \(input\.detailTemplate\) invalidatePublishedDetailLayout\(input\.detailTemplate\)/);
});
test("SSR applies published layout without changing canonical facts or index policy", () => {
  const model: PublicCatalogRenderModel = { kind: "city_detail", locale: "ar", canonicalPath: "/ar/cities/city-1", title: "City", description: "Source description", indexable: false, alternatePaths: {},
    detailLayout: parseDetailLayout({ version: 2, kind: "city", sections: ["hero", "navigation", "overview", "facts", "programs", "universities"], hidden: [] })!,
    city: { id: 1, name: "City", country: "Country", countryCode: "TR", description: "Source description", universityCount: 1, programCount: 1,
      programLanguages: [], transportModes: [], campusGeography: null, externalFacts: null,
      universities: [{ id: 2, name: "Real university", universityType: "Private", canonicalPath: "/ar/universities/real-2" }],
      programs: [{ id: 3, name: "Real program", universityName: "Real university", degree: "Bachelor", field: null, canonicalPath: "/ar/programs/real-3" }] } };
  const render = () => renderPublicCatalogHtml({ model, indexHtml: '<html lang="en"><head><title>Base</title></head><body><div id="root"></div></body></html>', nonce: "fixture", siteUrl: "https://example.test" });
  const html = render();
  assert.ok(html.indexOf('data-detail-section="programs"') < html.indexOf('data-detail-section="universities"'));
  assert.match(html, /noindex, follow/);
  assert.match(html, /dir="rtl"/);
  assert.match(html, /id="public-detail-layout"/);
  model.detailLayout!.presentation.programs = { tone: "dark", width: "wide", spacing: "compact" };
  const presented = render();
  assert.match(presented, /data-template-tone="dark" data-template-width="wide" data-template-spacing="compact" data-detail-section="programs"/);
  model.editorial = { version: 1, kind: "city", entityId: 1, locale: "ar", sections: [], templateSections: [{ key: "climate", title: "Climate in {{city.name}}", body: "Explore {{city.programCount}} current programs." }] };
  const dynamicCopy = render();
  assert.match(dynamicCopy, /Climate in City/);
  assert.match(dynamicCopy, /Explore 1 current programs/);
  model.editorial = { version: 1, kind: "city", entityId: 1, locale: "ar", sections: [{ key: "programs", title: "Programs", body: "Current catalogue programmes.", presentation: { width: "full", align: "center", backgroundColor: "#112233", backgroundImageUrl: "/assets/city.jpg", overlayColor: "#000000", overlayOpacity: 40 }, sources: [{ label: "Institution", url: "https://example.org" }], reviewedOn: "2026-09-01" }] };
  const overridden = render();
  assert.match(overridden, /data-template-width="full"[^>]*data-template-align="center"[^>]*data-detail-section="programs"/);
  assert.match(overridden, /<style nonce="fixture" data-detail-appearance>[^<]*background-color:#112233[^<]*background-image:linear-gradient/);
  model.detailLayout!.hidden = ["programs"];
  const hidden = render();
  assert.doesNotMatch(hidden, /data-detail-section="programs"/);
  assert.match(hidden, /Real university/);
  assert.match(hidden, /Source description/);
});
