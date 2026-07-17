import { Router, type IRouter } from "express";
import { db, programsTable, universitiesTable, wishlistsTable, applicationsTable, commissionsTable, serviceFeesTable, studentsTable, pipelineStagesTable } from "@workspace/db";
import { eq, ilike, sql, and, inArray, isNull, desc, or } from "drizzle-orm";
import { requireAuth, requireRole, requireAgentStaffPermission, logAudit } from "../lib/auth";
import { STAFF_ROLES, AGENT_ROLES, ADMIN_ROLES, isAgentRole } from "../lib/roles";
import { usersTable } from "@workspace/db";
import { resolveAgentCommission } from "../lib/agentCommission";
import { getCurrentSeason } from "../lib/season";
import { checkMandatoryDocsForStudent, parkApplicationInMissingDocsStage } from "../lib/mandatoryDocs.js";
import { dispatchNotification } from "../lib/notificationDispatcher.js";
import { enqueueOnStageChange, maybeEnqueuePortalSubmission } from "../lib/portalAutoTrigger.js";
import { getAgentVisibleIds } from "../lib/agentVisibility";
import { getVisibleBranchIds } from "../lib/branchScope";

const router: IRouter = Router();

/**
 * Escape PostgreSQL LIKE/ILIKE pattern metacharacters so user-supplied
 * search input is matched literally. Without this, characters like `%`
 * and `_` are interpreted as wildcards (e.g. searching `50%` would match
 * everything starting with "50").
 */
