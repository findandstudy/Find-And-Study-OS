import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { catalogLimit, catalogLayoutClass, catalogParameters } from "../src/lib/website/catalogPresentation";
import { enrichManagedHomePageBlocks, enrichManagedPageBlocks } from "../src/lib/website/managedPageStarters";
import { hydrateManagedHomeDestinations, hydrateManagedHomeUniversities } from "../src/lib/website/homeDestinationCards";
import { pageEditorPreviewGeometry, samePageEditorPreviewGeometry } from "../src/pages/admin/website/pageEditorPreviewGeometry";
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

test("page editor preview geometry is stable across scrollbar changes", () => {
  const beforeScrollbar = pageEditorPreviewGeometry(620, 1440, 2400);
  const afterScrollbar = pageEditorPreviewGeometry(620, 1440, 2400);
  assert.deepEqual(afterScrollbar, beforeScrollbar);
  assert.equal(samePageEditorPreviewGeometry(beforeScrollbar, afterScrollbar), true);
  assert.deepEqual(beforeScrollbar, { scale: 588 / 1440, height: 2400 });

  const subPixelResize = { scale: beforeScrollbar.scale + 0.0005, height: beforeScrollbar.height };
  assert.equal(samePageEditorPreviewGeometry(beforeScrollbar, subPixelResize), true);
  assert.deepEqual(pageEditorPreviewGeometry(Number.NaN, 0, Number.NaN), { scale: 1, height: 400 });
});
test("Home and About reuse published blocks while preserving static fallbacks and managed collection fetches", () => {
  const home = source("pages/public/Home.tsx");
  const about = source("pages/public/About.tsx");
  const publicPage = source("pages/public/PublicPage.tsx");
  const editorialCss = source("pages/public/cmsEditorial.css");
  const homeParityCss = source("pages/public/homeVistaraParity.css");
  for (const code of [home, about]) {
    assert.match(code, /useTemplatePage\(/);
    assert.match(code, /useTemplatePageSeo\(page\)/);
  }
  assert.match(home, /HomeBlocks/);
  assert.match(home, /managedHomePageBlocks/);
  assert.match(home, /<CmsBlock/);
  assert.match(home, /<CmsPageCanvas className="home-future-page">/);
  assert.match(home, /IntersectionObserver/);
  assert.match(home, /prefers-reduced-motion: reduce/);
  assert.match(home, /home-reveal-visible/);
  assert.match(publicPage, /safeHeroTextColor/);
  assert.match(publicPage, /safeSurfaceTextColor/);
  assert.match(publicPage, /cta_banner[\s\S]*--cms-section-bg[\s\S]*linear-gradient\(125deg/);
  assert.doesNotMatch(publicPage, /home-future-cta[^\n]*text-white/);
  assert.match(publicPage, /queryKey: \["public-cms-theme"\]/);
  assert.match(publicPage, /import "\.\/homeVistaraParity\.css"/);
  assert.match(homeParityCss, /grid-template-columns: repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(homeParityCss, /@media \(max-width: 760px\)[\s\S]*grid-template-columns: repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(homeParityCss, /prefers-reduced-motion: reduce/);
  assert.match(editorialCss, /--home-night: var\(--cms-secondary/);
  assert.match(editorialCss, /--home-electric: var\(--cms-blue/);
  assert.match(editorialCss, /--home-paper: var\(--cms-paper/);
  assert.match(editorialCss, /@keyframes home-card-arrive/);
  assert.match(editorialCss, /@keyframes home-orbit-drift/);
  assert.match(editorialCss, /prefers-reduced-motion: reduce[\s\S]*animation-duration: \.01ms/);
  assert.match(editorialCss, /\.home-catalog-media img/);
  assert.match(editorialCss, /cta_banner[^}]*\.home-future-cta[^}]*a:not\(:first-child\)[\s\S]*--cms-section-text/);
  assert.match(editorialCss, /@media \(min-width: 761px\) and \(max-width: 1024px\)[\s\S]*\.home-future-page \.home-bento-card:first-child \{ grid-column: 1 \/ -1; \}/);
  assert.match(editorialCss, /cms-preview-viewport\[data-preview-size="tablet"\] \.home-bento-card:first-child \{ grid-column: 1 \/ -1; \}/);
  assert.match(editorialCss, /\.cms-editorial-block \.cms-responsive-grid > \* \{ min-width: 0; max-width: 100%; \}/);
  assert.match(about, /<ManagedPublicPage/);
  assert.match(source("pages/public/About.tsx"), /\/api\/cms\/team-members\?lang=/);
  assert.match(source("pages/public/About.tsx"), /\/api\/cms\/offices\?lang=/);
  assert.match(about, /block\.blockType === "office_list"/);
  const hook = source("pages/public/useTemplatePage.ts");
  assert.match(hook, /!query.isError/);
  assert.match(hook, /refetchOnMount: "always"/);
  assert.match(source("App.tsx"), /segment === "about"/);
});

test("the explicit system Home fallback is completed without reviving custom one-block pages", () => {
  const singleton = [{ blockType: "home_fallback_hero", content: { title: "Fallback hero" }, settings: {}, sortOrder: 0, isVisible: true }];
  const completed = enrichManagedHomePageBlocks(singleton, "/en/programs", { completeSystemFallback: true });
  assert.deepEqual(completed.map(block => block.blockType), [
    "home_fallback_hero", "home_fallback_stats", "home_fallback_features", "counter_grid",
    "process_steps", "icon_cards", "catalog_grid", "feature_cards", "team_grid", "faq",
    "logo_grid", "grid_box", "cta_banner",
  ]);
  assert.equal(completed[0].content.title, "Fallback hero");
  assert.match(source("lib/website/managedPageStarters.ts"), /University admissions[\s\S]*Student visa assistance[\s\S]*Scholarship guidance[\s\S]*Pre-departure support/);
  assert.deepEqual(enrichManagedHomePageBlocks(singleton, "/en/programs"), singleton);
});

test("Home destination cards use the public catalogue and its approved hero media", () => {
  const blocks = enrichManagedHomePageBlocks([
    { blockType: "home_fallback_hero", content: { title: "Fallback hero" }, settings: {}, sortOrder: 0, isVisible: true },
  ], "/en/programs", { completeSystemFallback: true });
  const hydrated = hydrateManagedHomeDestinations(blocks, [{
    id: 1,
    name: "Türkiye",
    country: "Türkiye",
    shortDescription: "A live destination summary",
    canonicalPath: "/en/countries/turkey",
    cardHeroImageUrl: "/api/storage/turkey.webp",
    flagEmoji: "🇹🇷",
  }]);
  const catalogue = hydrated.find(block => block.blockType === "catalog_grid");
  const hero = hydrated.find(block => block.blockType === "home_fallback_hero");
  assert.deepEqual(catalogue?.content.items, [{
    id: 1,
    title: "Türkiye",
    description: "A live destination summary",
    canonicalPath: "/en/countries/turkey",
    imageUrl: "/api/storage/turkey.webp",
    flagEmoji: "🇹🇷",
  }]);
  assert.deepEqual(hero?.content.heroVisuals, [{
    title: "Türkiye",
    imageUrl: "/api/storage/turkey.webp",
    canonicalPath: "/en/countries/turkey",
    flagEmoji: "🇹🇷",
  }]);
  assert.match(source("pages/public/PublicPage.tsx"), /home-hero-photo-stage/);
  assert.match(source("pages/public/cmsEditorial.css"), /\.home-hero-visual\.has-live-images/);
});

test("Home uses live university logos without fabricating institution cards", () => {
  const blocks = enrichManagedHomePageBlocks([
    { blockType: "home_fallback_hero", content: { title: "Fallback hero" }, settings: {}, sortOrder: 0, isVisible: true },
  ], "/en/programs", { completeSystemFallback: true });
  const hydrated = hydrateManagedHomeUniversities(blocks, [
    { id: 1, name: "Example University", country: "Exampleland", logoUrl: "/api/universities/1/logo" },
    { id: 2, name: "Duplicate logo", country: "Exampleland", logoUrl: "/api/universities/1/logo" },
  ], [{ id: 9, name: "Exampleland", country: "Exampleland", canonicalPath: "/en/countries/exampleland" }], "en");
  const wall = hydrated.find(block => block.blockType === "logo_grid");
  assert.deepEqual(wall?.content.logos, [
    { id: 1, name: "Example University", country: "Exampleland", countryKey: "exampleland", imageUrl: "/api/universities/1/logo", linkUrl: "/en/universities/example-university-1" },
    { id: 2, name: "Duplicate logo", country: "Exampleland", countryKey: "exampleland", imageUrl: "/api/universities/1/logo", linkUrl: "/en/universities/duplicate-logo-2" },
  ]);
  assert.deepEqual(wall?.content.countryTabs, [{ key: "exampleland", label: "Exampleland", linkUrl: "/en/countries/exampleland" }]);
  assert.match(source("pages/public/Home.tsx"), /home-featured-universities/);
  assert.match(source("pages/public/Home.tsx"), /\/api\/public\/home-universities/);
  assert.match(source("pages/public/PublicPage.tsx"), /UniversityCountrySlider/);
  assert.match(source("pages/public/PublicPage.tsx"), /configured\.filter\(tab => availableKeys\.has\(tab\.key\)\)/);
  assert.match(source("pages/public/PublicPage.tsx"), /setInterval\(\(\) => move\(1\), 4_000\)/);
  assert.match(source("pages/public/PublicPage.tsx"), /onMouseEnter=\{\(\) => setIsPointerPaused\(true\)\}/);
  assert.doesNotMatch(source("pages/public/PublicPage.tsx"), /onFocusCapture=\{/);
  assert.doesNotMatch(source("pages/public/PublicPage.tsx"), /Explore support/);
  assert.match(source("pages/public/homeVistaraParity.css"), /\.home-university-slider-track/);
  assert.match(source("pages/public/homeVistaraParity.css"), /calc\(18\.1818% - 18px\)/);
  assert.match(source("lib/website/managedPageStarters.ts"), /managedHomeSectionTemplates/);
  assert.match(source("pages/admin/website/PageEditor.tsx"), /Homepage ready templates/);
  assert.match(source("pages/admin/website/PageEditor.tsx"), /addPreparedBlock\(template\.block\)/);
});

test("managed editor previews collection-backed blocks with the same data contract as public pages", () => {
  const editor = source("pages/admin/website/PageEditor.tsx");
  assert.match(editor, /<CmsPageCanvas className="home-future-page cms-editor-preview">/);
  assert.match(editor, /hydrateCollectionBlock/);
  assert.match(editor, /\/api\/cms\/team-members\?lang=/);
  assert.match(editor, /\/api\/cms\/offices\?lang=/);
  assert.match(editor, /Waiting for collection data/);
  assert.match(editor, /not rendered publicly until its collection contains data/);
});

test("quarantined AI features expose capability state instead of empty lists", () => {
  for (const path of ["pages/admin/AiPersonas.tsx", "pages/admin/AiActionQueue.tsx"]) {
    const code = source(path);
    assert.match(code, /\/api\/ai-personas\/status/);
    assert.match(code, /capability\?\.available/);
    assert.match(code, /loadError/);
  }
});
test("source-specific selectors load live definitions and show unmatched legacy values", () => {
  const fields = source("pages/admin/website/CatalogBlockFields.tsx");
  assert.match(fields, /\/api\/website\/catalog-filters/);
  assert.match(fields, /<select/);
  assert.match(fields, /matches.length === 1/);
  assert.match(fields, /unmatched, please reselect/);
  const preview = source("pages/admin/website/CatalogBlockPreview.tsx");
  assert.match(preview, /isError \? <p role="alert"/);
  assert.match(preview, /Preview unavailable/);
  assert.match(preview, /validPreview\(result\)/);
  assert.doesNotMatch(preview, /error\.message|error.*data.*error/);
  assert.match(source("pages/admin/website/PageEditor.tsx"), /window.confirm/);
});

test("the exact legacy staging About composition upgrades without replacing arbitrary custom pages", () => {
  const legacy = ["global_block", "team_grid", "catalog_grid", "section_title"].map((blockType, sortOrder) => ({
    blockType,
    content: {},
    settings: {},
    sortOrder,
    isVisible: true,
  }));
  const upgraded = enrichManagedPageBlocks("about", legacy, "en");
  assert.equal(upgraded.length, 10);
  assert.deepEqual(upgraded.map(block => block.blockType), [
    "hero", "counter_grid", "media_text", "grid_box", "process_steps",
    "team_grid", "logo_marquee", "office_list", "faq", "cta_banner",
  ]);

  const custom = [{ blockType: "html", content: { html: "<p>Custom</p>" }, settings: {}, sortOrder: 0, isVisible: true }];
  assert.deepEqual(enrichManagedPageBlocks("about", custom, "en"), custom);
});
