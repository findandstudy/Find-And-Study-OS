import { Router, type IRouter } from "express";
import { db, applicationsTable, notesTable, usersTable, studentsTable, agentsTable, commissionsTable, serviceFeesTable, programsTable, universitiesTable, pipelineStagesTable, applicationStageDocumentsTable, documentRequirementsTable, documentsTable } from "@workspace/db";
import { eq, sql, and, inArray, desc, isNull } from "drizzle-orm";
import { requireAuth, requireRole, requireAgentStaffPermission, logAudit } from "../lib/auth";
import { STAFF_ROLES, ADMIN_ROLES, AGENT_ROLES, isAgentRole } from "../lib/roles";
import { getAgentVisibleIds, getAgentRecord } from "../lib/agentVisibility";
import { getCommissionFinanceStatus, getServiceFeeFinanceStatus, isWonStage, getCancelledStageKey } from "../lib/stageFinance";
import { resolveAgentCommission } from "../lib/agentCommission";
import { dispatchNotification } from "../lib/notificationDispatcher";
import { inferOriginFromAgentId, inferOriginFromUser, type OriginMeta } from "../lib/originHelper";
import { findActiveCampaign, applyCampaignToFees } from "../lib/campaigns";
import { findMissingMandatoryTypes } from "@workspace/doc-equivalence";

const router: IRouter = Router();

function normalizeStudyLevel(level: string | null | undefined): string | null {
  if (!level) return null;
  const l = level.toLowerCase().replace(/[\s.-]/g, "_");
  if (["pre_bachelors", "associate", "foundation", "pre_bachelor"].some(k => l.includes(k))) return "pre_bachelors";
  if (["bachelor"].some(k => l.includes(k)) && !l.includes("pre")) return "bachelors";
  if (["master"].some(k => l.includes(k)) && !l.includes("pre")) return "masters";
  if (["phd", "ph_d", "doctorate", "doctoral"].some(k => l.includes(k))) return "phd";
  if (["language", "pathway", "other"].some(k => l.includes(k))) return "others";
  return null;
}

const DOC_REQUIRED_STAGES = [
  "app_fee_paid", "offer_received", "acceptance_letter",
  "final_acceptance", "upload_payment", "deposit_paid", "visa_approved",
  "student_card",
];

const APP_PATCH_FIELDS = [
  "stage", "universityId", "programId", "agentId", "assignedToId",
  "universityName", "country", "programName", "intake",
  "level", "instructionLanguage", "deadline",
  "tuitionFee", "discountedFee", "scholarship", "commissionRate",
  "serviceFeeAmount", "applicationFee", "depositFee", "advancedFee",
  "languageFee", "currency", "notes", "season",
];

async function autoCancelSiblingApplications(wonAppId: number, studentId: number) {
  const cancelledKey = await getCancelledStageKey();
  const cancelledCommStatus = await getCommissionFinanceStatus(cancelledKey);
  const cancelledSfStatus = await getServiceFeeFinanceStatus(cancelledKey);

  const siblings = await db.select().from(applicationsTable)
    .where(and(eq(applicationsTable.studentId, studentId), sql`${applicationsTable.id} != ${wonAppId}`));

  for (const sib of siblings) {
    const sibWon = await isWonStage(sib.stage);
    if (sibWon) continue;
    const alreadyCancelled = sib.stage === cancelledKey;
    if (alreadyCancelled) continue;

    await db.update(applicationsTable).set({ stage: cancelledKey }).where(eq(applicationsTable.id, sib.id));

    const existingComms = await db.select().from(commissionsTable).where(eq(commissionsTable.applicationId, sib.id));
    for (const comm of existingComms) {
      if (cancelledCommStatus === "excluded" && !["collected_partial", "collected_full", "settled"].includes(comm.status)) {
        await db.update(commissionsTable).set({ status: "excluded" }).where(eq(commissionsTable.id, comm.id));
      }
    }

    const existingSFs = await db.select().from(serviceFeesTable).where(eq(serviceFeesTable.applicationId, sib.id));
    for (const sf of existingSFs) {
      const hasPaid = !!sf.firstInstallmentPaidAt || !!sf.secondInstallmentPaidAt;
      if (cancelledSfStatus === "excluded" && !hasPaid) {
        await db.update(serviceFeesTable).set({ financeStatus: "excluded" }).where(eq(serviceFeesTable.id, sf.id));
      }
    }
  }
}

