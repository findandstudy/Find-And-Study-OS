import { Router, type IRouter } from "express";
import { db, leadsTable, studentsTable, notesTable, usersTable } from "@workspace/db";
import { eq, ilike, or, sql, and } from "drizzle-orm";
import { requireAuth, requireRole, logAudit } from "../lib/auth";
import { publicLeadLimiter } from "../lib/limiters";
import { STAFF_ROLES } from "../lib/roles";

const router: IRouter = Router();

const LEAD_PATCH_FIELDS = [
  "firstName", "lastName", "email", "phone", "nationality",
  "interestedProgram", "interestedCountry", "source",
  "status", "assignedTo", "notes",
];

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

router.get("/leads", requireAuth, requireRole(...STAFF_ROLES), async (req, res): Promise<void> => {
  const { status, search, page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];
  if (status) conditions.push(eq(leadsTable.status, status));
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
  const data = await db.select().from(leadsTable).where(whereClause).limit(limitNum).offset(offset).orderBy(leadsTable.createdAt);

  res.json({ data, meta: { total: Number(count), page: pageNum, limit: limitNum, totalPages: Math.ceil(Number(count) / limitNum) } });
});

router.post("/leads", requireAuth, requireRole(...STAFF_ROLES), async (req, res): Promise<void> => {
  const { firstName, lastName, status = "new", email, phone, nationality, interestedProgram, interestedCountry, source, notes, assignedTo } = req.body;
  if (!firstName || !lastName) {
    res.status(400).json({ error: "firstName and lastName are required" });
    return;
  }
  const [lead] = await db.insert(leadsTable).values({
    firstName, lastName, status, email: email || null,
    phone: phone || null, nationality: nationality || null,
    interestedProgram: interestedProgram || null,
    interestedCountry: interestedCountry || null,
    source: source || null, notes: notes || null,
    assignedTo: assignedTo || null,
  }).returning();
  await logAudit(req.user!.id, "create_lead", "lead", lead.id, {}, req.ip);
  res.status(201).json(lead);
});

router.get("/leads/:id", requireAuth, requireRole(...STAFF_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, id));
  if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }
  res.json(lead);
});

router.patch("/leads/:id", requireAuth, requireRole(...STAFF_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const updates: Record<string, unknown> = {};
  for (const key of LEAD_PATCH_FIELDS) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No valid fields to update" });
    return;
  }
  const [lead] = await db.update(leadsTable).set(updates).where(eq(leadsTable.id, id)).returning();
  if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }
  await logAudit(req.user!.id, "update_lead", "lead", id, updates, req.ip);
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

  if (lead.email) {
    const [existingByEmail] = await db.select().from(studentsTable).where(eq(studentsTable.email, lead.email));
    if (existingByEmail) {
      await db.update(leadsTable).set({ status: "converted", convertedStudentId: existingByEmail.id }).where(eq(leadsTable.id, id));
      await logAudit(req.user!.id, "convert_lead", "lead", id, { studentId: existingByEmail.id, merged: true }, req.ip);
      res.json({ student: existingByEmail, merged: true });
      return;
    }
  }

  const [student] = await db.insert(studentsTable).values({
    firstName: lead.firstName,
    lastName: lead.lastName,
    email: lead.email || null,
    phone: lead.phone || null,
    nationality: lead.nationality || null,
    status: "active",
  }).returning();

  await db.update(leadsTable).set({ status: "converted", convertedStudentId: student.id }).where(eq(leadsTable.id, id));
  await logAudit(req.user!.id, "convert_lead", "lead", id, { studentId: student.id }, req.ip);
  res.json({ student, merged: false });
});

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

export default router;
