import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { sanitizePublicRichText } from "../src/lib/publicHtmlSanitizer";
import { catalogueCount, DETAIL_COPY, detailCopy, detailMoney, displayTuition, durationIsAmbiguous, splitRequirements, localDetailPath, tuitionOffer } from "../src/pages/public/detailPresentation";
import { SUPPORTED_LANGUAGES } from "../src/lib/i18n";
import { defaultDetailLayout, parseDetailLayout } from "../src/lib/website/detailLayoutContract";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Router } from "wouter";
import { DetailBreadcrumbs, DetailFacts, DetailIdentity, DetailImage, DetailPrice } from "../src/pages/public/DetailEditorial";
import { I18nContext, type I18nContextValue } from "../src/lib/i18n/use-i18n-context";
import { PublicProgramCard, type PublicProgramCardData, type PublicProgramCardProps } from "../src/pages/public/PublicProgramCard";
import { CityProgramCards, type CityProgramCardData } from "../src/pages/public/CityProgramCards";
import { emptyProgramSelection, programPageNumbers, universityProgramQuery } from "../src/pages/public/universityProgramQuery";

const program = readFileSync(new URL("../src/pages/public/ProgramDetail.tsx", import.meta.url), "utf8");
const university = readFileSync(new URL("../src/pages/public/UniversityDetail.tsx", import.meta.url), "utf8");
const countries = readFileSync(new URL("../src/pages/public/Countries.tsx", import.meta.url), "utf8");
const country = readFileSync(new URL("../src/pages/public/CountryDetail.tsx", import.meta.url), "utf8");
const city = readFileSync(new URL("../src/pages/public/CityDetail.tsx", import.meta.url), "utf8");
const publicPage = readFileSync(new URL("../src/pages/public/PublicPage.tsx", import.meta.url), "utf8");
const pageEditor = readFileSync(new URL("../src/pages/admin/website/PageEditor.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const blockTypes = readFileSync(new URL("../src/lib/website/blockTypes.ts", import.meta.url), "utf8");
const editorial = readFileSync(new URL("../src/pages/public/DetailEditorial.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/pages/public/detailEditorial.css", import.meta.url), "utf8");
const layout = readFileSync(new URL("../src/pages/public/DetailLayout.tsx", import.meta.url), "utf8");
const programs = readFileSync(new URL("../src/pages/public/Programs.tsx", import.meta.url), "utf8");
const programCard = readFileSync(new URL("../src/pages/public/PublicProgramCard.tsx", import.meta.url), "utf8");
const programFilters = readFileSync(new URL("../src/pages/public/PublicProgramFilters.tsx", import.meta.url), "utf8");
const universityBrowser = readFileSync(new URL("../src/pages/public/UniversityProgramBrowser.tsx", import.meta.url), "utf8");
const programDialog = readFileSync(new URL("../src/pages/public/PublicProgramDetailDialog.tsx", import.meta.url), "utf8");
const cityProgramCards = readFileSync(new URL("../src/pages/public/CityProgramCards.tsx", import.meta.url), "utf8");

const cardFixture: PublicProgramCardData = {
  id: 145792, name: "Source program", canonicalPath: "/en/programs/source-program-145792",
  universityName: "Source institution", universityPath: "/en/universities/source-institution-1563",
  degree: "Master", field: "Engineering", language: "English", duration: "12 months",
  universityCity: "Source city", universityCountry: "Source country",
  tuitionFee: 50000, discountedFee: 40000, scholarship: 30000, depositFee: 20000, languageFee: 10000,
  currency: "GBP", feeType: "YEAR", intakes: "LEGACY_INTAKE_MUST_NOT_LEAK",
};

function renderProgramCard(props: Partial<PublicProgramCardProps> = {}): string {
  return renderPublicElement(createElement(PublicProgramCard, { program: cardFixture, index: 0, ...props }));
}

function renderPublicElement(element: React.ReactElement, locale: I18nContextValue["lang"] = "en"): string {
  const isRTL = ["ar", "fa", "ur"].includes(locale);
  const context: I18nContextValue = {
    lang: locale, setLang: () => {}, t: (key, params) => [key, ...Object.values(params ?? {})].join(" "), dir: isRTL ? "rtl" : "ltr", isRTL,
    localePath: path => `/${locale}${path}`,
  };
  // tsx's classic JSX transform needs the binding that Vite supplies automatically.
  const previousReact = Reflect.get(globalThis, "React");
  const hadReact = Object.hasOwn(globalThis, "React");
  Reflect.set(globalThis, "React", React);
  try {
    return renderToStaticMarkup(createElement(I18nContext.Provider, { value: context },
      createElement(Router, { ssrPath: `/${locale}/universities/source-institution-1563` }, element)));
  } finally {
    if (hadReact) Reflect.set(globalThis, "React", previousReact);
    else Reflect.deleteProperty(globalThis, "React");
  }
}

test("program information architecture stays data-bound", () => {
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
  assert.match(universityBrowser, /displayTuition\(\{ \.\.\.program, tuition: program\.tuition \?\? null \}, lang\)/);
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
  assert.equal(upgraded?.version, 3);
  assert.deepEqual(upgraded?.sections.filter(key => !key.startsWith("editorial-")), ["hero", "navigation", "overview", "facts", "cities", "cta", "universities"]);
  assert.deepEqual(upgraded?.hidden, ["universities"]);
  const current = defaultDetailLayout("program");
  assert.deepEqual(parseDetailLayout(current), current);
  const previous = parseDetailLayout({ version: 2, kind: "program", sections: ["hero", "navigation", "overview", "fees", "requirements", "intakes", "related"], hidden: ["fees"] });
  assert.ok(previous);
  assert.deepEqual(previous.sections.filter(key => !key.startsWith("editorial-") && key !== "mobileActions"), ["hero", "navigation", "overview", "fees", "requirements", "intakes", "related"]);
  assert.equal(parseDetailLayout({ ...current, hidden: ["hero"] }), null);
  assert.equal(parseDetailLayout({ ...current, sections: [...current.sections, "reviews"] }), null);
  assert.equal(parseDetailLayout({ ...current, html: "<script>" }), null);
});

test("editorial presentation keeps honest counts, localized copy and safe navigation", () => {
  for (const missing of [undefined, null, NaN, Infinity, -1, "10"]) assert.equal(catalogueCount(missing, "Programs"), null);
  assert.equal(catalogueCount(0, "Programs"), "0 Programs");
  assert.equal(catalogueCount(10, "Programs"), "10 Programs");
  assert.equal(localDetailPath("https://example.com"), null);
  assert.equal(localDetailPath("//example.com"), null);
  assert.equal(localDetailPath("javascript:alert(1)"), null);
  assert.equal(localDetailPath("/en/cities/10-manchester"), "/en/cities/10-manchester");
  assert.deepEqual(Object.keys(DETAIL_COPY).sort(), [...SUPPORTED_LANGUAGES].sort());
  for (const locale of SUPPORTED_LANGUAGES) {
    assert.deepEqual(Object.keys(detailCopy(locale)).sort(), Object.keys(detailCopy("en")).sort());
    assert.ok(Object.values(detailCopy(locale)).every(value => typeof value === "string" && value.length > 0));
  }
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /\[dir="rtl"\]/);
  assert.match(css, /focus-visible/);
  assert.match(universityBrowser, /role="region" aria-label/);
  for (const source of [program, university, country, city]) assert.doesNotMatch(source, /Fenerbahçe|unsplash|verified student/i);
});

test("missing or unsafe catalogue photographs render no media or fabricated fallback", () => {
  for (const src of [undefined, null, "", "//example.edu/campus.jpg", "javascript:alert(1)", "data:image/svg+xml,<svg/>", "campus.jpg"]) {
    assert.equal(renderToStaticMarkup(createElement(DetailImage, { src, alt: "Source campus" })), "");
  }
  const image = renderToStaticMarkup(createElement(DetailImage, { src: "/media/source-campus.jpg", alt: "Source campus", className: "detail-destination-image" }));
  assert.match(image, /<img/);
  assert.match(image, /src="\/media\/source-campus\.jpg"/);
  assert.match(image, /alt="Source campus"/);
  assert.match(image, /loading="lazy"/);
  const priority = renderToStaticMarkup(createElement(DetailImage, { src: "https://example.edu/source-campus.jpg", alt: "Source campus", priority: true }));
  assert.match(priority, /loading="eager"/);
  assert.match(priority, /fetchPriority="high"/i);
  assert.match(editorial, /failed === src/);
  assert.match(editorial, /onError=\{\(\) => setFailed\(src\)\}/);
  assert.doesNotMatch(editorial, /DetailArtwork|detail-art|unsplash/i);
});

test("identity uses a supplied logo or an explicitly decorative entity icon", () => {
  for (const kind of ["university", "program", "city"] as const) {
    for (const src of [undefined, null, "", "//example.edu/logo.png", "javascript:alert(1)", "data:image/png;base64,invalid"]) {
      const html = renderToStaticMarkup(createElement(DetailIdentity, { src, name: "Source institution", kind }));
      assert.match(html, new RegExp(`detail-card-identity is-${kind}`));
      assert.match(html, /aria-hidden="true"/);
      assert.match(html, /<svg/);
      assert.doesNotMatch(html, /<img|campus photograph|verified/i);
    }
  }
  for (const src of ["/api/course-finder/universities/123/logo", "https://example.edu/logo.png"]) {
    const html = renderToStaticMarkup(createElement(DetailIdentity, { src, name: "Source institution" }));
    assert.ok(html.includes(`src="${src}"`));
    assert.match(html, /<img[^>]+alt=""/);
    assert.doesNotMatch(html, /<svg/);
  }
  assert.match(editorial, /failed !== src/);
  assert.match(program, /<DetailIdentity src=\{program\.universityLogoUrl\}/);
  assert.match(university, /<DetailIdentity src=\{university\.logoUrl\}/);
});

test("all four detail heroes put the breadcrumb before their real title", () => {
  for (const [kind, source] of Object.entries({ program, university, country, city })) {
    const start = source.indexOf('<section data-detail-section="hero">');
    const end = source.indexOf("</section>", start);
    assert.ok(start >= 0 && end > start, `${kind} hero is a governed section`);
    const hero = source.slice(start, end);
    const breadcrumb = hero.indexOf("<DetailBreadcrumbs");
    const title = hero.indexOf("<h1");
    assert.ok(breadcrumb >= 0 && title > breadcrumb, `${kind} breadcrumb precedes its title`);
    assert.match(hero, /detail-hero-top/);
    assert.doesNotMatch(hero, /DetailArtwork|detail-hero-backdrop/);
  }
  assert.match(university, /<aside className="detail-hero-card"/);
  assert.match(university, /detail-summary-count/);
  assert.match(university, /href="#programs"/);
  assert.match(program, /<aside className="detail-hero-card"/);
});

test("university programs are responsive factual cards with accessible navigation", () => {
  assert.match(university, /<UniversityProgramBrowser/);
  assert.match(universityBrowser, /className="university-program-browser" role="region" aria-label=/);
  assert.match(universityBrowser, /className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">\{result\.data\.map\(\(program, index\) => <PublicProgramCard/);
  assert.match(programCard, /<h3 className="[^"]*text-\[15px\][^"]*line-clamp-2[^\n]*<bdi>\{prog\.name\}/);
  assert.match(programCard, /programPath \? <Link href=\{programPath\}/);
  assert.match(programCard, /prog\.language &&/);
  assert.match(programCard, /prog\.duration &&/);
  assert.match(programCard, /<bdi>\{prog\.duration\}<\/bdi>/);
  assert.match(programCard, /aria-label=\{t\("programs\.programDetails"\)\}/);
  assert.match(programCard, /public-program-card group min-w-0/);
  assert.match(university, /\?universityId=\$\{university\.id\}/);
  for (const source of [university, universityBrowser, programCard]) assert.doesNotMatch(source, /<table|<thead|<tbody|scrollTable/);
  const programsSection = university.slice(university.indexOf('<section data-detail-section="programs"'));
  assert.doesNotMatch(programsSection, /payload\.programs\.map/, "the full program list is server-paged, not the bounded hero metadata sample");
  assert.match(css, /\.public-detail \.public-program-card h3\s*\{[^}]*text-wrap:\s*initial/);
  const html = renderProgramCard({ applyHref: "/en/programs?programId=145792" });
  assert.match(html, /<h3[^>]*><bdi>Source program<\/bdi>/);
  assert.match(html, /href="\/en\/programs\/source-program-145792"/);
  assert.match(html, /href="\/en\/universities\/source-institution-1563"/);
  assert.match(html, /href="\/en\/programs\?programId=145792"/);
  for (const value of ["Master", "Engineering", "English", "12 months"]) assert.ok(html.includes(`<bdi>${value}</bdi>`));
});

test("Programs and university reuse the same card and filters without changing dialog callbacks", () => {
  for (const source of [programs, universityBrowser]) {
    assert.match(source, /import \{ PublicProgramCard(?:, type PublicProgramCardData)? \} from "\.\/PublicProgramCard"/);
    assert.match(source, /import \{ PublicProgramFilters/);
    assert.match(source, /<PublicProgramCard/);
    assert.match(source, /<PublicProgramFilters/);
  }
  assert.match(programs, /onDetails=\{\(\) => setDetailProgram\(prog\)\} onApply=\{\(\) => setApplyProgram\(prog\)\}/);
  assert.match(programs, /<ApplyDialog open=\{!!applyProgram\} onClose=\{\(\) => setApplyProgram\(null\)\} program=\{applyProgram\}/);
  assert.match(programs, /<PublicProgramDetailDialog open=\{!!detailProgram\} onClose=\{\(\) => setDetailProgram\(null\)\} program=\{detailProgram\}/);
  assert.match(programs, /if \(requestedProgramId && resp\.data\?\.length === 1\)\s*\{\s*setApplyProgram\(\(current\) => current \|\| resp\.data\[0\]\)/);
  assert.match(programCard, /onClick=\{onDetails\}/);
  assert.match(programCard, /onClick=\{onApply\}/);
  assert.match(universityBrowser, /applyHref=\{`\$\{localePath\("\/programs"\)\}\?programId=\$\{program\.id\}`\}/);
  assert.match(universityBrowser, /applyDisabled=\{!admissionsOpen \|\| !programAdmissionsOpen\(program\)\}/);
  const callbacks = renderProgramCard({ onApply: () => {}, onDetails: () => {} });
  assert.match(callbacks, /<button[^>]*aria-label="programs.programDetails"/);
  assert.doesNotMatch(callbacks, /href="[^\"]*\?programId=/);
});

test("university Info opens the shared modal while the program title remains canonical navigation", () => {
  for (const source of [programs, universityBrowser]) {
    assert.match(source, /import \{ PublicProgramDetailDialog/);
    assert.match(source, /<PublicProgramDetailDialog/);
  }
  assert.match(universityBrowser, /onDetails=\{\(\) => setDetailProgram\(\{ \.\.\.program, requirements: splitRequirements/);
  assert.match(universityBrowser, /onClose=\{\(\) => setDetailProgram\(null\)\}/);
  const html = renderProgramCard({ onDetails: () => {}, applyHref: "/en/programs?programId=145792" });
  assert.match(html, /<button[^>]*aria-label="programs.programDetails"/);
  assert.doesNotMatch(html, /<a[^>]*aria-label="programs.programDetails"/);
  assert.match(html, /<a href="\/en\/programs\/source-program-145792"[^>]*><h3/);
  assert.match(html, /href="\/en\/programs\?programId=145792"/);
});

test("university modal receives authoritative tuition and conservative requirements, never importer timing", () => {
  assert.match(universityBrowser, /requirements: splitRequirements\(program.requirements, \{ canonicalPath: program.canonicalPath, id: program.id \}\).requirements.join\("\\n"\)/);
  const modal = universityBrowser.slice(universityBrowser.indexOf("<PublicProgramDetailDialog"));
  assert.match(modal, /program=\{detailProgram\} omitLegacyTiming/);
  assert.match(modal, /tuitionContent=\{detailProgram \?/);
  assert.match(modal, /displayTuition\(\{ \.\.\.detailProgram, tuition: detailProgram.tuition \?\? null \}, lang\)/);
  assert.match(modal, /: null\}/);
  const canonicalPath = "/en/programs/source-program-145792";
  assert.deepEqual(splitRequirements("source-program | Campus: Source city | Intake years: 2025/2026 | Deadline: 2025-01-01 | Edvoy ref: 123 | IELTS: 6.5 | A-level", { canonicalPath, id: 145792 }).requirements, ["IELTS: 6.5", "A-level"]);
});

test("shared modal guards all legacy fees and timing while retaining escaped requirements and focus return", () => {
  assert.match(programDialog, /const hasTuitionOverride = tuitionContent !== undefined/);
  assert.match(programDialog, /hasTuitionOverride \? tuitionContent : \(effectiveFee \|\| program.scholarship\) \?/);
  const guardedRows = programDialog.slice(programDialog.indexOf("if (!hasTuitionOverride) {"), programDialog.indexOf("  return ("));
  for (const field of ["feeType", "applicationFee", "depositFee", "advancedFee", "languageFee"]) {
    assert.ok(guardedRows.includes(`if (program.${field})`), `${field} is guarded by the authoritative tuition slot`);
  }
  assert.match(programDialog, /!omitLegacyTiming && program.intakes/);
  assert.match(programDialog, /<bdi>\{program.requirements\}<\/bdi>/);
  assert.doesNotMatch(programDialog, /dangerouslySetInnerHTML|setLocation|window.location/);
  assert.match(programDialog, /<Dialog open=\{open\} onOpenChange=/);
  assert.match(programDialog, /onOpenAutoFocus=/);
  assert.match(programDialog, /onCloseAutoFocus=/);
  assert.match(programDialog, /target\?\.isConnected/);
  assert.match(programDialog, /target.focus\(\{ preventScroll: true \}\)/);
  assert.match(programDialog, /dir=\{dir\}/);
  assert.match(programDialog, /max-h-\[90vh\] overflow-y-auto/);
  assert.doesNotMatch(programs, /function ProgramDetailDialog\(/, "there is only one information dialog implementation");
});

test("authoritative university tuition suppresses every legacy fee and raw intake", () => {
  assert.match(universityBrowser, /omitLegacyTiming\s+tuitionContent=/);
  assert.match(universityBrowser, /displayTuition\(\{ \.\.\.program, tuition: program\.tuition \?\? null \}, lang\)/);
  assert.match(programCard, /const hasTuitionOverride = tuitionContent !== undefined/);
  assert.match(programCard, /hasTuitionOverride \? tuitionContent : effectiveFee != null &&/);
  assert.match(programCard, /!hasTuitionOverride && prog\.depositFee/);
  assert.match(programCard, /!hasTuitionOverride && prog\.languageFee/);
  assert.match(programCard, /!omitLegacyTiming && prog\.intakes/);
  const legacy = renderProgramCard();
  for (const amount of ["50,000", "40,000", "30,000", "20,000", "10,000"]) assert.ok(legacy.includes(amount));
  assert.match(legacy, /LEGACY_INTAKE_MUST_NOT_LEAK/);
  for (const tuitionContent of [null, createElement(DetailPrice, {
    tuition: displayTuition({ ...cardFixture, tuition: null }, "en"), locale: "en", verifiedLabel: "Verified price",
  }), createElement("strong", {}, "Authoritative tuition slot")]) {
    const html = renderProgramCard({ tuitionContent, omitLegacyTiming: true });
    assert.doesNotMatch(html, /50,000|40,000|30,000|20,000|10,000|LEGACY_INTAKE_MUST_NOT_LEAK|courseFinderPage\.(scholarship|depositStrip|languageFee)|% OFF/);
    if (tuitionContent !== null) assert.match(html, /Confirm tuition with an adviser|Authoritative tuition slot/);
  }
  for (const tuition of [undefined, null]) assert.equal(displayTuition({ ...cardFixture, tuition: tuition ?? null }, "en"), null);
});

test("shared cards reject unsafe destinations and closed applications stay non-navigable", () => {
  for (const unsafe of ["//example.edu", "javascript:alert(1)", "data:text/html,test", "/\\example.edu", "/en/\nprograms"]) {
    const html = renderProgramCard({ program: { ...cardFixture, canonicalPath: unsafe, universityPath: unsafe, universityWebsite: unsafe, universityLogoUrl: unsafe }, applyHref: unsafe });
    assert.doesNotMatch(html, /href=|<img/);
    assert.match(html, /<button[^>]*disabled=""/);
  }
  const closed = renderProgramCard({ applyHref: "/en/programs?programId=145792", applyDisabled: true });
  assert.doesNotMatch(closed, /href="\/en\/programs\?programId=/);
  assert.match(closed, /<button[^>]*disabled=""/);
  const website = renderProgramCard({ program: { ...cardFixture, universityWebsite: "https://example.edu", universityLogoUrl: "/api/storage/objects/objects/logo.png" } });
  assert.match(website, /href="https:\/\/example.edu" target="_blank" rel="noopener noreferrer"/);
  assert.match(website, /src="\/api\/storage\/objects\/logo.png"/);
});

test("university queries keep immutable scope when filters are combined or cleared", () => {
  const selection = { ...emptyProgramSelection(), country: ["Other country"], city: ["Other city"], universityType: ["Private"], universityId: ["9999", "8888"], level: ["Master", "Bachelor"], language: ["English", "Türkçe"], field: ["Engineering", "Design & Arts"], feeMin: "0", feeMax: "50000" };
  const before = structuredClone(selection);
  const query = new URLSearchParams(universityProgramQuery(1563, "tr", "  Design & AI  ", selection));
  assert.equal(query.get("scope"), "public");
  for (const key of ["universityId", "detailUniversityId"]) assert.deepEqual(query.getAll(key), ["1563"]);
  for (const key of ["country", "city", "universityType", "page", "limit"]) assert.equal(query.has(key), false);
  assert.equal(query.get("locale"), "tr");
  assert.equal(query.get("search"), "Design & AI");
  assert.equal(query.get("level"), "Master,Bachelor");
  assert.equal(query.get("language"), "English,Türkçe");
  assert.equal(query.get("field"), "Engineering,Design & Arts");
  assert.equal(query.get("feeMin"), "0");
  assert.equal(query.get("feeMax"), "50000");
  assert.deepEqual(selection, before, "building a query does not mutate UI filters");
  const clean = emptyProgramSelection();
  assert.deepEqual(Object.fromEntries(new URLSearchParams(universityProgramQuery(1563, "tr", "  ", clean))), { scope: "public", universityId: "1563", detailUniversityId: "1563", locale: "tr" });
  clean.level.push("Changed");
  assert.deepEqual(emptyProgramSelection().level, [], "clear returns fresh arrays");
  for (const invalid of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => universityProgramQuery(invalid, "en", "", emptyProgramSelection()), /Invalid university scope/);
});

test("university query independently composes all program filters and supported locales", () => {
  const fields = ["level", "language", "field", "feeMin", "feeMax"] as const;
  const values = { level: ["Master"], language: ["English"], field: ["Engineering"], feeMin: "100", feeMax: "1000" };
  for (let mask = 0; mask < 32; mask += 1) {
    const selection = emptyProgramSelection();
    for (const [index, key] of fields.entries()) if (mask & (1 << index)) Object.assign(selection, { [key]: values[key] });
    const query = new URLSearchParams(universityProgramQuery(1563, "en", mask % 2 ? "Search + scope=admin&universityId=99" : "", selection));
    for (const [index, key] of fields.entries()) assert.equal(query.has(key), !!(mask & (1 << index)), `${mask}: ${key}`);
    assert.equal(query.has("search"), mask % 2 === 1);
    assert.deepEqual(query.getAll("universityId"), ["1563"]);
    assert.equal(query.get("scope"), "public");
  }
  for (const locale of SUPPORTED_LANGUAGES) assert.equal(new URLSearchParams(universityProgramQuery(1563, locale, "", emptyProgramSelection())).get("locale"), locale);
});

test("program pagination covers empty, first, second, middle and final pages without duplicates", () => {
  assert.deepEqual(programPageNumbers(1, 0), []);
  assert.deepEqual(programPageNumbers(1, 1), [1]);
  assert.deepEqual(programPageNumbers(1, 2), [1, 2]);
  assert.deepEqual(programPageNumbers(2, 2), [1, 2]);
  assert.deepEqual(programPageNumbers(1, 10), [1, 2, "...", 10]);
  assert.deepEqual(programPageNumbers(2, 10), [1, 2, 3, "...", 10]);
  assert.deepEqual(programPageNumbers(5, 10), [1, "...", 4, 5, 6, "...", 10]);
  assert.deepEqual(programPageNumbers(9, 10), [1, "...", 8, 9, 10]);
  assert.deepEqual(programPageNumbers(10, 10), [1, "...", 9, 10]);
  for (let total = 1; total <= 30; total += 1) for (let page = 1; page <= total; page += 1) {
    const numbers = programPageNumbers(page, total).filter((value): value is number => typeof value === "number");
    assert.equal(numbers[0], 1); assert.equal(numbers.at(-1), total); assert.ok(numbers.includes(page));
    assert.deepEqual(numbers, [...new Set(numbers)].sort((left, right) => left - right));
    assert.ok(numbers.every(value => value >= 1 && value <= total));
  }
});

test("university browser binds locale, cancels stale requests and resets pagination safely", () => {
  assert.match(university, /<UniversityProgramBrowser key=\{`\$\{university\.id\}:\$\{lang\}`\} universityId=\{university\.id\}/);
  assert.match(universityBrowser, /universityProgramQuery\(universityId, lang, search, selection\)/);
  assert.match(universityBrowser, /setTimeout\(\(\) => setSettledQuery\(query\), 300\); return \(\) => clearTimeout\(timer\)/);
  assert.match(universityBrowser, /new AbortController\(\)/);
  assert.equal((universityBrowser.match(/signal: controller\.signal/g) ?? []).length, 2, "both rows and facets use the same cancellation boundary");
  assert.match(universityBrowser, /if \(controller\.signal\.aborted\) return/);
  assert.match(universityBrowser, /if \(next\.data\.some\(program => program\.universityId !== universityId\)\) throw/);
  assert.match(universityBrowser, /return \(\) => controller\.abort\(\)/);
  assert.match(universityBrowser, /\[settledQuery, page, universityId, attempt\]/);
  assert.match(universityBrowser, /\/api\/course-finder\?\$\{settledQuery\}&page=\$\{page\}&limit=24/);
  assert.match(universityBrowser, /\/api\/course-finder\/filters\?\$\{settledQuery\}/);
  assert.match(universityBrowser, /const busy = loading \|\| query !== settledQuery/);
  assert.match(universityBrowser, /const clear = \(\) => \{ setSelection\(emptyProgramSelection\(\)\); setSearch\(""\); setPage\(1\); \}/);
  assert.match(universityBrowser, /if \(!\["level", "language", "field", "feeMin", "feeMax"\]\.includes\(key\)\) return/);
  assert.match(universityBrowser, /setSelection\(current => \(\{ \.\.\.current, \[key\]: value \}\)\); setPage\(1\)/);
  assert.match(universityBrowser, /onSearchChange=\{value => \{ setSearch\(value\); setPage\(1\); \}\}/);
  assert.match(universityBrowser, /universityLocked feeHint=\{detailCopy\(lang\)\.legacyPrice\}/);
  assert.match(universityBrowser, /aria-current=\{number === page \? "page" : undefined\}/);
  assert.match(universityBrowser, /disabled=\{busy \|\| page <= 1\}/);
  assert.match(universityBrowser, /disabled=\{busy \|\| page >= result\.meta\.totalPages\}/);
  assert.match(universityBrowser, /disabled=\{busy\} onClick=\{\(\) => setPage\(number\)\}/);
  assert.match(universityBrowser, /role="status" aria-live="polite"/);
  assert.match(universityBrowser, /role="alert"/);
  assert.match(universityBrowser, /setAttempt\(value => value \+ 1\)/);
});

test("shared filters expose labelled controls while locked universities hide location selectors", () => {
  assert.match(programFilters, /!universityLocked && <div[^\n]*\{locationControls\.map\(control\)\}/);
  assert.match(programFilters, /universityLocked\s*\? \["level", "language", "field", "feeMin", "feeMax"\]/);
  assert.match(programFilters, /aria-expanded=\{showFilters\} aria-controls=\{panelId\}/);
  assert.match(programFilters, /const panelId = useId\(\)/);
  assert.match(programFilters, /aria-label=\{t\("programs\.searchPlaceholder"\)\}/);
  assert.match(programFilters, /aria-label=\{t\("programs\.feeMin"\)\}/);
  assert.match(programFilters, /aria-label=\{t\("programs\.feeMax"\)\}/);
  assert.match(programFilters, /role="group" aria-label=\{t\(item\.label\)\}/);
  assert.match(programFilters, /onClick=\{onClear\}/);
});

test("new presentation preserves canonical SEO, governed sections and guarded apply links", () => {
  for (const source of [program, university]) {
    assert.match(source, /useSeo\(\{/);
    assert.match(source, /noindex: error \|\| !payload\?\.meta\.indexable/);
    assert.match(source, /alternates: payload\?\.meta\.alternatePaths/);
    assert.match(source, /useJsonLd\(/);
    assert.match(source, /"@type": "BreadcrumbList"/);
    assert.match(source, /setLocation\(result\.meta\.canonicalPath, \{ replace: true \}\)/);
    for (const section of ["hero", "navigation", "overview"]) assert.ok(source.includes(`data-detail-section="${section}"`));
  }
  assert.match(program, /"@type": "Course"/);
  assert.match(university, /"@type": "CollegeOrUniversity"/);
  assert.match(program, /const apply = programAdmissionsOpen\(program\)/);
  assert.match(program, /\?programId=\$\{program\.id\}/);
  assert.match(program, /<button disabled>/);
  assert.match(program, /<div className="detail-actions">\{apply\}<\/div>/);
  assert.match(program, /offers: tuitionOffer\(tuition, programAdmissionsOpen\(program\)\)/);
});

test("missing optional facts and tuition do not become invented values", () => {
  const facts = renderToStaticMarkup(createElement(DetailFacts, { items: [
    { label: "Missing country", value: null }, { label: "Missing duration", value: undefined },
    { label: "Missing language", value: "" }, { label: "Programs", value: 0 },
    { label: "Location", value: "Source city", icon: createElement("svg") },
  ] }));
  assert.doesNotMatch(facts, /Missing country|Missing duration|Missing language/);
  assert.match(facts, /Programs<\/dt><dd><bdi>0<\/bdi><\/dd>/);
  assert.match(facts, /Source city/);
  assert.match(facts, /detail-fact-icon" aria-hidden="true"/);
  const price = renderToStaticMarkup(createElement(DetailPrice, { tuition: null, locale: "en", verifiedLabel: "Verified price" }));
  assert.ok(price.includes(detailCopy("en").confirmPrice));
  assert.doesNotMatch(price, /Verified price|£|\$|€|\bUSD\b/);
  assert.match(program, /requirements\.length > 0 && <section/);
  assert.match(program, /payload\.intakes\.length > 0 && <section/);
  assert.match(program, /hasFees && <section/);
  assert.match(university, /university\.address &&/);
  assert.match(university, /university\.universityType &&/);
});

test("no detail template hardcodes the reference prototype's facts, photographs or trust claims", () => {
  for (const source of [program, university, country, city, editorial]) {
    assert.doesNotMatch(source, /DetailArtwork|unsplash|Fenerbahçe|Ataşehir|verified student|30 Nov 2026|143 applications|7 working days|merit scholarship|page verified/i);
  }
});

test("breadcrumb current-page semantics survive a missing city and mobile repetition is hidden", () => {
  const html = renderToStaticMarkup(createElement(DetailBreadcrumbs, {
    label: "Study catalogue",
    items: [{ label: "Countries" }, { label: "Source country" }, { label: "" }, { label: "Source university" }],
  }));
  assert.match(html, /aria-label="Study catalogue"/);
  assert.match(html, /<span aria-current="page">Source university<\/span>/);
  assert.equal((html.match(/aria-current="page"/g) ?? []).length, 1);
  assert.equal((html.match(/<li>/g) ?? []).length, 3, "missing city does not leave an empty breadcrumb");
  const mobile = css.match(/@media\s*\(max-width:\s*760px\)\s*\{([\s\S]*?)(?=@media|$)/)?.[1];
  assert.ok(mobile);
  assert.match(mobile, /\.detail-breadcrumbs li:last-child:has\(\[aria-current="page"\]\)\s*\{\s*display:\s*none/);
  assert.doesNotMatch(mobile, /\.detail-breadcrumbs\s*\{[^}]*display:\s*none/, "parent navigation stays visible");
});

test("empty optional facts leave no empty definition-list frame but zero remains a fact", () => {
  for (const items of [[], [{ label: "Location", value: null }], [{ label: "Duration", value: undefined }, { label: "Language", value: "" }]]) {
    assert.equal(renderToStaticMarkup(createElement(DetailFacts, { items })), "");
  }
  const zero = renderToStaticMarkup(createElement(DetailFacts, { items: [{ label: "Programs", value: 0 }] }));
  assert.match(zero, /<dl class="detail-facts">/);
  assert.match(zero, /Programs<\/dt><dd><bdi>0<\/bdi><\/dd>/);
});

test("empty location narratives do not repeat generic SEO copy in an empty overview", () => {
  assert.match(country, /hasOverview && <a href="#overview"/);
  assert.match(country, /hasOverview && <section data-detail-section="overview"/);
  assert.match(country, /overviewDescription && <p className="detail-prose detail-snapshot">\{overviewDescription\}/);
  assert.match(city, /overviewDescription && <a href="#overview"/);
  assert.match(city, /overviewDescription && <section data-detail-section="overview"/);
  assert.doesNotMatch(city, /city\.description \|\| payload\.meta\.description/);
});

test("legacy-only tuition keeps its price without rendering an empty component breakdown", () => {
  const start = program.indexOf('{hasFees && <section data-detail-section="fees"');
  assert.ok(start >= 0);
  const fees = program.slice(start, program.indexOf("</section>", start));
  assert.match(fees, /className="detail-fee-panel"/);
  assert.match(fees, /tuition && <DetailPrice tuition=\{tuition\}/);
  assert.match(fees, /visiblePrices\.length > 0 && <dl className="detail-keylines">\{visiblePrices\.map/);
  assert.match(program, /const hasFees = visiblePrices\.length > 0 \|\| tuition !== null/);
  assert.match(fees, /tuition\?\.source !== "legacy" && <p className="detail-provenance">\{copy\.priceBasis\}/);
});

test("active section navigation is local, follows visible DOM order and cleans up every listener", () => {
  const start = layout.indexOf("const element = root.current;");
  const end = layout.indexOf("const cleanLinks", start);
  assert.ok(start >= 0 && end > start);
  const effect = layout.slice(start, end);
  assert.match(effect, /if \(!element\) return/);
  assert.match(effect, /element\.querySelectorAll<HTMLAnchorElement>\('\.detail-nav a\[href\^="#"\]'\)/);
  assert.match(effect, /element\.querySelectorAll<HTMLElement>\("\[data-detail-section\]\[id\]"\)/);
  assert.match(effect, /\.filter\(section => ids\.includes\(section\.id\)\)/);
  assert.match(effect, /\[\.\.\.sections\]\.reverse\(\)\.find/);
  assert.doesNotMatch(effect, /sections\.sort|document\.querySelector|setLocation|history\.|scrollTo/);
  assert.match(effect, /if \(!frame\) frame = window\.requestAnimationFrame\(update\)/);
  assert.match(effect, /window\.addEventListener\("scroll", schedule, \{ passive: true \}\)/);
  assert.match(effect, /window\.addEventListener\("resize", schedule\)/);
  assert.match(effect, /return \(\) => \{ window\.cancelAnimationFrame\(frame\); window\.removeEventListener\("scroll", schedule\); window\.removeEventListener\("resize", schedule\); \}/);
  assert.match(effect, /\[kind, layout, children\]/);
  assert.match(layout, /node\.props\.href\?\.startsWith\("#"\) && layout\.hidden\.includes\(node\.props\.href\.slice\(1\)\)\) return null/);
  assert.match(layout, /const inNavigation = insideNavigation \|\| node\.props\["data-detail-section"\] === "navigation"/);
  assert.match(layout, /"aria-current": node\.props\.href\.slice\(1\) === activeSection \? "location"/);
  assert.match(layout, /cleanLinks\(child, inNavigation\)/);
  assert.match(layout, /layout\.sections\.indexOf/);
  assert.match(css, /\.detail-nav a\[aria-current="location"\]/);
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

test("city programs reuse the shared card and Info modal without changing the bounded discovery flow", () => {
  assert.match(city, /programs: CityProgramCardData\[\]/);
  assert.match(city, /<CityProgramCards key=\{`\$\{city\.id\}:\$\{lang\}`\} programs=\{city\.programs\} \/>/);
  assert.match(city, /const programsPath = `\$\{localePath\("\/programs"\)\}\?country=\$\{encodeURIComponent\(city\.country\)\}&city=\$\{encodeURIComponent\(city\.name\)\}`/);
  assert.match(city, /<Link href=\{programsPath\}>\{t\("countryDetail.viewAllPrograms"\)\}/);
  assert.match(cityProgramCards, /import \{ PublicProgramCard \}/);
  assert.match(cityProgramCards, /import \{ PublicProgramDetailDialog/);
  assert.match(cityProgramCards, /className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">\{programs\.map/);
  assert.match(cityProgramCards, /onDetails=\{\(\) => setSelected\(/);
  assert.match(cityProgramCards, /onClose=\{\(\) => setSelected\(null\)\}/);
  assert.doesNotMatch(cityProgramCards, /customFetch|\bfetch\(|setLocation|window\.location|PublicProgramFilters|useEffect|<table/);
  assert.doesNotMatch(city, /city\.programs\.map/);
  const html = renderPublicElement(createElement(CityProgramCards, { programs: [{ ...cardFixture, isActive: true, universityIsActive: true }] }));
  assert.match(html, /<button[^>]*aria-label="programs.programDetails"/);
  assert.doesNotMatch(html, /<a[^>]*aria-label="programs.programDetails"/);
  assert.match(html, /<a href="\/en\/programs\/source-program-145792"[^>]*><h3/);
  assert.match(html, /href="\/en\/programs\?programId=145792"/);
});

test("city cards fail closed for missing or closed admissions while retaining program details", () => {
  assert.match(cityProgramCards, /applyDisabled=\{program\.isActive !== true \|\| program\.universityIsActive !== true\}/);
  for (const isActive of [undefined, false, true]) for (const universityIsActive of [undefined, false, true]) {
    const html = renderPublicElement(createElement(CityProgramCards, { programs: [{ ...cardFixture, isActive, universityIsActive }] }));
    const hasApplyLink = html.includes('href="/en/programs?programId=145792"');
    assert.equal(hasApplyLink, isActive === true && universityIsActive === true, `${isActive}/${universityIsActive}`);
    assert.match(html, /<button[^>]*aria-label="programs.programDetails"/);
    assert.match(html, /href="\/en\/programs\/source-program-145792"/);
    if (!hasApplyLink) assert.match(html, /<button[^>]*disabled=""/);
  }
});

test("city cards and modal cannot revive legacy fees or importer timing when authoritative tuition is absent", () => {
  assert.match(cityProgramCards, /displayTuition\(\{ \.\.\.program, tuition: program\.tuition \?\? null \}, lang\)/);
  assert.match(cityProgramCards, /requirements: splitRequirements\(program\.requirements, \{ canonicalPath: program\.canonicalPath, id: program\.id \}\)\.requirements\.join\("\\n"\)/);
  assert.match(cityProgramCards, /omitLegacyTiming tuitionContent=\{price\(program\)\}/);
  assert.match(cityProgramCards, /omitLegacyTiming tuitionContent=\{selected \? price\(selected\) : null\}/);
  assert.match(cityProgramCards, /program=\{selected \? \{ \.\.\.selected, universityPath: selected\.universityPath \?\? "" \} : null\}/);
  for (const tuition of [undefined, null]) {
    const html = renderPublicElement(createElement(CityProgramCards, { programs: [{ ...cardFixture, tuition, applicationFee: 90000, advancedFee: 80000 }] }));
    assert.match(html, /Confirm tuition with an adviser/);
    assert.doesNotMatch(html, /90,000|80,000|50,000|40,000|30,000|20,000|10,000|LEGACY_INTAKE_MUST_NOT_LEAK|courseFinderPage\.(scholarship|depositStrip|languageFee)|% OFF|catalogDetail\.verifiedPrice/);
  }
  const tuition = { amount: 725, currency: "GBP", verified: true, source: "verified" as const, frequency: "YEAR" };
  const verified = renderPublicElement(createElement(CityProgramCards, { programs: [{ ...cardFixture, tuition }] }));
  assert.match(verified, /£725\.00/);
  assert.match(verified, /catalogDetail\.verifiedPrice/);
  assert.doesNotMatch(verified, /50,000|40,000|30,000|20,000|10,000|LEGACY_INTAKE_MUST_NOT_LEAK/);
  const legacy = renderPublicElement(createElement(CityProgramCards, { programs: [{ ...cardFixture, tuition: { ...tuition, verified: false, source: "legacy", frequency: null } }] }));
  assert.match(legacy, /confirmation required/);
  assert.doesNotMatch(legacy, /catalogDetail\.verifiedPrice/);
});

test("cached minimal city rows render no invented institution link, photograph or admission facts", () => {
  const oldRow: CityProgramCardData = { id: 145792, name: "Source program", canonicalPath: "/en/programs/source-program-145792", universityName: "Source institution", degree: null, field: null };
  const html = renderPublicElement(createElement(CityProgramCards, { programs: [oldRow] }));
  assert.match(html, /Source program|Source institution/);
  assert.match(html, /Confirm tuition with an adviser/);
  assert.doesNotMatch(html, /href="[^\"]*universities|href="[^\"]*\?programId=|<img|\bGBP\b|\bUSD\b|£|\$|courseFinderPage\.(degree|field|language|duration)|verifiedPrice/);
  assert.match(html, /<button[^>]*disabled=""/);
  assert.match(cityProgramCards, /universityPath: program\.universityPath \?\? ""/);
  assert.doesNotMatch(cityProgramCards, /universityPath:.*\$\{|logoUrl:.*https|unsplash|placeholder\.com/);
});

test("city program actions stay locale-aware with factual RTL metadata and no client-side sample expansion", () => {
  const rows = Array.from({ length: 12 }, (_, index) => ({ ...cardFixture, id: index + 1, canonicalPath: `/ar/programs/source-program-${index + 1}`, universityPath: "/ar/universities/source-institution-1563", name: `برنامج ${index + 1}`, isActive: true, universityIsActive: true }));
  const html = renderPublicElement(createElement(CityProgramCards, { programs: rows }), "ar");
  assert.equal((html.match(/class="public-program-card /g) ?? []).length, 12);
  assert.equal((html.match(/aria-label="programs\.programDetails"/g) ?? []).length, 12);
  assert.match(html, /href="\/ar\/programs\?programId=1"/);
  assert.match(html, /href="\/ar\/programs\?programId=12"/);
  assert.match(html, /<bdi>برنامج 1<\/bdi>/);
  assert.match(html, /<bdi>12 months<\/bdi>/);
  assert.doesNotMatch(html, /href="\/en\//);
  const empty = renderPublicElement(createElement(CityProgramCards, { programs: [] }));
  assert.doesNotMatch(empty, /public-program-card group|<h3|programs\.programDetails|\?programId=/);
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
