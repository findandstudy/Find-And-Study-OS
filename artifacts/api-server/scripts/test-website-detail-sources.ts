import assert from "node:assert/strict";
import test from "node:test";
import { detailGenerationSources, detailSectionReviewedOn, detailSectionSources } from "../src/lib/websiteDetailSources";

const payload = {
  destination: {
    sourceMetadata: {
      description: { sourceName: "Official destination authority", sourceUrl: "https://example.gov/destination", verifiedAt: "2026-09-10T00:00:00.000Z" },
      climate: { sourceName: "Official weather authority", sourceUrl: "https://weather.example.gov/", verifiedAt: "2026-10-01T00:00:00.000Z" },
      housing: { sourceName: "Official housing authority", sourceUrl: "https://housing.example.gov/" },
      unsafe: { sourceName: "Unsafe", sourceUrl: "javascript:alert(1)" },
    },
  },
};

test("generation facts retain only bounded public catalogue sources", () => {
  const sources = detailGenerationSources("destination", payload);
  assert.equal(sources.length, 3);
  assert.deepEqual(sources.map(source => source.field), ["description", "climate", "housing"]);
  assert.equal(sources[0].sourceUrl, "https://example.gov/destination");
});

test("sections receive field-relevant official sources with a safe fallback", () => {
  const sources = detailGenerationSources("destination", payload);
  assert.deepEqual(detailSectionSources("climate", sources), [{ label: "Official weather authority", url: "https://weather.example.gov/" }]);
  assert.deepEqual(detailSectionSources("overview", sources), [{ label: "Official destination authority", url: "https://example.gov/destination" }]);
  assert.deepEqual(detailSectionSources("recognition", sources), [{ label: "Official destination authority", url: "https://example.gov/destination" }]);
});

test("section review date follows its linked source verification date", () => {
  const sources = detailGenerationSources("destination", payload);
  assert.equal(detailSectionReviewedOn("climate", sources, "2026-10-28"), "2026-10-01");
  assert.equal(detailSectionReviewedOn("housing", sources, "2026-10-28"), "2026-10-28");
});
