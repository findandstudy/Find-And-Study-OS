import { Router, type IRouter } from "express";
import { db, leadsTable, studentsTable, notesTable, usersTable, followUpsTable, agentsTable, documentsTable, embedSubmissionsTable, applicationsTable, programsTable, universitiesTable, pipelineStagesTable } from "@workspace/db";
import { eq, ilike, or, sql, and, lte, gte, asc, desc, inArray, isNull } from "drizzle-orm";
import { requireAuth, requireRole, requireAgentStaffPermission, logAudit } from "../lib/auth";
import { publicLeadLimiter } from "../lib/limiters";
import { STAFF_ROLES, ADMIN_ROLES, AGENT_ROLES, isAgentRole } from "../lib/roles";
import { getAgentVisibleIds, getAgentRecord } from "../lib/agentVisibility";
import { normalizeAndValidateNames } from "../lib/textNormalize";
import { dispatchNotification } from "../lib/notificationDispatcher";
import { inferOriginFromUser, inferOriginFromAgentId, directOrigin } from "../lib/originHelper";

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
  if (!firstName || !lastName || !email || !phone) {
    res.status(400).json({ error: "firstName, lastName, email, and phone are required" });
    return;
  }
  const { error: nameErr } = normalizeAndValidateNames({ firstName, lastName }, ["firstName", "lastName"]);
  if (nameErr) { res.status(400).json({ error: nameErr }); return; }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    res.status(400).json({ error: "Invalid email address" });
    return;
  }
  const origin = directOrigin();
  const [lead] = await db.insert(leadsTable).values({
    firstName: String(firstName).trim().toUpperCase().slice(0, 100),
    lastName: String(lastName).trim().toUpperCase().slice(0, 100),
    email: String(email).slice(0, 255),
    phone: phone ? String(phone).slice(0, 30) : null,
    nationality: nationality ? String(nationality).slice(0, 100) : null,
    interestedProgram: interestedProgram ? String(interestedProgram).slice(0, 255) : null,
    interestedCountry: interestedCountry ? String(interestedCountry).slice(0, 100) : null,
    notes: message ? String(message).replace(/<[^>]*>/g, "").slice(0, 400) : null,
    source: "website",
    status: "new",
    ...origin,
  }).returning();
  res.status(201).json({ success: true, message: "Inquiry submitted successfully", leadId: lead.id });
});

router.post("/public/lead/:token", publicLeadLimiter, async (req, res): Promise<void> => {
  const { token } = req.params;
  const [agent] = await db.select({ id: agentsTable.id, status: agentsTable.status })
    .from(agentsTable).where(eq(agentsTable.embedToken, token));
  if (!agent || agent.status !== "active") {
    res.status(404).json({ error: "Invalid or inactive form" });
    return;
  }

  const { firstName, lastName, email, phone } = req.body;
  if (!firstName || !lastName || !email || !phone) {
    res.status(400).json({ error: "firstName, lastName, email, and phone are required" });
    return;
  }
  const { error: nameErr } = normalizeAndValidateNames({ firstName, lastName }, ["firstName", "lastName"]);
  if (nameErr) { res.status(400).json({ error: nameErr }); return; }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    res.status(400).json({ error: "Invalid email address" });
    return;
  }

  const origin = await inferOriginFromAgentId(agent.id);
  await db.insert(leadsTable).values({
    firstName: String(firstName).trim().toUpperCase().slice(0, 100),
    lastName: String(lastName).trim().toUpperCase().slice(0, 100),
    email: String(email).slice(0, 255),
    phone: String(phone).slice(0, 30),
    source: "web_form",
    status: "new",
    agentId: agent.id,
    ...origin,
  });

  const accept = req.headers.accept || "";
  if (accept.includes("application/json")) {
    res.status(201).json({ success: true, message: "Thank you! Your information has been submitted." });
  } else {
    res.status(200).send(`<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f9fafb}div{text-align:center;padding:40px;border-radius:12px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,0.1);max-width:400px}h2{color:#059669;margin:0 0 8px}p{color:#6b7280;margin:0}</style></head><body><div><h2>&#10003; Success!</h2><p>Thank you! Your information has been submitted successfully.</p></div></body></html>`);
  }
});

