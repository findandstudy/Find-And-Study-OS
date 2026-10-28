import { Router } from "express";
import {
  auditLogsTable,
  citiesTable,
  countriesTable,
  db,
  programsTable,
  universitiesTable,
  websiteTranslationJobsTable,
} from "@workspace/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { requireAuth, requireRole } from "../lib/auth";
import { getSession, getSessionId } from "../lib/replitAuth";
import { canonicalCountryName, catalogName, countryMatches } from "../lib/websiteCatalogFilters";
import { enqueueWebsiteTranslations, readWebsiteTranslationProviderStatus } from "../lib/websiteTranslationQueue";
import { readDetailContentDraft } from "../lib/websiteDetailContent";

const router = Router();
router.use(requireAuth, requireRole("super_admin", "admin"), (_req, res, next) => { res.setHeader("Cache-Control", "private, no-store"); next(); });

type TranslationJobRow = typeof websiteTranslationJobsTable.$inferSelect;
type EntityLabel = {
  entityName: string | null;
  entityContext: string | null;
  entityExists: boolean;
};

const uniqueIds = (jobs: TranslationJobRow[], kind: TranslationJobRow["kind"]) => [
  ...new Set(jobs.filter(job => job.kind === kind).map(job => job.entityId)),
];

/**
 * Translation jobs deliberately keep a polymorphic catalogue reference rather
 * than duplicating a name that can become stale. Resolve the current canonical
 * catalogue label when the queue is read so the reviewer never has to infer a
 * page from an opaque `city #2` identifier. Missing source records remain
 * visible and are labelled explicitly instead of being associated with another
 * entity that happens to share the same numeric ID.
 */
export async function attachCanonicalEntityLabels(jobs: TranslationJobRow[]) {
  const destinationIds = uniqueIds(jobs, "destination");
  const cityIds = uniqueIds(jobs, "city");
  const universityIds = uniqueIds(jobs, "university");
  const programIds = uniqueIds(jobs, "program");

  const [destinationRows, cityRows, universityRows, programRows, catalogueCountries, catalogueCities] = await Promise.all([
    destinationIds.length
      ? db.select({ id: countriesTable.id, name: countriesTable.name }).from(countriesTable).where(inArray(countriesTable.id, destinationIds))
      : [],
    cityIds.length
      ? db.select({ id: citiesTable.id, name: citiesTable.name, countryId: citiesTable.countryId }).from(citiesTable).where(inArray(citiesTable.id, cityIds))
      : [],
    universityIds.length
      ? db.select({ id: universitiesTable.id, name: universitiesTable.name, city: universitiesTable.city, country: universitiesTable.country }).from(universitiesTable).where(inArray(universitiesTable.id, universityIds))
      : [],
    programIds.length
      ? db.select({ id: programsTable.id, name: programsTable.name, universityId: programsTable.universityId }).from(programsTable).where(inArray(programsTable.id, programIds))
      : [],
    universityIds.length
      ? db.select({ id: countriesTable.id, name: countriesTable.name, code: countriesTable.code }).from(countriesTable)
      : [] as Array<{ id: number; name: string; code: string }>,
    universityIds.length
      ? db.select({ name: citiesTable.name, countryId: citiesTable.countryId }).from(citiesTable)
      : [] as Array<{ name: string; countryId: number }>,
  ]);

  const relatedCountryIds = [...new Set(cityRows.map(city => city.countryId))];
  const relatedUniversityIds = [...new Set(programRows.map(program => program.universityId))];
  const [relatedCountries, relatedUniversities] = await Promise.all([
    relatedCountryIds.length
      ? db.select({ id: countriesTable.id, name: countriesTable.name }).from(countriesTable).where(inArray(countriesTable.id, relatedCountryIds))
      : [],
    relatedUniversityIds.length
      ? db.select({ id: universitiesTable.id, name: universitiesTable.name }).from(universitiesTable).where(inArray(universitiesTable.id, relatedUniversityIds))
      : [],
  ]);

  const destinations = new Map(destinationRows.map(row => [row.id, row]));
  const cities = new Map(cityRows.map(row => [row.id, row]));
  const countries = new Map(relatedCountries.map(row => [row.id, row.name]));
  const universities = new Map(universityRows.map(row => [row.id, row]));
  const programs = new Map(programRows.map(row => [row.id, row]));
  const programUniversities = new Map(relatedUniversities.map(row => [row.id, row.name]));

  const labelFor = (job: TranslationJobRow): EntityLabel => {
    if (job.kind === "destination") {
      const row = destinations.get(job.entityId);
      return row ? { entityName: row.name, entityContext: null, entityExists: true } : { entityName: null, entityContext: null, entityExists: false };
    }
    if (job.kind === "city") {
      const row = cities.get(job.entityId);
      return row ? { entityName: row.name, entityContext: countries.get(row.countryId) ?? null, entityExists: true } : { entityName: null, entityContext: null, entityExists: false };
    }
    if (job.kind === "university") {
      const row = universities.get(job.entityId);
      if (!row) return { entityName: null, entityContext: null, entityExists: false };
      const matchedCountry = catalogueCountries.find(country => countryMatches(row.country, country));
      const canonicalCity = row.city
        ? catalogueCities.find(city => catalogName(city.name) === catalogName(row.city!) && (!matchedCountry || city.countryId === matchedCountry.id))?.name ?? row.city
        : null;
      const canonicalCountry = canonicalCountryName(row.country, catalogueCountries);
      return { entityName: row.name, entityContext: [canonicalCity, canonicalCountry].filter(Boolean).join(" · ") || null, entityExists: true };
    }
    const row = programs.get(job.entityId);
    return row ? { entityName: row.name, entityContext: programUniversities.get(row.universityId) ?? null, entityExists: true } : { entityName: null, entityContext: null, entityExists: false };
  };

  return jobs.map(job => ({ ...job, ...labelFor(job) }));
}

