import { Router, type IRouter } from "express";
import { db, blogPostsTable, announcementsTable } from "@workspace/db";
import { eq, sql, and, desc, inArray } from "drizzle-orm";
import { z } from "zod";
import { requireAuth, requireRole } from "../lib/auth";
import { validate, getValidated } from "../middlewares/validate";
import { AGENT_ROLES, CONTENT_ROLES, MANAGER_ROLES, STAFF_ROLES } from "../lib/roles";

const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const createBlogBodySchema = z.object({
  slug: z.string().trim().min(1).regex(slugRegex, "slug must be lowercase alphanumeric with hyphens only"),
  title: z.string().trim().min(1),
  locale: z.string().trim().optional().default("en"),
  published: z.boolean().optional().default(false),
  content: z.string().optional().nullable(),
  excerpt: z.string().optional().nullable(),
  featuredImageUrl: z.string().url().optional().nullable(),
  category: z.string().trim().optional().nullable(),
  metaTitle: z.string().trim().optional().nullable(),
  metaDescription: z.string().trim().optional().nullable(),
});

const patchBlogBodySchema = z.object({
  title: z.string().trim().min(1).optional(),
  slug: z.string().trim().min(1).regex(slugRegex, "slug must be lowercase alphanumeric with hyphens only").optional(),
  content: z.string().optional().nullable(),
  excerpt: z.string().optional().nullable(),
  featuredImageUrl: z.string().url().optional().nullable(),
  published: z.boolean().optional(),
  locale: z.string().trim().optional(),
  category: z.string().trim().optional().nullable(),
  metaTitle: z.string().trim().optional().nullable(),
  metaDescription: z.string().trim().optional().nullable(),
});

const createAnnouncementBodySchema = z.object({
  title: z.string().trim().min(1),
  content: z.string().trim().min(1),
  audience: z.string().trim().optional().default("all"),
  isActive: z.boolean().optional().default(true),
  expiresAt: z.string().datetime({ offset: true }).optional().nullable(),
});

const patchAnnouncementBodySchema = z.object({
  title: z.string().trim().min(1).optional(),
  content: z.string().trim().min(1).optional(),
  audience: z.string().trim().optional(),
  isActive: z.boolean().optional(),
  expiresAt: z.string().datetime({ offset: true }).optional().nullable(),
});

const router: IRouter = Router();

const BLOG_PATCH_FIELDS = [
  "title", "slug", "content", "excerpt", "featuredImageUrl",
  "published", "locale", "category", "metaTitle", "metaDescription",
];
const ANN_PATCH_FIELDS = ["title", "content", "audience", "isActive", "expiresAt"];

router.get("/blog", async (req, res): Promise<void> => {
  const { locale, published, page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, Math.min(100_000, parseInt(page, 10) || 1));
  const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];
  const canEdit = req.user && CONTENT_ROLES.includes(req.user.role);
  if (!canEdit || published === "true") conditions.push(eq(blogPostsTable.published, true));
  else if (published === "false") conditions.push(eq(blogPostsTable.published, false));
  if (typeof locale === "string" && locale) conditions.push(eq(blogPostsTable.locale, locale));
  res.setHeader("Cache-Control", "private, no-store");
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(blogPostsTable)
    .where(whereClause);

  const data = await db
    .select()
    .from(blogPostsTable)
    .where(whereClause)
    .limit(limitNum)
    .offset(offset)
    .orderBy(desc(blogPostsTable.createdAt));

  res.json({
    data,
    meta: {
      total: Number(count),
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(Number(count) / limitNum),
    },
  });
});

router.post("/blog", requireAuth, requireRole(...CONTENT_ROLES), validate({ body: createBlogBodySchema }), async (req, res): Promise<void> => {
  const { slug, title, locale, published, content, excerpt, featuredImageUrl, category, metaTitle, metaDescription } =
    getValidated<{ body: typeof createBlogBodySchema }>(req).body;
  const [post] = await db.insert(blogPostsTable).values({
    slug, title, locale, published,
    content: content ?? null,
    excerpt: excerpt ?? null,
    featuredImageUrl: featuredImageUrl ?? null,
    category: category ?? null,
    metaTitle: metaTitle ?? null,
    metaDescription: metaDescription ?? null,
  }).returning();
  res.status(201).json(post);
});

