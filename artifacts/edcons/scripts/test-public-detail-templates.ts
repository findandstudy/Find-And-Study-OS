import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { sanitizePublicRichText } from "../src/lib/publicHtmlSanitizer";

const program = readFileSync(new URL("../src/pages/public/ProgramDetail.tsx", import.meta.url), "utf8");
const university = readFileSync(new URL("../src/pages/public/UniversityDetail.tsx", import.meta.url), "utf8");
const countries = readFileSync(new URL("../src/pages/public/Countries.tsx", import.meta.url), "utf8");
const country = readFileSync(new URL("../src/pages/public/CountryDetail.tsx", import.meta.url), "utf8");
const city = readFileSync(new URL("../src/pages/public/CityDetail.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

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

test("destination collection requests the active locale and follows canonical paths", () => {
  assert.match(countries, /public\/destinations\?locale=/);
  assert.match(countries, /\[lang\]/);
  assert.match(countries, /dest\.canonicalPath \|\| localePath/);
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
