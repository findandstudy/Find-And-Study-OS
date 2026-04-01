import { Router, type IRouter } from "express";
import { db, studentsTable, documentsTable, usersTable, agentsTable, applicationsTable, applicationStageDocumentsTable } from "@workspace/db";
import { eq, ilike, or, sql, and, desc, inArray, isNotNull } from "drizzle-orm";
import { requireAuth, requireRole, requireAgentStaffPermission, logAudit } from "../lib/auth";
import { STAFF_ROLES, ADMIN_ROLES, AGENT_ROLES, isAgentRole } from "../lib/roles";
import { getAgentVisibleIds, getAgentRecord } from "../lib/agentVisibility";
import { isNull } from "drizzle-orm";
import { normalizeAndValidateNames } from "../lib/textNormalize";
import { dispatchNotification } from "../lib/notificationDispatcher";
import { inferOriginFromUser, inferOriginFromAgentId, type OriginMeta } from "../lib/originHelper";
import bcrypt from "bcryptjs";

const router: IRouter = Router();

const STUDENT_PATCH_FIELDS = [
  "firstName", "lastName", "email", "phone", "nationality",
  "dateOfBirth", "passportNumber", "passportIssueDate", "passportExpiry",
  "motherName", "fatherName", "address",
  "status", "agentId", "assignedToId", "userId", "notes",
  "highSchool", "graduationYear", "gpa", "languageScore",
  "universityBachelor", "universityMaster",
  "photoUrl", "nextFollowup",
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

router.get("/students", requireAuth, requireRole(...STAFF_ROLES, "student", ...AGENT_ROLES), requireAgentStaffPermission("students"), async (req, res): Promise<void> => {
  const user = req.user!;
  const { agentId, status, search, season, page = "1", limit = "20", originType: originFilter } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(500, Math.max(1, parseInt(limit, 10)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [isNull(studentsTable.deletedAt)];

  if (season) conditions.push(eq(studentsTable.season, season));
  if (status) conditions.push(eq(studentsTable.status, status));
  if (agentId && STAFF_ROLES.includes(user.role as any)) {
    conditions.push(eq(studentsTable.agentId, parseInt(agentId, 10)));
  }
  if (originFilter && ["direct", "agent", "sub_agent"].includes(originFilter)) {
    conditions.push(eq(studentsTable.originType, originFilter));
  }
  if (isAgentRole(user.role)) {
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
    .select({
      student: studentsTable,
      agentName: agentsTable.companyName,
    })
    .from(studentsTable)
    .leftJoin(agentsTable, eq(studentsTable.agentId, agentsTable.id))
    .where(whereClause)
    .limit(limitNum)
    .offset(offset)
    .orderBy(desc(studentsTable.createdAt));

  const flatRows = rows.map(r => ({ ...r.student, agentName: r.agentName || null }));
  const studentIds = flatRows.map(r => r.id);
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

  const data = flatRows.map(r => ({ ...r, hasPhoto: photoSet.has(r.id) }));

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

router.post("/students", requireAuth, requireRole(...STAFF_ROLES, ...AGENT_ROLES), requireAgentStaffPermission("students"), async (req, res): Promise<void> => {
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
  const nameFields = ["firstName", "lastName"];
  if (motherName) nameFields.push("motherName");
  if (fatherName) nameFields.push("fatherName");
  const { error: nameErr, normalized: normBody } = normalizeAndValidateNames(
    { firstName, lastName, motherName, fatherName }, nameFields
  );
  if (nameErr) { res.status(400).json({ error: nameErr }); return; }

  let resolvedAgentId = agentId || null;
  if (isAgentRole(req.user!.role)) {
    const agentRec = await getAgentRecord(req.user!.id, req.user!.role);
    if (!agentRec) {
      res.status(403).json({ error: "No agent record found" });
      return;
    }
    resolvedAgentId = agentRec.id;
  }

  if (email) {
    const normalizedEmail = email.toLowerCase().trim();
    const [existingUser] = await db.select().from(usersTable).where(eq(usersTable.email, normalizedEmail));
    if (existingUser && existingUser.role !== "student") {
      res.status(409).json({ error: "This email is already in use by a staff/admin account. Same email cannot be used across different roles." });
      return;
    }
    const [existingStudent] = await db.select().from(studentsTable).where(and(eq(studentsTable.email, normalizedEmail), isNull(studentsTable.deletedAt)));
    if (existingStudent) {
      res.status(409).json({ error: "A student with this email already exists" });
      return;
    }
  }

  const user = req.user!;
  const origin = resolvedAgentId
    ? await inferOriginFromAgentId(resolvedAgentId)
    : await inferOriginFromUser(user);
  const [student] = await db.insert(studentsTable).values({
    firstName: normBody.firstName as string, lastName: normBody.lastName as string, status,
    email: email || null,
    phone: phone || null,
    nationality: nationality || null,
    dateOfBirth: dateOfBirth || null,
    passportNumber: passportNumber || null,
    passportIssueDate: passportIssueDate || null,
    passportExpiry: passportExpiry || null,
    motherName: normBody.motherName ? (normBody.motherName as string) : null,
    fatherName: normBody.fatherName ? (normBody.fatherName as string) : null,
    address: address || null,
    agentId: resolvedAgentId,
    userId: userId || null,
    notes: notes || null,
    highSchool: highSchool || null,
    graduationYear: graduationYear ? parseInt(String(graduationYear), 10) : null,
    gpa: gpa || null,
    languageScore: languageScore || null,
    season: season || String(new Date().getFullYear()),
    ...origin,
  }).returning();

  await logAudit(req.user!.id, "create_student", "student", student.id, { firstName, lastName }, req.ip);

  dispatchNotification({
    event: "student.created",
    title: "New Student Registered",
    body: `${student.firstName} ${student.lastName} has been registered as a new student.`,
    actionUrl: `/staff/students/${student.id}`,
    icon: "GraduationCap",
    templateVars: { firstName: student.firstName, lastName: student.lastName, email: student.email || "", nationality: student.nationality || "" },
  }).catch(() => {});

  res.status(201).json(student);
});

router.post("/students/bulk", requireAuth, requireRole(...STAFF_ROLES, "agent" as any), async (req, res): Promise<void> => {
  const { students } = req.body as { students: any[] };
  if (!Array.isArray(students) || students.length === 0) {
    res.status(400).json({ error: "students array is required" });
    return;
  }

  const bulkUser = req.user!;
  const bulkOrigin = await inferOriginFromUser(bulkUser.role, bulkUser.id, (bulkUser as any).managingAgentId);
  const inserted: any[] = [];
  const errors: any[] = [];

  for (let i = 0; i < students.length; i++) {
    const s = students[i];
    if (!s.firstName || !s.lastName) {
      errors.push({ index: i, error: "firstName and lastName are required", row: s });
      continue;
    }
    const bulkNameFields = ["firstName", "lastName"];
    if (s.motherName) bulkNameFields.push("motherName");
    if (s.fatherName) bulkNameFields.push("fatherName");
    const { error: bNameErr, normalized: ns } = normalizeAndValidateNames(s, bulkNameFields);
    if (bNameErr) {
      errors.push({ index: i, error: bNameErr, row: s });
      continue;
    }
    try {
      const [student] = await db.insert(studentsTable).values({
        firstName: ns.firstName as string,
        lastName: ns.lastName as string,
        status: s.status || "active",
        email: s.email || null,
        phone: s.phone || null,
        nationality: s.nationality || null,
        dateOfBirth: s.dateOfBirth || null,
        passportNumber: s.passportNumber || null,
        passportIssueDate: s.passportIssueDate || null,
        passportExpiry: s.passportExpiry || null,
        motherName: ns.motherName ? (ns.motherName as string) : null,
        fatherName: ns.fatherName ? (ns.fatherName as string) : null,
        address: s.address || null,
        notes: s.notes || null,
        highSchool: s.highSchool || null,
        graduationYear: s.graduationYear ? parseInt(String(s.graduationYear), 10) : null,
        gpa: s.gpa || null,
        languageScore: s.languageScore || null,
        ...bulkOrigin,
      }).returning();
      inserted.push(student);
    } catch (err: any) {
      errors.push({ index: i, error: err.message, row: s });
    }
  }

  await logAudit(req.user!.id, "bulk_create_students", "student", null, { count: inserted.length }, req.ip);
  res.status(201).json({ inserted, errors, total: students.length, success: inserted.length });
});

router.get("/students/:id", requireAuth, requireAgentStaffPermission("students"), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const user = req.user!;

  const [student] = await db.select().from(studentsTable).where(and(eq(studentsTable.id, id), isNull(studentsTable.deletedAt)));
  if (!student) { res.status(404).json({ error: "Student not found" }); return; }

  const isStaff = STAFF_ROLES.includes(user.role as any);
  const isAdmin = (ADMIN_ROLES as readonly string[]).includes(user.role);
  const isOwnProfile = student.userId === user.id;
  const isAgent = isAgentRole(user.role);

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

router.patch("/students/:id", requireAuth, requireAgentStaffPermission("students"), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const role = req.user!.role;
  const isStaff = (STAFF_ROLES as readonly string[]).includes(role);
  const isAgent = isAgentRole(role);
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
    ? STUDENT_PATCH_FIELDS.filter(f => f !== "agentId" && f !== "userId" && f !== "assignedToId" && f !== "status")
    : STUDENT_PATCH_FIELDS;
  if (!isAdmin && !isAgent) {
    if (req.body.assignedToId !== undefined) {
      if (existing.assignedToId !== null) {
        allowedFields = allowedFields.filter(f => f !== "assignedToId");
      } else if (Number(req.body.assignedToId) !== req.user!.id) {
        allowedFields = allowedFields.filter(f => f !== "assignedToId");
      }
    }
  }
  const updates: Record<string, unknown> = {};
  for (const key of allowedFields) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
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
  const { error: nameErr, normalized: normUpdates } = normalizeAndValidateNames(
    updates, ["firstName", "lastName", "motherName", "fatherName"]
  );
  if (nameErr) { res.status(400).json({ error: nameErr }); return; }
  const [student] = await db.update(studentsTable).set(normUpdates).where(eq(studentsTable.id, id)).returning();
  if (!student) { res.status(404).json({ error: "Student not found" }); return; }
  await logAudit(req.user!.id, "update_student", "student", id, updates, req.ip);

  if (updates.status && updates.status !== existing.status) {
    const recipientIds: number[] = [];
    if (student.assignedToId) recipientIds.push(student.assignedToId);
    if (student.userId) recipientIds.push(student.userId);
    dispatchNotification({
      event: "student.status_changed",
      title: "Student Status Changed",
      body: `Student ${student.firstName} ${student.lastName} status changed from "${existing.status}" to "${updates.status}".`,
      actionUrl: `/staff/students/${student.id}`,
      icon: "UserCheck",
      recipientUserIds: recipientIds.length > 0 ? recipientIds : undefined,
      templateVars: { firstName: student.firstName, lastName: student.lastName, oldStatus: existing.status || "", newStatus: String(updates.status) },
    }).catch(() => {});
  }

  if (updates.assignedToId && updates.assignedToId !== existing.assignedToId) {
    dispatchNotification({
      event: "student.assigned",
      title: "Student Assigned to You",
      body: `Student ${student.firstName} ${student.lastName} has been assigned to you.`,
      actionUrl: `/staff/students/${student.id}`,
      icon: "UserCheck",
      recipientUserIds: [updates.assignedToId as number],
      templateVars: { firstName: student.firstName, lastName: student.lastName },
    }).catch(() => {});
  }

  if (updates.agentId !== undefined && updates.agentId !== existing.agentId) {
    if (updates.agentId) {
      dispatchNotification({
        event: "student.agent_linked",
        title: "Student Linked to Agent",
        body: `Student ${student.firstName} ${student.lastName} has been linked to an agent.`,
        actionUrl: `/staff/students/${student.id}`,
        icon: "Building2",
        recipientUserIds: student.assignedToId ? [student.assignedToId] : undefined,
        templateVars: { firstName: student.firstName, lastName: student.lastName },
      }).catch(() => {});
    } else {
      dispatchNotification({
        event: "student.agent_unlinked",
        title: "Student Unlinked from Agent",
        body: `Student ${student.firstName} ${student.lastName} has been unlinked from their agent.`,
        actionUrl: `/staff/students/${student.id}`,
        icon: "Unlink",
        recipientUserIds: student.assignedToId ? [student.assignedToId] : undefined,
        templateVars: { firstName: student.firstName, lastName: student.lastName },
      }).catch(() => {});
    }
  }

  res.json(student);
});

router.post("/students/bulk-action", requireAuth, requireRole(...ADMIN_ROLES), async (req, res): Promise<void> => {
  const { ids, action, assignedToId, status } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: "ids required" }); return; }
  if (!["delete", "assign", "move"].includes(action)) { res.status(400).json({ error: "Invalid action" }); return; }
  const numericIds = ids.map(Number).filter((n: number) => !isNaN(n));
  let updated = 0;
  if (action === "delete") {
    const studentsToArchive = await db.select({ id: studentsTable.id, userId: studentsTable.userId }).from(studentsTable).where(and(inArray(studentsTable.id, numericIds), isNull(studentsTable.deletedAt)));
    const archiveIds = studentsToArchive.map(s => s.id);
    if (archiveIds.length > 0) {
      const apps = await db.select({ id: applicationsTable.id }).from(applicationsTable).where(inArray(applicationsTable.studentId, archiveIds));
      const appIds = apps.map(a => a.id);
      if (appIds.length > 0) {
        await db.update(documentsTable).set({ deletedAt: new Date() }).where(and(inArray(documentsTable.studentId, archiveIds), inArray(documentsTable.applicationId, appIds)));
        await db.delete(applicationsTable).where(inArray(applicationsTable.id, appIds));
      }
      const result = await db.update(studentsTable).set({ deletedAt: new Date() }).where(inArray(studentsTable.id, archiveIds));
      updated = result.rowCount ?? archiveIds.length;
      const userIdsToDeactivate = studentsToArchive.filter(s => s.userId).map(s => s.userId!);
      if (userIdsToDeactivate.length > 0) {
        await db.update(usersTable).set({ isActive: false }).where(inArray(usersTable.id, userIdsToDeactivate));
      }
    }
    for (const id of archiveIds) await logAudit(req.user!.id, "archive_student", "student", id, null, req.ip);
  } else if (action === "assign" && assignedToId !== undefined) {
    const result = await db.update(studentsTable).set({ assignedToId: assignedToId ? Number(assignedToId) : null }).where(and(inArray(studentsTable.id, numericIds), isNull(studentsTable.deletedAt)));
    updated = result.rowCount ?? numericIds.length;
    await logAudit(req.user!.id, "bulk_assign_students", "student", null, { ids: numericIds, assignedToId }, req.ip);
  } else if (action === "move" && status) {
    const result = await db.update(studentsTable).set({ status }).where(and(inArray(studentsTable.id, numericIds), isNull(studentsTable.deletedAt)));
    updated = result.rowCount ?? numericIds.length;
    await logAudit(req.user!.id, "bulk_move_students", "student", null, { ids: numericIds, status }, req.ip);
  } else {
    res.status(400).json({ error: "Missing required fields for action" }); return;
  }
  res.json({ success: true, updated });
});

router.delete("/students/:id", requireAuth, requireRole(...STAFF_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [student] = await db.select().from(studentsTable).where(and(eq(studentsTable.id, id), isNull(studentsTable.deletedAt)));
  if (!student) { res.status(404).json({ error: "Student not found" }); return; }

  const apps = await db.select({ id: applicationsTable.id }).from(applicationsTable).where(eq(applicationsTable.studentId, id));
  const appIds = apps.map(a => a.id);

  if (appIds.length > 0) {
    await db.update(documentsTable)
      .set({ deletedAt: new Date() })
      .where(and(eq(documentsTable.studentId, id), inArray(documentsTable.applicationId, appIds)));
    await db.delete(applicationsTable).where(inArray(applicationsTable.id, appIds));
  }

  await db.update(studentsTable).set({ deletedAt: new Date() }).where(eq(studentsTable.id, id));

  if (student.userId) {
    await db.update(usersTable).set({ isActive: false }).where(eq(usersTable.id, student.userId));
  }

  await logAudit(req.user!.id, "archive_student", "student", id, null, req.ip);
  res.status(204).end();
});

router.patch("/students/:id/origin", requireAuth, requireRole("super_admin", "admin"), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { originType, originEntityType, originEntityId, originDisplayName } = req.body;
  if (!originType || !["direct", "agent", "sub_agent"].includes(originType)) {
    res.status(400).json({ error: "originType must be direct, agent, or sub_agent" });
    return;
  }
  const [existing] = await db.select().from(studentsTable).where(and(eq(studentsTable.id, id), isNull(studentsTable.deletedAt)));
  if (!existing) { res.status(404).json({ error: "Student not found" }); return; }

  const oldOrigin = { originType: existing.originType, originEntityType: existing.originEntityType, originEntityId: existing.originEntityId, originDisplayName: existing.originDisplayName };

  const [updated] = await db.update(studentsTable).set({
    originType,
    originEntityType: originEntityType || null,
    originEntityId: originEntityId || null,
    originDisplayName: originDisplayName || null,
    originLocked: true,
  }).where(eq(studentsTable.id, id)).returning();

  await logAudit(req.user!.id, "override_origin", "student", id, { old: oldOrigin, new: { originType, originEntityType, originEntityId, originDisplayName } }, req.ip);
  res.json(updated);
});

router.post("/students/:id/set-password", requireAuth, requireRole(...ADMIN_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { password } = req.body;
  if (!password || password.length < 6) {
    res.status(400).json({ error: "Password must be at least 6 characters" });
    return;
  }
  const [student] = await db.select().from(studentsTable).where(and(eq(studentsTable.id, id), isNull(studentsTable.deletedAt)));
  if (!student) { res.status(404).json({ error: "Student not found" }); return; }

  const hash = await bcrypt.hash(password, 10);

  if (student.userId) {
    await db.update(usersTable).set({ passwordHash: hash }).where(eq(usersTable.id, student.userId));
    await logAudit(req.user!.id, "set_password", "student", id, { userId: student.userId }, req.ip);
    res.json({ success: true, userId: student.userId });
  } else {
    if (!student.email) {
      res.status(400).json({ error: "Student has no email address. Please add an email first." });
      return;
    }
    const [existingUser] = await db.select().from(usersTable).where(eq(usersTable.email, student.email));
    if (existingUser) {
      if (existingUser.role !== "student") {
        res.status(409).json({ error: "This email is already in use by a non-student account. Cannot link." });
        return;
      }
      await db.update(usersTable).set({ passwordHash: hash }).where(eq(usersTable.id, existingUser.id));
      await db.update(studentsTable).set({ userId: existingUser.id }).where(eq(studentsTable.id, id));
      await logAudit(req.user!.id, "set_password", "student", id, { userId: existingUser.id, linkedExisting: true }, req.ip);
      res.json({ success: true, userId: existingUser.id });
    } else {
      const [newUser] = await db.insert(usersTable).values({
        email: student.email,
        passwordHash: hash,
        firstName: student.firstName || "",
        lastName: student.lastName || "",
        role: "student",
        isActive: true,
        phone: student.phone || null,
      }).returning();
      await db.update(studentsTable).set({ userId: newUser.id }).where(eq(studentsTable.id, id));
      await logAudit(req.user!.id, "set_password", "student", id, { userId: newUser.id, createdUser: true }, req.ip);
      res.json({ success: true, userId: newUser.id, userCreated: true });
    }
  }
});

export default router;
