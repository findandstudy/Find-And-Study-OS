import { Router, type IRouter } from "express";
import { db, embedWidgetsTable, embedSubmissionsTable, leadsTable, programsTable, universitiesTable } from "@workspace/db";
import { eq, ilike, sql, and, desc } from "drizzle-orm";
import { requireAuth, requireRole, logAudit } from "../lib/auth";
import { STAFF_ROLES } from "../lib/roles";
import rateLimit from "express-rate-limit";

const router: IRouter = Router();

const embedSubmitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many submissions. Please try again later." },
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

const VALID_MODES = ["combined", "course_finder", "application_only"];

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
    if (err.message?.includes("duplicate") || err.message?.includes("unique")) {
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

  const [widget] = await db.update(embedWidgetsTable).set(updates).where(eq(embedWidgetsTable.id, id)).returning();
  if (!widget) { res.status(404).json({ error: "Widget not found" }); return; }
  await logAudit(req.user!.id, "update_embed_widget", "embed_widget", id, updates, req.ip);
  res.json(widget);
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
    universityId: programsTable.universityId,
    universityName: universitiesTable.name,
    universityLogoUrl: universitiesTable.logoUrl,
    universityCountry: universitiesTable.country,
    universityCity: universitiesTable.city,
    universityType: universitiesTable.universityType,
  }).from(programsTable)
    .innerJoin(universitiesTable, eq(programsTable.universityId, universitiesTable.id))
    .where(where)
    .orderBy(universitiesTable.name, programsTable.name)
    .limit(limitNum)
    .offset(offset);

  res.json({ data: rows, meta: { total: Number(count), page: pageNum, limit: limitNum, totalPages: Math.ceil(Number(count) / limitNum) } });
});

router.get("/public/embed/:slug/filters", async (req, res): Promise<void> => {
  const { slug } = req.params;
  const [widget] = await db.select().from(embedWidgetsTable).where(and(eq(embedWidgetsTable.slug, slug), eq(embedWidgetsTable.isActive, true)));
  if (!widget) { res.status(404).json({ error: "Widget not found" }); return; }

  const presetFilters = (widget.presetFilters || {}) as Record<string, any>;
  const conditions = [eq(programsTable.isActive, true)];

  if (presetFilters.country) conditions.push(eq(universitiesTable.country, String(presetFilters.country)));
  if (presetFilters.city) conditions.push(eq(universitiesTable.city, String(presetFilters.city)));
  if (presetFilters.universityType) conditions.push(eq(universitiesTable.universityType, String(presetFilters.universityType)));
  if (presetFilters.universityId) conditions.push(eq(programsTable.universityId, parseInt(String(presetFilters.universityId), 10)));
  if (presetFilters.level) conditions.push(ilike(programsTable.degree, `%${presetFilters.level}%`));
  if (presetFilters.language) conditions.push(ilike(programsTable.language, String(presetFilters.language)));

  const where = and(...conditions);
  const activeJoin = eq(programsTable.universityId, universitiesTable.id);

  const countries = await db.selectDistinct({ country: universitiesTable.country }).from(universitiesTable).innerJoin(programsTable, activeJoin).where(where).orderBy(universitiesTable.country);
  const cities = await db.selectDistinct({ city: universitiesTable.city }).from(universitiesTable).innerJoin(programsTable, activeJoin).where(and(where, sql`${universitiesTable.city} IS NOT NULL`)).orderBy(universitiesTable.city);
  const universityTypes = await db.selectDistinct({ type: universitiesTable.universityType }).from(universitiesTable).innerJoin(programsTable, activeJoin).where(and(where, sql`${universitiesTable.universityType} IS NOT NULL`)).orderBy(universitiesTable.universityType);
  const universities = await db.selectDistinct({ id: universitiesTable.id, name: universitiesTable.name }).from(universitiesTable).innerJoin(programsTable, activeJoin).where(where).orderBy(universitiesTable.name);
  const degrees = await db.selectDistinct({ degree: programsTable.degree }).from(programsTable).innerJoin(universitiesTable, eq(programsTable.universityId, universitiesTable.id)).where(and(where, sql`${programsTable.degree} IS NOT NULL`)).orderBy(programsTable.degree);
  const languages = await db.selectDistinct({ language: programsTable.language }).from(programsTable).innerJoin(universitiesTable, eq(programsTable.universityId, universitiesTable.id)).where(and(where, sql`${programsTable.language} IS NOT NULL`)).orderBy(programsTable.language);
  const feeRange = await db.select({ min: sql<number>`MIN(COALESCE(${programsTable.discountedFee}, ${programsTable.tuitionFee}))`, max: sql<number>`MAX(COALESCE(${programsTable.discountedFee}, ${programsTable.tuitionFee}))` }).from(programsTable).innerJoin(universitiesTable, eq(programsTable.universityId, universitiesTable.id)).where(and(where, sql`COALESCE(${programsTable.discountedFee}, ${programsTable.tuitionFee}) IS NOT NULL`));

  res.json({
    countries: countries.map(r => r.country).filter(Boolean),
    cities: cities.map(r => r.city).filter(Boolean),
    universityTypes: universityTypes.map(r => r.type).filter(Boolean),
    universities: universities.map(r => ({ id: r.id, name: r.name })),
    degrees: degrees.map(r => r.degree).filter(Boolean),
    languages: languages.map(r => r.language).filter(Boolean),
    feeRange: { min: feeRange[0]?.min ?? 0, max: feeRange[0]?.max ?? 100000 },
  });
});

