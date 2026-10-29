import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DETAIL_CONTENT_LAYOUT_KEYS, detailContentPresentationOverrides, ensureDetailSeo, inheritEnglishDetailStructure, parseDetailContent, preserveDetailSectionDesign, safeDetailContentUrl } from "../src/lib/websiteDetailContentContract";
const fixture = () => ({ version: 1, kind: "program", entityId: 7, locale: "en", sections: [{ key: "faq", title: "Questions", questions: [{ question: "How?", answer: "Contact the institution." }], sources: [{ label: "Institution", url: "https://example.org/info" }], reviewedOn: "2026-09-01" }] });
test("editorial mirrors and valid human-reviewed structured content", () => {
  assert.ok(parseDetailContent(fixture(), "2026-09-19"));
  assert.equal(readFileSync(new URL("../src/lib/websiteDetailContentContract.ts", import.meta.url), "utf8"), readFileSync(new URL("../../edcons/src/lib/website/detailContentContract.ts", import.meta.url), "utf8"));
});
test("dynamic SEO is generated from locale-owned content and remains page-owned", () => {
  const content = ensureDetailSeo({ ...fixture(), locale: "tr", sections: [{ ...fixture().sections[0], key: "hero", title: "İstanbul'da Eğitim", body: "İstanbul'daki üniversiteleri, programları ve öğrenci yaşamını ayrıntılı biçimde keşfedin." }] } as any);
  assert.equal(content.seo?.title, "İstanbul'da Eğitim | Find & Study");
  assert.match(content.seo?.description || "", /üniversiteleri/);
  assert.ok(parseDetailContent(content, "2026-09-19"));
  assert.equal(parseDetailContent({ ...content, seo: { ...content.seo, title: "<bad>" } }, "2026-09-19"), null);
});
test("automatic dynamic SEO uses catalogue relationships and localized values remain stable until explicit regeneration", () => {
  const base = parseDetailContent({ version: 1, kind: "program", entityId: 7, locale: "en", sections: [{ key: "hero", title: "Computer Science", body: "Build a strong foundation for international study and career planning.", sources: [{ label: "Source", url: "https://example.com" }], reviewedOn: "2026-09-01" }] }, "2026-09-19")!;
  const automatic = ensureDetailSeo(base, { program: "Computer Science", university: "Acıbadem University", city: "Istanbul", country: "Türkiye" });
  assert.equal(automatic.seoMode, "auto");
  assert.match(automatic.seo!.title, /Computer Science.*Acıbadem University/);
  const localized = ensureDetailSeo({ ...automatic, locale: "tr", seo: { ...automatic.seo!, title: "Londra'da Eğitim | Find & Study", description: "Londra'daki eğitim seçeneklerini karşılaştırın.", ogTitle: "Londra'da Eğitim | Find & Study", ogDescription: "Londra'daki eğitim seçeneklerini karşılaştırın.", twitterTitle: "Londra'da Eğitim | Find & Study", twitterDescription: "Londra'daki eğitim seçeneklerini karşılaştırın." } }, { city: "London", country: "United Kingdom" });
  assert.equal(localized.seo!.title, "Londra'da Eğitim | Find & Study");
  const refreshed = ensureDetailSeo({ ...automatic, seo: undefined, sections: automatic.sections.map(section => ({ ...section, title: "Data Science" })) }, { program: "Data Science", university: "Acıbadem University" });
  assert.match(refreshed.seo!.title, /Data Science/);
  const manual = ensureDetailSeo({ ...refreshed, seoMode: "manual", seo: { ...refreshed.seo!, title: "Curated title" } }, { program: "Changed" });
  assert.equal(manual.seo!.title, "Curated title");
});
test("editorial rejects identity/coercion/unknown fact keys and duplicate sections", () => {
  for (const patch of [{ entityId: "7" }, { locale: "EN" }, { tuition: 500 }, { kind: ["program"] }, { sections: [{ ...fixture().sections[0], key: ["faq"] }] }, { sections: [...fixture().sections, ...fixture().sections] }]) assert.equal(parseDetailContent({ ...fixture(), ...patch }), null);
});
test("editorial requires provenance and bounded safe text/media/date", () => {
  for (const patch of [{ sources: [] }, { reviewedOn: "2999-01-01" }, { reviewedOn: "2026-02-30" }, { title: "<script>x</script>" }, { body: "x".repeat(6001) }, { images: [{ src: "javascript:alert(1)", alt: "Image" }] }, { table: { columns: ["A"], rows: [["A", "B"]] } }]) assert.equal(parseDetailContent({ ...fixture(), sections: [{ ...fixture().sections[0], ...patch }] }), null);
  for (const url of ["javascript:alert(1)", "//evil.test", "https://user:pass@example.org", "/../private", "data:image/svg+xml,x", "#", "#bad anchor", "#1-invalid"]) assert.equal(safeDetailContentUrl(url), false);
  assert.equal(safeDetailContentUrl("/uploads/public/example.jpg"), true);
  assert.equal(safeDetailContentUrl("#editorial-climate"), true);
  assert.equal(safeDetailContentUrl("#overview"), true);
  assert.equal(safeDetailContentUrl("#overview", true), false);
  assert.equal(parseDetailContent({ ...fixture(), sections: [] })?.sections.length, 0);
});
test("page presentation overrides are bounded and map editorial keys to layout keys", () => {
  const parsed = parseDetailContent({ ...fixture(), sections: [{ ...fixture().sections[0], presentation: { tone: "sand", width: "full", backgroundColor: "#f0f0f0", backgroundImageUrl: "https://example.org/image.jpg", overlayColor: "#000000", overlayOpacity: 25 } }] }, "2026-09-19");
  assert.ok(parsed);
  assert.deepEqual(detailContentPresentationOverrides(parsed), { "editorial-faq": parsed.sections[0].presentation });
  assert.equal(parseDetailContent({ ...fixture(), sections: [{ ...fixture().sections[0], presentation: { backgroundColor: "white" } }] }, "2026-09-19"), null);
  assert.equal(parseDetailContent({ ...fixture(), sections: [{ ...fixture().sections[0], presentation: { backgroundImageUrl: "data:image/svg+xml,x" } }] }, "2026-09-19"), null);
});
test("translated detail content inherits English structure without English copy", () => {
  const english = { ...fixture(), sectionOrder: [...DETAIL_CONTENT_LAYOUT_KEYS.program], sections: [{ ...fixture().sections[0], title: "English title", body: "English body", hero: { eyebrow: "English eyebrow", backgroundColor: "#112233", overlayOpacity: 45 }, presentation: { tone: "sand", width: "full" } }] };
  const localized = { ...fixture(), locale: "tr", sections: [{ ...fixture().sections[0], title: "Türkçe başlık", body: "Türkçe gövde", hero: { eyebrow: "Türkçe üst başlık", backgroundColor: "#ffffff" } }] };
  const result = inheritEnglishDetailStructure(localized as any, english as any);
  assert.deepEqual(result.sectionOrder, english.sectionOrder);
  assert.equal(result.sections[0].title, "Türkçe başlık");
  assert.equal(result.sections[0].body, "Türkçe gövde");
  assert.equal(result.sections[0].hero?.eyebrow, "Türkçe üst başlık");
  assert.equal(result.sections[0].hero?.backgroundColor, "#112233");
  assert.equal(result.sections[0].hero?.overlayOpacity, 45);
  assert.deepEqual(result.sections[0].presentation, english.sections[0].presentation);
});
test("AI copy regeneration preserves the existing section design", () => {
  const generated = { ...fixture().sections[0], title: "Generated title", body: "Generated body" };
  const existing = {
    ...fixture().sections[0],
    title: "Old title",
    body: "Old body",
    presentation: { tone: "sand", width: "full" },
    cards: [{ title: "Card", body: "Card body" }],
    table: { columns: ["Item"], rows: [["Value"]] },
    steps: [{ title: "Step", body: "Step body" }],
    images: [{ src: "https://example.org/image.jpg", alt: "Image" }],
    questions: [{ question: "Question?", answer: "Answer." }],
  };
  const result = preserveDetailSectionDesign(generated as any, existing as any);
  assert.equal(result.title, "Generated title");
  assert.equal(result.body, "Generated body");
  assert.deepEqual(result.presentation, existing.presentation);
  assert.deepEqual(result.cards, existing.cards);
  assert.deepEqual(result.table, existing.table);
  assert.deepEqual(result.steps, existing.steps);
  assert.deepEqual(result.images, existing.images);
  assert.deepEqual(result.questions, existing.questions);
});
test("page-level section order is a complete bounded permutation with fixed structural sections", () => {
  const sectionOrder = [...DETAIL_CONTENT_LAYOUT_KEYS.program];
  [sectionOrder[3], sectionOrder[4]] = [sectionOrder[4], sectionOrder[3]];
  assert.deepEqual(parseDetailContent({ ...fixture(), sectionOrder }, "2026-09-19")?.sectionOrder, sectionOrder);
  assert.equal(parseDetailContent({ ...fixture(), sectionOrder: sectionOrder.slice(1) }), null);
  assert.equal(parseDetailContent({ ...fixture(), sectionOrder: ["navigation", "hero", ...sectionOrder.slice(2)] }), null);
  assert.equal(parseDetailContent({ ...fixture(), sectionOrder: [...sectionOrder.slice(0, -1), "unknown"] }), null);
});
