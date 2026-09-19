import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { parseDetailContent, DETAIL_CONTENT_KEYS, DETAIL_CONTENT_LOCALES, type DetailContent } from "../src/lib/website/detailContentContract";
import { defaultDetailLayout } from "../src/lib/website/detailLayoutContract";
import { boundDetailContent, detailContentLabels, detailContentNavigation, detailContentSections } from "../src/pages/public/DetailContentSections";

const fixture: DetailContent = { version: 1, kind: "program", entityId: 42, locale: "en", sections: [{
  key: "faq", title: "Questions & answers", body: "Published narrative", reviewedOn: "2026-01-01",
  sources: [{ label: "Source", url: "https://example.org/source" }],
  questions: [{ question: "How to enquire?", answer: "Contact an adviser." }],
  table: { columns: ["Topic", "Information"], rows: [["Accommodation", "Ask about options"]] },
  cards: [{ title: "Explore", body: "Approved copy", href: "/en/contact" }],
  steps: [{ title: "Ask", body: "Use the existing enquiry flow" }],
  images: [{ src: "/images/photo.jpg", alt: "Reviewed source photograph", caption: "Caption" }],
}] };

test("editorial content is bound to the exact kind, entity and locale", () => {
  assert.deepEqual(boundDetailContent(fixture, "program", 42, "en"), fixture);
  assert.equal(boundDetailContent(fixture, "program", 43, "en"), null);
  assert.equal(boundDetailContent(fixture, "university", 42, "en"), null);
  assert.equal(boundDetailContent(fixture, "program", 42, "tr"), null);
  assert.equal(boundDetailContent(fixture, "program", undefined, "en"), null);
  assert.deepEqual(detailContentSections(null, "en", "/en/contact"), []);
});

test("all supported content keys are orderable and hideable in the existing layout", () => {
  for (const [kind, keys] of Object.entries(DETAIL_CONTENT_KEYS)) {
    const layout = defaultDetailLayout(kind as DetailContent["kind"]);
    for (const key of keys) assert.ok(layout.sections.includes(`editorial-${key}`));
    assert.equal(new Set(layout.sections).size, layout.sections.length);
  }
  for (const locale of DETAIL_CONTENT_LOCALES) assert.ok(detailContentLabels(locale).every(Boolean));
});

test("renderer exposes accessible gallery, FAQ, source, table and steps without raw HTML", () => {
  const markup = renderToStaticMarkup(React.createElement(React.Fragment, null, detailContentSections(fixture, "en", "/en/contact")));
  for (const expected of ["editorial-faq", "Questions &amp; answers", "<summary>", 'scope="col"', 'scope="row"', 'role="region"', 'tabindex="0"', 'alt="Reviewed source photograph"', 'dateTime="2026-01-01"', 'rel="noopener noreferrer"', 'href="/en/contact"', "<ol", "Contact an adviser."]) assert.ok(markup.includes(expected), expected);
  assert.doesNotMatch(markup, /verified review|AggregateRating|application\/ld\+json|dangerouslySetInnerHTML/i);
  const nav = renderToStaticMarkup(React.createElement(React.Fragment, null, detailContentNavigation(fixture)));
  assert.match(nav, /href="#editorial-faq"/);
});

test("unsafe and malformed supplemental values fail closed before rendering", () => {
  const edit = (patch: Record<string, unknown>) => ({ ...fixture, sections: [{ ...fixture.sections[0], ...patch }] });
  for (const input of [edit({ body: "<script>alert(1)</script>" }), edit({ key: ["faq"] }), edit({ reviewedOn: "2026-02-30" }), edit({ images: [{ src: "javascript:alert(1)", alt: "x" }] }), edit({ cards: [{ title: "x", body: "y", href: "//evil.example" }] }), edit({ tuitionFee: 100 }), edit({ sources: [] })]) assert.equal(parseDetailContent(input), null);
  assert.equal(parseDetailContent({ ...fixture, tuitionFee: 100 }), null);
});

test("each public detail integrates only bound approved content; apply stays on existing flow", () => {
  for (const file of ["CountryDetail", "CityDetail", "UniversityDetail", "ProgramDetail"]) {
    const source = readFileSync(new URL(`../src/pages/public/${file}.tsx`, import.meta.url), "utf8");
    assert.match(source, /boundDetailContent\(/);
    assert.match(source, /detailContentSections\(editorial, lang, localePath\("\/contact"\)\)/);
    assert.match(source, /detailContentNavigation\(editorial\)/);
  }
  const program = readFileSync(new URL("../src/pages/public/ProgramDetail.tsx", import.meta.url), "utf8");
  assert.match(program, /programAdmissionsOpen\(program\)/);
  assert.match(program, /\?programId=\$\{program.id\}/);
  assert.match(program, /programs=\{payload.related\}/);
  const styles = readFileSync(new URL("../src/pages/public/detailEditorial.css", import.meta.url), "utf8");
  assert.match(styles, /\.detail-editorial-table \{ overflow-x: auto/);
  assert.match(styles, /env\(safe-area-inset-bottom\)/);
  assert.match(styles, /prefers-reduced-motion/);
});
