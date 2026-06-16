import { Router, type IRouter } from "express";
import { db, studentsTable, documentsTable, usersTable, agentsTable, applicationsTable, applicationStageDocumentsTable, notesTable, followUpsTable, leadsTable, invoicesTable, commissionsTable, serviceFeesTable, settingsTable, softDelete } from "@workspace/db";
import { eq, ilike, or, sql, and, desc, asc, inArray, isNotNull, ne } from "drizzle-orm";
import { requireAuth, requireRole, requireAgentStaffPermission, logAudit } from "../lib/auth";
import { STAFF_ROLES, ADMIN_ROLES, AGENT_ROLES, isAgentRole } from "../lib/roles";
import { getAgentVisibleIds, getAgentRecord } from "../lib/agentVisibility";
import { getEffectivePermissionSet, canAccessAssignedRecord, userHasPermission } from "../lib/permissions";
import { cascadeStudentAssignment } from "../lib/leadAssignment";
import { resolveAgentCommission } from "../lib/agentCommission";
import { getAgencyMemberAgentIds } from "../lib/agencyStaff";
import { getVisibleBranchIds, resolveCreateBranchId } from "../lib/branchScope";
import { assertCanAccessStudent } from "../lib/studentAccess";
import { streamDocumentToResponse } from "../lib/documentBytes";
import { isNull } from "drizzle-orm";
import { normalizeAndValidateNames, normalizePhoneField, EXTENDED_NAME_FIELDS, toLatinUpper } from "../lib/textNormalize";
import { dispatchNotification } from "../lib/notificationDispatcher";
import { inferOriginFromUser, inferOriginFromAgentId, type OriginMeta } from "../lib/originHelper";
import { toE164 } from "../lib/inbox/phone";
import { parsePaginationParams, buildPageMeta } from "@workspace/pagination";
import bcrypt from "bcryptjs";
import { deleteSessionsForUser } from "../lib/replitAuth";
import { getCurrentSeason } from "../lib/season";

const router: IRouter = Router();

const STUDENT_PATCH_FIELDS = [
  "firstName", "lastName", "email", "phone", "nationality",
  "dateOfBirth", "passportNumber", "passportIssueDate", "passportExpiry",
  "motherName", "fatherName", "address", "gender",
  "status", "agentId", "assignedToId", "userId", "notes",
  "highSchool", "graduationYear", "gpa", "languageScore",
  "universityBachelor", "universityMaster",
  "photoUrl", "nextFollowup", "interestedLevel",
];

router.get("/students/me", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const [student] = await db.select().from(studentsTable).where(and(eq(studentsTable.userId, userId), isNull(studentsTable.deletedAt)));
  if (!student) { res.status(404).json({ error: "Student profile not found" }); return; }
  res.json(student);
});

// Task #187 — list every open missing-doc request across all of the
// signed-in student's applications, with stage/university/program context
// for the student portal "Bekleyen Talepler" section.
router.get("/students/me/missing-docs", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  if (user.role !== "student") {
    res.status(403).json({ error: "Only students can call this endpoint" });
    return;
  }
  const { db, applicationStageDocumentsTable, applicationsTable, studentsTable: stdT, universitiesTable, programsTable, pipelineStagesTable } = await import("@workspace/db");
  const { eq, and, isNull, desc, sql } = await import("drizzle-orm");

  const [studentRec] = await db.select({ id: stdT.id }).from(stdT).where(eq(stdT.userId, user.id));
  if (!studentRec) { res.json([]); return; }

  const rows = await db
    .select({
      id: applicationStageDocumentsTable.id,
      applicationId: applicationStageDocumentsTable.applicationId,
      stage: applicationStageDocumentsTable.stage,
      stageLabel: pipelineStagesTable.label,
      fileName: applicationStageDocumentsTable.fileName,
      isCustom: applicationStageDocumentsTable.isCustom,
      note: applicationStageDocumentsTable.note,
      fulfilledAt: applicationStageDocumentsTable.fulfilledAt,
      respondedAt: applicationStageDocumentsTable.respondedAt,
      createdAt: applicationStageDocumentsTable.createdAt,
      uploadedByName: applicationStageDocumentsTable.uploadedByName,
      universityName: universitiesTable.name,
      programName: programsTable.name,
    })
    .from(applicationStageDocumentsTable)
    .innerJoin(applicationsTable, eq(applicationsTable.id, applicationStageDocumentsTable.applicationId))
    .leftJoin(universitiesTable, eq(universitiesTable.id, applicationsTable.universityId))
    .leftJoin(programsTable, eq(programsTable.id, applicationsTable.programId))
    .leftJoin(pipelineStagesTable, and(
      eq(pipelineStagesTable.entityType, "application"),
      eq(pipelineStagesTable.key, applicationStageDocumentsTable.stage),
    ))
    .where(and(
      eq(applicationsTable.studentId, studentRec.id),
      isNull(applicationsTable.deletedAt),
      eq(applicationStageDocumentsTable.isMissingDocNote, true),
      isNull(applicationStageDocumentsTable.fulfilledAt),
    ))
    .orderBy(desc(applicationStageDocumentsTable.createdAt));

  // Task #187 contract — explicit names (documentType / customTitle /
  // requestedAt / requestedBy) alongside raw fields for BC.
  const shaped = rows.map((r: any) => ({
    ...r,
    documentType: r.isCustom ? null : r.fileName,
    customTitle: r.isCustom ? r.fileName : null,
    requestedAt: r.createdAt,
    requestedBy: r.uploadedByName,
  }));
  res.json(shaped);
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
    "motherName", "fatherName", "address", "gender",
    "highSchool", "universityBachelor", "universityMaster",
    "graduationYear", "gpa", "languageScore",
  ];
  const data: Record<string, unknown> = {};
  for (const k of SELF_FIELDS) {
    if (req.body[k] !== undefined) data[k] = req.body[k];
  }
  const { error: meNameErr, normalized: normData } = normalizeAndValidateNames(data, EXTENDED_NAME_FIELDS);
  if (meNameErr) { res.status(400).json({ error: meNameErr }); return; }
  if (Object.prototype.hasOwnProperty.call(normData, "phone")) {
    const rawPhone = (normData as any).phone;
    (normData as any).phone = rawPhone ? normalizePhoneField(rawPhone) : rawPhone;
    (normData as any).phoneE164 = toE164((normData as any).phone);
  }
  Object.assign(data, normData);

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
  const studentId = parseInt(String(req.params.id), 10);
  const access = await assertCanAccessStudent(req, studentId);
  if (!access.ok) { res.status(access.status).json({ error: access.error }); return; }
  const [photoDoc] = await db.select({
      fileKey: documentsTable.fileKey,
      fileData: documentsTable.fileData,
      fileUrl: documentsTable.fileUrl,
      mimeType: documentsTable.mimeType,
    })
    .from(documentsTable)
    .where(and(eq(documentsTable.studentId, studentId), or(eq(documentsTable.type, "photo"), eq(documentsTable.type, "photograph")), isNull(documentsTable.deletedAt)))
    .orderBy(desc(documentsTable.createdAt))
    .limit(1);
  if (!photoDoc || (!photoDoc.fileKey && !photoDoc.fileData && !photoDoc.fileUrl)) {
    res.status(404).json({ error: "No photo" }); return;
  }
  // fileUrl-only documents (no object-storage key): redirect the browser so it
  // fetches the file directly.  Only allow http/https to prevent SSRF via
  // data: or file: URIs.
  if (!photoDoc.fileKey && !photoDoc.fileData) {
    const url = photoDoc.fileUrl!;
    if (!/^https?:\/\//i.test(url)) {
      res.status(422).json({ error: "Invalid photo URL" }); return;
    }
    res.redirect(302, url);
    return;
  }
  // Use private caching so a shared proxy cannot serve one user's photo to
  // another user who happens to request the same URL.
  res.set("Cache-Control", "private, max-age=300");
  try {
    const sent = await streamDocumentToResponse(photoDoc, res);
    if (!sent && !res.headersSent) res.status(404).json({ error: "No photo" });
  } catch (err) {
    console.error(`[STUDENTS] photo stream for #${studentId} failed:`, err);
    if (!res.headersSent) res.status(500).json({ error: "Failed to load photo" });
  }
});

