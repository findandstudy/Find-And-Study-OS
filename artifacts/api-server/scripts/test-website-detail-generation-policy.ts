import assert from "node:assert/strict";
import test from "node:test";
import { buildDetailGenerationPlan, evaluateDetailContentQuality } from "../src/lib/websiteDetailGenerationPolicy";
import type { DetailContent } from "../src/lib/websiteDetailContentContract";

const section = (key: string) => ({ key, title: key, templateBody: "", instruction: `Write the ${key} section for a student.` });

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

test("planner rotates named entities instead of making one institution the default example", () => {
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
    sections: [section("overview"), section("highlights"), section("education")],
  });
  assert.equal(plan.sections.length, 3);
  assert.notDeepEqual(plan.sections[0]?.allocatedEntities, plan.sections[1]?.allocatedEntities);
  assert.match(plan.pageRules.join(" "), /do not repeat/i);
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
