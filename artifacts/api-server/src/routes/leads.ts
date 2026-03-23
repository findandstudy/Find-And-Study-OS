import { Router, type IRouter } from "express";
import { db, leadsTable, studentsTable, notesTable, usersTable, followUpsTable, agentsTable, documentsTable, embedSubmissionsTable, applicationsTable, programsTable, universitiesTable } from "@workspace/db";
import { eq, ilike, or, sql, and, lte, gte, asc, desc, inArray, isNull } from "drizzle-orm";
import { requireAuth, requireRole, logAudit } from "../lib/auth";
import { publicLeadLimiter } from "../lib/limiters";
import { STAFF_ROLES, ADMIN_ROLES } from "../lib/roles";
import { getAgentVisibleIds, getAgentRecord } from "../lib/agentVisibility";

const router: IRouter = Router();

const LEAD_PATCH_FIELDS = [
  "firstName", "lastName", "email", "phone", "nationality",
  "interestedProgram", "interestedCountry", "source",
  "status", "assignedTo", "notes", "estimatedValue", "season", "agentId",
];

router.get("/nationalities", requireAuth, requireRole(...STAFF_ROLES), async (_req, res): Promise<void> => {
  const leadNats = db
    .selectDistinct({ nationality: leadsTable.nationality })
    .from(leadsTable)
    .where(sql`${leadsTable.nationality} IS NOT NULL AND ${leadsTable.nationality} != ''`);
  const studentNats = db
    .selectDistinct({ nationality: studentsTable.nationality })
    .from(studentsTable)
    .where(sql`${studentsTable.nationality} IS NOT NULL AND ${studentsTable.nationality} != ''`);
  const [lr, sr] = await Promise.all([leadNats, studentNats]);
  const all = new Set([...lr.map(r => r.nationality!), ...sr.map(r => r.nationality!)]);
  res.json([...all].sort());
});

router.post("/public/lead", publicLeadLimiter, async (req, res): Promise<void> => {
  const { firstName, lastName, email, phone, nationality, interestedProgram, interestedCountry, message } = req.body;
  if (!firstName || !lastName || !email) {
    res.status(400).json({ error: "firstName, lastName, and email are required" });
    return;
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    res.status(400).json({ error: "Invalid email address" });
    return;
  }
  await db.insert(leadsTable).values({
    firstName: String(firstName).slice(0, 100),
    lastName: String(lastName).slice(0, 100),
    email: String(email).slice(0, 255),
    phone: phone ? String(phone).slice(0, 30) : null,
    nationality: nationality ? String(nationality).slice(0, 100) : null,
    interestedProgram: interestedProgram ? String(interestedProgram).slice(0, 255) : null,
    interestedCountry: interestedCountry ? String(interestedCountry).slice(0, 100) : null,
    notes: message ? String(message).slice(0, 2000) : null,
    source: "website",
    status: "new",
  });
  res.status(201).json({ success: true, message: "Inquiry submitted successfully" });
});

