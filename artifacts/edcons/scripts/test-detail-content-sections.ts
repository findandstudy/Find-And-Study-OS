import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { parseDetailContent, resolveDetailTemplateContent, DETAIL_CONTENT_KEYS, DETAIL_CONTENT_LAYOUT_KEYS, DETAIL_CONTENT_LOCALES, DETAIL_GENERATED_CONTENT_KEYS, type DetailContent } from "../src/lib/website/detailContentContract";
import { defaultDetailLayout } from "../src/lib/website/detailLayoutContract";
import { resolveCmsValue } from "../src/lib/website/cmsTextVariables";
import { DetailHeroMedia, boundDetailContent, detailContentAddon, detailContentIntro, detailContentLabels, detailContentNavigation, detailContentSections, detailContentTitle } from "../src/pages/public/DetailContentSections";

const fixture: DetailContent = { version: 1, kind: "program", entityId: 42, locale: "en", sections: [{
  key: "faq", title: "Questions & answers", body: "Published narrative", reviewedOn: "2026-01-01",
  sources: [{ label: "Source", url: "https://example.org/source" }],
  questions: [{ question: "How to enquire?", answer: "Contact an adviser." }],
  table: { columns: ["Topic", "Information"], rows: [["Accommodation", "Ask about options"]] },
  cards: [{ title: "Explore", body: "Approved copy", href: "/en/contact" }],
  steps: [{ title: "Ask", body: "Use the existing enquiry flow" }],
  images: [{ src: "/images/photo.jpg", alt: "Reviewed source photograph", caption: "Caption" }],
}] };
const contentSectionsSource = readFileSync(new URL("../src/pages/public/DetailContentSections.tsx", import.meta.url), "utf8");
const galleryDialogSource = readFileSync(new URL("../src/pages/public/DetailGalleryDialog.tsx", import.meta.url), "utf8");
const detailLayoutSource = readFileSync(new URL("../src/pages/public/DetailLayout.tsx", import.meta.url), "utf8");

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
    assert.deepEqual(DETAIL_CONTENT_LAYOUT_KEYS[kind as DetailContent["kind"]], layout.sections);
    for (const key of keys) assert.ok(layout.sections.some(section => (section.startsWith("editorial-") ? section.slice(10) : section) === key));
    assert.equal(new Set(layout.sections).size, layout.sections.length);
  }
  for (const locale of DETAIL_CONTENT_LOCALES) assert.ok(detailContentLabels(locale));
  for (const key of ["requirements", "living", "climate", "housing", "visa"]) assert.ok(DETAIL_CONTENT_KEYS.destination.includes(key), `destination:${key}`);
  for (const key of ["requirements", "living", "climate", "transport", "housing", "visa"]) assert.ok(DETAIL_CONTENT_KEYS.city.includes(key), `city:${key}`);
  for (const key of ["requirements", "living", "climate", "housing", "services", "studentStory"]) assert.ok(DETAIL_CONTENT_KEYS.program.includes(key), `program:${key}`);
  for (const key of ["admission", "intakeGuide", "support", "campus", "housing", "reviews"]) assert.ok(DETAIL_CONTENT_KEYS.university.includes(key), `university:${key}`);
});

test("a validated page-level order overrides the shared layout in preview and public rendering", () => {
  assert.match(detailLayoutSource, /sectionOrder\?: readonly string\[\]/);
  assert.match(detailLayoutSource, /effectiveLayout\.sections\.indexOf/);
  assert.match(detailLayoutSource, /effectiveLayout\.sections\.filter/);
  for (const file of ["CountryDetail", "CityDetail", "UniversityDetail", "ProgramDetail"]) {
    const source = readFileSync(new URL(`../src/pages/public/${file}.tsx`, import.meta.url), "utf8");
    assert.match(source, /sectionOrder=\{editorial\?\.sectionOrder\}/);
  }
});

