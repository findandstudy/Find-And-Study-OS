import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  REPORTING_METRICS,
  ReportingQueryError,
  ReportingScopeError,
  parseReportingFilters,
  resolveReportingBranchScope,
  safeChange,
  safeRate,
} from "../src/lib/reportingContract";

test("reporting filters use inclusive date-only boundaries and a bounded interval", () => {
  const parsed = parseReportingFilters(
    { from: "2026-08-01", to: "2026-08-31", season: "2026", branchId: "4" },
    new Date("2026-09-03T11:30:00.000Z"),
  );
  assert.equal(parsed.fromInclusive.toISOString(), "2026-08-01T00:00:00.000Z");
  assert.equal(parsed.toExclusive.toISOString(), "2026-09-01T00:00:00.000Z");
  assert.equal(parsed.season, "2026");
  assert.equal(parsed.branchId, 4);
  assert.equal(parsed.bucket, "day");
});

test("reporting filters fail closed for malformed and oversized requests", () => {
  assert.throws(
    () => parseReportingFilters({ from: "2026-02-30", to: "2026-03-01" }),
    ReportingQueryError,
  );
  assert.throws(
    () => parseReportingFilters({ from: "2025-01-01", to: "2026-09-01" }),
    /366 days/,
  );
  assert.throws(() => parseReportingFilters({ season: "all" }), /four-digit/);
  assert.throws(
    () => parseReportingFilters({ branchId: "1 OR 1=1" }),
    /positive integer/,
  );
});

test("rates and period changes never invent a denominator", () => {
  assert.equal(safeRate(5, 10), 50);
  assert.equal(safeRate(0, 0), null);
  assert.equal(safeChange(15, 10), 50);
  assert.equal(safeChange(5, 0), null);
});

test("reporting branch scope is server-resolved and fails closed", () => {
  assert.equal(resolveReportingBranchScope(null, null), null);
  assert.deepEqual(resolveReportingBranchScope(null, [4, 4, 7]), [4, 7]);
  assert.deepEqual(resolveReportingBranchScope(7, [4, 7]), [7]);
  assert.deepEqual(resolveReportingBranchScope(null, []), []);
  assert.throws(
    () => resolveReportingBranchScope(8, [4, 7]),
    ReportingScopeError,
  );
});

test("metric catalog keys are unique, versioned and aggregate-only", () => {
  const keys = REPORTING_METRICS.map((metric) => metric.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(
    REPORTING_METRICS.every(
      (metric) => metric.sensitivity === "aggregate_non_personal",
    ),
  );
  assert.ok(
    REPORTING_METRICS.some(
      (metric) => metric.timeSemantics === "created_cohort",
    ),
  );
  assert.ok(
    REPORTING_METRICS.some(
      (metric) => metric.timeSemantics === "current_inventory",
    ),
  );
});

test("reporting routes enforce permissions, query budgets and safe finance semantics", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const source = fs.readFileSync(
    path.join(root, "src/routes/reporting.ts"),
    "utf8",
  );
  assert.match(source, /BEGIN READ ONLY/);
  assert.match(source, /statement_timeout/);
  assert.match(source, /requirePermission\("reporting\.view"/);
  assert.match(
    source,
    /requirePermission\("reporting\.view", "reporting\.finance", "finance\.view"\)/,
  );
  assert.match(source, /original_currency_only_no_cross_currency_sum/);
  assert.match(source, /private, no-store/);
  assert.match(source, /getVisibleBranchIds/);
  assert.match(source, /branch_id = ANY\(\$4::int\[\]\)/);
  assert.doesNotMatch(source, /SELECT \* FROM/);
  assert.doesNotMatch(source, /res\.json\([^;]*(passport|phone|email)/is);
});

test("reporting permission migration is additive and does not grant ordinary staff", () => {
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../..",
  );
  const migration = fs.readFileSync(
    path.join(root, "lib/db/drizzle/0089_reporting_center_permissions.sql"),
    "utf8",
  );
  assert.match(migration, /reporting\.view/);
  assert.match(migration, /reporting\.finance/);
  assert.doesNotMatch(migration, /'staff'/);
  assert.doesNotMatch(migration, /DELETE|DROP|TRUNCATE/i);
});
