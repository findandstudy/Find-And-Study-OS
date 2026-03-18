import { Router, type IRouter } from "express";
import { db, studentsTable } from "@workspace/db";
import { eq, ilike, or, sql, and } from "drizzle-orm";
import { requireAuth, requireRole, logAudit } from "../lib/auth";
import { STAFF_ROLES } from "../lib/roles";

const router: IRouter = Router();

const STUDENT_PATCH_FIELDS = [
  "firstName", "lastName", "email", "phone", "nationality",
  "dateOfBirth", "passportNumber", "passportIssueDate", "passportExpiry",
  "motherName", "fatherName", "address",
  "status", "agentId", "userId", "notes",
  "highSchool", "graduationYear", "gpa", "languageScore",
];

router.get("/students/me", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const [student] = await db.select().from(studentsTable).where(eq(studentsTable.userId, userId));
  if (!student) { res.status(404).json({ error: "Student profile not found" }); return; }
  res.json(student);
});

router.get("/students", requireAuth, requireRole(...STAFF_ROLES, "student" as any, "agent" as any, "sub_agent" as any), async (req, res): Promise<void> => {
  const user = req.user!;
  const { agentId, status, search, season, page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(500, Math.max(1, parseInt(limit, 10)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];

  if (season) conditions.push(eq(studentsTable.season, season));
  if (status) conditions.push(eq(studentsTable.status, status));
  if (agentId && STAFF_ROLES.includes(user.role as any)) {
    conditions.push(eq(studentsTable.agentId, parseInt(agentId, 10)));
  }
  if (user.role === "agent" || user.role === "sub_agent") {
    const agentRecord = await db.query?.agents?.findFirst?.({ where: (a: any, { eq: eq2 }: any) => eq2(a.userId, user.id) });
    if (agentRecord) conditions.push(eq(studentsTable.agentId, agentRecord.id));
  }
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

router.post("/students", requireAuth, requireRole(...STAFF_ROLES, "agent" as any, "sub_agent" as any), async (req, res): Promise<void> => {
  const {
    firstName, lastName, status = "active",
    email, phone, nationality,
    dateOfBirth, passportNumber, passportIssueDate, passportExpiry,
    motherName, fatherName, address,
    agentId, userId, notes,
    highSchool, graduationYear, gpa, languageScore, season,
  } = req.body;

  if (!firstName || !lastName) {
    res.status(400).json({ error: "firstName and lastName are required" });
    return;
  }

  const [student] = await db.insert(studentsTable).values({
    firstName, lastName, status,
    email: email || null,
    phone: phone || null,
    nationality: nationality || null,
    dateOfBirth: dateOfBirth || null,
    passportNumber: passportNumber || null,
    passportIssueDate: passportIssueDate || null,
    passportExpiry: passportExpiry || null,
    motherName: motherName || null,
    fatherName: fatherName || null,
    address: address || null,
    agentId: agentId || null,
    userId: userId || null,
    notes: notes || null,
    highSchool: highSchool || null,
    graduationYear: graduationYear ? parseInt(String(graduationYear), 10) : null,
    gpa: gpa || null,
    languageScore: languageScore || null,
    season: season || String(new Date().getFullYear()),
  }).returning();

  await logAudit(req.user!.id, "create_student", "student", student.id, { firstName, lastName }, req.ip);
  res.status(201).json(student);
});

router.post("/students/bulk", requireAuth, requireRole(...STAFF_ROLES, "agent" as any), async (req, res): Promise<void> => {
  const { students } = req.body as { students: any[] };
  if (!Array.isArray(students) || students.length === 0) {
    res.status(400).json({ error: "students array is required" });
    return;
  }

  const inserted: any[] = [];
  const errors: any[] = [];

  for (let i = 0; i < students.length; i++) {
    const s = students[i];
    if (!s.firstName || !s.lastName) {
      errors.push({ index: i, error: "firstName and lastName are required", row: s });
      continue;
    }
    try {
      const [student] = await db.insert(studentsTable).values({
        firstName: s.firstName,
        lastName: s.lastName,
        status: s.status || "active",
        email: s.email || null,
        phone: s.phone || null,
        nationality: s.nationality || null,
        dateOfBirth: s.dateOfBirth || null,
        passportNumber: s.passportNumber || null,
        passportIssueDate: s.passportIssueDate || null,
        passportExpiry: s.passportExpiry || null,
        motherName: s.motherName || null,
        fatherName: s.fatherName || null,
        address: s.address || null,
        notes: s.notes || null,
        highSchool: s.highSchool || null,
        graduationYear: s.graduationYear ? parseInt(String(s.graduationYear), 10) : null,
        gpa: s.gpa || null,
        languageScore: s.languageScore || null,
      }).returning();
      inserted.push(student);
    } catch (err: any) {
      errors.push({ index: i, error: err.message, row: s });
    }
  }

  await logAudit(req.user!.id, "bulk_create_students", "student", null, { count: inserted.length }, req.ip);
  res.status(201).json({ inserted, errors, total: students.length, success: inserted.length });
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
  await logAudit(req.user!.id, "update_student", "student", id, updates, req.ip);
  res.json(student);
});

router.delete("/students/:id", requireAuth, requireRole(...STAFF_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [deleted] = await db.delete(studentsTable).where(eq(studentsTable.id, id)).returning();
  if (!deleted) { res.status(404).json({ error: "Student not found" }); return; }
  await logAudit(req.user!.id, "delete_student", "student", id, null, req.ip);
  res.status(204).end();
});

export default router;