test("generated sections accept reviewed CMS headings without duplicating catalogue records", () => {
  const generated: DetailContent = {
    ...fixture,
    kind: "city",
    entityId: 1,
    sections: [{
      key: "programs",
      title: "Programs in Istanbul",
      body: "Compare current catalogue programs below.",
      reviewedOn: "2026-01-01",
      sources: [{ label: "Catalogue review", url: "https://example.org/catalogue" }],
    }],
  };
  assert.ok(DETAIL_GENERATED_CONTENT_KEYS.includes("programs"));
  assert.ok(parseDetailContent(generated));
  assert.equal(detailContentTitle(generated, "programs", "Fallback"), "Programs in Istanbul");
  assert.match(renderToStaticMarkup(React.createElement(React.Fragment, null, detailContentIntro(generated, "programs"))), /Compare current catalogue programs below/);
  assert.deepEqual(detailContentSections(generated, "en", "/en/contact"), []);
  assert.equal(renderToStaticMarkup(React.createElement(React.Fragment, null, detailContentNavigation(generated))), "");
});

test("shared template copy supplies defaults while page copy keeps precedence", () => {
  const sharedOnly: DetailContent = {
    ...fixture,
    sections: [],
    templateSections: [{ key: "overview", title: "Shared overview", body: "Shared introduction." }, { key: "faq", title: "Shared questions", body: "Shared help text." }],
  };
  assert.ok(parseDetailContent(sharedOnly));
  assert.equal(detailContentTitle(sharedOnly, "overview", "Fallback"), "Shared overview");
  assert.match(renderToStaticMarkup(React.createElement(React.Fragment, null, detailContentIntro(sharedOnly, "overview"))), /Shared introduction/);
  assert.match(renderToStaticMarkup(React.createElement(React.Fragment, null, detailContentSections(sharedOnly, "en", "/en/contact"))), /Shared questions/);
  const overridden: DetailContent = {
    ...sharedOnly,
    sections: [{ key: "overview", title: "Page overview", body: "Page introduction.", sources: [{ label: "Source", url: "https://example.org" }], reviewedOn: "2026-01-01" }],
  };
  assert.equal(detailContentTitle(overridden, "overview", "Fallback"), "Page overview");
  assert.match(renderToStaticMarkup(React.createElement(React.Fragment, null, detailContentIntro(overridden, "overview"))), /Page introduction/);
  assert.equal(parseDetailContent({ ...sharedOnly, templateSections: [{ key: "hero", title: "Must not replace entity name" }] }), null);
});

test("shared template variables resolve from the exact page projection before rendering", () => {
  const content: DetailContent = {
    ...fixture,
    sections: [],
    templateSections: [{ key: "overview", title: "Study {{program.name}}", body: "{{program.duration|Duration on request}} at {{university.name}}." }],
  };
  const resolved = resolveDetailTemplateContent(content, { "program.name": "Computer Science", "program.duration": null, "university.name": "Example University" });
  assert.equal(detailContentTitle(resolved, "overview", "Fallback"), "Study Computer Science");
  assert.match(renderToStaticMarkup(React.createElement(React.Fragment, null, detailContentIntro(resolved, "overview"))), /Duration on request at Example University/);
});

test("page-specific detail copy and managed CMS copy resolve only from their page context", () => {
  const pageSpecific: DetailContent = { ...fixture, sections: [{ ...fixture.sections[0], title: "Questions about {{program.name}}", body: "Study at {{university.name|the institution}}", cards: [{ title: "{{program.duration|Flexible}}", body: "{{program.tuitionFee|Ask for fees}}" }] }] };
  assert.ok(parseDetailContent(pageSpecific));
  const resolved = resolveDetailTemplateContent(pageSpecific, { "program.name": "Computer Science", "university.name": "Example University", "program.duration": "4 years", "program.tuitionFee": "$12,000" });
  assert.equal(resolved?.sections[0].title, "Questions about Computer Science");
  assert.equal(resolved?.sections[0].cards?.[0].body, "$12,000");
  assert.equal(parseDetailContent({ ...pageSpecific, sections: [{ ...pageSpecific.sections[0], title: "{{city.name}}" }] }), null);
  const managed = resolveCmsValue({ title: "Welcome to {{site.name}}", text: "{{page.title}} · {{page.locale}} · {{date.year}}" }, { siteName: "Find And Study", pageTitle: "About us", pageSlug: "about", pageLocale: "en", currentYear: 2030 });
  assert.deepEqual(managed, { title: "Welcome to Find And Study", text: "About us · en · 2030" });
});

