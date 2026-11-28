import { Router, type IRouter, type Response } from "express";
import { db, pool, auditLogsTable, universitiesTable, programsTable, programTranslationsTable, applicationsTable, pipelineStagesTable, programDocumentRequirementsTable, universityApplicationPeriodsTable } from "@workspace/db";
import { eq, ilike, sql, and, or, inArray, isNull, getTableColumns, asc, type SQL } from "drizzle-orm";
import { requireAuth, requireRole, logAudit } from "../lib/auth";
import { MANAGER_ROLES, STAFF_ROLES, AGENT_ROLES } from "../lib/roles";
import { getCurrentSeason } from "../lib/season";
import { sanitizeCourseFinderProgram } from "../lib/courseFinderVisibility";
import {
  PROGRAM_TARGET_LOCALES,
  isProgramTargetLocale,
  normalizeProgramLocale,
  normalizeProgramSourceContent,
  parseProgramTranslation,
} from "../lib/programTranslationContract";
import {
  reconcileMissingProgramTranslations,
  requeueAllFailedProgramTranslations,
  requeueProgramTranslations,
} from "../lib/programTranslationQueue";
import { invalidatePublicCatalogRenderCache } from "../lib/publicCatalogRenderReadModel";
import { invalidatePublicWebDiscoveryCache } from "../lib/publicWebDiscoveryReadModel";
import { parseUniversityBulkStatus } from "../lib/universityBulkStatus";
import { normalizeCatalogSourceMetadata } from "../lib/catalogSourceMetadata";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";
import { callerOwnsObject, canonicalizeKey } from "../lib/objectAuthz";
import { validateUploadedFileBuffer } from "../lib/fileUploadValidation";
import { consumeFinalizedUploadGrantInDrizzle } from "../lib/uploadGrant";
import { createHash } from "node:crypto";
import { buildSyntheticDeadlinePreview } from "../lib/deadlineReminderPreview";
import { parseReminderDay, deadlineTiming, calendarFingerprint } from "../lib/deadlineReminderPolicy";
import { readDeadlinePolicy } from "../lib/deadlineReminderPolicyStore";
import { resolveProgramApplicationCalendar } from "../lib/programApplicationCalendar";
import { addPublicCatalogConditions, getPublicCatalogPolicy } from "../lib/publicCatalogQueryPolicy";

const router: IRouter = Router();
const universityLogoObjectStorage = new ObjectStorageService();

async function prepareUniversityLogoUpload(objectPath: string): Promise<{
  objectPath: string;
  bytes: Buffer;
  contentType: string;
}> {
  const objectKey = canonicalizeKey(objectPath);
  if (!objectKey || !objectKey.startsWith("branding/university-logo/")) {
    throw new Error("UNIVERSITY_LOGO_UPLOAD_INVALID_PATH");
  }
  const file = await universityLogoObjectStorage.getObjectEntityFile(`/objects/${objectKey}`);
  const [metadata] = await file.getMetadata();
  const contentType = String(metadata.contentType ?? "").split(";", 1)[0].trim().toLowerCase();
  const [bytes] = await file.download();
  const extensionByMime: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  };
  const extension = extensionByMime[contentType];
  if (!extension) throw new Error("UNIVERSITY_LOGO_UPLOAD_UNSUPPORTED_TYPE");
  if (bytes.length <= 0 || bytes.length > 5 * 1024 * 1024) {
    throw new Error("UNIVERSITY_LOGO_UPLOAD_INVALID_SIZE");
  }
  if (await validateUploadedFileBuffer(`university-logo.${extension}`, contentType, bytes)) {
    throw new Error("UNIVERSITY_LOGO_UPLOAD_SIGNATURE_MISMATCH");
  }
  return { objectPath, bytes, contentType };
}

async function resolveUniversityLogoUpload(
  userId: number,
  logoUrl: unknown,
): Promise<Awaited<ReturnType<typeof prepareUniversityLogoUpload>> | null> {
  if (typeof logoUrl !== "string" || !logoUrl.startsWith("/api/storage/objects/")) return null;
  if (!(await callerOwnsObject(userId, logoUrl))) throw new Error("UNIVERSITY_LOGO_UPLOAD_NOT_OWNED");
  try {
    return await prepareUniversityLogoUpload(logoUrl);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("UNIVERSITY_LOGO_UPLOAD_")) throw error;
    throw new Error("UNIVERSITY_LOGO_UPLOAD_UNREADABLE");
  }
}

function sendUniversityLogoError(res: Response, error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  if (message === "UNIVERSITY_LOGO_UPLOAD_NOT_OWNED") {
    res.status(403).json({ error: "The uploaded university logo does not belong to this account" });
    return true;
  }
  if (message === "UNIVERSITY_LOGO_UPLOAD_GRANT_NOT_FINALIZED") {
    res.status(409).json({ error: "Uploaded logo is not finalized or has already been used", code: "UPLOAD_GRANT_NOT_FINALIZED" });
    return true;
  }
  if (message.startsWith("UNIVERSITY_LOGO_UPLOAD_")) {
    res.status(message === "UNIVERSITY_LOGO_UPLOAD_INVALID_SIZE" ? 413 : 400)
      .json({ error: "Uploaded university logo content is invalid", code: message });
    return true;
  }
  return false;
}

const UNI_PATCH_FIELDS = [
  "name", "country", "city", "website", "logoUrl", "description", "ranking", "isActive",
  "universityType", "taxType", "taxPercent", "qsRanking", "timesRanking", "shanghaiRanking",
  "cwtsLeidenRanking", "address", "onlinePaymentUrl", "cricosLink", "documentsLink",
  "currentFeeListLink", "initialDepositOptions", "admissionProcess",
  "contactPersonName", "contactPersonPhone", "contactPersonEmail", "status",
  "assignedStaffIds", "nationalityPolicy", "acceptedNationalityCodes",
  "defaultRequiredEducationLevel", "defaultMinGradeValue", "defaultGradeScale",
  "defaultLanguageRequirements", "defaultConditionalAdmission",
  "admissionSourceUrl", "admissionVerifiedAt", "admissionValidUntil",
  "sourceMetadata",
];

const CONTACT_FIELDS = ["contactPersonName", "contactPersonPhone", "contactPersonEmail"];
function programResponseVisibility(user?: { role: string; agentStaffPermissions?: string[] }): {
  contacts: boolean;
  internalFees: boolean;
  serviceFee: boolean;
} {
  const backOfficeRole = Boolean(user && ([...STAFF_ROLES, ...AGENT_ROLES] as string[]).includes(user.role));
  const agentStaff = user?.role === "agent_staff";
  return {
    contacts: backOfficeRole,
    internalFees: backOfficeRole && (!agentStaff || (user?.agentStaffPermissions ?? []).includes("view_commission_amount")),
    serviceFee: backOfficeRole && (!agentStaff || (user?.agentStaffPermissions ?? []).includes("view_service_fee")),
  };
}

async function programReadConditions(user?: { role: string }) {
  const conditions: SQL[] = [];
  if (user && MANAGER_ROLES.includes(user.role)) return conditions;
  const isPortalViewer = user && (STAFF_ROLES.includes(user.role) || AGENT_ROLES.includes(user.role));
  conditions.push(eq(programsTable.isActive, true));
  addPublicCatalogConditions(conditions, isPortalViewer ? null : await getPublicCatalogPolicy());
  return conditions;
}

function programForViewer<T extends { financeNotes?: unknown; sourceMetadata?: unknown }>(
  row: T,
  user?: { role: string; agentStaffPermissions?: string[] },
) {
  const result = sanitizeCourseFinderProgram(row, programResponseVisibility(user));
  if (!user || !MANAGER_ROLES.includes(user.role)) {
    delete result.financeNotes;
    delete result.sourceMetadata;
  }
  return result;
}

// Internal fields that must never leak through unauthenticated /universities
// endpoints. assignedStaffIds is the per-university notification recipient
// list — exposing it would reveal internal user-id assignments publicly.
const INTERNAL_FIELDS = ["assignedStaffIds"];
const PROG_PATCH_FIELDS = [
  "universityId", "name", "description", "degree", "field", "language", "duration",
  "tuitionFee", "currency", "scholarship", "intakes", "requirements",
  "commissionRate", "applicationFee", "advancedFee", "depositFee",
  "enrollmentFee", "adaptationFee", "serviceFeeAmount", "discountedFee", "languageFee", "feeType", "refundProcess",
  "priceValidFrom", "priceValidUntil", "financeNotes",
  "minGpa", "minLanguageScore", "quota", "isActive", "requiredEducationLevel",
  "minGradeValue", "gradeScale", "languageRequirements", "conditionalAdmission",
  "admissionSourceUrl", "admissionVerifiedAt", "admissionValidUntil",
  "universityApplicationPeriodId", "applicationsOpenOverrideAt", "applicationDeadlineOverrideAt",
  "classesStartOverrideOn", "classesEndOverrideOn",
  "sourceMetadata",
];

