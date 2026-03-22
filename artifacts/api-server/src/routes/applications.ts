import { Router, type IRouter } from "express";
import { db, applicationsTable, notesTable, usersTable, studentsTable, agentsTable, commissionsTable } from "@workspace/db";
import { eq, sql, and, inArray } from "drizzle-orm";
import { requireAuth, requireRole, logAudit } from "../lib/auth";
import { STAFF_ROLES } from "../lib/roles";
import { getAgentVisibleIds, getAgentRecord } from "../lib/agentVisibility";

const router: IRouter = Router();

const APP_PATCH_FIELDS = [
  "stage", "universityId", "programId", "agentId",
  "universityName", "country", "programName", "intake",
  "level", "instructionLanguage", "deadline",
  "tuitionFee", "scholarship", "notes", "season",
];

router.get("/applications", requireAuth, async (req, res): Promise<void> => {
  const { studentId, agentId, stage, season, page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(500, Math.max(1, parseInt(limit, 10)));
  const offset = (pageNum - 1) * limitNum;

  const user = req.user!;
  const isStaff = STAFF_ROLES.includes(user.role as any);

  const conditions = [];

  if (season) conditions.push(eq(applicationsTable.season, season));

  if (isStaff) {
    if (studentId) conditions.push(eq(applicationsTable.studentId, parseInt(studentId, 10)));
    if (agentId) conditions.push(eq(applicationsTable.agentId, parseInt(agentId, 10)));
    if (stage) conditions.push(eq(applicationsTable.stage, stage));
  } else if (user.role === "student") {
    const [studentRec] = await db.select().from(studentsTable).where(eq(studentsTable.userId, user.id));
    if (!studentRec) {
      res.json({ data: [], meta: { total: 0, page: pageNum, limit: limitNum, totalPages: 0 } });
      return;
    }
    conditions.push(eq(applicationsTable.studentId, studentRec.id));
  } else if (user.role === "agent" || user.role === "sub_agent") {
    const visibleIds = await getAgentVisibleIds(user.id, user.role);
    if (visibleIds.length === 0) {
      res.json({ data: [], meta: { total: 0, page: pageNum, limit: limitNum, totalPages: 0 } });
      return;
    }
    conditions.push(inArray(applicationsTable.agentId, visibleIds));
    if (stage) conditions.push(eq(applicationsTable.stage, stage));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(applicationsTable)
    .where(whereClause);

  const rows = await db
    .select({
      id: applicationsTable.id,
      studentId: applicationsTable.studentId,
      programId: applicationsTable.programId,
      universityId: applicationsTable.universityId,
      agentId: applicationsTable.agentId,
      season: applicationsTable.season,
      stage: applicationsTable.stage,
      intake: applicationsTable.intake,
      level: applicationsTable.level,
      instructionLanguage: applicationsTable.instructionLanguage,
      deadline: applicationsTable.deadline,
      programName: applicationsTable.programName,
      universityName: applicationsTable.universityName,
      country: applicationsTable.country,
      tuitionFee: applicationsTable.tuitionFee,
      scholarship: applicationsTable.scholarship,
      notes: applicationsTable.notes,
      createdAt: applicationsTable.createdAt,
      updatedAt: applicationsTable.updatedAt,
      studentFirstName: studentsTable.firstName,
      studentLastName: studentsTable.lastName,
      studentEmail: studentsTable.email,
      commissionAmount: commissionsTable.universityCommissionAmount,
    })
    .from(applicationsTable)
    .leftJoin(studentsTable, eq(applicationsTable.studentId, studentsTable.id))
    .leftJoin(commissionsTable, eq(applicationsTable.id, commissionsTable.applicationId))
    .where(whereClause)
    .limit(limitNum)
    .offset(offset)
    .orderBy(applicationsTable.createdAt);

  res.json({
    data: rows,
    meta: {
      total: Number(count),
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(Number(count) / limitNum),
    },
  });
});

router.post("/applications", requireAuth, requireRole(...STAFF_ROLES, "agent" as any, "sub_agent" as any), async (req, res): Promise<void> => {
  const user = req.user!;
  const {
    studentId, stage = "inquiry", universityId, programId, agentId,
    universityName, country, programName, intake, level, instructionLanguage,
    deadline, tuitionFee, scholarship, notes, season,
  } = req.body;
  if (!studentId) {
    res.status(400).json({ error: "studentId is required" });
    return;
  }
  const currentYear = String(new Date().getFullYear());
  let resolvedAgentId = agentId || null;
  if (user.role === "agent" || user.role === "sub_agent") {
    const agentRec = await getAgentRecord(user.id);
    if (!agentRec) {
      res.status(403).json({ error: "No agent record found" });
      return;
    }
    resolvedAgentId = agentRec.id;
    const visibleIds = await getAgentVisibleIds(user.id, user.role);
    const [studentRec] = await db.select({ agentId: studentsTable.agentId }).from(studentsTable).where(eq(studentsTable.id, parseInt(studentId, 10)));
    if (!studentRec || !visibleIds.includes(studentRec.agentId!)) {
      res.status(403).json({ error: "Student not in your scope" });
      return;
    }
  }
  const [app] = await db.insert(applicationsTable).values({
    studentId, stage,
    season: season || currentYear,
    universityId: universityId || null,
    programId: programId || null,
    agentId: resolvedAgentId,
    universityName: universityName || null,
    country: country || null,
    programName: programName || null,
    intake: intake || null,
    level: level || null,
    instructionLanguage: instructionLanguage || null,
    deadline: deadline || null,
    tuitionFee: tuitionFee ? Number(tuitionFee) : null,
    scholarship: scholarship ? Number(scholarship) : null,
    notes: notes || null,
  }).returning();
  await logAudit(req.user!.id, "create_application", "application", app.id, { studentId }, req.ip);
  res.status(201).json(app);
});

router.get("/applications/:id", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [row] = await db
    .select({
      id: applicationsTable.id,
      studentId: applicationsTable.studentId,
      programId: applicationsTable.programId,
      universityId: applicationsTable.universityId,
      agentId: applicationsTable.agentId,
      season: applicationsTable.season,
      stage: applicationsTable.stage,
      intake: applicationsTable.intake,
      level: applicationsTable.level,
      instructionLanguage: applicationsTable.instructionLanguage,
      deadline: applicationsTable.deadline,
      programName: applicationsTable.programName,
      universityName: applicationsTable.universityName,
      country: applicationsTable.country,
      tuitionFee: applicationsTable.tuitionFee,
      scholarship: applicationsTable.scholarship,
      notes: applicationsTable.notes,
      createdAt: applicationsTable.createdAt,
      updatedAt: applicationsTable.updatedAt,
      studentFirstName: studentsTable.firstName,
      studentLastName: studentsTable.lastName,
      studentEmail: studentsTable.email,
      studentPhone: studentsTable.phone,
      commissionAmount: commissionsTable.universityCommissionAmount,
      commissionStatus: commissionsTable.status,
    })
    .from(applicationsTable)
    .leftJoin(studentsTable, eq(applicationsTable.studentId, studentsTable.id))
    .leftJoin(commissionsTable, eq(applicationsTable.id, commissionsTable.applicationId))
    .where(eq(applicationsTable.id, id));
  if (!row) { res.status(404).json({ error: "Application not found" }); return; }

  const user = req.user!;
  const isStaff = STAFF_ROLES.includes(user.role as any);
  if (!isStaff) {
    if (user.role === "student") {
      const [studentRec] = await db.select().from(studentsTable).where(eq(studentsTable.userId, user.id));
      if (!studentRec || studentRec.id !== row.studentId) {
        res.status(403).json({ error: "Access denied" }); return;
      }
    } else if (user.role === "agent" || user.role === "sub_agent") {
      const visibleIds = await getAgentVisibleIds(user.id, user.role);
      if (!row.agentId || !visibleIds.includes(row.agentId)) {
        res.status(403).json({ error: "Access denied" }); return;
      }
    } else {
      res.status(403).json({ error: "Access denied" }); return;
    }
  }

  res.json(row);
});

router.patch("/applications/:id", requireAuth, requireRole(...STAFF_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const updates: Record<string, unknown> = {};
  for (const key of APP_PATCH_FIELDS) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No valid fields to update" });
    return;
  }
  const [app] = await db.update(applicationsTable).set(updates).where(eq(applicationsTable.id, id)).returning();
  if (!app) { res.status(404).json({ error: "Application not found" }); return; }

  if (updates.stage !== undefined) {
    if (updates.stage === "enrolled") {
      await db
        .update(commissionsTable)
        .set({ status: "confirmed", confirmedAt: new Date().toISOString() })
        .where(
          and(
            eq(commissionsTable.applicationId, id),
            eq(commissionsTable.status, "potential")
          )
        );
    } else {
      await db
        .update(commissionsTable)
        .set({ status: "potential", confirmedAt: null })
        .where(
          and(
            eq(commissionsTable.applicationId, id),
            eq(commissionsTable.status, "confirmed"),
            eq(commissionsTable.universityCollected, "0")
          )
        );
    }
  }

  await logAudit(req.user!.id, "update_application", "application", id, updates, req.ip);
  res.json(app);
});

router.delete("/applications/:id", requireAuth, requireRole(...STAFF_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  await db.delete(applicationsTable).where(eq(applicationsTable.id, id));
  await logAudit(req.user!.id, "delete_application", "application", id, {}, req.ip);
  res.sendStatus(204);
});

router.get("/applications/:id/notes", requireAuth, requireRole(...STAFF_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
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
    .where(and(eq(notesTable.resourceId, id), eq(notesTable.resourceType, "application")))
    .orderBy(notesTable.createdAt);
  res.json(notes);
});

router.post("/applications/:id/notes", requireAuth, requireRole(...STAFF_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const { content } = req.body;
  if (!content?.trim()) { res.status(400).json({ error: "content is required" }); return; }
  const [note] = await db.insert(notesTable).values({
    content: String(content).slice(0, 5000),
    authorId: req.user!.id,
    resourceType: "application",
    resourceId: id,
  }).returning();
  res.status(201).json({ ...note, authorName: `${req.user!.firstName || ""} ${req.user!.lastName || ""}`.trim() });
});

export default router;
