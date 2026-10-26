import { db, websitePagesTable as pages, websitePageBlocksTable as blocks, websitePageVersionsTable as versions, programsTable, universitiesTable, countriesTable, citiesTable, destinationsTable } from "@workspace/db";
import { and, asc, eq, desc, isNotNull, lte, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { ensureDetailSeo, inheritEnglishDetailStructure, parseDetailContent, type DetailContent, type DetailContentKind, type DetailSeoFacts } from "./websiteDetailContentContract";
import { countryAliases, countryMatches } from "./websiteCatalogFilters";
import { readPublishedDetailLayout } from "./websiteDetailLayouts";
import { detailTemplateSectionsForLocale } from "./websiteDetailLayoutContract";

export const detailContentSlug = (kind: DetailContentKind, entityId: number, locale: string) => `_detail-content-${kind}-${entityId}-${locale}`;
export const detailContentDigest = (pageId: number, updatedAt: string, content: DetailContent) => createHash("sha256").update(JSON.stringify({ pageId, updatedAt, content })).digest("hex");
export async function detailContentEntityExists(kind: DetailContentKind, entityId: number, executor: Pick<typeof db, "select"> = db) {
  const table = kind === "program" ? programsTable : kind === "university" ? universitiesTable : kind === "destination" ? countriesTable : citiesTable;
  return !!(await executor.select({ id: table.id }).from(table).where(eq(table.id, entityId)).limit(1).for("share"))[0];
}

const contextRecord = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const contextText = (value: unknown): string | undefined => typeof value === "string" && value.trim() ? value.trim() : undefined;
export function detailSeoFacts(kind: DetailContentKind, payload: unknown): DetailSeoFacts {
  const root = contextRecord(payload);
  const entity = contextRecord(kind === "destination" ? root?.destination : root?.data);
  const name = contextText(entity?.name) ?? contextText(entity?.programName);
  return {
    ...(kind === "city" && name ? { city: name } : contextText(entity?.city) || contextText(entity?.universityCity) ? { city: contextText(entity?.city) ?? contextText(entity?.universityCity) } : {}),
    ...(kind === "destination" && name ? { country: contextText(entity?.country) ?? name } : contextText(entity?.country) || contextText(entity?.universityCountry) ? { country: contextText(entity?.country) ?? contextText(entity?.universityCountry) } : {}),
    ...(kind === "university" && name ? { university: name } : contextText(entity?.universityName) ? { university: contextText(entity?.universityName) } : {}),
    ...(kind === "program" && name ? { program: name } : {}),
  };
}

/** Admin-only authoring facts. Unlike public projections, inactive/hidden rows remain readable. */
export async function readDetailContentEditorContext(kind: DetailContentKind, entityId: number, locale: string) {
  const meta = { locale, indexable: false, canonicalPath: "" };
  if (kind === "destination") {
    const [country] = await db.select({
      id: countriesTable.id,
      name: countriesTable.name,
      code: countriesTable.code,
    }).from(countriesTable).where(eq(countriesTable.id, entityId)).limit(1);
    if (!country) return null;
    const destinations = await db.select({
      name: destinationsTable.name,
      country: destinationsTable.country,
      shortDescription: destinationsTable.shortDescription,
      description: destinationsTable.description,
      language: destinationsTable.language,
      currency: destinationsTable.currency,
      climate: destinationsTable.climate,
    }).from(destinationsTable);
    const destination = destinations.find(row => countryMatches(row.country, country));
    const aliases = countryAliases(country).map(value => value.toLowerCase().trim());
    const countryScope = sql`lower(trim(${universitiesTable.country})) in (${sql.join(aliases.map(value => sql`${value}`), sql`, `)})`;
    const [[universityCount], [programCount], cityList, universityList, programList] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(universitiesTable).where(countryScope),
      db.select({ count: sql<number>`count(*)` }).from(programsTable).innerJoin(universitiesTable, eq(programsTable.universityId, universitiesTable.id)).where(countryScope),
      db.select({ id: citiesTable.id, name: citiesTable.name }).from(citiesTable)
        .where(eq(citiesTable.countryId, country.id)).orderBy(asc(citiesTable.name)).limit(24),
      db.select({ id: universitiesTable.id, name: universitiesTable.name, city: universitiesTable.city, type: universitiesTable.universityType })
        .from(universitiesTable).where(countryScope).orderBy(asc(universitiesTable.name)).limit(24),
      db.select({ id: programsTable.id, name: programsTable.name, degree: programsTable.degree, field: programsTable.field, language: programsTable.language, university: universitiesTable.name })
        .from(programsTable).innerJoin(universitiesTable, eq(programsTable.universityId, universitiesTable.id))
        .where(countryScope).orderBy(asc(programsTable.name)).limit(32),
    ]);
    return {
      destination: {
        catalogCountryId: country.id,
        name: destination?.name || country.name,
        country: country.name,
        filterCountry: country.name,
        shortDescription: destination?.shortDescription ?? null,
        description: destination?.description ?? null,
        language: destination?.language ?? null,
        currency: destination?.currency ?? null,
        climate: destination?.climate ?? null,
      },
      stats: { universityCount: Number(universityCount.count), programCount: Number(programCount.count) },
      cities: cityList, universities: universityList, programs: programList, meta,
    };
  }
  if (kind === "city") {
    const [city] = await db.select({
      id: citiesTable.id, name: citiesTable.name, country: countriesTable.name,
      countryCode: countriesTable.code,
    }).from(citiesTable).innerJoin(countriesTable, eq(citiesTable.countryId, countriesTable.id))
      .where(eq(citiesTable.id, entityId)).limit(1);
    if (!city) return null;
    const aliases = countryAliases({ name: city.country, code: city.countryCode }).map(value => value.toLowerCase().trim());
    const scope = and(
      sql`lower(trim(${universitiesTable.city})) = lower(trim(${city.name}))`,
      sql`lower(trim(${universitiesTable.country})) in (${sql.join(aliases.map(value => sql`${value}`), sql`, `)})`,
    );
    const [[universityCount], [programCount], languages, universityList, programList] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(universitiesTable).where(scope),
      db.select({ count: sql<number>`count(*)` }).from(programsTable).innerJoin(universitiesTable, eq(programsTable.universityId, universitiesTable.id)).where(scope),
      db.select({ language: sql<string>`min(btrim(${programsTable.language}))` }).from(programsTable)
        .innerJoin(universitiesTable, eq(programsTable.universityId, universitiesTable.id))
        .where(and(scope, sql`nullif(btrim(${programsTable.language}), '') is not null`))
        .groupBy(sql`lower(btrim(${programsTable.language}))`),
      db.select({ id: universitiesTable.id, name: universitiesTable.name, type: universitiesTable.universityType })
        .from(universitiesTable).where(scope).orderBy(asc(universitiesTable.name)).limit(24),
      db.select({ id: programsTable.id, name: programsTable.name, degree: programsTable.degree, field: programsTable.field, language: programsTable.language, university: universitiesTable.name })
        .from(programsTable).innerJoin(universitiesTable, eq(programsTable.universityId, universitiesTable.id))
        .where(scope).orderBy(asc(programsTable.name)).limit(32),
    ]);
    return { data: {
      ...city, filterCountry: city.country, filterCity: city.name,
      universityCount: Number(universityCount.count), programCount: Number(programCount.count),
      programLanguages: languages.map(row => row.language),
      universities: universityList, programs: programList,
    }, meta };
  }
  if (kind === "university") {
    // Keep the page editor coupled only to catalogue fields that it actually
    // renders. Selecting the complete table makes an unrelated, newly added
    // admissions column capable of blanking the whole editor when a local or
    // rolling deployment is temporarily one additive migration behind.
    const [university] = await db.select({
      id: universitiesTable.id,
      name: universitiesTable.name,
      country: universitiesTable.country,
      city: universitiesTable.city,
      website: universitiesTable.website,
      logoUrl: universitiesTable.logoUrl,
      description: universitiesTable.description,
      ranking: universitiesTable.ranking,
      isActive: universitiesTable.isActive,
      universityType: universitiesTable.universityType,
      taxType: universitiesTable.taxType,
      taxPercent: universitiesTable.taxPercent,
      qsRanking: universitiesTable.qsRanking,
      timesRanking: universitiesTable.timesRanking,
      shanghaiRanking: universitiesTable.shanghaiRanking,
      cwtsLeidenRanking: universitiesTable.cwtsLeidenRanking,
      address: universitiesTable.address,
      onlinePaymentUrl: universitiesTable.onlinePaymentUrl,
      cricosLink: universitiesTable.cricosLink,
      documentsLink: universitiesTable.documentsLink,
      currentFeeListLink: universitiesTable.currentFeeListLink,
      initialDepositOptions: universitiesTable.initialDepositOptions,
      admissionProcess: universitiesTable.admissionProcess,
      contactPersonName: universitiesTable.contactPersonName,
      contactPersonPhone: universitiesTable.contactPersonPhone,
      contactPersonEmail: universitiesTable.contactPersonEmail,
      status: universitiesTable.status,
      assignedStaffIds: universitiesTable.assignedStaffIds,
      createdAt: universitiesTable.createdAt,
      updatedAt: universitiesTable.updatedAt,
    }).from(universitiesTable).where(eq(universitiesTable.id, entityId)).limit(1);
    if (!university) return null;
    const [[programCount], programList] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(programsTable).where(eq(programsTable.universityId, entityId)),
      db.select({ id: programsTable.id, name: programsTable.name, degree: programsTable.degree, field: programsTable.field, language: programsTable.language, duration: programsTable.duration })
        .from(programsTable).where(eq(programsTable.universityId, entityId)).orderBy(asc(programsTable.name)).limit(32),
    ]);
    return { data: university, programs: programList, meta: { ...meta, programCount: Number(programCount.count) } };
  }
  const [row] = await db.select({
    programId: programsTable.id,
    universityId: programsTable.universityId,
    programName: programsTable.name,
    description: programsTable.description,
    degree: programsTable.degree,
    field: programsTable.field,
    language: programsTable.language,
    duration: programsTable.duration,
    tuitionFee: programsTable.tuitionFee,
    currency: programsTable.currency,
    scholarship: programsTable.scholarship,
    intakesText: programsTable.intakes,
    requirements: programsTable.requirements,
    commissionRate: programsTable.commissionRate,
    applicationFee: programsTable.applicationFee,
    advancedFee: programsTable.advancedFee,
    depositFee: programsTable.depositFee,
    serviceFeeAmount: programsTable.serviceFeeAmount,
    discountedFee: programsTable.discountedFee,
    languageFee: programsTable.languageFee,
    feeType: programsTable.feeType,
    minGpa: programsTable.minGpa,
    minLanguageScore: programsTable.minLanguageScore,
    quota: programsTable.quota,
    isActive: programsTable.isActive,
    createdAt: programsTable.createdAt,
    updatedAt: programsTable.updatedAt,
    universityName: universitiesTable.name,
    universityCountry: universitiesTable.country,
    universityCity: universitiesTable.city,
    universityWebsite: universitiesTable.website,
  }).from(programsTable).innerJoin(universitiesTable, eq(programsTable.universityId, universitiesTable.id))
    .where(eq(programsTable.id, entityId)).limit(1);
  if (!row) return null;
  return {
    data: {
      id: row.programId,
      universityId: row.universityId,
      name: row.programName,
      description: row.description,
      degree: row.degree,
      field: row.field,
      language: row.language,
      duration: row.duration,
      tuitionFee: row.tuitionFee,
      currency: row.currency,
      scholarship: row.scholarship,
      intakes: row.intakesText,
      requirements: row.requirements,
      commissionRate: row.commissionRate,
      applicationFee: row.applicationFee,
      advancedFee: row.advancedFee,
      depositFee: row.depositFee,
      serviceFeeAmount: row.serviceFeeAmount,
      discountedFee: row.discountedFee,
      languageFee: row.languageFee,
      feeType: row.feeType,
      minGpa: row.minGpa,
      minLanguageScore: row.minLanguageScore,
      quota: row.quota,
      isActive: row.isActive,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      universityName: row.universityName,
      universityCountry: row.universityCountry,
      universityCity: row.universityCity,
      universityWebsite: row.universityWebsite,
    },
    intakes: [], prices: [], related: [], meta,
  };
}
async function readPublishedDetailContentRecord(kind: DetailContentKind, entityId: number, locale: string): Promise<DetailContent | null> {
  const [row] = await db.select({ snapshot: versions.blocksSnapshot }).from(pages)
    .innerJoin(versions, eq(versions.pageId, pages.id))
    .where(and(eq(pages.slug, detailContentSlug(kind, entityId, locale)), eq(pages.template, `detail-content:${kind}`), isNotNull(versions.publishedAt), lte(versions.publishedAt, new Date())))
    .orderBy(desc(versions.versionNumber)).limit(1);
  const snapshot = row?.snapshot;
  const content = Array.isArray(snapshot) && snapshot.length === 1 && snapshot[0]?.blockType === "detail_content" ? parseDetailContent(snapshot[0].content) : null;
  return content?.kind === kind && content.entityId === entityId && content.locale === locale ? content : null;
}

