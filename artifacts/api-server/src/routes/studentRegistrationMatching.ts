import { Router, type IRouter } from "express";
import { and, eq, sql, or, ilike, inArray } from "drizzle-orm";
import { z } from "zod/v4";
import { db, programsTable, universitiesTable, countriesTable } from "@workspace/db";
import { evaluateRegistrationCandidate } from "../lib/studentRegistrationMatching";
import { publicStudentMatchingLimiter } from "../lib/limiters";

const router: IRouter = Router();

const code = z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/);
const answersSchema = z.object({
  nationalityCode: code.optional(),
  educationCountryCode: code.optional(),
  completedEducationLevel: z.string().trim().min(1).max(80).optional(),
  targetEducationLevel: z.string().trim().min(1).max(80).optional(),
  gradeValue: z.number().finite().min(0).max(1000).optional(),
  gradeScale: z.string().trim().min(1).max(40).optional(),
  languageTest: z.string().trim().min(1).max(40).optional(),
  languageOverall: z.number().finite().min(0).max(1000).optional(),
  preferredCountryCodes: z.array(code).max(20).default([]),
  preferredFields: z.array(z.string().trim().min(1).max(120)).max(10).default([]),
  budgetAmount: z.number().finite().nonnegative().max(10_000_000).optional(),
  budgetCurrency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).optional(),
}).strict();

router.post("/public/student-registration/matches", publicStudentMatchingLimiter, async (req, res): Promise<void> => {
  const parsed = answersSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "INVALID_MATCHING_PROFILE", fields: parsed.error.issues.map(issue => issue.path.join(".")) });
    return;
  }
  const answers = parsed.data;
  const conditions = [
    eq(programsTable.isActive, true),
    eq(universitiesTable.isActive, true),
    eq(universitiesTable.status, "open"),
  ];
  const targetAliases: Record<string, string[]> = {
    bachelor: ["bachelor", "undergraduate", "lisans"], master: ["master", "postgraduate", "yüksek lisans"],
    doctorate: ["doctorate", "doctoral", "phd", "doktora"], diploma: ["diploma", "associate", "ön lisans"],
  };
  if (answers.targetEducationLevel) {
    const aliases = targetAliases[answers.targetEducationLevel.toLowerCase()] ?? [answers.targetEducationLevel];
    conditions.push(or(...aliases.map(alias => ilike(programsTable.degree, `%${alias}%`)))!);
  }
  if (answers.preferredCountryCodes.length) conditions.push(inArray(countriesTable.code, answers.preferredCountryCodes));
  if (answers.preferredFields.length) conditions.push(or(...answers.preferredFields.map(field => ilike(programsTable.field, field)))!);
  if (answers.nationalityCode) conditions.push(or(
    sql`${universitiesTable.nationalityPolicy} <> 'restricted'`,
    sql`not (${universitiesTable.admissionSourceUrl} like 'https://%' and ${universitiesTable.admissionVerifiedAt} <= now() and ${universitiesTable.admissionValidUntil} >= now())`,
    sql`${universitiesTable.acceptedNationalityCodes} @> ${JSON.stringify([answers.nationalityCode])}::jsonb`,
  )!);
  const candidates = await db.select({
    id: programsTable.id,
    name: programsTable.name,
    universityId: universitiesTable.id,
    universityName: universitiesTable.name,
    country: universitiesTable.country,
    countryCode: countriesTable.code,
    city: universitiesTable.city,
    degree: programsTable.degree,
    field: programsTable.field,
    language: programsTable.language,
    tuitionFee: programsTable.tuitionFee,
    discountedFee: programsTable.discountedFee,
    currency: programsTable.currency,
    nationalityPolicy: universitiesTable.nationalityPolicy,
    acceptedNationalityCodes: universitiesTable.acceptedNationalityCodes,
    nationalitySourceUrl: universitiesTable.admissionSourceUrl,
    nationalityVerifiedAt: universitiesTable.admissionVerifiedAt,
    nationalityValidUntil: universitiesTable.admissionValidUntil,
    requiredEducationLevel: sql<string | null>`coalesce(${programsTable.requiredEducationLevel}, ${universitiesTable.defaultRequiredEducationLevel})`,
    minGradeValue: sql<number | null>`coalesce(${programsTable.minGradeValue}, ${universitiesTable.defaultMinGradeValue})`,
    gradeScale: sql<string | null>`coalesce(${programsTable.gradeScale}, ${universitiesTable.defaultGradeScale})`,
    legacyMinGpa: programsTable.minGpa,
    languageRequirements: sql<unknown>`coalesce(${programsTable.languageRequirements}, ${universitiesTable.defaultLanguageRequirements})`,
    legacyMinLanguageScore: programsTable.minLanguageScore,
    conditionalAdmission: sql<boolean>`coalesce(${programsTable.conditionalAdmission}, ${universitiesTable.defaultConditionalAdmission})`,
    requirementSourceUrl: sql<string | null>`coalesce(${programsTable.admissionSourceUrl}, ${universitiesTable.admissionSourceUrl})`,
    requirementVerifiedAt: sql<Date | null>`coalesce(${programsTable.admissionVerifiedAt}, ${universitiesTable.admissionVerifiedAt})`,
    requirementValidUntil: sql<Date | null>`coalesce(${programsTable.admissionValidUntil}, ${universitiesTable.admissionValidUntil})`,
  }).from(programsTable)
    .innerJoin(universitiesTable, eq(programsTable.universityId, universitiesTable.id))
    .leftJoin(countriesTable, sql`lower(trim(${countriesTable.name})) = lower(trim(${universitiesTable.country}))`)
    .where(and(...conditions))
    .orderBy(universitiesTable.name, programsTable.name)
    .limit(1000);

  const evaluated = candidates.map(row => {
    const match = evaluateRegistrationCandidate(answers, {
      ...row,
      fee: row.discountedFee ?? row.tuitionFee,
    });
    return { ...row, ...match };
  });
  const visible = evaluated.filter(row => row.status !== "not_met").slice(0, 100);
  const destinationMap = new Map<string, { code: string; name: string; compatible: number; reviewRequired: number }>();
  for (const row of visible) {
    if (!row.countryCode) continue;
    const current = destinationMap.get(row.countryCode) ?? { code: row.countryCode, name: row.country, compatible: 0, reviewRequired: 0 };
    if (row.status === "compatible") current.compatible++;
    else current.reviewRequired++;
    destinationMap.set(row.countryCode, current);
  }
  res.setHeader("Cache-Control", "private, no-store");
  res.json({
    destinations: [...destinationMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
    programs: visible,
    meta: {
      evaluated: evaluated.length,
      compatible: evaluated.filter(row => row.status === "compatible").length,
      reviewRequired: evaluated.filter(row => row.status === "review_required").length,
      excluded: evaluated.filter(row => row.status === "not_met").length,
      truncated: candidates.length === 1000 || visible.length === 100,
    },
  });
});

export default router;