router.post("/public/embed/:slug/apply", embedSubmitLimiter, async (req, res): Promise<void> => {
  const { slug } = req.params;
  const [widget] = await db.select().from(embedWidgetsTable).where(and(eq(embedWidgetsTable.slug, slug), eq(embedWidgetsTable.isActive, true)));
  if (!widget) { res.status(404).json({ error: "Widget not found" }); return; }

  const origin = req.headers.origin as string | undefined;
  const referer = req.headers.referer as string | undefined;
  if (!validateDomain(widget, origin, referer)) {
    res.status(403).json({ error: "Domain not allowed" });
    return;
  }

  const { firstName, lastName, email, phone, countryCode, nationality, desiredLevel, desiredProgram, preferredUniversity, message, programId, programName, universityName, sourcePageUrl, utmSource, utmMedium, utmCampaign, utmTerm, utmContent, _hp } = req.body;

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

  const result = await db.transaction(async (tx) => {
    const [lead] = await tx.insert(leadsTable).values({
      firstName: s(firstName, 100)!,
      lastName: s(lastName, 100)!,
      email: s(email, 255),
      phone: phone ? `${countryCode || ""}${phone}`.slice(0, 50) : null,
      nationality: s(nationality, 100),
      source: `embed:${widget.slug}`,
      status: "new",
      interestedProgram: s(programName || desiredProgram, 255),
      interestedCountry: null,
      notes: s(message, 2000),
    }).returning();

    const [submission] = await tx.insert(embedSubmissionsTable).values({
      widgetId: widget.id,
      firstName: s(firstName, 100)!,
      lastName: s(lastName, 100)!,
      email: s(email, 255)!,
      phone: s(phone, 50),
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
      status: "new",
    }).returning();

    return { leadId: lead.id, submissionId: submission.id };
  });

  res.status(201).json({ success: true, submissionId: result.submissionId });
});