export async function readPublishedDetailContent(kind: DetailContentKind, entityId: number, locale: string): Promise<DetailContent | null> {
  const [localized, english] = await Promise.all([
    readPublishedDetailContentRecord(kind, entityId, locale),
    locale === "en" ? Promise.resolve(null) : readPublishedDetailContentRecord(kind, entityId, "en"),
  ]);
  const bound = localized ? inheritEnglishDetailStructure(localized, english) : null;
  const layout = await readPublishedDetailLayout(kind);
  const templateSections = detailTemplateSectionsForLocale(layout, locale);
  if (!bound && !templateSections.length) return null;
  const pageOwned = bound ? ensureDetailSeo(bound, bound.seoMode === "auto" || !bound.seo
    ? detailSeoFacts(kind, await readDetailContentEditorContext(kind, entityId, locale))
    : {}) : null;
  return {
    ...(pageOwned ?? { version: 1, kind, entityId, locale, sections: [] }),
    ...(templateSections.length ? { templateSections } : {}),
  } as DetailContent;
}
export async function readDetailContentDraft(kind: DetailContentKind, entityId: number, locale: string) {
  const [page] = await db.select().from(pages).where(eq(pages.slug, detailContentSlug(kind, entityId, locale))).limit(1);
  const rows = page ? await db.select().from(blocks).where(eq(blocks.pageId, page.id)) : [];
  const parsed = rows.length === 1 && rows[0].blockType === "detail_content" ? parseDetailContent(rows[0].content) : null;
  if (page && (!parsed || parsed.kind !== kind || parsed.entityId !== entityId || parsed.locale !== locale || page.template !== `detail-content:${kind}`)) throw new Error("CONFLICT");
  const content: DetailContent = parsed ?? { version: 1, kind, entityId, locale, sections: [] };
  return { content, pageId: page?.id ?? null, updatedAt: page?.updatedAt.toISOString() ?? null,
    digest: page ? detailContentDigest(page.id, page.updatedAt.toISOString(), content) : null,
    published: await readPublishedDetailContent(kind, entityId, locale) };
}

