import { Router, type IRouter } from "express";
import { db, studentsTable, documentsTable, usersTable } from "@workspace/db";
import { eq, ilike, or, sql, and, desc, inArray } from "drizzle-orm";
import { requireAuth, requireRole, logAudit } from "../lib/auth";
import { STAFF_ROLES, ADMIN_ROLES } from "../lib/roles";
import { getAgentVisibleIds, getAgentRecord } from "../lib/agentVisibility";
import { isNull } from "drizzle-orm";

const router: IRouter = Router();

const STUDENT_PATCH_FIELDS = [
  "firstName", "lastName", "email", "phone", "nationality",
  "dateOfBirth", "passportNumber", "passportIssueDate", "passportExpiry",
  "motherName", "fatherName", "address",
  "status", "agentId", "assignedToId", "userId", "notes",
  "highSchool", "graduationYear", "gpa", "languageScore",
  "universityBachelor", "universityMaster",
  "photoUrl",
];

router.get("/students/me", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const [student] = await db.select().from(studentsTable).where(and(eq(studentsTable.userId, userId), isNull(studentsTable.deletedAt)));
  if (!student) { res.status(404).json({ error: "Student profile not found" }); return; }
  res.json(student);
});

router.get("/students/my-advisor", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const [student] = await db.select().from(studentsTable).where(and(eq(studentsTable.userId, userId), isNull(studentsTable.deletedAt)));
  if (!student) { res.status(404).json({ error: "Student profile not found" }); return; }
  if (!student.assignedToId) { res.json(null); return; }
  const [advisor] = await db
    .select({
      id: usersTable.id,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      email: usersTable.email,
      phone: usersTable.phone,
      role: usersTable.role,
      avatarUrl: usersTable.avatarUrl,
    })
    .from(usersTable)
    .where(eq(usersTable.id, student.assignedToId));
  if (!advisor) { res.json(null); return; }
  res.json(advisor);
});

router.put("/students/me", requireAuth, async (req, res): Promise<void> => {
  if (req.user!.role !== "student") { res.status(403).json({ error: "Students only" }); return; }
  const userId = req.user!.id;
  const SELF_FIELDS = [
    "firstName", "lastName", "phone", "nationality",
    "dateOfBirth", "passportNumber", "passportIssueDate", "passportExpiry",
    "motherName", "fatherName", "address",
    "highSchool", "universityBachelor", "universityMaster",
    "graduationYear", "gpa", "languageScore",
  ];
  const data: Record<string, unknown> = {};
  for (const k of SELF_FIELDS) {
    if (req.body[k] !== undefined) data[k] = req.body[k];
  }

  const [existing] = await db.select().from(studentsTable).where(eq(studentsTable.userId, userId));
  if (existing) {
    const [updated] = await db.update(studentsTable).set(data).where(eq(studentsTable.id, existing.id)).returning();
    res.json(updated);
  } else {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    if (!user) { res.status(404).json({ error: "User not found" }); return; }
    const [created] = await db.insert(studentsTable).values({
      userId,
      firstName: (data.firstName as string) || user.firstName || "",
      lastName: (data.lastName as string) || user.lastName || "",
      email: user.email || "",
      ...data,
    }).returning();
    res.json(created);
  }
});

router.get("/students/:id/photo", requireAuth, async (req, res): Promise<void> => {
  const studentId = parseInt(req.params.id, 10);
  const [photoDoc] = await db.select({ fileData: documentsTable.fileData, mimeType: documentsTable.mimeType })
    .from(documentsTable)
    .where(and(eq(documentsTable.studentId, studentId), eq(documentsTable.type, "photo"), isNull(documentsTable.deletedAt)))
    .orderBy(desc(documentsTable.createdAt))
    .limit(1);
  if (!photoDoc?.fileData) { res.status(404).json({ error: "No photo" }); return; }
  const buffer = Buffer.from(photoDoc.fileData, "base64");
  res.set("Content-Type", photoDoc.mimeType || "image/jpeg");
  res.set("Cache-Control", "public, max-age=300");
  res.send(buffer);
});

