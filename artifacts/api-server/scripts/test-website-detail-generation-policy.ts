import assert from "node:assert/strict";
import test from "node:test";
import { buildDetailGenerationPlan, evaluateDetailContentQuality } from "../src/lib/websiteDetailGenerationPolicy";
import { buildAutomaticEnglishDetailSeo } from "../src/lib/websiteDetailSeo";
import type { DetailContent } from "../src/lib/websiteDetailContentContract";

const section = (key: string) => ({ key, title: key, templateBody: "", instruction: `Write the ${key} section for a student.` });

test("automatic SEO keeps complete titles and descriptions without literal ellipses", () => {
  const seo = buildAutomaticEnglishDetailSeo("university", {
    name: "Acıbadem Mehmet Ali Aydınlar University",
    description: "Acıbadem Mehmet Ali Aydınlar University brings together health sciences, medicine, engineering and social sciences in Istanbul, with study options that prospective international students can compare by level, language and admissions route before creating a shortlist.",
    universityName: null,
    city: "Istanbul",
    country: "Türkiye",
  });
  assert.ok(seo.title.length <= 60 || seo.title === "Acıbadem Mehmet Ali Aydınlar University");
  assert.ok(seo.description.length <= 160);
  assert.doesNotMatch(`${seo.title}\n${seo.description}`, /…|\.\.\./u);
});

test("automatic programme SEO remains concise and decision-oriented", () => {
  const seo = buildAutomaticEnglishDetailSeo("program", {
    name: "Associate of Anesthesia (Turkish)",
    description: null,
    universityName: "Acıbadem Mehmet Ali Aydınlar University",
    city: "Istanbul",
    country: "Türkiye",
  });
  assert.ok(seo.title.length <= 60);
  assert.ok(seo.description.length >= 90 && seo.description.length <= 160);
  assert.doesNotMatch(`${seo.title}\n${seo.description}`, /…|\.\.\./u);
});

test("country SEO leads with destination decisions instead of catalogue promotion", () => {
  const seo = buildAutomaticEnglishDetailSeo("destination", {
    name: "Turkey",
    description: null,
    universityName: null,
    city: null,
    country: "Turkey",
  });
  assert.equal(
    seo.title,
    "Study in Turkey: Cities, Costs & Student Life | Find & Study",
  );
  assert.match(
    seo.description,
    /^Explore cities, daily life, climate, housing, transport and study planning in Turkey/,
  );
  assert.doesNotMatch(
    `${seo.title} ${seo.description}`,
    /compare universities|universities & admissions/i,
  );
});

test("planner keeps section identities separate and skips unsupported optional topics", () => {
  const plan = buildDetailGenerationPlan({
    kind: "city",
    entityName: "Example City",
    facts: {
      city: "Example City",
      country: "Example Country",
      transportModes: ["Metro", "Tram"],
      campusGeography: "Campuses are distributed across two central districts.",
      universities: [{ name: "North University" }, { name: "South University" }],
      programs: [{ name: "Engineering", university: "North University" }],
      officialSources: [{ field: "transportModes", sourceName: "City authority", sourceUrl: "https://example.test/transport" }],
    },
    sections: [section("hero"), section("transport"), section("climate"), section("housing")],
  });
  assert.deepEqual(plan.sections.map(item => item.key), ["hero", "transport"]);
  assert.deepEqual(plan.skippedSections.map(item => item.key), ["climate", "housing"]);
  assert.equal(new Set(plan.sections.map(item => item.key)).size, plan.sections.length);
  assert.ok(plan.sections.find(item => item.key === "transport")?.evidenceKeys.includes("transportModes"));
});

