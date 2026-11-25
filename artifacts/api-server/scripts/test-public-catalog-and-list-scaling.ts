import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import {
  isPublicUniversityVisible,
  normaliseCountryRules,
  universityTypesForPublicCountry,
  type PublicCatalogPolicy,
} from "../src/lib/publicCatalogPolicy";

const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

const courseFinder = read("../src/routes/course-finder.ts");
const publicCatalogQueryPolicy = read("../src/lib/publicCatalogQueryPolicy.ts");
const settingsSchema = read("../../../lib/db/src/schema/settings.ts");
const publicPrograms = read("../../edcons/src/pages/public/Programs.tsx");
const leadsRoute = read("../src/routes/leads.ts");
const studentsRoute = read("../src/routes/students.ts");
const applicationsRoute = read("../src/routes/applications.ts");
const universitiesRoute = read("../src/routes/universities.ts");
const apiApp = read("../src/app.ts");
const apiIndex = read("../src/index.ts");
const leadsPage = read("../../edcons/src/pages/staff/Leads.tsx");
const studentsPage = read("../../edcons/src/pages/staff/Students.tsx");
const applicationsPage = read("../../edcons/src/pages/staff/Applications.tsx");
const catalogPage = read("../../edcons/src/pages/admin/Catalog.tsx");
const catalogRoute = read("../src/routes/catalog.ts");
const universityTypeSeed = read("../../../lib/db/drizzle/0140_catalog_university_type_options.sql");

test("public catalogue uses an explicit public scope for programs and facets", () => {
  assert.match(publicPrograms, /p\.set\("scope", "public"\)/);
  assert.match(publicPrograms, /params\.set\("scope", "public"\)/);
});

test("anonymous course-finder requests fail closed to a private-only default", () => {
  assert.match(publicCatalogQueryPolicy, /allowedUniversityTypes = \["Private"\]/);
  assert.match(courseFinder, /if \(!explicitlyPublic && isInternalCourseFinderRequest\(req\)\) return null/);
  assert.match(courseFinder, /addPublicCatalogConditions\(conditions, publicPolicy\)/);
});

