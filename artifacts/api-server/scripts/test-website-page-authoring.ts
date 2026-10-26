import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseWebsitePageDraft, parseWebsiteCatalogPreview } from "../src/lib/websitePageAuthoring";
import { inspectWebsitePageBlockLinks, inspectWebsitePageTranslations } from "../src/lib/websitePagePublicationPreflight";

const base = { title: "Study in Türkiye", slug: "study-in-turkiye", locale: "tr" };
test("new pages always start draft and noindex, with no fabricated catalogue facts or SEO copy", () => {
  const result = parseWebsitePageDraft({ ...base, starter: "programs", country: "Turkey" });
  assert.equal(result.page.status, "draft");
  assert.equal(result.page.robotsIndex, false);
  assert.equal(result.page.metaTitle, undefined);
  assert.equal(result.page.metaDescription, undefined);
  assert.equal(result.page.ogTitle, undefined);
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
  assert.equal(parseWebsiteCatalogPreview({ source: "programs", limit: "66" }).config.limit, 12);
  for (const bad of [{ source: "users" }, { source: ["programs"] }, { countryId: "NaN" }, { limit: "0" }, { limit: "NaN" }, { limit: "1.5" }, { locale: "xx" }, { country: "x".repeat(121) }, { city: {} }]) {
    assert.throws(() => parseWebsiteCatalogPreview({ source: "programs", ...bad }));
  }
});
test("preview keeps legacy strings and validates stable catalogue IDs independently", () => {
  const { config } = parseWebsiteCatalogPreview({ source: "programs", country: "TR", city: "London", countryId: "1", cityId: "2", universityId: "3", degree: "Bachelor", language: "English", limit: "66" });
  assert.equal(config.countryId, 1);
  assert.equal(config.cityId, 2);
  assert.equal(config.universityId, 3);
  assert.equal(config.country, "TR");
  assert.equal(config.city, "London");
  assert.equal(config.limit, 12);
  for (const countryId of ["-1", "1.2", ["1"], {}, "1000000000"]) assert.throws(() => parseWebsiteCatalogPreview({ source: "cities", countryId }));
});
test("publication inspection blocks unsafe links and reports media accessibility", () => {
  const result = inspectWebsitePageBlockLinks([{ content: { ctaUrl: "javascript:alert(1)", cards: [{ imageUrl: "http://example.com/logo.png", name: "" }, { photo: "/safe.jpg", name: "Advisor" }] } }]);
  assert.deepEqual(result.blockers.map(issue => issue.code), ["UNSAFE_OR_INVALID_URL"]);
  assert.ok(result.warnings.some(issue => issue.code === "INSECURE_HTTP_URL"));
  assert.ok(result.warnings.some(issue => issue.code === "MEDIA_LABEL_MISSING"));
  const safe = inspectWebsitePageBlockLinks([{ content: { href: "/contact", imageUrl: "https://example.com/logo.png", alt: "Example" } }]);
  assert.equal(safe.blockers.length, 0);
  assert.equal(safe.warnings.length, 0);
});
test("translations cannot override canonical catalogue facts and use the same media checks", () => {
  const source = [{ blockType: "catalog", content: { source: "programs", universityId: 7, title: "Programs" } }];
  const changedFact = inspectWebsitePageTranslations(source, { tr: { blocks: [{ blockType: "catalog", content: { source: "programs", universityId: 8, title: "Programlar" } }] } });
  assert.deepEqual(changedFact.blockers.map(issue => issue.code), ["TRANSLATION_FACTUAL_OVERRIDE"]);
  const safeTranslation = inspectWebsitePageTranslations(source, { tr: { blocks: [{ blockType: "catalog", content: { source: "programs", universityId: 7, title: "Programlar", imageUrl: "https://example.com/program.jpg", alt: "Program" } }] } });
  assert.equal(safeTranslation.blockers.length, 0);
  assert.equal(safeTranslation.warnings.length, 0);
});
test("authoring wiring preserves admin authorization, public read projection and atomic draft writes", () => {
  const routes = readFileSync(new URL("../src/routes/website.ts", import.meta.url), "utf8");
  assert.match(routes, /router.get\("\/website\/catalog-preview", \.\.\.adminOnly/);
  assert.match(routes, /Cache-Control", "private, no-store/);
  assert.match(routes, /readPublicCatalogBlockItems\(preview.config, preview.locale\)/);
  assert.match(routes, /db.transaction\(async tx/);
  assert.match(routes, /status\(409\)/);
  assert.match(routes, /router.post\("\/website\/pages\/drafts", \.\.\.adminOnly, createPageDraft\)/);
  assert.match(routes, /typeof expectedUpdatedAt !== "string"/);
  assert.match(routes, /\.for\("update"\)/);
  assert.match(routes, /current\.updatedAt\.toISOString\(\) !== expectedUpdatedAt/);
  assert.match(routes, /PAGE_REVISION_CONFLICT/);
  assert.match(routes, /\/website\/pages\/:id\/request-review/);
  assert.match(routes, /status: "in_review"/);
  assert.match(routes, /current\.status !== "in_review"/);
  assert.match(routes, /current\.updatedBy === req\.user\?\.id/);
  assert.match(routes, /approval: \{ digest, authorId: current\.updatedBy, reviewerId: req\.user\?\.id, preflight: preflight\.publication \}/);
  assert.match(routes, /\/website\/pages\/:id\/publication-preflight/);
  assert.match(routes, /VISIBLE_CONTENT_REQUIRED/);
  assert.match(routes, /PUBLICATION_PREFLIGHT_FAILED/);
  assert.match(routes, /buildPagePublicationPreflight\(current, blocks\)/);
  assert.match(routes, /invalidationScopes: \["public-page-render", "public-web-discovery"\]/);
  assert.match(routes, /sitemapEligible: page\.robotsIndex/);
  assert.match(routes, /preflight\.digest !== preflightDigest/);
  assert.match(routes, /PREFLIGHT_DIGEST_CONFLICT/);
  assert.match(routes, /expiresAt: new Date\(checkedAt\.getTime\(\) \+ 10 \* 60 \* 1000\)/);
  assert.match(routes, /\/website\/pages\/:id\/request-changes/);
  assert.match(routes, /outcome: "CHANGES_REQUESTED"/);
  assert.match(routes, /reviewedRevision: expectedUpdatedAt/);
  assert.match(routes, /CANONICAL_CONFLICT/);
  assert.match(routes, /ne\(websitePagesTable\.id, pageId\)/);
  assert.match(routes, /kind: "DRAFT_SAVED"/);
  assert.match(routes, /draftVersion/);
  assert.match(routes, /canonicalUrl: typeof metaSnap\.canonicalUrl/);
  assert.match(routes, /twitterImageUrl: typeof metaSnap\.twitterImageUrl/);
  assert.match(routes, /inspectWebsitePageTranslations\(blocks, translationsJson\)/);
  assert.match(routes, /Translated catalogue facts must match the source page/);
});
