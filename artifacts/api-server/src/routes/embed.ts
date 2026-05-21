import { Router, type IRouter, json } from "express";
import crypto from "crypto";
import { db, embedWidgetsTable, embedSubmissionsTable, leadsTable, programsTable, universitiesTable, documentsTable, studentsTable, applicationsTable, usersTable, programDocumentRequirementsTable, settingsTable } from "@workspace/db";
import { eq, ilike, sql, and, desc, inArray, isNotNull, isNull } from "drizzle-orm";
import { requireAuth, requireRole, logAudit } from "../lib/auth";
import { STAFF_ROLES } from "../lib/roles";
import rateLimit from "express-rate-limit";
import { sanitizeFileName, isAllowedMimeType, isPdf, validateUploadedFile, validateUploadedFileBuffer } from "../lib/fileUploadValidation";
import { buildDocNameFromParts } from "../lib/docNaming";
import { PgRateLimitStore } from "../lib/pgRateLimiter";
import { createApplicationForStudent } from "./public-apply";
import { getDocEquivalenceGroup, getRelevantGroupsForLevel, type DocEquivalenceGroupId } from "@workspace/doc-equivalence";
import { generateSecureToken } from "../lib/email";
import { applyLeadAssignmentRules } from "../lib/leadAssignment";
import { findOrUpsertEmbedLead } from "../lib/embedLeadDedup";

const TR_MAP: Record<string, string> = { "ç":"C","Ç":"C","ğ":"G","Ğ":"G","ı":"I","İ":"I","ö":"O","Ö":"O","ş":"S","Ş":"S","ü":"U","Ü":"U" };
function tlu(v: any, max: number): string | null {
  if (v === undefined || v === null) return null;
  const str = String(v).replace(/[çÇğĞıİöÖşŞüÜ]/g, (c) => TR_MAP[c] || c).toUpperCase().trim();
  if (!str) return null;
  return str.slice(0, max);
}
function pn(raw: any, cc: any, max: number): string | null {
  const phoneRaw = raw ? String(raw) : "";
  if (!phoneRaw) return null;
  const ccRaw = cc ? String(cc) : "";
  const combined = (ccRaw + phoneRaw).trim();
  const hasPlus = combined.startsWith("+");
  const digits = combined.replace(/\D/g, "");
  if (!digits) return null;
  return (hasPlus ? "+" + digits : digits).slice(0, max);
}
function pnOnly(raw: any, max: number): string | null {
  if (!raw) return null;
  const str = String(raw).trim();
  const hasPlus = str.startsWith("+");
  const digits = str.replace(/\D/g, "");
  if (!digits) return null;
  return (hasPlus ? "+" + digits : digits).slice(0, max);
}

const router: IRouter = Router();

// Embed widget /apply submissions include base64-encoded PDF/image documents
// in the JSON body (course-finder widget). Base64 inflates payload by ~33%
// so the global 1mb limit blocks legitimate submissions. Routes are gated by
// embedSubmitLimiter (applied BEFORE the parser so rate-limited requests
// never pay the parse cost) and per-widget allowed-domains validation.
// /lead carries only personal-info text fields, so it keeps a tight limit;
// only /apply needs the larger envelope for documents.
const embedApplyJson = json({ limit: "20mb" });
const embedLeadJson = json({ limit: "256kb" });

const EMBED_WINDOW_MS = 15 * 60 * 1000;
const embedSubmitLimiter = rateLimit({
  windowMs: EMBED_WINDOW_MS,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many submissions. Please try again later." },
  store: new PgRateLimitStore(EMBED_WINDOW_MS),
});