router.get("/leads", requireAuth, requireRole(...STAFF_ROLES, "agent" as any, "sub_agent" as any), async (req, res): Promise<void> => {
  const user = req.user!;
  const { status, search, season, page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(500, Math.max(1, parseInt(limit, 10)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];
  if (season) conditions.push(eq(leadsTable.season, season));
  if (status) conditions.push(eq(leadsTable.status, status));

  if (user.role === "agent" || user.role === "sub_agent") {
    const visibleIds = await getAgentVisibleIds(user.id, user.role);
    if (visibleIds.length === 0) {
      res.json({ data: [], meta: { total: 0, page: pageNum, limit: limitNum, totalPages: 0 } });
      return;
    }
    conditions.push(inArray(leadsTable.agentId, visibleIds));
  } else if (!(ADMIN_ROLES as readonly string[]).includes(user.role)) {
    conditions.push(
      or(
        eq(leadsTable.assignedToId, user.id),
        isNull(leadsTable.assignedToId)
      )
    );
  }

  if (search) {
    conditions.push(
      or(
        ilike(leadsTable.firstName, `%${search}%`),
        ilike(leadsTable.lastName, `%${search}%`),
        ilike(leadsTable.email, `%${search}%`)
      )
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(leadsTable).where(whereClause);
  const data = await db.select().from(leadsTable).where(whereClause).limit(limitNum).offset(offset).orderBy(desc(leadsTable.createdAt));

  res.json({ data, meta: { total: Number(count), page: pageNum, limit: limitNum, totalPages: Math.ceil(Number(count) / limitNum) } });
});

router.post("/leads", requireAuth, requireRole(...STAFF_ROLES, "agent" as any, "sub_agent" as any), async (req, res): Promise<void> => {
  const user = req.user!;
  const { firstName, lastName, status = "new", email, phone, nationality, interestedProgram, interestedCountry, source, notes, assignedTo, season, agentId } = req.body;
  if (!firstName || !lastName) {
    res.status(400).json({ error: "firstName and lastName are required" });
    return;
  }
  const currentYear = String(new Date().getFullYear());
  let resolvedAgentId = agentId || null;
  if (user.role === "agent" || user.role === "sub_agent") {
    const agentRec = await getAgentRecord(user.id);
    resolvedAgentId = agentRec?.id || null;
  }
  const [lead] = await db.insert(leadsTable).values({
    firstName, lastName, status, email: email || null,
    phone: phone || null, nationality: nationality || null,
    interestedProgram: interestedProgram || null,
    interestedCountry: interestedCountry || null,
    source: source || null, notes: notes || null,
    assignedToId: assignedTo || null,
    agentId: resolvedAgentId,
    season: season || currentYear,
  }).returning();
  await logAudit(user.id, "create_lead", "lead", lead.id, {}, req.ip);
  res.status(201).json(lead);
});

router.get("/leads/:id", requireAuth, requireRole(...STAFF_ROLES, "agent" as any, "sub_agent" as any), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, id));
  if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }
  const user = req.user!;
  if (user.role === "agent" || user.role === "sub_agent") {
    const visibleIds = await getAgentVisibleIds(user.id, user.role);
    if (!lead.agentId || !visibleIds.includes(lead.agentId)) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
  } else if (!(ADMIN_ROLES as readonly string[]).includes(user.role)) {
    if (lead.assignedToId !== null && lead.assignedToId !== user.id) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
  }
  res.json(lead);
});

const AGENT_LEAD_PATCH_FIELDS = [
  "firstName", "lastName", "email", "phone", "nationality",
  "interestedProgram", "interestedCountry", "source",
  "status", "notes", "estimatedValue",
];

router.patch("/leads/:id", requireAuth, requireRole(...STAFF_ROLES, "agent" as any, "sub_agent" as any), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const user = req.user!;
  const isAgent = user.role === "agent" || user.role === "sub_agent";

  const [existing] = await db.select().from(leadsTable).where(eq(leadsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Lead not found" }); return; }

  if (isAgent) {
    const visibleIds = await getAgentVisibleIds(user.id, user.role);
    if (!existing.agentId || !visibleIds.includes(existing.agentId)) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
  } else if (!(ADMIN_ROLES as readonly string[]).includes(user.role)) {
    if (existing.assignedToId !== null && existing.assignedToId !== user.id) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
  }

  const isAdmin = (ADMIN_ROLES as readonly string[]).includes(user.role);
  let allowedFields = isAgent ? AGENT_LEAD_PATCH_FIELDS : LEAD_PATCH_FIELDS;
  if (!isAdmin && !isAgent) {
    if (req.body.assignedTo !== undefined) {
      if (existing.assignedToId !== null) {
        allowedFields = allowedFields.filter(f => f !== "assignedTo");
      } else if (req.body.assignedTo !== user.id) {
        allowedFields = allowedFields.filter(f => f !== "assignedTo");
      }
    }
  }
  const updates: Record<string, unknown> = {};
  for (const key of allowedFields) {
    if (req.body[key] !== undefined) {
      if (key === "assignedTo") {
        updates["assignedToId"] = req.body[key];
      } else {
        updates[key] = req.body[key];
      }
    }
  }
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No valid fields to update" });
    return;
  }
  const [lead] = await db.update(leadsTable).set(updates).where(eq(leadsTable.id, id)).returning();
  if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }
  await logAudit(user.id, "update_lead", "lead", id, updates, req.ip);
  res.json(lead);
});