router.get("/leads", requireAuth, requireRole(...STAFF_ROLES, ...AGENT_ROLES), requireAgentStaffPermission("leads"), async (req, res): Promise<void> => {
  const user = req.user!;
  const { status, search, season, page = "1", limit = "20", agentId: agentIdFilter, originType: originFilter } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(500, Math.max(1, parseInt(limit, 10)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];
  if (season) conditions.push(eq(leadsTable.season, season));
  if (status) conditions.push(eq(leadsTable.status, status));
  if (agentIdFilter) conditions.push(eq(leadsTable.agentId, parseInt(agentIdFilter, 10)));
  if (originFilter && ["direct", "agent", "sub_agent"].includes(originFilter)) {
    conditions.push(eq(leadsTable.originType, originFilter));
  }

  if (isAgentRole(user.role)) {
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
  const rows = await db
    .select({ lead: leadsTable, agentName: agentsTable.companyName })
    .from(leadsTable)
    .leftJoin(agentsTable, eq(leadsTable.agentId, agentsTable.id))
    .where(whereClause)
    .limit(limitNum)
    .offset(offset)
    .orderBy(desc(leadsTable.createdAt));

  const leadIds = rows.map(r => r.lead.id);
  let nextFollowupMap = new Map<number, string>();
  if (leadIds.length > 0) {
    const fuRows = await db
      .select({
        leadId: followUpsTable.leadId,
        nextDate: sql<string>`min(${followUpsTable.scheduledAt})`,
      })
      .from(followUpsTable)
      .where(and(
        sql`${followUpsTable.leadId} IN (${sql.join(leadIds.map(id => sql`${id}`), sql`, `)})`,
        eq(followUpsTable.completed, false),
      ))
      .groupBy(followUpsTable.leadId);
    fuRows.forEach(r => { if (r.leadId) nextFollowupMap.set(r.leadId, r.nextDate); });
  }

  const data = rows.map(r => ({
    ...r.lead,
    agentName: r.agentName || null,
    nextFollowup: nextFollowupMap.get(r.lead.id) || null,
  }));

  res.json({ data, meta: { total: Number(count), page: pageNum, limit: limitNum, totalPages: Math.ceil(Number(count) / limitNum) } });
});

router.post("/leads", requireAuth, requireRole(...STAFF_ROLES, ...AGENT_ROLES), requireAgentStaffPermission("leads"), async (req, res): Promise<void> => {
  const user = req.user!;
  const { firstName, lastName, status = "new", email, phone, nationality, interestedProgram, interestedCountry, source, notes, assignedTo, season, agentId } = req.body;
  if (!firstName || !lastName || !email || !phone) {
    res.status(400).json({ error: "firstName, lastName, email, and phone are required" });
    return;
  }
  const { error: nameErr, normalized: normBody } = normalizeAndValidateNames(
    { firstName, lastName }, ["firstName", "lastName"]
  );
  if (nameErr) { res.status(400).json({ error: nameErr }); return; }
  const currentYear = String(new Date().getFullYear());
  let resolvedAgentId = agentId || null;
  if (isAgentRole(user.role)) {
    const agentRec = await getAgentRecord(user.id, user.role);
    resolvedAgentId = agentRec?.id || null;
  }
  const origin = resolvedAgentId
    ? await inferOriginFromAgentId(resolvedAgentId)
    : await inferOriginFromUser(user.role, user.id, (user as any).managingAgentId);
  const [lead] = await db.insert(leadsTable).values({
    firstName: normBody.firstName as string, lastName: normBody.lastName as string, status, email,
    phone, nationality: nationality || null,
    interestedProgram: interestedProgram || null,
    interestedCountry: interestedCountry || null,
    source: source || null, notes: notes || null,
    assignedToId: assignedTo || null,
    agentId: resolvedAgentId,
    season: season || currentYear,
    ...origin,
  }).returning();
  await logAudit(user.id, "create_lead", "lead", lead.id, {}, req.ip);

  dispatchNotification({
    event: "lead.created",
    title: "New Lead Created",
    body: `${lead.firstName} ${lead.lastName} has been added as a new lead.`,
    actionUrl: `/staff/leads/${lead.id}`,
    icon: "UserPlus",
    templateVars: { firstName: lead.firstName, lastName: lead.lastName, email: lead.email || "", phone: lead.phone || "" },
  }).catch(() => {});

  res.status(201).json(lead);
});

router.get("/leads/:id", requireAuth, requireRole(...STAFF_ROLES, ...AGENT_ROLES), requireAgentStaffPermission("leads"), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, id));
  if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }
  const user = req.user!;
  if (isAgentRole(user.role)) {
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

router.patch("/leads/:id", requireAuth, requireRole(...STAFF_ROLES, ...AGENT_ROLES), requireAgentStaffPermission("leads"), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const user = req.user!;
  const isAgent = isAgentRole(user.role);

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
      } else if (Number(req.body.assignedTo) !== user.id) {
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
  if (isAdmin && req.body.originType !== undefined) {
    const validOrigin = ["direct", "agent", "sub_agent"];
    if (validOrigin.includes(req.body.originType)) {
      updates["originType"] = req.body.originType;
      updates["originEntityType"] = req.body.originEntityType ?? null;
      updates["originEntityId"] = req.body.originEntityId ?? null;
      updates["originDisplayName"] = req.body.originDisplayName ?? null;
      updates["originLocked"] = true;
    }
  }
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No valid fields to update" });
    return;
  }
  const { error: nameErr, normalized: normUpdates } = normalizeAndValidateNames(updates, ["firstName", "lastName"]);
  if (nameErr) { res.status(400).json({ error: nameErr }); return; }
  const [lead] = await db.update(leadsTable).set(normUpdates).where(eq(leadsTable.id, id)).returning();
  if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }
  await logAudit(user.id, "update_lead", "lead", id, updates, req.ip);

  if (updates.status && updates.status !== existing.status) {
    dispatchNotification({
      event: "lead.stage_changed",
      title: "Lead Stage Changed",
      body: `Lead ${lead.firstName} ${lead.lastName} moved from "${existing.status}" to "${updates.status}".`,
      actionUrl: `/staff/leads/${lead.id}`,
      icon: "ArrowRight",
      recipientUserIds: lead.assignedToId ? [lead.assignedToId] : undefined,
      templateVars: { firstName: lead.firstName, lastName: lead.lastName, oldStage: existing.status || "", newStage: String(updates.status) },
    }).catch(() => {});
  }

  if (updates.assignedToId && updates.assignedToId !== existing.assignedToId) {
    dispatchNotification({
      event: "lead.assigned",
      title: "Lead Assigned to You",
      body: `Lead ${lead.firstName} ${lead.lastName} has been assigned to you.`,
      actionUrl: `/staff/leads/${lead.id}`,
      icon: "UserCheck",
      recipientUserIds: [updates.assignedToId as number],
      templateVars: { firstName: lead.firstName, lastName: lead.lastName },
    }).catch(() => {});
  }

  if (updates.agentId !== undefined && updates.agentId !== existing.agentId) {
    if (updates.agentId) {
      dispatchNotification({
        event: "lead.agent_linked",
        title: "Lead Linked to Agent",
        body: `Lead ${lead.firstName} ${lead.lastName} has been linked to an agent.`,
        actionUrl: `/staff/leads/${lead.id}`,
        icon: "Building2",
        recipientUserIds: lead.assignedToId ? [lead.assignedToId] : undefined,
        templateVars: { firstName: lead.firstName, lastName: lead.lastName },
      }).catch(() => {});
    } else {
      dispatchNotification({
        event: "lead.agent_unlinked",
        title: "Lead Unlinked from Agent",
        body: `Lead ${lead.firstName} ${lead.lastName} has been unlinked from their agent.`,
        actionUrl: `/staff/leads/${lead.id}`,
        icon: "Unlink",
        recipientUserIds: lead.assignedToId ? [lead.assignedToId] : undefined,
        templateVars: { firstName: lead.firstName, lastName: lead.lastName },
      }).catch(() => {});
    }
  }

  res.json(lead);
});

