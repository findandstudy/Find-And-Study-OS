import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { sanitizePublicRichText } from "../src/lib/publicHtmlSanitizer";
import { catalogueCount, DETAIL_COPY, detailCopy, detailMoney, displayTuition, durationIsAmbiguous, splitRequirements, localDetailPath, tuitionOffer } from "../src/pages/public/detailPresentation";
import { SUPPORTED_LANGUAGES } from "../src/lib/i18n";
import { defaultDetailLayout, parseDetailLayout } from "../src/lib/website/detailLayoutContract";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DetailArtwork, DetailPrice } from "../src/pages/public/DetailEditorial";

const program = readFileSync(new URL("../src/pages/public/ProgramDetail.tsx", import.meta.url), "utf8");
const university = readFileSync(new URL("../src/pages/public/UniversityDetail.tsx", import.meta.url), "utf8");
const countries = readFileSync(new URL("../src/pages/public/Countries.tsx", import.meta.url), "utf8");
const country = readFileSync(new URL("../src/pages/public/CountryDetail.tsx", import.meta.url), "utf8");
const city = readFileSync(new URL("../src/pages/public/CityDetail.tsx", import.meta.url), "utf8");
const publicPage = readFileSync(new URL("../src/pages/public/PublicPage.tsx", import.meta.url), "utf8");
const pageEditor = readFileSync(new URL("../src/pages/admin/website/PageEditor.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const blockTypes = readFileSync(new URL("../src/lib/website/blockTypes.ts", import.meta.url), "utf8");

test("program template keeps prototype information architecture data-bound", () => {
  for (const anchor of ["overview", "requirements", "intakes", "fees", "related"]) {
    assert.match(program, new RegExp(`(?:href=\\"#${anchor}\\"|id=\\"${anchor}\\")`));
  }
  assert.match(program, /payload\.prices\.slice\(0, 8\)/);
  assert.match(program, /applicationDeadlineAt/);
  assert.match(program, /PUBLISHED_INDEXABLE_ONLY/);
  assert.doesNotMatch(program, /Fenerbahçe|3000|30 Nov 2026|unsplash/i);
  assert.doesNotMatch(program, /dangerouslySetInnerHTML/);
});

test("university template keeps overview, facts and governed programs connected", () => {
  for (const anchor of ["overview", "facts", "programs"]) {
    assert.match(university, new RegExp(`(?:href=\\"#${anchor}\\"|id=\\"${anchor}\\")`));
  }
  assert.match(university, /payload\.meta\.programCount/);
  assert.match(university, /programLinkPolicy/);
  assert.match(university, /rel="noopener noreferrer"/);
  assert.doesNotMatch(university, /Fenerbahçe|YÖK|ICEF|example\.com/i);
  assert.doesNotMatch(university, /dangerouslySetInnerHTML/);
});

test("public detail fees require explicit valid currencies without inventing USD", () => {
  assert.match(program, /displayTuition\(program, lang\)/);
  assert.match(university, /displayTuition\(program, lang\)/);
  assert.equal(detailMoney(100, null, "en"), null);
  assert.equal(detailMoney(100, "NOT_A_CURRENCY", "en"), null);
  assert.equal(detailMoney(100, "XYZ", "en"), null);
  assert.equal(detailMoney(-1, "GBP", "en"), null);
  assert.equal(detailMoney(NaN, "GBP", "en"), null);
  assert.equal(detailMoney(100, " gbp ", "en-GB"), "£100.00");
  assert.equal(detailMoney(1000, "JPY", "en-US"), "¥1,000");
  assert.match(detailMoney(1.234, "KWD", "en-US")!, /1\.234/);
  assert.match(
    readFileSync(new URL("../src/pages/public/Programs.tsx", import.meta.url), "utf8"),
    /normalizeCurrency\(currency\)/,
  );
});

test("program detail labels legacy display fees but reserves offers for verified prices", () => {
  assert.match(program, /offers: tuitionOffer\(tuition, programAdmissionsOpen\(program\)\)/);
  assert.match(program, /resolvedOptions\(\)\.maximumFractionDigits/);
  assert.doesNotMatch(program, /const effectiveFee = program\.discountedFee \?\? program\.tuitionFee/);
  assert.equal(displayTuition({ tuition: null, tuitionFee: 500, currency: "USD" }, "en"), null, "server null cannot be bypassed by legacy fields");
  assert.deepEqual(displayTuition({ tuitionFee: 500, currency: "GBP" }, "en"), { amount: 500, currency: "GBP", verified: false, source: "legacy", frequency: null });
  assert.equal(displayTuition({ tuitionFee: 500, currency: null }, "en"), null);
  const verified = { amount: 500, currency: "GBP", verified: true, source: "verified" as const, frequency: "YEAR" };
  assert.deepEqual(tuitionOffer(verified, true), { "@type": "Offer", price: 500, priceCurrency: "GBP" });
  assert.equal(tuitionOffer(verified, false), undefined);
  assert.equal(tuitionOffer(null, true), undefined);
  assert.equal(tuitionOffer({ ...verified, isFrom: true }, true), undefined);
  assert.equal(tuitionOffer({ ...verified, source: "legacy", verified: false }, true), undefined);
  assert.equal(tuitionOffer({ ...verified, currency: "XYZ" }, true), undefined);
  const html = renderToStaticMarkup(createElement(DetailPrice, { tuition: { amount: 500, currency: "GBP", verified: false, source: "legacy", frequency: null }, locale: "en", verifiedLabel: "Verified price" }));
  assert.match(html, /confirmation required/);
  assert.doesNotMatch(html, /Verified price|schema.org|Offer/);
  const from = renderToStaticMarkup(createElement(DetailPrice, { tuition: { amount: 500, currency: "GBP", verified: true, source: "verified", frequency: "YEAR", isFrom: true }, locale: "en", verifiedLabel: "Verified price" }));
  assert.match(from, /From/);
  assert.match(from, /Verified price/);
});

test("imported catalogue metadata is not presented as admission requirements", () => {
  assert.deepEqual(splitRequirements("Country: United Kingdom | Campus: Manchester | Mode: Full-time | Intake years: 2026/2027 | Offer turnaround: 14 days | Edvoy ref: 123 | IELTS: 6.5"), {
    requirements: ["IELTS: 6.5"],
    metadata: [{ key: "country", value: "United Kingdom" }, { key: "campus", value: "Manchester" }, { key: "mode", value: "Full-time" }],
  });
  assert.deepEqual(splitRequirements("Intake years: 2024–2027 | Deadline: 2024-01-01 | Decision time: 7 days | IELTS: 6.5"), { requirements: ["IELTS: 6.5"], metadata: [] });
  assert.deepEqual(splitRequirements("Bachelor's degree\nEnglish proficiency"), { requirements: ["Bachelor's degree", "English proficiency"], metadata: [] });
  assert.deepEqual(splitRequirements(null), { requirements: [], metadata: [] });
  assert.equal(durationIsAmbiguous("12 Months / 24 Months / 18 Months"), true);
  assert.equal(durationIsAmbiguous("12/24 Months"), true);
  assert.equal(durationIsAmbiguous("12 Months"), false);
  assert.match(program, /copy\.institutionLocation/);
  assert.match(program, /copy\.catalogueNote/);
});

test("editorial layouts upgrade saved v1 layouts and keep frontend/backend parsers identical", () => {
  const backend = readFileSync(new URL("../../api-server/src/lib/websiteDetailLayoutContract.ts", import.meta.url), "utf8");
  const frontend = readFileSync(new URL("../src/lib/website/detailLayoutContract.ts", import.meta.url), "utf8");
  assert.equal(frontend.replaceAll("\r\n", "\n"), backend.replaceAll("\r\n", "\n"));
  const upgraded = parseDetailLayout({ version: 1, kind: "destination", sections: ["hero", "overview", "cta", "universities"], hidden: ["universities"] });
  assert.deepEqual(upgraded, { version: 2, kind: "destination", sections: ["hero", "navigation", "overview", "facts", "cities", "cta", "universities"], hidden: ["universities"] });
  const current = defaultDetailLayout("program");
  assert.deepEqual(parseDetailLayout(current), current);
  assert.ok(parseDetailLayout({ ...current, sections: ["hero", "navigation", "overview", "fees", "requirements", "intakes", "related"], hidden: ["fees"] }));
  assert.equal(parseDetailLayout({ ...current, hidden: ["hero"] }), null);
  assert.equal(parseDetailLayout({ ...current, sections: [...current.sections, "reviews"] }), null);
  assert.equal(parseDetailLayout({ ...current, html: "<script>" }), null);
});

test("editorial presentation has deliberate non-photographic fallback and safe navigation", () => {
  for (const missing of [undefined, null, NaN, Infinity, -1, "10"]) assert.equal(catalogueCount(missing, "Programs"), null);
  assert.equal(catalogueCount(0, "Programs"), "0 Programs");
  assert.equal(catalogueCount(10, "Programs"), "10 Programs");
  const art = renderToStaticMarkup(createElement(DetailArtwork));
  assert.match(art, /aria-hidden="true"/);
  assert.doesNotMatch(art, /<img|campus|unsplash/i);
  assert.equal(localDetailPath("https://example.com"), null);
  assert.equal(localDetailPath("//example.com"), null);
  assert.equal(localDetailPath("javascript:alert(1)"), null);
  assert.equal(localDetailPath("/en/cities/10-manchester"), "/en/cities/10-manchester");
  assert.deepEqual(Object.keys(DETAIL_COPY).sort(), [...SUPPORTED_LANGUAGES].sort());
  for (const locale of SUPPORTED_LANGUAGES) {
    assert.deepEqual(Object.keys(detailCopy(locale)).sort(), Object.keys(detailCopy("en")).sort());
    assert.ok(Object.values(detailCopy(locale)).every(value => typeof value === "string" && value.length > 0));
  }
  const css = readFileSync(new URL("../src/pages/public/detailEditorial.css", import.meta.url), "utf8");
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /\[dir="rtl"\]/);
  assert.match(css, /focus-visible/);
  assert.match(university, /role="region" aria-label/);
  for (const source of [program, university, country, city]) assert.doesNotMatch(source, /Fenerbahçe|unsplash|verified student/i);
});

test("destination collection requests the active locale and follows canonical paths", () => {
  assert.match(countries, /public\/destinations\?locale=/);
  assert.match(countries, /\[lang\]/);
  assert.match(countries, /dest\.canonicalPath \|\| localePath/);
});

test("Pages editor exposes a bounded live catalogue data block", () => {
  assert.match(blockTypes, /type: "catalog_grid"/);
  for (const source of ["programs", "universities", "destinations", "cities"]) {
    assert.match(blockTypes, new RegExp(`value: "${source}"`));
  }
  assert.match(blockTypes, /key: "limit"/);
  assert.match(blockTypes, /key: "country"/);
  assert.match(blockTypes, /key: "city"/);
});

test("public CMS pages render hydrated catalogue cards in the SPA fallback", () => {
  assert.match(publicPage, /case "catalog_grid"/);
  assert.match(publicPage, /items\(content\.items, 12\)/);
  assert.match(publicPage, /safeUrl\(item\.canonicalPath\)/);
  assert.match(publicPage, /No published catalogue entries are available yet/);
  assert.match(publicPage, /"@type": "ItemList"/);
  assert.match(publicPage, /page\.meta\.indexable \? page\.data\.blocks/);
  // useJsonLd emits arrays as separate scripts, so the catalogue nodes must
  // share the WebPage's context inside one graph instead of separate scripts.
  assert.match(publicPage, /return \{ "@context": "https:\/\/schema\.org", "@graph": \[webPage, \.\.\.catalogueLists\] \}/);
});

test("public catalogue blocks keep mobile and keyboard-accessible semantics", () => {
  assert.match(publicPage, /aria-labelledby=\{headingId\}/);
  assert.match(publicPage, /id=\{headingId\}/);
  assert.match(publicPage, /catalogLayoutClass\(content\)/);
  assert.match(readFileSync(new URL("../src/lib/website/catalogPresentation.ts", import.meta.url), "utf8"), /sm:grid-cols-2 lg:grid-cols-3/);
  assert.match(publicPage, /focus-visible:ring-2 focus-visible:ring-primary/);
  assert.match(publicPage, /aria-busy=\"true\"/);
});

test("Pages editor previews catalogue blocks without persisting catalogue facts", () => {
  const preview = readFileSync(new URL("../src/pages/admin/website/CatalogBlockPreview.tsx", import.meta.url), "utf8");
  assert.match(pageEditor, /<CatalogBlockPreview content=\{block.content\} locale=\{locale\}/);
  assert.match(preview, /\/api\/website\/catalog-preview/);
  assert.doesNotMatch(preview, /setBlocks|content\.items|method: "POST"/);
  assert.match(preview, /signal/);
  assert.match(preview, /role="alert"/);
  assert.match(preview, /role="status"/);
  assert.match(pageEditor, /editLocale === sourceLocale/);
});

test("city template and destination links stay on governed canonical projections", () => {
  assert.match(app, /\/\$\{lang\}\/cities\/:routeKey/);
  assert.match(city, /public\/web\/cities\/\$\{encodeURIComponent\(routeKey\)\}\?locale=/);
  assert.match(city, /requestedPathIsCanonical/);
  assert.match(city, /payload\?\.meta\.indexable/);
  assert.match(city, /"@type": "City"/);
  assert.match(country, /cityLinks/);
  assert.match(country, /city\.sourceName/);
  assert.match(country, /href=\{cityPath\}/);
  assert.doesNotMatch(city, /dangerouslySetInnerHTML|serviceFee|commission|contactPerson/);
});

test("public rich text strips executable markup and new-tab opener control", () => {
  const sanitized = sanitizePublicRichText(`
    <p style="color:red" onclick="alert(1)">Safe <strong>content</strong></p>
    <a href="javascript:alert(1)" target="_blank" rel="opener">unsafe</a>
    <a href="https://example.edu/path">allowed</a>
    <svg><a href="https://evil.example">svg</a></svg>
    <script>alert(1)</script>
  `);
  assert.match(sanitized, /<strong>content<\/strong>/);
  assert.match(sanitized, /href="https:\/\/example\.edu\/path"/);
  assert.doesNotMatch(sanitized, /javascript:|onclick|style=|target=|rel=|<svg|<script/i);
});
