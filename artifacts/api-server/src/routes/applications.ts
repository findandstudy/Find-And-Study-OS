import { Router, type IRouter } from "express";
import { db, applicationsTable, notesTable, usersTable, studentsTable, agentsTable, commissionsTable, serviceFeesTable, programsTable, universitiesTable, pipelineStagesTable, applicationStageDocumentsTable, programDocumentRequirementsTable, degreeDocumentRequirementsTable, catalogOptionsTable, documentsTable, settingsTable, softDelete } from "@workspace/db";
import { eq, sql, and, inArray, desc, isNull, isNotNull, ne } from "drizzle-orm";
import { normalizeGpaTo100 } from "../lib/gpaNormalize";
import { requireAuth, requireRole, requireAgentStaffPermission, logAudit } from "../lib/auth";
import { STAFF_ROLES, ADMIN_ROLES, AGENT_ROLES, isAgentRole } from "../lib/roles";
import { assertCanAccessStudent } from "../lib/studentAccess";
import { getAgentVisibleIds, getAgentRecord } from "../lib/agentVisibility";
import { isAgentSourcedAndBlockedForStaff } from "../lib/rbac/agentSourceScope";
import { getEffectivePermissionSet, canAccessAssignedRecord, userHasPermission } from "../lib/permissions";
import { cascadeApplicationAssignment } from "../lib/leadAssignment";
import { getAgencyMemberAgentIds } from "../lib/agencyStaff";
import { getVisibleBranchIds, resolveCreateBranchId, isInBranchScope } from "../lib/branchScope";
import { or as orFn } from "drizzle-orm";
import { getCommissionFinanceStatus, getServiceFeeFinanceStatus, shouldAutoCancelSiblings, getCancelledStageKey } from "../lib/stageFinance";
import { resolveAgentCommission } from "../lib/agentCommission";
import { dispatchNotification } from "../lib/notificationDispatcher";
import { inferOriginFromAgentId, inferOriginFromUser, type OriginMeta } from "../lib/originHelper";
import { findActiveCampaign, applyCampaignToFees } from "../lib/campaigns";
import { parsePaginationParams, buildPageMeta } from "@workspace/pagination";
import { findMissingMandatoryTypes } from "@workspace/doc-equivalence";
import { getCurrentSeason } from "../lib/season";
import { maybeEnqueuePortalSubmission } from "../lib/portalAutoTrigger.js";

const router: IRouter = Router();