router.delete("/leads/:id", requireAuth, requireRole(...STAFF_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(leadsTable).where(eq(leadsTable.id, id));
  await logAudit(req.user!.id, "delete_lead", "lead", id, {}, req.ip);
  res.sendStatus(204);
});

router.post("/leads/:id/convert", requireAuth, requireRole(...STAFF_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, id));
  if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }
  if (lead.status === "converted") {
    res.status(400).json({ error: "Lead is already converted" });
    return;
  }

  if (lead.convertedStudentId) {
    const [existing] = await db.select().from(studentsTable).where(eq(studentsTable.id, lead.convertedStudentId));
    if (existing) {
      res.status(400).json({ error: "Lead has already been converted", studentId: existing.id });
      return;
    }
  }

  const embedSubmissions = await db.select().from(embedSubmissionsTable).where(eq(embedSubmissionsTable.leadId, lead.id));
  const submission = embedSubmissions.length > 0 ? embedSubmissions[0] : null;
  const aiData: Record<string, any> = (submission?.aiExtractedData as Record<string, any>) || {};

  const s = (v: any) => (v && v !== "null" && v !== "N/A") ? String(v) : null;

  const studentValues: any = {
    firstName: lead.firstName,
    lastName: lead.lastName,
    email: lead.email || null,
    phone: lead.phone || null,
    nationality: lead.nationality || s(aiData.nationality) || null,
    agentId: (lead as any).agentId || null,
    status: "active",
    motherName: s(aiData.motherName) || null,
    fatherName: s(aiData.fatherName) || null,
    passportNumber: s(aiData.passportNumber) || null,
    passportIssueDate: s(aiData.passportIssueDate) || null,
    passportExpiry: s(aiData.passportExpiry) || null,
    dateOfBirth: s(aiData.dateOfBirth) || null,
    address: s(aiData.address) || null,
    highSchool: s(aiData.highSchool) || null,
    graduationYear: aiData.graduationYear ? parseInt(String(aiData.graduationYear), 10) || null : null,
    gpa: s(aiData.gpa) || null,
    languageScore: s(aiData.languageScore) || null,
  };

  if (lead.email) {
    const [existingByEmail] = await db.select().from(studentsTable).where(eq(studentsTable.email, lead.email));
    if (existingByEmail) {
      const mergeUpdates: any = {};
      if (!existingByEmail.motherName && studentValues.motherName) mergeUpdates.motherName = studentValues.motherName;
      if (!existingByEmail.fatherName && studentValues.fatherName) mergeUpdates.fatherName = studentValues.fatherName;
      if (!existingByEmail.passportNumber && studentValues.passportNumber) mergeUpdates.passportNumber = studentValues.passportNumber;
      if (!existingByEmail.passportIssueDate && studentValues.passportIssueDate) mergeUpdates.passportIssueDate = studentValues.passportIssueDate;
      if (!existingByEmail.passportExpiry && studentValues.passportExpiry) mergeUpdates.passportExpiry = studentValues.passportExpiry;
      if (!existingByEmail.dateOfBirth && studentValues.dateOfBirth) mergeUpdates.dateOfBirth = studentValues.dateOfBirth;
      if (!existingByEmail.address && studentValues.address) mergeUpdates.address = studentValues.address;
      if (!existingByEmail.highSchool && studentValues.highSchool) mergeUpdates.highSchool = studentValues.highSchool;
      if (!existingByEmail.gpa && studentValues.gpa) mergeUpdates.gpa = studentValues.gpa;
      if (!existingByEmail.languageScore && studentValues.languageScore) mergeUpdates.languageScore = studentValues.languageScore;
      if (!existingByEmail.graduationYear && studentValues.graduationYear) mergeUpdates.graduationYear = studentValues.graduationYear;

      if (Object.keys(mergeUpdates).length > 0) {
        await db.update(studentsTable).set(mergeUpdates).where(eq(studentsTable.id, existingByEmail.id));
      }

      await db.update(documentsTable).set({ studentId: existingByEmail.id }).where(and(eq(documentsTable.leadId, lead.id), isNull(documentsTable.studentId)));

      if (submission?.programId) {
        await createApplicationFromSubmission(existingByEmail.id, submission);
      }

      await db.update(leadsTable).set({ status: "converted", convertedStudentId: existingByEmail.id }).where(eq(leadsTable.id, id));
      await logAudit(req.user!.id, "convert_lead", "lead", id, { studentId: existingByEmail.id, merged: true }, req.ip);

      const [updatedStudent] = await db.select().from(studentsTable).where(eq(studentsTable.id, existingByEmail.id));
      res.json({ student: updatedStudent || existingByEmail, merged: true });
      return;
    }
  }

  const photoDocs = await db.select().from(documentsTable).where(and(eq(documentsTable.leadId, lead.id), eq(documentsTable.type, "photo")));
  if (photoDocs.length > 0 && photoDocs[0].fileData) {
    const photoDoc = photoDocs[0];
    const mimeType = photoDoc.mimeType || "image/jpeg";
    studentValues.photoUrl = `data:${mimeType};base64,${photoDoc.fileData}`;
  }

  const [student] = await db.insert(studentsTable).values(studentValues).returning();

  await db.update(documentsTable).set({ studentId: student.id }).where(and(eq(documentsTable.leadId, lead.id), isNull(documentsTable.studentId)));

  if (submission?.programId) {
    await createApplicationFromSubmission(student.id, submission);
  }

  await db.update(leadsTable).set({ status: "converted", convertedStudentId: student.id }).where(eq(leadsTable.id, id));
  await logAudit(req.user!.id, "convert_lead", "lead", id, { studentId: student.id }, req.ip);
  res.json({ student, merged: false });
});

