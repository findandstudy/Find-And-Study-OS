import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseWebsitePageDraft, parseWebsiteCatalogPreview } from "../src/lib/websitePageAuthoring";

const base = { title: "Study in Türkiye", slug: "study-in-turkiye", locale: "tr" };
test("new pages always start draft and noindex, with no fabricated catalogue facts", () => {
  const result = parseWebsitePageDraft({ ...base, starter: "programs", country: "Turkey" });
  assert.equal(result.page.status, "draft");
  assert.equal(result.page.robotsIndex, false);
  assert.equal(result.blocks[0].blockType, "hero");
  assert.deepEqual(result.blocks[1].content, { title: base.title, source: "programs", limit: 6, country: "Turkey", city: "" });
  assert.equal(parseWebsitePageDraft(base).blocks.length, 0);
});
test("draft creation cannot inject publication, actors, IDs, facts or blocks", () => {
  for (const key of ["id", "createdBy", "status", "publishedAt", "robotsIndex", "template", "blocks", "items", "tuition", "translationsJson"]) {
    assert.throws(() => parseWebsitePageDraft({ ...base, [key]: "injected" }));
  }
});
test("draft addresses reject reserved routes, locale prefixes and invalid paths", () => {
  for (const slug of ["admin", "programs", "tr", "api", "about", "", "../hello", "hello/world", "Mixed-Case", "x".repeat(151)]) {
    assert.throws(() => parseWebsitePageDraft({ ...base, slug }));
  }
});
test("all four catalogue starters reference the existing catalogue", () => {
  for (const starter of ["programs", "universities", "destinations", "cities"]) {
    assert.equal(parseWebsitePageDraft({ ...base, starter }).blocks[1].content.source, starter);
  }
  assert.throws(() => parseWebsitePageDraft({ ...base, starter: "sql" }));
});
test("preview accepts only bounded known sources, filters and the supported locales", () => {
  const result = parseWebsiteCatalogPreview({ source: "programs", country: " Türkiye ", locale: "ar", limit: "12" });
  assert.equal(result.config.country, "Türkiye");
  assert.equal(result.locale, "ar");
  for (const bad of [{ source: "users" }, { source: ["programs"] }, { limit: "13" }, { limit: "0" }, { limit: "NaN" }, { limit: "1.5" }, { locale: "xx" }, { country: "x".repeat(121) }, { city: {} }]) {
    assert.throws(() => parseWebsiteCatalogPreview({ source: "programs", ...bad }));
  }
});
test("authoring wiring preserves admin authorization, public read projection and atomic draft writes", () => {
  const routes = readFileSync(new URL("../src/routes/website.ts", import.meta.url), "utf8");
  assert.match(routes, /router.get\("\/website\/catalog-preview", \.\.\.adminOnly/);
  assert.match(routes, /Cache-Control", "private, no-store/);
  assert.match(routes, /readPublicCatalogBlockItems\(preview.config, preview.locale\)/);
  assert.match(routes, /db.transaction\(async tx/);
  assert.match(routes, /status\(409\)/);
  assert.match(routes, /router.post\("\/website\/pages\/drafts", \.\.\.adminOnly, createPageDraft\)/);
});