async function isStageFileUploadMandatory(stageKey: string): Promise<boolean> {
  const [row] = await db.select({ isFileUploadMandatory: pipelineStagesTable.isFileUploadMandatory })
    .from(pipelineStagesTable)
    .where(and(
      eq(pipelineStagesTable.entityType, "application"),
      eq(pipelineStagesTable.key, stageKey),
    ));
  return !!row?.isFileUploadMandatory;
}

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
    const sibTriggers = await shouldAutoCancelSiblings(sib.stage);
    if (sibTriggers) continue;
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
  const { studentId, agentId, stage, season, originType: originFilter } = req.query as Record<string, string>;
  const pageParams = parsePaginationParams(req, { defaultLimit: 20, maxLimit: "large" });
  const pageNum = pageParams.page;
  const limitNum = pageParams.limit;
  const offset = pageParams.offset;

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
    // Non-admin staff: only see applications assigned to them or unassigned
    // (mirrors the leads / students lists). Admins see everything in scope.
    if (!(ADMIN_ROLES as readonly string[]).includes(user.role)) {
      // Visibility driven by records.* keys. Always see own records;
      // view_unassigned adds the unassigned pool; view_others adds
      // teammates' records. Task #128: also include applications for
      // agencies where this staff is listed as agency-assigned staff.
      const perms = await getEffectivePermissionSet({ id: user.id, role: user.role });
      // KURAL 1: non-admin staff cannot see agent-sourced applications
      // unless they have records.view_others (Task #494)
      if (!perms.has("records.view_others")) {
        conditions.push(isNull(applicationsTable.agentId));
      }
      const agencyAgentIds = await getAgencyMemberAgentIds(user.id);
      const orParts: any[] = [eq(applicationsTable.assignedToId, user.id)];
      if (perms.has("records.view_unassigned")) {
        orParts.push(isNull(applicationsTable.assignedToId));
      }
      if (perms.has("records.view_others")) {
        orParts.push(and(isNotNull(applicationsTable.assignedToId), ne(applicationsTable.assignedToId, user.id))!);
      }
      if (agencyAgentIds.length > 0) {
        orParts.push(inArray(applicationsTable.agentId, agencyAgentIds));
      }
      conditions.push(orFn(...orParts)!);
    }
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
    if (studentId) conditions.push(eq(applicationsTable.studentId, parseInt(studentId, 10)));
    if (stage) conditions.push(eq(applicationsTable.stage, stage));
  }

  // Branch scoping (super_admin: null = all). Applies to staff AND agents.
  if (user.role !== "student") {
    const visibleBranchIds = await getVisibleBranchIds(user.id, user.role);
    if (visibleBranchIds !== null) {
      if (visibleBranchIds.length === 0) {
        conditions.push(isNull(applicationsTable.branchId));
      } else {
        conditions.push(orFn(inArray(applicationsTable.branchId, visibleBranchIds), isNull(applicationsTable.branchId))!);
      }
    }
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
      studentHasPhoto: studentsTable.hasPhoto,
      commissionAmount: commissionsTable.universityCommissionAmount,
      agentCommissionAmount: commissionsTable.agentCommissionAmount,
      subAgentCommissionAmount: commissionsTable.subAgentCommissionAmount,
      universityType: universitiesTable.universityType,
      agentName: agentsTable.companyName,
      currentStageDocCount: sql<number>`(
        SELECT COUNT(*)::int
        FROM application_stage_documents
        WHERE application_id = ${applicationsTable.id}
          AND stage = ${applicationsTable.stage}
          AND (is_missing_doc_note IS NULL OR is_missing_doc_note = false)
      )`.as("current_stage_doc_count"),
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
  let isSubAgentUser = false;
  if (isAgentUser) {
    const agentRec = await getAgentRecord(req.user!.id, req.user!.role);
    isSubAgentUser = req.user!.role === "sub_agent" || !!agentRec?.parentAgentId;
  }
  const mappedRows = rows.map(r => {
    const { agentCommissionAmount, subAgentCommissionAmount, commissionAmount: uniAmt, ...rest } = r;
    const uniNum = parseFloat(String(uniAmt ?? "0")) || 0;
    const agentNum = parseFloat(String(agentCommissionAmount ?? "0")) || 0;
    const subNum = parseFloat(String(subAgentCommissionAmount ?? "0")) || 0;
    if (isAgentUser) {
      if (isSubAgentUser) {
        return { ...rest, commissionAmount: subAgentCommissionAmount };
      }
      const parentNet = agentCommissionAmount == null ? null : String(agentNum - subNum);
      return { ...rest, commissionAmount: parentNet };
    }
    const netAgency = uniAmt == null ? null : String(uniNum - agentNum);
    return { ...rest, commissionAmount: netAgency };
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

router.get("/applications/doc-required-stages", requireAuth, async (_req, res) => {
  const rows = await db.select({ key: pipelineStagesTable.key })
    .from(pipelineStagesTable)
    .where(and(
      eq(pipelineStagesTable.entityType, "application"),
      eq(pipelineStagesTable.isFileUploadMandatory, true),
    ));
  res.json(rows.map(r => r.key));
});

router.get("/applications/offer-letter-deadlines", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;

  // Super admin sees nothing per product rules.
  if (user.role === "super_admin") {
    res.json({ data: [] });
    return;
  }

  const expiryStageRows = await db.select({ key: pipelineStagesTable.key })
    .from(pipelineStagesTable)
    .where(and(
      eq(pipelineStagesTable.entityType, "application"),
      eq(pipelineStagesTable.tracksOfferExpiry, true),
    ));
  const expiryStageKeys = expiryStageRows.map(r => r.key);
  if (expiryStageKeys.length === 0) {
    res.json({ data: [] });
    return;
  }

  const isStaff = STAFF_ROLES.includes(user.role as any);

  const conditions = [
    isNull(applicationsTable.deletedAt),
    isNotNull(applicationStageDocumentsTable.validUntil),
    inArray(applicationStageDocumentsTable.stage, expiryStageKeys),
  ];

  if (user.role === "student") {
    const [studentRec] = await db.select().from(studentsTable).where(eq(studentsTable.userId, user.id));
    if (!studentRec) { res.json({ data: [] }); return; }
    conditions.push(eq(applicationsTable.studentId, studentRec.id));
  } else if (isAgentRole(user.role)) {
    const visibleIds = await getAgentVisibleIds(user.id, user.role);
    if (visibleIds.length === 0) { res.json({ data: [] }); return; }
    conditions.push(inArray(applicationsTable.agentId, visibleIds));
  } else if (!isStaff) {
    res.json({ data: [] });
    return;
  }

  const rows = await db.select({
    docId: applicationStageDocumentsTable.id,
    applicationId: applicationsTable.id,
    stage: applicationStageDocumentsTable.stage,
    fileName: applicationStageDocumentsTable.fileName,
    validUntil: applicationStageDocumentsTable.validUntil,
    studentFirstName: studentsTable.firstName,
    studentLastName: studentsTable.lastName,
    universityName: applicationsTable.universityName,
    programName: applicationsTable.programName,
  })
    .from(applicationStageDocumentsTable)
    .innerJoin(applicationsTable, eq(applicationStageDocumentsTable.applicationId, applicationsTable.id))
    .leftJoin(studentsTable, eq(applicationsTable.studentId, studentsTable.id))
    .where(and(...conditions))
    .orderBy(applicationStageDocumentsTable.validUntil);

  const now = Date.now();
  const data = rows
    .map(r => {
      const validUntil = r.validUntil ? new Date(r.validUntil) : null;
      const daysLeft = validUntil ? Math.ceil((validUntil.getTime() - now) / (1000 * 60 * 60 * 24)) : null;
      return { ...r, validUntil: validUntil?.toISOString() || null, daysLeft };
    })
    .filter(r => r.daysLeft !== null && r.daysLeft > -7)
    .slice(0, 50);

  res.json({ data });
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
  const currentYear = await getCurrentSeason();
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

  // A1 gate: block application creation when mandatory documents (program-level
  // OR degree-level) are missing for the student. Runs whenever a programId
  // OR a level is supplied — guards against applications created without a
  // photo, passport, or other degree-level required document even when no
  // specific program is selected yet.
  if (programId || level) {
    const studentIdNum = parseInt(String(studentId), 10);

    // Fetch student docs + program requirements (if programId given) + degree requirements (if level given) — all in parallel
    const [studentDocs, programReqs, degreeOptRow] = await Promise.all([
      db.select({ type: documentsTable.type })
        .from(documentsTable)
        .where(and(
          eq(documentsTable.studentId, studentIdNum),
          isNull(documentsTable.deletedAt),
        )),
      programId
        ? db.select({ documentType: programDocumentRequirementsTable.documentType })
            .from(programDocumentRequirementsTable)
            .where(and(
              eq(programDocumentRequirementsTable.programId, parseInt(String(programId), 10)),
              eq(programDocumentRequirementsTable.mandatory, true),
            ))
        : Promise.resolve([] as { documentType: string }[]),
      level
        ? db.select({ id: catalogOptionsTable.id })
            .from(catalogOptionsTable)
            .where(and(
              eq(catalogOptionsTable.category, "degree"),
              eq(catalogOptionsTable.value, String(level)),
            ))
        : Promise.resolve([] as { id: number }[]),
    ]);

    // Fetch degree-level mandatory requirements when a matching catalog option was found
    const degreeOpt = degreeOptRow[0] ?? null;
    const degreeReqs = degreeOpt
      ? await db.select({ documentType: degreeDocumentRequirementsTable.documentType })
          .from(degreeDocumentRequirementsTable)
          .where(and(
            eq(degreeDocumentRequirementsTable.catalogOptionId, degreeOpt.id),
            eq(degreeDocumentRequirementsTable.mandatory, true),
          ))
      : [];

    // Merge both requirement sets (deduplicated)
    const allMandatoryTypes = Array.from(new Set([
      ...programReqs.map(r => r.documentType),
      ...degreeReqs.map(r => r.documentType),
    ]));

    if (allMandatoryTypes.length > 0) {
      const uploadedTypes = new Set<string>(studentDocs.map((d: { type: string | null }) => (d.type || "").toLowerCase()));
      const missingDocTypes = findMissingMandatoryTypes(allMandatoryTypes, uploadedTypes);
      if (missingDocTypes.length > 0) {
        res.status(422).json({
          error: "Mandatory student documents are missing for this application",
          code: "STUDENT_DOCS_REQUIRED",
          missingDocTypes,
        });
        return;
      }
    }
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
      if (prog.minGpa != null && prog.minGpa > 0) {
        const studentGpaNum = normalizeGpaTo100(studentFull.gpa);
        if (isNaN(studentGpaNum)) {
          eligibilityErrors.push(`Program requires minimum GPA of ${prog.minGpa} (out of 100), but student has no GPA recorded`);
        } else if (studentGpaNum < prog.minGpa) {
          eligibilityErrors.push(`Student GPA (${studentGpaNum.toFixed(2)}/100) is below the minimum required (${prog.minGpa}/100)`);
        }
      }
      if (prog.minLanguageScore != null && prog.minLanguageScore > 0) {
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
          const currentYear = await getCurrentSeason();
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

  let inheritedBranchId: number | null;
  if (user.role === "super_admin") {
    inheritedBranchId = studentFull.branchId
      ?? (await resolveCreateBranchId(user.id, user.role, req.body.branchId ?? null));
  } else {
    const callerVisible = await getVisibleBranchIds(user.id, user.role);
    if (!isAgentRole(user.role) && callerVisible !== null && (callerVisible.length === 0 ||
        (studentFull.branchId != null && !callerVisible.includes(studentFull.branchId)))) {
      res.status(403).json({ error: "Student not in your branch scope" });
      return;
    }
    inheritedBranchId = studentFull.branchId
      ?? (await resolveCreateBranchId(user.id, user.role, req.body.branchId ?? null));
    if (inheritedBranchId == null && !isAgentRole(user.role)) {
      res.status(403).json({ error: "No accessible branch — cannot create application" });
      return;
    }
  }
  const [app] = await db.insert(applicationsTable).values({
    branchId: inheritedBranchId,
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
  const id = parseInt(String(req.params.id), 10);
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
      studentHasPhoto: studentsTable.hasPhoto,
      commissionAmount: commissionsTable.universityCommissionAmount,
      agentCommissionAmount: commissionsTable.agentCommissionAmount,
      subAgentCommissionAmount: commissionsTable.subAgentCommissionAmount,
      commissionStatus: commissionsTable.status,
      branchId: applicationsTable.branchId,
    })
    .from(applicationsTable)
    .leftJoin(studentsTable, eq(applicationsTable.studentId, studentsTable.id))
    .leftJoin(commissionsTable, eq(applicationsTable.id, commissionsTable.applicationId))
    .where(and(eq(applicationsTable.id, id), isNull(applicationsTable.deletedAt)));
  if (!row) { res.status(404).json({ error: "Application not found" }); return; }

  const user = req.user!;
  const isStaff = STAFF_ROLES.includes(user.role as any);
  // KURAL 1: non-admin staff cannot access agent-sourced application detail
  // unless they have records.view_others (Task #494) — within branch scope only
  if (isAgentSourcedAndBlockedForStaff(user, row.agentId)) {
    const p = await getEffectivePermissionSet({ id: user.id, role: user.role });
    if (!p.has("records.view_others")) {
      res.status(404).json({ error: "Application not found" }); return;
    }
    if (!(await isInBranchScope(user.id, user.role, row.branchId))) {
      res.status(404).json({ error: "Application not found" }); return;
    }
  }
  if (isAgentRole(user.role)) {
    const agentRec = await getAgentRecord(user.id, user.role);
    const isSubAgentUser = user.role === "sub_agent" || !!agentRec?.parentAgentId;
    const agentNum = parseFloat(String((row as any).agentCommissionAmount ?? "0")) || 0;
    const subNum = parseFloat(String((row as any).subAgentCommissionAmount ?? "0")) || 0;
    if (isSubAgentUser) {
      (row as any).commissionAmount = (row as any).subAgentCommissionAmount;
    } else {
      (row as any).commissionAmount = (row as any).agentCommissionAmount == null ? null : String(agentNum - subNum);
    }
  } else {
    const uniNum = parseFloat(String(row.commissionAmount ?? "0")) || 0;
    const agentNum = parseFloat(String(row.agentCommissionAmount ?? "0")) || 0;
    (row as any).commissionAmount = row.commissionAmount == null ? null : String(uniNum - agentNum);
  }
  delete (row as any).agentCommissionAmount;
  delete (row as any).subAgentCommissionAmount;
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
  const id = parseInt(String(req.params.id), 10);
  const user = req.user!;
  const isStaff = STAFF_ROLES.includes(user.role as any);

  const isAdmin = (ADMIN_ROLES as readonly string[]).includes(user.role);
  const perms = isAdmin || !isStaff
    ? new Set<string>()
    : await getEffectivePermissionSet({ id: user.id, role: user.role });
  const AGENT_PATCH_FIELDS: string[] = [];
  let allowedFields = isStaff ? [...APP_PATCH_FIELDS] : [...AGENT_PATCH_FIELDS];
  // Task #167 — admin-tier (super_admin/admin/manager) can always move stage.
  // Lower-tier staff and agents can move stage ONLY when the requested
  // transition matches a configured action on the application's current
  // stage AND the user passes that action's per-type permission gate
  // (governed transition). Arbitrary stage edits remain blocked.
  let stageGovernedAllowed = false;
  if (req.body.stage !== undefined) {
    const [currentApp] = await db.select({ stage: applicationsTable.stage })
      .from(applicationsTable)
      .where(and(eq(applicationsTable.id, id), isNull(applicationsTable.deletedAt)));
    if (currentApp) {
      const [stageRow] = await db.select({ actions: pipelineStagesTable.actions, uploadPermissionLevel: pipelineStagesTable.uploadPermissionLevel })
        .from(pipelineStagesTable)
        .where(and(eq(pipelineStagesTable.entityType, "application"), eq(pipelineStagesTable.key, currentApp.stage)));
      const actions = Array.isArray(stageRow?.actions) ? stageRow!.actions : [];
      const permLevel = stageRow?.uploadPermissionLevel || "none";
      const isAgent = isAgentRole(user.role);
      for (const act of actions as Array<{ type?: string; targetStageKey?: string | null }>) {
        if (!act || act.targetStageKey !== req.body.stage) continue;
        let ok = false;
        if (act.type === "upload") {
          ok = (
            (permLevel === "admin_only" && isAdmin) ||
            (permLevel === "staff_only" && isStaff) ||
            (permLevel === "staff_and_agent" && (isStaff || isAgent)) ||
            (permLevel === "everyone")
          );
        } else if (act.type === "download") {
          ok = isStaff || isAgent;
        } else if (act.type === "missing_docs") {
          ok = (
            (permLevel === "admin_only" && isAdmin) ||
            (permLevel === "staff_only" && isStaff) ||
            (permLevel === "staff_and_agent" && (isStaff || isAgent)) ||
            (permLevel === "everyone")
          );
        }
        if (ok) { stageGovernedAllowed = true; break; }
      }
    }
  }
  // Admin-tier (super_admin/admin/manager) can move stage freely as before.
  // Lower-tier staff regain stage write via the applications.change_stage
  // permission OR a governed action transition.
  if (!isAdmin && isStaff && !perms.has("applications.change_stage") && !stageGovernedAllowed) {
    allowedFields = allowedFields.filter(f => f !== "stage");
  }
  // Agents normally have no patch fields, but governed action transitions
  // need stage to be writable for them too — gated by system setting.
  if (!isStaff && isAgentRole(user.role) && stageGovernedAllowed) {
    const [settingsRow] = await db.select({ agentCanChangeStudentAppStage: settingsTable.agentCanChangeStudentAppStage }).from(settingsTable);
    if (settingsRow?.agentCanChangeStudentAppStage === true) {
      allowedFields = ["stage"];
    }
  }

  if (isStaff && !isAdmin && req.body.assignedToId !== undefined) {
    const [existingApp] = await db.select({ assignedToId: applicationsTable.assignedToId }).from(applicationsTable).where(and(eq(applicationsTable.id, id), isNull(applicationsTable.deletedAt)));
    if (!existingApp) { res.status(404).json({ error: "Application not found" }); return; }
    // Task #494: strict rule — non-admin may only change assignment when they ARE the current assignee.
    // Unassigned (null) records also 403; only admin can make the initial assignment.
    if (existingApp.assignedToId !== user.id) {
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

  if (updates.stage && (await isStageFileUploadMandatory(updates.stage as string))) {
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
      programId: applicationsTable.programId,
      studentId: applicationsTable.studentId,
    }).from(applicationsTable).where(and(eq(applicationsTable.id, id), isNull(applicationsTable.deletedAt)));

    if (currentApp?.programId && currentApp?.studentId) {
      const [mandatoryReqs, studentDocs] = await Promise.all([
        db.select({ documentType: programDocumentRequirementsTable.documentType })
          .from(programDocumentRequirementsTable)
          .where(and(
            eq(programDocumentRequirementsTable.programId, currentApp.programId),
            eq(programDocumentRequirementsTable.mandatory, true),
          )),
        db.select({ type: documentsTable.type })
          .from(documentsTable)
          .where(and(
            eq(documentsTable.studentId, currentApp.studentId),
            isNull(documentsTable.deletedAt),
          )),
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
          error: "Mandatory student documents are missing for this application's program",
          code: "STUDENT_DOCS_REQUIRED",
          missingDocTypes,
        });
        return;
      }
    }
  }

  // Task #269 — Stage document-request gating. Centralizes the document
  // request flow on the TARGET stage so it fires from EVERY stage-change
  // entry point (kanban drag, list, ApplicationDetail dropdown), not just a
  // source-stage action button. Two independent checks, only when the stage
  // actually changes:
  //   (1) Exit guard (DOCS_INCOMPLETE) — moving FORWARD out of a stage that
  //       still has unfulfilled document requests is blocked; the missing
  //       list is returned so the UI can clearly show what is outstanding.
  //   (2) Entry interceptor (DOC_SELECTION_REQUIRED) — entering a stage whose
  //       configured actions include a `missing_docs` action, when no requests
  //       have been recorded yet for this application+stage, is blocked so the
  //       UI can prompt staff to select which catalog/custom documents to
  //       request. Once selections are saved (POST .../missing-doc-notes), the
  //       retried PATCH passes this check and the move completes.
  if (updates.stage) {
    const targetStage = updates.stage as string;
    const [curRow] = await db.select({ stage: applicationsTable.stage, studentId: applicationsTable.studentId })
      .from(applicationsTable)
      .where(and(eq(applicationsTable.id, id), isNull(applicationsTable.deletedAt)));
    const currentStage = curRow?.stage;
    if (currentStage && currentStage !== targetStage) {
      const stageRowsAll = await db.select({
        key: pipelineStagesTable.key,
        sortOrder: pipelineStagesTable.sortOrder,
        actions: pipelineStagesTable.actions,
      })
        .from(pipelineStagesTable)
        .where(eq(pipelineStagesTable.entityType, "application"));
      const orderOf = new Map<string, number>();
      let targetActions: unknown[] = [];
      let currentActions: unknown[] = [];
      for (const s of stageRowsAll) {
        orderOf.set(s.key, s.sortOrder ?? 0);
        if (s.key === targetStage) targetActions = Array.isArray(s.actions) ? s.actions : [];
        if (s.key === currentStage) currentActions = Array.isArray(s.actions) ? s.actions : [];
      }
      const curOrder = orderOf.get(currentStage);
      const tgtOrder = orderOf.get(targetStage);
      const isForward = curOrder !== undefined && tgtOrder !== undefined && tgtOrder > curOrder;

      // (1) Exit guard.
      if (isForward) {
        const openReqs = await db.select({
          id: applicationStageDocumentsTable.id,
          fileName: applicationStageDocumentsTable.fileName,
          isCustom: applicationStageDocumentsTable.isCustom,
          note: applicationStageDocumentsTable.note,
          respondedAt: applicationStageDocumentsTable.respondedAt,
        })
          .from(applicationStageDocumentsTable)
          .where(and(
            eq(applicationStageDocumentsTable.applicationId, id),
            eq(applicationStageDocumentsTable.stage, currentStage),
            eq(applicationStageDocumentsTable.isMissingDocNote, true),
            isNull(applicationStageDocumentsTable.fulfilledAt),
          ));
        if (openReqs.length > 0) {
          res.status(422).json({
            error: "Bu aşamadaki belge talepleri tamamlanmadan ileri aşamaya geçilemez",
            code: "DOCS_INCOMPLETE",
            currentStage,
            missing: openReqs.map(r => ({
              id: r.id,
              documentType: r.isCustom ? null : r.fileName,
              customTitle: r.isCustom ? r.fileName : null,
              isCustom: r.isCustom,
              note: r.note,
              respondedAt: r.respondedAt,
            })),
          });
          return;
        }
      }

      // (2) Entry interceptor. The primary (new) model triggers off the
      //     TARGET stage's own `missing_docs` action. For backward
      //     compatibility with pipelines configured under the older
      //     source-stage model, also trigger when the CURRENT stage has a
      //     `missing_docs` action whose `targetStageKey` points at the stage
      //     being entered. In both cases requests are recorded against the
      //     target stage, keeping storage/checks consistent.
      type MdAction = { type?: string; requiredDocTypes?: unknown; label?: unknown; targetStageKey?: unknown };
      const mdAction =
        (targetActions as MdAction[]).find(a => a && a.type === "missing_docs")
        ?? (currentActions as MdAction[]).find(a => a && a.type === "missing_docs" && a.targetStageKey === targetStage)
        // Built-in "missing_docs" stage always triggers the document-request
        // dialog, even when no explicit missing_docs action is configured on it.
        // This matches the stage KEY, not just the action type.
        ?? (targetStage === "missing_docs" ? ({ type: "missing_docs", requiredDocTypes: [], label: null } as MdAction) : undefined);
      if (mdAction) {
        const [existingReq] = await db.select({ id: applicationStageDocumentsTable.id })
          .from(applicationStageDocumentsTable)
          .where(and(
            eq(applicationStageDocumentsTable.applicationId, id),
            eq(applicationStageDocumentsTable.stage, targetStage),
            eq(applicationStageDocumentsTable.isMissingDocNote, true),
          ))
          .limit(1);
        if (!existingReq) {
          const configuredTypes = Array.isArray(mdAction.requiredDocTypes)
            ? (mdAction.requiredDocTypes as unknown[]).filter((t): t is string => typeof t === "string")
            : [];
          // Always pre-select every configured doc type in the dialog,
          // regardless of what the student has already uploaded.  Staff can
          // deselect any they don't need.  Previously the list was filtered
          // through findMissingMandatoryTypes, which caused all checkboxes to
          // appear empty (or the dialog to be skipped entirely) when the student
          // already had matching documents on file.
          const suggestedDocTypes: string[] = configuredTypes;
          res.status(422).json({
            error: "Bu aşamaya geçmeden önce talep edilecek belgeleri seçin",
            code: "DOC_SELECTION_REQUIRED",
            requiredStage: targetStage,
            suggestedDocTypes,
            actionLabel: typeof mdAction.label === "string" ? mdAction.label : null,
          });
          return;
        }
      }
    }
  }

  const [preUpdateApp] = await db.select({ assignedToId: applicationsTable.assignedToId, agentId: applicationsTable.agentId, branchId: applicationsTable.branchId }).from(applicationsTable).where(and(eq(applicationsTable.id, id), isNull(applicationsTable.deletedAt)));

  // KURAL 1: non-admin staff cannot update agent-sourced applications
  // unless they have records.view_others (Task #494) — within branch scope only
  if (isAgentSourcedAndBlockedForStaff(user, preUpdateApp?.agentId ?? null) && !perms.has("records.view_others")) {
    res.status(404).json({ error: "Application not found" }); return;
  }
  if (perms.has("records.view_others") && !(await isInBranchScope(user.id, user.role, preUpdateApp?.branchId ?? null))) {
    res.status(404).json({ error: "Application not found" }); return;
  }

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
    const [commStatus, sfStatus] = await Promise.all([
      getCommissionFinanceStatus(newStage),
      getServiceFeeFinanceStatus(newStage),
    ]);

    const toNum = (v: any) => parseFloat(String(v ?? 0)) || 0;

    const [existingComms, existingSFs] = await Promise.all([
      db.select().from(commissionsTable).where(eq(commissionsTable.applicationId, id)),
      db.select().from(serviceFeesTable).where(eq(serviceFeesTable.applicationId, id)),
    ]);
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
        programName: app.programName || null, season: app.season || (await getCurrentSeason()),
        currency: app.currency || "USD", status: commStatus,
        programFee: baseFee ? String(baseFee) : null,
        universityCommissionRate: app.commissionRate ? String(app.commissionRate) : null,
        universityCommissionAmount: uCommAmt > 0 ? String(uCommAmt) : null,
        agentCommissionRate: agentComm.agentCommissionRate,
        agentCommissionAmount: agentComm.agentCommissionAmount,
        subAgentId: agentComm.subAgentId,
        subAgentCommissionRate: agentComm.subAgentCommissionRate,
        subAgentCommissionAmount: agentComm.subAgentCommissionAmount,
        ...(commStatus === "confirmed" ? { confirmedAt: new Date() } : {}),
      });
    }
    for (const comm of existingComms) {
      if (commStatus === "excluded") {
        if (!["collected_partial", "collected_full", "settled"].includes(comm.status)) {
          await db.update(commissionsTable).set({ status: "excluded" }).where(eq(commissionsTable.id, comm.id));
        }
      } else if (commStatus === "confirmed") {
        if (comm.status === "potential" || comm.status === "excluded") {
          await db.update(commissionsTable).set({ status: "confirmed", confirmedAt: new Date() }).where(eq(commissionsTable.id, comm.id));
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

    if (existingSFs.length === 0 && sfStatus !== "excluded") {
      const [studentRec] = existingComms.length > 0 ? [null] : await db.select({ firstName: studentsTable.firstName, lastName: studentsTable.lastName }).from(studentsTable).where(eq(studentsTable.id, app.studentId));
      const sName2 = studentRec ? `${studentRec.firstName || ""} ${studentRec.lastName || ""}`.trim() : (existingComms[0]?.studentName || null);
      const sfAmt = app.serviceFeeAmount ? String(app.serviceFeeAmount) : "0";
      const sfHalf = app.serviceFeeAmount ? String(app.serviceFeeAmount / 2) : null;
      await db.insert(serviceFeesTable).values({
        applicationId: id, studentId: app.studentId, agentId: app.agentId,
        studentName: sName2, universityName: app.universityName || null,
        season: app.season || (await getCurrentSeason()),
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
    const cancelSiblings = await shouldAutoCancelSiblings(String(updates.stage));
    if (cancelSiblings) {
      await autoCancelSiblingApplications(id, app.studentId);
    }

    // If the new application stage has a configured student stage mapping
    // (set in Settings → Pipeline Stages), propagate it to the linked
    // student's status so the student lifecycle stays in sync with the
    // application progress (e.g. enrolled → graduated).
    try {
      const [stageRow] = await db.select({ mappedStudentStageKey: pipelineStagesTable.mappedStudentStageKey })
        .from(pipelineStagesTable)
        .where(and(
          eq(pipelineStagesTable.entityType, "application"),
          eq(pipelineStagesTable.key, String(updates.stage)),
        ));
      const mapped = stageRow?.mappedStudentStageKey;
      if (mapped && app.studentId) {
        await db.update(studentsTable)
          .set({ status: mapped })
          .where(eq(studentsTable.id, app.studentId));
        console.log(`[APPLICATIONS] Stage '${updates.stage}' mapped student #${app.studentId} → status='${mapped}'`);
      }
    } catch (mapErr) {
      console.error("[APPLICATIONS] Failed to apply student stage mapping:", mapErr);
    }
  }

  await logAudit(req.user!.id, "update_application", "application", id, updates, req.ip);

  if (updates.stage !== undefined) {
    const stageStr = String(updates.stage);
    const [studentRec3] = await db.select({ firstName: studentsTable.firstName, lastName: studentsTable.lastName, userId: studentsTable.userId }).from(studentsTable).where(eq(studentsTable.id, app.studentId));
    const sName3 = studentRec3 ? `${studentRec3.firstName || ""} ${studentRec3.lastName || ""}`.trim() : "";
    const recipientIds: number[] = [];
    // When the application belongs to an agent, route the notification to the
    // agent's user account instead of the student directly — the agent is the
    // primary contact for agent-owned students and may be the only party with
    // a user account in the system.
    if (app.agentId) {
      const [agentRec3] = await db.select({ userId: agentsTable.userId }).from(agentsTable)
        .where(eq(agentsTable.id, app.agentId));
      if (agentRec3?.userId && !recipientIds.includes(agentRec3.userId)) {
        recipientIds.push(agentRec3.userId);
      }
    } else if (studentRec3?.userId) {
      recipientIds.push(studentRec3.userId);
    }
    if (app.assignedToId && !recipientIds.includes(app.assignedToId)) recipientIds.push(app.assignedToId);

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

  const appAssignmentChanged =
    Object.prototype.hasOwnProperty.call(updates, "assignedToId") &&
    preUpdateApp &&
    updates.assignedToId !== preUpdateApp.assignedToId;
  if (appAssignmentChanged) {
    const newAppAssignedToId = typeof app.assignedToId === "number" ? app.assignedToId : null;
    const canCascade = await userHasPermission({ id: req.user!.id, role: req.user!.role }, "records.cascade_assignment");
    if (canCascade) {
      await cascadeApplicationAssignment({
        applicationId: app.id,
        studentId: app.studentId,
        newAssignedToId: newAppAssignedToId,
        actorUserId: req.user!.id,
        ipAddress: req.ip,
      });
    } else if (newAppAssignedToId !== null) {
      await cascadeApplicationAssignment({
        applicationId: app.id,
        studentId: app.studentId,
        newAssignedToId: newAppAssignedToId,
        actorUserId: req.user!.id,
        ipAddress: req.ip,
        nullFillOnly: true,
      });
    }
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

  // Portal automation auto-trigger (fire-and-forget — never blocks response)
  if (updates.stage !== undefined) {
    maybeEnqueuePortalSubmission({
      applicationId: app.id,
      studentId:     app.studentId,
      newStage:      String(updates.stage),
      universityName: app.universityName ?? null,
      universityId:   app.universityId ?? null,
      actorUserId:   req.user!.id,
    }).catch((err) =>
      console.error("[portal-auto] Trigger failed for app", app.id, ":", err),
    );
  }

  res.json(app);
});

router.post("/applications/bulk-action", requireAuth, requireRole(...STAFF_ROLES), async (req, res): Promise<void> => {
  const user = req.user!;
  const isAdmin = (ADMIN_ROLES as readonly string[]).includes(user.role);
  const { ids, action, assignedToId, stage } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: "ids required" }); return; }
  if (!["delete", "assign", "move"].includes(action)) { res.status(400).json({ error: "Invalid action" }); return; }
  // Task #494: non-admin may only bulk-assign their own records; delete/move remain admin-only
  if (!isAdmin && action !== "assign") {
    res.status(403).json({ error: "Only admins can bulk delete or move applications" }); return;
  }
  const numericIds = ids.map(Number).filter((n: number) => !isNaN(n));
  let updated = 0;
  if (action === "delete") {
    const existing = await db.select({ id: applicationsTable.id }).from(applicationsTable).where(and(inArray(applicationsTable.id, numericIds), isNull(applicationsTable.deletedAt)));
    const liveIds = existing.map(r => r.id);
    updated = await softDelete(applicationsTable, liveIds, { actorUserId: user.id });
    if (liveIds.length > 0) {
      // documents lacks deletedBy; cascade soft-delete with deletedAt only.
      await db.update(documentsTable).set({ deletedAt: new Date() }).where(and(inArray(documentsTable.applicationId, liveIds), isNull(documentsTable.deletedAt)));
    }
    for (const id of liveIds) logAudit(user.id, "delete_application", "application", id, { soft: true }, req.ip);
  } else if (action === "assign" && assignedToId !== undefined) {
    const newAssignedToId = assignedToId ? Number(assignedToId) : null;
    // Non-admin: filter to only records they are the current assignee of
    let idsToUpdate = numericIds;
    let skipped = 0;
    if (!isAdmin) {
      const ownedRows = await db.select({ id: applicationsTable.id })
        .from(applicationsTable)
        .where(and(inArray(applicationsTable.id, numericIds), eq(applicationsTable.assignedToId, user.id), isNull(applicationsTable.deletedAt)));
      idsToUpdate = ownedRows.map(r => r.id);
      skipped = numericIds.length - idsToUpdate.length;
      if (idsToUpdate.length === 0) {
        res.json({ success: true, updated: 0, skipped }); return;
      }
    }
    const affectedApps = await db.select({ id: applicationsTable.id, studentId: applicationsTable.studentId })
      .from(applicationsTable)
      .where(and(inArray(applicationsTable.id, idsToUpdate), isNull(applicationsTable.deletedAt)));
    const result = await db.update(applicationsTable).set({ assignedToId: newAssignedToId }).where(and(inArray(applicationsTable.id, idsToUpdate), isNull(applicationsTable.deletedAt)));
    updated = result.rowCount ?? idsToUpdate.length;
    await logAudit(user.id, "bulk_assign_applications", "application", undefined, { ids: idsToUpdate, assignedToId }, req.ip);
    const canCascadeApps = await userHasPermission({ id: user.id, role: user.role }, "records.cascade_assignment");
    for (const a of affectedApps) {
      await cascadeApplicationAssignment({
        applicationId: a.id,
        studentId: a.studentId,
        newAssignedToId,
        actorUserId: user.id,
        ipAddress: req.ip,
        nullFillOnly: !canCascadeApps,
      });
    }
    res.json({ success: true, updated, skipped }); return;
  } else if (action === "move" && stage) {
    const allApps = await db.select().from(applicationsTable).where(and(inArray(applicationsTable.id, numericIds), isNull(applicationsTable.deletedAt)));
    // Task #269 — bulk move cannot prompt a per-application document
    // selection modal, so it instead SKIPS any application that would need
    // one (target stage has a missing_docs action with no requests yet) or
    // that has incomplete document requests on its current stage (forward
    // move). Skipped applications are reported back so the UI can surface
    // them; the rest move normally.
    const stageRowsAll = await db.select({
      key: pipelineStagesTable.key,
      sortOrder: pipelineStagesTable.sortOrder,
      actions: pipelineStagesTable.actions,
    })
      .from(pipelineStagesTable)
      .where(eq(pipelineStagesTable.entityType, "application"));
    const orderOf = new Map<string, number>();
    let targetActions: unknown[] = [];
    for (const s of stageRowsAll) {
      orderOf.set(s.key, s.sortOrder ?? 0);
      if (s.key === String(stage)) targetActions = Array.isArray(s.actions) ? s.actions : [];
    }
    const targetHasMissingDocs = (targetActions as Array<{ type?: string }>).some(a => a && a.type === "missing_docs");
    const tgtOrder = orderOf.get(String(stage));
    const bulkSkipped: Array<{ id: number; reason: string }> = [];
    const apps: typeof allApps = [];
    for (const app of allApps) {
      if (app.stage === stage) { apps.push(app); continue; }
      const curOrder = orderOf.get(app.stage);
      const isForward = curOrder !== undefined && tgtOrder !== undefined && tgtOrder > curOrder;
      if (isForward) {
        const [openReq] = await db.select({ id: applicationStageDocumentsTable.id })
          .from(applicationStageDocumentsTable)
          .where(and(
            eq(applicationStageDocumentsTable.applicationId, app.id),
            eq(applicationStageDocumentsTable.stage, app.stage),
            eq(applicationStageDocumentsTable.isMissingDocNote, true),
            isNull(applicationStageDocumentsTable.fulfilledAt),
          ))
          .limit(1);
        if (openReq) { bulkSkipped.push({ id: app.id, reason: "DOCS_INCOMPLETE" }); continue; }
      }
      if (targetHasMissingDocs) {
        const [existingReq] = await db.select({ id: applicationStageDocumentsTable.id })
          .from(applicationStageDocumentsTable)
          .where(and(
            eq(applicationStageDocumentsTable.applicationId, app.id),
            eq(applicationStageDocumentsTable.stage, String(stage)),
            eq(applicationStageDocumentsTable.isMissingDocNote, true),
          ))
          .limit(1);
        if (!existingReq) { bulkSkipped.push({ id: app.id, reason: "DOC_SELECTION_REQUIRED" }); continue; }
      }
      apps.push(app);
    }
    // Hoisted out of the per-app loop: one DB roundtrip vs N when bulk-moving.
    const fallbackSeason = await getCurrentSeason();
    for (const app of apps) {
      await db.update(applicationsTable).set({ stage }).where(eq(applicationsTable.id, app.id));
      const [commStatus, sfStatus] = await Promise.all([
        getCommissionFinanceStatus(stage),
        getServiceFeeFinanceStatus(stage),
      ]);
      const toNum = (v: any) => parseFloat(String(v ?? 0)) || 0;
      const [existingComms, existingSFs] = await Promise.all([
        db.select().from(commissionsTable).where(eq(commissionsTable.applicationId, app.id)),
        db.select().from(serviceFeesTable).where(eq(serviceFeesTable.applicationId, app.id)),
      ]);
      if (existingComms.length === 0 && commStatus !== "excluded") {
        const [studentRec] = await db.select({ firstName: studentsTable.firstName, lastName: studentsTable.lastName }).from(studentsTable).where(eq(studentsTable.id, app.studentId));
        const sName = studentRec ? `${studentRec.firstName || ""} ${studentRec.lastName || ""}`.trim() : null;
        const baseFee = (app.discountedFee != null && !isNaN(app.discountedFee)) ? app.discountedFee : app.tuitionFee;
        const uCommAmt = baseFee && app.commissionRate ? (baseFee * app.commissionRate) / 100 : 0;
        const agentComm = await resolveAgentCommission(app.agentId, uCommAmt);
        await db.insert(commissionsTable).values({
          applicationId: app.id, studentId: app.studentId, agentId: agentComm.agentId,
          studentName: sName, universityName: app.universityName || null,
          programName: app.programName || null, season: app.season || fallbackSeason,
          currency: app.currency || "USD", status: commStatus,
          programFee: baseFee ? String(baseFee) : null,
          universityCommissionRate: app.commissionRate ? String(app.commissionRate) : null,
          universityCommissionAmount: uCommAmt > 0 ? String(uCommAmt) : null,
          agentCommissionRate: agentComm.agentCommissionRate,
          agentCommissionAmount: agentComm.agentCommissionAmount,
          subAgentId: agentComm.subAgentId,
          subAgentCommissionRate: agentComm.subAgentCommissionRate,
          subAgentCommissionAmount: agentComm.subAgentCommissionAmount,
          ...(commStatus === "confirmed" ? { confirmedAt: new Date() } : {}),
        });
      }
      for (const comm of existingComms) {
        if (commStatus === "excluded") {
          if (!["collected_partial", "collected_full", "settled"].includes(comm.status)) {
            await db.update(commissionsTable).set({ status: "excluded" }).where(eq(commissionsTable.id, comm.id));
          }
        } else if (commStatus === "confirmed") {
          if (comm.status === "potential" || comm.status === "excluded") {
            await db.update(commissionsTable).set({ status: "confirmed", confirmedAt: new Date() }).where(eq(commissionsTable.id, comm.id));
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
      if (existingSFs.length === 0 && sfStatus !== "excluded") {
        const [studentRec2] = existingComms.length > 0 ? [null] : await db.select({ firstName: studentsTable.firstName, lastName: studentsTable.lastName }).from(studentsTable).where(eq(studentsTable.id, app.studentId));
        const sName2 = studentRec2 ? `${studentRec2.firstName || ""} ${studentRec2.lastName || ""}`.trim() : (existingComms[0]?.studentName || null);
        const sfAmt = app.serviceFeeAmount ? String(app.serviceFeeAmount) : "0";
        const sfHalf = app.serviceFeeAmount ? String(app.serviceFeeAmount / 2) : null;
        await db.insert(serviceFeesTable).values({
          applicationId: app.id, studentId: app.studentId, agentId: app.agentId,
          studentName: sName2, universityName: app.universityName || null,
          season: app.season || fallbackSeason,
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
      const cancelSiblings = await shouldAutoCancelSiblings(stage);
      if (cancelSiblings) {
        await autoCancelSiblingApplications(app.id, app.studentId);
      }

      // Apply student-stage mapping for the new stage to keep the linked
      // student's status in sync with the application progress (mirrors
      // the per-app PATCH behaviour above).
      try {
        const [stageRow] = await db.select({ mappedStudentStageKey: pipelineStagesTable.mappedStudentStageKey })
          .from(pipelineStagesTable)
          .where(and(
            eq(pipelineStagesTable.entityType, "application"),
            eq(pipelineStagesTable.key, String(stage)),
          ));
        const mapped = stageRow?.mappedStudentStageKey;
        if (mapped && app.studentId) {
          await db.update(studentsTable)
            .set({ status: mapped })
            .where(eq(studentsTable.id, app.studentId));
        }
      } catch (mapErr) {
        console.error("[APPLICATIONS] Bulk-move student stage mapping failed:", mapErr);
      }

      await logAudit(req.user!.id, "bulk_move_application", "application", app.id, { stage }, req.ip);
      updated++;
    }
    if (bulkSkipped.length > 0) {
      res.json({ success: true, updated, skipped: bulkSkipped });
      return;
    }
  } else {
    res.status(400).json({ error: "Missing required fields for action" }); return;
  }
  res.json({ success: true, updated });
});

router.delete("/applications/:id", requireAuth, requireRole(...STAFF_ROLES), requireAgentStaffPermission("applications"), async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  const [existing] = await db
    .select({ id: applicationsTable.id, studentId: applicationsTable.studentId, agentId: applicationsTable.agentId })
    .from(applicationsTable)
    .where(and(eq(applicationsTable.id, id), isNull(applicationsTable.deletedAt)));
  if (!existing) { res.status(404).json({ error: "Application not found" }); return; }
  // KURAL 1: non-admin staff cannot delete agent-sourced applications
  if (isAgentSourcedAndBlockedForStaff(req.user!, existing.agentId)) {
    res.status(404).json({ error: "Application not found" }); return;
  }
  if (existing.studentId) {
    const access = await assertCanAccessStudent(req, existing.studentId);
    if (!access.ok) { res.status(access.status).json({ error: access.error }); return; }
  }
  // Soft-delete the application; cascade soft-delete on documents (which has
  // its own deletedAt). Notes and application_stage_documents are hidden via
  // the parent.deletedAt filter on listing endpoints (no orphan exposure).
  await db.transaction(async (tx) => {
    await softDelete(applicationsTable, [id], { actorUserId: req.user!.id, tx });
    await tx.update(documentsTable)
      .set({ deletedAt: sql`now()` })
      .where(and(eq(documentsTable.applicationId, id), isNull(documentsTable.deletedAt)));
  });
  await logAudit(req.user!.id, "delete_application", "application", id, { soft: true }, req.ip);
  res.sendStatus(204);
});

// Hard-delete (purge) — super_admin only. Permanently removes the row and all
// child rows. Use only when retention is no longer required.
router.post("/applications/:id/purge", requireAuth, requireRole("super_admin"), async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.transaction(async (tx) => {
    await tx.delete(notesTable).where(and(eq(notesTable.resourceId, id), eq(notesTable.resourceType, "application")));
    await tx.delete(documentsTable).where(eq(documentsTable.applicationId, id));
    await tx.delete(applicationStageDocumentsTable).where(eq(applicationStageDocumentsTable.applicationId, id));
    await tx.delete(applicationsTable).where(eq(applicationsTable.id, id));
  });
  await logAudit(req.user!.id, "purge_application", "application", id, { hard: true }, req.ip);
  res.json({ success: true });
});

router.get("/applications/:id/notes", requireAuth, requireRole(...STAFF_ROLES, ...AGENT_ROLES), requireAgentStaffPermission("applications"), async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  const { page = "1", limit = "50", internal } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10)));
  const offset = (pageNum - 1) * limitNum;

  // KURAL 1: non-admin staff cannot access notes of agent-sourced applications
  // unless they have records.view_others (Task #494) — within branch scope only
  const [noteApp] = await db.select({ agentId: applicationsTable.agentId, branchId: applicationsTable.branchId }).from(applicationsTable).where(and(eq(applicationsTable.id, id), isNull(applicationsTable.deletedAt)));
  if (!noteApp) { res.status(404).json({ error: "Application not found" }); return; }
  if (isAgentSourcedAndBlockedForStaff(req.user!, noteApp.agentId)) {
    const notePerms = await getEffectivePermissionSet({ id: req.user!.id, role: req.user!.role });
    if (!notePerms.has("records.view_others")) {
      res.status(404).json({ error: "Application not found" }); return;
    }
    if (!(await isInBranchScope(req.user!.id, req.user!.role, noteApp.branchId))) {
      res.status(404).json({ error: "Application not found" }); return;
    }
  }

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
  const id = parseInt(String(req.params.id), 10);
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
  const id = parseInt(String(req.params.id), 10);
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
  const progMap = new Map(programs.filter(p => (p.minGpa != null && p.minGpa > 0) || (p.minLanguageScore != null && p.minLanguageScore > 0)).map(p => [p.id, p]));

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
    if (prog.minGpa != null && prog.minGpa > 0) {
      const gpaNum = normalizeGpaTo100(stu.gpa);
      if (isNaN(gpaNum) || gpaNum < prog.minGpa) fail = true;
    }
    if (prog.minLanguageScore != null && prog.minLanguageScore > 0) {
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