test("renderer exposes accessible gallery, FAQ, table and steps without public editorial metadata", () => {
  const markup = renderToStaticMarkup(React.createElement(React.Fragment, null, detailContentSections(fixture, "en", "/en/contact")));
  for (const expected of ["editorial-faq", "Questions &amp; answers", "<summary>", 'scope="col"', 'scope="row"', 'role="region"', 'tabindex="0"', 'alt="Reviewed source photograph"', 'href="/en/contact"', "<ol", "Contact an adviser."]) assert.ok(markup.includes(expected), expected);
  assert.doesNotMatch(markup, /Sources|Editorial review|Suggest a correction|2026-01-01|example\.org\/source/);
  assert.doesNotMatch(markup, /verified review|AggregateRating|application\/ld\+json|dangerouslySetInnerHTML/i);
  const nav = renderToStaticMarkup(React.createElement(React.Fragment, null, detailContentNavigation(fixture)));
  assert.match(nav, /href="#editorial-faq"/);
});

test("hero uses only reviewed CMS media and does not duplicate it in editorial content", () => {
  const heroContent: DetailContent = {
    ...fixture,
    sections: [{
      key: "hero",
      title: "Study with confidence",
      body: "Reviewed introduction",
      images: [{ src: "/images/reviewed-cover.jpg", alt: "Reviewed campus view", caption: "Campus" }],
      reviewedOn: "2026-01-01",
      sources: [{ label: "Source", url: "https://example.org/source" }],
    }],
  };
  const media = renderToStaticMarkup(React.createElement(DetailHeroMedia, { content: heroContent }));
  assert.match(media, /class="detail-hero-media"/);
  assert.match(media, /src="\/images\/reviewed-cover\.jpg"/);
  assert.match(media, /loading="eager"/);
  assert.match(media, /fetchPriority="high"/);
  assert.match(media, /alt=""/);
  const addon = renderToStaticMarkup(React.createElement(React.Fragment, null, detailContentAddon(heroContent, "hero", "en", "/en/contact")));
  assert.equal(addon, "");
  assert.equal(renderToStaticMarkup(React.createElement(DetailHeroMedia, { content: fixture })), "");
});

test("city hero exposes validated editable copy and appearance without accepting catalogue values", () => {
  const heroContent: DetailContent = {
    version: 1, kind: "city", entityId: 1, locale: "en", sections: [{
      key: "hero", title: "Study in Istanbul", body: "Reviewed hero copy",
      hero: { eyebrow: "Student city", primaryCtaLabel: "Explore programmes", primaryCtaHref: "/en/programs?city=Istanbul", backgroundColor: "#102B48", overlayOpacity: 70 },
      reviewedOn: "2026-01-01", sources: [{ label: "Source", url: "https://example.org" }],
    }],
  };
  assert.ok(parseDetailContent(heroContent));
  assert.equal(parseDetailContent({ ...heroContent, sections: [{ ...heroContent.sections[0], hero: { universityCount: 10 } as never }] }), null);
});

