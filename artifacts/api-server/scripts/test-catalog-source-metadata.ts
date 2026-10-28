import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCatalogSourceMetadata, normalizeCatalogSourceMetadataFromRow, omitCatalogSourceMetadata, publicCatalogSources } from "../src/lib/catalogSourceMetadata";

test("normalizes field sources and rejects unsafe evidence", () => {
  const result = normalizeCatalogSourceMetadata("program", { tuitionFee: { sourceName: " Official fee schedule ", sourceUrl: "https://example.edu/fees", verifiedAt: "2026-10-01", validUntil: "2027-09-30", notes: "internal" } });
  assert.equal(result.tuitionFee.sourceName, "Official fee schedule");
  assert.equal(result.tuitionFee.sourceUrl, "https://example.edu/fees");
  assert.throws(() => normalizeCatalogSourceMetadata("city", { name: { sourceUrl: "javascript:alert(1)" } }), /public http/);
  assert.throws(() => normalizeCatalogSourceMetadata("country", { tuitionFee: { sourceName: "x" } }), /Unsupported source field/);
});

test("round-trips readable import columns", () => {
  const result = normalizeCatalogSourceMetadataFromRow("city", {
    "Source · Climate [climate] · Source / institution": "Meteorological authority",
    "Source · Climate [climate] · Source URL": "https://weather.example/evidence",
    "Source · Climate [climate] · Last verified": "2026-10-01",
  });
  assert.equal(result.climate.sourceName, "Meteorological authority");
  assert.equal(result.climate.sourceUrl, "https://weather.example/evidence");
});

test("keeps internal notes out of public/editor generation context", () => {
  const metadata = { climate: { sourceName: "Official", sourceUrl: "https://weather.example", verifiedAt: "2026-10-01", notes: "private reviewer note" } };
  assert.deepEqual(omitCatalogSourceMetadata({ id: 1, sourceMetadata: metadata }), { id: 1 });
  assert.deepEqual(publicCatalogSources(metadata), { climate: { sourceName: "Official", sourceUrl: "https://weather.example", verifiedAt: "2026-10-01", validUntil: undefined } });
});