router.get("/applications", requireAuth, requireAgentStaffPermission("applications"), async (req, res): Promise<void> => {
  const { studentId, agentId, stage, season, page = "1", limit = "20", originType: originFilter } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(500, Math.max(1, parseInt(limit, 10)));
  const offset = (pageNum - 1) * limitNum;

  const user = req.user!;
  const isStaff = STAFF_ROLES.includes(user.role as any);

  const conditions = [isNull(applicationsTable.deletedAt)];

  if (season) conditions.push(eq(applicationsTable.season, season));
  if (originFilter && ["direct", "agent", "sub_agent"].includes(originFilter)) {
    conditions.push(eq(applicationsTable.originType, originFilter));
  }

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
  } else if (isAgentRole(user.role)) {
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
      assignedToId: applicationsTable.assignedToId,
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
      agentCommissionAmount: commissionsTable.agentCommissionAmount,
      universityType: universitiesTable.universityType,
      agentName: agentsTable.companyName,
    })
    .from(applicationsTable)
    .leftJoin(studentsTable, eq(applicationsTable.studentId, studentsTable.id))
    .leftJoin(commissionsTable, eq(applicationsTable.id, commissionsTable.applicationId))
    .leftJoin(universitiesTable, eq(applicationsTable.universityId, universitiesTable.id))
    .leftJoin(agentsTable, eq(applicationsTable.agentId, agentsTable.id))
    .where(whereClause)
    .limit(limitNum)
    .offset(offset)
    .orderBy(desc(applicationsTable.updatedAt), desc(applicationsTable.createdAt));

  const isAgentUser = req.user && isAgentRole(req.user.role);
  const mappedRows = rows.map(r => {
    const { agentCommissionAmount, ...rest } = r;
    if (isAgentUser) {
      return { ...rest, commissionAmount: agentCommissionAmount };
    }
    return rest;
  });

  res.json({
    data: mappedRows,
    meta: {
      total: Number(count),
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(Number(count) / limitNum),
    },
  });
});

router.get("/applications/doc-required-stages", requireAuth, (_req, res) => {
  res.json(DOC_REQUIRED_STAGES);
});