test("country planner caps named catalogue examples and keeps them out of the hero", () => {
  const plan = buildDetailGenerationPlan({
    kind: "destination",
    entityName: "Example Country",
    facts: {
      destination: "Example Country",
      description: "A verified education destination description for international students.",
      universities: [{ name: "Alpha University" }, { name: "Beta University" }, { name: "Gamma University" }],
      programs: [{ name: "Architecture", university: "Alpha University" }, { name: "Nursing", university: "Beta University" }],
      officialSources: [{ field: "description", sourceName: "Official portal", sourceUrl: "https://example.test/study" }],
    },
    sections: [section("hero"), section("overview"), section("highlights"), section("education")],
  });
  assert.equal(plan.sections.length, 4);
  assert.deepEqual(plan.sections.find(item => item.key === "hero")?.allocatedEntities, []);
  assert.deepEqual(plan.sections.find(item => item.key === "overview")?.allocatedEntities, []);
  assert.equal(plan.sections.flatMap(item => item.allocatedEntities).length, 2);
  assert.match(plan.pageRules.join(" "), /do not repeat/i);
  assert.deepEqual(plan.catalogEntities.universities.sort(), ["Alpha University", "Beta University", "Gamma University"].sort());
  assert.ok(plan.catalogEntities.programs.includes("Architecture"));
  assert.match(plan.pageRules.join(" "), /only from the system catalogue/i);
  assert.match(plan.pageRules.join(" "), /must not narrate university or programme totals/i);
  assert.match(plan.pageRules.join(" "), /about 65% destination/i);
});

test("planner routes source-sheet topics to matching structured sections", () => {
  const plan = buildDetailGenerationPlan({
    kind: "destination",
    entityName: "Example Country",
    facts: {
      destination: "Example Country",
      description: "Verified destination context.",
      officialSources: [{ field: "countryGuide", sourceName: "Verified sheet", sourceUrl: "https://example.test/sheet" }],
      sourceTopics: [
        { topicTitle: "Country overview", verifiedContent: "The destination has several distinct student-city settings." },
        { topicTitle: "Admission process", verifiedContent: "Applications follow institution-published document and calendar rules." },
        { topicTitle: "Scholarships and funding", verifiedContent: "Funding terms vary by institution and intake." },
      ],
    },
    sections: [section("overview"), section("admission"), section("scholarships")],
  });
  assert.equal(plan.sections.find(item => item.key === "overview")?.contentShape, "cards");
  assert.deepEqual(plan.sections.find(item => item.key === "overview")?.allocatedSourceTopicTitles, ["Country overview"]);
  assert.deepEqual(plan.sections.find(item => item.key === "admission")?.allocatedSourceTopicTitles, ["Admission process"]);
  assert.deepEqual(plan.sections.find(item => item.key === "scholarships")?.allocatedSourceTopicTitles, ["Scholarships and funding"]);
});

test("country quality gate blocks catalogue-led hero and excessive named examples", () => {
  const plan = buildDetailGenerationPlan({
    kind: "destination", entityName: "Example Country",
    facts: {
      destination: "Example Country", description: "Verified destination context.",
      universities: [{ name: "Alpha University" }, { name: "Beta University" }],
      programs: [{ name: "Architecture" }, { name: "Nursing" }],
      officialSources: [{ field: "description" }],
    },
    sections: [section("hero"), section("highlights"), section("education")],
  });
  const content: DetailContent = {
    version: 1, kind: "destination", entityId: 9, locale: "en", seoMode: "auto",
    seo: { title: "Study in Example Country", description: "Compare education and student life in Example Country." },
    sections: [
      { key: "hero", title: "Study in Example Country", body: "Alpha University leads a catalogue-focused introduction rather than a country value proposition for international students planning their destination.", sources: [], reviewedOn: null },
      { key: "highlights", title: "Country choices", body: "Beta University and Architecture are presented as additional named examples in a page that should primarily explain the country-level study experience and practical decisions.", sources: [], reviewedOn: null },
      { key: "education", title: "Education structure", body: "Nursing becomes a fourth named example rather than a concise explanation of the national education structure, admissions context and student choices.", sources: [], reviewedOn: null },
    ],
  };
  const quality = evaluateDetailContentQuality({ content, plan });
  assert.equal(quality.status, "blocked");
  assert.ok(quality.issues.some(issue => issue.code === "DESTINATION_HERO_CATALOG_ENTITY"));
  assert.ok(quality.issues.some(issue => issue.code === "DESTINATION_CATALOG_DOMINANCE"));
});