type UniversityApplicationPeriodInput = {
  id?: number;
  termName?: unknown;
  academicYear?: unknown;
  campusName?: unknown;
  applicationsOpenAt?: unknown;
  applicationDeadlineAt?: unknown;
  classesStartOn?: unknown;
  classesEndOn?: unknown;
  sourceTimezone?: unknown;
  sourceUrl?: unknown;
  verifiedAt?: unknown;
  isActive?: unknown;
};

function optionalDate(value: unknown, field: string): Date | null {
  if (value == null || value === "") return null;
  const parsed = new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) throw new Error(`${field} must be a valid date`);
  return parsed;
}

function optionalDateOnly(value: unknown, field: string): string | null {
  if (value == null || value === "") return null;
  const raw = String(value).trim();
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) {
    throw new Error(`${field} must use YYYY-MM-DD`);
  }
  return raw;
}

function normalizeApplicationPeriod(row: UniversityApplicationPeriodInput, userId: number) {
  const termName = String(row.termName ?? "").trim();
  const academicYear = Number(row.academicYear);
  const sourceTimezone = String(row.sourceTimezone ?? "").trim();
  const sourceUrl = String(row.sourceUrl ?? "").trim();
  if (!termName || termName.length > 160) throw new Error("termName is required and must be at most 160 characters");
  if (!Number.isInteger(academicYear) || academicYear < 2000 || academicYear > 2200) throw new Error("academicYear must be between 2000 and 2200");
  try { new Intl.DateTimeFormat("en", { timeZone: sourceTimezone }).format(); }
  catch { throw new Error("sourceTimezone must be a valid IANA timezone"); }
  let parsedUrl: URL;
  try { parsedUrl = new URL(sourceUrl); } catch { throw new Error("sourceUrl must be a valid HTTPS URL"); }
  if (parsedUrl.protocol !== "https:" || parsedUrl.username || parsedUrl.password) throw new Error("sourceUrl must be a valid HTTPS URL");
  const applicationsOpenAt = optionalDateOnly(row.applicationsOpenAt, "applicationsOpenAt");
  const applicationDeadlineAt = optionalDateOnly(row.applicationDeadlineAt, "applicationDeadlineAt");
  if (applicationsOpenAt && applicationDeadlineAt && applicationDeadlineAt < applicationsOpenAt) throw new Error("application deadline cannot be before applications open");
  const classesStartOn = optionalDateOnly(row.classesStartOn, "classesStartOn");
  const classesEndOn = optionalDateOnly(row.classesEndOn, "classesEndOn");
  if (classesStartOn && classesEndOn && classesEndOn < classesStartOn) throw new Error("class end cannot be before class start");
  const verifiedAt = optionalDate(row.verifiedAt, "verifiedAt");
  if (!verifiedAt) throw new Error("verifiedAt is required; unknown dates must remain blank rather than estimated");
  return {
    termName,
    academicYear,
    campusName: String(row.campusName ?? "").trim() || null,
    applicationsOpenAt,
    applicationDeadlineAt,
    classesStartOn,
    classesEndOn,
    sourceTimezone,
    sourceUrl: parsedUrl.toString(),
    verifiedAt,
    isActive: row.isActive !== false,
    createdById: userId,
    updatedById: userId,
    updatedAt: new Date(),
  };
}

function normalizeAdmissionUrl(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || value.length > 2048) throw new Error("admissionSourceUrl must be a valid HTTPS URL");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("admissionSourceUrl must be a valid HTTPS URL");
  return url.toString();
}

function normalizeAdmissionDate(value: unknown, field = "admissionVerifiedAt"): Date | null {
  if (value == null || value === "") return null;
  const date = new Date(String(value));
  if (!Number.isFinite(date.getTime())) throw new Error(`${field} must be a valid date`);
  return date;
}

function requireCurrentAdmissionEvidence(input: {
  source: string | null; verifiedAt: Date | null; validUntil: Date | null; hasRules: boolean;
}) {
  if (!input.hasRules) return;
  if (!input.source || !input.verifiedAt || !input.validUntil) {
    throw new Error("Verified admission rules require source URL, last verified date and valid-until date");
  }
  if (input.validUntil.getTime() < input.verifiedAt.getTime()) {
    throw new Error("admissionValidUntil must be on or after admissionVerifiedAt");
  }
}

function normalizeNationalityPolicy(policy: unknown, values: unknown) {
  if (!["unknown", "open", "restricted"].includes(String(policy))) throw new Error("Invalid nationalityPolicy");
  if (!Array.isArray(values) || values.length > 250) throw new Error("acceptedNationalityCodes must be an array");
  const accepted = [...new Set(values.map(value => String(value).trim().toUpperCase()))];
  if (!accepted.every(value => /^[A-Z]{2}$/.test(value))) throw new Error("acceptedNationalityCodes must contain ISO alpha-2 codes");
  if (policy === "restricted" && accepted.length === 0) throw new Error("Restricted policy requires at least one nationality");
  return policy === "restricted" ? accepted : [];
}

function normalizeLanguageRequirements(value: unknown) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 20) throw new Error("languageRequirements must be an array");
  return value.map((row) => {
    if (!row || typeof row !== "object") throw new Error("Invalid language requirement");
    const item = row as Record<string, unknown>;
    const test = String(item.test || "").trim().toLowerCase();
    const overall = Number(item.overall);
    if (!/^[a-z0-9_-]{2,40}$/.test(test) || !Number.isFinite(overall) || overall < 0 || overall > 1000) {
      throw new Error("Invalid language requirement");
    }
    return { test, overall };
  });
}

function normalizeCurrency(value: unknown): string | null {
  if (value == null || value === "") return null;
  const currency = String(value).trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("currency must be a three-letter ISO 4217 code");
  return currency;
}

async function requireProgramPeriodScope(universityId: number, periodId: unknown) {
  if (periodId == null || periodId === "") return null;
  const id = Number(periodId);
  if (!Number.isSafeInteger(id) || id < 1) throw new Error("universityApplicationPeriodId must be a positive integer");
  const [period] = await db.select({ id: universityApplicationPeriodsTable.id })
    .from(universityApplicationPeriodsTable)
    .where(and(eq(universityApplicationPeriodsTable.id, id), eq(universityApplicationPeriodsTable.universityId, universityId), eq(universityApplicationPeriodsTable.isActive, true)));
  if (!period) throw new Error("Selected application period does not belong to the program university");
  return id;
}

async function validateProgramCalendar(input:{universityId:number;universityApplicationPeriodId:number|null;applicationsOpenOverrideAt:unknown;applicationDeadlineOverrideAt:unknown;classesStartOverrideOn:unknown;classesEndOverrideOn:unknown}) {
 const program={...input,applicationsOpenOverrideAt:optionalDateOnly(input.applicationsOpenOverrideAt,'applicationsOpenOverrideAt'),applicationDeadlineOverrideAt:optionalDateOnly(input.applicationDeadlineOverrideAt,'applicationDeadlineOverrideAt'),classesStartOverrideOn:optionalDateOnly(input.classesStartOverrideOn,'classesStartOverrideOn'),classesEndOverrideOn:optionalDateOnly(input.classesEndOverrideOn,'classesEndOverrideOn')};
 const hasOverrides=[program.applicationsOpenOverrideAt,program.applicationDeadlineOverrideAt,program.classesStartOverrideOn,program.classesEndOverrideOn].some(Boolean);
 if(!hasOverrides)return;
 const periods=await db.select().from(universityApplicationPeriodsTable).where(and(eq(universityApplicationPeriodsTable.universityId,program.universityId),eq(universityApplicationPeriodsTable.isActive,true)));
 const result=resolveProgramApplicationCalendar(program,periods);
 if(result.applicationCalendarStatus!=='VERIFIED')throw new Error('Program calendar needs a valid school period and consistent application and class dates');
}

/* ─── UNIVERSITIES ───────────────────────────────────────────── */

function maskContacts(uni: Record<string, any>, userRole?: string): Record<string, any> {
  // Always strip internal fields from any response that flows through
  // maskContacts (the public /universities + /universities/:id endpoints
  // call this). Authenticated callers that need the field must read it
  // directly from the row inside protected handlers.
  const masked = { ...uni };
  for (const f of INTERNAL_FIELDS) {
    delete masked[f];
  }
  if (userRole === "super_admin") return masked;
  delete masked.sourceMetadata;
  for (const f of CONTACT_FIELDS) {
    delete masked[f];
  }
  return masked;
}

router.get("/universities/countries", async (_req, res): Promise<void> => {
  const rows = await db
    .selectDistinct({ country: universitiesTable.country })
    .from(universitiesTable)
    .orderBy(universitiesTable.country);
  res.json(rows.map(r => r.country).filter(Boolean));
});

