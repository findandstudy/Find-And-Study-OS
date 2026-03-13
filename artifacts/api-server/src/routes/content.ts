import { Router, type IRouter } from "express";
import { db, blogPostsTable, announcementsTable } from "@workspace/db";
import { eq, sql, and } from "drizzle-orm";
import { requireAuth, requireRole } from "../lib/auth";
import { CONTENT_ROLES, MANAGER_ROLES } from "../lib/roles";

const router: IRouter = Router();

const BLOG_PATCH_FIELDS = [
  "title", "slug", "content", "excerpt", "coverImage",
  "published", "locale", "category", "metaTitle", "metaDescription",
];
const ANN_PATCH_FIELDS = ["title", "content", "audience", "isActive", "expiresAt"];

router.get("/blog", async (req, res): Promise<void> => {
  const { locale, published, page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];
  if (published === "true") conditions.push(eq(blogPostsTable.published, true));
  if (locale) conditions.push(eq(blogPostsTable.locale, locale));
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
    .orderBy(blogPostsTable.createdAt);

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

router.post("/blog", requireAuth, requireRole(...CONTENT_ROLES), async (req, res): Promise<void> => {
  const { slug, title, locale = "en", published = false, content, excerpt, coverImage, category } = req.body;
  if (!slug || !title) {
    res.status(400).json({ error: "slug and title are required" });
    return;
  }
  const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  if (!slugRegex.test(slug)) {
    res.status(400).json({ error: "slug must be lowercase alphanumeric with hyphens only" });
    return;
  }
  const [post] = await db.insert(blogPostsTable).values({
    slug, title, locale, published,
    content: content || null,
    excerpt: excerpt || null,
    coverImage: coverImage || null,
    category: category || null,
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

router.patch("/blog/:slug", requireAuth, requireRole(...CONTENT_ROLES), async (req, res): Promise<void> => {
  const slug = Array.isArray(req.params.slug) ? req.params.slug[0] : req.params.slug;
  const updates: Record<string, unknown> = {};
  for (const key of BLOG_PATCH_FIELDS) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
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
  const data = await db
    .select()
    .from(announcementsTable)
    .where(eq(announcementsTable.isActive, true))
    .orderBy(announcementsTable.createdAt);
  res.json(data);
});

router.post("/announcements", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  const { title, content, audience = "all", isActive = true, expiresAt } = req.body;
  if (!title || !content) {
    res.status(400).json({ error: "title and content are required" });
    return;
  }
  const [ann] = await db.insert(announcementsTable).values({
    title, content, audience, isActive, expiresAt: expiresAt || null,
  }).returning();
  res.status(201).json(ann);
});

router.patch("/announcements/:id", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const updates: Record<string, unknown> = {};
  for (const key of ANN_PATCH_FIELDS) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
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
  const id = parseInt(req.params.id, 10);
  await db.delete(announcementsTable).where(eq(announcementsTable.id, id));
  res.sendStatus(204);
});

export default router;