test("country quality gate rejects changing catalogue totals in hero copy", () => {
  const plan = buildDetailGenerationPlan({
    kind: "destination",
    entityName: "Example Country",
    facts: {
      destination: "Example Country",
      description: "A verified destination description for international students.",
      officialSources: [{ field: "description", sourceName: "Official portal", sourceUrl: "https://example.test/study" }],
    },
    sections: [section("hero")],
  });
  const content: DetailContent = {
    version: 1,
    kind: "destination",
    entityId: 9,
    locale: "en",
    seoMode: "auto",
    seo: { title: "Study in Example Country", description: "Compare study routes and student life in Example Country." },
    sections: [{
      key: "hero",
      title: "Study in Example Country",
      body: "12 universities and 80 programmes provide a changing inventory summary instead of a durable, evidence-bound reason for students to compare this destination carefully.",
      sources: [],
      reviewedOn: "2026-01-01",
    }],
  };
  const quality = evaluateDetailContentQuality({ content, plan });
  assert.equal(quality.status, "blocked");
  assert.ok(quality.issues.some(issue => issue.code === "DESTINATION_HERO_LIVE_COUNTER"));
});

test("country quality gate reviews shallow copy when the evidence plan is rich", () => {
  const keys = ["hero", "overview", "education", "admission", "scholarships", "visa", "living", "housing"];
  const plan = buildDetailGenerationPlan({
    kind: "destination",
    entityName: "Example Country",
    facts: {
      destination: "Example Country",
      description: "A verified destination description with enough source context for international students.",
      programs: [{ name: "Verified Programme", degree: "Bachelor", language: "English" }],
      requirements: "Verified entry guidance",
      scholarship: "Verified funding guidance",
      housingSummary: "Verified housing guidance",
      housingFormats: ["Residence"],
      officialSources: keys.map(field => ({ field, sourceName: "Official portal", sourceUrl: `https://example.test/${field}` })),
    },
    sections: keys.map(section),
  });
  const content: DetailContent = {
    version: 1,
    kind: "destination",
    entityId: 9,
    locale: "en",
    seoMode: "auto",
    seo: { title: "Study in Example Country", description: "Compare study routes and student life in Example Country." },
    sections: plan.sections.map(item => ({ key: item.key, title: `Plan ${item.key}`, body: "Short generic guidance that does not yet support a real student decision.", sources: [{ label: "Official", url: "https://example.test" }], reviewedOn: "2026-01-01" })),
  };
  const quality = evaluateDetailContentQuality({ content, plan });
  assert.ok(quality.issues.some(issue => issue.code === "THIN_DESTINATION_DECISION_SUPPORT"));
});

test("quality gate blocks named universities and programmes outside the system catalogue", () => {
  const plan = buildDetailGenerationPlan({
    kind: "city",
    entityName: "Example City",
    facts: {
      city: "Example City",
      universities: [{ name: "Known University" }],
      programs: [{ name: "Associate of Nursing", degree: "Associate", university: "Known University" }],
      officialSources: [{ field: "description", sourceName: "Official city guide", sourceUrl: "https://example.test" }],
    },
    sections: [section("overview")],
  });
  const base: DetailContent = {
    version: 1, kind: "city", entityId: 1, locale: "en", seoMode: "auto",
    seo: { title: "Example City | Find & Study", description: "A useful city guide.", ogTitle: "Example City", ogDescription: "Guide", twitterTitle: "Example City", twitterDescription: "Guide" },
    sections: [{ key: "overview", title: "Choose with verified facts", body: "Known University offers the Associate of Nursing. Imaginary University also offers the Bachelor of Invented Studies.", sources: [], reviewedOn: "2026-01-01" }],
  };
  const quality = evaluateDetailContentQuality({ content: base, plan });
  assert.equal(quality.status, "blocked");
  assert.ok(quality.issues.some(issue => issue.code === "OUT_OF_CATALOG_NAMED_ENTITY"));
  const allowed = evaluateDetailContentQuality({
    content: { ...base, sections: [{ ...base.sections[0]!, body: "Known University offers the Associate of Nursing as a verified system-catalogue option for students comparing this city." }] },
    plan,
  });
  assert.equal(allowed.issues.some(issue => issue.code === "OUT_OF_CATALOG_NAMED_ENTITY"), false);
});

