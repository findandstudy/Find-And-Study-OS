import { Router, type IRouter } from "express";
import { db, blogPostsTable, announcementsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();

router.get("/blog", async (req, res): Promise<void> => {
  const { locale, published, page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = parseInt(page, 10);
  const limitNum = parseInt(limit, 10);
  const offset = (pageNum - 1) * limitNum;

  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(blogPostsTable);

  const data = await db
    .select()
    .from(blogPostsTable)
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

router.post("/blog", requireAuth, async (req, res): Promise<void> => {
  const { slug, title, locale = "en", published = false, ...rest } = req.body;
  if (!slug || !title) {
    res.status(400).json({ error: "slug and title are required" });
    return;
  }
  const [post] = await db.insert(blogPostsTable).values({ slug, title, locale, published, ...rest }).returning();
  res.status(201).json(post);
});

router.get("/blog/:slug", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.slug) ? req.params.slug[0] : req.params.slug;
  const [post] = await db.select().from(blogPostsTable).where(eq(blogPostsTable.slug, raw));
  if (!post) { res.status(404).json({ error: "Blog post not found" }); return; }
  res.json(post);
});

router.patch("/blog/:slug", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.slug) ? req.params.slug[0] : req.params.slug;
  const [post] = await db.update(blogPostsTable).set(req.body).where(eq(blogPostsTable.slug, raw)).returning();
  if (!post) { res.status(404).json({ error: "Blog post not found" }); return; }
  res.json(post);
});

router.delete("/blog/:slug", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.slug) ? req.params.slug[0] : req.params.slug;
  await db.delete(blogPostsTable).where(eq(blogPostsTable.slug, raw));
  res.sendStatus(204);
});

router.get("/announcements", async (req, res): Promise<void> => {
  const { audience, active } = req.query as Record<string, string>;
  const data = await db.select().from(announcementsTable).orderBy(announcementsTable.createdAt);
  res.json(data);
});

router.post("/announcements", requireAuth, async (req, res): Promise<void> => {
  const { title, content, audience = "all", isActive = true, ...rest } = req.body;
  if (!title || !content) {
    res.status(400).json({ error: "title and content are required" });
    return;
  }
  const [ann] = await db.insert(announcementsTable).values({ title, content, audience, isActive, ...rest }).returning();
  res.status(201).json(ann);
});

router.patch("/announcements/:id", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  const [ann] = await db.update(announcementsTable).set(req.body).where(eq(announcementsTable.id, id)).returning();
  if (!ann) { res.status(404).json({ error: "Announcement not found" }); return; }
  res.json(ann);
});

router.delete("/announcements/:id", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  await db.delete(announcementsTable).where(eq(announcementsTable.id, id));
  res.sendStatus(204);
});

export default router;