function validateDomain(widget: any, origin: string | undefined, referer: string | undefined): boolean {
  const domains = widget.allowedDomains as string[];
  if (!domains || domains.length === 0) return true;
  const check = origin || referer || "";
  if (!check) return false;
  try {
    const url = new URL(check);
    return domains.some(d => url.hostname === d || url.hostname.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

function getBaseUrl(req: any): string {
  const proto = req.get("x-forwarded-proto") || req.protocol || "https";
  const host = req.get("x-forwarded-host") || req.get("host") || "";
  return `${proto}://${host}`;
}

const VALID_COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;
const VALID_RADIUS_RE = /^\d{1,3}(px|rem|em|%)$/;
const VALID_FONT_RE = /^[a-zA-Z0-9\s,\-'"]+$/;

function sanitizeTheme(theme: any): Record<string, string> {
  if (!theme || typeof theme !== "object") return {};
  const safe: Record<string, string> = {};
  if (theme.primaryColor && VALID_COLOR_RE.test(theme.primaryColor)) safe.primaryColor = theme.primaryColor;
  if (theme.secondaryColor && VALID_COLOR_RE.test(theme.secondaryColor)) safe.secondaryColor = theme.secondaryColor;
  if (theme.buttonColor && VALID_COLOR_RE.test(theme.buttonColor)) safe.buttonColor = theme.buttonColor;
  if (theme.borderRadius && VALID_RADIUS_RE.test(theme.borderRadius)) safe.borderRadius = theme.borderRadius;
  if (theme.fontFamily && VALID_FONT_RE.test(theme.fontFamily)) safe.fontFamily = theme.fontFamily;
  return safe;
}

const VALID_MODES = ["combined", "course_finder", "application_only", "lead_form"];

router.get("/embed/widgets", requireAuth, requireRole(...STAFF_ROLES), async (req, res): Promise<void> => {
  const { page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
  const offset = (pageNum - 1) * limitNum;

  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(embedWidgetsTable);
  const rows = await db.select().from(embedWidgetsTable).orderBy(desc(embedWidgetsTable.createdAt)).limit(limitNum).offset(offset);

  res.json({ data: rows, meta: { total: Number(count), page: pageNum, limit: limitNum, totalPages: Math.ceil(Number(count) / limitNum) } });
});

router.get("/embed/widgets/:id", requireAuth, requireRole(...STAFF_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const [widget] = await db.select().from(embedWidgetsTable).where(eq(embedWidgetsTable.id, id));
  if (!widget) { res.status(404).json({ error: "Widget not found" }); return; }
  res.json(widget);
});

router.post("/embed/widgets", requireAuth, requireRole(...STAFF_ROLES), async (req, res): Promise<void> => {
  const { name, slug, mode, presetFilters, lockedFilters, hiddenFilters, visibleFilters, theme, allowedDomains } = req.body;
  if (!name || !slug) { res.status(400).json({ error: "name and slug are required" }); return; }
  const validMode = VALID_MODES.includes(mode) ? mode : "combined";
  const cleanSlug = slug.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-");
  try {
    const [widget] = await db.insert(embedWidgetsTable).values({
      name,
      slug: cleanSlug,
      mode: validMode,
      presetFilters: presetFilters || {},
      lockedFilters: lockedFilters || [],
      hiddenFilters: hiddenFilters || [],
      visibleFilters: visibleFilters || [],
      theme: theme || {},
      allowedDomains: allowedDomains || [],
    }).returning();
    await logAudit(req.user!.id, "create_embed_widget", "embed_widget", widget.id, { name, slug: cleanSlug }, req.ip);
    res.status(201).json(widget);
  } catch (err: any) {
    // Postgres unique-violation SQLSTATE is 23505. We previously matched on
    // `err.message.includes("duplicate")`, which only worked under the
    // English locale postgres uses in dev — production server returned a
    // localized/wrapped message and the check missed, surfacing as 500.
    // Match by SQLSTATE for a locale-independent detection.
    if (err?.code === "23505" || err?.cause?.code === "23505" || err?.message?.includes("duplicate") || err?.message?.includes("unique")) {
      res.status(409).json({ error: "A widget with this slug already exists" });
    } else {
      throw err;
    }
  }
});

router.patch("/embed/widgets/:id", requireAuth, requireRole(...STAFF_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const { name, slug, mode, presetFilters, lockedFilters, hiddenFilters, visibleFilters, theme, allowedDomains, isActive } = req.body;
  const updates: any = {};
  if (name !== undefined) updates.name = name;
  if (slug !== undefined) updates.slug = slug.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-");
  if (mode !== undefined) updates.mode = VALID_MODES.includes(mode) ? mode : "combined";
  if (presetFilters !== undefined) updates.presetFilters = presetFilters;
  if (lockedFilters !== undefined) updates.lockedFilters = lockedFilters;
  if (hiddenFilters !== undefined) updates.hiddenFilters = hiddenFilters;
  if (visibleFilters !== undefined) updates.visibleFilters = visibleFilters;
  if (theme !== undefined) updates.theme = theme;
  if (allowedDomains !== undefined) updates.allowedDomains = allowedDomains;
  if (isActive !== undefined) updates.isActive = isActive;

  try {
    const [widget] = await db.update(embedWidgetsTable).set(updates).where(eq(embedWidgetsTable.id, id)).returning();
    if (!widget) { res.status(404).json({ error: "Widget not found" }); return; }
    await logAudit(req.user!.id, "update_embed_widget", "embed_widget", id, updates, req.ip);
    res.json(widget);
  } catch (err: any) {
    if (err?.code === "23505" || err?.cause?.code === "23505" || err?.message?.includes("duplicate") || err?.message?.includes("unique")) {
      res.status(409).json({ error: "A widget with this slug already exists" });
    } else {
      throw err;
    }
  }
});

router.delete("/embed/widgets/:id", requireAuth, requireRole(...STAFF_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  await db.delete(embedWidgetsTable).where(eq(embedWidgetsTable.id, id));
  await logAudit(req.user!.id, "delete_embed_widget", "embed_widget", id, {}, req.ip);
  res.sendStatus(204);
});

router.get("/embed/widgets/:id/submissions", requireAuth, requireRole(...STAFF_ROLES), async (req, res): Promise<void> => {
  const widgetId = parseInt(req.params.id, 10);
  if (isNaN(widgetId)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const { page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [eq(embedSubmissionsTable.widgetId, widgetId)];
  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(embedSubmissionsTable).where(and(...conditions));
  const rows = await db.select().from(embedSubmissionsTable).where(and(...conditions)).orderBy(desc(embedSubmissionsTable.createdAt)).limit(limitNum).offset(offset);

  res.json({ data: rows, meta: { total: Number(count), page: pageNum, limit: limitNum, totalPages: Math.ceil(Number(count) / limitNum) } });
});

router.get("/embed/submissions", requireAuth, requireRole(...STAFF_ROLES), async (req, res): Promise<void> => {
  const { page = "1", limit = "20", widgetId } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
  const offset = (pageNum - 1) * limitNum;

  const conditions: any[] = [];
  if (widgetId) conditions.push(eq(embedSubmissionsTable.widgetId, parseInt(widgetId, 10)));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(embedSubmissionsTable).where(where);
  const rows = await db.select().from(embedSubmissionsTable).where(where).orderBy(desc(embedSubmissionsTable.createdAt)).limit(limitNum).offset(offset);

  res.json({ data: rows, meta: { total: Number(count), page: pageNum, limit: limitNum, totalPages: Math.ceil(Number(count) / limitNum) } });
});

router.get("/public/embed/:slug/config", async (req, res): Promise<void> => {
  const { slug } = req.params;
  const [widget] = await db.select().from(embedWidgetsTable).where(and(eq(embedWidgetsTable.slug, slug), eq(embedWidgetsTable.isActive, true)));
  if (!widget) { res.status(404).json({ error: "Widget not found" }); return; }

  const origin = req.headers.origin as string | undefined;
  const referer = req.headers.referer as string | undefined;
  if (!validateDomain(widget, origin, referer)) {
    res.status(403).json({ error: "Domain not allowed" });
    return;
  }

  res.json({
    id: widget.id,
    name: widget.name,
    slug: widget.slug,
    mode: widget.mode,
    presetFilters: widget.presetFilters,
    lockedFilters: widget.lockedFilters,
    hiddenFilters: widget.hiddenFilters,
    visibleFilters: widget.visibleFilters,
    theme: widget.theme,
  });
});

router.get("/public/embed/:slug/programs", async (req, res): Promise<void> => {
  const { slug } = req.params;
  const [widget] = await db.select().from(embedWidgetsTable).where(and(eq(embedWidgetsTable.slug, slug), eq(embedWidgetsTable.isActive, true)));
  if (!widget) { res.status(404).json({ error: "Widget not found" }); return; }

  const origin = req.headers.origin as string | undefined;
  const referer = req.headers.referer as string | undefined;
  if (!validateDomain(widget, origin, referer)) {
    res.status(403).json({ error: "Domain not allowed" });
    return;
  }

  const presetFilters = (widget.presetFilters || {}) as Record<string, any>;
  const lockedFilters = (widget.lockedFilters || []) as string[];
  const { country, city, universityType, universityId, level, language, search, feeMin, feeMax, page = "1", limit = "24" } = req.query as Record<string, string>;

  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [eq(programsTable.isActive, true)];

  function applyFilter(filterKey: string, userValue: string | undefined, applyFn: (val: string) => void) {
    const preset = presetFilters[filterKey];
    if (preset) {
      applyFn(String(preset));
    } else if (userValue && !lockedFilters.includes(filterKey)) {
      applyFn(userValue);
    }
  }

  applyFilter("country", country, v => conditions.push(eq(universitiesTable.country, v)));
  applyFilter("city", city, v => conditions.push(eq(universitiesTable.city, v)));
  applyFilter("universityType", universityType, v => conditions.push(eq(universitiesTable.universityType, v)));
  applyFilter("universityId", universityId, v => conditions.push(eq(programsTable.universityId, parseInt(v, 10))));
  applyFilter("level", level, v => conditions.push(ilike(programsTable.degree, `%${v}%`)));
  applyFilter("language", language, v => conditions.push(ilike(programsTable.language, v)));

  if (feeMin) conditions.push(sql`COALESCE(${programsTable.discountedFee}, ${programsTable.tuitionFee}) >= ${parseInt(feeMin, 10)}`);
  if (feeMax) conditions.push(sql`COALESCE(${programsTable.discountedFee}, ${programsTable.tuitionFee}) <= ${parseInt(feeMax, 10)}`);
  if (search) {
    conditions.push(sql`(${ilike(programsTable.name, `%${search}%`)} OR ${ilike(universitiesTable.name, `%${search}%`)})`);
  }

  const where = and(...conditions);

  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(programsTable).innerJoin(universitiesTable, eq(programsTable.universityId, universitiesTable.id)).where(where);

  const rows = await db.select({
    id: programsTable.id,
    name: programsTable.name,
    degree: programsTable.degree,
    field: programsTable.field,
    language: programsTable.language,
    duration: programsTable.duration,
    tuitionFee: programsTable.tuitionFee,
    currency: programsTable.currency,
    scholarship: programsTable.scholarship,
    intakes: programsTable.intakes,
    discountedFee: programsTable.discountedFee,
    feeType: programsTable.feeType,
    applicationFee: programsTable.applicationFee,
    depositFee: programsTable.depositFee,
    advancedFee: programsTable.advancedFee,
    languageFee: programsTable.languageFee,
    requirements: programsTable.requirements,
    universityId: programsTable.universityId,
    universityName: universitiesTable.name,
    universityLogoUrl: universitiesTable.logoUrl,
    universityCountry: universitiesTable.country,
    universityCity: universitiesTable.city,
    universityType: universitiesTable.universityType,
    universityWebsite: universitiesTable.website,
    universityDescription: universitiesTable.description,
    universityRanking: universitiesTable.ranking,
    universityQsRanking: universitiesTable.qsRanking,
    universityTimesRanking: universitiesTable.timesRanking,
    universityShanghaiRanking: universitiesTable.shanghaiRanking,
    universityCwtsLeidenRanking: universitiesTable.cwtsLeidenRanking,
  }).from(programsTable)
    .innerJoin(universitiesTable, eq(programsTable.universityId, universitiesTable.id))
    .where(where)
    .orderBy(universitiesTable.name, programsTable.name)
    .limit(limitNum)
    .offset(offset);

  res.json({ data: rows, meta: { total: Number(count), page: pageNum, limit: limitNum, totalPages: Math.ceil(Number(count) / limitNum) } });
});

/**
 * Cascading widget facets. Always applies admin-defined presetFilters.
 * Additionally applies the visitor's current selections (passed as query
 * params) to all OTHER facets — selecting Country=Turkey narrows City,
 * University, etc. but leaves the Country dropdown intact so the user
 * can switch.
 */
router.get("/public/embed/:slug/filters", async (req, res): Promise<void> => {
  try {
    const { slug } = req.params;
    const [widget] = await db.select().from(embedWidgetsTable).where(and(eq(embedWidgetsTable.slug, slug), eq(embedWidgetsTable.isActive, true)));
    if (!widget) { res.status(404).json({ error: "Widget not found" }); return; }

    const presetFilters = (widget.presetFilters || {}) as Record<string, any>;
    const userParams = req.query as Record<string, string | undefined>;
    const join = eq(programsTable.universityId, universitiesTable.id);

    type FacetKey = "country" | "city" | "universityType" | "universityId" | "level" | "language" | "fee";
    function buildWhere(excludeKey?: FacetKey) {
      const c = [eq(programsTable.isActive, true)];

      // Preset filters always apply (even on their own facet) — admin
      // pinned them and the visitor cannot override.
      if (presetFilters.country) c.push(eq(universitiesTable.country, String(presetFilters.country)));
      if (presetFilters.city) c.push(eq(universitiesTable.city, String(presetFilters.city)));
      if (presetFilters.universityType) c.push(eq(universitiesTable.universityType, String(presetFilters.universityType)));
      if (presetFilters.universityId) c.push(eq(programsTable.universityId, parseInt(String(presetFilters.universityId), 10)));
      if (presetFilters.level) c.push(ilike(programsTable.degree, `%${presetFilters.level}%`));
      if (presetFilters.language) c.push(ilike(programsTable.language, String(presetFilters.language)));

      // Visitor selections — exclude the facet's own key so its dropdown
      // still shows every choice.
      if (excludeKey !== "country" && !presetFilters.country && userParams.country) {
        const vals = userParams.country.split(",").map(s => s.trim()).filter(Boolean);
        if (vals.length === 1) c.push(eq(universitiesTable.country, vals[0]));
        else if (vals.length > 1) c.push(inArray(universitiesTable.country, vals));
      }
      if (excludeKey !== "city" && !presetFilters.city && userParams.city) {
        const vals = userParams.city.split(",").map(s => s.trim()).filter(Boolean);
        if (vals.length === 1) c.push(eq(universitiesTable.city, vals[0]));
        else if (vals.length > 1) c.push(inArray(universitiesTable.city, vals));
      }
      if (excludeKey !== "universityType" && !presetFilters.universityType && userParams.universityType) {
        const vals = userParams.universityType.split(",").map(s => s.trim()).filter(Boolean);
        if (vals.length === 1) c.push(eq(universitiesTable.universityType, vals[0]));
        else if (vals.length > 1) c.push(inArray(universitiesTable.universityType, vals));
      }
      if (excludeKey !== "universityId" && !presetFilters.universityId && userParams.universityId) {
        const vals = userParams.universityId.split(",").map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
        if (vals.length === 1) c.push(eq(programsTable.universityId, vals[0]));
        else if (vals.length > 1) c.push(inArray(programsTable.universityId, vals));
      }
      if (excludeKey !== "level" && !presetFilters.level && userParams.level) {
        const vals = userParams.level.split(",").map(s => s.trim()).filter(Boolean);
        if (vals.length === 1) c.push(ilike(programsTable.degree, `%${vals[0]}%`));
      }
      if (excludeKey !== "language" && !presetFilters.language && userParams.language) {
        const vals = userParams.language.split(",").map(s => s.trim()).filter(Boolean);
        if (vals.length === 1) c.push(ilike(programsTable.language, vals[0]));
      }
      if (excludeKey !== "fee") {
        const feeMin = userParams.feeMin ? parseInt(userParams.feeMin, 10) : NaN;
        if (Number.isFinite(feeMin) && feeMin >= 0) c.push(sql`COALESCE(${programsTable.discountedFee}, ${programsTable.tuitionFee}) >= ${feeMin}`);
        const feeMax = userParams.feeMax ? parseInt(userParams.feeMax, 10) : NaN;
        if (Number.isFinite(feeMax) && feeMax >= 0) c.push(sql`COALESCE(${programsTable.discountedFee}, ${programsTable.tuitionFee}) <= ${feeMax}`);
      }
      return and(...c);
    }

    const [countries, cities, universityTypes, universities, degrees, languages, feeRange] = await Promise.all([
      db.selectDistinct({ country: universitiesTable.country }).from(universitiesTable).innerJoin(programsTable, join).where(and(buildWhere("country"), sql`${universitiesTable.country} IS NOT NULL`)).orderBy(universitiesTable.country),
      db.selectDistinct({ city: universitiesTable.city }).from(universitiesTable).innerJoin(programsTable, join).where(and(buildWhere("city"), sql`${universitiesTable.city} IS NOT NULL`)).orderBy(universitiesTable.city),
      db.selectDistinct({ type: universitiesTable.universityType }).from(universitiesTable).innerJoin(programsTable, join).where(and(buildWhere("universityType"), sql`${universitiesTable.universityType} IS NOT NULL`)).orderBy(universitiesTable.universityType),
      db.selectDistinct({ id: universitiesTable.id, name: universitiesTable.name }).from(universitiesTable).innerJoin(programsTable, join).where(buildWhere("universityId")).orderBy(universitiesTable.name),
      db.selectDistinct({ degree: programsTable.degree }).from(programsTable).innerJoin(universitiesTable, join).where(and(buildWhere("level"), sql`${programsTable.degree} IS NOT NULL`)).orderBy(programsTable.degree),
      db.selectDistinct({ language: programsTable.language }).from(programsTable).innerJoin(universitiesTable, join).where(and(buildWhere("language"), sql`${programsTable.language} IS NOT NULL`)).orderBy(programsTable.language),
      db.select({ min: sql<number>`MIN(COALESCE(${programsTable.discountedFee}, ${programsTable.tuitionFee}))`, max: sql<number>`MAX(COALESCE(${programsTable.discountedFee}, ${programsTable.tuitionFee}))` }).from(programsTable).innerJoin(universitiesTable, join).where(and(buildWhere("fee"), sql`COALESCE(${programsTable.discountedFee}, ${programsTable.tuitionFee}) IS NOT NULL`)),
    ]);

    res.json({
      countries: countries.map(r => r.country).filter(Boolean),
      cities: cities.map(r => r.city).filter(Boolean),
      universityTypes: universityTypes.map(r => r.type).filter(Boolean),
      universities: universities.map(r => ({ id: r.id, name: r.name })),
      degrees: degrees.map(r => r.degree).filter(Boolean),
      languages: languages.map(r => r.language).filter(Boolean),
      feeRange: { min: feeRange[0]?.min ?? 0, max: feeRange[0]?.max ?? 100000 },
    });
  } catch (err: any) {
    console.error("[embed/filters] failed:", err?.message || err);
    res.status(500).json({ error: err?.message || "Failed to load filters" });
  }
});

// Step-1 lead capture for the embed widget. Mirrors /public/lead but is
// slug-aware so the lead is tagged with `embed:<slug>` and validated against
// the widget's allowed-domains list. Called by the widget JS when the user
// clicks "Continue" on the Personal Info step so the lead lands in the
// "new" column even if the user abandons the form before submitting docs.
router.post("/public/embed/:slug/lead", embedSubmitLimiter, embedLeadJson, async (req, res): Promise<void> => {
  const { slug } = req.params;
  const [widget] = await db.select().from(embedWidgetsTable).where(and(eq(embedWidgetsTable.slug, slug), eq(embedWidgetsTable.isActive, true)));
  if (!widget) { res.status(404).json({ error: "Widget not found" }); return; }

  const origin = req.headers.origin as string | undefined;
  const referer = req.headers.referer as string | undefined;
  if (!validateDomain(widget, origin, referer)) {
    res.status(403).json({ error: "Domain not allowed" });
    return;
  }

  const { firstName, lastName, email, phone, countryCode, programName, universityName, sourcePageUrl, utmSource, utmMedium, utmCampaign, utmTerm, utmContent, _hp } = req.body;
  if (_hp) { res.json({ success: true, leadId: null }); return; }

  if (!firstName || !lastName || !email) {
    res.status(400).json({ error: "firstName, lastName, and email are required" });
    return;
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    res.status(400).json({ error: "Invalid email format" });
    return;
  }

  const s = (v: any, max: number) => v ? String(v).slice(0, max) : null;

  try {
    // Dedup-aware insert: if the same email already submitted to this
    // widget within the dedup window, the existing lead row is reused
    // and refreshed with the latest payload. Prevents duplicates when
    // the visitor clicks Continue twice, refreshes, or reopens the
    // widget in another tab.
    const { lead } = await findOrUpsertEmbedLead({
      slug: widget.slug,
      ip: req.ip,
      fields: {
        firstName: tlu(firstName, 100)!,
        lastName: tlu(lastName, 100)!,
        email: s(email, 255)!,
        phone: pn(phone, countryCode, 50),
        interestedProgram: s(programName, 255),
        interestedCountry: s(universityName, 255),
        sourcePageUrl: s(sourcePageUrl, 500),
        utmSource: s(utmSource, 100),
        utmMedium: s(utmMedium, 100),
        utmCampaign: s(utmCampaign, 100),
        utmTerm: s(utmTerm, 100),
        utmContent: s(utmContent, 100),
      },
    });
    res.status(201).json({ success: true, leadId: lead.id });
  } catch (err: any) {
    console.error("[embed/lead] failed:", err?.message || err);
    res.status(500).json({ error: "Failed to save lead" });
  }
});

router.post("/public/embed/:slug/apply", embedSubmitLimiter, embedApplyJson, async (req, res): Promise<void> => {
  const { slug } = req.params;
  const [widget] = await db.select().from(embedWidgetsTable).where(and(eq(embedWidgetsTable.slug, slug), eq(embedWidgetsTable.isActive, true)));
  if (!widget) { res.status(404).json({ error: "Widget not found" }); return; }

  const origin = req.headers.origin as string | undefined;
  const referer = req.headers.referer as string | undefined;
  if (!validateDomain(widget, origin, referer)) {
    res.status(403).json({ error: "Domain not allowed" });
    return;
  }

  const { firstName, lastName, email, phone, countryCode, nationality, desiredLevel, desiredProgram, preferredUniversity, message, programId, programName, universityName, sourcePageUrl, utmSource, utmMedium, utmCampaign, utmTerm, utmContent, _hp, documents, aiExtractedData, leadId: incomingLeadId, motherName, fatherName, gender, dateOfBirth, passportNumber, passportIssueDate, passportExpiry, address, highSchool, graduationYear, gpa, languageScore } = req.body;

  if (_hp) { res.json({ success: true }); return; }

  if (!firstName || !lastName || !email) {
    res.status(400).json({ error: "firstName, lastName, and email are required" });
    return;
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    res.status(400).json({ error: "Invalid email format" });
    return;
  }

  let sourceWebsite: string | null = null;
  try { sourceWebsite = origin || (referer ? new URL(referer).origin : null) || null; } catch {}

  const s = (v: any, max: number) => v ? String(v).slice(0, max) : null;

  const rawDocs = Array.isArray(documents) ? documents.slice(0, 4) : [];
  const docArray = rawDocs.filter((d: any) => d && typeof d === 'object' && d.label && d.data && typeof d.data === 'string');

  for (const doc of docArray) {
    const mime = doc.mediaType || "";
    if (!mime || !isAllowedMimeType(mime)) {
      res.status(400).json({ error: "Sadece PDF, JPG, JPEG ve PNG dosyalar\u0131 y\u00fckleyebilirsiniz." });
      return;
    }
    const syntheticExt = isPdf(mime) ? ".pdf" : mime === "image/png" ? ".png" : ".jpg";
    const syntheticFileName = `document${syntheticExt}`;
    let buffer: Buffer;
    try {
      buffer = Buffer.from(doc.data || "", "base64");
    } catch {
      res.status(400).json({ error: "Invalid base64 file data" });
      return;
    }
    const validationError = await validateUploadedFileBuffer(syntheticFileName, mime, buffer);
    if (validationError) {
      const statusCode = validationError.type === "size_exceeded" ? 413 : 400;
      res.status(statusCode).json({ error: validationError.message });
      return;
    }
  }

  const totalDocSize = docArray.reduce((sum: number, d: any) => sum + (d.data?.length || 0), 0);
  if (totalDocSize > 20_000_000) {
    res.status(413).json({ error: "Documents too large. Maximum total size is ~15MB." });
    return;
  }

  // Resolve the lead row: prefer the leadId already issued during Step 1
  // (from POST /public/embed/:slug/lead). If absent or invalid, create a
  // fresh lead now so direct submissions still work. We update the
  // existing lead with the richer payload collected during the form.
  //
  // SECURITY: never trust a client-supplied leadId blindly — that would
  // let an attacker overwrite or convert any lead in the system by
  // guessing IDs (IDOR). Only reuse the lead when it was issued by the
  // SAME widget slug AND the submitted email matches the original lead's
  // email. Anything else falls back to inserting a fresh lead row.
  const incomingLeadIdNum = incomingLeadId ? parseInt(String(incomingLeadId), 10) : null;
  let leadRow: typeof leadsTable.$inferSelect | null = null;
  if (incomingLeadIdNum && Number.isFinite(incomingLeadIdNum) && incomingLeadIdNum > 0) {
    const [found] = await db.select().from(leadsTable).where(eq(leadsTable.id, incomingLeadIdNum));
    if (found) {
      const expectedSource = `embed:${widget.slug}`;
      const submittedEmail = String(email || "").toLowerCase().trim();
      const leadEmail = String(found.email || "").toLowerCase().trim();
      if (found.source === expectedSource && submittedEmail && leadEmail && submittedEmail === leadEmail) {
        leadRow = found;
      } else {
        console.warn(`[embed/apply] Rejected leadId=${incomingLeadIdNum} reuse — source/email mismatch (slug=${widget.slug})`);
      }
    }
  }

  const result = await db.transaction(async (tx) => {
    let lead;
    if (leadRow) {
      const [updated] = await tx.update(leadsTable).set({
        firstName: tlu(firstName, 100)!,
        lastName: tlu(lastName, 100)!,
        email: s(email, 255),
        phone: pn(phone, countryCode, 50),
        nationality: s(nationality, 100),
        interestedProgram: s(programName || desiredProgram, 255),
        notes: s(message, 2000),
      }).where(eq(leadsTable.id, leadRow.id)).returning();
      lead = updated;
    } else {
      // No verified leadId from Step-1 (cookie cleared, new tab, etc.).
      // Use the dedup helper so the same email submitting the same widget
      // again does not create another row alongside the Step-1 lead that
      // already exists.
      const upsertResult = await findOrUpsertEmbedLead({
        slug: widget.slug,
        ip: req.ip,
        tx,
        fields: {
          firstName: tlu(firstName, 100)!,
          lastName: tlu(lastName, 100)!,
          email: s(email, 255)!,
          phone: pn(phone, countryCode, 50),
          nationality: s(nationality, 100),
          interestedProgram: s(programName || desiredProgram, 255),
          notes: s(message, 2000),
        },
      });
      lead = upsertResult.lead;
    }

    const [submission] = await tx.insert(embedSubmissionsTable).values({
      widgetId: widget.id,
      firstName: tlu(firstName, 100)!,
      lastName: tlu(lastName, 100)!,
      email: s(email, 255)!,
      phone: pnOnly(phone, 50),
      countryCode: s(countryCode, 10),
      nationality: s(nationality, 100),
      desiredLevel: s(desiredLevel, 100),
      desiredProgram: s(desiredProgram, 255),
      preferredUniversity: s(universityName || preferredUniversity, 255),
      message: s(message, 2000),
      programId: programId ? parseInt(String(programId), 10) : null,
      programName: s(programName, 255),
      universityName: s(universityName, 255),
      sourceWebsite,
      sourcePageUrl: s(sourcePageUrl, 500),
      utmSource: s(utmSource, 100),
      utmMedium: s(utmMedium, 100),
      utmCampaign: s(utmCampaign, 100),
      utmTerm: s(utmTerm, 100),
      utmContent: s(utmContent, 100),
      leadId: lead.id,
      aiExtractedData: aiExtractedData || null,
      documentCount: docArray.length,
      status: "new",
    }).returning();

    return { leadId: lead.id, submissionId: submission.id };
  });

  // ─────────────────────────────────────────────────────────────────────
  // After the lead+submission row is saved, create a student account and
  // application so the embed submission shows up in the same Students /
  // Applications views as a public-apply submission. Mirrors the
  // public-apply flow but is more permissive about missing fields (the
  // embed widget collects fewer data points than the full Programs.tsx
  // dialog). On any failure we still return success for the lead — the
  // staff can finish the conversion manually from the lead row.
  // ─────────────────────────────────────────────────────────────────────
  let resultStudentId: number | null = null;
  let resultAppId: number | null = null;
  try {
    const normalizedEmail = String(email).toLowerCase().trim();
    const [existingUser] = await db.select().from(usersTable).where(eq(usersTable.email, normalizedEmail));

    if (existingUser && existingUser.role === "student") {
      const [existingStudent] = await db.select().from(studentsTable)
        .where(and(eq(studentsTable.userId, existingUser.id), isNull(studentsTable.deletedAt)));
      if (existingStudent) {
        resultStudentId = existingStudent.id;
        const reuseAppResult = await createApplicationForStudent(
          existingStudent.id,
          programId ? parseInt(String(programId), 10) : null,
          s(programName, 255),
          s(universityName, 255),
          existingStudent.gpa || s(gpa, 20) || null,
          existingStudent.languageScore || s(languageScore, 20) || null,
        );
        resultAppId = reuseAppResult.appId;
      }
    }

    if (!resultStudentId && (!existingUser || existingUser.role === "student")) {
      // Create a placeholder user + student record. Account starts inactive
      // and unverified; staff can invite the student later when they want
      // to give them portal access.
      let userId: number;
      if (existingUser) {
        userId = existingUser.id;
      } else {
        const passwordToken = generateSecureToken();
        const verificationToken = generateSecureToken();
        const [newUser] = await db.insert(usersTable).values({
          email: normalizedEmail,
          firstName: tlu(firstName, 100)!,
          lastName: tlu(lastName, 100)!,
          phone: pn(phone, countryCode, 50),
          role: "student",
          isActive: false,
          emailVerified: false,
          language: "en",
          passwordResetToken: crypto.createHash("sha256").update(passwordToken).digest("hex"),
          passwordResetExpires: new Date(Date.now() + 48 * 60 * 60 * 1000),
          emailVerificationToken: verificationToken,
          createdFromSource: `embed:${widget.slug}`,
        }).returning();
        userId = newUser.id;
      }

      // Reuse an archived student row for this email if present.
      const [archivedByEmail] = await db.select().from(studentsTable)
        .where(and(eq(studentsTable.email, normalizedEmail), isNotNull(studentsTable.deletedAt)));

      let newStudent: typeof studentsTable.$inferSelect;
      if (archivedByEmail) {
        await db.update(studentsTable).set({ deletedAt: null, userId }).where(eq(studentsTable.id, archivedByEmail.id));
        newStudent = { ...archivedByEmail, deletedAt: null, userId };
      } else {
        const normalizedGender = gender ? String(gender).toLowerCase() : null;
        const safeGender = (normalizedGender === "female" || normalizedGender === "male") ? normalizedGender : null;
        [newStudent] = await db.insert(studentsTable).values({
          userId,
          firstName: tlu(firstName, 100)!,
          lastName: tlu(lastName, 100)!,
          email: normalizedEmail,
          phone: pn(phone, countryCode, 50),
          nationality: s(nationality, 100),
          dateOfBirth: s(dateOfBirth, 20),
          gender: safeGender,
          motherName: tlu(motherName, 100),
          fatherName: tlu(fatherName, 100),
          passportNumber: s(passportNumber, 50),
          passportIssueDate: s(passportIssueDate, 20),
          passportExpiry: s(passportExpiry, 20),
          address: tlu(address, 300),
          highSchool: tlu(highSchool, 200),
          graduationYear: graduationYear ? parseInt(String(graduationYear), 10) || null : null,
          gpa: s(gpa, 20),
          languageScore: s(languageScore, 20),
        }).returning();
      }
      resultStudentId = newStudent.id;
      const newAppResult = await createApplicationForStudent(
        newStudent.id,
        programId ? parseInt(String(programId), 10) : null,
        s(programName, 255),
        s(universityName, 255),
        s(gpa, 20),
        s(languageScore, 20),
      );
      resultAppId = newAppResult.appId;
    }

    // Attach the uploaded documents to the student/application so they
    // surface in the application detail view, not just on the lead row.
    if (docArray.length > 0 && resultStudentId && resultAppId) {
      for (const doc of docArray) {
        if (!doc.label || !doc.data) continue;
        const docType = String(doc.label || "other").toLowerCase();
        const docName = buildDocNameFromParts(firstName, lastName, docType, doc.mediaType);
        await db.insert(documentsTable).values({
          studentId: resultStudentId,
          applicationId: resultAppId,
          leadId: result.leadId,
          name: docName,
          type: docType,
          status: "pending",
          fileData: doc.data,
          mimeType: doc.mediaType || null,
          sizeBytes: doc.sizeBytes || null,
        });
      }
    } else if (docArray.length > 0) {
      // Fallback: attach to the lead only (legacy behavior) so files are
      // not lost when student/app creation could not be performed.
      for (const doc of docArray) {
        if (!doc.label || !doc.data) continue;
        const docType = String(doc.label || "other").toLowerCase();
        const docName = buildDocNameFromParts(firstName, lastName, docType, doc.mediaType);
        await db.insert(documentsTable).values({
          leadId: result.leadId,
          name: docName,
          type: docType,
          status: "pending",
          fileData: doc.data,
          mimeType: doc.mediaType || null,
          sizeBytes: doc.sizeBytes || null,
        });
      }
    }

    // Auto-convert the lead → "converted" + flip student → "active" on
    // every successful full submit. Spec: hitting Submit at the end of
    // the widget IS the funnel-closing event for this lead, regardless
    // of whether every required document group was uploaded — staff
    // handle missing docs from the student/application detail view, not
    // from the leads kanban "new" column.
    if (resultStudentId && resultAppId) {
      try {
        const [settingsRow] = await db.select({
          autoConvertLeadEnabled: settingsTable.autoConvertLeadEnabled,
          autoConvertStudentStageKey: settingsTable.autoConvertStudentStageKey,
        }).from(settingsTable);
        const autoConvertEnabled = settingsRow?.autoConvertLeadEnabled !== false;
        const studentStageKey = settingsRow?.autoConvertStudentStageKey || "active";

        if (autoConvertEnabled) {
          await db.update(studentsTable)
            .set({ status: studentStageKey })
            .where(eq(studentsTable.id, resultStudentId));
          await db.update(leadsTable)
            .set({ status: "converted", convertedStudentId: resultStudentId })
            .where(eq(leadsTable.id, result.leadId));
          console.log(`[EMBED-APPLY] Auto-converted lead #${result.leadId} → student #${resultStudentId} (slug=${widget.slug}, stage=${studentStageKey})`);
        } else {
          console.log(`[EMBED-APPLY] Auto-convert disabled by settings; lead #${result.leadId} left untouched (slug=${widget.slug})`);
        }
      } catch (convertErr) {
        console.error("[EMBED-APPLY] Failed to auto-convert lead/student:", convertErr);
      }
    }
  } catch (postErr) {
    console.error("[EMBED-APPLY] Post-processing (student/app/auto-convert) failed:", postErr);
  }

  res.status(201).json({ success: true, submissionId: result.submissionId, leadId: result.leadId, studentId: resultStudentId, applicationId: resultAppId });
});

router.get("/public/embed/:slug/widget", async (req, res): Promise<void> => {
  const { slug } = req.params;
  const [widget] = await db.select().from(embedWidgetsTable).where(and(eq(embedWidgetsTable.slug, slug), eq(embedWidgetsTable.isActive, true)));
  if (!widget) { res.status(404).send("Widget not found"); return; }

  const baseUrl = getBaseUrl(req);
  const docMeta = await loadDocCatalogForEmbed();
  const html = generateWidgetHTML(slug, baseUrl, widget, docMeta);
  res.setHeader("Content-Type", "text/html");
  res.send(html);
});

/**
 * In-memory cache of the admin-managed document-type catalog
 * (catalog_options where category='documents'). Refreshed lazily every
 * 5 minutes so widget renders don't hit the DB on every request. On
 * failure we serve the last good cache (or {}), keeping the widget alive.
 */
type DocCatalogEntry = { label: string; icon: string; accept: string };
let docCatalogCache: Record<string, DocCatalogEntry> | null = null;
let docCatalogCacheUntil = 0;
const DOC_CATALOG_TTL_MS = 5 * 60 * 1000;
const DEFAULT_ACCEPT = ".pdf,.jpg,.jpeg,.png";

function humaniseKey(k: string): string {
  return String(k || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

const ACCEPT_RE = /^(\.[a-z0-9]{1,8})(,\.[a-z0-9]{1,8})*$/i;
const KEY_RE = /^[a-z0-9_\-]{1,64}$/i;
const RESERVED_KEYS = new Set(["__proto__", "prototype", "constructor"]);
function isSafeDocKey(k: unknown): k is string {
  return typeof k === "string" && KEY_RE.test(k) && !RESERVED_KEYS.has(k.toLowerCase());
}
function normaliseAccept(raw: unknown): string {
  const v = typeof raw === "string" ? raw.trim() : "";
  return ACCEPT_RE.test(v) ? v : DEFAULT_ACCEPT;
}
function normaliseShort(raw: unknown, fallback: string, max: number): string {
  const v = typeof raw === "string" ? raw.trim().slice(0, max) : "";
  return v || fallback;
}

let inflightDocCatalog: Promise<Record<string, DocCatalogEntry>> | null = null;
async function loadDocCatalogForEmbed(): Promise<Record<string, DocCatalogEntry>> {
  const now = Date.now();
  if (docCatalogCache && now < docCatalogCacheUntil) return docCatalogCache;
  // Dedupe concurrent cache-miss refreshes so we don't stampede the DB.
  if (inflightDocCatalog) return inflightDocCatalog;
  inflightDocCatalog = (async () => {
    try {
      const result = await db.execute(sql`SELECT value, metadata FROM catalog_options WHERE category = 'documents' AND is_active = true`);
      const rows = (result as { rows?: Array<{ value: string; metadata: { label?: unknown; icon?: unknown; accept?: unknown } | null }> }).rows ?? [];
      // Null-prototype map so untrusted catalog keys can't shadow built-in
      // object properties (e.g. a row with value="__proto__" can't pollute).
      const map: Record<string, DocCatalogEntry> = Object.create(null);
      for (const row of rows) {
        const rawKey = String(row.value);
        if (!isSafeDocKey(rawKey)) continue;
        const key = rawKey;
        const md = row.metadata || {};
        // Server-side normalisation: label/icon length-bound, accept must
        // match the allowed extension-list shape. This keeps admin-managed
        // metadata from breaking the widget or smuggling odd payloads,
        // even though the widget also escapes at render time.
        map[key] = {
          label: normaliseShort(md.label, humaniseKey(key), 80),
          icon: normaliseShort(md.icon, "📎", 8),
          accept: normaliseAccept(md.accept),
        };
      }
      docCatalogCache = map;
      docCatalogCacheUntil = Date.now() + DOC_CATALOG_TTL_MS;
      return map;
    } catch {
      docCatalogCache = docCatalogCache || {};
      docCatalogCacheUntil = Date.now() + DOC_CATALOG_TTL_MS;
      return docCatalogCache;
    } finally {
      inflightDocCatalog = null;
    }
  })();
  return inflightDocCatalog;
}
// Warm the cache on module load (best-effort, errors swallowed).
void loadDocCatalogForEmbed();

router.get("/public/embed/embed.js", async (_req, res): Promise<void> => {
  const baseUrl = getBaseUrl(_req);
  const js = generateEmbedScript(baseUrl);
  res.setHeader("Content-Type", "application/javascript");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.send(js);
});

function generateEmbedScript(baseUrl: string): string {
  return `(function(){
  var containers = document.querySelectorAll('[data-edcons-widget]');
  containers.forEach(function(el) {
    var slug = el.getAttribute('data-edcons-widget');
    if (!slug) return;
    var iframe = document.createElement('iframe');
    iframe.src = '${baseUrl}/api/public/embed/' + slug + '/widget';
    iframe.style.width = '100%';
    iframe.style.border = 'none';
    // No artificial minimum: the iframe must size itself to the widget's
    // actual content. The widget's own resizeParent() reports a height that
    // already includes any open modal or dropdown overlays, so a fixed
    // 780px floor here only produced empty space below the form.
    iframe.style.minHeight = '0';
    iframe.setAttribute('loading', 'lazy');
    iframe.setAttribute('allowfullscreen', 'true');
    el.appendChild(iframe);
    var savedScroll = null;
    var savedBodyStyle = null;
    var rafScheduled = false;
    var scrollGuardActive = false;
    function scrollGuardLoop(){
      if (!scrollGuardActive) return;
      if (savedScroll !== null && Math.abs(window.pageYOffset - savedScroll) > 1) {
        window.scrollTo(0, savedScroll);
      }
      var raf = window.requestAnimationFrame || function(cb){return setTimeout(cb,16);};
      raf(scrollGuardLoop);
    }
    function getIframeTop(){
      try{
        var rect = iframe.getBoundingClientRect();
        var sy = window.pageYOffset || document.documentElement.scrollTop || 0;
        if (savedScroll !== null) return rect.top + savedScroll;
        return rect.top + sy;
      }catch(e){return 0;}
    }
    function sendViewport(){
      try{
        if (!iframe.contentWindow) return;
        var rect = iframe.getBoundingClientRect();
        var scrollY = savedScroll !== null ? savedScroll : (window.pageYOffset || document.documentElement.scrollTop || 0);
        iframe.contentWindow.postMessage({
          type: 'edcons-viewport',
          slug: slug,
          parentScrollY: scrollY,
          parentViewportHeight: window.innerHeight || document.documentElement.clientHeight || 0,
          iframeTop: getIframeTop(),
          iframeHeight: rect.height
        }, '*');
      }catch(e){}
    }
    function scheduleSendViewport(){
      if (rafScheduled) return;
      rafScheduled = true;
      var raf = window.requestAnimationFrame || function(cb){return setTimeout(cb,16);};
      raf(function(){ rafScheduled = false; sendViewport(); });
    }
    function lockScroll(){
      if (savedBodyStyle !== null) return;
      var html = document.documentElement;
      var b = document.body;
      savedScroll = window.pageYOffset || html.scrollTop || 0;
      savedBodyStyle = {
        position: b.style.position,
        top: b.style.top,
        left: b.style.left,
        right: b.style.right,
        width: b.style.width,
        overflow: b.style.overflow,
        htmlOverflow: html.style.overflow,
        touchAction: b.style.touchAction
      };
      b.style.position = 'fixed';
      b.style.top = '-' + savedScroll + 'px';
      b.style.left = '0';
      b.style.right = '0';
      b.style.width = '100%';
      b.style.overflow = 'hidden';
      html.style.overflow = 'hidden';
      b.style.touchAction = 'none';
      if (!scrollGuardActive) {
        scrollGuardActive = true;
        var raf = window.requestAnimationFrame || function(cb){return setTimeout(cb,16);};
        raf(scrollGuardLoop);
      }
    }
    function unlockScroll(){
      if (savedBodyStyle === null) return;
      var html = document.documentElement;
      var b = document.body;
      b.style.position = savedBodyStyle.position;
      b.style.top = savedBodyStyle.top;
      b.style.left = savedBodyStyle.left;
      b.style.right = savedBodyStyle.right;
      b.style.width = savedBodyStyle.width;
      b.style.overflow = savedBodyStyle.overflow;
      html.style.overflow = savedBodyStyle.htmlOverflow;
      b.style.touchAction = savedBodyStyle.touchAction;
      savedBodyStyle = null;
      var s = savedScroll;
      function snap(){ if (s !== null) window.scrollTo(0, s); }
      snap();
      var raf = window.requestAnimationFrame || function(cb){return setTimeout(cb,16);};
      raf(snap);
      setTimeout(snap, 50);
      setTimeout(snap, 200);
      setTimeout(snap, 500);
      setTimeout(function(){
        scrollGuardActive = false;
        savedScroll = null;
      }, 1500);
    }
    window.addEventListener('message', function(e) {
      var d = e.data;
      if (!d || d.slug !== slug) return;
      if (d.type === 'edcons-resize') {
        iframe.style.height = d.height + 'px';
      } else if (d.type === 'edcons-modal-open') {
        try{
          // Always scroll the iframe top to the top of the host viewport
          // when the modal opens. With dynamic resize the iframe can be
          // 1500-3000px tall while the viewport is only ~800px, so even
          // when the iframe bottom is partially visible the modal (which
          // anchors itself near the visible top of the iframe) ends up
          // above or far below the user's actual viewport. Snapping the
          // iframe top to the viewport top guarantees the modal lands in
          // the visible area on every device, then lockScroll keeps the
          // host page from drifting while the modal is open.
          iframe.scrollIntoView({block: 'start'});
        }catch(err){}
        lockScroll();
        sendViewport();
        setTimeout(sendViewport, 120);
        setTimeout(sendViewport, 400);
      } else if (d.type === 'edcons-modal-close') {
        unlockScroll();
      } else if (d.type === 'edcons-viewport-request') {
        sendViewport();
      }
    });
    window.addEventListener('scroll', scheduleSendViewport, {passive:true});
    window.addEventListener('resize', scheduleSendViewport);
    window.addEventListener('orientationchange', scheduleSendViewport);
    iframe.addEventListener('load', function(){
      sendViewport();
      setTimeout(sendViewport, 200);
    });
  });
})();`;
}

function generateWidgetHTML(slug: string, baseUrl: string, widget: any, docMeta: Record<string, DocCatalogEntry>): string {
  const theme = sanitizeTheme(widget.theme);
  const primaryColor = theme.primaryColor || "#2563eb";
  const secondaryColor = theme.secondaryColor || "#1e40af";
  const buttonColor = theme.buttonColor || "#2563eb";
  const borderRadius = theme.borderRadius || "8px";
  const fontFamily = theme.fontFamily || "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  const safeMode = VALID_MODES.includes(widget.mode) ? widget.mode : "combined";

  const NATIONALITIES = ["Afghanistan","Albania","Algeria","Andorra","Angola","Antigua and Barbuda","Argentina","Armenia","Australia","Austria","Azerbaijan","Bahamas","Bahrain","Bangladesh","Barbados","Belarus","Belgium","Belize","Benin","Bhutan","Bolivia","Bosnia and Herzegovina","Botswana","Brazil","Brunei","Bulgaria","Burkina Faso","Burundi","Cabo Verde","Cambodia","Cameroon","Canada","Central African Republic","Chad","Chile","China","Colombia","Comoros","Congo","Costa Rica","Croatia","Cuba","Cyprus","Czech Republic","Denmark","Djibouti","Dominican Republic","East Timor","Ecuador","Egypt","El Salvador","Equatorial Guinea","Eritrea","Estonia","Eswatini","Ethiopia","Fiji","Finland","France","Gabon","Gambia","Georgia","Germany","Ghana","Greece","Grenada","Guatemala","Guinea","Guyana","Haiti","Honduras","Hungary","Iceland","India","Indonesia","Iran","Iraq","Ireland","Israel","Italy","Ivory Coast","Jamaica","Japan","Jordan","Kazakhstan","Kenya","Kiribati","Kosovo","Kuwait","Kyrgyzstan","Laos","Latvia","Lebanon","Liberia","Libya","Liechtenstein","Lithuania","Luxembourg","Madagascar","Malawi","Malaysia","Maldives","Mali","Malta","Marshall Islands","Mauritania","Mauritius","Mexico","Micronesia","Moldova","Monaco","Mongolia","Montenegro","Morocco","Mozambique","Myanmar","Namibia","Nauru","Nepal","Netherlands","New Zealand","Nicaragua","Niger","Nigeria","North Korea","North Macedonia","Norway","Oman","Pakistan","Palau","Palestine","Panama","Papua New Guinea","Paraguay","Peru","Philippines","Poland","Portugal","Qatar","Romania","Russia","Rwanda","Saint Kitts and Nevis","Saint Lucia","Samoa","San Marino","São Tomé and Príncipe","Saudi Arabia","Senegal","Serbia","Seychelles","Sierra Leone","Singapore","Slovakia","Slovenia","Solomon Islands","Somalia","South Africa","South Korea","South Sudan","Spain","Sri Lanka","Sudan","Suriname","Sweden","Switzerland","Syria","Tajikistan","Tanzania","Thailand","Togo","Tonga","Trinidad and Tobago","Tunisia","Turkey","Turkmenistan","Tuvalu","Uganda","Ukraine","United Arab Emirates","United Kingdom","United States","Uruguay","Uzbekistan","Vanuatu","Venezuela","Vietnam","Yemen","Zambia","Zimbabwe"];

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:${fontFamily};background:transparent;color:#1f2937;line-height:1.5}
.ew-root{max-width:1200px;margin:0 auto;padding:16px}
.ew-header{margin-bottom:20px}
.ew-header h2{font-size:1.5rem;font-weight:700;color:${primaryColor}}
.ew-filters{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:20px;padding:16px;background:#f8fafc;border-radius:${borderRadius};border:1px solid #e2e8f0}
.ew-filter-group{flex:1;min-width:140px}
.ew-filter-group label{display:block;font-size:0.75rem;font-weight:600;color:#64748b;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.5px}
.ew-filter-group select,.ew-filter-group input{width:100%;padding:8px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:0.875rem;background:#fff;color:#1f2937;outline:none}
.ew-filter-group select:focus,.ew-filter-group input:focus{border-color:${primaryColor};box-shadow:0 0 0 3px ${primaryColor}22}
.ew-results-info{font-size:0.875rem;color:#64748b;margin-bottom:12px}
.ew-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:20px;margin-bottom:20px}
.ew-card{border:1px solid rgba(226,232,240,.7);border-radius:16px;background:#fff;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 1px 3px rgba(0,0,0,.04);transition:box-shadow .25s,transform .25s,border-color .25s}
.ew-card:hover{box-shadow:0 12px 28px rgba(37,99,235,.10);transform:translateY(-4px);border-color:rgba(37,99,235,.25)}
.ew-card-banner{height:72px;display:flex;align-items:center;gap:12px;padding:0 18px;position:relative;overflow:hidden}
.ew-card-banner::after{content:"";position:absolute;inset:0;background:radial-gradient(circle at top right,rgba(255,255,255,.45),transparent 65%);pointer-events:none}
.ew-card-banner-g0{background:linear-gradient(to right,rgba(59,130,246,.15),rgba(99,102,241,.10) 60%,rgba(168,85,247,.05))}
.ew-card-banner-g1{background:linear-gradient(to right,rgba(16,185,129,.15),rgba(20,184,166,.10) 60%,rgba(6,182,212,.05))}
.ew-card-banner-g2{background:linear-gradient(to right,rgba(249,115,22,.15),rgba(244,63,94,.10) 60%,rgba(236,72,153,.05))}
.ew-card-banner-g3{background:linear-gradient(to right,rgba(139,92,246,.15),rgba(168,85,247,.10) 60%,rgba(99,102,241,.05))}
.ew-card-banner-g4{background:linear-gradient(to right,rgba(6,182,212,.15),rgba(14,165,233,.10) 60%,rgba(59,130,246,.05))}
.ew-card-logo-wrap{width:44px;height:44px;border-radius:12px;background:rgba(255,255,255,.92);box-shadow:0 4px 10px rgba(0,0,0,.08);display:flex;align-items:center;justify-content:center;flex-shrink:0;position:relative;z-index:1;overflow:hidden;border:2px solid rgba(255,255,255,.5)}
.ew-card-logo-wrap img{width:32px;height:32px;object-fit:contain}
.ew-card-logo-fallback{width:20px;height:20px;color:${primaryColor}}
.ew-card-uni-name{font-size:.75rem;font-weight:600;color:rgba(31,41,55,.78);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;position:relative;z-index:1}
.ew-card-pills{display:flex;gap:6px;flex-shrink:0;position:relative;z-index:1}
.ew-pill-soft{font-size:10px;font-weight:500;padding:3px 8px;border-radius:6px;background:rgba(255,255,255,.75);backdrop-filter:blur(4px);color:#475569;white-space:nowrap;box-shadow:0 1px 2px rgba(0,0,0,.04)}
.ew-pill-primary{font-size:10px;font-weight:500;padding:3px 8px;border-radius:6px;background:${primaryColor};color:#fff;white-space:nowrap;box-shadow:0 1px 2px rgba(0,0,0,.08)}
.ew-card-body{padding:18px;flex:1;display:flex;flex-direction:column}
.ew-card-title{font-size:15px;font-weight:700;color:#1f2937;line-height:1.35;margin-bottom:10px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:break-word;word-break:break-word;transition:color .2s}
.ew-card:hover .ew-card-title{color:${primaryColor}}
.ew-card-loc{display:flex;align-items:center;gap:6px;font-size:13px;color:#64748b;margin-bottom:14px}
.ew-card-loc svg{width:14px;height:14px;color:rgba(37,99,235,.5);flex-shrink:0}
.ew-card-loc span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ew-card-meta{display:grid;grid-template-columns:1fr 1fr;gap:10px 12px;background:rgba(241,245,249,.6);border-radius:10px;padding:12px;margin-bottom:14px}
.ew-meta-item{display:flex;align-items:center;gap:6px;font-size:12px;color:#475569;font-weight:500;min-width:0}
.ew-meta-item svg{width:14px;height:14px;flex-shrink:0}
.ew-meta-item .ew-meta-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ew-meta-icon-blue{color:#3b82f6}
.ew-meta-icon-green{color:#22c55e}
.ew-meta-icon-orange{color:#f97316}
.ew-meta-icon-emerald{color:#10b981}
.ew-fee-row{display:flex;align-items:center;gap:4px;flex-wrap:wrap}
.ew-fee-orig{text-decoration:line-through;color:rgba(148,163,184,.7);font-size:10px;font-weight:400}
.ew-fee-disc{color:#059669;font-weight:700}
.ew-fee-pct{font-size:9px;font-weight:700;color:#fff;background:#10b981;border-radius:3px;padding:1px 4px;line-height:1.2}
.ew-scholarship{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:500;padding:3px 9px;border-radius:9999px;border:1px solid rgba(16,185,129,.3);color:#059669;background:rgba(236,253,245,.6);margin-bottom:12px;align-self:flex-start}
.ew-scholarship svg{width:12px;height:12px}
.ew-card-actions{margin-top:auto;display:flex;gap:8px}
.ew-btn-info{width:40px;height:40px;border-radius:10px;border:1px solid rgba(226,232,240,.8);background:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;color:#64748b;flex-shrink:0;transition:all .2s}
.ew-btn-info:hover{border-color:rgba(37,99,235,.4);background:rgba(239,246,255,.5);color:${primaryColor}}
.ew-btn-info svg{width:16px;height:16px}
.ew-badge{font-size:.7rem;padding:3px 8px;border-radius:20px;background:#f1f5f9;color:#475569;font-weight:500;white-space:nowrap}
.ew-badge-primary{background:${primaryColor}15;color:${primaryColor}}
.ew-btn{display:inline-flex;align-items:center;justify-content:center;padding:10px 20px;background:${buttonColor};color:#fff;border:none;border-radius:10px;font-size:.875rem;font-weight:600;cursor:pointer;transition:box-shadow .25s,opacity .2s;flex:1;text-align:center;box-shadow:0 4px 10px rgba(37,99,235,.15)}
.ew-btn:hover{opacity:.95;box-shadow:0 6px 14px rgba(37,99,235,.25)}
.ew-btn-outline{background:transparent;color:${buttonColor};border:1.5px solid ${buttonColor};box-shadow:none}
.ew-btn-outline:hover{background:${buttonColor}08;box-shadow:none}
.ew-pagination{display:flex;justify-content:center;gap:8px;margin-top:20px}
.ew-pagination button{padding:8px 14px;border:1px solid #d1d5db;border-radius:6px;background:#fff;cursor:pointer;font-size:0.875rem;color:#374151}
.ew-pagination button:disabled{opacity:.4;cursor:default}
.ew-pagination button.active{background:${primaryColor};color:#fff;border-color:${primaryColor}}
.ew-modal-overlay{position:absolute;top:0;left:0;width:100%;min-height:100%;background:rgba(0,0,0,.5);z-index:9999;padding:0}
.ew-modal{position:absolute;left:50%;transform:translateX(-50%);top:24px;background:#fff;border-radius:${borderRadius};max-width:540px;width:calc(100% - 32px);max-height:600px;overflow-y:auto;padding:28px;box-shadow:0 20px 60px rgba(0,0,0,.15)}
.ew-modal h3{font-size:1.25rem;font-weight:700;margin-bottom:4px;color:#1f2937}
.ew-modal .ew-modal-subtitle{font-size:0.85rem;color:#64748b;margin-bottom:20px}
.ew-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.ew-form-group{margin-bottom:0}
.ew-form-group.full{grid-column:1/-1}
.ew-form-group label{display:block;font-size:0.8rem;font-weight:500;color:#374151;margin-bottom:4px}
.ew-form-group input,.ew-form-group select,.ew-form-group textarea{width:100%;padding:9px 12px;border:1px solid #d1d5db;border-radius:6px;font-size:0.875rem;background:#fff;color:#1f2937;outline:none}
.ew-form-group textarea{resize:vertical;min-height:80px}
.ew-form-group input:focus,.ew-form-group select:focus,.ew-form-group textarea:focus{border-color:${primaryColor};box-shadow:0 0 0 3px ${primaryColor}22}
.ew-form-actions{display:flex;gap:10px;margin-top:16px}
.ew-close-btn{position:absolute;top:16px;right:16px;background:none;border:none;font-size:1.5rem;cursor:pointer;color:#9ca3af;line-height:1}
.ew-close-btn:hover{color:#374151}
.ew-success{text-align:center;padding:40px 20px}
.ew-success svg{width:64px;height:64px;color:#22c55e;margin-bottom:16px}
.ew-success h3{font-size:1.3rem;color:#1f2937;margin-bottom:8px}
.ew-success p{color:#64748b}
.ew-empty{text-align:center;padding:60px 20px;color:#9ca3af}
.ew-empty svg{width:48px;height:48px;margin-bottom:12px;opacity:.5}
.ew-loading{display:flex;justify-content:center;padding:60px}
.ew-spinner{width:40px;height:40px;border:3px solid #e2e8f0;border-top-color:${primaryColor};border-radius:50%;animation:spin 0.8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.ew-skeleton{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px}
.ew-skeleton-card{height:240px;border-radius:${borderRadius};background:linear-gradient(90deg,#f1f5f9 25%,#e2e8f0 50%,#f1f5f9 75%);background-size:200% 100%;animation:shimmer 1.5s infinite}
@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
.ew-phone-group{display:flex;gap:6px}
.ew-phone-group select{width:100px;flex-shrink:0}
.ew-phone-group input{flex:1}
.ew-cc{position:relative;width:120px;flex-shrink:0}
.ew-cc-trigger{width:100%;height:38px;padding:0 8px;border:1px solid #d1d5db;border-radius:6px;background:#fff;color:#1f2937;font-size:0.875rem;display:flex;align-items:center;gap:6px;cursor:pointer;outline:none}
.ew-cc-trigger:focus{border-color:${primaryColor};box-shadow:0 0 0 3px ${primaryColor}22}
.ew-cc-trigger img{width:18px;height:13px;object-fit:cover;border-radius:2px;flex-shrink:0;display:block}
.ew-cc-trigger .ew-cc-code{flex:1;text-align:left;font-weight:500}
.ew-cc-trigger .ew-cc-caret{margin-left:auto;font-size:0.7rem;opacity:.6}
.ew-cc-list{position:absolute;top:calc(100% + 4px);left:0;right:0;min-width:260px;max-height:300px;overflow-y:auto;background:#fff;border:1px solid #e5e7eb;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.12);z-index:1000;padding:4px;display:none}
.ew-cc-search{position:sticky;top:0;display:block;width:calc(100% - 4px);margin:0 2px 4px;padding:7px 10px;border:1px solid #d1d5db;border-radius:6px;background:#fff;color:#1f2937;font-size:0.85rem;outline:none;box-sizing:border-box;z-index:2}
.ew-cc-search:focus{border-color:${primaryColor};box-shadow:0 0 0 3px ${primaryColor}22}
.ew-cc-item.ew-cc-hidden{display:none}
.ew-cc-empty{display:none;padding:10px;text-align:center;color:#94a3b8;font-size:0.8rem}
.ew-cc-empty.ew-cc-empty-show{display:block}
.ew-cc-list.open{display:block}
.ew-cc-list.ew-cc-list-up{top:auto;bottom:calc(100% + 4px)}
.ew-cc-item{display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:6px;cursor:pointer;font-size:0.85rem;color:#1f2937}
.ew-cc-item:hover,.ew-cc-item.active{background:${primaryColor}15}
.ew-cc-item img{width:18px;height:13px;object-fit:cover;border-radius:2px;flex-shrink:0}
.ew-cc-item .ew-cc-item-code{font-weight:600;min-width:42px}
.ew-cc-item .ew-cc-item-name{color:#64748b;font-size:0.78rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ew-hp{position:absolute;left:-9999px;opacity:0;height:0}
.ew-steps{display:flex;align-items:center;gap:0;margin-bottom:24px;padding:0 4px}
.ew-step{display:flex;align-items:center;gap:8px;flex:1}
.ew-step-num{width:28px;height:28px;border-radius:50%;background:#e2e8f0;color:#64748b;display:flex;align-items:center;justify-content:center;font-size:0.75rem;font-weight:700;flex-shrink:0;transition:all .3s}
.ew-step.active .ew-step-num{background:${primaryColor};color:#fff}
.ew-step.done .ew-step-num{background:#22c55e;color:#fff}
.ew-step-label{font-size:0.75rem;color:#94a3b8;font-weight:500;white-space:nowrap}
.ew-step.active .ew-step-label{color:${primaryColor};font-weight:600}
.ew-step.done .ew-step-label{color:#22c55e}
.ew-step-line{flex:1;height:2px;background:#e2e8f0;margin:0 4px}
.ew-step.done+.ew-step-line,.ew-step.done .ew-step-line{background:#22c55e}
.ew-doc-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px}
.ew-doc-slot{border:2px dashed #d1d5db;border-radius:8px;padding:14px;text-align:center;cursor:pointer;transition:all .2s;position:relative;min-height:90px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px}
.ew-doc-slot:hover{border-color:${primaryColor};background:${primaryColor}08}
.ew-doc-slot.uploaded{border-color:#22c55e;border-style:solid;background:#f0fdf4}
.ew-doc-slot input[type=file]{position:absolute;inset:0;opacity:0;cursor:pointer}
.ew-doc-icon{font-size:1.5rem}
.ew-doc-label{font-size:0.8rem;font-weight:600;color:#374151}
.ew-doc-hint{font-size:0.65rem;color:#94a3b8}
.ew-doc-status{font-size:0.7rem;color:#22c55e;font-weight:600}
.ew-doc-required{color:#ef4444;font-size:0.65rem}
.ew-doc-header{display:flex;align-items:center;gap:8px;margin-bottom:4px}
.ew-doc-header span:first-child{font-size:0.9rem;font-weight:600;color:#1f2937}
.ew-doc-header span:last-child{font-size:0.75rem;color:#64748b}
.ew-analyzing{text-align:center;padding:40px 20px}
.ew-analyzing-spinner{width:56px;height:56px;border:4px solid #e2e8f0;border-top-color:${primaryColor};border-radius:50%;animation:ew-spin 1s linear infinite;margin:0 auto 20px}
@keyframes ew-spin{to{transform:rotate(360deg)}}
.ew-analyzing h4{font-size:1.1rem;font-weight:600;color:#1f2937;margin-bottom:6px}
.ew-analyzing p{font-size:0.85rem;color:#64748b}
.ew-ai-badge{display:inline-flex;align-items:center;gap:4px;background:linear-gradient(135deg,#8b5cf6,#6366f1);color:#fff;font-size:0.7rem;font-weight:600;padding:3px 10px;border-radius:20px;margin-bottom:12px}
.ew-extracted-info{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:14px;margin-top:12px;margin-bottom:12px}
.ew-extracted-info h5{font-size:0.8rem;font-weight:600;color:#166534;margin-bottom:8px;display:flex;align-items:center;gap:6px}
.ew-extracted-grid{display:grid;grid-template-columns:1fr 1fr;gap:4px 12px}
.ew-extracted-item{font-size:0.75rem;color:#374151}
.ew-extracted-item span{color:#64748b}
.ew-btn-back{background:transparent;color:#64748b;border:1.5px solid #d1d5db;cursor:pointer;padding:10px 20px;border-radius:6px;font-size:0.875rem;font-weight:500;transition:all .2s}
.ew-btn-back:hover{background:#f8fafc;color:#374151}
.ew-detail-head{display:flex;align-items:center;gap:12px;margin-bottom:14px}
.ew-detail-logo{width:48px;height:48px;border-radius:12px;background:${primaryColor}15;display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden;border:2px solid ${primaryColor}33}
.ew-detail-logo img{width:36px;height:36px;object-fit:contain}
.ew-detail-logo svg{width:24px;height:24px;color:${primaryColor}}
.ew-detail-title{font-size:1.05rem;font-weight:700;color:#1f2937;line-height:1.3}
.ew-detail-uni{font-size:0.8rem;color:#64748b;margin-top:2px}
.ew-detail-loc{display:flex;align-items:center;gap:6px;font-size:0.85rem;color:#64748b;margin-bottom:14px}
.ew-detail-loc svg{width:14px;height:14px;color:${primaryColor}99}
.ew-detail-feebox{background:linear-gradient(to right,${primaryColor}0d,rgba(16,185,129,.05));border:1px solid ${primaryColor}1a;border-radius:12px;padding:14px;margin-bottom:14px}
.ew-detail-feeline{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin-bottom:6px}
.ew-detail-feeline .big{font-size:1.4rem;font-weight:700;color:#1f2937}
.ew-detail-feeline .orig{font-size:0.85rem;text-decoration:line-through;color:#9ca3af}
.ew-detail-feeline .pct{font-size:10px;font-weight:700;color:#fff;background:#10b981;border-radius:4px;padding:2px 6px;line-height:1.3}
.ew-detail-schol{display:flex;align-items:center;gap:6px;font-size:0.85rem;color:#059669;font-weight:500}
.ew-detail-schol svg{width:14px;height:14px}
.ew-detail-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px}
.ew-detail-row{display:flex;align-items:center;gap:10px;background:rgba(241,245,249,.6);border-radius:9px;padding:9px 12px;min-width:0}
.ew-detail-row svg{width:16px;height:16px;flex-shrink:0}
.ew-detail-row-text{min-width:0;flex:1}
.ew-detail-row-label{font-size:9px;text-transform:uppercase;letter-spacing:.05em;color:#94a3b8;font-weight:600;line-height:1.2}
.ew-detail-row-value{font-size:13px;font-weight:500;color:#1f2937;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1.3;margin-top:2px}
.ew-detail-section{margin-bottom:14px}
.ew-detail-section-label{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#94a3b8;font-weight:600;margin-bottom:6px}
.ew-detail-section-text{font-size:13px;color:#374151;line-height:1.55;white-space:pre-line}
.ew-detail-rankings{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px}
.ew-detail-rank-pill{display:inline-flex;align-items:center;gap:4px;font-size:11px;color:#475569;border:1px solid #e2e8f0;border-radius:9999px;padding:3px 10px;font-weight:500;background:#fff}
.ew-detail-rank-pill svg{width:11px;height:11px;color:#f59e0b}
.ew-detail-link{display:inline-flex;align-items:center;gap:6px;font-size:13px;color:${primaryColor};font-weight:600;text-decoration:none}
.ew-detail-link:hover{opacity:.8}
.ew-detail-link svg{width:13px;height:13px}
@media(max-width:640px){
  .ew-grid{grid-template-columns:1fr}
  .ew-filters{flex-direction:column}
  .ew-form-grid{grid-template-columns:1fr}
  .ew-modal{padding:20px}
  .ew-form-actions{flex-direction:column}
  .ew-doc-grid{grid-template-columns:1fr}
  .ew-steps{gap:0}
  .ew-step-label{display:none}
}
</style>
</head>
<body>
<div class="ew-root" id="ew-app"></div>
<script>
(function(){
var API='${baseUrl}/api/public/embed/${slug}';
var SLUG='${slug}';
var MODE='${safeMode}';
var config=null, filters=null, programs=[], meta={}, currentPage=1;
var formOpen=false, formProgram=null, formSubmitted=false, formLoading=false;
var programDocs=null;
// Document-type metadata is injected server-side from the admin-managed
// catalog_options table (category='documents'). Adding/editing a document
// type in the staff panel (Catalog > Options > Documents) shows up in this
// widget after the server's 5-minute cache refresh.
var DOC_META=${JSON.stringify(docMeta).replace(/<\/script/gi, "<\\/script").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029")};
function humanizeDocKey(k){
  return String(k||'').replace(/([A-Z])/g,' $1').replace(/[_-]+/g,' ').replace(/\\s+/g,' ').trim().replace(/^./,function(c){return c.toUpperCase();});
}
function loadProgramDocs(pid,cb){
  programDocs=null;
  if(!pid){if(cb)cb();return;}
  var apiBase=API.replace('/public/embed/'+SLUG,'');
  fetch(apiBase+'/public/programs/'+pid+'/document-requirements').then(function(r){
    return r.ok?r.json():[];
  }).then(function(rows){
    if(Array.isArray(rows)&&rows.length>0){
      programDocs=rows.slice().sort(function(a,b){return (a.sortOrder||0)-(b.sortOrder||0);}).map(function(r){
        var rawKey=String(r.documentType||'other');
        // Whitelist key shape and reject reserved property names so a
        // malicious documentType can't break out of HTML attributes
        // downstream or pollute object prototypes. esc() at sinks is a
        // second line of defence.
        var lowerKey=rawKey.toLowerCase();
        var key=(/^[a-z0-9_\\-]{1,64}$/i.test(rawKey)&&lowerKey!=='__proto__'&&lowerKey!=='prototype'&&lowerKey!=='constructor')?rawKey:'other';
        var meta=DOC_META[key]||{label:humanizeDocKey(key),icon:'\\ud83d\\udcce',accept:'.pdf,.jpg,.jpeg,.png'};
        return {key:key,label:meta.label,icon:meta.icon,accept:meta.accept||'.pdf,.jpg,.jpeg,.png',required:!!r.mandatory};
      });
    }
  }).catch(function(){}).finally(function(){if(cb)cb();});
}
var detailProgram=null, detailOpen=false;
var formStep='personal';
var uploadedDocs={};
var aiResult=null;
var extractedFields={};
var NATIONALITIES=${JSON.stringify(NATIONALITIES)};
// Comprehensive ITU-T E.164 country dialing codes for the custom flag dropdown.
// Sorted alphabetically by display name; the dropdown's search input handles
// selection. Tuples are [code, isoAlpha2, displayName]. Flags rendered via
// flagcdn PNG images instead of unicode regional-indicator emoji so they
// render consistently on Windows (which otherwise shows letter pairs).
var PHONE_CODES=[
  ['+93','AF','Afghanistan'],['+355','AL','Albania'],['+213','DZ','Algeria'],
  ['+376','AD','Andorra'],['+244','AO','Angola'],['+54','AR','Argentina'],
  ['+374','AM','Armenia'],['+61','AU','Australia'],['+43','AT','Austria'],
  ['+994','AZ','Azerbaijan'],['+973','BH','Bahrain'],['+880','BD','Bangladesh'],
  ['+375','BY','Belarus'],['+32','BE','Belgium'],['+501','BZ','Belize'],
  ['+229','BJ','Benin'],['+591','BO','Bolivia'],['+387','BA','Bosnia and Herzegovina'],
  ['+267','BW','Botswana'],['+55','BR','Brazil'],['+673','BN','Brunei'],
  ['+359','BG','Bulgaria'],['+226','BF','Burkina Faso'],['+257','BI','Burundi'],
  ['+855','KH','Cambodia'],['+237','CM','Cameroon'],['+1','CA','Canada'],
  ['+238','CV','Cape Verde'],['+236','CF','Central African Republic'],['+235','TD','Chad'],
  ['+56','CL','Chile'],['+86','CN','China'],['+57','CO','Colombia'],
  ['+269','KM','Comoros'],['+243','CD','Congo (DRC)'],['+242','CG','Congo (Republic)'],
  ['+506','CR','Costa Rica'],['+225','CI',"Côte d'Ivoire"],['+385','HR','Croatia'],
  ['+53','CU','Cuba'],['+357','CY','Cyprus'],['+420','CZ','Czechia'],
  ['+45','DK','Denmark'],['+253','DJ','Djibouti'],['+1','DO','Dominican Republic'],
  ['+593','EC','Ecuador'],['+20','EG','Egypt'],['+503','SV','El Salvador'],
  ['+240','GQ','Equatorial Guinea'],['+291','ER','Eritrea'],['+372','EE','Estonia'],
  ['+251','ET','Ethiopia'],['+679','FJ','Fiji'],['+358','FI','Finland'],
  ['+33','FR','France'],['+241','GA','Gabon'],['+220','GM','Gambia'],
  ['+995','GE','Georgia'],['+49','DE','Germany'],['+233','GH','Ghana'],
  ['+30','GR','Greece'],['+502','GT','Guatemala'],['+224','GN','Guinea'],
  ['+245','GW','Guinea-Bissau'],['+592','GY','Guyana'],['+509','HT','Haiti'],
  ['+504','HN','Honduras'],['+852','HK','Hong Kong'],['+36','HU','Hungary'],
  ['+354','IS','Iceland'],['+91','IN','India'],['+62','ID','Indonesia'],
  ['+98','IR','Iran'],['+964','IQ','Iraq'],['+353','IE','Ireland'],
  ['+972','IL','Israel'],['+39','IT','Italy'],['+1','JM','Jamaica'],
  ['+81','JP','Japan'],['+962','JO','Jordan'],['+7','KZ','Kazakhstan'],
  ['+254','KE','Kenya'],['+965','KW','Kuwait'],['+996','KG','Kyrgyzstan'],
  ['+856','LA','Laos'],['+371','LV','Latvia'],['+961','LB','Lebanon'],
  ['+266','LS','Lesotho'],['+231','LR','Liberia'],['+218','LY','Libya'],
  ['+423','LI','Liechtenstein'],['+370','LT','Lithuania'],['+352','LU','Luxembourg'],
  ['+853','MO','Macau'],['+261','MG','Madagascar'],['+265','MW','Malawi'],
  ['+60','MY','Malaysia'],['+960','MV','Maldives'],['+223','ML','Mali'],
  ['+356','MT','Malta'],['+222','MR','Mauritania'],['+230','MU','Mauritius'],
  ['+52','MX','Mexico'],['+373','MD','Moldova'],['+377','MC','Monaco'],
  ['+976','MN','Mongolia'],['+382','ME','Montenegro'],['+212','MA','Morocco'],
  ['+258','MZ','Mozambique'],['+95','MM','Myanmar'],['+264','NA','Namibia'],
  ['+977','NP','Nepal'],['+31','NL','Netherlands'],['+64','NZ','New Zealand'],
  ['+505','NI','Nicaragua'],['+227','NE','Niger'],['+234','NG','Nigeria'],
  ['+850','KP','North Korea'],['+389','MK','North Macedonia'],['+47','NO','Norway'],
  ['+968','OM','Oman'],['+92','PK','Pakistan'],['+970','PS','Palestine'],
  ['+507','PA','Panama'],['+675','PG','Papua New Guinea'],['+595','PY','Paraguay'],
  ['+51','PE','Peru'],['+63','PH','Philippines'],['+48','PL','Poland'],
  ['+351','PT','Portugal'],['+1','PR','Puerto Rico'],['+974','QA','Qatar'],
  ['+40','RO','Romania'],['+7','RU','Russia'],['+250','RW','Rwanda'],
  ['+966','SA','Saudi Arabia'],['+221','SN','Senegal'],['+381','RS','Serbia'],
  ['+248','SC','Seychelles'],['+232','SL','Sierra Leone'],['+65','SG','Singapore'],
  ['+421','SK','Slovakia'],['+386','SI','Slovenia'],['+252','SO','Somalia'],
  ['+27','ZA','South Africa'],['+82','KR','South Korea'],['+211','SS','South Sudan'],
  ['+34','ES','Spain'],['+94','LK','Sri Lanka'],['+249','SD','Sudan'],
  ['+597','SR','Suriname'],['+268','SZ','Eswatini'],['+46','SE','Sweden'],
  ['+41','CH','Switzerland'],['+963','SY','Syria'],['+886','TW','Taiwan'],
  ['+992','TJ','Tajikistan'],['+255','TZ','Tanzania'],['+66','TH','Thailand'],
  ['+670','TL','Timor-Leste'],['+228','TG','Togo'],['+1','TT','Trinidad and Tobago'],
  ['+216','TN','Tunisia'],['+90','TR','Turkey'],['+993','TM','Turkmenistan'],
  ['+256','UG','Uganda'],['+380','UA','Ukraine'],['+971','AE','UAE'],
  ['+44','GB','United Kingdom'],['+1','US','United States'],['+598','UY','Uruguay'],
  ['+998','UZ','Uzbekistan'],['+58','VE','Venezuela'],['+84','VN','Vietnam'],
  ['+967','YE','Yemen'],['+260','ZM','Zambia'],['+263','ZW','Zimbabwe']
];
var searchDebounce=null;
var userFilters={};
var parentViewport=null;
var modalElements=null;
var modalNotified=false;

var ALLOWED_MIMES=['application/pdf','image/jpeg','image/png'];
var ALLOWED_EXTS=['.pdf','.jpg','.jpeg','.png'];
var PDF_MAX=10*1024*1024;
var IMG_MAX=5*1024*1024;

function validateFileUpload(file){
  var ext=(file.name||'').toLowerCase().replace(/.*\\./,'.');
  if(ext.indexOf('.')<0)ext='';
  if(ALLOWED_MIMES.indexOf(file.type)<0||ALLOWED_EXTS.indexOf(ext)<0){
    return 'Sadece PDF, JPG, JPEG ve PNG dosyalar\\u0131 y\\u00fckleyebilirsiniz.';
  }
  var maxSize=file.type==='application/pdf'?PDF_MAX:IMG_MAX;
  if(file.size>maxSize){
    if(file.type==='application/pdf')return 'PDF dosyalar\\u0131 en fazla 10 MB olabilir.';
    return 'JPG, JPEG ve PNG dosyalar\\u0131 en fazla 5 MB olabilir.';
  }
  return null;
}

var LEVEL_DOCS={
  pathway:[
    {key:'passport',label:'Passport',icon:'\\ud83d\\udec2',accept:'.pdf,.jpg,.jpeg,.png',required:true},
    {key:'hs_diploma',label:'HS Diploma',icon:'\\ud83c\\udf93',accept:'.pdf,.jpg,.jpeg,.png',required:false},
    {key:'hs_transcript',label:'HS Transcript',icon:'\\ud83d\\udccb',accept:'.pdf,.jpg,.jpeg,.png',required:false},
    {key:'photo',label:'Photograph',icon:'\\ud83d\\udcf7',accept:'.jpg,.jpeg,.png',required:false}
  ],
  undergraduate:[
    {key:'hs_diploma',label:'HS Diploma',icon:'\\ud83c\\udf93',accept:'.pdf,.jpg,.jpeg,.png',required:true},
    {key:'hs_transcript',label:'HS Transcript',icon:'\\ud83d\\udccb',accept:'.pdf,.jpg,.jpeg,.png',required:true},
    {key:'passport',label:'Passport',icon:'\\ud83d\\udec2',accept:'.pdf,.jpg,.jpeg,.png',required:true},
    {key:'photo',label:'Photograph',icon:'\\ud83d\\udcf7',accept:'.jpg,.jpeg,.png',required:true}
  ],
  graduate:[
    {key:'bachelor_diploma',label:'Bachelor Diploma',icon:'\\ud83c\\udf93',accept:'.pdf,.jpg,.jpeg,.png',required:true},
    {key:'bachelor_transcript',label:'Bachelor Transcript',icon:'\\ud83d\\udccb',accept:'.pdf,.jpg,.jpeg,.png',required:true},
    {key:'passport',label:'Passport',icon:'\\ud83d\\udec2',accept:'.pdf,.jpg,.jpeg,.png',required:true},
    {key:'photo',label:'Photograph',icon:'\\ud83d\\udcf7',accept:'.jpg,.jpeg,.png',required:true},
    {key:'equivalency',label:'Equivalency Letter',icon:'\\ud83d\\udcdc',accept:'.pdf,.jpg,.jpeg,.png',required:true}
  ],
  doctorate:[
    {key:'master_diploma',label:'Master Diploma',icon:'\\ud83c\\udf93',accept:'.pdf,.jpg,.jpeg,.png',required:true},
    {key:'master_transcript',label:'Master Transcript',icon:'\\ud83d\\udccb',accept:'.pdf,.jpg,.jpeg,.png',required:true},
    {key:'bachelor_diploma',label:'Bachelor Diploma',icon:'\\ud83c\\udf93',accept:'.pdf,.jpg,.jpeg,.png',required:true},
    {key:'passport',label:'Passport',icon:'\\ud83d\\udec2',accept:'.pdf,.jpg,.jpeg,.png',required:true},
    {key:'photo',label:'Photograph',icon:'\\ud83d\\udcf7',accept:'.jpg,.jpeg,.png',required:true}
  ]
};

function degreeToLevel(degree){
  if(!degree)return 'undergraduate';
  var d=degree.toLowerCase();
  if(d.indexOf('phd')>=0||d.indexOf('doctor')>=0)return 'doctorate';
  if(d.indexOf('master')>=0||d.indexOf('graduate')>=0||d.indexOf('msc')>=0||d.indexOf('mba')>=0)return 'graduate';
  if(d.indexOf('pathway')>=0||d.indexOf('prep')>=0||d.indexOf('language')>=0||d.indexOf('foundation')>=0)return 'pathway';
  return 'undergraduate';
}

function fileToBase64(file){
  return new Promise(function(resolve,reject){
    var reader=new FileReader();
    reader.onload=function(){
      var result=reader.result;
      var base64=result.split(',')[1]||result;
      resolve({base64:base64,mediaType:file.type,size:file.size,isImage:file.type.startsWith('image/')});
    };
    reader.onerror=reject;
    reader.readAsDataURL(file);
  });
}

function $(s,p){return (p||document).querySelector(s)}
function $$(s,p){return (p||document).querySelectorAll(s)}
function el(tag,cls,html){var e=document.createElement(tag);if(cls)e.className=cls;if(html)e.innerHTML=html;return e}

function fetchJSON(url){
  return fetch(url).then(function(r){
    if(!r.ok)throw new Error(r.statusText);
    return r.json();
  });
}

function init(){
  fetchJSON(API+'/config').then(function(c){
    config=c;
    // loadPrograms also loads filters in parallel (cascading-aware).
    loadPrograms();
  }).catch(function(e){
    $('#ew-app').innerHTML='<div class="ew-empty"><p>Unable to load widget</p></div>';
  });
}

function buildUserFilterParams(){
  var params=new URLSearchParams();
  var pf=config.presetFilters||{};
  Object.keys(userFilters).forEach(function(k){
    if(!pf[k]&&userFilters[k]) params.set(k,userFilters[k]);
  });
  return params;
}

// Cascading: re-fetch facet options each time a selection changes so
// dropdowns only show choices compatible with the user's other picks.
function loadFilters(){
  return fetchJSON(API+'/filters?'+buildUserFilterParams().toString()).then(function(res){
    filters=res;
    pruneStaleSelections();
  }).catch(function(){});
}

function pruneStaleSelections(){
  if(!filters)return;
  var pf=config.presetFilters||{};
  var checks=[
    ['country',(filters.countries||[]).reduce(function(s,v){s[v]=1;return s;},{})],
    ['universityType',(filters.universityTypes||[]).reduce(function(s,v){s[v]=1;return s;},{})],
    ['universityId',(filters.universities||[]).reduce(function(s,u){s[String(u.id)]=1;return s;},{})],
    ['level',(filters.degrees||[]).reduce(function(s,v){s[v]=1;return s;},{})],
    ['language',(filters.languages||[]).reduce(function(s,v){s[v]=1;return s;},{})]
  ];
  checks.forEach(function(pair){
    var k=pair[0],valid=pair[1];
    if(pf[k])return;
    if(userFilters[k]&&!valid[String(userFilters[k])]){userFilters[k]='';}
  });
}

function loadPrograms(){
  var params=buildUserFilterParams();
  params.set('page',currentPage);
  params.set('limit','12');

  render(true);
  Promise.all([
    fetchJSON(API+'/programs?'+params.toString()).then(function(res){programs=res.data;meta=res.meta;}).catch(function(){}),
    loadFilters()
  ]).then(function(){
    render(false);
  });
}

function render(loading){
  var app=$('#ew-app');
  var html='';

  if(MODE!=='application_only'&&MODE!=='lead_form'){
    html+=renderFilters();
    if(loading){
      html+='<div class="ew-skeleton">';
      for(var i=0;i<6;i++)html+='<div class="ew-skeleton-card"></div>';
      html+='</div>';
    } else {
      html+='<div class="ew-results-info">'+meta.total+' program'+(meta.total!==1?'s':'')+' found</div>';
      if(programs.length===0){
        html+='<div class="ew-empty"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"/></svg><p>No programs match your search criteria</p></div>';
      } else {
        html+='<div class="ew-grid">';
        programs.forEach(function(p){html+=renderCard(p)});
        html+='</div>';
        html+=renderPagination();
      }
    }
  }

  if(MODE==='application_only'||MODE==='lead_form'){
    html+=renderFormInline();
  }

  app.innerHTML=html;
  bindEvents();
  if(formOpen) showModal();
  resizeParent();
}

function renderFilters(){
  if(!filters||!config)return '';
  var pf=config.presetFilters||{};
  var locked=config.lockedFilters||[];
  var hidden=config.hiddenFilters||[];
  var h='<div class="ew-filters">';

  h+='<div class="ew-filter-group" style="min-width:200px"><label>Search</label><input type="text" id="ew-search" placeholder="Search programs..." value="'+(userFilters.search||'')+'"></div>';

  if(!hidden.includes('country')&&!pf.country){
    h+='<div class="ew-filter-group"><label>Country</label><select id="ew-f-country"'+(locked.includes('country')?' disabled':'')+'><option value="">All Countries</option>';
    (filters.countries||[]).forEach(function(c){h+='<option value="'+esc(c)+'"'+(userFilters.country===c?' selected':'')+'>'+esc(c)+'</option>'});
    h+='</select></div>';
  }
  if(!hidden.includes('universityType')&&!pf.universityType){
    h+='<div class="ew-filter-group"><label>Type</label><select id="ew-f-universityType"'+(locked.includes('universityType')?' disabled':'')+'><option value="">All Types</option>';
    (filters.universityTypes||[]).forEach(function(t){h+='<option value="'+esc(t)+'"'+(userFilters.universityType===t?' selected':'')+'>'+esc(t)+'</option>'});
    h+='</select></div>';
  }
  if(!hidden.includes('universityId')&&!pf.universityId){
    h+='<div class="ew-filter-group"><label>University</label><select id="ew-f-universityId"'+(locked.includes('universityId')?' disabled':'')+'><option value="">All Universities</option>';
    (filters.universities||[]).forEach(function(u){h+='<option value="'+esc(String(u.id))+'"'+(userFilters.universityId==u.id?' selected':'')+'>'+esc(u.name)+'</option>'});
    h+='</select></div>';
  }
  if(!hidden.includes('level')&&!pf.level){
    h+='<div class="ew-filter-group"><label>Level</label><select id="ew-f-level"'+(locked.includes('level')?' disabled':'')+'><option value="">All Levels</option>';
    (filters.degrees||[]).forEach(function(d){h+='<option value="'+esc(d)+'"'+(userFilters.level===d?' selected':'')+'>'+esc(d)+'</option>'});
    h+='</select></div>';
  }
  if(!hidden.includes('language')&&!pf.language){
    h+='<div class="ew-filter-group"><label>Language</label><select id="ew-f-language"'+(locked.includes('language')?' disabled':'')+'><option value="">All Languages</option>';
    (filters.languages||[]).forEach(function(l){h+='<option value="'+esc(l)+'"'+(userFilters.language===l?' selected':'')+'>'+esc(l)+'</option>'});
    h+='</select></div>';
  }

  h+='</div>';
  return h;
}

var ICON_MAPPIN='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 7-8 13-8 13s-8-6-8-13a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/></svg>';
var ICON_LANG='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></svg>';
var ICON_CLOCK='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
var ICON_BOOK='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/></svg>';
var ICON_DOLLAR='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>';
var ICON_AWARD='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/></svg>';
var ICON_INFO='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';
var ICON_GRAD='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>';

function fmtFee(amount,cur){
  if(amount==null||isNaN(amount))return '';
  return (cur||'USD')+' '+Number(amount).toLocaleString();
}

function renderCard(p){
  var idx=(typeof p.id==='number'?p.id:0)%5;
  var loc=[p.universityCity,p.universityCountry].filter(Boolean).map(esc).join(', ');
  var hasDiscount=p.discountedFee&&p.tuitionFee&&p.discountedFee<p.tuitionFee;
  var effFee=p.discountedFee||p.tuitionFee;
  var pct=hasDiscount?Math.round(((p.tuitionFee-p.discountedFee)/p.tuitionFee)*100):0;
  var logoInner=p.universityLogoUrl?'<img src="'+esc(p.universityLogoUrl)+'" alt="" onerror="this.style.display=\\'none\\';this.nextElementSibling&&(this.nextElementSibling.style.display=\\'block\\')">'+'<span style="display:none" class="ew-card-logo-fallback">'+ICON_GRAD+'</span>':'<span class="ew-card-logo-fallback">'+ICON_GRAD+'</span>';

  var h='<div class="ew-card">';
  h+='<div class="ew-card-banner ew-card-banner-g'+idx+'">';
  h+='<div class="ew-card-logo-wrap">'+logoInner+'</div>';
  h+='<div class="ew-card-uni-name">'+esc(p.universityName||'')+'</div>';
  h+='<div class="ew-card-pills">';
  if(p.universityType)h+='<span class="ew-pill-soft">'+esc(p.universityType)+'</span>';
  if(p.degree)h+='<span class="ew-pill-primary">'+esc(p.degree)+'</span>';
  h+='</div></div>';

  h+='<div class="ew-card-body">';
  h+='<div class="ew-card-title">'+esc(p.name)+'</div>';
  if(loc)h+='<div class="ew-card-loc">'+ICON_MAPPIN+'<span>'+loc+'</span></div>';

  h+='<div class="ew-card-meta">';
  if(p.language)h+='<div class="ew-meta-item"><span class="ew-meta-icon-blue">'+ICON_LANG+'</span><span class="ew-meta-text">'+esc(p.language)+'</span></div>';
  if(p.duration)h+='<div class="ew-meta-item"><span class="ew-meta-icon-green">'+ICON_CLOCK+'</span><span class="ew-meta-text">'+esc(p.duration)+'</span></div>';
  if(p.intakes)h+='<div class="ew-meta-item"><span class="ew-meta-icon-orange">'+ICON_BOOK+'</span><span class="ew-meta-text">'+esc(p.intakes)+'</span></div>';
  if(effFee){
    h+='<div class="ew-meta-item"><span class="ew-meta-icon-emerald">'+ICON_DOLLAR+'</span><span class="ew-fee-row">';
    if(hasDiscount)h+='<span class="ew-fee-orig">'+esc(fmtFee(p.tuitionFee,p.currency))+'</span>';
    h+='<span'+(hasDiscount?' class="ew-fee-disc"':'')+'>'+esc(fmtFee(effFee,p.currency))+'</span>';
    if(hasDiscount)h+='<span class="ew-fee-pct">-'+pct+'%</span>';
    h+='</span></div>';
  }
  h+='</div>';

  if(p.scholarship&&p.scholarship>0){
    h+='<div class="ew-scholarship">'+ICON_AWARD+'<span>Scholarship: '+esc(fmtFee(p.scholarship,p.currency))+'</span></div>';
  }

  h+='<div class="ew-card-actions">';
  h+='<button type="button" class="ew-btn-info" aria-label="Details" data-info="'+p.id+'">'+ICON_INFO+'</button>';
  if(MODE!=='course_finder'){
    h+='<button class="ew-btn" data-apply="'+p.id+'">Apply Now</button>';
  }
  h+='</div>';

  h+='</div></div>';
  return h;
}

function renderPagination(){
  if(!meta||meta.totalPages<=1)return '';
  var h='<div class="ew-pagination">';
  h+='<button data-page="'+(currentPage-1)+'"'+(currentPage<=1?' disabled':'')+'>← Prev</button>';
  var start=Math.max(1,currentPage-2),end=Math.min(meta.totalPages,currentPage+2);
  for(var i=start;i<=end;i++){
    h+='<button data-page="'+i+'"'+(i===currentPage?' class="active"':'')+'>'+i+'</button>';
  }
  h+='<button data-page="'+(currentPage+1)+'"'+(currentPage>=meta.totalPages?' disabled':'')+'>Next →</button>';
  h+='</div>';
  return h;
}

function renderFormInline(){
  if(formSubmitted) return renderSuccess();
  return '<div style="max-width:580px;margin:0 auto">'+renderFormContent(null)+'</div>';
}

function renderSteps(){
  // Lead-form mode is single-step (contact only) — skip the stepper strip.
  if(MODE==='lead_form')return '';
  // Mirror the homepage non-login ApplyDialog ordering:
  // 1) Personal Info  2) Documents  3) Review & Submit
  var steps=['Personal Info','Documents','Review & Submit'];
  var stepKeys=['personal','documents','review'];
  var currentIdx=stepKeys.indexOf(formStep);
  // 'analyzing' is a transient sub-state of the documents step.
  if(formStep==='analyzing')currentIdx=1;
  var h='<div class="ew-steps">';
  for(var i=0;i<steps.length;i++){
    var cls='ew-step';
    if(i<currentIdx)cls+=' done';
    else if(i===currentIdx)cls+=' active';
    h+='<div class="'+cls+'"><div class="ew-step-num">'+(i<currentIdx?'\\u2713':(i+1))+'</div><div class="ew-step-label">'+steps[i]+'</div></div>';
    if(i<steps.length-1)h+='<div class="ew-step-line" style="background:'+(i<currentIdx?'#22c55e':'#e2e8f0')+'"></div>';
  }
  h+='</div>';
  return h;
}

function getFormLevel(){
  if(formProgram&&formProgram.degree)return degreeToLevel(formProgram.degree);
  var v=savedFormData.desiredLevel||'';
  if(v){
    v=v.toLowerCase();
    if(v.indexOf('phd')>=0||v.indexOf('doctor')>=0)return 'doctorate';
    if(v.indexOf('master')>=0)return 'graduate';
    if(v.indexOf('foundation')>=0||v.indexOf('pathway')>=0)return 'pathway';
  }
  return 'undergraduate';
}

function renderFormContent(prog){
  var h=renderSteps();
  // Shared helper: render a single form field, optionally tagged as
  // AI-extracted (green border + "AI" badge), used by both the personal
  // step and the review step. Declared in this scope so it can append to
  // the local h accumulator.
  function aiField(name,label,type,required,isHalf){
    var val=savedFormData[name]||'';
    var isAi=!!extractedFields[name];
    var cls='ew-form-group'+(isHalf?'':' full');
    var style=isAi?'border-color:#22c55e;background:#f0fdf4':'';
    h+='<div class="'+cls+'"><label>'+label+(required?' *':'')+(isAi?' <span style="color:#22c55e;font-size:0.65rem;font-weight:700;margin-left:4px">AI</span>':'')+'</label><input name="'+name+'" type="'+(type||'text')+'" value="'+esc(val)+'" style="'+style+'"'+(required?' required':'')+'></div>';
  }
  // Cross-platform country-code dropdown that uses flagcdn PNG images
  // instead of unicode flag emoji (which render as letter pairs on Windows).
  // Hidden input named "countryCode" so FormData/snapshotForm picks it up.
  function buildCcDropdown(sel){
    var ops=PHONE_CODES;
    var cur=null;
    for(var pi=0;pi<ops.length;pi++){if(ops[pi][0]===sel){cur=ops[pi];break;}}
    var trigInner=cur
      ?'<img src="https://flagcdn.com/24x18/'+cur[1].toLowerCase()+'.png" srcset="https://flagcdn.com/48x36/'+cur[1].toLowerCase()+'.png 2x" alt=""><span class="ew-cc-code">'+cur[0]+'</span><span class="ew-cc-caret">\\u25BC</span>'
      :'<span class="ew-cc-code" style="color:#9ca3af">Code</span><span class="ew-cc-caret">\\u25BC</span>';
    var listHtml='';
    for(var pj=0;pj<ops.length;pj++){
      var o=ops[pj];
      var lc=o[1].toLowerCase();
      var act=o[0]===sel?' active':'';
      listHtml+='<div class="ew-cc-item'+act+'" role="option" tabindex="-1" aria-selected="'+(o[0]===sel?'true':'false')+'" data-cc="'+o[0]+'" data-iso="'+o[1]+'" data-name="'+esc(String(o[2]||'').toLowerCase())+'">'+
        '<img src="https://flagcdn.com/24x18/'+lc+'.png" srcset="https://flagcdn.com/48x36/'+lc+'.png 2x" alt="">'+
        '<span class="ew-cc-item-code">'+o[0]+'</span>'+
        '<span class="ew-cc-item-name">'+o[2]+'</span>'+
      '</div>';
    }
    return '<div class="ew-cc"><input type="hidden" name="countryCode" value="'+esc(sel)+'">'+
      '<button type="button" class="ew-cc-trigger" aria-haspopup="listbox" aria-expanded="false">'+trigInner+'</button>'+
      '<div class="ew-cc-list" role="listbox">'+
        '<input type="text" class="ew-cc-search" placeholder="Search country or code" autocomplete="off">'+
        listHtml+
        '<div class="ew-cc-empty">No matches</div>'+
      '</div>'+
    '</div>';
  }
  if(formStep==='personal'){
    // Step 1 — Personal Info: collect ONLY the same basic contact fields
    // shown on the homepage non-login ApplyDialog (first/last name, email,
    // phone) plus an "Applying for" summary pill. Nationality / desired
    // level / preferred uni or program are deliberately deferred to the
    // Review step to keep the first screen short and welcoming.
    h+='<h3>Apply'+(prog?' \\u2014 '+esc(prog.name):'')+'</h3>';
    if(prog)h+='<div class="ew-modal-subtitle">'+esc(prog.universityName||'')+'</div>';
    else h+='<div class="ew-modal-subtitle">Tell us about yourself to get started.</div>';
    // Lightly tinted info card matching the portal's primary/5 callout.
    h+='<div style="background:${primaryColor}10;border:1px solid ${primaryColor}30;border-radius:12px;padding:14px;margin:14px 0">';
    h+='<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px"><span style="font-size:0.95rem">\\ud83d\\udc65</span><strong style="font-size:0.88rem;color:${primaryColor}">Personal Information</strong></div>';
    h+='<p style="font-size:0.78rem;color:#64748b;margin:0;line-height:1.45">Please provide your contact details. You will be able to review and update them before submitting.</p>';
    h+='</div>';
    h+='<form id="ew-personal-form" onsubmit="return false">';
    h+='<input type="text" name="_hp" class="ew-hp" tabindex="-1" autocomplete="off">';
    h+='<div class="ew-form-grid">';
    aiField('firstName','First Name','text',true,true);
    aiField('lastName','Last Name','text',true,true);
    aiField('email','Email','email',true,false);
    var fv=savedFormData;
    // Phone with a flag-prefixed country code picker (matches the portal's
    // PhoneCodePicker visual). Spans the full row.
    var sel=fv.countryCode||'';
    h+='<div class="ew-form-group full"><label>Phone *</label><div class="ew-phone-group">'+buildCcDropdown(sel)+'<input name="phone" placeholder="Phone number" value="'+esc(fv.phone||'')+'" required></div></div>';
    h+='</div>';
    if(prog){
      // "Applying for" summary pill (mirrors portal's bg-secondary/50 card).
      h+='<div style="background:#f1f5f9;border-radius:12px;padding:12px 14px;margin:14px 0;font-size:0.85rem">';
      h+='<div style="font-weight:600;color:#0f172a;margin-bottom:2px">Applying for:</div>';
      h+='<div style="color:#64748b">'+esc(prog.name)+(prog.universityName?' \\u2014 '+esc(prog.universityName):'')+'</div>';
      h+='</div>';
    }
    h+='<div class="ew-form-actions" style="margin-top:14px">';
    var nextLabel=(MODE==='lead_form')?(formLoading?'Submitting...':'Submit'):'Next \\u2192';
    h+='<button type="button" class="ew-btn" id="ew-next-personal"'+(formLoading?' disabled':'')+' style="background:linear-gradient(135deg,${primaryColor},${secondaryColor})">'+nextLabel+'</button>';
    if(formOpen)h+='<button type="button" class="ew-btn ew-btn-outline" id="ew-cancel">Cancel</button>';
    h+='</div></form>';
  } else if(formStep==='documents'){
    // Step 2 — Documents: upload + AI extract option.
    h+='<div class="ew-ai-badge">\\u2728 AI-Powered Document Analysis</div>';
    h+='<h3>Apply'+(prog?' \\u2014 '+esc(prog.name):'')+'</h3>';
    if(prog)h+='<div class="ew-modal-subtitle">'+esc(prog.universityName||'')+'</div>';
    h+='<div style="background:${primaryColor}08;border:1px solid ${primaryColor}25;border-radius:10px;padding:14px;margin:12px 0">';
    h+='<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><span style="font-size:1rem">\\u2728</span><strong style="font-size:0.85rem">AI-Powered Document Analysis</strong></div>';
    h+='<p style="font-size:0.78rem;color:#64748b;margin:0">Upload your documents and our AI will automatically extract your information. You can review and edit before submitting.</p>';
    h+='</div>';
    var docTypes=(programDocs&&programDocs.length>0)?programDocs:[
      {key:'passport',label:'Passport',icon:'\\ud83d\\udec2',accept:'.pdf,.jpg,.jpeg,.png',required:true},
      {key:'diploma',label:'Diploma',icon:'\\ud83c\\udf93',accept:'.pdf,.jpg,.jpeg,.png',required:false},
      {key:'transcript',label:'Transcript',icon:'\\ud83d\\udccb',accept:'.pdf,.jpg,.jpeg,.png',required:false},
      {key:'photo',label:'Photo',icon:'\\ud83d\\udcf7',accept:'.jpg,.jpeg,.png',required:false}
    ];
    h+='<div class="ew-doc-grid">';
    for(var i=0;i<docTypes.length;i++){
      var d=docTypes[i];
      var isUploaded=!!uploadedDocs[d.key];
      h+='<div class="ew-doc-slot'+(isUploaded?' uploaded':'')+'" data-doc-key="'+esc(d.key)+'">';
      h+='<input type="file" accept="'+esc(safeAccept(d.accept))+'" data-doc-input="'+esc(d.key)+'">';
      h+='<div class="ew-doc-icon">'+esc(d.icon)+'</div>';
      h+='<div class="ew-doc-label">'+esc(d.label)+'</div>';
      if(isUploaded){
        h+='<div class="ew-doc-status">\\u2713 Uploaded</div>';
      } else {
        h+='<div class="ew-doc-hint">Click to upload</div>';
        if(d.required)h+='<div class="ew-doc-required">Required</div>';
      }
      h+='</div>';
    }
    h+='</div>';
    h+='<div class="ew-form-actions" style="margin-top:16px">';
    h+='<button type="button" class="ew-btn" id="ew-analyze-btn" style="background:linear-gradient(135deg,${primaryColor},${secondaryColor})">\\u2728 Analyze with AI & Continue</button>';
    h+='<button type="button" class="ew-btn ew-btn-outline" id="ew-skip-btn">Skip & Continue</button>';
    h+='<button type="button" class="ew-btn-back" id="ew-back-personal">\\u2190 Back</button>';
    if(formOpen)h+='<button type="button" class="ew-btn ew-btn-outline" id="ew-cancel">Cancel</button>';
    h+='</div>';
  } else if(formStep==='analyzing'){
    h+='<div class="ew-analyzing">';
    h+='<div class="ew-analyzing-spinner"></div>';
    h+='<h4>\\u2728 AI is analyzing your documents...</h4>';
    h+='<p>This usually takes a few seconds</p>';
    h+='</div>';
  } else if(formStep==='review'){
    // Step 3 — Review & Submit: show every field editable, AI-extracted
    // ones tagged with the green AI badge. Submit happens here.
    h+='<h3>Review & Submit</h3>';
    if(prog)h+='<div class="ew-modal-subtitle">'+esc(prog.name)+' \\u2014 '+esc(prog.universityName||'')+'</div>';
    else h+='<div class="ew-modal-subtitle">Review your details and submit your application</div>';
    var eKeys=Object.keys(extractedFields);
    if(eKeys.length>0){
      h+='<div class="ew-extracted-info" style="margin-bottom:16px">';
      h+='<h5>\\u2713 AI extracted '+eKeys.length+' field'+(eKeys.length!==1?'s':'')+'. Please review and complete the form.</h5>';
      h+='</div>';
    }
    h+='<form id="ew-form">';
    h+='<input type="text" name="_hp" class="ew-hp" tabindex="-1" autocomplete="off">';
    h+='<div class="ew-form-grid">';
    var fv2=savedFormData;
    aiField('firstName','First Name','text',true,true);
    aiField('lastName','Last Name','text',true,true);
    aiField('email','Email','email',true,true);
    var sel2=fv2.countryCode||'';
    h+='<div class="ew-form-group"><label>Phone *</label><div class="ew-phone-group">'+buildCcDropdown(sel2)+'<input name="phone" placeholder="Phone number" value="'+esc(fv2.phone||'')+'" required></div></div>';
    var natVal=savedFormData.nationality||'';
    var natIsAi=!!extractedFields.nationality;
    var natStyle=natIsAi?'border-color:#22c55e;background:#f0fdf4':'';
    var natOpts='<option value="">Select nationality...</option>';
    for(var ni=0;ni<NATIONALITIES.length;ni++){var nc=NATIONALITIES[ni];natOpts+='<option value="'+esc(nc)+'"'+(natVal===nc?' selected':'')+'>'+esc(nc)+'</option>';}
    h+='<div class="ew-form-group"><label>Nationality *'+(natIsAi?' <span style="color:#22c55e;font-size:0.65rem;font-weight:700;margin-left:4px">AI</span>':'')+'</label><select name="nationality" style="'+natStyle+'" required>'+natOpts+'</select></div>';
    h+='<div class="ew-form-group"><label>Desired Level</label><select name="desiredLevel"><option value="">Select...</option><option value="Foundation"'+(fv2.desiredLevel==='Foundation'?' selected':'')+'>Foundation</option><option value="Associate"'+(fv2.desiredLevel==='Associate'?' selected':'')+'>Associate</option><option value="Bachelor"'+(fv2.desiredLevel==='Bachelor'?' selected':'')+'>Bachelor</option><option value="Master"'+(fv2.desiredLevel==='Master'?' selected':'')+'>Master</option><option value="PhD"'+(fv2.desiredLevel==='PhD'?' selected':'')+'>PhD</option></select></div>';
    if(!prog){
      h+='<div class="ew-form-group"><label>Preferred University</label><input name="preferredUniversity" value="'+esc(fv2.preferredUniversity||'')+'"></div>';
      h+='<div class="ew-form-group"><label>Desired Program</label><input name="desiredProgram" value="'+esc(fv2.desiredProgram||'')+'"></div>';
    }
    // Personal details (most often AI-extracted from passport / transcripts).
    // These are required for application processing on the staff side, so they
    // are marked with "*" even though the AI usually fills them automatically.
    aiField('dateOfBirth','Date of Birth','date',true,true);
    // Gender — render as a select since aiField only supports input types.
    var gVal=savedFormData.gender||'';
    var gIsAi=!!extractedFields.gender;
    var gStyle=gIsAi?'border-color:#22c55e;background:#f0fdf4':'';
    var gLow=String(gVal).toLowerCase();
    h+='<div class="ew-form-group"><label>Gender *'+(gIsAi?' <span style="color:#22c55e;font-size:0.65rem;font-weight:700;margin-left:4px">AI</span>':'')+'</label><select name="gender" style="'+gStyle+'" required><option value="">Select...</option><option value="female"'+(gLow==='female'?' selected':'')+'>Female</option><option value="male"'+(gLow==='male'?' selected':'')+'>Male</option></select></div>';
    aiField('motherName','Mother Name','text',true,true);
    aiField('fatherName','Father Name','text',true,true);
    // Passport details.
    aiField('passportNumber','Passport Number','text',true,true);
    aiField('passportIssueDate','Passport Issue Date','date',false,true);
    aiField('passportExpiry','Passport Expiry','date',true,true);
    // Address — textarea (longer free-form), rendered inline.
    var adVal=savedFormData.address||'';
    var adIsAi=!!extractedFields.address;
    var adStyle=adIsAi?'border-color:#22c55e;background:#f0fdf4':'';
    h+='<div class="ew-form-group full"><label>Address *'+(adIsAi?' <span style="color:#22c55e;font-size:0.65rem;font-weight:700;margin-left:4px">AI</span>':'')+'</label><textarea name="address" rows="2" style="'+adStyle+'" required>'+esc(adVal)+'</textarea></div>';
    // Education.
    aiField('highSchool','High School','text',false,true);
    aiField('graduationYear','Graduation Year','number',false,true);
    aiField('gpa','GPA','text',false,true);
    aiField('languageScore','Language Score','text',false,true);
    h+='<div class="ew-form-group full"><label>Message</label><textarea name="message" rows="3">'+esc(fv2.message||'')+'</textarea></div>';
    h+='</div>';
    var docCount=Object.keys(uploadedDocs).length;
    if(docCount>0){
      h+='<div style="font-size:0.8rem;color:#64748b;margin-bottom:8px">\\ud83d\\udcc4 '+docCount+' document'+(docCount!==1?'s':'')+' will be submitted with your application</div>';
    }
    h+='<div class="ew-form-actions">';
    h+='<button type="submit" class="ew-btn"'+(formLoading?' disabled':'')+'>'+(formLoading?'Submitting...':'Submit Application')+'</button>';
    h+='<button type="button" class="ew-btn-back" id="ew-back-upload">\\u2190 Back to Documents</button>';
    if(formOpen)h+='<button type="button" class="ew-btn ew-btn-outline" id="ew-cancel">Cancel</button>';
    h+='</div></form>';
  }
  return h;
}

function renderSuccess(){
  var docCount=Object.keys(uploadedDocs).length;
  var docMsg=docCount>0?' with '+docCount+' document'+(docCount!==1?'s':''):'';
  return '<div class="ew-success"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg><h3>Application Submitted!</h3><p>Thank you! Your application'+docMsg+' has been received. We will review it and get back to you shortly.</p></div>';
}

function computeModalPosition(modalHeight){
  var ROOT=document.querySelector('.ew-root');
  var rootHeight=ROOT?ROOT.offsetHeight:document.body.scrollHeight;
  if(!parentViewport){
    // Until the parent reports its actual viewport, cap the modal at 600px
    // (sensible single-screen size). Using window.innerHeight here would
    // return the iframe's tall internal height (we set iframe height to
    // root.scrollHeight so the host page scrolls naturally), which would
    // render the modal far taller than the visible host viewport.
    return {top:24,maxHeight:Math.max(300,Math.min(rootHeight-32,600))};
  }
  var pv=parentViewport;
  var visibleTopInIframe=Math.max(0,pv.parentScrollY-pv.iframeTop);
  var visibleBottomInIframe=Math.min(pv.iframeHeight||rootHeight,(pv.parentScrollY+pv.parentViewportHeight)-pv.iframeTop);
  var visibleHeight=Math.max(0,visibleBottomInIframe-visibleTopInIframe);
  // Hard-cap at 90% of the parent viewport AND no taller than 720px so the
  // modal fits comfortably on common laptop screens even when the parent
  // viewport is unusually tall.
  var maxHeight=Math.max(240,Math.min(pv.parentViewportHeight-32,720));
  if(visibleHeight<120){
    return {top:visibleTopInIframe+16,maxHeight:maxHeight};
  }
  var mh=modalHeight||0;
  var top;
  if(mh>0&&mh<visibleHeight){
    top=visibleTopInIframe+Math.max(8,(visibleHeight-mh)/2);
  } else {
    top=visibleTopInIframe+16;
  }
  return {top:top,maxHeight:maxHeight};
}

function repositionModal(){
  if(!modalElements)return;
  var modal=modalElements.modal;
  var pos=computeModalPosition(0);
  modal.style.maxHeight=pos.maxHeight+'px';
  var measured=modal.offsetHeight;
  var posFinal=computeModalPosition(measured);
  modal.style.top=posFinal.top+'px';
  modal.style.maxHeight=posFinal.maxHeight+'px';
}

function notifyParentModalOpen(){
  try{window.parent.postMessage({type:'edcons-modal-open',slug:SLUG},'*');}catch(e){}
  try{window.parent.postMessage({type:'edcons-viewport-request',slug:SLUG},'*');}catch(e){}
}

function notifyParentModalClose(){
  try{window.parent.postMessage({type:'edcons-modal-close',slug:SLUG},'*');}catch(e){}
}

function closeModal(){
  formOpen=false;
  if(modalElements){
    modalElements.overlay.remove();
    modalElements=null;
  }
  if(modalNotified){
    modalNotified=false;
    notifyParentModalClose();
  }
  // Modal overlay lives on document.body and is absolutely positioned, so
  // its removal does not change .ew-root scrollHeight. Trigger a manual
  // resize so the iframe shrinks back to the launcher card height.
  if(typeof resizeParent==='function')resizeParent();
}

function showModal(){
  var existing=$('.ew-modal-overlay');
  if(existing)existing.remove();
  var overlay=el('div','ew-modal-overlay');
  var modal=el('div','ew-modal');
  modal.innerHTML='<button class="ew-close-btn" id="ew-modal-close">&times;</button>'+(formSubmitted?renderSuccess():renderFormContent(formProgram));
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  modalElements={overlay:overlay,modal:modal};
  overlay.addEventListener('click',function(e){if(e.target===overlay){closeModal();}});
  bindModalEvents(modal,overlay);
  if(!modalNotified){
    modalNotified=true;
    notifyParentModalOpen();
  }
  repositionModal();
  setTimeout(repositionModal,60);
  // The modal is absolute-positioned on document.body, so the root-level
  // ResizeObserver won't see it. Push a fresh height to the host so the
  // iframe grows to contain the modal (and avoid the host clipping it).
  if(typeof resizeParent==='function'){resizeParent();setTimeout(resizeParent,80);}
}

function closeDetailModal(){
  detailOpen=false;detailProgram=null;
  if(modalElements){modalElements.overlay.remove();modalElements=null;}
  if(modalNotified){modalNotified=false;notifyParentModalClose();}
  if(typeof resizeParent==='function')resizeParent();
}

function showDetailModal(){
  var existing=$('.ew-modal-overlay');
  if(existing)existing.remove();
  var overlay=el('div','ew-modal-overlay');
  var modal=el('div','ew-modal');
  modal.innerHTML='<button class="ew-close-btn" id="ew-detail-close">&times;</button>'+renderDetailContent(detailProgram);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  modalElements={overlay:overlay,modal:modal};
  overlay.addEventListener('click',function(e){if(e.target===overlay){closeDetailModal();}});
  var closeBtn=$('#ew-detail-close',modal);
  if(closeBtn)closeBtn.addEventListener('click',function(){closeDetailModal();});
  var closeBtn2=$('#ew-detail-close-btn',modal);
  if(closeBtn2)closeBtn2.addEventListener('click',function(){closeDetailModal();});
  var applyBtn=$('#ew-detail-apply',modal);
  if(applyBtn)applyBtn.addEventListener('click',function(){
    var pid=parseInt(applyBtn.getAttribute('data-apply'));
    closeDetailModal();
    formProgram=programs.find(function(p){return p.id===pid})||null;
    formOpen=true;formSubmitted=false;formStep='personal';uploadedDocs={};aiResult=null;extractedFields={};savedFormData={};leadId=null;leadCreating=false;
    showModal();
    loadProgramDocs(pid,function(){if(formOpen)showModal();});
  });
  if(!modalNotified){modalNotified=true;notifyParentModalOpen();}
  repositionModal();
  setTimeout(repositionModal,60);
  if(typeof resizeParent==='function'){resizeParent();setTimeout(resizeParent,80);}
}

function renderDetailContent(p){
  if(!p)return '';
  var hasDiscount=p.discountedFee&&p.tuitionFee&&p.discountedFee<p.tuitionFee;
  var effFee=p.discountedFee||p.tuitionFee;
  var pct=hasDiscount?Math.round(((p.tuitionFee-p.discountedFee)/p.tuitionFee)*100):0;
  var loc=[p.universityCity,p.universityCountry].filter(Boolean).map(esc).join(', ');
  var logoInner=p.universityLogoUrl?'<img src="'+esc(p.universityLogoUrl)+'" alt="" onerror="this.style.display=\\'none\\';this.nextElementSibling&&(this.nextElementSibling.style.display=\\'block\\')">'+'<span style="display:none">'+ICON_GRAD+'</span>':ICON_GRAD;

  var h='<div class="ew-detail-head">';
  h+='<div class="ew-detail-logo">'+logoInner+'</div>';
  h+='<div style="min-width:0;flex:1"><div class="ew-detail-title">'+esc(p.name)+'</div><div class="ew-detail-uni">'+esc(p.universityName||'')+'</div></div>';
  h+='</div>';

  if(loc)h+='<div class="ew-detail-loc">'+ICON_MAPPIN+'<span>'+loc+'</span></div>';

  if(effFee||p.scholarship){
    h+='<div class="ew-detail-feebox">';
    if(effFee){
      h+='<div class="ew-detail-feeline"><span class="big">'+esc(fmtFee(effFee,p.currency))+'</span>';
      if(hasDiscount)h+='<span class="orig">'+esc(fmtFee(p.tuitionFee,p.currency))+'</span><span class="pct">-'+pct+'%</span>';
      h+='</div>';
    }
    if(p.scholarship&&p.scholarship>0){
      h+='<div class="ew-detail-schol">'+ICON_AWARD+'<span>Scholarship: '+esc(fmtFee(p.scholarship,p.currency))+'</span></div>';
    }
    h+='</div>';
  }

  var rows=[];
  if(p.degree)rows.push({i:ICON_GRAD,c:'#3b82f6',l:'Degree',v:p.degree});
  if(p.field)rows.push({i:ICON_AWARD,c:'#8b5cf6',l:'Field',v:p.field});
  if(p.language)rows.push({i:ICON_LANG,c:'#3b82f6',l:'Language',v:p.language});
  if(p.duration)rows.push({i:ICON_CLOCK,c:'#22c55e',l:'Duration',v:p.duration});
  if(p.intakes)rows.push({i:ICON_BOOK,c:'#f97316',l:'Intakes',v:p.intakes});
  if(p.feeType)rows.push({i:ICON_DOLLAR,c:'#10b981',l:'Fee Type',v:p.feeType});
  if(p.applicationFee)rows.push({i:ICON_DOLLAR,c:'#f59e0b',l:'Application Fee',v:fmtFee(p.applicationFee,p.currency)});
  if(p.depositFee)rows.push({i:ICON_DOLLAR,c:'#06b6d4',l:'Deposit Fee',v:fmtFee(p.depositFee,p.currency)});
  if(p.advancedFee)rows.push({i:ICON_DOLLAR,c:'#0ea5e9',l:'Advanced Fee',v:fmtFee(p.advancedFee,p.currency)});
  if(p.languageFee)rows.push({i:ICON_LANG,c:'#6366f1',l:'Language Fee',v:fmtFee(p.languageFee,p.currency)});

  if(rows.length){
    h+='<div class="ew-detail-grid">';
    rows.forEach(function(r){
      h+='<div class="ew-detail-row"><span style="color:'+r.c+'">'+r.i+'</span><div class="ew-detail-row-text"><div class="ew-detail-row-label">'+esc(r.l)+'</div><div class="ew-detail-row-value">'+esc(String(r.v))+'</div></div></div>';
    });
    h+='</div>';
  }

  if(p.requirements){
    h+='<div class="ew-detail-section"><div class="ew-detail-section-label">Requirements</div><div class="ew-detail-section-text">'+esc(p.requirements)+'</div></div>';
  }
  if(p.universityDescription){
    h+='<div class="ew-detail-section" style="border-top:1px solid #e2e8f0;padding-top:12px"><div class="ew-detail-section-label">About the University</div><div class="ew-detail-section-text">'+esc(p.universityDescription)+'</div></div>';
  }

  var hasRank=p.universityRanking||p.universityQsRanking||p.universityTimesRanking||p.universityShanghaiRanking||p.universityCwtsLeidenRanking;
  if(hasRank){
    h+='<div class="ew-detail-rankings">';
    if(p.universityRanking)h+='<span class="ew-detail-rank-pill">'+ICON_AWARD+'World #'+esc(String(p.universityRanking))+'</span>';
    if(p.universityQsRanking)h+='<span class="ew-detail-rank-pill">QS #'+esc(String(p.universityQsRanking))+'</span>';
    if(p.universityTimesRanking)h+='<span class="ew-detail-rank-pill">THE #'+esc(String(p.universityTimesRanking))+'</span>';
    if(p.universityShanghaiRanking)h+='<span class="ew-detail-rank-pill">ARWU #'+esc(String(p.universityShanghaiRanking))+'</span>';
    if(p.universityCwtsLeidenRanking)h+='<span class="ew-detail-rank-pill">Leiden #'+esc(String(p.universityCwtsLeidenRanking))+'</span>';
    h+='</div>';
  }

  if(p.universityWebsite){
    h+='<a class="ew-detail-link" href="'+esc(p.universityWebsite)+'" target="_blank" rel="noopener noreferrer">'+ICON_INFO+'Visit university website</a>';
  }

  if(MODE!=='course_finder'){
    h+='<div style="margin-top:18px;display:flex;gap:8px"><button type="button" class="ew-btn-back" id="ew-detail-close-btn">Close</button><button type="button" class="ew-btn" id="ew-detail-apply" data-apply="'+p.id+'">Apply Now</button></div>';
  }

  return h;
}

var EW_TR_MAP={'ç':'C','Ç':'C','ğ':'G','Ğ':'G','ı':'I','İ':'I','ö':'O','Ö':'O','ş':'S','Ş':'S','ü':'U','Ü':'U'};
function ewToLatinUpper(v){return String(v==null?'':v).replace(/[çÇğĞıİöÖşŞüÜ]/g,function(c){return EW_TR_MAP[c]||c;}).toUpperCase();}
function wireNameAndPhoneNormalizers(scope){
  var root=scope||document;
  var NAMES=['firstName','lastName','motherName','fatherName','highSchool','address'];
  for(var i=0;i<NAMES.length;i++){
    var nodes=root.querySelectorAll?root.querySelectorAll('[name="'+NAMES[i]+'"]'):[];
    for(var j=0;j<nodes.length;j++){(function(el){
      if(el.__ewNameBound)return; el.__ewNameBound=true;
      if(el.value)el.value=ewToLatinUpper(el.value);
      el.addEventListener('input',function(){
        var pos=null; try{pos=el.selectionStart;}catch(e){}
        var v=el.value; var nv=ewToLatinUpper(v);
        if(v!==nv){el.value=nv; if(pos!=null){try{el.setSelectionRange(pos,pos);}catch(e){}}}
      });
    })(nodes[j]);}
  }
  var phones=root.querySelectorAll?root.querySelectorAll('input[name="phone"]'):[];
  for(var k=0;k<phones.length;k++){(function(el){
    if(el.__ewPhoneBound)return; el.__ewPhoneBound=true;
    el.setAttribute('inputmode','tel');
    el.setAttribute('pattern','[0-9]*');
    if(el.value)el.value=el.value.replace(/\D/g,'');
    // beforeinput: yazılan/yapıştırılan metinden rakam dışı her şeyi at, yine de
    // izin verilen rakamları manuel yerleştir. silme/ok tuşları etkilenmez.
    el.addEventListener('beforeinput',function(e){
      var data=e.data; if(data==null)return;
      if(/[^\d]/.test(data)){
        e.preventDefault();
        var cleaned=String(data).replace(/\D/g,'');
        var start=el.selectionStart||0, end=el.selectionEnd||0;
        el.value=el.value.slice(0,start)+cleaned+el.value.slice(end);
        var np=start+cleaned.length;
        try{el.setSelectionRange(np,np);}catch(_){}
        try{el.dispatchEvent(new Event('input',{bubbles:true}));}catch(_){}
      }
    });
    el.addEventListener('paste',function(e){
      try{
        var cd=e.clipboardData||(window.clipboardData);
        if(!cd)return;
        var txt=cd.getData('text');
        if(txt==null)return;
        e.preventDefault();
        var cleaned=String(txt).replace(/\D/g,'');
        var start=el.selectionStart||0, end=el.selectionEnd||0;
        el.value=el.value.slice(0,start)+cleaned+el.value.slice(end);
        var np=start+cleaned.length;
        try{el.setSelectionRange(np,np);}catch(_){}
      }catch(_){}
    });
    el.addEventListener('input',function(){
      var pos=null; try{pos=el.selectionStart;}catch(e){}
      var v=el.value; var nv=v.replace(/\D/g,'');
      if(v!==nv){el.value=nv; var delta=v.length-nv.length; if(pos!=null){var np=Math.max(0,pos-delta);try{el.setSelectionRange(np,np);}catch(e){}}}
    });
    el.addEventListener('blur',function(){
      var v=el.value; var nv=v.replace(/\D/g,'');
      if(v!==nv)el.value=nv;
    });
  })(phones[k]);}
}
function bindModalEvents(modal,overlay){
  wireNameAndPhoneNormalizers(modal);
  var closeBtn=$('#ew-modal-close',modal);
  if(closeBtn)closeBtn.addEventListener('click',function(){closeModal();});
  var cancelBtn=$('#ew-cancel',modal);
  if(cancelBtn)cancelBtn.addEventListener('click',function(){closeModal();});
  var form=$('#ew-form',modal);
  if(form)form.addEventListener('submit',handleFormSubmit);
  $$('[data-doc-input]',modal).forEach(function(input){
    input.addEventListener('change',function(e){
      var key=input.getAttribute('data-doc-input');
      var file=e.target.files[0];
      if(!file)return;
      var vErr=validateFileUpload(file);
      if(vErr){alert(vErr);return;}
      fileToBase64(file).then(function(result){
        uploadedDocs[key]={label:key,base64:result.base64,mediaType:result.mediaType,sizeBytes:result.size,isImage:result.isImage};
        if(formOpen)showModal();
        else render(false);
      });
    });
  });
  var analyzeBtn=$('#ew-analyze-btn',modal);
  if(analyzeBtn)analyzeBtn.addEventListener('click',handleAnalyze);
  var skipBtn=$('#ew-skip-btn',modal);
  // Skip the AI extract and go straight to the review step.
  if(skipBtn)skipBtn.addEventListener('click',function(){formStep='review';if(formOpen)showModal();else render(false)});
  var backUploadBtn=$('#ew-back-upload',modal);
  // From review step → back to documents. Snapshot any review-form edits
  // first so they survive the round-trip.
  if(backUploadBtn)backUploadBtn.addEventListener('click',function(){snapshotForm(modal);formStep='documents';if(formOpen)showModal();else render(false)});
  var backPersonalBtn=$('#ew-back-personal',modal);
  // From documents step → back to personal info.
  if(backPersonalBtn)backPersonalBtn.addEventListener('click',function(){formStep='personal';if(formOpen)showModal();else render(false)});
  var nextPersonalBtn=$('#ew-next-personal',modal);
  if(nextPersonalBtn)nextPersonalBtn.addEventListener('click',function(){handleNextPersonal(modal);});
  wireCcDropdown(modal);
}

var savedFormData={};
// Lead id issued by POST /public/embed/<slug>/lead during Step 1. Sent
// back on the final /apply call so the server reuses (instead of
// duplicating) the existing "new" lead and can flip it to "converted".
var leadId=null;
var leadCreating=false;
// Optional override for where handleAnalyze() should land after the AI
// extract finishes. Set inside .then() (e.g. expired-passport branch)
// before returning so the trailing .finally() honors the chosen step
// instead of unconditionally jumping to 'review'.
var analyzeNextStep=null;

// Helper: snapshot any currently rendered form fields into savedFormData
// so back-navigation does not lose user edits. Called before transitions
// triggered by buttons that live alongside an editable form.
// Wire up custom country-code dropdowns (.ew-cc) inside the given scope.
// Click trigger to toggle list, click item to select, click outside to close.
// Updates hidden input + trigger inner so FormData/snapshotForm reads the value.
// Keyboard: ArrowUp/Down to move highlight, Enter/Space to select, Escape to close.
// Uses a single delegated document listener (window.__ewCcInit guard) to avoid
// listener accumulation across re-renders.
function wireCcDropdown(scope){
  var root=scope||document;
  // One-time global outside-click closer — works across all current/future ew-cc.
  if(!window.__ewCcInit){
    window.__ewCcInit=true;
    document.addEventListener('click',function(e){
      var opened=document.querySelectorAll('.ew-cc-list.open');
      var changed=false;
      for(var k=0;k<opened.length;k++){
        var cc=opened[k].closest?opened[k].closest('.ew-cc'):opened[k].parentNode;
        if(cc&&!cc.contains(e.target)){
          opened[k].classList.remove('open');
          opened[k].classList.remove('ew-cc-list-up');
          opened[k].style.top='';opened[k].style.bottom='';
          var t=cc.querySelector('.ew-cc-trigger');
          if(t)t.setAttribute('aria-expanded','false');
          changed=true;
        }
      }
      // Outside-click closed at least one dropdown — let the iframe shrink
      // back. The instance close() handler isn't reachable here (private
      // closure per ew-cc), so we replicate the resizeParent trigger.
      if(changed&&typeof resizeParent==='function')resizeParent();
    });
  }
  var ccs=root.querySelectorAll?root.querySelectorAll('.ew-cc'):[];
  for(var i=0;i<ccs.length;i++){(function(cc){
    if(cc.__ewWired)return; cc.__ewWired=true;
    var trig=cc.querySelector('.ew-cc-trigger');
    var list=cc.querySelector('.ew-cc-list');
    var hidden=cc.querySelector('input[type="hidden"]');
    var search=cc.querySelector('.ew-cc-search');
    var empty=cc.querySelector('.ew-cc-empty');
    if(!trig||!list||!hidden)return;
    function items(){return list.querySelectorAll('.ew-cc-item');}
    function visibleItems(){return list.querySelectorAll('.ew-cc-item:not(.ew-cc-hidden)');}
    function applyFilter(){
      if(!search)return;
      var q=(search.value||'').toLowerCase().trim();
      var its=items(); var shown=0;
      for(var k=0;k<its.length;k++){
        var nm=its[k].getAttribute('data-name')||'';
        var cd=(its[k].getAttribute('data-cc')||'').toLowerCase();
        var iso=(its[k].getAttribute('data-iso')||'').toLowerCase();
        var match=!q||nm.indexOf(q)>=0||cd.indexOf(q)>=0||iso.indexOf(q)>=0;
        its[k].classList.toggle('ew-cc-hidden',!match);
        if(match)shown++;
      }
      if(empty)empty.classList.toggle('ew-cc-empty-show',shown===0);
    }
    function close(){
      list.classList.remove('open');list.classList.remove('ew-cc-list-up');
      list.style.top='';list.style.bottom='';
      trig.setAttribute('aria-expanded','false');
      if(search){search.value='';applyFilter();}
      // Let the iframe shrink back to its idle height once the dropdown
      // is gone — its open state was contributing to the reported height.
      if(typeof resizeParent==='function')resizeParent();
    }
    function open(){
      var others=document.querySelectorAll('.ew-cc-list.open');
      for(var k=0;k<others.length;k++)if(others[k]!==list)others[k].classList.remove('open');
      list.classList.add('open');trig.setAttribute('aria-expanded','true');
      // Decide whether to drop down or up. The widget lives in a cross-
      // origin iframe, so the only viewport we control is the iframe
      // itself. If opening downward would push past the iframe's bottom
      // and there's more room above, anchor the list to the trigger's
      // top edge instead. Otherwise grow the iframe (resizeParent below)
      // so the full list is reachable without an inner scrollbar.
      list.classList.remove('ew-cc-list-up');
      list.style.top='';list.style.bottom='';
      try{
        var trRect=trig.getBoundingClientRect();
        var listH=Math.min(260, list.scrollHeight||260);
        var spaceBelow=(window.innerHeight||document.documentElement.clientHeight)-trRect.bottom;
        var spaceAbove=trRect.top;
        if(spaceBelow<listH+8 && spaceAbove>spaceBelow){
          list.classList.add('ew-cc-list-up');
        }
      }catch(_){}
      // Ensure the iframe is tall enough to show the full dropdown without
      // clipping at its boundary (cross-origin iframes can't escape).
      if(typeof resizeParent==='function')resizeParent();
      if(search){
        try{search.focus({preventScroll:false});}catch(_){try{search.focus();}catch(__){}}
      } else {
        var act=list.querySelector('.ew-cc-item.active')||items()[0];
        if(act){act.focus({preventScroll:false});if(act.scrollIntoView)act.scrollIntoView({block:'nearest'});}
      }
    }
    function commit(item){
      if(!item)return;
      var code=item.getAttribute('data-cc');
      var iso=item.getAttribute('data-iso');
      if(!code||!iso)return;
      hidden.value=code;
      var lc=iso.toLowerCase();
      trig.innerHTML='<img src="https://flagcdn.com/24x18/'+lc+'.png" srcset="https://flagcdn.com/48x36/'+lc+'.png 2x" alt=""><span class="ew-cc-code">'+code+'</span><span class="ew-cc-caret">\\u25BC</span>';
      var its=items();
      for(var k=0;k<its.length;k++){its[k].classList.remove('active');its[k].setAttribute('aria-selected','false');}
      item.classList.add('active');item.setAttribute('aria-selected','true');
      savedFormData.countryCode=code;
      close();trig.focus();
    }
    trig.addEventListener('click',function(e){
      e.preventDefault();e.stopPropagation();
      if(list.classList.contains('open'))close();else open();
    });
    trig.addEventListener('keydown',function(e){
      if(e.key==='ArrowDown'||e.key==='ArrowUp'||e.key==='Enter'||e.key===' '){
        e.preventDefault();open();
      }
    });
    list.addEventListener('click',function(e){
      var item=e.target.closest?e.target.closest('.ew-cc-item'):null;
      commit(item);
    });
    if(search){
      search.addEventListener('click',function(e){e.stopPropagation();});
      search.addEventListener('input',function(){applyFilter();});
      search.addEventListener('keydown',function(e){
        if(e.key==='ArrowDown'){
          e.preventDefault();
          var v=visibleItems(); if(v.length){v[0].focus();v[0].scrollIntoView({block:'nearest'});}
        } else if(e.key==='Enter'){
          e.preventDefault();
          var v2=visibleItems(); if(v2.length)commit(v2[0]);
        } else if(e.key==='Escape'){
          e.preventDefault();close();trig.focus();
        }
      });
    }
    list.addEventListener('keydown',function(e){
      var its=visibleItems();if(!its.length)return;
      var cur=document.activeElement&&document.activeElement.classList&&document.activeElement.classList.contains('ew-cc-item')?document.activeElement:null;
      var idx=-1;for(var k=0;k<its.length;k++)if(its[k]===cur){idx=k;break;}
      if(e.key==='ArrowDown'){e.preventDefault();var n=its[Math.min(its.length-1,idx+1)]||its[0];n.focus();n.scrollIntoView({block:'nearest'});}
      else if(e.key==='ArrowUp'){e.preventDefault();var p=its[Math.max(0,idx-1)]||its[0];p.focus();p.scrollIntoView({block:'nearest'});}
      else if(e.key==='Home'){e.preventDefault();its[0].focus();its[0].scrollIntoView({block:'nearest'});}
      else if(e.key==='End'){e.preventDefault();its[its.length-1].focus();its[its.length-1].scrollIntoView({block:'nearest'});}
      else if(e.key==='Enter'||e.key===' '){e.preventDefault();commit(cur||its[0]);}
      else if(e.key==='Escape'){e.preventDefault();close();trig.focus();}
    });
  })(ccs[i]);}
}

function sanitizeSavedFormData(){
  // Belt-and-suspenders: telefonu her zaman digits-only, name benzerlerini TR→Latin UPPER yap.
  if(savedFormData.phone){savedFormData.phone=String(savedFormData.phone).replace(/\D/g,'');}
  var NLF=['firstName','lastName','motherName','fatherName','highSchool','address'];
  for(var ni=0;ni<NLF.length;ni++){
    var key=NLF[ni];
    if(savedFormData[key]){savedFormData[key]=ewToLatinUpper(savedFormData[key]);}
  }
}
function snapshotForm(scope){
  var ids=['ew-personal-form','ew-form'];
  for(var i=0;i<ids.length;i++){
    var f=scope?$('#'+ids[i],scope):$('#'+ids[i]);
    if(f){new FormData(f).forEach(function(v,k){savedFormData[k]=v});}
  }
  sanitizeSavedFormData();
}

// Capture the personal-info form values into savedFormData and advance to
// the documents step. Validates the small set of required basics. Used by
// the "Continue" button on step 1 in both the modal and the inline view.
function handleNextPersonal(scope){
  var form=scope?$('#ew-personal-form',scope):$('#ew-personal-form');
  if(form){
    new FormData(form).forEach(function(v,k){savedFormData[k]=v});
  }
  sanitizeSavedFormData();
  if(!savedFormData.firstName||!savedFormData.lastName||!savedFormData.email||!savedFormData.phone||!savedFormData.countryCode){
    alert('Please fill in all required fields, including the phone country code.');
    return;
  }
  // If a lead was already issued during this session (user clicked Next,
  // came back, edited, clicked Next again) skip the create call and just
  // advance — the final /apply will update that same row.
  if(leadId||leadCreating){
    if(MODE==='lead_form'){
      formSubmitted=true;formLoading=false;
      if(formOpen)showModal();else render(false);
    } else {
      formStep='documents';
      if(formOpen)showModal();else render(false);
    }
    return;
  }
  leadCreating=true;
  if(MODE==='lead_form'){formLoading=true;if(formOpen)showModal();else render(false);}
  var leadPayload={
    firstName:savedFormData.firstName,
    lastName:savedFormData.lastName,
    email:savedFormData.email,
    phone:savedFormData.phone,
    countryCode:savedFormData.countryCode,
    programName:formProgram?formProgram.name:null,
    universityName:formProgram?formProgram.universityName:null
  };
  // Capture page URL + UTMs so the lead row carries source attribution.
  try{leadPayload.sourcePageUrl=window.parent.location.href}catch(_){leadPayload.sourcePageUrl=window.location.href}
  try{
    var search=window.location.search;
    try{search=window.parent.location.search}catch(_){}
    var params=new URLSearchParams(search);
    var utmMap={utm_source:'utmSource',utm_medium:'utmMedium',utm_campaign:'utmCampaign',utm_term:'utmTerm',utm_content:'utmContent'};
    Object.keys(utmMap).forEach(function(k){var v=params.get(k);if(v)leadPayload[utmMap[k]]=v});
  }catch(_){}
  fetch(API+'/lead',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(leadPayload)
  }).then(function(r){
    return r.json().then(function(d){return {ok:r.ok,data:d}});
  }).then(function(res){
    leadCreating=false;
    if(res.ok&&res.data&&res.data.leadId)leadId=res.data.leadId;
    if(MODE==='lead_form'){
      // Lead-form widgets only collect contact info — show success now.
      formSubmitted=true;formLoading=false;
      if(formOpen)showModal();else render(false);
      return;
    }
    // Always advance — failing to create the lead should not block the
    // user from completing the form. The final /apply will create it.
    formStep='documents';
    if(formOpen)showModal();else render(false);
  }).catch(function(){
    leadCreating=false;
    if(MODE==='lead_form'){
      formLoading=false;
      alert('Submission failed. Please try again.');
      if(formOpen)showModal();else render(false);
      return;
    }
    formStep='documents';
    if(formOpen)showModal();else render(false);
  });
}

function handleAnalyze(){
  var docKeys=Object.keys(uploadedDocs);
  if(docKeys.length===0){formStep='review';if(formOpen)showModal();else render(false);return;}
  formStep='analyzing';
  if(formOpen)showModal();else render(false);
  var docPayload=docKeys.map(function(k){
    var d=uploadedDocs[k];
    return {type:d.isImage?'image':'pdf',data:d.base64,mediaType:d.mediaType,label:d.label};
  });
  var apiBase=API.replace('/public/embed/'+SLUG,'');
  fetch(apiBase+'/public/ai/extract-document',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({documents:docPayload})
  }).then(function(r){
    if(r.ok)return r.json();
    throw new Error('AI analysis failed');
  }).then(function(data){
    aiResult=data.extracted||null;
    if(aiResult){
      if(aiResult.passportExpired===true){
        alert('Warning: This passport has expired ('+aiResult.passportExpiry+'). Expired passports cannot be used for applications. Please upload a valid passport.');
        aiResult=null;
        // Send the user back to the documents step to re-upload. Mark the
        // transition so the .finally() below does not override us with
        // 'review'.
        analyzeNextStep='documents';
        return;
      }
      extractedFields={};
      var mapping={firstName:'firstName',lastName:'lastName',email:'email',phone:'phone',nationality:'nationality',dateOfBirth:'dateOfBirth',gender:'gender',motherName:'motherName',fatherName:'fatherName',passportNumber:'passportNumber',passportIssueDate:'passportIssueDate',passportExpiry:'passportExpiry',address:'address',highSchool:'highSchool',graduationYear:'graduationYear',gpa:'gpa',languageScore:'languageScore'};
      var mKeys=Object.keys(mapping);
      for(var i=0;i<mKeys.length;i++){
        var ek=mKeys[i];
        var fk=mapping[ek];
        var val=aiResult[ek];
        if(val&&val!=='null'&&val!=='N/A'&&val!==''){
          var sval=String(val);
          // Normalize gender variants (Female/F/M/MALE -> female|male) so the
          // <select name="gender"> in the review step actually shows the
          // option as selected. Anything else is dropped to avoid a stale,
          // non-matching value lurking in savedFormData.
          if(fk==='gender'){
            var gl=sval.trim().toLowerCase();
            if(gl==='f'||gl==='female')sval='female';
            else if(gl==='m'||gl==='male')sval='male';
            else continue;
          }
          // Clean punctuation from name-like text fields. Some passport/ID
          // OCR results come back as "AHMET, " or "Ali." — strip surrounding
          // whitespace, leading/trailing punctuation, and collapse internal
          // commas/periods that aren't meaningful for proper names.
          var nameLike={firstName:1,lastName:1,motherName:1,fatherName:1,highSchool:1};
          if(nameLike[fk]){
            sval=sval.replace(/^[\\s.,;:!?"'\\u2013\\u2014\\-]+|[\\s.,;:!?"'\\u2013\\u2014\\-]+$/g,'');
            sval=sval.replace(/[.,;:!?]+/g,' ').replace(/\\s{2,}/g,' ').trim();
          }
          if(!sval)continue;
          savedFormData[fk]=sval;
          extractedFields[fk]=true;
        }
      }
    }
  }).catch(function(){
    aiResult=null;
  }).finally(function(){
    formStep=analyzeNextStep||'review';
    analyzeNextStep=null;
    if(formOpen)showModal();else render(false);
  });
}

function handleFormSubmit(e){
  e.preventDefault();
  var form=e.target;
  new FormData(form).forEach(function(v,k){savedFormData[k]=v});
  if(!savedFormData.firstName||!savedFormData.lastName||!savedFormData.email){
    alert('Please fill in all required fields.');
    return;
  }
  if(savedFormData.phone&&!savedFormData.countryCode){
    alert('Please select the phone country code.');
    return;
  }
  if(formLoading)return;
  formLoading=true;
  if(formOpen)showModal();else render(false);
  var data=Object.assign({},savedFormData);
  if(formProgram){
    data.programId=formProgram.id;
    data.programName=formProgram.name;
    data.universityName=formProgram.universityName;
  }
  try{data.sourcePageUrl=window.parent.location.href}catch(ex){data.sourcePageUrl=window.location.href}
  var utmMap={utm_source:'utmSource',utm_medium:'utmMedium',utm_campaign:'utmCampaign',utm_term:'utmTerm',utm_content:'utmContent'};
  try{
    var search=window.location.search;
    try{search=window.parent.location.search}catch(ex){}
    var params=new URLSearchParams(search);
    Object.keys(utmMap).forEach(function(k){var v=params.get(k);if(v)data[utmMap[k]]=v});
  }catch(ex){}
  var docKeys=Object.keys(uploadedDocs);
  if(docKeys.length>0){
    data.documents=docKeys.map(function(k){
      var d=uploadedDocs[k];
      return {label:d.label,data:d.base64,mediaType:d.mediaType,sizeBytes:d.sizeBytes};
    });
  }
  if(aiResult)data.aiExtractedData=aiResult;
  if(leadId)data.leadId=leadId;
  fetch(API+'/apply',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(data)
  }).then(function(r){
    formLoading=false;
    if(!r.ok)return r.json().then(function(d){throw new Error(d.error||'Submission failed')});
    formSubmitted=true;
    if(formOpen)showModal();
    else render(false);
  }).catch(function(err){
    formLoading=false;
    if(formOpen)showModal();else render(false);
    alert(err.message||'Something went wrong. Please try again.');
  });
}

function bindEvents(){
  var searchInput=$('#ew-search');
  if(searchInput){
    searchInput.addEventListener('input',function(e){
      clearTimeout(searchDebounce);
      searchDebounce=setTimeout(function(){
        userFilters.search=e.target.value;currentPage=1;loadPrograms();
      },400);
    });
  }
  ['country','universityType','universityId','level','language'].forEach(function(f){
    var sel=$('#ew-f-'+f);
    if(sel)sel.addEventListener('change',function(e){
      userFilters[f]=e.target.value;currentPage=1;loadPrograms();
    });
  });
  $$('[data-apply]').forEach(function(btn){
    btn.addEventListener('click',function(){
      var pid=parseInt(btn.getAttribute('data-apply'));
      formProgram=programs.find(function(p){return p.id===pid})||null;
      formOpen=true;formSubmitted=false;formStep='personal';uploadedDocs={};aiResult=null;extractedFields={};savedFormData={};leadId=null;leadCreating=false;
      loadProgramDocs(pid,function(){if(formOpen)showModal();else render(false);});
      showModal();
    });
  });
  $$('[data-info]').forEach(function(btn){
    btn.addEventListener('click',function(){
      var pid=parseInt(btn.getAttribute('data-info'));
      detailProgram=programs.find(function(p){return p.id===pid})||null;
      if(detailProgram){detailOpen=true;showDetailModal();}
    });
  });
  $$('[data-page]').forEach(function(btn){
    btn.addEventListener('click',function(){
      var p=parseInt(btn.getAttribute('data-page'));
      if(p>=1&&p<=meta.totalPages){currentPage=p;loadPrograms();}
    });
  });
  var inlineForm=$('#ew-form');
  if(inlineForm&&!formOpen)inlineForm.addEventListener('submit',handleFormSubmit);
  var inlineAnalyzeBtn=$('#ew-analyze-btn');
  if(inlineAnalyzeBtn&&!formOpen)inlineAnalyzeBtn.addEventListener('click',handleAnalyze);
  var inlineSkipBtn=$('#ew-skip-btn');
  if(inlineSkipBtn&&!formOpen)inlineSkipBtn.addEventListener('click',function(){formStep='review';render(false)});
  var inlineBackUploadBtn=$('#ew-back-upload');
  if(inlineBackUploadBtn&&!formOpen)inlineBackUploadBtn.addEventListener('click',function(){snapshotForm(null);formStep='documents';render(false)});
  var inlineBackPersonalBtn=$('#ew-back-personal');
  if(inlineBackPersonalBtn&&!formOpen)inlineBackPersonalBtn.addEventListener('click',function(){formStep='personal';render(false)});
  var inlineNextPersonalBtn=$('#ew-next-personal');
  if(inlineNextPersonalBtn&&!formOpen)inlineNextPersonalBtn.addEventListener('click',function(){handleNextPersonal(null);});
  if(!formOpen)wireCcDropdown(null);
  if(!formOpen)wireNameAndPhoneNormalizers(null);
  $$('[data-doc-input]').forEach(function(input){
    if(formOpen)return;
    input.addEventListener('change',function(e){
      var key=input.getAttribute('data-doc-input');
      var file=e.target.files[0];
      if(!file)return;
      var vErr2=validateFileUpload(file);
      if(vErr2){alert(vErr2);return;}
      fileToBase64(file).then(function(result){
        uploadedDocs[key]={label:key,base64:result.base64,mediaType:result.mediaType,sizeBytes:result.size,isImage:result.isImage};
        render(false);
      });
    });
  });
}

function esc(s){if(s===undefined||s===null)return '';var d=document.createElement('div');d.textContent=String(s);return d.innerHTML}
function safeAccept(s){var v=String(s||'').trim();return /^(\\.[a-z0-9]{1,8})(,\\.[a-z0-9]{1,8})*$/i.test(v)?v:'.pdf,.jpg,.jpeg,.png';}

function resizeParent(){
  try{
    var root=document.querySelector('.ew-root');
    // Use the larger of root.scrollHeight (full content) and document
    // scrollHeight so internal overflow containers don't truncate the
    // reported height and force an inner scrollbar on the host page.
    var rootH=root?Math.max(root.scrollHeight,root.offsetHeight):0;
    var docH=Math.max(document.body.scrollHeight,document.documentElement.scrollHeight);
    var h=Math.max(rootH,docH);
    // Absolutely-positioned overlays (the apply modal and any open country
    // code dropdown) do not contribute to scrollHeight, so query their
    // bounding rects explicitly and grow the iframe just enough to contain
    // them. This both prevents the modal/dropdown from being clipped at
    // the iframe boundary AND lets the iframe shrink back to the launcher
    // card height once they close.
    var extras=document.querySelectorAll('.ew-modal, .ew-cc-list.open');
    for(var i=0;i<extras.length;i++){
      var r=extras[i].getBoundingClientRect();
      var bottom=r.bottom+(window.pageYOffset||document.documentElement.scrollTop||0);
      if(bottom>h)h=bottom;
    }
    h=Math.ceil(h)+16;
    window.parent.postMessage({type:'edcons-resize',slug:SLUG,height:h},'*');
  }catch(e){}
}

var ro=typeof ResizeObserver!=='undefined'?new ResizeObserver(resizeParent):null;
if(ro){
  var rootEl=document.querySelector('.ew-root');
  // Observe BOTH the widget root AND document.body. The modal overlay and
  // any open country code dropdown are appended to document.body (or
  // float above .ew-root via position:absolute), so root-only observation
  // misses size changes from those overlays.
  if(rootEl)ro.observe(rootEl);
  ro.observe(document.body);
}

window.addEventListener('message',function(e){
  var d=e.data;
  if(!d||d.slug!==SLUG)return;
  if(d.type==='edcons-viewport'){
    parentViewport={
      parentScrollY:d.parentScrollY||0,
      parentViewportHeight:d.parentViewportHeight||0,
      iframeTop:d.iframeTop||0,
      iframeHeight:d.iframeHeight||0
    };
    if(modalElements)repositionModal();
  }
});

init();
})();
</script>
</body>
</html>`;
}

export default router;