router.get("/public/embed/:slug/widget", async (req, res): Promise<void> => {
  const { slug } = req.params;
  const [widget] = await db.select().from(embedWidgetsTable).where(and(eq(embedWidgetsTable.slug, slug), eq(embedWidgetsTable.isActive, true)));
  if (!widget) { res.status(404).send("Widget not found"); return; }

  const baseUrl = getBaseUrl(req);
  const html = generateWidgetHTML(slug, baseUrl, widget);
  res.setHeader("Content-Type", "text/html");
  res.send(html);
});

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
    iframe.style.minHeight = '600px';
    iframe.setAttribute('loading', 'lazy');
    iframe.setAttribute('allowfullscreen', 'true');
    el.appendChild(iframe);
    window.addEventListener('message', function(e) {
      if (e.data && e.data.type === 'edcons-resize' && e.data.slug === slug) {
        iframe.style.height = e.data.height + 'px';
      }
    });
  });
})();`;
}

function generateWidgetHTML(slug: string, baseUrl: string, widget: any): string {
  const theme = sanitizeTheme(widget.theme);
  const primaryColor = theme.primaryColor || "#2563eb";
  const secondaryColor = theme.secondaryColor || "#1e40af";
  const buttonColor = theme.buttonColor || "#2563eb";
  const borderRadius = theme.borderRadius || "8px";
  const fontFamily = theme.fontFamily || "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  const safeMode = VALID_MODES.includes(widget.mode) ? widget.mode : "combined";

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
.ew-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px;margin-bottom:20px}
.ew-card{border:1px solid #e2e8f0;border-radius:${borderRadius};padding:20px;background:#fff;transition:box-shadow .2s,transform .15s}
.ew-card:hover{box-shadow:0 4px 12px rgba(0,0,0,.08);transform:translateY(-1px)}
.ew-card-header{display:flex;align-items:center;gap:12px;margin-bottom:12px}
.ew-card-logo{width:48px;height:48px;border-radius:8px;object-fit:contain;background:#f1f5f9;padding:4px;flex-shrink:0}
.ew-card-logo-placeholder{width:48px;height:48px;border-radius:8px;background:${primaryColor}15;display:flex;align-items:center;justify-content:center;font-size:1.2rem;font-weight:700;color:${primaryColor};flex-shrink:0}
.ew-card-title{font-size:1rem;font-weight:600;color:#1f2937}
.ew-card-uni{font-size:0.8rem;color:#64748b}
.ew-card-details{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px}
.ew-badge{font-size:0.7rem;padding:3px 8px;border-radius:20px;background:#f1f5f9;color:#475569;font-weight:500;white-space:nowrap}
.ew-badge-primary{background:${primaryColor}15;color:${primaryColor}}
.ew-card-fee{font-size:1.1rem;font-weight:700;color:${primaryColor};margin-bottom:14px}
.ew-card-fee .ew-fee-orig{text-decoration:line-through;color:#9ca3af;font-size:0.85rem;font-weight:400;margin-left:6px}
.ew-card-fee .ew-fee-type{font-size:0.7rem;color:#9ca3af;font-weight:400}
.ew-btn{display:inline-flex;align-items:center;justify-content:center;padding:10px 20px;background:${buttonColor};color:#fff;border:none;border-radius:6px;font-size:0.875rem;font-weight:600;cursor:pointer;transition:opacity .2s;width:100%;text-align:center}
.ew-btn:hover{opacity:.9}
.ew-btn-outline{background:transparent;color:${buttonColor};border:1.5px solid ${buttonColor}}
.ew-btn-outline:hover{background:${buttonColor}08}
.ew-pagination{display:flex;justify-content:center;gap:8px;margin-top:20px}
.ew-pagination button{padding:8px 14px;border:1px solid #d1d5db;border-radius:6px;background:#fff;cursor:pointer;font-size:0.875rem;color:#374151}
.ew-pagination button:disabled{opacity:.4;cursor:default}
.ew-pagination button.active{background:${primaryColor};color:#fff;border-color:${primaryColor}}
.ew-modal-overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px}
.ew-modal{background:#fff;border-radius:${borderRadius};max-width:540px;width:100%;max-height:90vh;overflow-y:auto;padding:28px;box-shadow:0 20px 60px rgba(0,0,0,.15)}
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
.ew-modal{position:relative}
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
.ew-hp{position:absolute;left:-9999px;opacity:0;height:0}
@media(max-width:640px){
  .ew-grid{grid-template-columns:1fr}
  .ew-filters{flex-direction:column}
  .ew-form-grid{grid-template-columns:1fr}
  .ew-modal{padding:20px}
  .ew-form-actions{flex-direction:column}
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
var searchDebounce=null;
var userFilters={};

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
  Promise.all([fetchJSON(API+'/config'),fetchJSON(API+'/filters')]).then(function(res){
    config=res[0];filters=res[1];
    loadPrograms();
  }).catch(function(e){
    $('#ew-app').innerHTML='<div class="ew-empty"><p>Unable to load widget</p></div>';
  });
}

function loadPrograms(){
  var app=$('#ew-app');
  var params=new URLSearchParams();
  params.set('page',currentPage);
  params.set('limit','12');
  var pf=config.presetFilters||{};
  var locked=config.lockedFilters||[];
  Object.keys(userFilters).forEach(function(k){
    if(!pf[k]&&!locked.includes(k)&&userFilters[k]) params.set(k,userFilters[k]);
  });

  render(true);
  fetchJSON(API+'/programs?'+params.toString()).then(function(res){
    programs=res.data;meta=res.meta;
    render(false);
  }).catch(function(){
    render(false);
  });
}

function render(loading){
  var app=$('#ew-app');
  var html='';

  if(MODE!=='application_only'){
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

  if(MODE==='application_only'){
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
    (filters.countries||[]).forEach(function(c){h+='<option value="'+c+'"'+(userFilters.country===c?' selected':'')+'>'+c+'</option>'});
    h+='</select></div>';
  }
  if(!hidden.includes('universityType')&&!pf.universityType){
    h+='<div class="ew-filter-group"><label>Type</label><select id="ew-f-universityType"'+(locked.includes('universityType')?' disabled':'')+'><option value="">All Types</option>';
    (filters.universityTypes||[]).forEach(function(t){h+='<option value="'+t+'"'+(userFilters.universityType===t?' selected':'')+'>'+t+'</option>'});
    h+='</select></div>';
  }
  if(!hidden.includes('universityId')&&!pf.universityId){
    h+='<div class="ew-filter-group"><label>University</label><select id="ew-f-universityId"'+(locked.includes('universityId')?' disabled':'')+'><option value="">All Universities</option>';
    (filters.universities||[]).forEach(function(u){h+='<option value="'+u.id+'"'+(userFilters.universityId==u.id?' selected':'')+'>'+u.name+'</option>'});
    h+='</select></div>';
  }
  if(!hidden.includes('level')&&!pf.level){
    h+='<div class="ew-filter-group"><label>Level</label><select id="ew-f-level"'+(locked.includes('level')?' disabled':'')+'><option value="">All Levels</option>';
    (filters.degrees||[]).forEach(function(d){h+='<option value="'+d+'"'+(userFilters.level===d?' selected':'')+'>'+d+'</option>'});
    h+='</select></div>';
  }
  if(!hidden.includes('language')&&!pf.language){
    h+='<div class="ew-filter-group"><label>Language</label><select id="ew-f-language"'+(locked.includes('language')?' disabled':'')+'><option value="">All Languages</option>';
    (filters.languages||[]).forEach(function(l){h+='<option value="'+l+'"'+(userFilters.language===l?' selected':'')+'>'+l+'</option>'});
    h+='</select></div>';
  }

  h+='</div>';
  return h;
}

function renderCard(p){
  var fee=p.discountedFee||p.tuitionFee;
  var cur=p.currency||'USD';
  var logo=p.universityLogoUrl?'<img class="ew-card-logo" src="'+p.universityLogoUrl+'" alt="">':'<div class="ew-card-logo-placeholder">'+(p.universityName||'U').charAt(0)+'</div>';
  var h='<div class="ew-card">';
  h+='<div class="ew-card-header">'+logo+'<div><div class="ew-card-title">'+esc(p.name)+'</div><div class="ew-card-uni">'+esc(p.universityName||'')+'</div></div></div>';
  h+='<div class="ew-card-details">';
  if(p.degree)h+='<span class="ew-badge ew-badge-primary">'+esc(p.degree)+'</span>';
  if(p.language)h+='<span class="ew-badge">'+esc(p.language)+'</span>';
  if(p.duration)h+='<span class="ew-badge">'+esc(p.duration)+'</span>';
  if(p.universityCountry)h+='<span class="ew-badge">'+esc(p.universityCountry)+'</span>';
  if(p.universityType)h+='<span class="ew-badge">'+esc(p.universityType)+'</span>';
  if(p.intakes)h+='<span class="ew-badge">'+esc(p.intakes)+'</span>';
  h+='</div>';
  if(fee){
    h+='<div class="ew-card-fee">'+cur+' '+Number(fee).toLocaleString();
    if(p.discountedFee&&p.tuitionFee&&p.discountedFee<p.tuitionFee)h+='<span class="ew-fee-orig">'+cur+' '+Number(p.tuitionFee).toLocaleString()+'</span>';
    if(p.feeType)h+=' <span class="ew-fee-type">/ '+esc(p.feeType)+'</span>';
    h+='</div>';
  }
  if(MODE!=='course_finder'){
    h+='<button class="ew-btn" data-apply="'+p.id+'">Apply Now</button>';
  }
  h+='</div>';
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
  return '<div style="max-width:540px;margin:0 auto">'+renderFormFields(null)+'</div>';
}

function renderFormFields(prog){
  var h='<h3>Apply Now</h3>';
  if(prog)h+='<div class="ew-modal-subtitle">'+esc(prog.name)+' — '+esc(prog.universityName||'')+'</div>';
  else h+='<div class="ew-modal-subtitle">Fill in the form below to submit your application</div>';
  h+='<form id="ew-form">';
  h+='<input type="text" name="_hp" class="ew-hp" tabindex="-1" autocomplete="off">';
  h+='<div class="ew-form-grid">';
  h+='<div class="ew-form-group"><label>First Name *</label><input name="firstName" required></div>';
  h+='<div class="ew-form-group"><label>Last Name *</label><input name="lastName" required></div>';
  h+='<div class="ew-form-group"><label>Email *</label><input name="email" type="email" required></div>';
  h+='<div class="ew-form-group"><label>Phone</label><div class="ew-phone-group"><select name="countryCode"><option value="+1">+1</option><option value="+44">+44</option><option value="+90" selected>+90</option><option value="+971">+971</option><option value="+966">+966</option><option value="+33">+33</option><option value="+49">+49</option><option value="+7">+7</option><option value="+86">+86</option><option value="+91">+91</option><option value="+81">+81</option><option value="+82">+82</option><option value="+55">+55</option><option value="+20">+20</option><option value="+234">+234</option><option value="+254">+254</option><option value="+27">+27</option><option value="+62">+62</option><option value="+60">+60</option><option value="+63">+63</option></select><input name="phone" placeholder="Phone number"></div></div>';
  h+='<div class="ew-form-group"><label>Nationality</label><input name="nationality"></div>';
  h+='<div class="ew-form-group"><label>Desired Level</label><select name="desiredLevel"><option value="">Select...</option><option value="Foundation">Foundation</option><option value="Associate">Associate</option><option value="Bachelor">Bachelor</option><option value="Master">Master</option><option value="PhD">PhD</option></select></div>';
  if(!prog){
    h+='<div class="ew-form-group"><label>Preferred University</label><input name="preferredUniversity"></div>';
    h+='<div class="ew-form-group"><label>Desired Program</label><input name="desiredProgram"></div>';
  }
  h+='<div class="ew-form-group full"><label>Message</label><textarea name="message" rows="3"></textarea></div>';
  h+='</div>';
  h+='<div class="ew-form-actions"><button type="submit" class="ew-btn"'+(formLoading?' disabled':'')+'>'+
    (formLoading?'Submitting...':'Submit Application')+'</button>';
  if(formOpen) h+='<button type="button" class="ew-btn ew-btn-outline" id="ew-cancel">Cancel</button>';
  h+='</div></form>';
  return h;
}

function renderSuccess(){
  return '<div class="ew-success"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg><h3>Application Submitted!</h3><p>Thank you! We will review your application and get back to you shortly.</p></div>';
}

function showModal(){
  var existing=$('.ew-modal-overlay');
  if(existing)existing.remove();
  var overlay=el('div','ew-modal-overlay');
  var modal=el('div','ew-modal');
  modal.innerHTML='<button class="ew-close-btn" id="ew-modal-close">&times;</button>'+(formSubmitted?renderSuccess():renderFormFields(formProgram));
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  overlay.addEventListener('click',function(e){if(e.target===overlay){formOpen=false;overlay.remove()}});
  var closeBtn=$('#ew-modal-close',modal);
  if(closeBtn)closeBtn.addEventListener('click',function(){formOpen=false;overlay.remove()});
  var cancelBtn=$('#ew-cancel',modal);
  if(cancelBtn)cancelBtn.addEventListener('click',function(){formOpen=false;overlay.remove()});
  var form=$('#ew-form',modal);
  if(form)form.addEventListener('submit',handleSubmit);
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
      formOpen=true;formSubmitted=false;
      showModal();
    });
  });
  $$('[data-page]').forEach(function(btn){
    btn.addEventListener('click',function(){
      var p=parseInt(btn.getAttribute('data-page'));
      if(p>=1&&p<=meta.totalPages){currentPage=p;loadPrograms();}
    });
  });
  var inlineForm=$('#ew-form');
  if(inlineForm&&!formOpen)inlineForm.addEventListener('submit',handleSubmit);
}

function handleSubmit(e){
  e.preventDefault();
  if(formLoading)return;
  formLoading=true;
  var form=e.target;
  var data={};
  new FormData(form).forEach(function(v,k){data[k]=v});
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
    alert(err.message||'Something went wrong. Please try again.');
  });
}

function esc(s){if(!s)return '';var d=document.createElement('div');d.textContent=s;return d.innerHTML}

function resizeParent(){
  try{
    var h=document.body.scrollHeight;
    window.parent.postMessage({type:'edcons-resize',slug:SLUG,height:h},'*');
  }catch(e){}
}

var ro=typeof ResizeObserver!=='undefined'?new ResizeObserver(resizeParent):null;
if(ro)ro.observe(document.body);

init();
})();
</script>
</body>
</html>`;
}

export default router;