test("the gallery dialog is loaded only after an explicit image interaction", () => {
  assert.match(contentSectionsSource, /lazy\(\(\) => import\("\.\/DetailGalleryDialog"\)\)/);
  assert.match(contentSectionsSource, /selected && <Suspense fallback=\{null\}>/);
  assert.doesNotMatch(contentSectionsSource, /from "@\/components\/ui\/dialog"/);
  assert.match(galleryDialogSource, /onCloseAutoFocus=/);
  assert.match(galleryDialogSource, /onClosedAutoFocus\(\)/);
  assert.match(galleryDialogSource, /alt=\{image\.alt\}/);
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
    assert.match(source, /detailContentSections\(editorial, lang, localePath\("\/contact"\)/);
    assert.match(source, /detailContentNavigation\(editorial/);
    if (file === "CountryDetail") assert.match(source, /detail-country-cover/);
    assert.match(source, /<DetailHeroMedia content=\{editorial\} \/>/);
    if (file === "CountryDetail" || file === "CityDetail") assert.doesNotMatch(source, /detailContentAddon\(editorial, "hero"/);
    else assert.match(source, /detailContentAddon\(editorial, "hero"/);
    assert.match(source, /detailContentAddon\(editorial, "overview"/);
  }
  const program = readFileSync(new URL("../src/pages/public/ProgramDetail.tsx", import.meta.url), "utf8");
  assert.match(program, /detailContentAddon\(editorial, "hero"/);
  assert.match(program, /detailContentAddon\(editorial, "overview"/);
  assert.match(program, /detailContentAddon\(editorial, "requirements"/);
  assert.match(program, /programAdmissionsOpen\(program\)/);
  assert.match(program, /\?programId=\$\{program.id\}/);
  assert.match(program, /programs=\{payload.related\}/);
  const styles = readFileSync(new URL("../src/pages/public/detailEditorial.css", import.meta.url), "utf8");
  assert.match(styles, /\.detail-editorial-table \{ overflow-x: auto/);
  assert.match(styles, /env\(safe-area-inset-bottom\)/);
  assert.match(styles, /prefers-reduced-motion/);
});

test("public detail presentation retains the approved HTML-reference visual language", () => {
  const styles = readFileSync(new URL("../src/pages/public/detailEditorial.css", import.meta.url), "utf8");
  for (const token of [
    "--detail-ink: #0b1220",
    "--detail-ink-soft: #344054",
    "--detail-paper: #fffdf9",
    "--detail-sand: #f3eee5",
    "--detail-sky: #edf3f7",
    "--detail-accent: #174a7e",
    "--detail-navy: #0e2138",
    "--detail-line: #d8dde3",
  ]) assert.ok(styles.includes(token), token);
  assert.match(styles, /\.detail-wrap \{ width: min\(1260px, calc\(100% - 42px\)\)/);
  assert.match(styles, /\.detail-hero \{[^}]*linear-gradient\(120deg, #081727, var\(--detail-navy\)/);
  assert.match(styles, /\.detail-hero > \.detail-hero-media \{ position: absolute; z-index: 0; inset: 0; \}/);
  assert.match(styles, /rgba\(4, 10, 22, \.90\) 100%/);
  assert.match(styles, /\.detail-hero-main \{[^}]*grid-template-columns: minmax\(0, 1\.2fr\) 380px/);
  assert.match(styles, /\.detail-section \{ padding-block: 64px/);
  assert.match(styles, /\.detail-program \.detail-section \{ padding-block: 88px/);
  assert.match(styles, /\.detail-program \.detail-hero-main \{ min-height: min\(88vh, 760px\)/);
  assert.match(styles, /\.detail-university \.detail-hero-main \{ min-height: min\(72vh, 640px\)/);
  assert.match(styles, /\.detail-editorial-section\.is-climate \.detail-editorial-cards/);
  assert.match(styles, /counter-reset: detail-chapter 0/);
  assert.match(styles, /\.detail-destination \.detail-editorial-cards \{\s*grid-template-columns: repeat\(auto-fit/);
  assert.match(styles, /\.detail-destination \.detail-climate-ribbon \{\s*grid-template-columns: repeat\(auto-fit/);
  assert.match(styles, /\.detail-housing-strip article\.is-text-only/);
  assert.match(styles, /@media \(max-width: 760px\)/);
  assert.match(styles, /\[dir="rtl"\]/);
});