router.get("/students", requireAuth, requireRole(...STAFF_ROLES, "student", ...AGENT_ROLES), requireAgentStaffPermission("students"), async (req, res): Promise<void> => {
  const user = req.user!;
  const { agentId, status, search, season, originType: originFilter } = req.query as Record<string, string>;
  const pageParams = parsePaginationParams(req, { defaultLimit: 20, maxLimit: "large" });
  const pageNum = pageParams.page;
  const limitNum = pageParams.limit;
  const offset = pageParams.offset;

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
    // Non-admin staff: visibility driven by records.* keys. Always see own
    // records; view_unassigned adds the unassigned pool; view_others adds
    // teammates' records. Plus (Task #128) students of an agency where the
    // user is listed as assigned staff are always visible.
    const perms = await getEffectivePermissionSet({ id: user.id, role: user.role });
    const agencyAgentIds = await getAgencyMemberAgentIds(user.id);
    const orParts: any[] = [eq(studentsTable.assignedToId, user.id)];
    if (perms.has("records.view_unassigned")) {
      orParts.push(isNull(studentsTable.assignedToId));
    }
    if (perms.has("records.view_others")) {
      orParts.push(and(isNotNull(studentsTable.assignedToId), ne(studentsTable.assignedToId, user.id))!);
    }
    if (agencyAgentIds.length > 0) {
      orParts.push(inArray(studentsTable.agentId, agencyAgentIds));
    }
    conditions.push(or(...orParts)!);
  }
  // Branch scoping (super_admin: null = all). Applies to staff AND agents.
  // Null-branch students (created via public apply popup, embed widgets) are
  // visible to any branch-scoped user so they can be claimed and assigned.
  if (user.role !== "student") {
    const visibleBranchIds = await getVisibleBranchIds(user.id, user.role);
    if (visibleBranchIds !== null) {
      if (visibleBranchIds.length === 0) {
        conditions.push(isNull(studentsTable.branchId));
      } else {
        conditions.push(or(inArray(studentsTable.branchId, visibleBranchIds), isNull(studentsTable.branchId))!);
      }
    }
  }
  if (search) {
    const rawTerm = search.trim();
    const translitTerm = toLatinUpper(rawTerm);
    const terms = Array.from(new Set([rawTerm, translitTerm].filter(Boolean)));
    const tokens = translitTerm.split(/\s+/).filter(Boolean);
    const orParts: any[] = [];
    for (const t of terms) {
      orParts.push(
        ilike(studentsTable.firstName, `%${t}%`),
        ilike(studentsTable.lastName, `%${t}%`),
        ilike(studentsTable.email, `%${t}%`),
        ilike(studentsTable.phone, `%${t}%`),
        sql`(coalesce(${studentsTable.firstName},'') || ' ' || coalesce(${studentsTable.lastName},'')) ILIKE ${'%' + t + '%'}`,
        sql`(coalesce(${studentsTable.lastName},'') || ' ' || coalesce(${studentsTable.firstName},'')) ILIKE ${'%' + t + '%'}`,
      );
    }
    if (tokens.length > 1) {
      // Çok-kelimeli aramada her token'ı KELİME SINIRINDA eşleştir.
      // Aksi halde "murat vural" araması "MURATL VURAL"ı da getirir.
      const esc = (s: string) => s.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
      orParts.push(and(
        ...tokens.map((tok: string) => {
          const pat = `\\m${esc(tok)}\\M`;
          return or(
            sql`${studentsTable.firstName} ~* ${pat}`,
            sql`${studentsTable.lastName} ~* ${pat}`,
          )!;
        })
      )!);
    }
    conditions.push(or(...orParts)!);
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
    .orderBy(desc(studentsTable.updatedAt), desc(studentsTable.createdAt));

  // hasPhoto is denormalized on students.has_photo; document upload/delete
  // handlers keep it in sync, so the listing query no longer needs an
  // extra SELECT against documents.
  const data = rows.map(r => ({ ...r.student, agentName: r.agentName || null, hasPhoto: !!r.student.hasPhoto }));

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
    dateOfBirth, gender, passportNumber, passportIssueDate, passportExpiry,
    motherName, fatherName, address,
    agentId, userId, notes,
    highSchool, graduationYear, gpa, languageScore, season,
    interestedLevel,
  } = req.body;

  if (!firstName || !lastName) {
    res.status(400).json({ error: "firstName and lastName are required" });
    return;
  }
  const { error: nameErr, normalized: normBody } = normalizeAndValidateNames(
    { firstName, lastName, motherName, fatherName, highSchool, address,
      universityBachelor: req.body.universityBachelor, universityMaster: req.body.universityMaster },
    EXTENDED_NAME_FIELDS,
  );
  if (nameErr) { res.status(400).json({ error: nameErr }); return; }

  if (passportNumber && passportNumber.trim()) {
    const [dupPassport] = await db.select({ id: studentsTable.id }).from(studentsTable)
      .where(and(eq(studentsTable.passportNumber, passportNumber.trim()), isNull(studentsTable.deletedAt)));
    if (dupPassport) {
      res.status(409).json({ error: "A student with this passport number already exists" });
      return;
    }
  }

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
  const inheritedBranchId = await resolveCreateBranchId(user.id, user.role, req.body.branchId ?? null);
  if (inheritedBranchId == null && user.role !== "super_admin" && user.role !== "student" && !isAgentRole(user.role)) {
    res.status(403).json({ error: "No accessible branch — cannot create student" });
    return;
  }
  const [student] = await db.insert(studentsTable).values({
    branchId: inheritedBranchId,
    firstName: normBody.firstName as string, lastName: normBody.lastName as string, status,
    email: email ? email.toLowerCase().trim() : null,
    phone: phone ? normalizePhoneField(phone) : null,
    phoneE164: toE164(phone ? normalizePhoneField(phone) : null),
    nationality: nationality || null,
    dateOfBirth: dateOfBirth || null,
    gender: gender || null,
    passportNumber: passportNumber ? passportNumber.trim() : null,
    passportIssueDate: passportIssueDate || null,
    passportExpiry: passportExpiry || null,
    motherName: normBody.motherName ? (normBody.motherName as string) : null,
    fatherName: normBody.fatherName ? (normBody.fatherName as string) : null,
    address: normBody.address ? (normBody.address as string) : null,
    agentId: resolvedAgentId,
    userId: userId || null,
    notes: notes || null,
    highSchool: normBody.highSchool ? (normBody.highSchool as string) : null,
    universityBachelor: normBody.universityBachelor ? (normBody.universityBachelor as string) : null,
    universityMaster: normBody.universityMaster ? (normBody.universityMaster as string) : null,
    graduationYear: graduationYear ? parseInt(String(graduationYear), 10) : null,
    gpa: gpa || null,
    languageScore: languageScore || null,
    interestedLevel: interestedLevel || null,
    season: season || (await getCurrentSeason()),
    ...origin,
  }).returning();

  await logAudit(req.user!.id, "create_student", "student", student.id, { firstName, lastName }, req.ip);

  dispatchNotification({
    actorUserId: req.user!.id,
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
  const bulkOrigin = await inferOriginFromUser({ role: bulkUser.role, id: bulkUser.id, managingAgentId: (bulkUser as any).managingAgentId });
  const inserted: any[] = [];
  const errors: any[] = [];

  for (let i = 0; i < students.length; i++) {
    const s = students[i];
    if (!s.firstName || !s.lastName) {
      errors.push({ index: i, error: "firstName and lastName are required", row: s });
      continue;
    }
    const { error: bNameErr, normalized: ns } = normalizeAndValidateNames(s, EXTENDED_NAME_FIELDS);
    if (bNameErr) {
      errors.push({ index: i, error: bNameErr, row: s });
      continue;
    }
    const normBulkPhone = s.phone ? normalizePhoneField(s.phone) : null;
    try {
      const [student] = await db.insert(studentsTable).values({
        firstName: ns.firstName as string,
        lastName: ns.lastName as string,
        status: s.status || "active",
        email: s.email || null,
        phone: normBulkPhone,
        phoneE164: toE164(normBulkPhone),
        nationality: s.nationality || null,
        dateOfBirth: s.dateOfBirth || null,
        gender: s.gender || null,
        passportNumber: s.passportNumber || null,
        passportIssueDate: s.passportIssueDate || null,
        passportExpiry: s.passportExpiry || null,
        motherName: ns.motherName ? (ns.motherName as string) : null,
        fatherName: ns.fatherName ? (ns.fatherName as string) : null,
        address: (ns.address as string) || s.address || null,
        notes: s.notes || null,
        highSchool: (ns.highSchool as string) || s.highSchool || null,
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

  await logAudit(req.user!.id, "bulk_create_students", "student", undefined, { count: inserted.length }, req.ip);
  res.status(201).json({ inserted, errors, total: students.length, success: inserted.length });
});

router.get("/students/:id", requireAuth, requireAgentStaffPermission("students"), async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  const access = await assertCanAccessStudent(req, id);
  if (!access.ok) { res.status(access.status).json({ error: access.error }); return; }
  res.json(access.student);
});

router.patch("/students/:id", requireAuth, requireAgentStaffPermission("students"), async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
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
  }

  const isAdmin = (ADMIN_ROLES as readonly string[]).includes(role);
  const perms = isAgent || isStudent || isAdmin
    ? new Set<string>()
    : await getEffectivePermissionSet({ id: req.user!.id, role });

  if (!isStudent && !isAgent && !isAdmin) {
    if (!canAccessAssignedRecord(perms, existing.assignedToId, req.user!.id)) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
  }

  const STUDENT_SELF_FIELDS = [
    "firstName", "lastName", "phone", "nationality",
    "dateOfBirth", "passportNumber", "passportIssueDate", "passportExpiry",
    "motherName", "fatherName", "address", "gender",
    "highSchool", "universityBachelor", "universityMaster",
    "graduationYear", "gpa", "languageScore", "photoUrl",
  ];
  let allowedFields = isStudent
    ? STUDENT_SELF_FIELDS
    : isAgent
    ? STUDENT_PATCH_FIELDS.filter(f => f !== "agentId" && f !== "userId" && f !== "assignedToId" && f !== "status")
    : STUDENT_PATCH_FIELDS;
  if (isAgent && req.body.status !== undefined) {
    const [settingsRow] = await db.select({ agentCanChangeStudentAppStage: settingsTable.agentCanChangeStudentAppStage }).from(settingsTable);
    if (settingsRow?.agentCanChangeStudentAppStage === true) {
      allowedFields = [...allowedFields, "status"];
    }
  }
  if (!isAdmin && !isAgent && !isStudent && !perms.has("students.change_stage")) {
    allowedFields = allowedFields.filter(f => f !== "status");
  }
  if (!isAdmin && !isAgent && !isStudent && req.body.assignedToId !== undefined) {
    // Task #494: strict rule — non-admin may only change assignment when they ARE the current assignee.
    // Unassigned (null) records also 403; only admin can make the initial assignment.
    if (existing.assignedToId !== req.user!.id) {
      res.status(403).json({ error: "Only the current assignee or an admin can change assignment" });
      return;
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
  if (updates.email && typeof updates.email === "string") {
    const normalizedEmail = (updates.email as string).toLowerCase().trim();
    updates.email = normalizedEmail;
    const [dupEmail] = await db.select({ id: studentsTable.id }).from(studentsTable)
      .where(and(eq(studentsTable.email, normalizedEmail), isNull(studentsTable.deletedAt)));
    if (dupEmail && dupEmail.id !== id) {
      res.status(409).json({ error: "A student with this email already exists" });
      return;
    }
  }
  if (updates.passportNumber && typeof updates.passportNumber === "string") {
    const normPassport = (updates.passportNumber as string).trim();
    if (normPassport) {
      const [dupPassport] = await db.select({ id: studentsTable.id }).from(studentsTable)
        .where(and(eq(studentsTable.passportNumber, normPassport), isNull(studentsTable.deletedAt)));
      if (dupPassport && dupPassport.id !== id) {
        res.status(409).json({ error: "A student with this passport number already exists" });
        return;
      }
    }
  }
  const { error: nameErr, normalized: normUpdates } = normalizeAndValidateNames(
    updates, EXTENDED_NAME_FIELDS
  );
  if (nameErr) { res.status(400).json({ error: nameErr }); return; }
  if (Object.prototype.hasOwnProperty.call(normUpdates, "phone")) {
    const rawPhone = (normUpdates as any).phone;
    (normUpdates as any).phone = rawPhone ? normalizePhoneField(rawPhone) : rawPhone;
    (normUpdates as any).phoneE164 = toE164((normUpdates as any).phone);
  }
  const [student] = await db.update(studentsTable).set(normUpdates).where(eq(studentsTable.id, id)).returning();
  if (!student) { res.status(404).json({ error: "Student not found" }); return; }
  const studentDiff: Record<string, any> = {};
  for (const k of Object.keys(normUpdates)) {
    if (k === "phoneE164") continue;
    const oldVal = (existing as any)[k];
    const newVal = (normUpdates as any)[k];
    const oldNorm = oldVal instanceof Date ? oldVal.toISOString() : oldVal;
    const newNorm = newVal instanceof Date ? newVal.toISOString() : newVal;
    if (oldNorm !== newNorm) {
      studentDiff[k] = { from: oldVal ?? null, to: newVal ?? null };
    }
  }
  await logAudit(req.user!.id, "update_student", "student", id, Object.keys(studentDiff).length ? studentDiff : updates, req.ip);

  // T4: Cross-sync contact info back to source lead(s) (best-effort)
  const studentSyncFields: Record<string, unknown> = {};
  for (const f of ["firstName", "lastName", "email", "phone", "phoneE164", "nationality"]) {
    if (Object.prototype.hasOwnProperty.call(normUpdates, f)) {
      studentSyncFields[f] = (normUpdates as any)[f];
    }
  }
  if (Object.keys(studentSyncFields).length > 0) {
    try {
      await db.update(leadsTable).set(studentSyncFields).where(eq(leadsTable.convertedStudentId, id));
    } catch (err) {
      console.warn("[student->lead sync] failed:", err);
    }
  }

  // Cascade assignment up to the source lead(s) and across the student's
  // applications so the same person shows one owner across Leads, Students and
  // Applications. With `records.cascade_assignment` permission: OVERWRITES all.
  // Without it: null-fill only — fills unassigned sibling records automatically.
  const studentAssignmentChanged =
    Object.prototype.hasOwnProperty.call(normUpdates, "assignedToId") &&
    existing.assignedToId !== student.assignedToId;
  if (studentAssignmentChanged) {
    const canCascade = await userHasPermission({ id: req.user!.id, role }, "records.cascade_assignment");
    if (canCascade) {
      await cascadeStudentAssignment({
        studentId: id,
        newAssignedToId: student.assignedToId,
        actorUserId: req.user!.id,
        ipAddress: req.ip,
      });
    } else if (student.assignedToId !== null) {
      await cascadeStudentAssignment({
        studentId: id,
        newAssignedToId: student.assignedToId,
        actorUserId: req.user!.id,
        ipAddress: req.ip,
        nullFillOnly: true,
      });
    }
  }

  if (updates.status && updates.status !== existing.status) {
    const recipientIds: number[] = [];
    if (student.assignedToId) recipientIds.push(student.assignedToId);
    if (student.userId) recipientIds.push(student.userId);
    try {
      await dispatchNotification({
        actorUserId: req.user!.id,
        event: "student.status_changed",
        title: "Student Status Changed",
        body: `Student ${student.firstName} ${student.lastName} status changed from "${existing.status}" to "${updates.status}".`,
        actionUrl: `/staff/students/${student.id}`,
        icon: "UserCheck",
        recipientUserIds: recipientIds.length > 0 ? recipientIds : undefined,
        templateVars: { firstName: student.firstName, lastName: student.lastName, oldStatus: existing.status || "", newStatus: String(updates.status) },
      });
    } catch (err) {
      console.error("[STUDENTS] status_changed dispatch error:", err);
    }
  }

  if (updates.assignedToId && updates.assignedToId !== existing.assignedToId) {
    dispatchNotification({
    actorUserId: req.user!.id,
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
    actorUserId: req.user!.id,
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
    actorUserId: req.user!.id,
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

// Transfer a student (and its full ownership chain) from the acting parent agent
// to one of the agent's OWN sub-agents. The parent keeps its commission share —
// resolveAgentCommission recomputes each commission row so commission.agentId
// stays the PARENT (parentAmount) and subAgentId/subAmount go to the sub-agent.
// Only a parent agent ("agent" role, no parentAgentId) may call this.
router.post("/students/:id/transfer-to-sub-agent", requireAuth, requireRole("agent"), async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const subAgentId = parseInt(String(req.body?.subAgentId), 10);
  if (isNaN(subAgentId)) { res.status(400).json({ error: "subAgentId is required" }); return; }

  const actingAgent = await getAgentRecord(req.user!.id, req.user!.role);
  if (!actingAgent) { res.status(403).json({ error: "Agent profile not found" }); return; }
  // A sub-agent cannot itself transfer students (no second tier exists).
  if (actingAgent.parentAgentId) { res.status(403).json({ error: "Sub-agents cannot transfer students" }); return; }

  const [existing] = await db.select().from(studentsTable).where(and(eq(studentsTable.id, id), isNull(studentsTable.deletedAt)));
  if (!existing) { res.status(404).json({ error: "Student not found" }); return; }

  // IDOR: the student must currently be inside the acting agent's own tree
  // (the agent itself or one of its own sub-agents).
  const visibleIds = await getAgentVisibleIds(req.user!.id, req.user!.role);
  if (!existing.agentId || !visibleIds.includes(existing.agentId)) {
    res.status(403).json({ error: "You can only transfer your own students" }); return;
  }

  // IDOR: the destination must be one of THIS agent's own sub-agents.
  const [target] = await db.select().from(agentsTable)
    .where(and(eq(agentsTable.id, subAgentId), eq(agentsTable.parentAgentId, actingAgent.id), isNull(agentsTable.deletedAt)));
  if (!target) { res.status(404).json({ error: "Sub-agent not found" }); return; }

  if (existing.agentId === subAgentId) { res.status(400).json({ error: "Student already belongs to this sub-agent" }); return; }

  // Full origin metadata for the destination sub-agent (type + entity + display
  // name). Applied to both student and applications so origin-based filtering
  // and display stay consistent with the new owner. Reads agent rows only.
  const subOrigin = await inferOriginFromAgentId(subAgentId);

  await db.transaction(async (tx) => {
    // 1. Student ownership → sub-agent (full origin reflects the sub-agent tier).
    await tx.update(studentsTable).set({
      agentId: subAgentId,
      originType: subOrigin.originType,
      originEntityType: subOrigin.originEntityType,
      originEntityId: subOrigin.originEntityId,
      originDisplayName: subOrigin.originDisplayName,
    }).where(eq(studentsTable.id, id));

    // 2. Existing applications + their service-fee rows move to the sub-agent.
    const apps = await tx.select({ id: applicationsTable.id }).from(applicationsTable)
      .where(and(eq(applicationsTable.studentId, id), isNull(applicationsTable.deletedAt)));
    const appIds = apps.map(a => a.id);
    if (appIds.length > 0) {
      // agentId AND full origin metadata must move together so origin-based
      // filtering / reporting stays consistent with the new owner (sub-agent).
      await tx.update(applicationsTable).set({
        agentId: subAgentId,
        originType: subOrigin.originType,
        originEntityType: subOrigin.originEntityType,
        originEntityId: subOrigin.originEntityId,
        originDisplayName: subOrigin.originDisplayName,
      }).where(inArray(applicationsTable.id, appIds));
      await tx.update(serviceFeesTable).set({ agentId: subAgentId }).where(inArray(serviceFeesTable.applicationId, appIds));

      // 3. Recompute each commission row through the chain. The university
      //    commission amount is agent-independent and stays as-is; only the
      //    agent/sub-agent split changes. resolveAgentCommission returns the
      //    PARENT as agentId for a sub-agent, so the parent keeps its share.
      const comms = await tx.select().from(commissionsTable).where(inArray(commissionsTable.applicationId, appIds));
      for (const comm of comms) {
        const uniAmt = parseFloat(String(comm.universityCommissionAmount ?? "0")) || 0;
        const recomputed = await resolveAgentCommission(subAgentId, uniAmt);
        // For zero-amount rows resolveAgentCommission returns the passed id with
        // null amounts; force the parent/sub link so ownership stays consistent.
        await tx.update(commissionsTable).set({
          agentId: uniAmt > 0 ? recomputed.agentId : actingAgent.id,
          agentCommissionRate: recomputed.agentCommissionRate,
          agentCommissionAmount: recomputed.agentCommissionAmount,
          subAgentId: uniAmt > 0 ? recomputed.subAgentId : subAgentId,
          subAgentCommissionRate: recomputed.subAgentCommissionRate,
          subAgentCommissionAmount: recomputed.subAgentCommissionAmount,
        }).where(eq(commissionsTable.id, comm.id));
      }
    }

    // 4. Source lead(s) that converted into this student also follow ownership.
    await tx.update(leadsTable).set({ agentId: subAgentId }).where(eq(leadsTable.convertedStudentId, id));
  });

  await logAudit(req.user!.id, "transfer_student_to_sub_agent", "student", id, { fromAgentId: existing.agentId, toAgentId: subAgentId }, req.ip);

  const [updated] = await db.select().from(studentsTable).where(eq(studentsTable.id, id));
  res.json(updated);
});

router.post("/students/bulk-action", requireAuth, requireRole(...ADMIN_ROLES), async (req, res): Promise<void> => {
  const { ids, action, assignedToId, status } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: "ids required" }); return; }
  if (!["delete", "assign", "move"].includes(action)) { res.status(400).json({ error: "Invalid action" }); return; }
  const numericIds = ids.map(Number).filter((n: number) => !isNaN(n));
  let updated = 0;
  if (action === "delete") {
    const studentsToDelete = await db.select({ id: studentsTable.id, userId: studentsTable.userId }).from(studentsTable).where(and(inArray(studentsTable.id, numericIds), isNull(studentsTable.deletedAt)));
    const deleteIds = studentsToDelete.map(s => s.id);
    if (deleteIds.length > 0) {
      const userIds = studentsToDelete.filter(s => s.userId).map(s => s.userId!);
      await softDeleteStudents(deleteIds, userIds, req.user!.id);
      updated = deleteIds.length;
    }
    for (const id of deleteIds) await logAudit(req.user!.id, "delete_student", "student", id, { soft: true }, req.ip);
  } else if (action === "assign" && assignedToId !== undefined) {
    const newAssignedToId = assignedToId ? Number(assignedToId) : null;
    const affected = await db.select({ id: studentsTable.id }).from(studentsTable)
      .where(and(inArray(studentsTable.id, numericIds), isNull(studentsTable.deletedAt)));
    const result = await db.update(studentsTable).set({ assignedToId: newAssignedToId }).where(and(inArray(studentsTable.id, numericIds), isNull(studentsTable.deletedAt)));
    updated = result.rowCount ?? numericIds.length;
    await logAudit(req.user!.id, "bulk_assign_students", "student", undefined, { ids: numericIds, assignedToId }, req.ip);
    const canCascade = await userHasPermission({ id: req.user!.id, role: req.user!.role }, "records.cascade_assignment");
    for (const s of affected) {
      await cascadeStudentAssignment({
        studentId: s.id,
        newAssignedToId,
        actorUserId: req.user!.id,
        ipAddress: req.ip,
        nullFillOnly: !canCascade,
      });
    }
  } else if (action === "move" && status) {
    const result = await db.update(studentsTable).set({ status }).where(and(inArray(studentsTable.id, numericIds), isNull(studentsTable.deletedAt)));
    updated = result.rowCount ?? numericIds.length;
    await logAudit(req.user!.id, "bulk_move_students", "student", undefined, { ids: numericIds, status }, req.ip);
  } else {
    res.status(400).json({ error: "Missing required fields for action" }); return;
  }
  res.json({ success: true, updated });
});

router.delete("/students/:id", requireAuth, requireRole(...STAFF_ROLES), requireAgentStaffPermission("students"), async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  const access = await assertCanAccessStudent(req, id);
  if (!access.ok) { res.status(access.status).json({ error: access.error }); return; }
  const student = access.student;

  await softDeleteStudents([id], [student.userId].filter(Boolean) as number[], req.user!.id);

  await logAudit(req.user!.id, "delete_student", "student", id, { soft: true }, req.ip);
  res.status(204).end();
});

// Cascade soft-delete: student row, its applications, and its documents (all
// have deletedAt). Linked auth user is deactivated rather than soft-deleted —
// keeps login records and historical author refs valid. Notes / invoices /
// follow_ups don't have deletedAt; they're hidden via the parent.deletedAt
// filter on listing endpoints.
async function softDeleteStudents(studentIds: number[], userIds: number[], actorUserId: number): Promise<void> {
  if (studentIds.length === 0) return;
  await db.transaction(async (tx) => {
    const apps = await tx.select({ id: applicationsTable.id })
      .from(applicationsTable)
      .where(and(inArray(applicationsTable.studentId, studentIds), isNull(applicationsTable.deletedAt)));
    const appIds = apps.map(a => a.id);
    if (appIds.length > 0) {
      await softDelete(applicationsTable, appIds, { actorUserId, tx });
      await tx.update(documentsTable)
        .set({ deletedAt: sql`now()` })
        .where(and(inArray(documentsTable.applicationId, appIds), isNull(documentsTable.deletedAt)));
    }
    await tx.update(documentsTable)
      .set({ deletedAt: sql`now()` })
      .where(and(inArray(documentsTable.studentId, studentIds), isNull(documentsTable.deletedAt)));
    await softDelete(studentsTable, studentIds, { actorUserId, tx });
    if (userIds.length > 0) {
      await tx.update(usersTable).set({ isActive: false }).where(inArray(usersTable.id, userIds));
    }
  });
}

// Hard-delete (purge) — super_admin only. Permanently removes student and all
// associated rows; loses audit/finance history. Use for GDPR-style purges.
router.post("/students/:id/purge", requireAuth, requireRole("super_admin"), async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [student] = await db.select().from(studentsTable).where(eq(studentsTable.id, id));
  if (!student) { res.status(404).json({ error: "Student not found" }); return; }
  await db.transaction(async (tx) => {
    const apps = await tx.select({ id: applicationsTable.id }).from(applicationsTable).where(eq(applicationsTable.studentId, id));
    const appIds = apps.map(a => a.id);
    if (appIds.length > 0) {
      await tx.delete(notesTable).where(and(inArray(notesTable.resourceId, appIds), eq(notesTable.resourceType, "application")));
      await tx.delete(applicationStageDocumentsTable).where(inArray(applicationStageDocumentsTable.applicationId, appIds));
    }
    await tx.delete(notesTable).where(and(eq(notesTable.resourceId, id), eq(notesTable.resourceType, "student")));
    await tx.delete(documentsTable).where(eq(documentsTable.studentId, id));
    await tx.delete(invoicesTable).where(eq(invoicesTable.studentId, id));
    await tx.delete(followUpsTable).where(eq(followUpsTable.studentId, id));
    await tx.delete(studentsTable).where(eq(studentsTable.id, id));
  });
  await logAudit(req.user!.id, "purge_student", "student", id, { hard: true }, req.ip);
  res.json({ success: true });
});

router.patch("/students/:id/origin", requireAuth, requireRole("super_admin", "admin"), async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
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
  const id = parseInt(String(req.params.id), 10);
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
    await db.update(usersTable).set({ passwordHash: hash, passwordResetToken: null, passwordResetExpires: null }).where(eq(usersTable.id, student.userId));
    await deleteSessionsForUser(student.userId);
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
      await db.update(usersTable).set({ passwordHash: hash, passwordResetToken: null, passwordResetExpires: null }).where(eq(usersTable.id, existingUser.id));
      await deleteSessionsForUser(existingUser.id);
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

router.get("/students/:id/notes", requireAuth, requireRole(...STAFF_ROLES, ...AGENT_ROLES, "student"), requireAgentStaffPermission("students"), async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { page = "1", limit = "50", internal } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10)));
  const offset = (pageNum - 1) * limitNum;

  const userRole = req.user!.role;
  const isStaff = ["super_admin", "admin", "manager", "staff"].includes(userRole);

  if (userRole === "student") {
    const [student] = await db.select({ id: studentsTable.id }).from(studentsTable)
      .where(and(eq(studentsTable.id, id), eq(studentsTable.userId, req.user!.id), isNull(studentsTable.deletedAt)));
    if (!student) { res.status(403).json({ error: "Access denied" }); return; }
  }

  const conditions = [eq(notesTable.resourceId, id), eq(notesTable.resourceType, "student")];

  if (!isStaff || internal !== "true") {
    conditions.push(eq(notesTable.isInternal, false));
  } else {
    conditions.push(eq(notesTable.isInternal, true));
  }

  const notes = await db
    .select({
      id: notesTable.id,
      content: notesTable.content,
      authorId: notesTable.authorId,
      authorName: sql<string | null>`concat(${usersTable.firstName}, ' ', ${usersTable.lastName})`,
      isInternal: notesTable.isInternal,
      createdAt: notesTable.createdAt,
    })
    .from(notesTable)
    .leftJoin(usersTable, eq(notesTable.authorId, usersTable.id))
    .where(and(...conditions))
    .orderBy(notesTable.createdAt)
    .limit(limitNum)
    .offset(offset);
  res.json(notes);
});

