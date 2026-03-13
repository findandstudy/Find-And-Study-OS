import { Router, type IRouter } from "express";
import { db, applicationsTable, notesTable, usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();

router.get("/applications", requireAuth, async (req, res): Promise<void> => {
  const { studentId, agentId, stage, search, page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = parseInt(page, 10);
  const limitNum = parseInt(limit, 10);
  const offset = (pageNum - 1) * limitNum;

  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(applicationsTable);

  const data = await db
    .select()
    .from(applicationsTable)
    .limit(limitNum)
    .offset(offset)
    .orderBy(applicationsTable.createdAt);

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

router.post("/applications", requireAuth, async (req, res): Promise<void> => {
  const { studentId, stage = "inquiry", ...rest } = req.body;
  if (!studentId) {
    res.status(400).json({ error: "studentId is required" });
    return;
  }
  const [app] = await db.insert(applicationsTable).values({ studentId, stage, ...rest }).returning();
  res.status(201).json(app);
});

router.get("/applications/:id", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  const [app] = await db.select().from(applicationsTable).where(eq(applicationsTable.id, id));
  if (!app) { res.status(404).json({ error: "Application not found" }); return; }
  res.json(app);
});

router.patch("/applications/:id", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  const [app] = await db.update(applicationsTable).set(req.body).where(eq(applicationsTable.id, id)).returning();
  if (!app) { res.status(404).json({ error: "Application not found" }); return; }
  res.json(app);
});

router.delete("/applications/:id", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  await db.delete(applicationsTable).where(eq(applicationsTable.id, id));
  res.sendStatus(204);
});

router.get("/applications/:id/notes", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  const notes = await db
    .select({
      id: notesTable.id,
      content: notesTable.content,
      authorId: notesTable.authorId,
      authorName: sql<string | null>`concat(${usersTable.firstName}, ' ', ${usersTable.lastName})`,
      createdAt: notesTable.createdAt,
    })
    .from(notesTable)
    .leftJoin(usersTable, eq(notesTable.authorId, usersTable.id))
    .where(eq(notesTable.resourceId, id))
    .orderBy(notesTable.createdAt);
  res.json(notes);
});

router.post("/applications/:id/notes", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  const { content } = req.body;
  if (!content) { res.status(400).json({ error: "content is required" }); return; }
  const [note] = await db.insert(notesTable).values({
    content,
    authorId: req.user!.id,
    resourceType: "application",
    resourceId: id,
  }).returning();
  res.status(201).json({ ...note, authorName: `${req.user!.firstName || ""} ${req.user!.lastName || ""}`.trim() });
});

export default router;