router.get("/blog/:slug", async (req, res): Promise<void> => {
  const slug = Array.isArray(req.params.slug) ? req.params.slug[0] : req.params.slug;
  const [post] = await db.select().from(blogPostsTable).where(
    and(eq(blogPostsTable.slug, slug), eq(blogPostsTable.published, true))
  );
  if (!post) { res.status(404).json({ error: "Blog post not found" }); return; }
  res.json(post);
});

router.patch("/blog/:slug", requireAuth, requireRole(...CONTENT_ROLES), validate({ body: patchBlogBodySchema }), async (req, res): Promise<void> => {
  const slug = Array.isArray(req.params.slug) ? req.params.slug[0] : req.params.slug;
  const body = getValidated<{ body: typeof patchBlogBodySchema }>(req).body;
  const updates: Record<string, unknown> = {};
  for (const key of BLOG_PATCH_FIELDS) {
    if ((body as Record<string, unknown>)[key] !== undefined) updates[key] = (body as Record<string, unknown>)[key];
  }
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No valid fields to update" });
    return;
  }
  const [post] = await db.update(blogPostsTable).set(updates).where(eq(blogPostsTable.slug, slug)).returning();
  if (!post) { res.status(404).json({ error: "Blog post not found" }); return; }
  res.json(post);
});

router.delete("/blog/:slug", requireAuth, requireRole(...CONTENT_ROLES), async (req, res): Promise<void> => {
  const slug = Array.isArray(req.params.slug) ? req.params.slug[0] : req.params.slug;
  await db.delete(blogPostsTable).where(eq(blogPostsTable.slug, slug));
  res.sendStatus(204);
});

router.get("/announcements", async (req, res): Promise<void> => {
  const audiences = ["all"];
  const role = req.user?.role;
  if (role) audiences.push(role);
  if (role && STAFF_ROLES.includes(role)) audiences.push("staff", "all_staff");
  if (role && AGENT_ROLES.includes(role)) audiences.push("agents", "all_agents");
  if (role === "student") audiences.push("students", "all_students");
  const now = Date.now();
  const data = await db
    .select()
    .from(announcementsTable)
    .where(and(eq(announcementsTable.isActive, true), inArray(announcementsTable.audience, audiences)))
    .orderBy(desc(announcementsTable.createdAt));
  res.setHeader("Cache-Control", "private, no-store");
  res.json(data.filter((entry) => entry.expiresAt === null || Date.parse(entry.expiresAt) > now));
});

router.post("/announcements", requireAuth, requireRole(...MANAGER_ROLES), validate({ body: createAnnouncementBodySchema }), async (req, res): Promise<void> => {
  const { title, content, audience, isActive, expiresAt } = getValidated<{ body: typeof createAnnouncementBodySchema }>(req).body;
  const [ann] = await db.insert(announcementsTable).values({
    title, content, audience, isActive, expiresAt: expiresAt || null,
  }).returning();
  res.status(201).json(ann);
});

router.patch("/announcements/:id", requireAuth, requireRole(...MANAGER_ROLES), validate({ body: patchAnnouncementBodySchema }), async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  const body = getValidated<{ body: typeof patchAnnouncementBodySchema }>(req).body;
  const updates: Record<string, unknown> = {};
  for (const key of ANN_PATCH_FIELDS) {
    if ((body as Record<string, unknown>)[key] !== undefined) updates[key] = (body as Record<string, unknown>)[key];
  }
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No valid fields to update" });
    return;
  }
  const [ann] = await db.update(announcementsTable).set(updates).where(eq(announcementsTable.id, id)).returning();
  if (!ann) { res.status(404).json({ error: "Announcement not found" }); return; }
  res.json(ann);
});

router.delete("/announcements/:id", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  await db.delete(announcementsTable).where(eq(announcementsTable.id, id));
  res.sendStatus(204);
});

export default router;