router.post("/students/:id/notes", requireAuth, requireRole(...STAFF_ROLES, ...AGENT_ROLES), requireAgentStaffPermission("students"), async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { content, isInternal } = req.body;
  if (!content?.trim()) { res.status(400).json({ error: "content is required" }); return; }

  const isStaff = ["super_admin", "admin", "manager", "staff"].includes(req.user!.role);

  const [note] = await db.insert(notesTable).values({
    content: String(content).slice(0, 5000),
    authorId: req.user!.id,
    resourceType: "student",
    resourceId: id,
    isInternal: isStaff && isInternal === true,
  }).returning();

  const [student] = await db.select({
    assignedToId: studentsTable.assignedToId,
    agentId: studentsTable.agentId,
    firstName: studentsTable.firstName,
    lastName: studentsTable.lastName,
  }).from(studentsTable).where(eq(studentsTable.id, id));

  if (student) {
    const recipientIds: number[] = [];
    if (student.assignedToId && student.assignedToId !== req.user!.id) {
      recipientIds.push(student.assignedToId);
    }
    if (student.agentId) {
      const [agent] = await db.select({ userId: agentsTable.userId }).from(agentsTable)
        .where(eq(agentsTable.id, student.agentId));
      if (agent?.userId && agent.userId !== req.user!.id && !recipientIds.includes(agent.userId)) {
        recipientIds.push(agent.userId);
      }
    }
    if (recipientIds.length > 0) {
      dispatchNotification({
    actorUserId: req.user!.id,
        event: "note.created",
        title: "New Note Added",
        body: `A note was added to student ${student.firstName} ${student.lastName}`,
        actionUrl: `/staff/students/${id}`,
        recipientUserIds: recipientIds,
        data: { resourceType: "student", resourceId: id },
      });
    }
  }

  res.status(201).json({ ...note, authorName: `${req.user!.firstName || ""} ${req.user!.lastName || ""}`.trim() });
});

