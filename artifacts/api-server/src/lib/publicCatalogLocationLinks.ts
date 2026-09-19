import { db, countriesTable, citiesTable, destinationsTable, universitiesTable, programsTable } from "@workspace/db";
import { and, eq, sql, asc, inArray } from "drizzle-orm";
import { countryMatches, countryAliases, catalogName } from "./websiteCatalogFilters";
import { publicCatalogSlug, publicCatalogRouteKey, publicCatalogPath } from "./publicCatalogRouteContract";
import { normalizeProgramLocale } from "./programTranslationContract";
import { addPublicCatalogConditions, getPublicCatalogPolicy } from "./publicCatalogQueryPolicy";
import { readPublishedLocalizedEntity } from "./publicWebDiscoveryReadModel";

type Country = { id: number; name: string; code: string; isActive: boolean };
type Destination = { id: number; country: string; slug: string; isActive: boolean };

/** Match only a unique existing identity; never guess among aliases or duplicate slugs. */
export function matchCatalogCountry(value: string, countries: Country[]): Country | null {
  const matches = countries.filter(country => countryMatches(value, country) || publicCatalogSlug(country.name) === value);
  return matches.length === 1 && matches[0].isActive ? matches[0] : null;
}

export function catalogCountryRoute(country: Country, countries: Country[], destinations: Destination[], locale: string): string | null {
  if (!country.isActive || matchCatalogCountry(country.name, countries)?.id !== country.id) return null;
  const matches = destinations.filter(destination => countryMatches(destination.country, country));
  if (matches.length > 1 || matches.some(destination => !destination.isActive)) return null;
  if (matches.length === 1) return `/${locale}/destinations/${matches[0].slug}`;
  const slug = publicCatalogSlug(country.name);
  if (countries.filter(candidate => publicCatalogSlug(candidate.name) === slug).length !== 1
    || destinations.some(destination => destination.slug === slug)) return null;
  return `/${locale}/countries/${slug}`;
}

export async function readPublicCatalogCountryDirectory(localeInput: unknown) {
  const locale = normalizeProgramLocale(localeInput);
  const conditions: any[] = [];
  addPublicCatalogConditions(conditions, await getPublicCatalogPolicy());
  const [countries, destinations, counts] = await Promise.all([
    db.select().from(countriesTable).orderBy(asc(countriesTable.name)),
    db.select().from(destinationsTable),
    db.select({ country: universitiesTable.country,
      universityCount: sql<number>`count(distinct ${universitiesTable.id})`,
      programCount: sql<number>`count(${programsTable.id})` })
      .from(universitiesTable).leftJoin(programsTable, and(eq(programsTable.universityId, universitiesTable.id), eq(programsTable.isActive, true)))
      .where(and(...conditions)).groupBy(universitiesTable.country),
  ]);
  const entries = countries.flatMap(country => {
    const canonicalPath = catalogCountryRoute(country, countries, destinations, locale);
    const sourceCounts = counts.filter(row => matchCatalogCountry(row.country, countries)?.id === country.id);
    if (!canonicalPath || !sourceCounts.length) return [];
    return [{ country, canonicalPath, destination: destinations.find(row => countryMatches(row.country, country)) ?? null,
      sourceCountryNames: sourceCounts.map(row => row.country),
      universityCount: sourceCounts.reduce((sum, row) => sum + Number(row.universityCount), 0),
      programCount: sourceCounts.reduce((sum, row) => sum + Number(row.programCount), 0) }];
  });
  return { locale, countries, destinations, entries };
}