function escapeLikePattern(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/**
 * Parse a query-string number safely. Returns null for NaN, Infinity, or
 * negative values so the caller can skip the filter instead of injecting
 * `NaN` into the SQL (which Postgres rejects with a 500).
 */
function parseNonNegativeInt(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

router.get("/course-finder", async (req, res): Promise<void> => {
  const { country, city, universityType, universityId, programId, level, language, search, intake, feeMin, feeMax, page = "1", limit = "24" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page, 10));
  // Cap at 500 (was 1000). Lowering further requires StudentDetail.tsx:319
  // to be paginated — currently it requests `limit=500` for a single
  // university's program list.
  const limitNum = Math.min(500, Math.max(1, parseInt(limit, 10)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [eq(programsTable.isActive, true)];
  if (programId) {
    const pid = parseInt(programId, 10);
    if (!isNaN(pid)) conditions.push(eq(programsTable.id, pid));
  }
  if (country) {
    const vals = country.split(",").map(s => s.trim()).filter(Boolean);
    if (vals.length === 1) conditions.push(eq(universitiesTable.country, vals[0]));
    else if (vals.length > 1) conditions.push(inArray(universitiesTable.country, vals));
  }
  if (city) {
    const vals = city.split(",").map(s => s.trim()).filter(Boolean);
    if (vals.length === 1) conditions.push(eq(universitiesTable.city, vals[0]));
    else if (vals.length > 1) conditions.push(inArray(universitiesTable.city, vals));
  }
  if (universityType) {
    const vals = universityType.split(",").map(s => s.trim()).filter(Boolean);
    if (vals.length === 1) conditions.push(eq(universitiesTable.universityType, vals[0]));
    else if (vals.length > 1) conditions.push(inArray(universitiesTable.universityType, vals));
  }
  if (universityId) {
    const vals = universityId.split(",").map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
    if (vals.length === 1) conditions.push(eq(programsTable.universityId, vals[0]));
    else if (vals.length > 1) conditions.push(inArray(programsTable.universityId, vals));
  }
  if (level) {
    const vals = level.split(",").map(s => s.trim()).filter(Boolean);
    if (vals.length === 1) conditions.push(ilike(programsTable.degree, `%${vals[0]}%`));
    else if (vals.length > 1) conditions.push(or(...vals.map(v => ilike(programsTable.degree, `%${v}%`)))!);
  }
  if (language) {
    const vals = language.split(",").map(s => s.trim()).filter(Boolean);
    if (vals.length === 1) conditions.push(ilike(programsTable.language, vals[0]));
    else if (vals.length > 1) conditions.push(inArray(programsTable.language, vals));
  }
  if ((req.query as Record<string, string>).field) {
    const fieldVal = (req.query as Record<string, string>).field;
    const vals = fieldVal.split(",").map(s => s.trim()).filter(Boolean);
    if (vals.length === 1) conditions.push(ilike(programsTable.field, vals[0]));
    else if (vals.length > 1) conditions.push(or(...vals.map(v => ilike(programsTable.field, v)))!);
  }
  if (intake) conditions.push(ilike(programsTable.intakes, `%${escapeLikePattern(intake)}%`));
  const feeMinNum = parseNonNegativeInt(feeMin);
  if (feeMinNum !== null) conditions.push(sql`COALESCE(${programsTable.discountedFee}, ${programsTable.tuitionFee}) >= ${feeMinNum}`);
  const feeMaxNum = parseNonNegativeInt(feeMax);
  if (feeMaxNum !== null) conditions.push(sql`COALESCE(${programsTable.discountedFee}, ${programsTable.tuitionFee}) <= ${feeMaxNum}`);
  if (search) {
    const escaped = escapeLikePattern(search);
    conditions.push(
      sql`(${ilike(programsTable.name, `%${escaped}%`)} OR ${ilike(universitiesTable.name, `%${escaped}%`)})`
    );
  }

  const where = and(...conditions);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(programsTable)
    .innerJoin(universitiesTable, eq(programsTable.universityId, universitiesTable.id))
    .where(where);

  const rows = await db
    .select({
      id: programsTable.id,
      name: programsTable.name,
      degree: programsTable.degree,
      field: programsTable.field,
      language: programsTable.language,
      duration: programsTable.duration,
      tuitionFee: programsTable.tuitionFee,
      currency: programsTable.currency,
      scholarship: programsTable.scholarship,
      intakes: programsTable.intakes,
      requirements: programsTable.requirements,
      commissionRate: programsTable.commissionRate,
      applicationFee: programsTable.applicationFee,
      advancedFee: programsTable.advancedFee,
      depositFee: programsTable.depositFee,
      serviceFeeAmount: programsTable.serviceFeeAmount,
      discountedFee: programsTable.discountedFee,
      languageFee: programsTable.languageFee,
      feeType: programsTable.feeType,
      quota: programsTable.quota,
      isActive: programsTable.isActive,
      universityId: programsTable.universityId,
      universityName: universitiesTable.name,
      universityLogoUrl: universitiesTable.logoUrl,
      universityCountry: universitiesTable.country,
      universityCity: universitiesTable.city,
      universityStatus: universitiesTable.status,
      universityType: universitiesTable.universityType,
      universityWebsite: universitiesTable.website,
      universityDescription: universitiesTable.description,
      universityQsRanking: universitiesTable.qsRanking,
      universityTimesRanking: universitiesTable.timesRanking,
      universityShanghaiRanking: universitiesTable.shanghaiRanking,
      universityCwtsLeidenRanking: universitiesTable.cwtsLeidenRanking,
      universityAddress: universitiesTable.address,
      universityTaxType: universitiesTable.taxType,
      universityContactName: universitiesTable.contactPersonName,
      universityContactPhone: universitiesTable.contactPersonPhone,
      universityContactEmail: universitiesTable.contactPersonEmail,
    })
    .from(programsTable)
    .innerJoin(universitiesTable, eq(programsTable.universityId, universitiesTable.id))
    .where(where)
    .orderBy(universitiesTable.name, programsTable.name)
    .limit(limitNum)
    .offset(offset);

  const user = (req as any).user;
  const canSeeContacts = user && ([...STAFF_ROLES, ...AGENT_ROLES] as string[]).includes(user.role);
  const sanitizedRows = canSeeContacts
    ? rows
    : rows.map(({ universityContactName, universityContactPhone, universityContactEmail, commissionRate, serviceFeeAmount, ...rest }) => rest);

  res.json({
    data: sanitizedRows,
    meta: {
      total: Number(count),
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(Number(count) / limitNum),
    },
  });
});

/**
 * Build a WHERE-conditions array from URL query params, optionally
 * skipping a single facet key. Used by the cascading /filters endpoint:
 * each facet's options are computed with all OTHER selected filters
 * applied, so e.g. selecting Country=Turkey narrows the City and
 * University dropdowns but keeps the Country dropdown showing every
 * country (so the user can still switch).
 */
export function buildProgramFacetConditions(
  params: Record<string, string | undefined>,
  excludeKey?:
    | "country" | "city" | "universityType" | "universityId"
    | "level" | "language" | "field" | "fee" | "search",
  opts?: { fuzzyField?: boolean },
) {
  const conditions = [eq(programsTable.isActive, true)];
  if (excludeKey !== "country" && params.country) {
    const vals = params.country.split(",").map(s => s.trim()).filter(Boolean);
    if (vals.length === 1) conditions.push(ilike(universitiesTable.country, vals[0]));
    else if (vals.length > 1) conditions.push(or(...vals.map(v => ilike(universitiesTable.country, v)))!);
  }
  if (excludeKey !== "city" && params.city) {
    const vals = params.city.split(",").map(s => s.trim()).filter(Boolean);
    if (vals.length === 1) conditions.push(ilike(universitiesTable.city, vals[0]));
    else if (vals.length > 1) conditions.push(or(...vals.map(v => ilike(universitiesTable.city, v)))!);
  }
  if (excludeKey !== "universityType" && params.universityType) {
    const vals = params.universityType.split(",").map(s => s.trim()).filter(Boolean);
    if (vals.length === 1) conditions.push(ilike(universitiesTable.universityType, vals[0]));
    else if (vals.length > 1) conditions.push(or(...vals.map(v => ilike(universitiesTable.universityType, v)))!);
  }
  if (excludeKey !== "universityId" && params.universityId) {
    const vals = params.universityId.split(",").map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
    if (vals.length === 1) conditions.push(eq(programsTable.universityId, vals[0]));
    else if (vals.length > 1) conditions.push(inArray(programsTable.universityId, vals));
  }
  if (excludeKey !== "level" && params.level) {
    const vals = params.level.split(",").map(s => s.trim()).filter(Boolean);
    if (vals.length === 1) conditions.push(ilike(programsTable.degree, `%${vals[0]}%`));
    else if (vals.length > 1) conditions.push(or(...vals.map(v => ilike(programsTable.degree, `%${v}%`)))!);
  }
  if (excludeKey !== "language" && params.language) {
    const vals = params.language.split(",").map(s => s.trim()).filter(Boolean);
    if (vals.length === 1) conditions.push(ilike(programsTable.language, vals[0]));
    else if (vals.length > 1) conditions.push(inArray(programsTable.language, vals));
  }
  if (excludeKey !== "field" && params.field) {
    const vals = params.field.split(",").map(s => s.trim()).filter(Boolean);
    if (opts?.fuzzyField) {
      // AI tool: free-text — match loosely against field taxonomy, program name and degree.
      conditions.push(
        or(...vals.flatMap(v => {
          const esc = escapeLikePattern(v);
          return [
            ilike(programsTable.field,  `%${esc}%`),
            ilike(programsTable.name,   `%${esc}%`),
            ilike(programsTable.degree, `%${esc}%`),
          ];
        }))!
      );
    } else {
      // Course Finder facet: exact taxonomy match (unchanged).
      if (vals.length === 1) conditions.push(ilike(programsTable.field, vals[0]));
      else if (vals.length > 1) conditions.push(or(...vals.map(v => ilike(programsTable.field, v)))!);
    }
  }
  if (excludeKey !== "fee") {
    const feeMinNum = parseNonNegativeInt(params.feeMin);
    if (feeMinNum !== null) conditions.push(sql`COALESCE(${programsTable.discountedFee}, ${programsTable.tuitionFee}) >= ${feeMinNum}`);
    const feeMaxNum = parseNonNegativeInt(params.feeMax);
    if (feeMaxNum !== null) conditions.push(sql`COALESCE(${programsTable.discountedFee}, ${programsTable.tuitionFee}) <= ${feeMaxNum}`);
  }
  if (excludeKey !== "search" && params.search) {
    const escaped = escapeLikePattern(params.search);
    conditions.push(
      sql`(${ilike(programsTable.name, `%${escaped}%`)} OR ${ilike(universitiesTable.name, `%${escaped}%`)})`
    );
  }
  return and(...conditions);
}

router.get("/course-finder/filters", async (req, res): Promise<void> => {
  try {
    const params = req.query as Record<string, string | undefined>;
    const join = eq(programsTable.universityId, universitiesTable.id);

    const wCountry = buildProgramFacetConditions(params, "country");
    const wCity = buildProgramFacetConditions(params, "city");
    const wType = buildProgramFacetConditions(params, "universityType");
    const wUni = buildProgramFacetConditions(params, "universityId");
    const wLevel = buildProgramFacetConditions(params, "level");
    const wLang = buildProgramFacetConditions(params, "language");
    const wField = buildProgramFacetConditions(params, "field");
    const wFee = buildProgramFacetConditions(params, "fee");

    const [countries, cities, universityTypes, universities, degrees, languages, fields, feeRange] = await Promise.all([
      db.selectDistinct({ country: universitiesTable.country }).from(universitiesTable).innerJoin(programsTable, join)
        .where(and(wCountry, sql`${universitiesTable.country} IS NOT NULL`)).orderBy(universitiesTable.country),
      db.selectDistinct({ city: universitiesTable.city }).from(universitiesTable).innerJoin(programsTable, join)
        .where(and(wCity, sql`${universitiesTable.city} IS NOT NULL`)).orderBy(universitiesTable.city),
      db.selectDistinct({ type: universitiesTable.universityType }).from(universitiesTable).innerJoin(programsTable, join)
        .where(and(wType, sql`${universitiesTable.universityType} IS NOT NULL`)).orderBy(universitiesTable.universityType),
      db.selectDistinct({ id: universitiesTable.id, name: universitiesTable.name }).from(universitiesTable).innerJoin(programsTable, join)
        .where(wUni).orderBy(universitiesTable.name),
      db.selectDistinct({ degree: programsTable.degree }).from(programsTable).innerJoin(universitiesTable, join)
        .where(and(wLevel, sql`${programsTable.degree} IS NOT NULL`)).orderBy(programsTable.degree),
      db.selectDistinct({ language: programsTable.language }).from(programsTable).innerJoin(universitiesTable, join)
        .where(and(wLang, sql`${programsTable.language} IS NOT NULL`)).orderBy(programsTable.language),
      db.selectDistinct({ field: programsTable.field }).from(programsTable).innerJoin(universitiesTable, join)
        .where(and(wField, sql`${programsTable.field} IS NOT NULL AND ${programsTable.field} != ''`)).orderBy(programsTable.field),
      db.select({
        min: sql<number>`MIN(COALESCE(${programsTable.discountedFee}, ${programsTable.tuitionFee}))`,
        max: sql<number>`MAX(COALESCE(${programsTable.discountedFee}, ${programsTable.tuitionFee}))`,
      }).from(programsTable).innerJoin(universitiesTable, join)
        .where(and(wFee, sql`COALESCE(${programsTable.discountedFee}, ${programsTable.tuitionFee}) IS NOT NULL`)),
    ]);

    res.json({
      countries: countries.map(r => r.country).filter(Boolean),
      cities: cities.map(r => r.city).filter(Boolean),
      universityTypes: universityTypes.map(r => r.type).filter(Boolean),
      universities: universities.map(r => ({ id: r.id, name: r.name })),
      degrees: degrees.map(r => r.degree).filter(Boolean),
      languages: languages.map(r => r.language).filter(Boolean),
      fields: fields.map(r => r.field).filter(Boolean),
      feeRange: { min: feeRange[0]?.min ?? 0, max: feeRange[0]?.max ?? 100000 },
    });
  } catch (err: any) {
    console.error("[course-finder/filters] failed:", err?.message || err);
    res.status(500).json({ error: err?.message || "Failed to load filters" });
  }
});

router.get("/course-finder/students", requireAuth, requireAgentStaffPermission("course_finder"), async (req, res): Promise<void> => {
  const user = req.user!;
  const { search, limit = "10" } = req.query as Record<string, string>;
  const limitNum = Math.min(20, Math.max(1, parseInt(limit, 10)));

  // Always exclude soft-deleted students.
  const conditions: any[] = [isNull(studentsTable.deletedAt)];

  // Ownership scoping — mirrors GET /api/students so agents only see their
  // own students (and their sub-agents'/agent_staff's), and non-admin staff
  // see assigned-or-unassigned students. Admins see everything.
  if (isAgentRole(user.role)) {
    const visibleIds = await getAgentVisibleIds(user.id, user.role);
    if (visibleIds.length === 0) { res.json([]); return; }
    conditions.push(inArray(studentsTable.agentId, visibleIds));
  } else if (user.role === "student") {
    conditions.push(eq(studentsTable.userId, user.id));
  } else if (!(ADMIN_ROLES as readonly string[]).includes(user.role)) {
    conditions.push(
      or(
        eq(studentsTable.assignedToId, user.id),
        isNull(studentsTable.assignedToId),
      )
    );
  }

  // Branch scoping for staff and agents (super_admin → null = all).
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

  if (search && search.trim()) {
    const s = `%${escapeLikePattern(search.trim())}%`;
    conditions.push(
      or(
        ilike(studentsTable.firstName, s),
        ilike(studentsTable.lastName, s),
        ilike(studentsTable.email, s),
        ilike(studentsTable.phone, s),
        sql`CONCAT(${studentsTable.firstName}, ' ', ${studentsTable.lastName}) ILIKE ${s}`,
      )
    );
  }

  const where = and(...conditions);
  const rows = await db
    .select({
      id: studentsTable.id,
      firstName: studentsTable.firstName,
      lastName: studentsTable.lastName,
      email: studentsTable.email,
      phone: studentsTable.phone,
      nationality: studentsTable.nationality,
      agentId: studentsTable.agentId,
      createdAt: studentsTable.createdAt,
    })
    .from(studentsTable)
    .where(where)
    .orderBy(desc(studentsTable.createdAt))
    .limit(limitNum);

  res.json(rows);
});

router.post("/course-finder/apply", requireAuth, requireRole(...STAFF_ROLES, ...AGENT_ROLES, "student"), requireAgentStaffPermission("course_finder"), async (req, res): Promise<void> => {
  const { studentId, programId, notes } = req.body;
  const isStudentRole = req.user!.role === "student";

  let resolvedStudentId = studentId;
  if (isStudentRole) {
    let [myStudent] = await db.select().from(studentsTable).where(eq(studentsTable.userId, req.user!.id));
    if (!myStudent) {
      const [me] = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.id));
      if (!me) { res.status(404).json({ error: "User not found" }); return; }
      [myStudent] = await db.insert(studentsTable).values({
        userId: me.id,
        firstName: me.firstName || "",
        lastName: me.lastName || "",
        email: me.email || "",
        phone: me.phone || null,
      }).returning();
    }
    resolvedStudentId = myStudent.id;
  }

  if (!resolvedStudentId || !programId) {
    res.status(400).json({ error: "studentId and programId are required" });
    return;
  }

  const [student] = await db.select().from(studentsTable).where(eq(studentsTable.id, Number(resolvedStudentId)));
  if (!student) { res.status(404).json({ error: "Student not found" }); return; }

  // Authorization — verify the caller may act on this student. The student
  // self-apply branch above already guarantees ownership; admins are
  // unrestricted. Everyone else is checked against the same scoping rules
  // as GET /api/students.
  if (!isStudentRole && !(ADMIN_ROLES as readonly string[]).includes(req.user!.role)) {
    if (student.deletedAt) {
      res.status(403).json({ error: "You do not have access to this student" });
      return;
    }
    if (isAgentRole(req.user!.role)) {
      const visibleIds = await getAgentVisibleIds(req.user!.id, req.user!.role);
      if (!student.agentId || !visibleIds.includes(student.agentId)) {
        res.status(403).json({ error: "You do not have access to this student" });
        return;
      }
    } else {
      // Non-admin staff: assigned to caller (or unassigned).
      if (student.assignedToId != null && student.assignedToId !== req.user!.id) {
        res.status(403).json({ error: "You do not have access to this student" });
        return;
      }
    }
    // Branch scoping (applies to both staff and agents). Mirrors the
    // listing semantics in /course-finder/students and /students:
    //  - visibleBranchIds=null    → unrestricted (admin-equivalent)
    //  - visibleBranchIds=[ids]   → only those branches OR null-branch
    //  - visibleBranchIds=[]      → only null-branch students allowed
    // Returning a blanket 403 when the list is empty would deny legitimate
    // access to null-branch students that ARE visible in the picker,
    // breaking the listing/apply consistency contract.
    const visibleBranchIds = await getVisibleBranchIds(req.user!.id, req.user!.role);
    if (visibleBranchIds !== null) {
      const studentBranchId = student.branchId;
      const allowed = studentBranchId == null
        ? true
        : visibleBranchIds.includes(studentBranchId);
      if (!allowed) {
        res.status(403).json({ error: "You do not have access to this student" });
        return;
      }
    }
  }

  const [program] = await db
    .select({
      id: programsTable.id,
      name: programsTable.name,
      degree: programsTable.degree,
      language: programsTable.language,
      tuitionFee: programsTable.tuitionFee,
      discountedFee: programsTable.discountedFee,
      currency: programsTable.currency,
      scholarship: programsTable.scholarship,
      commissionRate: programsTable.commissionRate,
      serviceFeeAmount: programsTable.serviceFeeAmount,
      applicationFee: programsTable.applicationFee,
      depositFee: programsTable.depositFee,
      advancedFee: programsTable.advancedFee,
      languageFee: programsTable.languageFee,
      intakes: programsTable.intakes,
      universityId: programsTable.universityId,
      universityName: universitiesTable.name,
      universityCountry: universitiesTable.country,
      universityType: universitiesTable.universityType,
    })
    .from(programsTable)
    .innerJoin(universitiesTable, eq(programsTable.universityId, universitiesTable.id))
    .where(eq(programsTable.id, Number(programId)));

  if (!program) { res.status(404).json({ error: "Program not found" }); return; }

  const effectiveFee = program.discountedFee ?? program.tuitionFee;
  const currentYear = await getCurrentSeason();
  const studentName = `${student.firstName || ""} ${student.lastName || ""}`.trim();

  const [application] = await db.insert(applicationsTable).values({
    studentId: student.id,
    programId: program.id,
    universityId: program.universityId,
    agentId: student.agentId || null,
    season: currentYear,
    stage: "inquiry",
    // Authenticated panel Course Finder "apply" = staff/admin (also agents).
    createdSource: "staff",
    programName: program.name,
    universityName: program.universityName,
    country: program.universityCountry || null,
    level: program.degree || null,
    instructionLanguage: program.language || null,
    tuitionFee: program.tuitionFee ?? null,
    discountedFee: program.discountedFee ?? null,
    scholarship: program.scholarship ?? null,
    commissionRate: program.commissionRate ?? null,
    serviceFeeAmount: program.serviceFeeAmount ?? null,
    applicationFee: program.applicationFee ?? null,
    depositFee: program.depositFee ?? null,
    advancedFee: program.advancedFee ?? null,
    languageFee: program.languageFee ?? null,
    currency: program.currency || "USD",
    intake: program.intakes || null,
    notes: notes || null,
  }).returning();

  // Portal automation auto-trigger (fire-and-forget — never blocks response).
  maybeEnqueuePortalSubmission({
    applicationId:  application.id,
    studentId:      application.studentId,
    newStage:       String(application.stage),
    universityName: application.universityName ?? null,
    universityId:   application.universityId ?? null,
    actorUserId:    req.user?.id ?? null,
  }).catch((err) =>
    console.error("[portal-auto] Trigger failed for new app", application.id, ":", err),
  );

  await logAudit(req.user!.id, "create_application", "application", application.id,
    { studentId: student.id, programId: program.id, source: "course_finder" }, req.ip);

  try {
    const [appMadeStage] = await db.select({ key: pipelineStagesTable.key })
      .from(pipelineStagesTable)
      .where(and(eq(pipelineStagesTable.entityType, "student"), eq(pipelineStagesTable.variant, "won")));
    if (appMadeStage && (student.status === "active" || student.status === "inactive")) {
      await db.update(studentsTable).set({ status: appMadeStage.key }).where(eq(studentsTable.id, student.id));
      // Event-driven portal enqueue: the new application was created at "inquiry"
      // but the student just entered a won stage — trigger immediately rather than
      // waiting for the next batch scan.
      void enqueueOnStageChange({
        applicationId:  application.id,
        studentId:      student.id,
        newStage:       appMadeStage.key,
        universityName: application.universityName ?? null,
        universityId:   application.universityId ?? null,
        actorUserId:    req.user!.id,
      });
    }
  } catch {}

  let commission = null;
  if (program.commissionRate && program.commissionRate > 0 && effectiveFee && effectiveFee > 0) {
    const universityCommAmount = Math.round((effectiveFee * program.commissionRate) / 100);
    const agentComm = await resolveAgentCommission(student.agentId, universityCommAmount);
    [commission] = await db.insert(commissionsTable).values({
      applicationId: application.id,
      studentId: student.id,
      agentId: agentComm.agentId,
      studentName,
      universityName: program.universityName,
      programName: program.name,
      isStateUniversity: ["public", "state"].includes((program.universityType ?? "").toLowerCase()),
      season: currentYear,
      currency: program.currency || "USD",
      programFee: String(effectiveFee),
      universityCommissionRate: String(program.commissionRate),
      universityCommissionAmount: String(universityCommAmount),
      universityCollected: "0",
      agentCommissionRate: agentComm.agentCommissionRate || "0",
      agentCommissionAmount: agentComm.agentCommissionAmount || "0",
      agentPaid: "0",
      subAgentId: agentComm.subAgentId,
      subAgentCommissionRate: agentComm.subAgentCommissionRate,
      subAgentCommissionAmount: agentComm.subAgentCommissionAmount,
      status: "potential",
      offsetAmount: "0",
    }).returning();
    await logAudit(req.user!.id, "create_commission", "commission", commission.id,
      { studentName, source: "course_finder_apply" }, req.ip);
  }

  let serviceFee = null;
  if (program.serviceFeeAmount && program.serviceFeeAmount > 0) {
    const total = program.serviceFeeAmount;
    const half = total / 2;
    [serviceFee] = await db.insert(serviceFeesTable).values({
      applicationId: application.id,
      studentId: student.id,
      agentId: student.agentId || null,
      studentName,
      universityName: program.universityName,
      isStateUniversity: ["public", "state"].includes((program.universityType ?? "").toLowerCase()),
      payerType: "student",
      season: currentYear,
      currency: program.currency || "USD",
      totalAmount: String(total),
      firstInstallmentAmount: String(half),
      firstInstallmentPaidAt: null,
      secondInstallmentAmount: String(half),
      secondInstallmentPaidAt: null,
      status: "pending",
    }).returning();
    await logAudit(req.user!.id, "create_service_fee", "service_fee", serviceFee.id,
      { studentName, source: "course_finder_apply" }, req.ip);
  }

  // ─── Mandatory document gate ─────────────────────────────────────────
  // Check whether the program requires documents not yet in the student's
  // library. Park the application in "missing_docs" when any are absent.
  let missingDocTypes: string[] = [];
  try {
    const { missing } = await checkMandatoryDocsForStudent(program.id, student.id);
    if (missing.length > 0) {
      await parkApplicationInMissingDocsStage(application.id);
      missingDocTypes = missing;
      const missingStr = missing.join(", ");
      void (async () => {
        try {
          if (application.assignedToId) {
            await dispatchNotification({
              event: "mandatory_docs_missing",
              title: "Eksik Belgeler",
              body: `Başvuru eksik belgeler nedeniyle park edildi: ${missingStr}`,
              recipientUserIds: [application.assignedToId],
              data: { applicationId: application.id, missing },
            });
          }
          const [studentRow] = await db.select({ userId: studentsTable.userId })
            .from(studentsTable).where(eq(studentsTable.id, student.id));
          if (studentRow?.userId) {
            await dispatchNotification({
              event: "mandatory_docs_missing_student",
              title: "Eksik Belgeler",
              body: `Başvurunuz için gerekli belgeler eksik: ${missingStr}`,
              recipientUserIds: [studentRow.userId],
              data: { applicationId: application.id, missing },
            });
          }
        } catch (notifErr) {
          console.error("[COURSE-FINDER] Mandatory docs notification error:", notifErr);
        }
      })();
    }
  } catch (gateErr) {
    console.error("[COURSE-FINDER] Mandatory doc gate error:", gateErr);
  }

  res.status(201).json({
    application: { ...application, ...(missingDocTypes.length > 0 ? { stage: "missing_docs" } : {}) },
    commission,
    serviceFee,
    ...(missingDocTypes.length > 0 ? { status: "missing_documents", missing: missingDocTypes } : { status: "inquiry" }),
  });
});

router.get("/wishlists", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const rows = await db.select().from(wishlistsTable).where(eq(wishlistsTable.userId, userId));
  res.json(rows.map(r => r.programId));
});

