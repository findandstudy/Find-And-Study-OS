import { db, countriesTable, citiesTable, universitiesTable, programsTable } from "@workspace/db";
import { and, eq, asc, sql } from "drizzle-orm";
import { addPublicCatalogConditions, getPublicCatalogPolicy } from "./publicCatalogQueryPolicy";

export function catalogName(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}
export function countryMatches(value: string, country: { name: string; code: string }) {
  if (!country) return false;
  return countryAliases(country).some(v => catalogName(v) === catalogName(value));
}
export function countryAliases(country: { name: string; code: string }) {
  const values = [country.name, country.code];
  if (country.code.toUpperCase() === "TR") values.push("Turkey", "Türkiye", "Turkiye");
  if (country.code.toUpperCase() === "GB") values.push("UK", "United Kingdom");
  return values;
}
export async function websiteCatalogTaxonomy(source: string, countryId?: number) {
  const conditions: any[] = [];
  addPublicCatalogConditions(conditions, await getPublicCatalogPolicy());
  if (source === "programs") conditions.push(sql`exists (select 1 from ${programsTable} where ${programsTable.universityId} = ${universitiesTable.id} and ${programsTable.isActive} = true)`);
  const [countries, cities, universities] = await Promise.all([
    db.select().from(countriesTable).where(eq(countriesTable.isActive, true)),
    db.select().from(citiesTable).where(eq(citiesTable.isActive, true)),
    db.select({ id: universitiesTable.id, name: universitiesTable.name, country: universitiesTable.country, city: universitiesTable.city, type: universitiesTable.universityType })
      .from(universitiesTable).where(and(...conditions)).orderBy(asc(universitiesTable.name)),
  ]);
  const eligibleCountries = countries.filter(c => source === "cities" ? cities.some(city => city.countryId === c.id) : universities.some(u => countryMatches(u.country, c)));
  const country = countries.find(c => c.id === countryId);
  const scopedUniversities = country ? universities.filter(u => countryMatches(u.country, country)) : universities;
  const eligibleCities = cities.filter(c => (!countryId || c.countryId === countryId) && (source === "cities" || scopedUniversities.some(u => catalogName(u.city || "") === catalogName(c.name) && countryMatches(u.country, countries.find(country => country.id === c.countryId)!))));
  return { countries: eligibleCountries, cities: eligibleCities, universities: scopedUniversities };
}

export async function readWebsiteCatalogFilters(source: string, locale: string, countryId?: number) {
  if (source === "destinations") return []; // No region/group taxonomy exists in this model.
  const taxonomy = await websiteCatalogTaxonomy(source, countryId);
  const display = new Intl.DisplayNames([locale], { type: "region" });
  const filters: { key: string; label: string; options: { id: string; label: string; aliases?: string[] }[] }[] = [{ key: "countryId", label: "Country", options: taxonomy.countries.map(c => ({ id: String(c.id), label: /^[A-Z]{2}$/.test(c.code.toUpperCase()) ? display.of(c.code.toUpperCase()) || c.name : c.name, aliases: countryAliases(c) })) }];
  if (source === "cities") return filters;
  filters.push({ key: "cityId", label: "City", options: taxonomy.cities.map(c => ({ id: String(c.id), label: c.name })) });
  if (source === "universities") {
    filters.push({ key: "institutionType", label: "Institution type", options: [...new Set(taxonomy.universities.map(u => u.type).filter(Boolean))].map(v => ({ id: v!, label: v! })) });
  } else {
    filters.push({ key: "universityId", label: "University", options: taxonomy.universities.map(u => ({ id: String(u.id), label: u.name })) });
    const conditions: any[] = [eq(programsTable.isActive, true)];
    addPublicCatalogConditions(conditions, await getPublicCatalogPolicy());
    const options = await db.selectDistinct({ degree: programsTable.degree, language: programsTable.language }).from(programsTable)
      .innerJoin(universitiesTable, eq(programsTable.universityId, universitiesTable.id)).where(and(...conditions));
    for (const key of ["degree", "language"] as const) filters.push({ key, label: key === "degree" ? "Study level" : "Instruction language", options: [...new Set(options.map(o => o[key]).filter(Boolean))].sort().map(v => ({ id: v!, label: v! })) });
  }
  return filters;
}