router.delete("/leads/:id", requireAuth, requireRole(...STAFF_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(leadsTable).where(eq(leadsTable.id, id));
  await logAudit(req.user!.id, "delete_lead", "lead", id, {}, req.ip);
  res.sendStatus(204);
});

router.post("/leads/bulk-action", requireAuth, requireRole(...ADMIN_ROLES), async (req, res): Promise<void> => {
  const { ids, action, assignedToId, status } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: "ids required" }); return; }
  if (!["delete", "assign", "move"].includes(action)) { res.status(400).json({ error: "Invalid action" }); return; }
  const numericIds = ids.map(Number).filter((n: number) => !isNaN(n));
  let updated = 0;
  if (action === "delete") {
    const result = await db.delete(leadsTable).where(inArray(leadsTable.id, numericIds));
    updated = result.rowCount ?? numericIds.length;
    for (const id of numericIds) await logAudit(req.user!.id, "delete_lead", "lead", id, {}, req.ip);
  } else if (action === "assign" && assignedToId !== undefined) {
    const result = await db.update(leadsTable).set({ assignedToId: assignedToId ? Number(assignedToId) : null }).where(inArray(leadsTable.id, numericIds));
    updated = result.rowCount ?? numericIds.length;
    await logAudit(req.user!.id, "bulk_assign_leads", "lead", null, { ids: numericIds, assignedToId }, req.ip);
  } else if (action === "move" && status) {
    const result = await db.update(leadsTable).set({ status }).where(inArray(leadsTable.id, numericIds));
    updated = result.rowCount ?? numericIds.length;
    await logAudit(req.user!.id, "bulk_move_leads", "lead", null, { ids: numericIds, status }, req.ip);
  } else {
    res.status(400).json({ error: "Missing required fields for action" }); return;
  }
  res.json({ success: true, updated });
});