test("public visibility is persisted as first-class settings", () => {
  assert.match(settingsSchema, /publicCatalogAllowedCountries/);
  assert.match(settingsSchema, /publicCatalogAllowedUniversityTypes/);
  assert.match(settingsSchema, /publicCatalogCountryRules/);
  assert.match(courseFinder, /router\.patch\(\s*"\/course-finder\/public-settings"/);
  assert.match(courseFinder, /requireRole\(\.\.\.ADMIN_ROLES\)/);
});

test("country public institution rules are edited from catalog-managed university types", () => {
  assert.match(catalogRoute, /\/countries\/:id\/public-university-types/);
  assert.match(catalogRoute, /category, "university_type"/);
  assert.match(catalogPage, /country-public-university-types/);
  assert.match(catalogPage, /grouped\?\.university_type/);
  for (const value of ["Public", "Private", "Language School", "Vocational School", "Pathway Provider"]) {
    assert.ok(universityTypeSeed.includes(`'${value}'`), `missing university type seed: ${value}`);
  }
});

test("country-specific public policy supports Turkey private and Latvia mixed", () => {
  const policy: PublicCatalogPolicy = {
    allowedCountries: [],
    allowedUniversityTypes: ["Private"],
    countryRules: {
      Latvia: ["Private", "Public"],
      Turkey: ["Private"],
      Hiddenland: [],
    },
  };
  assert.equal(isPublicUniversityVisible(policy, "Turkey", "Private"), true);
  assert.equal(isPublicUniversityVisible(policy, "Turkey", "Public"), false);
  assert.equal(isPublicUniversityVisible(policy, "Latvia", "Private"), true);
  assert.equal(isPublicUniversityVisible(policy, "Latvia", "Public"), true);
  assert.equal(isPublicUniversityVisible(policy, "Hiddenland", "Private"), false);
  assert.deepEqual(universityTypesForPublicCountry(policy, "Germany"), ["Private"]);
});

test("country-specific public policy resolves catalog-managed aliases", () => {
  const policy: PublicCatalogPolicy = {
    allowedCountries: [],
    allowedUniversityTypes: ["Language School"],
    countryRules: {},
    universityTypeAliases: { "Language School": ["Language Centre", "Language Center"] },
  };
  assert.equal(isPublicUniversityVisible(policy, "Turkey", "Language Centre"), true);
  assert.equal(isPublicUniversityVisible(policy, "Turkey", "College"), false);
});

test("country rules are canonical and legacy country allow-lists remain fail-closed", () => {
  assert.deepEqual(
    normaliseCountryRules({
      " Latvia ": ["Public", "Private", "Public"],
      Turkey: [],
      "": ["Private"],
    }),
    { Latvia: ["Public", "Private"], Turkey: [] },
  );
  const legacyPolicy: PublicCatalogPolicy = {
    allowedCountries: ["Turkey"],
    allowedUniversityTypes: ["Private"],
    countryRules: {},
  };
  assert.equal(isPublicUniversityVisible(legacyPolicy, "Turkey", "Private"), true);
  assert.equal(isPublicUniversityVisible(legacyPolicy, "Latvia", "Private"), false);
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

test("applications list is server-paginated and keeps pipeline loading bounded", () => {
  assert.doesNotMatch(applicationsPage, /limit=100000/);
  assert.doesNotMatch(applicationsPage, /:\s*2000/);
  assert.match(applicationsPage, /PIPELINE_BATCH_SIZE\s*=\s*25/);
  assert.match(applicationsPage, /useQueries\(\{/);
  assert.match(applicationsPage, /params\.set\("stage", stageDef\.key\)/);
  assert.match(applicationsPage, /params\.set\("includeFacets", shouldIncludeFacets \? "1" : "0"\)/);
  assert.match(applicationsPage, /onLoadMore/);
  assert.match(applicationsPage, /Load more/);
  assert.match(applicationsPage, /applicationsResp\?\.meta\?\.total/);
  assert.match(applicationsRoute, /maxLimit: 5000/);
  assert.match(applicationsRoute, /const includeFacets = query\.includeFacets !== "0"/);
});

test("applications API owns list filtering, sorting, and cross-page facets", () => {
  for (const key of [
    "search", "country", "universityId", "universityType", "createdSource",
    "assignment", "dateRange", "name", "program", "level", "intake",
    "sortKey", "sortDir",
  ]) {
    assert.ok(applicationsRoute.includes(key), `applications route must support ${key}`);
  }
  assert.match(applicationsRoute, /facets:\s*\{/);
  assert.match(applicationsRoute, /countries:\s*countryRows/);
  assert.match(applicationsRoute, /universities:\s*universityRows/);
  assert.match(applicationsRoute, /agents:\s*agentRows/);
});

test("catalog university lists use a lightweight summary and lazy logo endpoint", () => {
  assert.match(catalogPage, /summary:\s*"1"/);
  assert.match(universitiesRoute, /const \{[^}]*summary[^}]*\} = req\.query/);
  assert.match(universitiesRoute, /hasLogo:\s*sql<boolean>/);
  assert.match(universitiesRoute, /delete masked\.hasLogo/);
  assert.match(universitiesRoute, /router\.get\("\/universities\/:id\/logo"/);
  assert.match(universitiesRoute, /Cache-Control", "public, max-age=0, must-revalidate"/);
  assert.match(universitiesRoute, /setHeader\("ETag", etag\)/);
  assert.match(universitiesRoute, /req\.headers\["if-none-match"\] === etag/);
  assert.match(universitiesRoute, /X-Content-Type-Options", "nosniff"/);
  assert.match(universitiesRoute, /Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox"/);
});

// Exercise the actual editor handler with mocked I/O. Its local declarations
// may change (for example to Promise.all) without changing this contract.
const catalogAst = ts.createSourceFile("Catalog.tsx", catalogPage, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let editUniversityHandler: ts.Expression | undefined;
function findUniversityEditor(node: ts.Node): void {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "openEditUniversity") {
    editUniversityHandler = node.initializer;
  }
  ts.forEachChild(node, findUniversityEditor);
}
findUniversityEditor(catalogAst);

for (const periods of [[{ id: 9, name: "TEST Autumn" }], undefined]) {
  test(`university editor loads full detail and ${periods ? "existing" : "absent"} application periods`, async () => {
    assert.ok(editUniversityHandler, "the university editor handler must exist");
    const calls: string[] = [];
    const forms: unknown[] = [];
    const countries: unknown[] = [];
    const university = { id: 42, name: "TEST University", country: "TEST Country", description: "Full detail" };
    const source = ts.transpileModule(`(${editUniversityHandler.getText(catalogAst)})`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
    }).outputText;
    const open = runInNewContext(source, {
      api: async (path: string) => {
        calls.push(path);
        if (path === "/api/universities/42") return university;
        assert.equal(path, "/api/universities/42/application-periods");
        return { data: periods };
      },
      setForm: (form: unknown) => forms.push(structuredClone(form)),
      setSelCountryId: (id: unknown) => countries.push(id),
      allCountries: [{ id: 7, name: "TEST Country" }],
      findCatalogCountry: (rows: Array<{ id: number; name: string }>, country: string) => rows.find(row => row.name === country),
      toast: () => assert.fail("loading valid university details must not fail"),
      t: (key: string) => key,
    }, { timeout: 1_000 }) as (id: number) => Promise<void>;
    await open(42);
    assert.deepEqual(calls.sort(), ["/api/universities/42", "/api/universities/42/application-periods"]);
    assert.deepEqual(forms, [{ ...university, applicationPeriods: periods ?? [] }]);
    assert.deepEqual(countries, [7]);
  });
}

test("program catalog resolves every university without paginated truncation", () => {
  assert.match(universitiesRoute, /router\.get\("\/universities\/options", requireAuth/);
  assert.match(universitiesRoute, /getTableColumns\(programsTable\)/);
  assert.match(universitiesRoute, /universityName:\s*universitiesTable\.name/);
  assert.match(universitiesRoute, /\.leftJoin\(universitiesTable/);
  assert.match(catalogPage, /api\("\/api\/universities\/options"\)/);
  assert.doesNotMatch(catalogPage, /api\("\/api\/universities\?limit=500"\)/);
  assert.match(catalogPage, /p\.universityName \?\? uniMap\[p\.universityId\]\?\.name/);
});

test("API logs slow requests without query strings or payload data", () => {
  assert.match(apiApp, /\[slow-request\]/);
  assert.match(apiApp, /durationMs < 1_500/);
  assert.match(apiApp, /path:\s*req\.path/);
  assert.doesNotMatch(apiApp, /path:\s*req\.(originalUrl|url)/);
});

test("startup enum migrations do not abort when the app role is not the enum owner", () => {
  assert.match(apiIndex, /async function ensurePgEnumValue/);
  assert.match(apiIndex, /JOIN pg_enum e ON e\.enumtypid = t\.oid/);
  assert.match(apiIndex, /if \(existing\.rows\[0\]\?\.exists\) return/);
  assert.match(apiIndex, /if \(err\?\.code === "42501"\)/);
  assert.match(apiIndex, /await ensurePgEnumValue\("portal_submission_status", "accepted"\)/);
  assert.match(apiIndex, /await ensurePgEnumValue\("portal_submission_status", "rejected"\)/);
});