/** Publishes one exact reviewed draft. Shared by the editor and bulk review queue. */
export async function publishDetailContentDraft(pageId: number, digest: string, reviewerId: number, reviewerIsSuperAdmin: boolean) {
  const content = await db.transaction(async tx => {
    await tx.execute(sql`SET LOCAL lock_timeout = '2s'`);
    await tx.execute(sql`SET LOCAL statement_timeout = '10s'`);
    const [page] = await tx.select().from(pages).where(eq(pages.id, pageId)).for("update");
    const rows = await tx.select().from(blocks).where(eq(blocks.pageId, pageId));
    const value = rows.length === 1 && rows[0].blockType === "detail_content" ? parseDetailContent(rows[0].content) : null;
    if (!page || !value || page.status !== "draft" || page.template !== `detail-content:${value.kind}` || page.slug !== detailContentSlug(value.kind, value.entityId, value.locale)) throw new Error("CONFLICT");
    if (!page.updatedBy || (!reviewerIsSuperAdmin && (page.updatedBy === reviewerId || page.createdBy === reviewerId))) throw new Error("REVIEWER_REQUIRED");
    if (!(await detailContentEntityExists(value.kind, value.entityId, tx)) || detailContentDigest(page.id, page.updatedAt.toISOString(), value) !== digest) throw new Error("CONFLICT");
    const [last] = await tx.select().from(versions).where(eq(versions.pageId, page.id)).orderBy(desc(versions.versionNumber)).limit(1);
    const now = new Date();
    await tx.insert(versions).values({ pageId: page.id, versionNumber: (last?.versionNumber ?? 0) + 1, blocksSnapshot: rows, metaSnapshot: { title: page.title, template: page.template, approval: { digest, authorId: page.updatedBy, reviewerId, externalFactVerification: false } }, publishedAt: now, createdBy: reviewerId });
    await tx.update(pages).set({ status: "published", robotsIndex: false, publishedAt: now }).where(eq(pages.id, page.id));
    return value;
  });
  return content;
}
