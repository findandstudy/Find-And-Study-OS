import { Router, type IRouter } from "express";
import { db, universitiesTable, programsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();

router.get("/universities", async (req, res): Promise<void> => {
  const { country, search, page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = parseInt(page, 10);
  const limitNum = parseInt(limit, 10);
  const offset = (pageNum - 1) * limitNum;

  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(universitiesTable);

  const data = await db
    .select()
    .from(universitiesTable)
    .limit(limitNum)
    .offset(offset)
    .orderBy(universitiesTable.name);

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

router.post("/universities", requireAuth, async (req, res): Promise<void> => {
  const { name, country, isActive = true, ...rest } = req.body;
  if (!name || !country) {
    res.status(400).json({ error: "name and country are required" });
    return;
  }
  const [uni] = await db.insert(universitiesTable).values({ name, country, isActive, ...rest }).returning();
  res.status(201).json(uni);
});

router.get("/universities/:id", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  const [uni] = await db.select().from(universitiesTable).where(eq(universitiesTable.id, id));
  if (!uni) { res.status(404).json({ error: "University not found" }); return; }
  res.json(uni);
});

router.patch("/universities/:id", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  const [uni] = await db.update(universitiesTable).set(req.body).where(eq(universitiesTable.id, id)).returning();
  if (!uni) { res.status(404).json({ error: "University not found" }); return; }
  res.json(uni);
});

router.delete("/universities/:id", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  await db.delete(universitiesTable).where(eq(universitiesTable.id, id));
  res.sendStatus(204);
});

router.get("/programs", async (req, res): Promise<void> => {
  const { universityId, country, language, search, page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = parseInt(page, 10);
  const limitNum = parseInt(limit, 10);
  const offset = (pageNum - 1) * limitNum;

  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(programsTable);

  const data = await db
    .select()
    .from(programsTable)
    .limit(limitNum)
    .offset(offset)
    .orderBy(programsTable.name);

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

router.post("/programs", requireAuth, async (req, res): Promise<void> => {
  const { universityId, name, isActive = true, ...rest } = req.body;
  if (!universityId || !name) {
    res.status(400).json({ error: "universityId and name are required" });
    return;
  }
  const [prog] = await db.insert(programsTable).values({ universityId, name, isActive, ...rest }).returning();
  res.status(201).json(prog);
});

router.get("/programs/:id", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  const [prog] = await db.select().from(programsTable).where(eq(programsTable.id, id));
  if (!prog) { res.status(404).json({ error: "Program not found" }); return; }
  res.json(prog);
});

router.patch("/programs/:id", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  const [prog] = await db.update(programsTable).set(req.body).where(eq(programsTable.id, id)).returning();
  if (!prog) { res.status(404).json({ error: "Program not found" }); return; }
  res.json(prog);
});

router.delete("/programs/:id", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  await db.delete(programsTable).where(eq(programsTable.id, id));
  res.sendStatus(204);
});

export default router;