test("quality gate blocks internal wording and highly repeated section copy", () => {
  const plan = buildDetailGenerationPlan({
    kind: "city",
    entityName: "Example City",
    facts: { city: "Example City", description: "Verified city description", officialSources: [{ field: "description" }] },
    sections: [section("overview"), section("highlights")],
  });
  const repeated = "Students should compare the exact campus location and check directly with the institution before deciding. This connected source record is useful for planning the next step.";
  const content: DetailContent = {
    version: 1,
    kind: "city",
    entityId: 1,
    locale: "en",
    seoMode: "auto",
    seo: { title: "Example City | Find & Study", description: "A useful city guide.", ogTitle: "Example City", ogDescription: "A useful city guide.", twitterTitle: "Example City", twitterDescription: "A useful city guide." },
    sections: [
      { key: "overview", title: "Overview", body: repeated, sources: [{ label: "Official", url: "https://example.test" }], reviewedOn: "2026-01-01" },
      { key: "highlights", title: "Highlights", body: repeated, sources: [{ label: "Official", url: "https://example.test" }], reviewedOn: "2026-01-01" },
    ],
  };
  const quality = evaluateDetailContentQuality({ content, plan });
  assert.equal(quality.status, "blocked");
  assert.ok(quality.issues.some(issue => issue.code === "INTERNAL_WORDING"));
  assert.ok(quality.issues.some(issue => issue.code === "REPEATED_SECTION_COPY"));
});

test("localized quality gate catches untranslated interface and weather phrases", () => {
  const plan = buildDetailGenerationPlan({
    kind: "city",
    entityName: "İzmir",
    facts: { city: "İzmir", transportModes: ["Metro"], climateSummary: "Mediterranean climate", officialSources: [{ field: "transportModes" }, { field: "climateSummary" }] },
    sections: [section("transport"), section("climate")],
  });
  const content: DetailContent = {
    version: 1,
    kind: "city",
    entityId: 95,
    locale: "tr",
    seoMode: "auto",
    seo: { title: "İzmir'de Eğitim | Find & Study", description: "İzmir'deki eğitim, ulaşım ve öğrenci yaşamını keşfedin.", ogTitle: "İzmir'de Eğitim", ogDescription: "İzmir rehberi", twitterTitle: "İzmir'de Eğitim", twitterDescription: "İzmir rehberi" },
    sections: [
      { key: "transport", title: "Transport", body: "Transport ve campus bağlantılarını günlük ulaşım süresine göre değerlendirin.", sources: [{ label: "Belediye", url: "https://example.test" }], reviewedOn: "2026-01-01" },
      { key: "climate", title: "Hava", body: "Güncel görünüm broken clouds olduğunda mevsim normallerini ayrıca değerlendirin.", sources: [{ label: "Meteoroloji", url: "https://example.test" }], reviewedOn: "2026-01-01" },
    ],
  };
  const quality = evaluateDetailContentQuality({ content, plan });
  assert.equal(quality.languageStatus, "review");
  assert.ok(quality.issues.some(issue => issue.code === "SOURCE_LANGUAGE_LEAKAGE"));
});