async function direct(req: any, res: any) {
  const sid = getSessionId(req);
  const session = sid && !req.apiTokenAuth && !req.headers.authorization ? await getSession(sid) : null;
  if (!session || session.originalSid || session.user.id !== req.user.id) { res.status(403).json({ error: "Direct human session required" }); return false; }
  return true;
}

router.post("/", async (req, res) => {
  try {
    if (!(await direct(req, res))) return;
    const kind = req.body?.kind;
    const entityIds = req.body?.entityIds;
    const locales = req.body?.locales;
    if (!["destination", "city", "university", "program"].includes(kind) || !Array.isArray(entityIds) || !entityIds.length || entityIds.length > 500 || !entityIds.every((id: unknown) => Number.isSafeInteger(id) && Number(id) > 0) || !Array.isArray(locales) || !locales.length || locales.length > 22 || !locales.every((locale: unknown) => typeof locale === "string") || Object.keys(req.body).sort().join() !== "entityIds,kind,locales") return void res.status(400).json({ error: "Invalid translation batch" });
    const provider = await readWebsiteTranslationProviderStatus();
    if (!provider.configured) {
      res.status(409).json({
        error: "AI_PROVIDER_UNAVAILABLE",
        message: "Website AI is not ready. Open Settings > Integrations, save an enabled provider credential, then test the connection.",
        settingsPath: "/admin/settings?tab=integrations#ai-provider-integrations",
      });
      return;
    }
    res.status(202).json(await enqueueWebsiteTranslations({ kind, entityIds: [...new Set(entityIds)], locales: [...new Set(locales)], actorId: req.user!.id }));
  } catch (error) { const code = error instanceof Error ? error.message : "UNAVAILABLE"; res.status(code === "POLICY_DENIED" ? 403 : code === "BATCH_TOO_LARGE" ? 413 : code === "BUDGET_EXCEEDED" ? 429 : 503).json({ error: code }); }
});

router.get("/", async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : "";
  const batchId = typeof req.query.batchId === "string" ? req.query.batchId : "";
  const page = Math.max(1, Math.min(100_000, Number(req.query.page) || 1));
  const pageSize = Math.max(10, Math.min(100, Number(req.query.pageSize) || 50));
  const conditions = [status ? eq(websiteTranslationJobsTable.status, status) : undefined, batchId ? eq(websiteTranslationJobsTable.batchId, batchId) : undefined].filter(Boolean) as any[];
  const where = conditions.length ? and(...conditions) : undefined;
  const [jobRows, totals] = await Promise.all([
    db.select().from(websiteTranslationJobsTable).where(where).orderBy(desc(websiteTranslationJobsTable.createdAt), desc(websiteTranslationJobsTable.id)).limit(pageSize).offset((page - 1) * pageSize),
    db.select({ status: websiteTranslationJobsTable.status, count: sql<number>`count(*)::int` }).from(websiteTranslationJobsTable).groupBy(websiteTranslationJobsTable.status),
  ]);
  const items = await attachCanonicalEntityLabels(jobRows);
  res.json({ items, summary: Object.fromEntries(totals.map(item => [item.status, Number(item.count)])), pagination: { page, pageSize, hasMore: items.length === pageSize } });
});

