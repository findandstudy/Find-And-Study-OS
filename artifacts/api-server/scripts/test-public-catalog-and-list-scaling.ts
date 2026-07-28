import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

const courseFinder = read("../src/routes/course-finder.ts");
const settingsSchema = read("../../../lib/db/src/schema/settings.ts");
const publicPrograms = read("../../edcons/src/pages/public/Programs.tsx");
const leadsRoute = read("../src/routes/leads.ts");
const studentsRoute = read("../src/routes/students.ts");
const leadsPage = read("../../edcons/src/pages/staff/Leads.tsx");
const studentsPage = read("../../edcons/src/pages/staff/Students.tsx");

test("public catalogue uses an explicit public scope for programs and facets", () => {
  assert.match(publicPrograms, /p\.set\("scope", "public"\)/);
  assert.match(publicPrograms, /params\.set\("scope", "public"\)/);
});

test("anonymous course-finder requests fail closed to a private-only default", () => {
  assert.match(courseFinder, /allowedUniversityTypes = \["Private"\]/);
  assert.match(courseFinder, /if \(!explicitlyPublic && isInternalCourseFinderRequest\(req\)\) return null/);
  assert.match(courseFinder, /addPublicCatalogConditions\(conditions, publicPolicy\)/);
});

test("public visibility is persisted as first-class settings", () => {
  assert.match(settingsSchema, /publicCatalogAllowedCountries/);
  assert.match(settingsSchema, /publicCatalogAllowedUniversityTypes/);
  assert.match(courseFinder, /router\.patch\(\s*"\/course-finder\/public-settings"/);
  assert.match(courseFinder, /requireRole\(\.\.\.ADMIN_ROLES\)/);
});

test("lead and student APIs cap list payloads and accept server filters", () => {
  assert.match(leadsRoute, /maxLimit: 500/);
  assert.match(studentsRoute, /maxLimit: 500/);
  for (const key of ["assignment", "nationality", "dateRange", "followupRange", "sortKey", "sortDir"]) {
    assert.ok(leadsRoute.includes(key), `leads route must support ${key}`);
    assert.ok(studentsRoute.includes(key), `students route must support ${key}`);
  }
});

test("lead and student pages no longer request 100000 records", () => {
  assert.doesNotMatch(leadsPage, /limit:\s*100000/);
  assert.doesNotMatch(studentsPage, /limit:\s*100000/);
  assert.match(leadsPage, /viewMode === "list" \? pg\.pageSize : 500/);
  assert.match(studentsPage, /viewMode === "list" \? pg\.pageSize : 500/);
});