router.get("/universities/cities", async (_req, res): Promise<void> => {
  const rows = await db
    .selectDistinct({ city: universitiesTable.city })
    .from(universitiesTable)
    .orderBy(universitiesTable.city);
  res.json(rows.map(r => r.city).filter(Boolean));
});

router.get("/universities", async (req, res): Promise<void> => {
  const { country, city, type, status, qs, search, name, page = "1", limit = "20", summary } = req.query as Record<string, string>;
  const safeInt = (v: string, fallback: number) => /^\d+$/.test(v) ? parseInt(v, 10) : fallback;
  const pageNum = Math.max(1, safeInt(page, 1));
  const limitNum = Math.min(100, Math.max(1, safeInt(limit, 20)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];
  if (!req.user || !MANAGER_ROLES.includes(req.user.role)) conditions.push(eq(universitiesTable.isActive, true));
  if (country) conditions.push(ilike(universitiesTable.country, `%${country}%`));
  if (city) conditions.push(ilike(universitiesTable.city, `%${city}%`));
  if (type) conditions.push(ilike(universitiesTable.universityType, type));
  if (status) conditions.push(ilike(universitiesTable.status, status));
  if (search) conditions.push(ilike(universitiesTable.name, `%${search}%`));
  if (name) conditions.push(ilike(universitiesTable.name, `%${name}%`));
  if (qs && /^\d+$/.test(qs)) {
    conditions.push(eq(universitiesTable.qsRanking, parseInt(qs, 10)));
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const countQuery = db.select({ count: sql<number>`count(*)` }).from(universitiesTable).where(where);
  const rowsQuery = summary === "1"
    ? db.select({
        id: universitiesTable.id,
        name: universitiesTable.name,
        country: universitiesTable.country,
        city: universitiesTable.city,
        website: universitiesTable.website,
        universityType: universitiesTable.universityType,
        qsRanking: universitiesTable.qsRanking,
        status: universitiesTable.status,
        isActive: universitiesTable.isActive,
        hasLogo: sql<boolean>`${universitiesTable.logoUrl} IS NOT NULL
          AND length(trim(${universitiesTable.logoUrl})) > 0`.as("has_logo"),
      }).from(universitiesTable).where(where).limit(limitNum).offset(offset).orderBy(universitiesTable.name)
    : db.select().from(universitiesTable).where(where).limit(limitNum).offset(offset).orderBy(universitiesTable.name);
  const [[{ count }], rows] = await Promise.all([countQuery, rowsQuery]);
  const userRole = (req as any).user?.role;
  const data = rows.map(u => {
    const masked = maskContacts(u as any, userRole);
    if (summary === "1") {
      masked.logoUrl = masked.hasLogo ? `/api/universities/${masked.id}/logo` : null;
      delete masked.hasLogo;
    }
    return masked;
  });

  res.json({ data, meta: { total: Number(count), page: pageNum, limit: limitNum, totalPages: Math.ceil(Number(count) / limitNum) } });
});

router.get("/universities/options", requireAuth, async (req, res): Promise<void> => {
  try {
    const data = await db
      .select({
        id: universitiesTable.id,
        name: universitiesTable.name,
      })
      .from(universitiesTable)
      .where(MANAGER_ROLES.includes(req.user!.role) ? undefined : eq(universitiesTable.isActive, true))
      .orderBy(universitiesTable.name);
    res.json({ data });
  } catch (error) {
    console.error("Get university options error:", error);
    res.status(500).json({ error: "Failed to get university options" });
  }
});

router.get("/universities/:id/logo", async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [uni] = await db.select({ logoUrl: universitiesTable.logoUrl })
    .from(universitiesTable)
    .where(eq(universitiesTable.id, id));
  const logoUrl = uni?.logoUrl?.trim();
  if (!logoUrl) { res.status(404).json({ error: "University logo not found" }); return; }

  const dataUrl = logoUrl.match(/^data:(image\/(?:png|jpe?g|gif|webp|svg\+xml));base64,([A-Za-z0-9+/=\s]+)$/i);
  if (dataUrl) {
    const bytes = Buffer.from(dataUrl[2].replace(/\s/g, ""), "base64");
    const etag = `"${createHash("sha256").update(bytes).digest("hex")}"`;
    res.setHeader("Content-Type", dataUrl[1].toLowerCase());
    res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
    res.setHeader("ETag", etag);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    if (req.headers["if-none-match"] === etag) { res.status(304).end(); return; }
    res.send(bytes);
    return;
  }

  const objectKey = canonicalizeKey(logoUrl);
  if (objectKey && logoUrl.includes("/api/storage/objects/")) {
    try {
      const file = await universityLogoObjectStorage.getObjectEntityFile(`/objects/${objectKey}`);
      const [metadata] = await file.getMetadata();
      const contentType = String(metadata.contentType ?? "").split(";", 1)[0].trim().toLowerCase();
      if (!new Set(["image/jpeg", "image/png", "image/webp"]).has(contentType)) {
        res.status(415).json({ error: "University logo is not a supported image" });
        return;
      }
      const size = Number(metadata.size);
      if (!Number.isSafeInteger(size) || size <= 0 || size > 5 * 1024 * 1024) {
        res.status(413).json({ error: "University logo is too large" });
        return;
      }
      const [bytes] = await file.download();
      if (bytes.length !== size) { res.status(409).json({ error: "University logo changed while reading" }); return; }
      const etag = `"${createHash("sha256").update(bytes).digest("hex")}"`;
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Length", String(bytes.length));
      res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
      res.setHeader("ETag", etag);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
      if (req.headers["if-none-match"] === etag) { res.status(304).end(); return; }
      res.send(bytes);
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        res.status(404).json({ error: "University logo not found" });
        return;
      }
      console.error("[university-logo] failed to read stored logo", error);
      res.status(500).json({ error: "University logo could not be loaded" });
    }
    return;
  }

  if (/^https?:\/\//i.test(logoUrl) || logoUrl.startsWith("/")) {
    res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
    res.redirect(302, logoUrl);
    return;
  }

  res.status(404).json({ error: "University logo is not available" });
});