router.get("/wishlists/details", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const rows = await db.select().from(wishlistsTable).where(eq(wishlistsTable.userId, userId));
  if (rows.length === 0) { res.json([]); return; }
  const programIds = rows.map(r => r.programId);
  const programs = await db
    .select({
      id: programsTable.id,
      name: programsTable.name,
      degree: programsTable.degree,
      language: programsTable.language,
      duration: programsTable.duration,
      tuitionFee: programsTable.tuitionFee,
      discountedFee: programsTable.discountedFee,
      currency: programsTable.currency,
      scholarship: programsTable.scholarship,
      intakes: programsTable.intakes,
      universityId: programsTable.universityId,
      universityName: universitiesTable.name,
      universityCountry: universitiesTable.country,
      universityCity: universitiesTable.city,
      universityLogo: universitiesTable.logoUrl,
    })
    .from(programsTable)
    .innerJoin(universitiesTable, eq(programsTable.universityId, universitiesTable.id))
    .where(inArray(programsTable.id, programIds));
  res.json(programs);
});

router.post("/wishlists", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const { programId } = req.body;
  if (!programId) { res.status(400).json({ error: "programId required" }); return; }
  try {
    const [row] = await db.insert(wishlistsTable).values({ userId, programId }).returning();
    res.status(201).json(row);
  } catch {
    res.status(409).json({ error: "Already in wishlist" });
  }
});

router.delete("/wishlists/:programId", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const programId = parseInt(String(req.params.programId), 10);
  if (isNaN(programId)) { res.status(400).json({ error: "Invalid programId" }); return; }
  await db.delete(wishlistsTable)
    .where(and(eq(wishlistsTable.userId, userId), eq(wishlistsTable.programId, programId)));
  res.sendStatus(204);
});

export default router;
