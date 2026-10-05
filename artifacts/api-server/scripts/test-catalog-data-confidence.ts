import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  CATALOG_DATA_CONFIDENCE_LIMIT,
  readCatalogDataConfidence,
} from "../src/lib/catalogDataConfidenceReadModel";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("projects verified source, missing facts and bounded impact without writes", async () => {
  let sqlText = "";
  let parameters: unknown[] = [];
  const response = await readCatalogDataConfidence({
    async query(text: string, values?: unknown[]) {
      sqlText = text;
      parameters = values ?? [];
      return {
        rows: [{
          id: 7, name: "Nursing", university_id: 3, university_name: "Example University",
          country: "Türkiye", city: "Istanbul", confidence: "partial",
          price_verified_at: new Date("2026-09-20T10:00:00Z"), price_expires_at: null,
          price_source_name: "Official fees", price_source_url: "https://example.edu/fees",
          intake_verified_at: null, intake_expires_at: null, intake_source_name: null,
          intake_source_url: null, active_intakes: 0, dated_intakes: 0,
          active_applications: 4, total_programs: 230, verified_programs: 20,
          partial_programs: 80, missing_programs: 130, missing_tuition: 150,
          missing_intake: 130, missing_deadline: 30,
        }],
      } as never;
    },
  });
  assert.deepEqual(parameters, [CATALOG_DATA_CONFIDENCE_LIMIT]);
  assert.match(sqlText, /LIMIT \$1/);
  assert.match(sqlText, /record\.status = 'VERIFIED'/);
  assert.match(sqlText, /applications[\s\S]*deleted_at IS NULL/);
  assert.equal(response.mode, "read_only");
  assert.equal(response.summary.truncated, true);
  assert.deepEqual(response.data[0]?.missingFields, ["intake"]);
  assert.equal(response.data[0]?.publicPagesAffected, 4);
  assert.equal(response.data[0]?.activeApplicationsAffected, 4);
  assert.equal(response.data[0]?.sourceUrl, "https://example.edu/fees");
});

test("rejects non-http evidence links and marks deadline absence", async () => {
  const response = await readCatalogDataConfidence({
    async query() {
      return { rows: [{
        id: 8, name: "Engineering", university_id: 4, university_name: "Example",
        country: "UK", city: null, confidence: "partial", price_verified_at: null,
        intake_verified_at: new Date("2026-09-21T10:00:00Z"), intake_expires_at: null,
        intake_source_name: "Portal", intake_source_url: "javascript:alert(1)",
        active_intakes: 2, dated_intakes: 0, active_applications: 0,
        total_programs: 1, verified_programs: 0, partial_programs: 1,
        missing_programs: 0, missing_tuition: 1, missing_intake: 0, missing_deadline: 1,
      }] } as never;
    },
  });
  assert.deepEqual(response.data[0]?.missingFields, ["tuition", "deadline"]);
  assert.equal(response.data[0]?.sourceUrl, null);
  assert.equal(response.data[0]?.publicPagesAffected, 3);
});

test("route and UI keep the confidence slice read-only and bounded", () => {
  const route = source("../src/routes/dataQuality.ts");
  const ui = source("../../edcons/src/pages/admin/DataQuality.tsx");
  assert.match(route, /catalog-confidence/);
  assert.match(route, /REPEATABLE READ READ ONLY/);
  assert.match(route, /statement_timeout/);
  assert.match(route, /Cache-Control", "private, no-store/);
  assert.match(ui, /Catalogue confidence and change impact/);
  assert.match(ui, /Read-only preview/);
  assert.doesNotMatch(ui, /Publish selected|Auto-publish/);
});