router.post("/universities", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  const {
    name, country, city, website, logoUrl, description, ranking, isActive = true,
    universityType, taxType, taxPercent, qsRanking, timesRanking, shanghaiRanking,
    cwtsLeidenRanking, address, onlinePaymentUrl, cricosLink, documentsLink,
    currentFeeListLink, initialDepositOptions, admissionProcess,
    contactPersonName, contactPersonPhone, contactPersonEmail, status = "open",
    nationalityPolicy = "unknown", acceptedNationalityCodes = [],
    defaultRequiredEducationLevel, defaultMinGradeValue, defaultGradeScale,
    defaultLanguageRequirements = [], defaultConditionalAdmission = false,
    admissionSourceUrl, admissionVerifiedAt, admissionValidUntil, sourceMetadata,
  } = req.body;
  if (!name || !country) { res.status(400).json({ error: "name and country are required" }); return; }
  let normalizedNationalities: string[];
  let normalizedUniversitySource: string | null;
  let normalizedUniversityVerifiedAt: Date | null;
  let normalizedUniversityValidUntil: Date | null;
  let normalizedDefaultLanguages: Array<{ test: string; overall: number }>;
  let normalizedSourceMetadata;
  try {
    normalizedNationalities = normalizeNationalityPolicy(nationalityPolicy, acceptedNationalityCodes);
    normalizedUniversitySource = normalizeAdmissionUrl(admissionSourceUrl);
    normalizedUniversityVerifiedAt = normalizeAdmissionDate(admissionVerifiedAt);
    normalizedUniversityValidUntil = normalizeAdmissionDate(admissionValidUntil, "admissionValidUntil");
    normalizedDefaultLanguages = normalizeLanguageRequirements(defaultLanguageRequirements);
    normalizedSourceMetadata = normalizeCatalogSourceMetadata("university", sourceMetadata);
    requireCurrentAdmissionEvidence({
      source: normalizedUniversitySource,
      verifiedAt: normalizedUniversityVerifiedAt,
      validUntil: normalizedUniversityValidUntil,
      hasRules: nationalityPolicy !== "unknown" || Boolean(defaultRequiredEducationLevel)
        || defaultMinGradeValue != null || normalizedDefaultLanguages.length > 0,
    });
  }
  catch (error) { res.status(400).json({ error: (error as Error).message }); return; }
  const universityValues = {
    name, country, city: city || null, website: website || null, logoUrl: logoUrl || null,
    description: description || null, ranking: ranking ? Number(ranking) : null, isActive,
    universityType: universityType || null, taxType: taxType || null,
    taxPercent: taxPercent ? Number(taxPercent) : null,
    qsRanking: qsRanking ? Number(qsRanking) : null,
    timesRanking: timesRanking ? Number(timesRanking) : null,
    shanghaiRanking: shanghaiRanking ? Number(shanghaiRanking) : null,
    cwtsLeidenRanking: cwtsLeidenRanking ? Number(cwtsLeidenRanking) : null,
    address: address || null, onlinePaymentUrl: onlinePaymentUrl || null,
    cricosLink: cricosLink || null, documentsLink: documentsLink || null,
    currentFeeListLink: currentFeeListLink || null,
    initialDepositOptions: initialDepositOptions || null,
    admissionProcess: admissionProcess || null,
    contactPersonName: contactPersonName || null,
    contactPersonPhone: contactPersonPhone || null,
    contactPersonEmail: contactPersonEmail || null,
    status,
    nationalityPolicy,
    acceptedNationalityCodes: normalizedNationalities,
    defaultRequiredEducationLevel: defaultRequiredEducationLevel || null,
    defaultMinGradeValue: defaultMinGradeValue == null || defaultMinGradeValue === "" ? null : Number(defaultMinGradeValue),
    defaultGradeScale: defaultGradeScale || null,
    defaultLanguageRequirements: normalizedDefaultLanguages,
    defaultConditionalAdmission: Boolean(defaultConditionalAdmission),
    admissionSourceUrl: normalizedUniversitySource,
    admissionVerifiedAt: normalizedUniversityVerifiedAt,
    admissionValidUntil: normalizedUniversityValidUntil,
    sourceMetadata: normalizedSourceMetadata,
  };
  let uni: typeof universitiesTable.$inferSelect;
  try {
    const preparedLogo = await resolveUniversityLogoUpload(req.user!.id, logoUrl);
    uni = await db.transaction(async (tx) => {
      if (preparedLogo && !await consumeFinalizedUploadGrantInDrizzle(tx, {
        objectPath: preparedLogo.objectPath,
        uploadedBy: req.user!.id,
        bytes: preparedLogo.bytes,
        contentType: preparedLogo.contentType,
      })) throw new Error("UNIVERSITY_LOGO_UPLOAD_GRANT_NOT_FINALIZED");
      const [created] = await tx.insert(universitiesTable).values(universityValues).returning();
      return created;
    });
  } catch (error) {
    if (sendUniversityLogoError(res, error)) return;
    console.error("Create university error:", error);
    res.status(500).json({ error: "Failed to create university" });
    return;
  }
  invalidatePublicCatalogRenderCache({ entityType: "catalog" });
  invalidatePublicWebDiscoveryCache();
  await logAudit(req.user!.id, "create_university", "university", uni.id, { name, country }, req.ip);
  res.status(201).json(uni);
});

router.patch("/universities/bulk-status", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  let input: ReturnType<typeof parseUniversityBulkStatus>;
  try { input = parseUniversityBulkStatus(req.body); }
  catch (error) { res.status(400).json({ error: (error as Error).message }); return; }
  // Do not overwrite child program flags: reactivation must preserve individually inactive programs.
  const updated = await db.update(universitiesTable).set({ isActive: input.isActive })
    .where(inArray(universitiesTable.id, input.ids)).returning({ id: universitiesTable.id });
  if (updated.length) {
    invalidatePublicCatalogRenderCache({ entityType: "catalog" });
    invalidatePublicWebDiscoveryCache();
  }
  await logAudit(req.user!.id, input.isActive ? "bulk_activate_universities" : "bulk_deactivate_universities", "university", undefined,
    { requestedCount: input.ids.length, updatedCount: updated.length, universityIds: input.ids.slice(0, 100), truncated: input.ids.length > 100 }, req.ip);
  res.json({ updated: updated.length, ids: updated.map(row => row.id), isActive: input.isActive });
});

router.get("/universities/:id", async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [uni] = await db.select().from(universitiesTable).where(eq(universitiesTable.id, id));
  if (!uni) { res.status(404).json({ error: "University not found" }); return; }
  const userRole = (req as any).user?.role;
  res.json(maskContacts(uni as any, userRole));
});

function applicationPeriodRevision(rows: (typeof universityApplicationPeriodsTable.$inferSelect)[]): string {
  return createHash("sha256").update(JSON.stringify(
    [...rows].sort((left, right) => left.id - right.id),
  )).digest("hex");
}

router.get("/universities/:id/application-periods", requireAuth, async (req, res): Promise<void> => {
  const universityId = Number(req.params.id);
  if (!Number.isSafeInteger(universityId) || universityId < 1) { res.status(400).json({ error: "Invalid university id" }); return; }
  const rows = await db.select().from(universityApplicationPeriodsTable)
    .where(eq(universityApplicationPeriodsTable.universityId, universityId))
    .orderBy(asc(universityApplicationPeriodsTable.academicYear), asc(universityApplicationPeriodsTable.applicationDeadlineAt), asc(universityApplicationPeriodsTable.id));
  res.set("Cache-Control", "private, no-store");
  res.json({ data: rows, revision: applicationPeriodRevision(rows) });
});

router.put("/universities/:id/application-periods", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  const universityId = Number(req.params.id);
  if (!Number.isSafeInteger(universityId) || universityId < 1) { res.status(400).json({ error: "Invalid university id" }); return; }
  if (!Array.isArray(req.body?.periods) || req.body.periods.length > 100) {
    res.status(400).json({ error: "periods must be an array with at most 100 rows" }); return;
  }
  let normalized: ReturnType<typeof normalizeApplicationPeriod>[];
  try { normalized = req.body.periods.map((row: UniversityApplicationPeriodInput) => normalizeApplicationPeriod(row, req.user!.id)); }
  catch (error) { res.status(400).json({ error: (error as Error).message }); return; }
  const providedIds = req.body.periods.map((row: UniversityApplicationPeriodInput) => Number(row.id)).filter((id: number) => Number.isSafeInteger(id) && id > 0);
  if (new Set(providedIds).size !== providedIds.length) {
    res.status(400).json({ error: "Application period ids must be unique" }); return;
  }
  try {
    const saved = await db.transaction(async tx => {
      const [school] = await tx.select({ id: universitiesTable.id }).from(universitiesTable)
        .where(eq(universitiesTable.id, universityId)).for("update");
      if (!school) return { status: "missing" } as const;
      const existing = await tx.select()
        .from(universityApplicationPeriodsTable)
        .where(eq(universityApplicationPeriodsTable.universityId, universityId)).for("update");
      const expected = req.body.revision;
      if (expected !== applicationPeriodRevision(existing) && !(expected == null && existing.length === 0)) {
        return { status: "changed" } as const;
      }
      const existingIds = new Set(existing.map(row => row.id));
      if (providedIds.some((id: number) => !existingIds.has(id))) throw new Error("Application period does not belong to this university");
      const output = [];
      for (let index = 0; index < normalized.length; index++) {
        const id = Number(req.body.periods[index]?.id);
        if (Number.isSafeInteger(id) && id > 0) {
          const [row] = await tx.update(universityApplicationPeriodsTable)
            .set(normalized[index])
            .where(and(eq(universityApplicationPeriodsTable.id, id), eq(universityApplicationPeriodsTable.universityId, universityId)))
            .returning();
          if (row) output.push(row);
        } else {
          const [row] = await tx.insert(universityApplicationPeriodsTable)
            .values({ ...normalized[index], universityId })
            .returning();
          output.push(row);
        }
      }
      const retained = new Set(providedIds);
      for (const row of existing) {
        if (!retained.has(row.id) && row.isActive) {
          await tx.update(universityApplicationPeriodsTable)
            .set({ isActive: false, updatedById: req.user!.id, updatedAt: new Date() })
            .where(eq(universityApplicationPeriodsTable.id, row.id));
        }
      }
      await tx.insert(auditLogsTable).values({
        userId: req.user!.id, action: "replace_university_application_periods",
        resource: "university", resourceId: universityId,
        changes: JSON.stringify({ rows: output.length }), ipAddress: req.ip ?? null,
      });
      const current = await tx.select().from(universityApplicationPeriodsTable)
        .where(eq(universityApplicationPeriodsTable.universityId, universityId));
      return { status: "saved", data: output, revision: applicationPeriodRevision(current) } as const;
    });
    if (saved.status === "missing") { res.status(404).json({ error: "University not found" }); return; }
    if (saved.status === "changed") { res.status(409).json({ error: "APPLICATION_CALENDAR_CHANGED" }); return; }
    res.json({ data: saved.data, revision: saved.revision });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Application calendar could not be saved" });
  }
});