router.delete("/students/:id/notes/:noteId", requireAuth, requireRole(...STAFF_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  const noteId = parseInt(String(req.params.noteId), 10);
  if (isNaN(id) || isNaN(noteId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [note] = await db.select({
    id: notesTable.id,
    content: notesTable.content,
    authorId: notesTable.authorId,
    isInternal: notesTable.isInternal,
  }).from(notesTable).where(and(
    eq(notesTable.id, noteId),
    eq(notesTable.resourceId, id),
    eq(notesTable.resourceType, "student"),
  ));
  if (!note) { res.status(404).json({ error: "Note not found" }); return; }

  await db.delete(notesTable).where(eq(notesTable.id, noteId));

  await logAudit(req.user!.id, "delete_note", "student", id, {
    noteId,
    isInternal: note.isInternal,
    authorId: note.authorId,
    contentPreview: (note.content || "").slice(0, 200),
  }, req.ip);

  res.status(204).end();
});

router.get("/students/:id/follow-ups", requireAuth, requireRole(...STAFF_ROLES), requireAgentStaffPermission("students"), async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const access = await assertCanAccessStudent(req, id);
  if (!access.ok) { res.status(access.status).json({ error: access.error }); return; }
  const { page = "1", limit = "50" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10)));
  const offset = (pageNum - 1) * limitNum;

  const data = await db
    .select({
      id: followUpsTable.id,
      studentId: followUpsTable.studentId,
      title: followUpsTable.title,
      scheduledAt: followUpsTable.scheduledAt,
      completed: followUpsTable.completed,
      completedAt: followUpsTable.completedAt,
      notes: followUpsTable.notes,
      createdById: followUpsTable.createdById,
      createdByName: sql<string | null>`(SELECT NULLIF(CONCAT_WS(' ', cu.first_name, cu.last_name), '') FROM users cu WHERE cu.id = ${followUpsTable.createdById})`,
      updatedById: followUpsTable.updatedById,
      updatedByName: sql<string | null>`(SELECT NULLIF(CONCAT_WS(' ', uu.first_name, uu.last_name), '') FROM users uu WHERE uu.id = ${followUpsTable.updatedById})`,
      createdAt: followUpsTable.createdAt,
      updatedAt: followUpsTable.updatedAt,
    })
    .from(followUpsTable)
    .where(eq(followUpsTable.studentId, id))
    .orderBy(asc(followUpsTable.scheduledAt))
    .limit(limitNum)
    .offset(offset);
  res.json(data);
});

