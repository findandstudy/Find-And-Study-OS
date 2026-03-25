import { Router, type IRouter } from "express";
import { db, programsTable, universitiesTable, wishlistsTable, applicationsTable, commissionsTable, serviceFeesTable, studentsTable } from "@workspace/db";
import { eq, ilike, sql, and, inArray, desc, or } from "drizzle-orm";
import { requireAuth, requireRole, requireAgentStaffPermission, logAudit } from "../lib/auth";
import { STAFF_ROLES, AGENT_ROLES } from "../lib/roles";
import { usersTable } from "@workspace/db";
import { resolveAgentCommission } from "../lib/agentCommission";

const router: IRouter = Router();

router.get("/course-finder", async (req, res): Promise<void> => {
  const { country, city, universityType, universityId, level, language, search, intake, feeMin, feeMax, page = "1", limit = "24" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(1000, Math.max(1, parseInt(limit, 10)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [eq(programsTable.isActive, true)];
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
  if (intake) conditions.push(ilike(programsTable.intakes, `%${intake}%`));
  if (feeMin) conditions.push(sql`COALESCE(${programsTable.discountedFee}, ${programsTable.tuitionFee}) >= ${parseInt(feeMin, 10)}`);
  if (feeMax) conditions.push(sql`COALESCE(${programsTable.discountedFee}, ${programsTable.tuitionFee}) <= ${parseInt(feeMax, 10)}`);
  if (search) {
    conditions.push(
      sql`(${ilike(programsTable.name, `%${search}%`)} OR ${ilike(universitiesTable.name, `%${search}%`)})`
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
      universityRanking: universitiesTable.ranking,
      universityQsRanking: universitiesTable.qsRanking,
      universityTimesRanking: universitiesTable.timesRanking,
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

router.get("/course-finder/filters", async (_req, res): Promise<void> => {
  const activeJoin = and(eq(programsTable.universityId, universitiesTable.id), eq(programsTable.isActive, true));

  const countries = await db
    .selectDistinct({ country: universitiesTable.country })
    .from(universitiesTable)
    .innerJoin(programsTable, activeJoin)
    .orderBy(universitiesTable.country);

  const cities = await db
    .selectDistinct({ city: universitiesTable.city })
    .from(universitiesTable)
    .innerJoin(programsTable, activeJoin)
    .where(sql`${universitiesTable.city} IS NOT NULL`)
    .orderBy(universitiesTable.city);

  const universityTypes = await db
    .selectDistinct({ type: universitiesTable.universityType })
    .from(universitiesTable)
    .innerJoin(programsTable, activeJoin)
    .where(sql`${universitiesTable.universityType} IS NOT NULL`)
    .orderBy(universitiesTable.universityType);

  const universities = await db
    .selectDistinct({ id: universitiesTable.id, name: universitiesTable.name })
    .from(universitiesTable)
    .innerJoin(programsTable, activeJoin)
    .orderBy(universitiesTable.name);

  const degrees = await db
    .selectDistinct({ degree: programsTable.degree })
    .from(programsTable)
    .where(and(eq(programsTable.isActive, true), sql`${programsTable.degree} IS NOT NULL`))
    .orderBy(programsTable.degree);

  const languages = await db
    .selectDistinct({ language: programsTable.language })
    .from(programsTable)
    .where(and(eq(programsTable.isActive, true), sql`${programsTable.language} IS NOT NULL`))
    .orderBy(programsTable.language);

  const fields = await db
    .selectDistinct({ field: programsTable.field })
    .from(programsTable)
    .where(and(eq(programsTable.isActive, true), sql`${programsTable.field} IS NOT NULL AND ${programsTable.field} != ''`))
    .orderBy(programsTable.field);

  const feeRange = await db
    .select({
      min: sql<number>`MIN(COALESCE(${programsTable.discountedFee}, ${programsTable.tuitionFee}))`,
      max: sql<number>`MAX(COALESCE(${programsTable.discountedFee}, ${programsTable.tuitionFee}))`,
    })
    .from(programsTable)
    .where(and(eq(programsTable.isActive, true), sql`COALESCE(${programsTable.discountedFee}, ${programsTable.tuitionFee}) IS NOT NULL`));

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
});

router.get("/course-finder/students", requireAuth, async (req, res): Promise<void> => {
  const { search, limit = "10" } = req.query as Record<string, string>;
  const limitNum = Math.min(20, Math.max(1, parseInt(limit, 10)));

  const conditions = [];
  if (search && search.trim()) {
    const s = `%${search.trim()}%`;
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

  const where = conditions.length > 0 ? and(...conditions) : undefined;
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
  const currentYear = String(new Date().getFullYear());
  const studentName = `${student.firstName || ""} ${student.lastName || ""}`.trim();

  const [application] = await db.insert(applicationsTable).values({
    studentId: student.id,
    programId: program.id,
    universityId: program.universityId,
    agentId: student.agentId || null,
    season: currentYear,
    stage: "inquiry",
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

  await logAudit(req.user!.id, "create_application", "application", application.id,
    { studentId: student.id, programId: program.id, source: "course_finder" }, req.ip);

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
      isStateUniversity: program.universityType === "State",
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
      isStateUniversity: program.universityType === "State",
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

  res.status(201).json({ application, commission, serviceFee });
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
  const programId = parseInt(req.params.programId, 10);
  if (isNaN(programId)) { res.status(400).json({ error: "Invalid programId" }); return; }
  await db.delete(wishlistsTable)
    .where(and(eq(wishlistsTable.userId, userId), eq(wishlistsTable.programId, programId)));
  res.sendStatus(204);
});

export default router;
