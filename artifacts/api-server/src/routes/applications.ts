import { Router, type IRouter } from "express";
import { db, applicationsTable, notesTable, usersTable, studentsTable, agentsTable, commissionsTable, serviceFeesTable, programsTable, universitiesTable } from "@workspace/db";
import { eq, sql, and, inArray, desc, isNull } from "drizzle-orm";
import { requireAuth, requireRole, logAudit } from "../lib/auth";
import { STAFF_ROLES } from "../lib/roles";
import { getAgentVisibleIds, getAgentRecord } from "../lib/agentVisibility";
import { getCommissionFinanceStatus, getServiceFeeFinanceStatus } from "../lib/stageFinance";
import { resolveAgentCommission } from "../lib/agentCommission";

const router: IRouter = Router();

const APP_PATCH_FIELDS = [
  "stage", "universityId", "programId", "agentId",
  "universityName", "country", "programName", "intake",
  "level", "instructionLanguage", "deadline",
  "tuitionFee", "discountedFee", "scholarship", "commissionRate",
  "serviceFeeAmount", "applicationFee", "depositFee", "advancedFee",
  "languageFee", "currency", "notes", "season",
];

router.get("/applications", requireAuth, async (req, res): Promise<void> => {
  const { studentId, agentId, stage, season, page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(500, Math.max(1, parseInt(limit, 10)));
  const offset = (pageNum - 1) * limitNum;

  const user = req.user!;
  const isStaff = STAFF_ROLES.includes(user.role as any);

  const conditions = [isNull(applicationsTable.deletedAt)];

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
    .orderBy(desc(applicationsTable.createdAt));

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
  const [studentRec2] = await db.select({ firstName: studentsTable.firstName, lastName: studentsTable.lastName }).from(studentsTable).where(eq(studentsTable.id, parseInt(studentId, 10)));
  const studentFullName = studentRec2 ? `${studentRec2.firstName || ""} ${studentRec2.lastName || ""}`.trim() : null;

  let snapshotTuitionFee = tuitionFee ? Number(tuitionFee) : null;
  let snapshotDiscountedFee: number | null = null;
  let snapshotScholarship = scholarship ? Number(scholarship) : null;
  let snapshotCommissionRate: number | null = null;
  let snapshotServiceFeeAmount: number | null = null;
  let snapshotApplicationFee: number | null = null;
  let snapshotDepositFee: number | null = null;
  let snapshotAdvancedFee: number | null = null;
  let snapshotLanguageFee: number | null = null;
  let snapshotCurrency = "USD";
  let snapshotProgramName = programName || null;
  let snapshotUniversityName = universityName || null;
  let snapshotCountry = country || null;
  let snapshotLevel: string | null = level || null;
  let snapshotLanguage: string | null = instructionLanguage || null;
  let snapshotUniversityId = universityId || null;
  let isStateUniversity = false;

  if (programId) {
    const [prog] = await db.select().from(programsTable).where(eq(programsTable.id, parseInt(String(programId), 10)));
    if (prog) {
      snapshotTuitionFee = snapshotTuitionFee ?? prog.tuitionFee ?? null;
      snapshotDiscountedFee = (prog.discountedFee != null && !isNaN(Number(prog.discountedFee))) ? Number(prog.discountedFee) : null;
      snapshotScholarship = snapshotScholarship ?? prog.scholarship ?? null;
      snapshotCommissionRate = prog.commissionRate ?? null;
      snapshotServiceFeeAmount = prog.serviceFeeAmount ?? null;
      snapshotApplicationFee = prog.applicationFee ?? null;
      snapshotDepositFee = prog.depositFee ?? null;
      snapshotAdvancedFee = prog.advancedFee ?? null;
      snapshotLanguageFee = prog.languageFee ?? null;
      snapshotCurrency = prog.currency || "USD";
      snapshotProgramName = snapshotProgramName || prog.name;
      snapshotLevel = snapshotLevel || prog.degree || null;
      snapshotLanguage = snapshotLanguage || prog.language || null;
      snapshotUniversityId = snapshotUniversityId || prog.universityId;

      if (prog.universityId) {
        const [uni] = await db.select().from(universitiesTable).where(eq(universitiesTable.id, prog.universityId));
        if (uni) {
          snapshotUniversityName = snapshotUniversityName || uni.name;
          snapshotCountry = snapshotCountry || uni.country || null;
          isStateUniversity = uni.universityType === "state";
        }
      }
    }
  }

  const [app] = await db.insert(applicationsTable).values({
    studentId, stage,
    season: season || currentYear,
    universityId: snapshotUniversityId || null,
    programId: programId || null,
    agentId: resolvedAgentId,
    universityName: snapshotUniversityName,
    country: snapshotCountry,
    programName: snapshotProgramName,
    intake: intake || null,
    level: snapshotLevel,
    instructionLanguage: snapshotLanguage,
    deadline: deadline || null,
    tuitionFee: snapshotTuitionFee,
    discountedFee: snapshotDiscountedFee,
    scholarship: snapshotScholarship,
    commissionRate: snapshotCommissionRate,
    serviceFeeAmount: snapshotServiceFeeAmount,
    applicationFee: snapshotApplicationFee,
    depositFee: snapshotDepositFee,
    advancedFee: snapshotAdvancedFee,
    languageFee: snapshotLanguageFee,
    currency: snapshotCurrency,
    notes: notes || null,
  }).returning();

  const commissionBaseFee = (snapshotDiscountedFee != null && !isNaN(snapshotDiscountedFee))
    ? snapshotDiscountedFee
    : snapshotTuitionFee;

  const commFinStatus = getCommissionFinanceStatus(stage);
  if (commFinStatus !== "excluded") {
    const existingComm = await db.select({ id: commissionsTable.id }).from(commissionsTable).where(eq(commissionsTable.applicationId, app.id));
    if (existingComm.length === 0) {
      const uCommAmount = commissionBaseFee && snapshotCommissionRate
        ? (commissionBaseFee * snapshotCommissionRate) / 100 : 0;
      const agentComm = await resolveAgentCommission(resolvedAgentId, uCommAmount);
      await db.insert(commissionsTable).values({
        applicationId: app.id,
        studentId: parseInt(studentId, 10),
        agentId: agentComm.agentId,
        studentName: studentFullName,
        universityName: snapshotUniversityName,
        programName: snapshotProgramName,
        isStateUniversity: isStateUniversity,
        season: season || currentYear,
        currency: snapshotCurrency,
        status: commFinStatus,
        programFee: commissionBaseFee ? String(commissionBaseFee) : null,
        universityCommissionRate: snapshotCommissionRate ? String(snapshotCommissionRate) : null,
        universityCommissionAmount: uCommAmount > 0 ? String(uCommAmount) : null,
        agentCommissionRate: agentComm.agentCommissionRate,
        agentCommissionAmount: agentComm.agentCommissionAmount,
        subAgentId: agentComm.subAgentId,
        subAgentCommissionRate: agentComm.subAgentCommissionRate,
        subAgentCommissionAmount: agentComm.subAgentCommissionAmount,
      });
    }
  }

  const sfFinStatus = getServiceFeeFinanceStatus(stage);
  if (sfFinStatus !== "excluded") {
    const existingSF = await db.select({ id: serviceFeesTable.id }).from(serviceFeesTable).where(eq(serviceFeesTable.applicationId, app.id));
    if (existingSF.length === 0) {
      const sfTotal = snapshotServiceFeeAmount ? String(snapshotServiceFeeAmount) : "0";
      const sfHalf = snapshotServiceFeeAmount ? String(snapshotServiceFeeAmount / 2) : null;
      await db.insert(serviceFeesTable).values({
        applicationId: app.id,
        studentId: parseInt(studentId, 10),
        agentId: resolvedAgentId,
        studentName: studentFullName,
        universityName: snapshotUniversityName,
        isStateUniversity: isStateUniversity,
        season: season || currentYear,
        currency: snapshotCurrency,
        totalAmount: sfTotal,
        firstInstallmentAmount: sfHalf,
        secondInstallmentAmount: sfHalf,
        financeStatus: sfFinStatus,
        status: "pending",
      });
    }
  }

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
    .where(and(eq(applicationsTable.id, id), isNull(applicationsTable.deletedAt)));
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
  const [app] = await db.update(applicationsTable).set(updates).where(and(eq(applicationsTable.id, id), isNull(applicationsTable.deletedAt))).returning();
  if (!app) { res.status(404).json({ error: "Application not found" }); return; }

  if (updates.stage !== undefined) {
    const newStage = updates.stage as string;
    const commStatus = getCommissionFinanceStatus(newStage);
    const sfStatus = getServiceFeeFinanceStatus(newStage);

    const toNum = (v: any) => parseFloat(String(v ?? 0)) || 0;

    const existingComms = await db.select().from(commissionsTable).where(eq(commissionsTable.applicationId, id));
    if (existingComms.length === 0 && commStatus !== "excluded") {
      const [studentRec] = await db.select({ firstName: studentsTable.firstName, lastName: studentsTable.lastName }).from(studentsTable).where(eq(studentsTable.id, app.studentId));
      const sName = studentRec ? `${studentRec.firstName || ""} ${studentRec.lastName || ""}`.trim() : null;
      const baseFee = (app.discountedFee != null && !isNaN(app.discountedFee))
        ? app.discountedFee : app.tuitionFee;
      const uCommAmt = baseFee && app.commissionRate ? (baseFee * app.commissionRate) / 100 : 0;
      const agentComm = await resolveAgentCommission(app.agentId, uCommAmt);
      await db.insert(commissionsTable).values({
        applicationId: id, studentId: app.studentId, agentId: agentComm.agentId,
        studentName: sName, universityName: app.universityName || null,
        programName: app.programName || null, season: app.season || String(new Date().getFullYear()),
        currency: app.currency || "USD", status: commStatus,
        programFee: baseFee ? String(baseFee) : null,
        universityCommissionRate: app.commissionRate ? String(app.commissionRate) : null,
        universityCommissionAmount: uCommAmt > 0 ? String(uCommAmt) : null,
        agentCommissionRate: agentComm.agentCommissionRate,
        agentCommissionAmount: agentComm.agentCommissionAmount,
        subAgentId: agentComm.subAgentId,
        subAgentCommissionRate: agentComm.subAgentCommissionRate,
        subAgentCommissionAmount: agentComm.subAgentCommissionAmount,
        ...(commStatus === "confirmed" ? { confirmedAt: new Date().toISOString() } : {}),
      });
    }
    for (const comm of existingComms) {
      if (commStatus === "excluded") {
        if (!["collected_partial", "collected_full", "settled"].includes(comm.status)) {
          await db.update(commissionsTable).set({ status: "excluded" }).where(eq(commissionsTable.id, comm.id));
        }
      } else if (commStatus === "confirmed") {
        if (comm.status === "potential" || comm.status === "excluded") {
          await db.update(commissionsTable).set({ status: "confirmed", confirmedAt: new Date().toISOString() }).where(eq(commissionsTable.id, comm.id));
        }
      } else {
        if (comm.status === "confirmed" && toNum(comm.universityCollected) <= 0) {
          await db.update(commissionsTable).set({ status: "potential", confirmedAt: null }).where(eq(commissionsTable.id, comm.id));
        }
        if (comm.status === "excluded") {
          await db.update(commissionsTable).set({ status: "potential" }).where(eq(commissionsTable.id, comm.id));
        }
      }
    }

    const existingSFs = await db.select().from(serviceFeesTable).where(eq(serviceFeesTable.applicationId, id));
    if (existingSFs.length === 0 && sfStatus !== "excluded") {
      const [studentRec] = existingComms.length > 0 ? [null] : await db.select({ firstName: studentsTable.firstName, lastName: studentsTable.lastName }).from(studentsTable).where(eq(studentsTable.id, app.studentId));
      const sName2 = studentRec ? `${studentRec.firstName || ""} ${studentRec.lastName || ""}`.trim() : (existingComms[0]?.studentName || null);
      const sfAmt = app.serviceFeeAmount ? String(app.serviceFeeAmount) : "0";
      const sfHalf = app.serviceFeeAmount ? String(app.serviceFeeAmount / 2) : null;
      await db.insert(serviceFeesTable).values({
        applicationId: id, studentId: app.studentId, agentId: app.agentId,
        studentName: sName2, universityName: app.universityName || null,
        season: app.season || String(new Date().getFullYear()),
        currency: app.currency || "USD",
        totalAmount: sfAmt,
        firstInstallmentAmount: sfHalf,
        secondInstallmentAmount: sfHalf,
        financeStatus: sfStatus, status: "pending",
      });
    }
    for (const sf of existingSFs) {
      const hasPaid = !!sf.firstInstallmentPaidAt || !!sf.secondInstallmentPaidAt;
      if (sfStatus === "excluded") {
        if (!hasPaid) {
          await db.update(serviceFeesTable).set({ financeStatus: "excluded" }).where(eq(serviceFeesTable.id, sf.id));
        }
      } else if (sfStatus === "confirmed") {
        await db.update(serviceFeesTable).set({ financeStatus: "confirmed" }).where(eq(serviceFeesTable.id, sf.id));
      } else {
        if ((sf.financeStatus === "excluded" || sf.financeStatus === "confirmed") && !hasPaid) {
          await db.update(serviceFeesTable).set({ financeStatus: "potential" }).where(eq(serviceFeesTable.id, sf.id));
        }
      }
    }
  }

  await logAudit(req.user!.id, "update_application", "application", id, updates, req.ip);
  res.json(app);
});

router.delete("/applications/:id", requireAuth, requireRole(...STAFF_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [deleted] = await db.update(applicationsTable)
    .set({ deletedAt: new Date() })
    .where(and(eq(applicationsTable.id, id), isNull(applicationsTable.deletedAt)))
    .returning();
  if (!deleted) { res.status(404).json({ error: "Application not found" }); return; }
  await logAudit(req.user!.id, "delete_application", "application", id, {}, req.ip);
  res.sendStatus(204);
});

router.get("/applications/:id/notes", requireAuth, requireRole(...STAFF_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
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
    .where(and(eq(notesTable.resourceId, id), eq(notesTable.resourceType, "application")))
    .orderBy(desc(notesTable.createdAt))
    .limit(limitNum)
    .offset(offset);
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
