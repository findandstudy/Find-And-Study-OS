import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { sanitizePublicRichText } from "../src/lib/publicHtmlSanitizer";

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

test("public fee templates normalize catalog currency values before Intl formatting", () => {
  assert.match(program, /normalizeCurrency\(currency\)/);
  assert.match(university, /normalizeCurrency\(currency\)/);
  assert.match(
    readFileSync(new URL("../src/pages/public/Programs.tsx", import.meta.url), "utf8"),
    /normalizeCurrency\(currency\)/,
  );
});

test("program detail uses verified fee payload for display and structured data", () => {
  assert.match(program, /const verifiedFee = verifiedTuition \? minorAmount\(verifiedTuition\.amountMinor\) : null/);
  assert.match(program, /offers: verifiedFee !== null && verifiedTuition/);
  assert.match(program, /effectiveFee = verifiedFee/);
  assert.match(program, /const displayCurrency = verifiedTuition\?\.currencyCode \|\| program\?\.currency/);
  assert.match(program, /money\(effectiveFee, displayCurrency \?\? null, lang\)/);
  assert.doesNotMatch(program, /const effectiveFee = program\.discountedFee \?\? program\.tuitionFee/);
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
  assert.match(publicPage, /sm:grid-cols-2 lg:grid-cols-3/);
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