router.get("/universities/:id/application-periods/:periodId/reminder-preview", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  const universityId = Number(req.params.id);
  const periodId = Number(req.params.periodId);
  if (!Number.isSafeInteger(universityId)||universityId<1||!Number.isSafeInteger(periodId)||periodId<1){res.status(400).json({code:"INVALID_CALENDAR_ID"});return;}
  const policy=await readDeadlinePolicy(universityId);
  let daysBefore:number;
  try { daysBefore=req.query.daysBefore===undefined?policy.effectiveDays[0]:parseReminderDay(req.query.daysBefore); }
  catch { res.status(400).json({code:"INVALID_REMINDER_DAYS"});return; }
  if(!policy.effectiveDays.includes(daysBefore)){res.status(409).json({code:"REMINDER_DAY_NOT_CONFIGURED"});return;}
  const [period] = await db.select().from(universityApplicationPeriodsTable)
    .where(and(eq(universityApplicationPeriodsTable.id, periodId), eq(universityApplicationPeriodsTable.universityId, universityId)));
  if (!period) { res.status(404).json({ error: "Application period not found" }); return; }
  if(!period.isActive||!period.verifiedAt||!period.applicationDeadlineAt){res.status(409).json({code:"CALENDAR_NOT_READY"});return;}
  const timing=deadlineTiming(period.applicationDeadlineAt,period.sourceTimezone,daysBefore);
  const rows = buildSyntheticDeadlinePreview();
  res.json({
    mode: "synthetic",
    deliveryEnabled: false,
    period,
    daysBefore,
    policy,
    timing,
    scheduleFingerprint: calendarFingerprint({
      policyVersion:policy.version,active:period.isActive,verifiedAt:period.verifiedAt,opensAt:period.applicationsOpenAt,
      periodId,
      deadline: period.applicationDeadlineAt ?? null,
      timezone: period.sourceTimezone,
      daysBefore,
    }),
    summary: { eligible: rows.filter(row => row.eligible).length, excluded: rows.filter(row => !row.eligible).length },
    data: rows,
  });
});

// Protected read of internal per-university assigned staff IDs.
// Public /universities responses mask this field, so admin UIs use
// this endpoint to prefill the assignment editor.
router.get("/universities/:id/assigned-staff", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [uni] = await db.select({ assignedStaffIds: universitiesTable.assignedStaffIds })
    .from(universitiesTable).where(eq(universitiesTable.id, id));
  if (!uni) { res.status(404).json({ error: "University not found" }); return; }
  res.json({ assignedStaffIds: Array.isArray(uni.assignedStaffIds) ? uni.assignedStaffIds : [] });
});

router.patch("/universities/:id", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const updates: Record<string, unknown> = {};
  let existingUniversity: typeof universitiesTable.$inferSelect | undefined;
  for (const key of UNI_PATCH_FIELDS) {
    if (req.body[key] === undefined) continue;
    if (key === "assignedStaffIds") {
      const raw = req.body[key];
      if (!Array.isArray(raw) || !raw.every((v: unknown) => typeof v === "number" && Number.isInteger(v) && v > 0)) {
        res.status(400).json({ error: "assignedStaffIds must be an array of positive integers" });
        return;
      }
      updates[key] = Array.from(new Set(raw as number[]));
    } else if (key === "nationalityPolicy" || key === "acceptedNationalityCodes") {
      // Normalize both fields together after collecting the patch.
      updates[key] = req.body[key];
    } else if (key === "admissionSourceUrl") {
      try { updates[key] = normalizeAdmissionUrl(req.body[key]); }
      catch (error) { res.status(400).json({ error: (error as Error).message }); return; }
    } else if (key === "admissionVerifiedAt" || key === "admissionValidUntil") {
      try { updates[key] = normalizeAdmissionDate(req.body[key], key); }
      catch (error) { res.status(400).json({ error: (error as Error).message }); return; }
    } else if (key === "defaultLanguageRequirements") {
      try { updates[key] = normalizeLanguageRequirements(req.body[key]); }
      catch (error) { res.status(400).json({ error: (error as Error).message }); return; }
    } else if (key === "sourceMetadata") {
      try { updates[key] = normalizeCatalogSourceMetadata("university", req.body[key]); }
      catch (error) { res.status(400).json({ error: (error as Error).message }); return; }
    } else {
      updates[key] = req.body[key];
    }
  }
  if (updates.nationalityPolicy !== undefined || updates.acceptedNationalityCodes !== undefined) {
    const [current] = await db.select({
      policy: universitiesTable.nationalityPolicy,
      codes: universitiesTable.acceptedNationalityCodes,
    }).from(universitiesTable).where(eq(universitiesTable.id, id));
    if (!current) { res.status(404).json({ error: "University not found" }); return; }
    const policy = updates.nationalityPolicy ?? current.policy;
    const values = updates.acceptedNationalityCodes ?? current.codes;
    try {
      updates.nationalityPolicy = policy;
      updates.acceptedNationalityCodes = normalizeNationalityPolicy(policy, values);
    } catch (error) { res.status(400).json({ error: (error as Error).message }); return; }
  }
  if (UNI_PATCH_FIELDS.some(key => updates[key] !== undefined)) {
    const [current] = await db.select().from(universitiesTable).where(eq(universitiesTable.id, id));
    if (!current) { res.status(404).json({ error: "University not found" }); return; }
    existingUniversity = current;
    const merged = { ...current, ...updates } as typeof current;
    try {
      requireCurrentAdmissionEvidence({
        source: merged.admissionSourceUrl,
        verifiedAt: merged.admissionVerifiedAt,
        validUntil: merged.admissionValidUntil,
        hasRules: merged.nationalityPolicy !== "unknown" || Boolean(merged.defaultRequiredEducationLevel)
          || merged.defaultMinGradeValue != null || (merged.defaultLanguageRequirements?.length ?? 0) > 0,
      });
    } catch (error) { res.status(400).json({ error: (error as Error).message }); return; }
  }
  if (updates.logoUrl !== undefined && updates.logoUrl === existingUniversity?.logoUrl) delete updates.logoUrl;
  if (Object.keys(updates).length === 0) { res.status(400).json({ error: "No valid fields" }); return; }
  let uni: typeof universitiesTable.$inferSelect | undefined;
  try {
    const preparedLogo = await resolveUniversityLogoUpload(req.user!.id, updates.logoUrl);
    uni = await db.transaction(async (tx) => {
      if (preparedLogo && !await consumeFinalizedUploadGrantInDrizzle(tx, {
        objectPath: preparedLogo.objectPath,
        uploadedBy: req.user!.id,
        bytes: preparedLogo.bytes,
        contentType: preparedLogo.contentType,
      })) throw new Error("UNIVERSITY_LOGO_UPLOAD_GRANT_NOT_FINALIZED");
      const [saved] = await tx.update(universitiesTable).set(updates).where(eq(universitiesTable.id, id)).returning();
      return saved;
    });
  } catch (error) {
    if (sendUniversityLogoError(res, error)) return;
    console.error("Update university error:", error);
    res.status(500).json({ error: "Failed to update university" });
    return;
  }
  if (!uni || (!req.user && !uni.isActive)) { res.status(404).json({ error: "University not found" }); return; }
  invalidatePublicCatalogRenderCache({ entityType: "catalog" });
  invalidatePublicWebDiscoveryCache();
  await logAudit(req.user!.id, "update_university", "university", id, updates, req.ip);
  res.json(uni);
});

router.delete("/universities/:id", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(universitiesTable).where(eq(universitiesTable.id, id));
  invalidatePublicCatalogRenderCache({ entityType: "catalog" });
  invalidatePublicWebDiscoveryCache();
  await logAudit(req.user!.id, "delete_university", "university", id, {}, req.ip);
  res.sendStatus(204);
});

/* ─── PROGRAMS ───────────────────────────────────────────────── */

type TranslationSummaryRow = {
  program_id: number;
  total: number;
  published: number;
  pending: number;
  failed: number;
  manual: number;
};

async function loadTranslationSummaries(programIds: number[]): Promise<Map<number, {
  total: number;
  published: number;
  pending: number;
  failed: number;
  manual: number;
  target: number;
}>> {
  if (programIds.length === 0) return new Map();
  const result = await pool.query<TranslationSummaryRow>(`
    SELECT program_id,
           count(*)::int AS total,
           count(*) FILTER (WHERE status = 'published')::int AS published,
           count(*) FILTER (WHERE status IN ('queued','processing','retrying','stale_manual'))::int AS pending,
           count(*) FILTER (WHERE status = 'failed')::int AS failed,
           count(*) FILTER (WHERE is_manual)::int AS manual
      FROM program_translations
     WHERE program_id = ANY($1::int[])
     GROUP BY program_id
  `, [programIds]);
  return new Map(result.rows.map((row) => [row.program_id, {
    total: Number(row.total),
    published: Number(row.published),
    pending: Number(row.pending),
    failed: Number(row.failed),
    manual: Number(row.manual),
    target: PROGRAM_TARGET_LOCALES.length,
  }]));
}