router.post("/students/:id/follow-ups", requireAuth, requireRole(...STAFF_ROLES), requireAgentStaffPermission("students"), async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const access = await assertCanAccessStudent(req, id);
  if (!access.ok) { res.status(access.status).json({ error: access.error }); return; }
  const { title, scheduledAt, notes } = req.body;
  if (!title?.trim() || !scheduledAt) {
    res.status(400).json({ error: "title and scheduledAt are required" });
    return;
  }
  const scheduledDate = new Date(scheduledAt);
  if (isNaN(scheduledDate.getTime())) {
    res.status(400).json({ error: "Invalid date" });
    return;
  }
  if (scheduledDate < new Date()) {
    res.status(400).json({ error: "Cannot schedule follow-ups in the past" });
    return;
  }
  const [followUp] = await db.insert(followUpsTable).values({
    studentId: id,
    resourceType: "student",
    title: String(title).slice(0, 500),
    scheduledAt: scheduledDate,
    notes: notes ? String(notes).slice(0, 2000) : null,
    createdById: req.user!.id,
    assignedToId: req.user!.id,
  }).returning();
  await logAudit(req.user!.id, "create_follow_up", "student", id, {
    followUpId: followUp.id,
    title: followUp.title,
    scheduledAt: followUp.scheduledAt instanceof Date ? followUp.scheduledAt.toISOString() : followUp.scheduledAt,
    notes: followUp.notes ? String(followUp.notes).slice(0, 200) : null,
  }, req.ip);
  res.status(201).json(followUp);
});

export default router;