router.post("/leads/:id/convert", requireAuth, requireRole(...STAFF_ROLES, ...AGENT_ROLES), async (req, res): Promise<void> => {
  const user = req.user!;
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, id));
  if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }

  if (isAgentRole(user.role)) {
    const visibleIds = await getAgentVisibleIds(user.id, user.role);
    if (!lead.agentId || !visibleIds.includes(lead.agentId)) {
      res.status(403).json({ error: "You do not have access to this lead" });
      return;
    }
  }
  if (lead.convertedStudentId) {
    const [existing] = await db.select().from(studentsTable).where(eq(studentsTable.id, lead.convertedStudentId));
    if (existing) {
      const wonStages = await db.select().from(pipelineStagesTable)
        .where(and(eq(pipelineStagesTable.entityType, "lead"), eq(pipelineStagesTable.variant, "won")));
      const convertedKey = wonStages.length > 0 ? wonStages[0].key : "converted";
      if (lead.status !== convertedKey) {
        await db.update(leadsTable).set({ status: convertedKey }).where(eq(leadsTable.id, id));
      }
      res.json({ student: existing, merged: false, alreadyConverted: true });
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
    assignedToId: lead.assignedToId || null,
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
    originType: lead.originType || "direct",
    originEntityType: lead.originEntityType || null,
    originEntityId: lead.originEntityId || null,
    originDisplayName: lead.originDisplayName || "Find And Study",
    originLocked: true,
    originLeadId: lead.id,
  };

  if (lead.email) {
    const [existingByEmail] = await db.select().from(studentsTable).where(eq(studentsTable.email, lead.email));
    if (existingByEmail) {
      const mergeUpdates: any = {};
      if (!existingByEmail.assignedToId && lead.assignedToId) mergeUpdates.assignedToId = lead.assignedToId;
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

    const [studentRec] = await db.select({
      assignedToId: studentsTable.assignedToId, agentId: studentsTable.agentId,
      originType: studentsTable.originType, originEntityType: studentsTable.originEntityType,
      originEntityId: studentsTable.originEntityId, originDisplayName: studentsTable.originDisplayName,
    }).from(studentsTable).where(eq(studentsTable.id, studentId));

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
      assignedToId: studentRec?.assignedToId || null,
      agentId: studentRec?.agentId || null,
      originType: studentRec?.originType || "direct",
      originEntityType: studentRec?.originEntityType || null,
      originEntityId: studentRec?.originEntityId || null,
      originDisplayName: studentRec?.originDisplayName || "Find And Study",
      originStudentId: studentId,
    });
  } catch (err) {
    console.error("Failed to create application from submission:", err);
  }
}

router.get("/leads/:id/notes", requireAuth, requireRole(...STAFF_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { page = "1", limit = "50" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10)));
  const offset = (pageNum - 1) * limitNum;

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
    .orderBy(desc(notesTable.createdAt))
    .limit(limitNum)
    .offset(offset);
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
  const { page = "1", limit = "50" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10)));
  const offset = (pageNum - 1) * limitNum;

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
    .orderBy(asc(followUpsTable.scheduledAt))
    .limit(limitNum)
    .offset(offset);
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