router.get("/programs", async (req, res): Promise<void> => {
  const { universityId, language, search, name, degree, field, page = "1", limit = "20" } = req.query as Record<string, string>;
  const locale = normalizeProgramLocale(req.query.locale);
  const localized = locale !== "en";
  const safeInt = (v: string, fallback: number) => /^\d+$/.test(v) ? parseInt(v, 10) : fallback;
  const pageNum = Math.max(1, safeInt(page, 1));
  const limitNum = Math.min(100, Math.max(1, safeInt(limit, 20)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = await programReadConditions(req.user);
  if (universityId && /^\d+$/.test(universityId)) conditions.push(eq(programsTable.universityId, parseInt(universityId, 10)));
  if (language) conditions.push(ilike(programsTable.language, language));
  if (search) conditions.push(localized
    ? or(ilike(programsTable.name, `%${search}%`), ilike(programTranslationsTable.name, `%${search}%`))!
    : ilike(programsTable.name, `%${search}%`));
  if (name) conditions.push(localized
    ? or(ilike(programsTable.name, `%${name}%`), ilike(programTranslationsTable.name, `%${name}%`))!
    : ilike(programsTable.name, `%${name}%`));
  if (degree) conditions.push(ilike(programsTable.degree, degree));
  if (field) conditions.push(ilike(programsTable.field, field));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const translationJoin = and(
    eq(programTranslationsTable.programId, programsTable.id),
    eq(programTranslationsTable.locale, locale),
    eq(programTranslationsTable.status, "published"),
  );
  const [{ count }] = await db.select({ count: sql<number>`count(*)` })
    .from(programsTable)
    .leftJoin(universitiesTable, eq(programsTable.universityId, universitiesTable.id))
    .leftJoin(programTranslationsTable, translationJoin)
    .where(where);
  const rows = await db
    .select({
      ...getTableColumns(programsTable),
      name: sql<string>`coalesce(${programTranslationsTable.name}, ${programsTable.name})`,
      description: sql<string | null>`coalesce(${programTranslationsTable.description}, ${programsTable.description})`,
      field: sql<string | null>`coalesce(${programTranslationsTable.field}, ${programsTable.field})`,
      duration: sql<string | null>`coalesce(${programTranslationsTable.duration}, ${programsTable.duration})`,
      intakes: sql<string | null>`coalesce(${programTranslationsTable.intakes}, ${programsTable.intakes})`,
      requirements: sql<string | null>`coalesce(${programTranslationsTable.requirements}, ${programsTable.requirements})`,
      refundProcess: sql<string | null>`coalesce(${programTranslationsTable.refundProcess}, ${programsTable.refundProcess})`,
      translatedLocale: programTranslationsTable.locale,
      universityName: universitiesTable.name,
    })
    .from(programsTable)
    .leftJoin(universitiesTable, eq(programsTable.universityId, universitiesTable.id))
    .leftJoin(programTranslationsTable, translationJoin)
    .where(where)
    .limit(limitNum)
    .offset(offset)
    .orderBy(programsTable.name);

  // Apply the same server-side projection to every caller. Agent staff's
  // explicit switches must hold here too because application forms load their
  // program metadata from this legacy endpoint.
  const visibleRows = rows.map((row) => programForViewer(row, req.user));

  let data: any[] = visibleRows.map((row) => ({
    ...row,
    contentLocale: row.translatedLocale || "en",
    fallbackUsed: localized && !row.translatedLocale,
    translatedLocale: undefined,
  }));
  if (rows.length > 0) {
    const ids = rows.map(r => r.id);
    const reqs = await db.select().from(programDocumentRequirementsTable)
      .where(inArray(programDocumentRequirementsTable.programId, ids))
      .orderBy(programDocumentRequirementsTable.sortOrder);
    const grouped = new Map<number, { documentType: string; mandatory: boolean; sortOrder: number }[]>();
    for (const r of reqs) {
      const arr = grouped.get(r.programId) || [];
      arr.push({ documentType: r.documentType, mandatory: r.mandatory, sortOrder: r.sortOrder });
      grouped.set(r.programId, arr);
    }
    data = data.map(r => ({ ...r, documentRequirements: grouped.get(r.id) || [] }));
  }

  if (req.user && rows.length > 0) {
    const summaries = await loadTranslationSummaries(rows.map((row) => row.id));
    data = data.map((row) => ({
      ...row,
      translationSummary: summaries.get(row.id) || {
        total: 0, published: 0, pending: 0, failed: 0, manual: 0,
        target: PROGRAM_TARGET_LOCALES.length,
      },
    }));
  }

  res.json({ data, meta: { total: Number(count), page: pageNum, limit: limitNum, totalPages: Math.ceil(Number(count) / limitNum) } });
});

router.post("/programs", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  const {
    universityId, name, description, degree, field, language, duration,
    tuitionFee, currency, scholarship, intakes, requirements, commissionRate,
    applicationFee, enrollmentFee, adaptationFee, advancedFee, depositFee, serviceFeeAmount, discountedFee, languageFee,
    feeType, priceValidFrom, priceValidUntil, financeNotes, refundProcess, minGpa, minLanguageScore, quota, isActive = true,
    requiredEducationLevel, minGradeValue, gradeScale, languageRequirements,
    conditionalAdmission, admissionSourceUrl, admissionVerifiedAt, admissionValidUntil, sourceMetadata,
    universityApplicationPeriodId, applicationsOpenOverrideAt, applicationDeadlineOverrideAt,
    classesStartOverrideOn, classesEndOverrideOn,
  } = req.body;
  if (!universityId || !name) { res.status(400).json({ error: "universityId and name are required" }); return; }
  const n = (v: any) => (v !== undefined && v !== "" && v !== null ? Number(v) : null);
  let quotaVal: number | null = null;
  if (quota !== undefined && quota !== "" && quota !== null) {
    const qv = Math.round(Number(quota));
    if (isNaN(qv) || qv < 1) { res.status(400).json({ error: "quota must be a positive integer (>= 1) or empty" }); return; }
    quotaVal = qv;
  }
  let normalizedProgramLanguages: Array<{ test: string; overall: number }>;
  let normalizedProgramSource: string | null;
  let normalizedProgramVerifiedAt: Date | null;
  let normalizedProgramValidUntil: Date | null;
  let normalizedSourceMetadata;
  let normalizedCurrency: string | null;
  let normalizedPeriodId: number | null;
  try {
    normalizedProgramLanguages = normalizeLanguageRequirements(languageRequirements);
    normalizedProgramSource = normalizeAdmissionUrl(admissionSourceUrl);
    normalizedProgramVerifiedAt = normalizeAdmissionDate(admissionVerifiedAt);
    normalizedProgramValidUntil = normalizeAdmissionDate(admissionValidUntil, "admissionValidUntil");
    normalizedSourceMetadata = normalizeCatalogSourceMetadata("program", sourceMetadata);
    normalizedCurrency = normalizeCurrency(currency);
    normalizedPeriodId = await requireProgramPeriodScope(Number(universityId), universityApplicationPeriodId);
    await validateProgramCalendar({universityId:Number(universityId),universityApplicationPeriodId:normalizedPeriodId,applicationsOpenOverrideAt,applicationDeadlineOverrideAt,classesStartOverrideOn,classesEndOverrideOn});
    const hasAnyFee = [tuitionFee, scholarship, applicationFee, enrollmentFee, adaptationFee, advancedFee, depositFee, serviceFeeAmount, discountedFee, languageFee]
      .some(value => value !== undefined && value !== null && value !== "");
    if (hasAnyFee && !normalizedCurrency) throw new Error("currency is required when a fee is provided");
    if (priceValidFrom && priceValidUntil && String(priceValidUntil) < String(priceValidFrom)) throw new Error("priceValidUntil cannot be before priceValidFrom");
    if (applicationsOpenOverrideAt && applicationDeadlineOverrideAt && String(applicationDeadlineOverrideAt) < String(applicationsOpenOverrideAt)) throw new Error("program application deadline override cannot be before opening");
    if (classesStartOverrideOn && classesEndOverrideOn && String(classesEndOverrideOn) < String(classesStartOverrideOn)) throw new Error("program class end override cannot be before class start");
    requireCurrentAdmissionEvidence({
      source: normalizedProgramSource,
      verifiedAt: normalizedProgramVerifiedAt,
      validUntil: normalizedProgramValidUntil,
      hasRules: Boolean(requiredEducationLevel) || minGradeValue != null || normalizedProgramLanguages.length > 0,
    });
  } catch (error) { res.status(400).json({ error: (error as Error).message }); return; }
  const [prog] = await db.insert(programsTable).values({
    universityId: Number(universityId), name, description: description || null, degree: degree || null, field: field || null,
    language: language || null, duration: duration || null,
    tuitionFee: n(tuitionFee), currency: normalizedCurrency,
    scholarship: n(scholarship),
    intakes: intakes || null, requirements: requirements || null,
    commissionRate: n(commissionRate),
    applicationFee: n(applicationFee),
    enrollmentFee: n(enrollmentFee),
    adaptationFee: n(adaptationFee),
    advancedFee: n(advancedFee),
    depositFee: n(depositFee),
    serviceFeeAmount: n(serviceFeeAmount),
    discountedFee: n(discountedFee),
    languageFee: n(languageFee),
    feeType: feeType || null,
    priceValidFrom: priceValidFrom || null,
    priceValidUntil: priceValidUntil || null,
    financeNotes: financeNotes || null,
    refundProcess: refundProcess || null,
    minGpa: n(minGpa),
    minLanguageScore: n(minLanguageScore),
    requiredEducationLevel: requiredEducationLevel || null,
    minGradeValue: n(minGradeValue),
    gradeScale: gradeScale || null,
    languageRequirements: languageRequirements == null ? null : normalizedProgramLanguages,
    conditionalAdmission: conditionalAdmission == null ? null : Boolean(conditionalAdmission),
    admissionSourceUrl: normalizedProgramSource,
    admissionVerifiedAt: normalizedProgramVerifiedAt,
    admissionValidUntil: normalizedProgramValidUntil,
    universityApplicationPeriodId: normalizedPeriodId,
    applicationsOpenOverrideAt: optionalDateOnly(applicationsOpenOverrideAt, "applicationsOpenOverrideAt"),
    applicationDeadlineOverrideAt: optionalDateOnly(applicationDeadlineOverrideAt, "applicationDeadlineOverrideAt"),
    classesStartOverrideOn: optionalDateOnly(classesStartOverrideOn, "classesStartOverrideOn"),
    classesEndOverrideOn: optionalDateOnly(classesEndOverrideOn, "classesEndOverrideOn"),
    sourceMetadata: normalizedSourceMetadata,
    quota: quotaVal,
    isActive,
  }).returning();
  invalidatePublicCatalogRenderCache({ entityType: "catalog" });
  invalidatePublicWebDiscoveryCache();
  await logAudit(req.user!.id, "create_program", "program", prog.id, { universityId, name }, req.ip);
  res.status(201).json(prog);
});

router.get("/programs/enrolled-counts", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  const seasonParam = typeof req.query.season === "string" && req.query.season ? req.query.season : null;
  const season = seasonParam ?? await getCurrentSeason();
  const wonStages = await db.select({ key: pipelineStagesTable.key })
    .from(pipelineStagesTable)
    .where(and(eq(pipelineStagesTable.entityType, "application"), eq(pipelineStagesTable.variant, "won")));
  const wonKeys = wonStages.map(s => s.key);
  if (wonKeys.length === 0) { res.json({}); return; }
  const rows = await db.select({
    programId: applicationsTable.programId,
    count: sql<number>`count(*)`,
  })
    .from(applicationsTable)
    .where(and(
      eq(applicationsTable.season, season),
      inArray(applicationsTable.stage, wonKeys),
      isNull(applicationsTable.deletedAt),
    ))
    .groupBy(applicationsTable.programId);
  const counts: Record<number, number> = {};
  for (const r of rows) {
    if (r.programId != null) counts[r.programId] = Number(r.count);
  }
  res.json(counts);
});