async function createApplicationFromSubmission(studentId: number, submission: any) {
  try {
    const programId = submission.programId;
    const [program] = await db.select().from(programsTable).where(eq(programsTable.id, programId));
    if (!program) return;

    const [university] = await db.select().from(universitiesTable).where(eq(universitiesTable.id, program.universityId));

    const [existingApp] = await db.select().from(applicationsTable)
      .where(and(eq(applicationsTable.studentId, studentId), eq(applicationsTable.programId, programId)));
    if (existingApp) return;

    await db.insert(applicationsTable).values({
      studentId,
      programId: program.id,
      universityId: program.universityId,
      programName: program.name,
      universityName: university?.name || submission.universityName || null,
      country: university?.country || null,
      level: program.degree || null,
      instructionLanguage: program.language || null,
      tuitionFee: program.tuitionFee || null,
      discountedFee: program.discountedFee || null,
      scholarship: program.scholarship || null,
      stage: "inquiry",
      season: "2026",
    });
  } catch (err) {
    console.error("Failed to create application from submission:", err);
  }
}

router.get("/leads/:id/notes", requireAuth, requireRole(...STAFF_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
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
    .where(and(eq(notesTable.resourceId, id), eq(notesTable.resourceType, "lead")))
    .orderBy(notesTable.createdAt);
  res.json(notes);
});

router.post("/leads/:id/notes", requireAuth, requireRole(...STAFF_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { content } = req.body;
  if (!content?.trim()) { res.status(400).json({ error: "content is required" }); return; }
  const [note] = await db.insert(notesTable).values({
    content: String(content).slice(0, 5000),
    authorId: req.user!.id,
    resourceType: "lead",
    resourceId: id,
  }).returning();
  res.status(201).json({ ...note, authorName: `${req.user!.firstName || ""} ${req.user!.lastName || ""}`.trim() });
});

router.get("/leads/:id/follow-ups", requireAuth, requireRole(...STAFF_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const data = await db
    .select({
      id: followUpsTable.id,
      leadId: followUpsTable.leadId,
      title: followUpsTable.title,
      scheduledAt: followUpsTable.scheduledAt,
      completed: followUpsTable.completed,
      completedAt: followUpsTable.completedAt,
      notes: followUpsTable.notes,
      createdById: followUpsTable.createdById,
      createdByName: sql<string | null>`concat(${usersTable.firstName}, ' ', ${usersTable.lastName})`,
      createdAt: followUpsTable.createdAt,
    })
    .from(followUpsTable)
    .leftJoin(usersTable, eq(followUpsTable.createdById, usersTable.id))
    .where(eq(followUpsTable.leadId, id))
    .orderBy(asc(followUpsTable.scheduledAt));
  res.json(data);
});