export async function resolvePublicCatalogLocationLinks(input: { locale: unknown; country: string; city?: string | null }) {
  const locale = normalizeProgramLocale(input.locale);
  const [countries, destinations] = await Promise.all([db.select().from(countriesTable), db.select().from(destinationsTable)]);
  const country = matchCatalogCountry(input.country, countries);
  let countryPath = country ? catalogCountryRoute(country, countries, destinations, locale) : null;
  if (!country || !countryPath) return { countryPath: null, cityPath: null };
  const conditions: any[] = [sql`lower(trim(${universitiesTable.country})) IN (${sql.join(countryAliases(country).map(alias => sql`${alias.toLowerCase().trim()}`), sql`, `)})`];
  addPublicCatalogConditions(conditions, await getPublicCatalogPolicy());
  const [visible] = await db.select({ id: universitiesTable.id }).from(universitiesTable).where(and(...conditions)).limit(1);
  if (!visible) return { countryPath: null, cityPath: null };
  const destination = destinations.find(row => countryMatches(row.country, country));
  if (destination) {
    const delivery = await readPublishedLocalizedEntity({ entityType: "destination", entityId: destination.id, locale });
    countryPath = delivery.snapshot?.canonicalPath ?? countryPath;
  }
  if (!input.city) return { countryPath, cityPath: null };
  const cities = await db.select().from(citiesTable).where(eq(citiesTable.countryId, country.id));
  const matches = cities.filter(city => catalogName(city.name) === catalogName(input.city!));
  if (matches.length !== 1 || !matches[0].isActive) return { countryPath, cityPath: null };
  const delivery = await readPublishedLocalizedEntity({ entityType: "city", entityId: matches[0].id, locale });
  return { countryPath, cityPath: delivery.snapshot?.canonicalPath ?? `/${locale}/cities/${publicCatalogRouteKey(matches[0].id, matches[0].name)}` };
}

/** Catalogue-only country projection; does not manufacture a destination/publication record. */
export async function readCatalogCountryFallback(localeInput: unknown, slug: string) {
  const directory = await readPublicCatalogCountryDirectory(localeInput);
  const entry = directory.entries.find(row => !row.destination && publicCatalogSlug(row.country.name) === slug);
  if (!entry) return null;
  const conditions: any[] = [inArray(universitiesTable.country, entry.sourceCountryNames)];
  addPublicCatalogConditions(conditions, await getPublicCatalogPolicy());
  const [universities, cities] = await Promise.all([
    db.select({ id: universitiesTable.id, name: universitiesTable.name, city: universitiesTable.city,
      universityType: universitiesTable.universityType }).from(universitiesTable).where(and(...conditions)).orderBy(asc(universitiesTable.name)).limit(24),
    db.select({ id: citiesTable.id, name: citiesTable.name }).from(citiesTable)
      .where(and(eq(citiesTable.countryId, entry.country.id), eq(citiesTable.isActive, true))).orderBy(asc(citiesTable.name)).limit(24),
  ]);
  const cityLinks = await Promise.all(cities.map(async city => {
    const delivery = await readPublishedLocalizedEntity({ entityType: "city", entityId: city.id, locale: directory.locale });
    return { ...city, sourceName: city.name, canonicalPath: delivery.snapshot?.canonicalPath ?? `/${directory.locale}/cities/${publicCatalogRouteKey(city.id, city.name)}` };
  }));
  const programCounts = universities.length ? await db.select({ universityId: programsTable.universityId,
    count: sql<number>`count(*)` }).from(programsTable)
    .where(and(inArray(programsTable.universityId, universities.map(row => row.id)), eq(programsTable.isActive, true)))
    .groupBy(programsTable.universityId) : [];
  const countsByUniversity = new Map(programCounts.map(row => [row.universityId, Number(row.count)]));
  return {
    destination: { id: null, catalogCountryId: entry.country.id, source: "catalog" as const,
      name: entry.country.name, country: entry.country.name, slug, canonicalPath: entry.canonicalPath,
      shortDescription: null, description: null, whyStudyHere: null, livingCost: null, climate: null,
      language: null, currency: null, visaInfo: null, workPermit: null, imageUrl: null,
      popularCities: cityLinks.map(city => city.name).join(", "), isFeatured: false },
    universities: universities.map(university => ({ ...university, programCount: countsByUniversity.get(university.id) ?? 0, canonicalPath: publicCatalogPath({ locale: directory.locale, entityType: "university", id: university.id, name: university.name }) })),
    programs: [], cities: cityLinks,
    stats: { universityCount: entry.universityCount, programCount: entry.programCount },
    meta: { locale: directory.locale, indexable: false, canonicalPath: entry.canonicalPath, alternatePaths: {}, contentPolicy: "CATALOG_SOURCE_FALLBACK" },
  };
}