test("quality gate blocks literal SEO truncation and material content loss", () => {
  const plan = buildDetailGenerationPlan({
    kind: "university",
    entityName: "Example International University",
    facts: {
      university: "Example International University",
      description: "A verified institutional description with enough context for prospective students.",
      officialSources: [{ field: "description" }],
    },
    sections: [section("hero"), section("overview")],
  });
  const previous: DetailContent = {
    version: 1, kind: "university", entityId: 7, locale: "en", seoMode: "auto",
    seo: { title: "Example University Study Guide", description: "A complete guide to study options and admissions.", ogTitle: "Example University", ogDescription: "Guide", twitterTitle: "Example University", twitterDescription: "Guide" },
    sections: [
      { key: "hero", title: "Example International University", body: "A focused institutional introduction that explains the academic setting, location and the most useful decision points for international applicants in enough detail to support a realistic shortlist.", sources: [{ label: "Official", url: "https://example.test" }], reviewedOn: "2026-01-01" },
      { key: "overview", title: "Choose your route with context", body: "A long and useful overview that explains academic breadth, teaching context, location, planning choices and meaningful trade-offs for prospective international students. It preserves enough detail to help the reader compare this institution with alternatives instead of merely repeating a programme count or a generic invitation to explore the page.", sources: [{ label: "Official", url: "https://example.test" }], reviewedOn: "2026-01-01" },
    ],
  };
  const content: DetailContent = {
    ...previous,
    seo: { ...previous.seo!, title: "Example International Univer… | Find & Study" },
    sections: previous.sections.map(item => item.key === "overview" ? { ...item, body: "A short generic summary." } : item),
  };
  const quality = evaluateDetailContentQuality({ content, plan, previous });
  assert.equal(quality.status, "blocked");
  assert.ok(quality.issues.some(issue => issue.code === "SEO_LITERAL_ELLIPSIS"));
  assert.ok(quality.issues.some(issue => issue.code === "EXCESSIVE_CONTENT_LOSS"));
});

test("quality gate counts structured items when checking regeneration content loss", () => {
  const plan = buildDetailGenerationPlan({
    kind: "destination",
    entityName: "Example Country",
    facts: {
      destination: "Example Country",
      description: "Verified destination context.",
      officialSources: [{ field: "countryGuide" }],
      sourceTopics: [{ topicTitle: "Country overview", verifiedContent: "Verified planning evidence for the destination." }],
    },
    sections: [section("overview")],
  });
  const previous: DetailContent = {
    version: 1, kind: "destination", entityId: 9, locale: "en", seoMode: "auto",
    seo: { title: "Study in Example Country | Find & Study", description: "Compare study routes and practical planning in Example Country.", ogTitle: "Study in Example Country", ogDescription: "Guide", twitterTitle: "Study in Example Country", twitterDescription: "Guide" },
    sections: [{
      key: "overview", title: "Build a realistic country shortlist",
      body: "This established overview contains enough verified destination context to explain study planning, location choice, student support and the practical comparisons a prospective international student should make before creating a shortlist for the country.",
      sources: [{ label: "Verified", url: "https://example.test" }], reviewedOn: "2026-01-01",
    }],
  };
  const content: DetailContent = {
    ...previous,
    sections: [{
      ...previous.sections[0]!,
      body: "Use these verified planning points to compare the destination.",
      cards: [
        { title: "Compare study settings", body: "Verified source evidence distinguishes the destination's different student-city settings and explains why location should shape the shortlist." },
        { title: "Plan the application route", body: "Published institutional calendars and document requirements remain the authoritative basis for each application." },
        { title: "Budget with evidence", body: "Funding and living-cost conditions vary, so students should compare the verified terms relevant to their chosen route." },
      ],
    }],
  };
  const quality = evaluateDetailContentQuality({ content, plan, previous });
  assert.ok(!quality.issues.some(issue => issue.code === "EXCESSIVE_CONTENT_LOSS"));
});