router.post("/leads/:id/follow-ups", requireAuth, requireRole(...STAFF_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { title, scheduledAt, notes } = req.body;
  if (!title?.trim() || !scheduledAt) {
    res.status(400).json({ error: "title and scheduledAt are required" });
    return;
  }
  const [followUp] = await db.insert(followUpsTable).values({
    leadId: id,
    resourceType: "lead",
    title: String(title).slice(0, 500),
    scheduledAt: new Date(scheduledAt),
    notes: notes ? String(notes).slice(0, 2000) : null,
    createdById: req.user!.id,
    assignedToId: req.user!.id,
  }).returning();
  res.status(201).json(followUp);
});

router.patch("/follow-ups/:id", requireAuth, requireRole(...STAFF_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { completed, title, scheduledAt, notes } = req.body;
  const updates: Record<string, unknown> = {};
  if (completed !== undefined) {
    updates.completed = completed;
    updates.completedAt = completed ? new Date() : null;
  }
  if (title !== undefined) updates.title = title;
  if (scheduledAt !== undefined) updates.scheduledAt = new Date(scheduledAt);
  if (notes !== undefined) updates.notes = notes;
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No valid fields" });
    return;
  }
  const [followUp] = await db.update(followUpsTable).set(updates).where(eq(followUpsTable.id, id)).returning();
  if (!followUp) { res.status(404).json({ error: "Follow-up not found" }); return; }
  res.json(followUp);
});

router.get("/follow-ups/upcoming", requireAuth, requireRole(...STAFF_ROLES), async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const userRole = req.user!.role;
  const isAdmin = ADMIN_ROLES.includes(userRole);
  const now = new Date();
  const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const baseConditions = [
    eq(followUpsTable.completed, false),
    lte(followUpsTable.scheduledAt, nextWeek),
  ];

  if (!isAdmin) {
    const leadAssignedOrUnassigned = or(
      sql`(SELECT assigned_to_id FROM leads WHERE leads.id = ${followUpsTable.leadId}) = ${userId}`,
      sql`(SELECT assigned_to_id FROM leads WHERE leads.id = ${followUpsTable.leadId}) IS NULL`
    );

    const studentAssignedOrUnassigned = or(
      sql`(SELECT assigned_to_id FROM students WHERE students.id = ${followUpsTable.studentId}) = ${userId}`,
      sql`(SELECT assigned_to_id FROM students WHERE students.id = ${followUpsTable.studentId}) IS NULL`
    );

    baseConditions.push(
      or(
        and(sql`${followUpsTable.leadId} IS NOT NULL`, leadAssignedOrUnassigned),
        and(sql`${followUpsTable.studentId} IS NOT NULL`, studentAssignedOrUnassigned),
        eq(followUpsTable.assignedToId, userId),
        and(isNull(followUpsTable.leadId), isNull(followUpsTable.studentId), isNull(followUpsTable.assignedToId))
      )!
    );
  }

  const data = await db
    .select({
      id: followUpsTable.id,
      leadId: followUpsTable.leadId,
      studentId: followUpsTable.studentId,
      title: followUpsTable.title,
      scheduledAt: followUpsTable.scheduledAt,
      completed: followUpsTable.completed,
      notes: followUpsTable.notes,
      leadName: sql<string | null>`COALESCE(
        (SELECT concat(first_name, ' ', last_name) FROM leads WHERE leads.id = ${followUpsTable.leadId}),
        (SELECT concat(first_name, ' ', last_name) FROM students WHERE students.id = ${followUpsTable.studentId})
      )`,
    })
    .from(followUpsTable)
    .where(and(...baseConditions))
    .orderBy(asc(followUpsTable.scheduledAt))
    .limit(20);
  res.json(data);
});

export default router;