router.post("/applications", requireAuth, requireRole(...STAFF_ROLES, ...AGENT_ROLES), requireAgentStaffPermission("applications"), async (req, res): Promise<void> => {
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
  if (isAgentRole(user.role)) {
    const [agentRec, visibleIds] = await Promise.all([
      getAgentRecord(user.id, user.role),
      getAgentVisibleIds(user.id, user.role),
    ]);
    if (!agentRec) {
      res.status(403).json({ error: "No agent record found" });
      return;
    }
    resolvedAgentId = agentRec.id;
    const [studentRec] = await db.select({ agentId: studentsTable.agentId }).from(studentsTable).where(eq(studentsTable.id, parseInt(studentId, 10)));
    if (!studentRec || !visibleIds.includes(studentRec.agentId!)) {
      res.status(403).json({ error: "Student not in your scope" });
      return;
    }
  }
  const [studentFull] = await db.select().from(studentsTable).where(eq(studentsTable.id, parseInt(studentId, 10)));
  if (!studentFull) {
    res.status(404).json({ error: "Student not found" });
    return;
  }
  const missingFields: string[] = [];
  if (!studentFull.firstName) missingFields.push("firstName");
  if (!studentFull.lastName) missingFields.push("lastName");
  if (!studentFull.email) missingFields.push("email");
  if (!studentFull.phone) missingFields.push("phone");
  if (!studentFull.nationality) missingFields.push("nationality");
  if (!studentFull.passportNumber) missingFields.push("passportNumber");
  if (missingFields.length > 0) {
    res.status(422).json({
      error: "Student is missing required information for application creation",
      missingFields,
    });
    return;
  }
  const studentRec2 = studentFull;
  const studentFullName = `${studentRec2.firstName || ""} ${studentRec2.lastName || ""}`.trim();

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
      const eligibilityErrors: string[] = [];
      if (prog.minGpa != null) {
        const studentGpaNum = parseFloat(studentFull.gpa || "");
        if (isNaN(studentGpaNum)) {
          eligibilityErrors.push(`Program requires minimum GPA of ${prog.minGpa}, but student has no GPA recorded`);
        } else if (studentGpaNum < prog.minGpa) {
          eligibilityErrors.push(`Student GPA (${studentGpaNum}) is below the minimum required (${prog.minGpa})`);
        }
      }
      if (prog.minLanguageScore != null) {
        const studentLangNum = parseFloat(studentFull.languageScore || "");
        if (isNaN(studentLangNum)) {
          eligibilityErrors.push(`Program requires minimum language score of ${prog.minLanguageScore}, but student has no language score recorded`);
        } else if (studentLangNum < prog.minLanguageScore) {
          eligibilityErrors.push(`Student language score (${studentLangNum}) is below the minimum required (${prog.minLanguageScore})`);
        }
      }
      if (eligibilityErrors.length > 0) {
        res.status(422).json({
          error: "Student does not meet program eligibility requirements",
          eligibilityErrors,
          code: "ELIGIBILITY_FAILED",
        });
        return;
      }

      if (prog.quota != null) {
        const wonStages = await db.select({ key: pipelineStagesTable.key })
          .from(pipelineStagesTable)
          .where(and(eq(pipelineStagesTable.entityType, "application"), eq(pipelineStagesTable.variant, "won")));
        const wonKeys = wonStages.map(s => s.key);
        if (wonKeys.length > 0) {
          const currentYear = String(new Date().getFullYear());
          const [{ cnt }] = await db.select({ cnt: sql<number>`count(*)` })
            .from(applicationsTable)
            .where(and(
              eq(applicationsTable.programId, prog.id),
              eq(applicationsTable.season, season || currentYear),
              inArray(applicationsTable.stage, wonKeys),
              isNull(applicationsTable.deletedAt),
            ));
          if (Number(cnt) >= prog.quota) {
            res.status(422).json({
              error: `Program quota is full for this year (${prog.quota}/${prog.quota} enrolled)`,
              code: "QUOTA_FULL",
            });
            return;
          }
        }
      }

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

  // -------- Campaign price adjustment --------
  // If an active campaign matches this program's university and (when set)
  // the agent's country, apply its percentage to all snapshotted fees.
  // The result becomes the on-record price, so commission and service-fee
  // math automatically inherits the campaign price.
  let appliedCampaignId: number | null = null;
  let appliedCampaignName: string | null = null;
  let appliedCampaignType: string | null = null;
  let appliedCampaignPercent: number | null = null;
  if (snapshotUniversityId) {
    let campaignAgentCountry: string | null = null;
    if (resolvedAgentId) {
      const [ag] = await db.select({ country: agentsTable.country }).from(agentsTable).where(eq(agentsTable.id, resolvedAgentId));
      campaignAgentCountry = ag?.country || null;
    }
    const campaign = await findActiveCampaign(snapshotUniversityId, campaignAgentCountry);
    if (campaign) {
      const adjusted = applyCampaignToFees({
        tuitionFee: snapshotTuitionFee,
        discountedFee: snapshotDiscountedFee,
        serviceFeeAmount: snapshotServiceFeeAmount,
        applicationFee: snapshotApplicationFee,
        depositFee: snapshotDepositFee,
        advancedFee: snapshotAdvancedFee,
        languageFee: snapshotLanguageFee,
      }, campaign);
      snapshotTuitionFee = adjusted.tuitionFee ?? null;
      snapshotDiscountedFee = adjusted.discountedFee ?? null;
      snapshotServiceFeeAmount = adjusted.serviceFeeAmount ?? null;
      snapshotApplicationFee = adjusted.applicationFee ?? null;
      snapshotDepositFee = adjusted.depositFee ?? null;
      snapshotAdvancedFee = adjusted.advancedFee ?? null;
      snapshotLanguageFee = adjusted.languageFee ?? null;
      appliedCampaignId = campaign.id;
      appliedCampaignName = campaign.name;
      appliedCampaignType = campaign.changeType;
      appliedCampaignPercent = Number(campaign.changePercent);
    }
  }
  // ------------------------------------------

  // studentFull already contains origin fields — no extra query needed
  const origin: OriginMeta = studentFull.originType
    ? { originType: studentFull.originType as any, originEntityType: studentFull.originEntityType, originEntityId: studentFull.originEntityId, originDisplayName: studentFull.originDisplayName }
    : await inferOriginFromUser(user);

  const [app] = await db.insert(applicationsTable).values({
    studentId, stage,
    season: season || currentYear,
    universityId: snapshotUniversityId || null,
    programId: programId || null,
    agentId: resolvedAgentId,
    assignedToId: studentRec2?.assignedToId || null,
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
    campaignId: appliedCampaignId,
    campaignName: appliedCampaignName,
    campaignType: appliedCampaignType,
    campaignPercent: appliedCampaignPercent,
    ...origin,
    originStudentId: parseInt(studentId, 10),
  }).returning();

  const commissionBaseFee = (snapshotDiscountedFee != null && !isNaN(snapshotDiscountedFee))
    ? snapshotDiscountedFee
    : snapshotTuitionFee;

  // Commission, service fee, and student status are independent — run in parallel.
  await Promise.all([
    // Chain 1: commission record
    (async () => {
      const commFinStatus = await getCommissionFinanceStatus(stage);
      if (commFinStatus === "excluded") return;
      const existingComm = await db.select({ id: commissionsTable.id }).from(commissionsTable).where(eq(commissionsTable.applicationId, app.id));
      if (existingComm.length > 0) return;
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
    })(),

    // Chain 2: service fee record
    (async () => {
      const sfFinStatus = await getServiceFeeFinanceStatus(stage);
      if (sfFinStatus === "excluded") return;
      const existingSF = await db.select({ id: serviceFeesTable.id }).from(serviceFeesTable).where(eq(serviceFeesTable.applicationId, app.id));
      if (existingSF.length > 0) return;
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
    })(),

    // Chain 3: student status update (best-effort — never throws)
    (async () => {
      try {
        const [appMadeStage] = await db.select({ key: pipelineStagesTable.key })
          .from(pipelineStagesTable)
          .where(and(eq(pipelineStagesTable.entityType, "student"), eq(pipelineStagesTable.variant, "won")));
        if (appMadeStage) {
          const [stu] = await db.select({ status: studentsTable.status }).from(studentsTable).where(eq(studentsTable.id, parseInt(studentId, 10)));
          if (stu && (stu.status === "active" || stu.status === "inactive")) {
            await db.update(studentsTable).set({ status: appMadeStage.key }).where(eq(studentsTable.id, parseInt(studentId, 10)));
          }
        }
      } catch {}
    })(),
  ]);

  await logAudit(req.user!.id, "create_application", "application", app.id, { studentId }, req.ip);

  dispatchNotification({
    actorUserId: req.user!.id,
    event: "application.created",
    title: "New Application Created",
    body: `A new application has been created for ${studentFullName || "a student"} — ${snapshotUniversityName || "University"} / ${snapshotProgramName || "Program"}.`,
    actionUrl: `/staff/applications/${app.id}`,
    icon: "FileText",
    templateVars: { studentName: studentFullName || "", universityName: snapshotUniversityName || "", programName: snapshotProgramName || "" },
  }).catch(() => {});

  res.status(201).json(app);
});

