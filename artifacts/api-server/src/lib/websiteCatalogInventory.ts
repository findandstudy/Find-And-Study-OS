import { db, countriesTable, citiesTable, universitiesTable, programsTable, programTranslationsTable } from "@workspace/db";
import { and, asc, eq, ilike, or, sql } from "drizzle-orm";
import { getPublicCatalogPolicy, addPublicCatalogConditions } from "./publicCatalogQueryPolicy";
import { publicCatalogPath, publicCatalogRouteKey } from "./publicCatalogRouteContract";
import { readPublicCatalogCountryDirectory, catalogCountryRoute } from "./publicCatalogLocationLinks";
import { countryMatches } from "./websiteCatalogFilters";
import { readPublicEntityPublicationSummaries, readPublishedLocalizedEntities, resolvePublishedEntitySeoState } from "./publicWebDiscoveryReadModel";
import { catalogAvailability, catalogSourceEditPath, type CatalogInventoryQuery, type CatalogInventoryIssue } from "./websiteCatalogInventoryContract";

type Source = { id: number; name: string; sourceName: string; active: boolean; parentActive: boolean; policyVisible: boolean; hasDescription: boolean; hasMedia: boolean; updatedAt: Date; translationStatus: string | null; countryId?: number };

/** A bounded projection over existing entities, never a second CMS copy. */
export async function readWebsiteCatalogInventory(query: CatalogInventoryQuery) {
  const offset = (query.page - 1) * query.pageSize;
  const pattern = `%${query.q.replace(/[\\%_]/g, "\\$&")}%`;
  const sourceSearch = (name: any, id: any) => !query.q ? undefined : or(ilike(name, pattern), /^\d+$/.test(query.q) && Number(query.q) <= 2_147_483_647 ? eq(id, Number(query.q)) : sql`false`);
  let rows: Source[];
  let total: number;
  let directory: Awaited<ReturnType<typeof readPublicCatalogCountryDirectory>> | undefined;
  if (query.kind === "country") {
    const where = sourceSearch(countriesTable.name, countriesTable.id);
    const [[count], sources, countryDirectory] = await Promise.all([
      db.select({ value: sql<number>`count(*)` }).from(countriesTable).where(where),
      db.select({ id: countriesTable.id, name: countriesTable.name, isActive: countriesTable.isActive, updatedAt: countriesTable.updatedAt }).from(countriesTable).where(where).orderBy(asc(countriesTable.name), asc(countriesTable.id)).limit(query.pageSize).offset(offset),
      readPublicCatalogCountryDirectory(query.locale),
    ]);
    directory = countryDirectory;
    total = Number(count.value);
    rows = sources.map(row => ({ id: row.id, name: row.name, sourceName: row.name, active: row.isActive, parentActive: true, policyVisible: true, hasDescription: false, hasMedia: false, updatedAt: row.updatedAt, translationStatus: null }));
  } else if (query.kind === "city") {
    const where = sourceSearch(citiesTable.name, citiesTable.id);
    const [[count], sources] = await Promise.all([
      db.select({ value: sql<number>`count(*)` }).from(citiesTable).where(where),
      db.select({ id: citiesTable.id, name: citiesTable.name, isActive: citiesTable.isActive, countryId: citiesTable.countryId, parentActive: countriesTable.isActive, updatedAt: citiesTable.updatedAt })
        .from(citiesTable).innerJoin(countriesTable, eq(citiesTable.countryId, countriesTable.id)).where(where).orderBy(asc(citiesTable.name), asc(citiesTable.id)).limit(query.pageSize).offset(offset),
    ]);
    total = Number(count.value);
    rows = sources.map(row => ({ ...row, sourceName: row.name, active: row.isActive, policyVisible: true, hasDescription: false, hasMedia: false, translationStatus: null }));
  } else {
    const conditions: any[] = [];
    addPublicCatalogConditions(conditions, await getPublicCatalogPolicy());
    const policyVisible = sql<boolean>`coalesce((${and(...conditions) ?? sql`true`}),false)`;
    if (query.kind === "university") {
      const where = sourceSearch(universitiesTable.name, universitiesTable.id);
      const [[count], sources] = await Promise.all([
        db.select({ value: sql<number>`count(*)` }).from(universitiesTable).where(where),
        db.select({ id: universitiesTable.id, name: universitiesTable.name, active: universitiesTable.isActive, policyVisible,
          hasDescription: sql<boolean>`length(trim(coalesce(${universitiesTable.description},'')))>0`, hasMedia: sql<boolean>`length(trim(coalesce(${universitiesTable.logoUrl},'')))>0`, updatedAt: universitiesTable.updatedAt })
          .from(universitiesTable).where(where).orderBy(asc(universitiesTable.name), asc(universitiesTable.id)).limit(query.pageSize).offset(offset),
      ]);
      total = Number(count.value);
      rows = sources.map(row => ({ ...row, sourceName: row.name, parentActive: true, translationStatus: null }));
    } else {
      const where = sourceSearch(programsTable.name, programsTable.id);
      const [[count], sources] = await Promise.all([
        db.select({ value: sql<number>`count(*)` }).from(programsTable).where(where),
        db.select({ id: programsTable.id, sourceName: programsTable.name,
          name: sql<string>`coalesce(${programTranslationsTable.name},${programsTable.name})`, active: programsTable.isActive, parentActive: universitiesTable.isActive, policyVisible,
          hasDescription: sql<boolean>`length(trim(coalesce(${programTranslationsTable.description},${programsTable.description},'')))>0`,
          hasMedia: sql<boolean>`length(trim(coalesce(${universitiesTable.logoUrl},'')))>0`, updatedAt: programsTable.updatedAt, translationStatus: programTranslationsTable.status })
          .from(programsTable).innerJoin(universitiesTable, eq(programsTable.universityId, universitiesTable.id))
          .leftJoin(programTranslationsTable, and(eq(programTranslationsTable.programId, programsTable.id), eq(programTranslationsTable.locale, query.locale), eq(programTranslationsTable.status, "published")))
          .where(where).orderBy(asc(programsTable.name), asc(programsTable.id)).limit(query.pageSize).offset(offset),
      ]);
      total = Number(count.value);
      rows = sources;
    }
  }

  const entityType = query.kind === "country" ? "destination" : query.kind;
  // Publication inventory includes hidden/inactive sources too. Do not derive
  // the editorial relationship only from the visible public directory.
  const destinationByCountry = new Map<number, NonNullable<typeof directory>["destinations"][number]>();
  const ambiguousCountries = new Set<number>();
  for (const row of rows) {
    const country = directory?.countries.find(item => item.id === row.id);
    if (!country) continue;
    const matches = directory!.destinations.filter(destination => countryMatches(destination.country, country));
    if (matches.length === 1) destinationByCountry.set(row.id, matches[0]);
    else if (matches.length > 1) ambiguousCountries.add(row.id);
  }
  const entityIdFor = (row: Source) => query.kind === "country" ? destinationByCountry.get(row.id)?.id ?? null : row.id;
  const entityIds = rows.flatMap(row => { const id = entityIdFor(row); return id === null ? [] : [id]; });
  const [publication, localized] = await Promise.all([
    readPublicEntityPublicationSummaries({ entityType, entityIds, locale: query.locale }),
    entityType === "program" ? Promise.resolve(null) : readPublishedLocalizedEntities({ entityType, entityIds, locale: query.locale }),
  ]);
  // At most four scoped reads at a time; never fan out across the full catalogue.
  const seo = new Map<number, Awaited<ReturnType<typeof resolvePublishedEntitySeoState>>>();
  for (let at = 0; at < entityIds.length; at += 4) {
    await Promise.all(entityIds.slice(at, at + 4).map(async entityId => {
      seo.set(entityId, await resolvePublishedEntitySeoState({ entityType, entityId, locale: query.locale }));
    }));
  }
  const items = rows.map(row => {
    const entityId = entityIdFor(row);
    const snapshot = entityId === null ? undefined : localized?.snapshots.get(entityId);
    const entry = directory?.entries.find(item => item.country.id === row.id);
    const destination = destinationByCountry.get(row.id);
    const sourceCountry = directory?.countries.find(item => item.id === row.id);
    const title = snapshot?.title || row.name;
    const canonicalPath = snapshot?.canonicalPath || (query.kind === "country"
      ? entry?.canonicalPath ?? (sourceCountry ? catalogCountryRoute(sourceCountry, directory!.countries, directory!.destinations, query.locale) : null)
      : query.kind === "city" ? `/${query.locale}/cities/${publicCatalogRouteKey(row.id, title)}`
        : publicCatalogPath({ locale: query.locale, entityType: query.kind, id: row.id, name: title }));
    const availability = catalogAvailability({ kind: query.kind, active: row.active, parentActive: row.parentActive, policyVisible: row.policyVisible, ...(query.kind === "country" ? { countryRoute: Boolean(entry) } : {}) });
    const issues: CatalogInventoryIssue[] = [...availability.issues];
    const hasDescription = row.hasDescription || [snapshot?.summary, snapshot?.content.description, snapshot?.content.body, destination?.description, destination?.shortDescription].some(value => typeof value === "string" && value.trim().length > 0);
    const hasMedia = Boolean(destination?.heroImageUrl || destination?.thumbnailUrl || row.hasMedia);
    if (!hasDescription) issues.push("DESCRIPTION_MISSING");
    if (!hasMedia) issues.push("MEDIA_MISSING");
    const contentDelivery = query.kind === "program" && row.translationStatus === "published" ? "PUBLISHED_TRANSLATION" : snapshot ? "PUBLISHED_REVISION" : query.locale === "en" ? "SOURCE_CATALOG" : "SOURCE_FALLBACK";
    if (contentDelivery === "SOURCE_FALLBACK") issues.push("TRANSLATION_FALLBACK");
    const state = entityId === null ? undefined : publication.entries.get(entityId);
    return {
      kind: query.kind, sourceId: row.id, title, sourceTitle: row.sourceName, canonicalPath,
      sourceEditPath: catalogSourceEditPath(query.kind, row.id, row.sourceName, row.countryId), locale: query.locale,
      sourceUpdatedAt: row.updatedAt.toISOString(), visible: availability.visible, admissionsOpen: availability.admissionsOpen,
      contentDelivery, issues, publication: {
        status: ambiguousCountries.has(row.id) ? "AMBIGUOUS_CONTENT_LINK" : !publication.evaluated ? "NOT_EVALUATED" : state?.status ?? "NO_CONTENT_RECORD",
        revisionNumber: state?.revisionNumber ?? null, qualityStatus: state?.qualityStatus ?? null, translationStatus: state?.translationStatus ?? null,
      },
      seo: !publication.evaluated ? "NOT_EVALUATED" : entityId !== null && seo.get(entityId)?.indexable ? "INDEX_ELIGIBLE" : "NOINDEX",
    };
  });
  return { items, pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) }, publicationEvaluated: publication.evaluated };
}