// Bulk status changes are intentionally handled in one database statement.
// Apart from being much faster than issuing one PATCH per row, this prevents a
// large selection from being left half-updated if the client disconnects.
// Keep this route above /programs/:id so "bulk-status" is never parsed as an id.
router.patch("/programs/bulk-status", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  const rawIds = req.body?.ids;
  const isActive = req.body?.isActive;
  if (!Array.isArray(rawIds) || rawIds.length === 0 || rawIds.length > 5000) {
    res.status(400).json({ error: "ids must be a non-empty array with at most 5000 items" });
    return;
  }
  if (typeof isActive !== "boolean") {
    res.status(400).json({ error: "isActive must be a boolean" });
    return;
  }

  const ids = Array.from(new Set(rawIds));
  if (!ids.every((id): id is number => typeof id === "number" && Number.isSafeInteger(id) && id > 0)) {
    res.status(400).json({ error: "ids must contain only positive integers" });
    return;
  }

  const updated = await db.update(programsTable)
    .set({ isActive })
    .where(inArray(programsTable.id, ids))
    .returning({ id: programsTable.id });

  if (updated.length > 0) {
    invalidatePublicCatalogRenderCache({ entityType: "catalog" });
    invalidatePublicWebDiscoveryCache();
  }

  await logAudit(
    req.user!.id,
    isActive ? "bulk_activate_programs" : "bulk_deactivate_programs",
    "program",
    undefined,
    {
      requestedCount: ids.length,
      updatedCount: updated.length,
      // Keep audit rows useful without storing thousands of ids.
      programIds: ids.slice(0, 100),
      truncated: ids.length > 100,
    },
    req.ip,
  );
  res.json({ updated: updated.length, ids: updated.map(row => row.id), isActive });
});

router.get("/programs/:id", async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const locale = normalizeProgramLocale(req.query.locale);
  const conditions = await programReadConditions(req.user);
  const [prog] = await db.select({
    ...getTableColumns(programsTable),
    name: sql<string>`coalesce(${programTranslationsTable.name}, ${programsTable.name})`,
    description: sql<string | null>`coalesce(${programTranslationsTable.description}, ${programsTable.description})`,
    field: sql<string | null>`coalesce(${programTranslationsTable.field}, ${programsTable.field})`,
    duration: sql<string | null>`coalesce(${programTranslationsTable.duration}, ${programsTable.duration})`,
    intakes: sql<string | null>`coalesce(${programTranslationsTable.intakes}, ${programsTable.intakes})`,
    requirements: sql<string | null>`coalesce(${programTranslationsTable.requirements}, ${programsTable.requirements})`,
    refundProcess: sql<string | null>`coalesce(${programTranslationsTable.refundProcess}, ${programsTable.refundProcess})`,
    translatedLocale: programTranslationsTable.locale,
  }).from(programsTable)
    .leftJoin(universitiesTable, eq(programsTable.universityId, universitiesTable.id))
    .leftJoin(programTranslationsTable, and(
      eq(programTranslationsTable.programId, programsTable.id),
      eq(programTranslationsTable.locale, locale),
      eq(programTranslationsTable.status, "published"),
    ))
    .where(and(eq(programsTable.id, id), ...conditions));
  if (!prog) { res.status(404).json({ error: "Program not found" }); return; }
  const reqs = await db.select().from(programDocumentRequirementsTable)
    .where(eq(programDocumentRequirementsTable.programId, id))
    .orderBy(programDocumentRequirementsTable.sortOrder);
  const schoolPeriods=await db.select().from(universityApplicationPeriodsTable).where(and(eq(universityApplicationPeriodsTable.universityId,prog.universityId),eq(universityApplicationPeriodsTable.isActive,true)));
  const {effectiveApplicationPeriod,applicationCalendarStatus}=resolveProgramApplicationCalendar(prog,schoolPeriods);
  const visibleProgram = programForViewer(prog, req.user);
  res.json({
    ...visibleProgram,
    contentLocale: prog.translatedLocale || "en",
    fallbackUsed: locale !== "en" && !prog.translatedLocale,
    translatedLocale: undefined,
    effectiveApplicationPeriod,
    applicationCalendarStatus,
    documentRequirements: reqs.map(r => ({ documentType: r.documentType, mandatory: r.mandatory, sortOrder: r.sortOrder })),
  });
});

router.get("/programs/:id/translations", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isSafeInteger(id) || id < 1) { res.status(400).json({ error: "Invalid id" }); return; }
  const rows = await db.select().from(programTranslationsTable)
    .where(eq(programTranslationsTable.programId, id))
    .orderBy(programTranslationsTable.locale);
  res.json({
    sourceLocale: "en",
    targetLocales: PROGRAM_TARGET_LOCALES,
    data: rows.map(({ workerId: _workerId, ...row }) => row),
  });
});

router.post("/programs/:id/translations/retry", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isSafeInteger(id) || id < 1) { res.status(400).json({ error: "Invalid id" }); return; }
  const requested = Array.isArray(req.body?.locales) ? req.body.locales : undefined;
  if (requested && !requested.every(isProgramTargetLocale)) {
    res.status(400).json({ error: "Unsupported locale" });
    return;
  }
  const queued = await requeueProgramTranslations(id, requested);
  await logAudit(req.user!.id, "program_translations.requeue", "program", id, { queued, locales: requested || "all" }, req.ip);
  res.json({ queued });
});

router.post("/programs/translations/retry-failed", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  const queued = await requeueAllFailedProgramTranslations();
  await logAudit(req.user!.id, "program_translations.requeue_failed", "program", undefined, { queued }, req.ip);
  res.json({ queued });
});

