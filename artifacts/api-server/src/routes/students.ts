import { Router, type IRouter } from "express";
import { db, studentsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();

router.get("/students/me", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const [student] = await db.select().from(studentsTable).where(eq(studentsTable.userId, userId));
  if (!student) { res.status(404).json({ error: "Student profile not found" }); return; }
  res.json(student);
});

router.get("/students", requireAuth, async (req, res): Promise<void> => {
  const { agentId, status, search, page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = parseInt(page, 10);
  const limitNum = parseInt(limit, 10);
  const offset = (pageNum - 1) * limitNum;

  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(studentsTable);

  const data = await db
    .select()
    .from(studentsTable)
    .limit(limitNum)
    .offset(offset)
    .orderBy(studentsTable.createdAt);

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

router.post("/students", requireAuth, async (req, res): Promise<void> => {
  const { firstName, lastName, status = "active", ...rest } = req.body;
  if (!firstName || !lastName) {
    res.status(400).json({ error: "firstName and lastName are required" });
    return;
  }
  const [student] = await db.insert(studentsTable).values({ firstName, lastName, status, ...rest }).returning();
  res.status(201).json(student);
});

router.get("/students/:id", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  const [student] = await db.select().from(studentsTable).where(eq(studentsTable.id, id));
  if (!student) { res.status(404).json({ error: "Student not found" }); return; }
  res.json(student);
});

router.patch("/students/:id", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  const [student] = await db.update(studentsTable).set(req.body).where(eq(studentsTable.id, id)).returning();
  if (!student) { res.status(404).json({ error: "Student not found" }); return; }
  res.json(student);
});

export default router;
