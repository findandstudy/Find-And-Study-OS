import { Router, type IRouter } from "express";
import { db, studentsTable } from "@workspace/db";
import { eq, ilike, or, sql, and } from "drizzle-orm";
import { requireAuth, requireRole } from "../lib/auth";
import { STAFF_ROLES } from "../lib/roles";

const router: IRouter = Router();

const STUDENT_PATCH_FIELDS = [
  "firstName", "lastName", "email", "phone", "nationality",
  "dateOfBirth", "passportNumber", "address", "emergencyContact",
  "status", "agentId", "userId", "language", "notes",
];

router.get("/students/me", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const [student] = await db.select().from(studentsTable).where(eq(studentsTable.userId, userId));
  if (!student) { res.status(404).json({ error: "Student profile not found" }); return; }
  res.json(student);
});

router.get("/students", requireAuth, requireRole(...STAFF_ROLES), async (req, res): Promise<void> => {
  const { agentId, status, search, page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];
  if (status) conditions.push(eq(studentsTable.status, status));
  if (agentId) conditions.push(eq(studentsTable.agentId, parseInt(agentId, 10)));
  if (search) {
    conditions.push(
      or(
        ilike(studentsTable.firstName, `%${search}%`),
        ilike(studentsTable.lastName, `%${search}%`),
        ilike(studentsTable.email, `%${search}%`)
      )
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(studentsTable)
    .where(whereClause);

  const data = await db
    .select()
    .from(studentsTable)
    .where(whereClause)
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

router.post("/students", requireAuth, requireRole(...STAFF_ROLES), async (req, res): Promise<void> => {
  const { firstName, lastName, status = "active", email, phone, nationality, agentId, userId, notes } = req.body;
  if (!firstName || !lastName) {
    res.status(400).json({ error: "firstName and lastName are required" });
    return;
  }
  const [student] = await db.insert(studentsTable).values({
    firstName, lastName, status,
    email: email || null,
    phone: phone || null,
    nationality: nationality || null,
    agentId: agentId || null,
    userId: userId || null,
    notes: notes || null,
  }).returning();
  res.status(201).json(student);
});

router.get("/students/:id", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const user = req.user!;

  const [student] = await db.select().from(studentsTable).where(eq(studentsTable.id, id));
  if (!student) { res.status(404).json({ error: "Student not found" }); return; }

  const isStaff = STAFF_ROLES.includes(user.role as any);
  const isOwnProfile = student.userId === user.id;

  if (!isStaff && !isOwnProfile) {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  res.json(student);
});

router.patch("/students/:id", requireAuth, requireRole(...STAFF_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const updates: Record<string, unknown> = {};
  for (const key of STUDENT_PATCH_FIELDS) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No valid fields to update" });
    return;
  }
  const [student] = await db.update(studentsTable).set(updates).where(eq(studentsTable.id, id)).returning();
  if (!student) { res.status(404).json({ error: "Student not found" }); return; }
  res.json(student);
});

export default router;