router.get("/students", requireAuth, requireRole(...STAFF_ROLES, "student" as any, "agent" as any, "sub_agent" as any), async (req, res): Promise<void> => {
  const user = req.user!;
  const { agentId, status, search, season, page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(500, Math.max(1, parseInt(limit, 10)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [isNull(studentsTable.deletedAt)];

  if (season) conditions.push(eq(studentsTable.season, season));
  if (status) conditions.push(eq(studentsTable.status, status));
  if (agentId && STAFF_ROLES.includes(user.role as any)) {
    conditions.push(eq(studentsTable.agentId, parseInt(agentId, 10)));
  }
  if (user.role === "agent" || user.role === "sub_agent") {
    const visibleIds = await getAgentVisibleIds(user.id, user.role);
    if (visibleIds.length === 0) {
      res.json({ data: [], meta: { total: 0, page: pageNum, limit: limitNum, totalPages: 0 } });
      return;
    }
    conditions.push(inArray(studentsTable.agentId, visibleIds));
  } else if (user.role === "student") {
    conditions.push(eq(studentsTable.userId, user.id));
  } else if (!(ADMIN_ROLES as readonly string[]).includes(user.role)) {
    conditions.push(
      or(
        eq(studentsTable.assignedToId, user.id),
        isNull(studentsTable.assignedToId)
      )
    );
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

  const rows = await db
    .select()
    .from(studentsTable)
    .where(whereClause)
    .limit(limitNum)
    .offset(offset)
    .orderBy(desc(studentsTable.createdAt));

  const studentIds = rows.map(r => r.id);
  let photoSet = new Set<number>();
  if (studentIds.length > 0) {
    const photoDocs = await db.select({ studentId: documentsTable.studentId })
      .from(documentsTable)
      .where(and(
        sql`${documentsTable.studentId} IN (${sql.join(studentIds.map(id => sql`${id}`), sql`, `)})`,
        eq(documentsTable.type, "photo"),
      ));
    photoSet = new Set(photoDocs.map(d => d.studentId!));
  }

  const data = rows.map(r => ({ ...r, hasPhoto: photoSet.has(r.id) }));

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

  let resolvedAgentId = agentId || null;
  if (req.user!.role === "agent" || req.user!.role === "sub_agent") {
    const agentRec = await getAgentRecord(req.user!.id);
    if (!agentRec) {
      res.status(403).json({ error: "No agent record found" });
      return;
    }
    resolvedAgentId = agentRec.id;
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
    agentId: resolvedAgentId,
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

  const [student] = await db.select().from(studentsTable).where(and(eq(studentsTable.id, id), isNull(studentsTable.deletedAt)));
  if (!student) { res.status(404).json({ error: "Student not found" }); return; }

  const isStaff = STAFF_ROLES.includes(user.role as any);
  const isAdmin = (ADMIN_ROLES as readonly string[]).includes(user.role);
  const isOwnProfile = student.userId === user.id;
  const isAgent = user.role === "agent" || user.role === "sub_agent";

  if (isAgent) {
    const visibleIds = await getAgentVisibleIds(user.id, user.role);
    if (!student.agentId || !visibleIds.includes(student.agentId)) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
  } else if (isStaff && !isAdmin) {
    if (student.assignedToId !== null && student.assignedToId !== user.id) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
  } else if (!isStaff && !isOwnProfile) {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  res.json(student);
});

router.patch("/students/:id", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const role = req.user!.role;
  const isStaff = (STAFF_ROLES as readonly string[]).includes(role);
  const isAgent = role === "agent" || role === "sub_agent";
  const isStudent = role === "student";
  if (!isStaff && !isAgent && !isStudent) { res.status(403).json({ error: "Forbidden" }); return; }

  const [existing] = await db.select().from(studentsTable).where(and(eq(studentsTable.id, id), isNull(studentsTable.deletedAt)));
  if (!existing) { res.status(404).json({ error: "Student not found" }); return; }

  if (isStudent) {
    if (existing.userId !== req.user!.id) {
      res.status(403).json({ error: "You can only edit your own record" }); return;
    }
  } else if (isAgent) {
    const visibleAgentIds = await getAgentVisibleIds(req.user!.id, role);
    if (visibleAgentIds.length === 0) { res.status(403).json({ error: "Agent profile not found" }); return; }
    if (!existing.agentId || !visibleAgentIds.includes(existing.agentId)) {
      res.status(403).json({ error: "You can only edit your own students" }); return;
    }
  } else if (!(ADMIN_ROLES as readonly string[]).includes(role)) {
    if (existing.assignedToId !== null && existing.assignedToId !== req.user!.id) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
  }

  const STUDENT_SELF_FIELDS = [
    "firstName", "lastName", "phone", "nationality",
    "dateOfBirth", "passportNumber", "passportIssueDate", "passportExpiry",
    "motherName", "fatherName", "address",
    "highSchool", "universityBachelor", "universityMaster",
    "graduationYear", "gpa", "languageScore", "photoUrl",
  ];
  const isAdmin = (ADMIN_ROLES as readonly string[]).includes(role);
  let allowedFields = isStudent
    ? STUDENT_SELF_FIELDS
    : isAgent
    ? STUDENT_PATCH_FIELDS.filter(f => f !== "agentId" && f !== "userId" && f !== "assignedToId")
    : STUDENT_PATCH_FIELDS;
  if (!isAdmin && !isAgent) {
    if (req.body.assignedToId !== undefined) {
      if (existing.assignedToId !== null) {
        allowedFields = allowedFields.filter(f => f !== "assignedToId");
      } else if (req.body.assignedToId !== req.user!.id) {
        allowedFields = allowedFields.filter(f => f !== "assignedToId");
      }
    }
  }
  const updates: Record<string, unknown> = {};
  for (const key of allowedFields) {
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
  const [deleted] = await db.update(studentsTable)
    .set({ deletedAt: new Date() })
    .where(and(eq(studentsTable.id, id), isNull(studentsTable.deletedAt)))
    .returning();
  if (!deleted) { res.status(404).json({ error: "Student not found" }); return; }
  await logAudit(req.user!.id, "delete_student", "student", id, null, req.ip);
  res.status(204).end();
});

export default router;