router.get("/applications/:id", requireAuth, requireAgentStaffPermission("applications"), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [row] = await db
    .select({
      id: applicationsTable.id,
      studentId: applicationsTable.studentId,
      programId: applicationsTable.programId,
      universityId: applicationsTable.universityId,
      agentId: applicationsTable.agentId,
      assignedToId: applicationsTable.assignedToId,
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
      agentCommissionAmount: commissionsTable.agentCommissionAmount,
      commissionStatus: commissionsTable.status,
    })
    .from(applicationsTable)
    .leftJoin(studentsTable, eq(applicationsTable.studentId, studentsTable.id))
    .leftJoin(commissionsTable, eq(applicationsTable.id, commissionsTable.applicationId))
    .where(and(eq(applicationsTable.id, id), isNull(applicationsTable.deletedAt)));
  if (!row) { res.status(404).json({ error: "Application not found" }); return; }

  const user = req.user!;
  const isStaff = STAFF_ROLES.includes(user.role as any);
  if (isAgentRole(user.role)) {
    (row as any).commissionAmount = row.agentCommissionAmount;
  }
  delete (row as any).agentCommissionAmount;
  if (!isStaff) {
    if (user.role === "student") {
      const [studentRec] = await db.select().from(studentsTable).where(eq(studentsTable.userId, user.id));
      if (!studentRec || studentRec.id !== row.studentId) {
        res.status(403).json({ error: "Access denied" }); return;
      }
    } else if (isAgentRole(user.role)) {
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

router.patch("/applications/:id", requireAuth, requireRole(...STAFF_ROLES, ...AGENT_ROLES), requireAgentStaffPermission("applications"), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const user = req.user!;
  const isStaff = STAFF_ROLES.includes(user.role as any);

  const isAdmin = (ADMIN_ROLES as readonly string[]).includes(user.role);
  const AGENT_PATCH_FIELDS: string[] = [];
  let allowedFields = isStaff ? [...APP_PATCH_FIELDS] : [...AGENT_PATCH_FIELDS];
  if (user.role !== "super_admin" && isStaff) {
    allowedFields = allowedFields.filter(f => f !== "stage");
  }

  if (isStaff && !isAdmin && req.body.assignedToId !== undefined) {
    const [existing] = await db.select({ assignedToId: applicationsTable.assignedToId }).from(applicationsTable).where(and(eq(applicationsTable.id, id), isNull(applicationsTable.deletedAt)));
    if (!existing) { res.status(404).json({ error: "Application not found" }); return; }
    if (existing.assignedToId !== null) {
      allowedFields = allowedFields.filter(f => f !== "assignedToId");
    } else if (req.body.assignedToId !== user.id) {
      allowedFields = allowedFields.filter(f => f !== "assignedToId");
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

  if (updates.stage && DOC_REQUIRED_STAGES.includes(updates.stage as string)) {
    const targetStage = updates.stage as string;
    const existingDocs = await db.select({ id: applicationStageDocumentsTable.id })
      .from(applicationStageDocumentsTable)
      .where(and(
        eq(applicationStageDocumentsTable.applicationId, id),
        eq(applicationStageDocumentsTable.stage, targetStage),
        eq(applicationStageDocumentsTable.isMissingDocNote, false),
      ));
    if (existingDocs.length === 0) {
      res.status(422).json({
        error: "Required documents must be uploaded before moving to this stage",
        code: "DOCS_REQUIRED",
        requiredStage: targetStage,
      });
      return;
    }
  }

  if (updates.stage === "documents_collected") {
    const [currentApp] = await db.select({
      level: applicationsTable.level,
      studentId: applicationsTable.studentId,
    }).from(applicationsTable).where(and(eq(applicationsTable.id, id), isNull(applicationsTable.deletedAt)));

    const normalizedLevel = normalizeStudyLevel(currentApp?.level);
    if (normalizedLevel && currentApp?.studentId) {
      const [mandatoryReqs, studentDocs] = await Promise.all([
        db.select({ documentType: documentRequirementsTable.documentType })
          .from(documentRequirementsTable)
          .where(and(
            eq(documentRequirementsTable.level, normalizedLevel),
            eq(documentRequirementsTable.enabled, true),
            eq(documentRequirementsTable.mandatory, true),
          )),
        db.select({ type: documentsTable.type })
          .from(documentsTable)
          .where(eq(documentsTable.studentId, currentApp.studentId)),
      ]);

      const uploadedTypes = new Set<string>(studentDocs.map((d: { type: string | null }) => (d.type || "").toLowerCase()));
      // Use the doc-type equivalence map so a document uploaded under any
      // equivalent name (e.g. "hs_diploma" apply key OR
      // "class_12th_hsc_certificate" canonical type) satisfies the
      // mandatory canonical requirement.
      const missingDocTypes = findMissingMandatoryTypes(
        mandatoryReqs.map(r => r.documentType),
        uploadedTypes,
      );

      if (missingDocTypes.length > 0) {
        res.status(422).json({
          error: "Mandatory student documents are missing for this application level",
          code: "STUDENT_DOCS_REQUIRED",
          missingDocTypes,
        });
        return;
      }
    }
  }

  const [preUpdateApp] = await db.select({ assignedToId: applicationsTable.assignedToId, agentId: applicationsTable.agentId }).from(applicationsTable).where(and(eq(applicationsTable.id, id), isNull(applicationsTable.deletedAt)));

  const conditions = [eq(applicationsTable.id, id), isNull(applicationsTable.deletedAt)];
  if (!isStaff) {
    const visibleIds = await getAgentVisibleIds(user.id, user.role);
    if (visibleIds.length === 0) { res.status(403).json({ error: "No agent record found" }); return; }
    conditions.push(inArray(applicationsTable.agentId, visibleIds));
  }

  const [app] = await db.update(applicationsTable).set(updates).where(and(...conditions)).returning();
  if (!app) { res.status(404).json({ error: "Application not found" }); return; }

  if (updates.stage !== undefined) {
    const newStage = updates.stage as string;
    const commStatus = await getCommissionFinanceStatus(newStage);
    const sfStatus = await getServiceFeeFinanceStatus(newStage);

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

  if (updates.stage !== undefined) {
    const wonNow = await isWonStage(String(updates.stage));
    if (wonNow) {
      await autoCancelSiblingApplications(id, app.studentId);
    }
  }

  await logAudit(req.user!.id, "update_application", "application", id, updates, req.ip);

  if (updates.stage !== undefined) {
    const stageStr = String(updates.stage);
    const [studentRec3] = await db.select({ firstName: studentsTable.firstName, lastName: studentsTable.lastName, userId: studentsTable.userId }).from(studentsTable).where(eq(studentsTable.id, app.studentId));
    const sName3 = studentRec3 ? `${studentRec3.firstName || ""} ${studentRec3.lastName || ""}`.trim() : "";
    const recipientIds: number[] = [];
    if (studentRec3?.userId) recipientIds.push(studentRec3.userId);
    if (app.assignedToId) recipientIds.push(app.assignedToId);

    dispatchNotification({
    actorUserId: req.user!.id,
      event: "application.stage_changed",
      title: "Application Status Changed",
      body: `Application for ${sName3 || "student"} — ${app.universityName || "University"} has moved to "${stageStr}".`,
      actionUrl: `/staff/applications/${app.id}`,
      icon: "ArrowRight",
      recipientUserIds: recipientIds.length > 0 ? recipientIds : undefined,
      templateVars: { studentName: sName3, universityName: app.universityName || "", programName: app.programName || "", newStage: stageStr },
    }).catch(() => {});
  }

  if (updates.assignedToId && preUpdateApp && updates.assignedToId !== preUpdateApp.assignedToId) {
    const [studentRec4] = await db.select({ firstName: studentsTable.firstName, lastName: studentsTable.lastName }).from(studentsTable).where(eq(studentsTable.id, app.studentId));
    const sName4 = studentRec4 ? `${studentRec4.firstName || ""} ${studentRec4.lastName || ""}`.trim() : "student";
    dispatchNotification({
    actorUserId: req.user!.id,
      event: "application.assigned",
      title: "Application Assigned to You",
      body: `Application for ${sName4} — ${app.universityName || "University"} has been assigned to you.`,
      actionUrl: `/staff/applications/${app.id}`,
      icon: "UserCheck",
      recipientUserIds: [updates.assignedToId as number],
      templateVars: { studentName: sName4, universityName: app.universityName || "", programName: app.programName || "" },
    }).catch(() => {});
  }

  if (updates.agentId !== undefined && preUpdateApp && updates.agentId !== preUpdateApp.agentId) {
    const [studentRec5] = await db.select({ firstName: studentsTable.firstName, lastName: studentsTable.lastName }).from(studentsTable).where(eq(studentsTable.id, app.studentId));
    const sName5 = studentRec5 ? `${studentRec5.firstName || ""} ${studentRec5.lastName || ""}`.trim() : "student";
    if (updates.agentId) {
      dispatchNotification({
    actorUserId: req.user!.id,
        event: "application.agent_linked",
        title: "Application Linked to Agent",
        body: `Application for ${sName5} — ${app.universityName || "University"} has been linked to an agent.`,
        actionUrl: `/staff/applications/${app.id}`,
        icon: "Building2",
        recipientUserIds: app.assignedToId ? [app.assignedToId] : undefined,
        templateVars: { studentName: sName5, universityName: app.universityName || "" },
      }).catch(() => {});
    } else {
      dispatchNotification({
    actorUserId: req.user!.id,
        event: "application.agent_unlinked",
        title: "Application Unlinked from Agent",
        body: `Application for ${sName5} — ${app.universityName || "University"} has been unlinked from their agent.`,
        actionUrl: `/staff/applications/${app.id}`,
        icon: "Unlink",
        recipientUserIds: app.assignedToId ? [app.assignedToId] : undefined,
        templateVars: { studentName: sName5, universityName: app.universityName || "" },
      }).catch(() => {});
    }
  }

  res.json(app);
});

router.post("/applications/bulk-action", requireAuth, requireRole(...ADMIN_ROLES), async (req, res): Promise<void> => {
  const { ids, action, assignedToId, stage } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: "ids required" }); return; }
  if (!["delete", "assign", "move"].includes(action)) { res.status(400).json({ error: "Invalid action" }); return; }
  const numericIds = ids.map(Number).filter((n: number) => !isNaN(n));
  let updated = 0;
  if (action === "delete") {
    const result = await db.update(applicationsTable).set({ deletedAt: new Date() }).where(and(inArray(applicationsTable.id, numericIds), isNull(applicationsTable.deletedAt)));
    updated = result.rowCount ?? numericIds.length;
    for (const id of numericIds) await logAudit(req.user!.id, "delete_application", "application", id, {}, req.ip);
  } else if (action === "assign" && assignedToId !== undefined) {
    const result = await db.update(applicationsTable).set({ assignedToId: assignedToId ? Number(assignedToId) : null }).where(and(inArray(applicationsTable.id, numericIds), isNull(applicationsTable.deletedAt)));
    updated = result.rowCount ?? numericIds.length;
    await logAudit(req.user!.id, "bulk_assign_applications", "application", null, { ids: numericIds, assignedToId }, req.ip);
  } else if (action === "move" && stage) {
    const apps = await db.select().from(applicationsTable).where(and(inArray(applicationsTable.id, numericIds), isNull(applicationsTable.deletedAt)));
    for (const app of apps) {
      await db.update(applicationsTable).set({ stage }).where(eq(applicationsTable.id, app.id));
      const commStatus = await getCommissionFinanceStatus(stage);
      const sfStatus = await getServiceFeeFinanceStatus(stage);
      const toNum = (v: any) => parseFloat(String(v ?? 0)) || 0;
      const existingComms = await db.select().from(commissionsTable).where(eq(commissionsTable.applicationId, app.id));
      if (existingComms.length === 0 && commStatus !== "excluded") {
        const [studentRec] = await db.select({ firstName: studentsTable.firstName, lastName: studentsTable.lastName }).from(studentsTable).where(eq(studentsTable.id, app.studentId));
        const sName = studentRec ? `${studentRec.firstName || ""} ${studentRec.lastName || ""}`.trim() : null;
        const baseFee = (app.discountedFee != null && !isNaN(app.discountedFee)) ? app.discountedFee : app.tuitionFee;
        const uCommAmt = baseFee && app.commissionRate ? (baseFee * app.commissionRate) / 100 : 0;
        const agentComm = await resolveAgentCommission(app.agentId, uCommAmt);
        await db.insert(commissionsTable).values({
          applicationId: app.id, studentId: app.studentId, agentId: agentComm.agentId,
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
      const existingSFs = await db.select().from(serviceFeesTable).where(eq(serviceFeesTable.applicationId, app.id));
      if (existingSFs.length === 0 && sfStatus !== "excluded") {
        const [studentRec2] = existingComms.length > 0 ? [null] : await db.select({ firstName: studentsTable.firstName, lastName: studentsTable.lastName }).from(studentsTable).where(eq(studentsTable.id, app.studentId));
        const sName2 = studentRec2 ? `${studentRec2.firstName || ""} ${studentRec2.lastName || ""}`.trim() : (existingComms[0]?.studentName || null);
        const sfAmt = app.serviceFeeAmount ? String(app.serviceFeeAmount) : "0";
        const sfHalf = app.serviceFeeAmount ? String(app.serviceFeeAmount / 2) : null;
        await db.insert(serviceFeesTable).values({
          applicationId: app.id, studentId: app.studentId, agentId: app.agentId,
          studentName: sName2, universityName: app.universityName || null,
          season: app.season || String(new Date().getFullYear()),
          currency: app.currency || "USD",
          totalAmount: sfAmt,
          firstInstallmentAmount: sfHalf, secondInstallmentAmount: sfHalf,
          financeStatus: sfStatus, status: "pending",
        });
      }
      for (const sf of existingSFs) {
        const hasPaid = !!sf.firstInstallmentPaidAt || !!sf.secondInstallmentPaidAt;
        if (sfStatus === "excluded") {
          if (!hasPaid) await db.update(serviceFeesTable).set({ financeStatus: "excluded" }).where(eq(serviceFeesTable.id, sf.id));
        } else if (sfStatus === "confirmed") {
          await db.update(serviceFeesTable).set({ financeStatus: "confirmed" }).where(eq(serviceFeesTable.id, sf.id));
        } else {
          if ((sf.financeStatus === "excluded" || sf.financeStatus === "confirmed") && !hasPaid) {
            await db.update(serviceFeesTable).set({ financeStatus: "potential" }).where(eq(serviceFeesTable.id, sf.id));
          }
        }
      }
      const wonNow = await isWonStage(stage);
      if (wonNow) {
        await autoCancelSiblingApplications(app.id, app.studentId);
      }
      await logAudit(req.user!.id, "bulk_move_application", "application", app.id, { stage }, req.ip);
      updated++;
    }
  } else {
    res.status(400).json({ error: "Missing required fields for action" }); return;
  }
  res.json({ success: true, updated });
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

router.get("/applications/:id/notes", requireAuth, requireRole(...STAFF_ROLES, ...AGENT_ROLES), requireAgentStaffPermission("applications"), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const { page = "1", limit = "50", internal } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10)));
  const offset = (pageNum - 1) * limitNum;

  const isStaff = ["super_admin", "admin", "manager", "staff"].includes(req.user!.role);
  const conditions = [eq(notesTable.resourceId, id), eq(notesTable.resourceType, "application")];

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

router.post("/applications/:id/notes", requireAuth, requireRole(...STAFF_ROLES, ...AGENT_ROLES), requireAgentStaffPermission("applications"), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const { content, isInternal } = req.body;
  if (!content?.trim()) { res.status(400).json({ error: "content is required" }); return; }

  const isStaff = ["super_admin", "admin", "manager", "staff"].includes(req.user!.role);

  const [note] = await db.insert(notesTable).values({
    content: String(content).slice(0, 5000),
    authorId: req.user!.id,
    resourceType: "application",
    resourceId: id,
    isInternal: isStaff && isInternal === true,
  }).returning();

  const [app] = await db.select({
    assignedToId: applicationsTable.assignedToId,
    agentId: applicationsTable.agentId,
    studentId: applicationsTable.studentId,
  }).from(applicationsTable).where(eq(applicationsTable.id, id));

  if (app) {
    const recipientIds: number[] = [];
    if (app.assignedToId && app.assignedToId !== req.user!.id) {
      recipientIds.push(app.assignedToId);
    }
    if (app.agentId) {
      const [agent] = await db.select({ userId: agentsTable.userId }).from(agentsTable)
        .where(eq(agentsTable.id, app.agentId));
      if (agent?.userId && agent.userId !== req.user!.id && !recipientIds.includes(agent.userId)) {
        recipientIds.push(agent.userId);
      }
    }
    if (recipientIds.length > 0) {
      dispatchNotification({
    actorUserId: req.user!.id,
        event: "note.created",
        title: "New Note Added",
        body: `A note was added to application #${id}`,
        actionUrl: `/staff/applications/${id}`,
        recipientUserIds: recipientIds,
        data: { resourceType: "application", resourceId: id },
      });
    }
  }

  res.status(201).json({ ...note, authorName: `${req.user!.firstName || ""} ${req.user!.lastName || ""}`.trim() });
});

router.patch("/applications/:id/origin", requireAuth, requireRole("super_admin", "admin"), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { originType, originEntityType, originEntityId, originDisplayName } = req.body;
  if (!originType || !["direct", "agent", "sub_agent"].includes(originType)) {
    res.status(400).json({ error: "originType must be direct, agent, or sub_agent" });
    return;
  }
  const [existing] = await db.select().from(applicationsTable).where(and(eq(applicationsTable.id, id), isNull(applicationsTable.deletedAt)));
  if (!existing) { res.status(404).json({ error: "Application not found" }); return; }

  const oldOrigin = { originType: existing.originType, originEntityType: existing.originEntityType, originEntityId: existing.originEntityId, originDisplayName: existing.originDisplayName };

  const [updated] = await db.update(applicationsTable).set({
    originType,
    originEntityType: originEntityType || null,
    originEntityId: originEntityId || null,
    originDisplayName: originDisplayName || null,
    originLocked: true,
  }).where(eq(applicationsTable.id, id)).returning();

  await logAudit(req.user!.id, "override_origin", "application", id, { old: oldOrigin, new: { originType, originEntityType, originEntityId, originDisplayName } }, req.ip);
  res.json(updated);
});

router.post("/applications/reject-unqualified", requireAuth, requireRole("super_admin"), async (req, res): Promise<void> => {
  const allApps = await db.select({
    id: applicationsTable.id,
    studentId: applicationsTable.studentId,
    programId: applicationsTable.programId,
    stage: applicationsTable.stage,
  }).from(applicationsTable).where(and(
    isNull(applicationsTable.deletedAt),
    sql`${applicationsTable.programId} IS NOT NULL`,
    sql`${applicationsTable.stage} NOT IN ('rejected', 'cancelled')`,
  ));

  const programIds = [...new Set(allApps.filter(a => a.programId).map(a => a.programId!))];
  if (programIds.length === 0) { res.json({ rejected: 0 }); return; }

  const programs = await db.select({
    id: programsTable.id,
    minGpa: programsTable.minGpa,
    minLanguageScore: programsTable.minLanguageScore,
  }).from(programsTable).where(inArray(programsTable.id, programIds));
  const progMap = new Map(programs.filter(p => p.minGpa != null || p.minLanguageScore != null).map(p => [p.id, p]));

  if (progMap.size === 0) { res.json({ rejected: 0 }); return; }

  const studentIds = [...new Set(allApps.map(a => a.studentId))];
  const students = await db.select({
    id: studentsTable.id,
    gpa: studentsTable.gpa,
    languageScore: studentsTable.languageScore,
  }).from(studentsTable).where(inArray(studentsTable.id, studentIds));
  const stuMap = new Map(students.map(s => [s.id, s]));

  let rejectedCount = 0;
  for (const app of allApps) {
    if (!app.programId) continue;
    const prog = progMap.get(app.programId);
    if (!prog) continue;
    const stu = stuMap.get(app.studentId);
    if (!stu) continue;

    let fail = false;
    if (prog.minGpa != null) {
      const gpaNum = parseFloat(stu.gpa || "");
      if (isNaN(gpaNum) || gpaNum < prog.minGpa) fail = true;
    }
    if (prog.minLanguageScore != null) {
      const langNum = parseFloat(stu.languageScore || "");
      if (isNaN(langNum) || langNum < prog.minLanguageScore) fail = true;
    }

    if (fail) {
      await db.update(applicationsTable).set({ stage: "rejected" }).where(eq(applicationsTable.id, app.id));
      rejectedCount++;
    }
  }

  await logAudit(req.user!.id, "bulk_reject_unqualified", "application", undefined, { rejectedCount }, req.ip);
  res.json({ rejected: rejectedCount });
});

export default router;
