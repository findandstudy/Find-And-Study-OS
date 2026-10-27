import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { catalogLimit, catalogLayoutClass, catalogParameters } from "../src/lib/website/catalogPresentation";
import { enrichManagedHomePageBlocks, enrichManagedPageBlocks } from "../src/lib/website/managedPageStarters";
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
  for (const code of [home, about]) {
    assert.match(code, /useTemplatePage\(/);
    assert.match(code, /useTemplatePageSeo\(page\)/);
  }
  assert.match(home, /HomeBlocks/);
  assert.match(home, /managedHomePageBlocks/);
  assert.match(home, /<CmsBlock/);
  assert.match(home, /<CmsPageCanvas className="home-future-page">/);
  assert.match(publicPage, /safeHeroTextColor/);
  assert.match(publicPage, /safeSurfaceTextColor/);
  assert.match(publicPage, /queryKey: \["public-cms-theme"\]/);
  assert.match(editorialCss, /--home-night: var\(--cms-secondary/);
  assert.match(editorialCss, /--home-electric: var\(--cms-blue/);
  assert.match(editorialCss, /--home-paper: var\(--cms-paper/);
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
    "home_fallback_hero", "home_fallback_stats", "home_fallback_features", "catalog_grid",
    "process_steps", "feature_cards", "faq", "cta_banner",
  ]);
  assert.equal(completed[0].content.title, "Fallback hero");
  assert.deepEqual(enrichManagedHomePageBlocks(singleton, "/en/programs"), singleton);
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
