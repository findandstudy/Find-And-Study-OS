import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseClientCalendarDate, parseClientDayBounds } from "../src/lib/followUpDateFilters.js";

const scriptDir = fileURLToPath(new URL(".", import.meta.url));
const apiRoot = resolve(scriptDir, "..");
const workspaceRoot = resolve(apiRoot, "../..");
const uiRoot = resolve(workspaceRoot, "artifacts/edcons");

function source(path: string): string {
  return readFileSync(path, "utf8");
}

function objectKeys(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, nested]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return [path, ...objectKeys(nested, path)];
  }).sort();
}

test("follow-up date filters honor the browser timezone", () => {
  const reference = new Date("2026-08-23T08:15:00.000Z");
  const bounds = parseClientDayBounds(-180, reference);
  assert.equal(bounds.today.toISOString(), "2026-08-22T21:00:00.000Z");
  assert.equal(bounds.tomorrow.toISOString(), "2026-08-23T21:00:00.000Z");
  assert.equal(bounds.nextSevenDays.toISOString(), "2026-08-30T21:00:00.000Z");
  assert.equal(parseClientCalendarDate("2026-08-23", -180)?.toISOString(), "2026-08-22T21:00:00.000Z");
  assert.equal(parseClientCalendarDate("2026-08-23", -180, true)?.toISOString(), "2026-08-23T20:59:59.999Z");
  assert.equal(parseClientCalendarDate("2026-02-30", -180), null);
});

test("follow-up API keeps list, create and bulk mutations behind task permissions", () => {
  const route = source(resolve(apiRoot, "src/routes/followUps.ts"));
  assert.match(route, /router\.get\(\s*"\/follow-ups"/);
  assert.match(route, /router\.post\(\s*"\/follow-ups"/);
  assert.match(route, /router\.put\(\s*"\/follow-ups\/bulk"/);
  assert.ok((route.match(/requireAgentStaffPermission\("tasks"\)/g) || []).length >= 3);
  assert.match(route, /Only admins can reassign follow-ups/);
  assert.match(route, /followUpVisibilityCondition\(scope\)/);

  const legacyPatch = source(resolve(apiRoot, "src/routes/leads.ts"));
  assert.match(legacyPatch, /router\.patch\("\/follow-ups\/:id"/);
  assert.match(legacyPatch, /canAccessAssignedRecord\(perms, fuLead\.assignedToId, fuUser\.id\)/);
  assert.match(legacyPatch, /Only admins can reassign follow-ups/);
});

test("Tasks page exposes the Follow-ups tab and preserves deep links", () => {
  const tasks = source(resolve(uiRoot, "src/pages/staff/Tasks.tsx"));
  const panel = source(resolve(uiRoot, "src/pages/staff/FollowUpsPanel.tsx"));
  assert.match(tasks, /data-testid="tab-follow-ups"/);
  assert.match(tasks, /query\.has\("followUpId"\)/);
  assert.match(panel, /data-testid="follow-ups-panel"/);
  assert.match(panel, /\/api\/follow-ups/);
  assert.match(panel, /SortButton/);
  assert.match(panel, /FollowUpFields/);
});

test("Follow-up filters are sent to the API and reset consistently", () => {
  const panel = source(resolve(uiRoot, "src/pages/staff/FollowUpsPanel.tsx"));
  const route = source(resolve(apiRoot, "src/routes/followUps.ts"));

  for (const parameter of [
    "range",
    "status",
    "resourceType",
    "assignedTo",
    "search",
    "from",
    "to",
    "sortKey",
    "sortDir",
    "tzOffsetMinutes",
  ]) {
    assert.match(panel, new RegExp(`\\b${parameter}(?:,|:)`), `${parameter} is missing from the Follow-ups query`);
  }
  assert.match(panel, /setRange\(key\);\s*setStatus\("all"\)/);
  assert.match(panel, /if \(value !== "all"\) setRange\("all"\)/);
  assert.match(panel, /function clearFilters\(\): void \{[\s\S]*setSearch\(""\);[\s\S]*setStatus\("all"\);[\s\S]*setResourceType\("all"\);[\s\S]*setAssignedTo\("all"\);[\s\S]*setFrom\(""\);[\s\S]*setTo\(""\);[\s\S]*setRange\("all"\);/);

  assert.match(route, /resourceType === "lead"/);
  assert.match(route, /resourceType === "student"/);
  assert.match(route, /query\.assignedTo === "me"/);
  assert.match(route, /query\.assignedTo === "unassigned"/);
  assert.match(route, /query\.search\?\.trim\(\)/);
  assert.match(route, /parseClientCalendarDate\(query\.from, offsetMinutes\)/);
  assert.match(route, /parseClientCalendarDate\(query\.to, offsetMinutes, true\)/);
  assert.match(route, /query\.status === "pending"/);
  assert.match(route, /query\.status === "completed"/);
  for (const range of ["today", "next7", "overdue", "completed"]) {
    assert.match(route, new RegExp(`query\\.range === "${range}"`));
  }
});

test("follow-up and assignment changes invalidate cross-page workspace caches", () => {
  const dashboard = source(resolve(uiRoot, "src/pages/staff/Dashboard.tsx"));
  const panel = source(resolve(uiRoot, "src/pages/staff/FollowUpsPanel.tsx"));
  const messages = source(resolve(uiRoot, "src/pages/staff/Messages.tsx"));
  const invalidation = source(resolve(uiRoot, "src/lib/workspaceQueryInvalidation.ts"));

  assert.match(dashboard, /queryKey: \["\/api\/follow-ups\/upcoming"\][\s\S]*staleTime: 0,[\s\S]*refetchOnMount: "always"/);
  assert.match(panel, /invalidateFollowUpWorkspaceQueries\(queryClient\)/);
  assert.match(messages, /invalidateAssignmentWorkspaceQueries\(queryClient\)/);
  for (const root of ["/api/follow-ups", "/api/leads", "/api/students", "/api/applications"]) {
    assert.ok(invalidation.includes(`"${root}"`), `${root} is missing from workspace cache invalidation`);
  }
  assert.match(invalidation, /predicate: query => queryKeyMatchesAnyRoot\(query\.queryKey, roots\)/);
});

test("follow-up translations have identical structure in all ten locales", () => {
  const locales = ["en", "tr", "fr", "es", "ru", "ar", "fa", "hi", "id", "zh"];
  const values = locales.map(locale => JSON.parse(source(resolve(uiRoot, `src/lib/i18n/translations/${locale}.json`))).followUps);
  const baseline = objectKeys(values[0]);
  for (let index = 0; index < locales.length; index += 1) {
    assert.deepEqual(objectKeys(values[index]), baseline, `${locales[index]} followUps keys differ from en`);
  }
});