router.post("/bulk-action", async (req, res) => {
  try {
    if (!(await direct(req, res))) return;
    const ids = Array.isArray(req.body?.ids) ? [...new Set(req.body.ids)] : [];
    const action = req.body?.action;
    if (!ids.length || ids.length > 100 || !ids.every(id => Number.isSafeInteger(id) && Number(id) > 0) || !["approve", "reject", "retry", "cancel", "publish"].includes(action) || Object.keys(req.body).sort().join() !== "action,ids") return void res.status(400).json({ error: "Invalid bulk action" });
    const jobs = await db.select().from(websiteTranslationJobsTable).where(inArray(websiteTranslationJobsTable.id, ids as number[]));
    const results: Array<{ id: number; status: string; error?: string }> = [];
    for (const job of jobs) {
      try {
        if (action === "approve") {
          if (job.status !== "review_required" || (req.user!.role !== "super_admin" && job.createdBy === req.user!.id)) throw new Error("REVIEWER_REQUIRED");
          const current = await readDetailContentDraft(job.kind as any, job.entityId, job.locale);
          if (!current.pageId || !current.digest) throw new Error("DRAFT_MISSING");
          await db.update(websiteTranslationJobsTable).set({ status: "approved", reviewedBy: req.user!.id, reviewedAt: new Date(), generatedPageId: current.pageId, generatedDigest: current.digest, errorCode: null, updatedAt: new Date() }).where(and(eq(websiteTranslationJobsTable.id, job.id), eq(websiteTranslationJobsTable.status, "review_required")));
          results.push({ id: job.id, status: "approved" });
        } else if (action === "reject") {
          if (job.status !== "review_required") throw new Error("INVALID_STATE");
          await db.update(websiteTranslationJobsTable).set({ status: "rejected", reviewedBy: req.user!.id, reviewedAt: new Date(), updatedAt: new Date() }).where(eq(websiteTranslationJobsTable.id, job.id));
          results.push({ id: job.id, status: "rejected" });
        } else if (action === "retry") {
          if (!["failed", "rejected"].includes(job.status)) throw new Error("INVALID_STATE");
          await db.update(websiteTranslationJobsTable).set({ status: "queued", attempts: 0, errorCode: null, nextAttemptAt: new Date(), reviewedBy: null, reviewedAt: null, updatedAt: new Date() }).where(eq(websiteTranslationJobsTable.id, job.id));
          results.push({ id: job.id, status: "queued" });
        } else if (action === "cancel") {
          if (!["queued", "retrying"].includes(job.status)) throw new Error("INVALID_STATE");
          await db.update(websiteTranslationJobsTable).set({ status: "cancelled", updatedAt: new Date() }).where(eq(websiteTranslationJobsTable.id, job.id));
          results.push({ id: job.id, status: "cancelled" });
        } else {
          if (job.status !== "approved" || !job.generatedPageId || !job.generatedDigest) throw new Error("INVALID_STATE");
          await db.update(websiteTranslationJobsTable).set({ status: "publish_queued", errorCode: null, nextAttemptAt: new Date(), updatedAt: new Date() }).where(eq(websiteTranslationJobsTable.id, job.id));
          results.push({ id: job.id, status: "publish_queued" });
        }
      } catch (error) { results.push({ id: job.id, status: job.status, error: error instanceof Error ? error.message : "UNAVAILABLE" }); }
    }
    await db.insert(auditLogsTable).values({ userId: req.user!.id, action: `website_translation_bulk_${action}`, resource: "website_translation_batch", changes: JSON.stringify({ requested: ids.length, results }) });
    res.json({ requested: ids.length, completed: results.filter(item => !item.error).length, failed: results.filter(item => item.error).length, results });
  } catch { res.status(503).json({ error: "Bulk action unavailable" }); }
});

export default router;
