import { buildWorkbookBuffer, embedWidgetColumns, buildEmbedFilterReferenceSheets, EMBED_KIND, EMBED_FILTER_KEYS } from "./src/lib/exportImportExcel";
import { db, universitiesTable, programsTable } from "@workspace/db";
import { and, eq, isNotNull } from "drizzle-orm";
import { writeFileSync } from "fs";

const VALID_MODES = ["combined","course_finder","application_only","lead_form"];

async function loadCatalog() {
  const [countriesRows, citiesRows, typesRows, levelsRows, languagesRows, unis] = await Promise.all([
    db.selectDistinct({ v: universitiesTable.country }).from(universitiesTable).where(and(eq(universitiesTable.isActive, true), isNotNull(universitiesTable.country))).orderBy(universitiesTable.country),
    db.selectDistinct({ v: universitiesTable.city }).from(universitiesTable).where(and(eq(universitiesTable.isActive, true), isNotNull(universitiesTable.city))).orderBy(universitiesTable.city),
    db.selectDistinct({ v: universitiesTable.universityType }).from(universitiesTable).where(and(eq(universitiesTable.isActive, true), isNotNull(universitiesTable.universityType))).orderBy(universitiesTable.universityType),
    db.selectDistinct({ v: programsTable.degree }).from(programsTable).where(and(eq(programsTable.isActive, true), isNotNull(programsTable.degree))).orderBy(programsTable.degree),
    db.selectDistinct({ v: programsTable.language }).from(programsTable).where(and(eq(programsTable.isActive, true), isNotNull(programsTable.language))).orderBy(programsTable.language),
    db.select({ id: universitiesTable.id, name: universitiesTable.name, country: universitiesTable.country, city: universitiesTable.city, type: universitiesTable.universityType })
      .from(universitiesTable).where(eq(universitiesTable.isActive, true)).orderBy(universitiesTable.name),
  ]);
  const clean = (rs: any[]) => Array.from(new Set(rs.map((r:any)=>(r.v??"").trim()).filter(Boolean))).sort();
  return { countries: clean(countriesRows), cities: clean(citiesRows), universityTypes: clean(typesRows), levels: clean(levelsRows), languages: clean(languagesRows), universities: unis };
}

(async () => {
  const catalog = await loadCatalog();
  console.log("CATALOG SIZES:", { countries: catalog.countries.length, cities: catalog.cities.length, types: catalog.universityTypes.length, levels: catalog.levels.length, languages: catalog.languages.length, universities: catalog.universities.length });
  console.log("countries:", catalog.countries.slice(0,10));
  console.log("levels:", catalog.levels);
  console.log("languages:", catalog.languages);

  const cols = embedWidgetColumns(VALID_MODES, catalog);
  const example = { name: "EXAMPLE", slug: "ex-1", mode: "combined", isActive: true, theme: { primary: "#0ea5e9" }, presetFilters: { country: catalog.countries[0], level: catalog.levels[0] }, lockedFilters: [], hiddenFilters: [], visibleFilters: [...EMBED_FILTER_KEYS], allowedDomains: ["example.com"] };
  const buf = await buildWorkbookBuffer({
    sheets: [{ name: "Widgets", columns: cols, rows: [example as any] }, ...buildEmbedFilterReferenceSheets(catalog)],
    meta: { kind: EMBED_KIND, version: "1", exportedAt: new Date().toISOString() },
  });
  writeFileSync("/tmp/live-template.xlsx", buf);
  console.log("wrote /tmp/live-template.xlsx", buf.length, "bytes");
  process.exit(0);
})();