router.post("/programs/translations/reconcile", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  const afterProgramId = Number(req.body?.afterProgramId ?? 0);
  const limit = Number(req.body?.limit ?? 100);
  if (!Number.isSafeInteger(afterProgramId) || afterProgramId < 0) {
    res.status(400).json({ error: "afterProgramId must be a non-negative integer" });
    return;
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
    res.status(400).json({ error: "limit must be an integer between 1 and 200" });
    return;
  }
  const result = await reconcileMissingProgramTranslations(afterProgramId, limit);
  await logAudit(req.user!.id, "program_translations.reconcile", "program", undefined, {
    afterProgramId,
    limit,
    ...result,
  }, req.ip);
  res.json(result);
});

router.put("/programs/:id/translations/:locale", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  const locale = String(req.params.locale || "").toLowerCase();
  if (!Number.isSafeInteger(id) || id < 1) { res.status(400).json({ error: "Invalid id" }); return; }
  if (!isProgramTargetLocale(locale)) { res.status(400).json({ error: "Unsupported locale" }); return; }
  const [program] = await db.select().from(programsTable).where(eq(programsTable.id, id));
  if (!program) { res.status(404).json({ error: "Program not found" }); return; }
  try {
    const source = normalizeProgramSourceContent(program as unknown as Record<string, unknown>);
    const content = parseProgramTranslation(JSON.stringify({
      name: req.body?.name,
      description: req.body?.description,
      field: req.body?.field,
      duration: req.body?.duration,
      intakes: req.body?.intakes,
      requirements: req.body?.requirements,
      refundProcess: req.body?.refundProcess,
    }), source);
    const result = await pool.query(`
      INSERT INTO program_translations (
        program_id, locale, name, description, field, duration, intakes,
        requirements, refund_process, source_hash, status, is_manual, attempts, error_code,
        translated_at, next_attempt_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9,
        fas_program_content_source_hash($10,$11,$12,$13,$14,$15,$16),
        'published', true, 0, NULL, now(), now(), now()
      )
      ON CONFLICT (program_id, locale) DO UPDATE
      SET name=EXCLUDED.name, description=EXCLUDED.description, field=EXCLUDED.field,
          duration=EXCLUDED.duration, intakes=EXCLUDED.intakes,
          requirements=EXCLUDED.requirements, refund_process=EXCLUDED.refund_process, source_hash=EXCLUDED.source_hash,
          status='published', is_manual=true, attempts=0, error_code=NULL,
          provider='manual', model=NULL, translated_at=now(), next_attempt_at=now(),
          leased_at=NULL, lease_expires_at=NULL, worker_id=NULL, updated_at=now()
      WHERE program_translations.status <> 'processing'
      RETURNING program_id
    `, [
      id, locale, content.name, content.description, content.field, content.duration,
      content.intakes, content.requirements, content.refundProcess, source.name, source.description,
      source.field, source.duration, source.intakes, source.requirements, source.refundProcess,
    ]);
    if (result.rowCount !== 1) { res.status(409).json({ error: "Translation is currently processing" }); return; }
    invalidatePublicCatalogRenderCache({ entityType: "catalog" });
    invalidatePublicWebDiscoveryCache();
    await logAudit(req.user!.id, "program_translation.manual_publish", "program", id, { locale }, req.ip);
    res.json({ programId: id, locale, status: "published", isManual: true });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Invalid translation" });
  }
});

router.patch("/programs/:id", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const updates: Record<string, unknown> = {};
  for (const key of PROG_PATCH_FIELDS) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }
  try {
    if (updates.languageRequirements !== undefined) updates.languageRequirements = normalizeLanguageRequirements(updates.languageRequirements);
    if (updates.admissionSourceUrl !== undefined) updates.admissionSourceUrl = normalizeAdmissionUrl(updates.admissionSourceUrl);
    if (updates.admissionVerifiedAt !== undefined) updates.admissionVerifiedAt = normalizeAdmissionDate(updates.admissionVerifiedAt);
    if (updates.admissionValidUntil !== undefined) updates.admissionValidUntil = normalizeAdmissionDate(updates.admissionValidUntil, "admissionValidUntil");
    if (updates.sourceMetadata !== undefined) updates.sourceMetadata = normalizeCatalogSourceMetadata("program", updates.sourceMetadata);
    if (updates.currency !== undefined) updates.currency = normalizeCurrency(updates.currency);
    for (const key of ["applicationsOpenOverrideAt", "applicationDeadlineOverrideAt"] as const) {
      if (updates[key] !== undefined) updates[key] = optionalDateOnly(updates[key], key);
    }
    for (const key of ["classesStartOverrideOn", "classesEndOverrideOn", "priceValidFrom", "priceValidUntil"] as const) {
      if (updates[key] !== undefined) updates[key] = optionalDateOnly(updates[key], key);
    }
  } catch (error) { res.status(400).json({ error: (error as Error).message }); return; }
  if (updates.quota !== undefined) {
    if (updates.quota === null || updates.quota === "") {
      updates.quota = null;
    } else {
      const qv = Math.round(Number(updates.quota));
      if (isNaN(qv) || qv < 1) { res.status(400).json({ error: "quota must be a positive integer (>= 1) or null" }); return; }
      updates.quota = qv;
    }
  }
  const [currentProgram] = await db.select().from(programsTable).where(eq(programsTable.id, id));
  if (!currentProgram) { res.status(404).json({ error: "Program not found" }); return; }
  const mergedProgram = { ...currentProgram, ...updates } as typeof currentProgram;
  try {
    updates.universityApplicationPeriodId = await requireProgramPeriodScope(
      Number(updates.universityId ?? currentProgram.universityId),
      mergedProgram.universityApplicationPeriodId,
    );
    const hasAnyFee = [mergedProgram.tuitionFee, mergedProgram.scholarship, mergedProgram.applicationFee, mergedProgram.enrollmentFee, mergedProgram.adaptationFee, mergedProgram.advancedFee, mergedProgram.depositFee, mergedProgram.serviceFeeAmount, mergedProgram.discountedFee, mergedProgram.languageFee]
      .some(value => value != null);
    if (hasAnyFee && !mergedProgram.currency) throw new Error("currency is required when a fee is provided");
    if (mergedProgram.priceValidFrom && mergedProgram.priceValidUntil && mergedProgram.priceValidUntil < mergedProgram.priceValidFrom) throw new Error("priceValidUntil cannot be before priceValidFrom");
    await validateProgramCalendar(mergedProgram);
    if (mergedProgram.applicationsOpenOverrideAt && mergedProgram.applicationDeadlineOverrideAt && mergedProgram.applicationDeadlineOverrideAt < mergedProgram.applicationsOpenOverrideAt) throw new Error("program application deadline override cannot be before opening");
    if (mergedProgram.classesStartOverrideOn && mergedProgram.classesEndOverrideOn && mergedProgram.classesEndOverrideOn < mergedProgram.classesStartOverrideOn) throw new Error("program class end override cannot be before class start");
    requireCurrentAdmissionEvidence({
      source: mergedProgram.admissionSourceUrl,
      verifiedAt: mergedProgram.admissionVerifiedAt,
      validUntil: mergedProgram.admissionValidUntil,
      hasRules: Boolean(mergedProgram.requiredEducationLevel) || mergedProgram.minGradeValue != null
        || (mergedProgram.languageRequirements?.length ?? 0) > 0,
    });
  } catch (error) { res.status(400).json({ error: (error as Error).message }); return; }
  if (Object.keys(updates).length === 0) { res.status(400).json({ error: "No valid fields" }); return; }
  const [prog] = await db.update(programsTable).set(updates).where(eq(programsTable.id, id)).returning();
  if (!prog) { res.status(404).json({ error: "Program not found" }); return; }
  invalidatePublicCatalogRenderCache({ entityType: "catalog" });
  invalidatePublicWebDiscoveryCache();
  await logAudit(req.user!.id, "update_program", "program", id, updates, req.ip);
  res.json(prog);
});

router.delete("/programs/:id", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(programsTable).where(eq(programsTable.id, id));
  invalidatePublicCatalogRenderCache({ entityType: "catalog" });
  invalidatePublicWebDiscoveryCache();
  await logAudit(req.user!.id, "delete_program", "program", id, {}, req.ip);
  res.sendStatus(204);
});

router.delete("/programs", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  const result = await db.delete(programsTable).returning({ id: programsTable.id });
  if (result.length > 0) {
    invalidatePublicCatalogRenderCache({ entityType: "catalog" });
    invalidatePublicWebDiscoveryCache();
  }
  await logAudit(req.user!.id, "delete_all_programs", "program", undefined, { count: result.length }, req.ip);
  res.json({ deleted: result.length });
});

export default router;