test("quality gate reviews pages dominated by generic editorial headings", () => {
  const plan = buildDetailGenerationPlan({
    kind: "destination",
    entityName: "Example Country",
    facts: { destination: "Example Country", description: "Verified destination context.", officialSources: [{ field: "description" }] },
    sections: [section("hero"), section("overview"), section("highlights")],
  });
  const content: DetailContent = {
    version: 1, kind: "destination", entityId: 9, locale: "en", seoMode: "auto",
    seo: { title: "Study in Example Country | Find & Study", description: "Compare study routes and student life in Example Country.", ogTitle: "Study in Example Country", ogDescription: "Guide", twitterTitle: "Study in Example Country", twitterDescription: "Guide" },
    sections: [
      { key: "hero", title: "Example Country", body: "Example Country offers a verified study setting whose institutions, destinations and practical planning factors can be compared through the evidence on this page.", sources: [{ label: "Official", url: "https://example.test" }], reviewedOn: "2026-01-01" },
      { key: "overview", title: "Overview", body: "A sufficiently detailed overview explains the education setting and the decisions an international student should compare before creating a shortlist for this destination.", sources: [{ label: "Official", url: "https://example.test" }], reviewedOn: "2026-01-01" },
      { key: "highlights", title: "Highlights", body: "A sufficiently detailed highlights section explains distinct strengths and connects them to programme choice, location and student planning without relying on unsupported claims.", sources: [{ label: "Official", url: "https://example.test" }], reviewedOn: "2026-01-01" },
    ],
  };
  const quality = evaluateDetailContentQuality({ content, plan });
  assert.ok(quality.issues.some(issue => issue.code === "GENERIC_SECTION_TITLES"));
});

test("programme quality gate reviews thin decision support and repetitive heading openings", () => {
  const plan = buildDetailGenerationPlan({
    kind: "program",
    entityName: "Example Programme",
    facts: {
      program: "Example Programme", university: "Example University", degree: "Bachelor", field: "Engineering", language: "English",
      description: "A verified programme overview.", requirements: "A verified entry route.",
      officialSources: [{ field: "description" }, { field: "field" }, { field: "requirements" }],
    },
    sections: [section("overview"), section("academics"), section("requirements")],
  });
  const content: DetailContent = {
    version: 1, kind: "program", entityId: 10, locale: "en", seoMode: "auto",
    seo: { title: "Example Programme | Find & Study", description: "Compare the Example Programme, its academic fit, entry route and practical study planning details.", ogTitle: "Example Programme", ogDescription: "Programme guide", twitterTitle: "Example Programme", twitterDescription: "Programme guide" },
    sections: [
      { key: "overview", title: "Compare the course", body: "A short overview.", sources: [], reviewedOn: null },
      { key: "academics", title: "Compare the curriculum", body: "A short curriculum note.", sources: [], reviewedOn: null },
      { key: "requirements", title: "Compare entry routes", body: "A short entry note.", sources: [], reviewedOn: null },
    ],
  };
  const quality = evaluateDetailContentQuality({ content, plan });
  assert.ok(quality.issues.some(issue => issue.code === "REPETITIVE_HEADING_OPENINGS"));
  assert.ok(quality.issues.some(issue => issue.code === "THIN_PROGRAM_DECISION_SUPPORT"));
});

test("quality gate blocks source-backed box sections that contain prose but no structured items", () => {
  const plan = buildDetailGenerationPlan({
    kind: "city",
    entityName: "Example City",
    facts: {
      city: "Example City",
      description: "Verified city context for prospective students.",
      teachingLanguages: ["English"],
      officialSources: [{ field: "highlights" }, { field: "description" }],
    },
    sections: [section("highlights")],
  });
  assert.equal(plan.sections[0]?.contentShape, "cards");
  const content: DetailContent = {
    version: 1, kind: "city", entityId: 11, locale: "en", seoMode: "auto",
    seo: { title: "Study in Example City | Find & Study", description: "Compare student life and study planning in Example City.", ogTitle: "Study in Example City", ogDescription: "City guide", twitterTitle: "Study in Example City", twitterDescription: "City guide" },
    sections: [{
      key: "highlights", title: "Plan around the verified setting",
      body: "This source-backed introduction is long enough to explain the verified teaching context and its practical importance to an international student's shortlist, but it intentionally contains no cards so the structured-content quality gate can detect the incomplete generation result.",
      sources: [{ label: "Official", url: "https://example.test" }], reviewedOn: "2026-01-01",
    }],
  };
  const quality = evaluateDetailContentQuality({ content, plan });
  assert.equal(quality.status, "blocked");
  assert.ok(quality.issues.some(issue => issue.code === "MISSING_SOURCE_STRUCTURED_CONTENT"));
});
