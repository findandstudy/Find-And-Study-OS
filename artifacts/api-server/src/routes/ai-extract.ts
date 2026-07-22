import { Router, type IRouter, type Request, type Response, type NextFunction, json } from "express";
import * as XLSX from "xlsx";
import { z } from "zod";
import { requireAuth, requireRole, requireAgentStaffPermission, logAudit } from "../lib/auth";
import { STAFF_ROLES } from "../lib/roles";
import { validate, getValidated } from "../middlewares/validate";
import { getAnthropicClient, getClaudeConfig } from "@workspace/integrations-anthropic-ai";
import { normalizeGpaTo100 } from "../lib/gpaNormalize";
import { canonicalCountry, cleanCity } from "@workspace/db";
import {
  buildExtractionPrompt,
  getActiveExtractor,
  isFallbackExtractor,
  recordExtractorRun,
} from "../lib/aiExtractorService";
import {
  db,
  educationRecordsTable,
  studentsTable,
  applicationsTable,
  programsTable,
  documentsTable,
  studentEducationRecordsTable,
} from "@workspace/db";
import { eq, desc, and, isNull, inArray, asc } from "drizzle-orm";
import { isPassportExpired } from "../lib/passportValidity";
import { loadDocumentBytes } from "../lib/documentBytes";
import {
  buildEducationPromptSection,
  mapExtractionToEducation,
  decideEducationExtraction,
} from "../lib/educationExtraction";

// AI extraction endpoints accept base64-encoded PDF/image documents in the
// JSON body. Base64 inflates payload size by ~33%, and the route itself
// allows up to 10 MB of raw document data — so the global 1mb body limit
// blocks legitimate requests before they reach the route. These routes are
// gated by requireAuth + aiRateLimit so a higher local limit is acceptable.
const aiJson = json({ limit: "20mb" });

/**
 * Convert whatever GPA string the AI extracted from a diploma/transcript
 * into a 0-100 percentage number. The AI is allowed to return the value
 * in its native scale (e.g. "3.5/4", "85%", "15/20") and we normalize it
 * server-side so every consumer (panel form, public-apply form, widget)
 * sees the same percent value. Returns the original raw string in
 * `gpaRaw` for traceability and a rounded percent string in `gpa`.
 */
function normalizeExtractedGpa(extracted: Record<string, any>): void {
  if (extracted.gpa == null || extracted.gpa === "") return;
  const raw = String(extracted.gpa);
  const pct = normalizeGpaTo100(raw);
  if (!isNaN(pct)) {
    extracted.gpaRaw = raw;
    // Portal compatibility: SIT/Zoho rejects decimal GPA — integer 0–100.
    extracted.gpa = String(Math.min(100, Math.max(0, Math.round(pct))));
    extracted.gpaScale = 100;
  }
}

function applyExtractorNormalize(extractor: { fields: any[] }, extracted: Record<string, any>): void {
  for (const f of (extractor.fields as any[]) || []) {
    if (f.normalize === "gpa100" && extracted[f.key] != null && extracted[f.key] !== "") {
      const pct = normalizeGpaTo100(String(extracted[f.key]));
      if (!isNaN(pct)) {
        extracted[`${f.key}Raw`] = extracted[f.key];
        // Portal compatibility: integer 0–100 (SIT/Zoho rejects decimals).
        extracted[f.key] = String(Math.min(100, Math.max(0, Math.round(pct))));
        extracted[`${f.key}Scale`] = 100;
      }
    }
  }
}

const router: IRouter = Router();

const aiRateLimitMap = new Map<string, { count: number; resetAt: number }>();
function aiRateLimit(maxRequests: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `ai:${(req as any).user?.id || req.ip}`;
    const now = Date.now();
    const entry = aiRateLimitMap.get(key);
    if (!entry || now > entry.resetAt) {
      aiRateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    if (entry.count >= maxRequests) {
      res.status(429).json({ error: "Too many requests. Please try again later." });
      return;
    }
    entry.count++;
    next();
  };
}

const DEFAULT_VISION_MODEL = "claude-sonnet-4-6";
const DEFAULT_CSV_MODEL = "claude-haiku-4-5";

const EXTRACT_PROMPT = `You are an expert document analysis system for an education consultancy. 
Analyze the provided document image(s) and extract student information.

Extract ALL of the following fields if visible in the document. Return a JSON object with these exact keys:
{
  "firstName": "string or null - EXACTLY as printed on the document, preserving original spelling and capitalization",
  "lastName": "string or null - EXACTLY as printed on the document, preserving original spelling and capitalization",
  "dateOfBirth": "YYYY-MM-DD format or null",
  "nationality": "country name string (e.g. 'Afghanistan' not 'Afghan', 'Turkey' not 'Turkish', 'Iran' not 'Iranian', 'Pakistan' not 'Pakistani', 'Uzbekistan' not 'Uzbek', 'India' not 'Indian') or null",
  "passportNumber": "string or null",
  "passportIssueDate": "YYYY-MM-DD format or null",
  "passportExpiry": "YYYY-MM-DD format or null",
  "passportExpired": "boolean - true if passport expiry date has passed, false otherwise, null if no expiry date found",
  "motherName": "string or null - EXACTLY as printed on the document",
  "fatherName": "string or null - EXACTLY as printed on the document",
  "email": "string or null",
  "phone": "string or null",
  "address": "string or null",
  "highSchool": "string or null",
  "graduationYear": "number or null",
  "gpa": "string or null",
  "languageScore": "string or null",
  "documentType": "passport|diploma|transcript|photo|other",
  "confidence": "high|medium|low",
  "extractedNotes": "any additional relevant notes found in the document",
  "institutionName": "string or null - name of the school/university on a diploma or transcript",
  "fieldOfStudy": "string or null - major, department, or program name (diploma/transcript)",
  "country": "string or null - country where the institution is located (diploma/transcript)",
  "eduCity": "string or null - city where the institution is located (diploma/transcript)",
  "eduStartMonth": "string or null - English month name when studies started (e.g. 'September')",
  "eduStartYear": "number or null - 4-digit year when studies started",
  "eduEndMonth": "string or null - English month name of graduation/completion (e.g. 'June')",
  "eduLanguageScore": "string or null - language proficiency test score visible on the document (e.g. 'IELTS 6.5', 'TOEFL 90')",
  "countryOfResidence": "string or null - full English country name where the student currently lives (e.g. 'Turkey', 'Afghanistan'), if visible",
  "city": "string or null - ONLY the city name where the student currently lives (e.g. 'Istanbul'). Never include street, building number, district or postal code"
}

Rules:
- CRITICAL - Names: Extract names EXACTLY as they appear on the passport or official document. The passport is the authoritative source for the person's legal name. Do NOT modify, translate, or reformat names. Copy them character by character as printed.
- CRITICAL - Date format awareness: Different countries use different date formats on passports:
  * Most countries (Europe, Asia, Middle East, Africa): DD/MM/YYYY or DD.MM.YYYY (day first)
  * USA, Philippines, some others: MM/DD/YYYY (month first)
  * East Asian countries (Japan, China, Korea): YYYY/MM/DD (year first)
  * Look at the passport's issuing country to determine the likely date format
  * When a date is ambiguous (e.g. 03/04/2025 could be March 4 or April 3), use the issuing country's convention
  * Always output dates in YYYY-MM-DD format after correctly interpreting the source format
- CRITICAL - Passport expiry: Check if the passport expiry date has passed relative to today's date. Set passportExpired to true if expired, false if still valid.
- CRITICAL - Never fabricate values: if you cannot confidently read a field, set it to null. Do not guess.
- For passport documents: extract all passport fields, name, DOB, nationality, issue/expiry dates, mother name, father name (often listed on passport identity pages)
- For diplomas: extract institutionName, country, eduCity, fieldOfStudy, eduStartMonth, eduStartYear, eduEndMonth, graduationYear (=eduEndYear), GPA, student name, parent names if visible
- For transcripts: extract institutionName, country, eduCity, fieldOfStudy, GPA, graduationYear, student name; include eduLanguageScore if a language test appears
- For photos: only set confidence to "low", documentType to "photo", everything else null
- For nationality: always return the full country name (e.g. "Afghanistan" not "Afghan", "Turkey" not "Turkish", "Iran" not "Iranian", "Pakistan" not "Pakistani", "Uzbekistan" not "Uzbek", "India" not "Indian"). Convert any demonym/adjective form to the full country name.
- Always normalize dates to YYYY-MM-DD format
- GPA must be returned exactly as printed (native scale); it will be normalized server-side to an INTEGER percentage
- countryOfResidence must be a full English country name (never a demonym, city or address fragment)
- city must be a bare city name only — if you only see a full address line and cannot isolate the city, set city to null
- Return ONLY the JSON object, no other text
- Set null for fields you cannot find or are not sure about`;

router.post("/ai/extract-document", requireAuth, aiRateLimit(10, 15 * 60 * 1000), aiJson, async (req, res): Promise<void> => {
  const runStart = Date.now();
  const requestedLang = ((req as any).body?.lang || req.headers["accept-language"] || "en").toString().slice(0, 2);
  // The authenticated /ai/extract-document endpoint is shared between staff
  // and agent panels. Clients may pass a `scope` field so admins can wire a
  // separate extractor (prompt, fields, model) per audience.
  const requestedScope = ((req as any).body?.scope || "staff").toString();
  const scope: "staff" | "agent" = requestedScope === "agent" ? "agent" : "staff";
  const extractor = await getActiveExtractor(scope);
  try {
    const { documents } = req.body as {
      documents: Array<{
        type: "image" | "pdf";
        data: string;
        mediaType: string;
        label: string;
      }>;
    };

    if (!documents || !Array.isArray(documents) || documents.length === 0) {
      res.status(400).json({ error: "No documents provided" });
      return;
    }

    let anthropic;
    let claudeConfig;
    try {
      anthropic = await getAnthropicClient();
      claudeConfig = await getClaudeConfig();
    } catch (err: any) {
      res.status(503).json({ error: err.message || "AI integration not configured" });
      return;
    }

    if (extractor.provider !== "anthropic") {
      res.status(400).json({
        error: `Provider "${extractor.provider}" is not yet wired into the runtime. Set the active extractor's provider to "anthropic" in the admin panel.`,
      });
      return;
    }
    // Backward compatibility: when no DB extractor is configured for this scope,
    // keep the exact legacy prompt + token defaults so existing callers see no
    // behavioural change. As soon as an admin defines an extractor, the dynamic
    // prompt + per-extractor model/tokens take over.
    const useLegacy = isFallbackExtractor(extractor);
    let promptText = useLegacy ? EXTRACT_PROMPT : buildExtractionPrompt(extractor, { lang: requestedLang });

    // FAZ 3 — level-based education extraction. Resolve the applied study
    // level from the student's interestedLevel, falling back to the level
    // (degree) of the most recent application's program. When resolvable,
    // instruct the AI which education records to fill.
    let appliedLevelKey: string | null = null;
    {
      const studentIdParam = Number((req.body as { studentId?: unknown })?.studentId);
      const explicitLevel = (req.body as { appliedLevel?: unknown })?.appliedLevel;
      if (typeof explicitLevel === "string" && explicitLevel.trim()) {
        appliedLevelKey = explicitLevel.trim();
      } else if (Number.isFinite(studentIdParam) && studentIdParam > 0) {
        try {
          const [stu] = await db.select({ interestedLevel: studentsTable.interestedLevel })
            .from(studentsTable)
            .where(and(eq(studentsTable.id, studentIdParam), isNull(studentsTable.deletedAt)));
          if (stu?.interestedLevel && stu.interestedLevel.trim()) {
            appliedLevelKey = stu.interestedLevel.trim();
          } else {
            const [appRow] = await db.select({ degree: programsTable.degree })
              .from(applicationsTable)
              .innerJoin(programsTable, eq(applicationsTable.programId, programsTable.id))
              .where(eq(applicationsTable.studentId, studentIdParam))
              .orderBy(desc(applicationsTable.id))
              .limit(1);
            if (appRow?.degree && appRow.degree.trim()) appliedLevelKey = appRow.degree.trim();
          }
        } catch (levelErr) {
          console.warn("[ai-extract] applied-level lookup failed (non-fatal):", levelErr);
        }
      }
    }
    if (appliedLevelKey) {
      promptText += "\n" + buildEducationPromptSection(appliedLevelKey);
    }

    const contentBlocks: any[] = [
      { type: "text", text: promptText },
    ];

    for (const doc of documents) {
      contentBlocks.push({
        type: "text",
        text: `\n--- Document: ${doc.label} ---`,
      });

      if (doc.type === "image") {
        const validMediaTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
        const mediaType = validMediaTypes.includes(doc.mediaType) ? doc.mediaType : "image/jpeg";
        contentBlocks.push({
          type: "image",
          source: {
            type: "base64",
            media_type: mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
            data: doc.data,
          },
        });
      } else {
        contentBlocks.push({
          type: "document",
          source: {
            type: "base64",
            media_type: "application/pdf",
            data: doc.data,
          },
        });
      }
    }

    const model = useLegacy
      ? (claudeConfig.model || DEFAULT_VISION_MODEL)
      : (extractor.model || claudeConfig.model || DEFAULT_VISION_MODEL);
    const maxTokens = useLegacy ? 8192 : (extractor.maxTokens || 8192);
    const message = await anthropic.messages.create({
      model,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: contentBlocks }],
    });

    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      res.status(500).json({ error: "No response from AI" });
      return;
    }

    let extracted: Record<string, any> = {};
    try {
      const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        extracted = JSON.parse(jsonMatch[0]);
      }
    } catch {
      res.status(500).json({ error: "Failed to parse AI response" });
      return;
    }

    if (useLegacy) {
      normalizeExtractedGpa(extracted);
    } else {
      applyExtractorNormalize(extractor, extracted);
    }

    const warnings: string[] = [];

    if (extracted.passportExpiry) {
      const parts = String(extracted.passportExpiry).split("-").map(Number);
      const expiryDate = parts.length === 3 ? new Date(parts[0], parts[1] - 1, parts[2]) : new Date(NaN);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (!isNaN(expiryDate.getTime()) && expiryDate < today) {
        extracted.passportExpired = true;
        warnings.push(`Passport has expired on ${extracted.passportExpiry}. This passport cannot be used for applications.`);
      } else if (!isNaN(expiryDate.getTime())) {
        extracted.passportExpired = false;
      }
    }

    // FAZ 3 — stable soft-warning code (never blocks extraction). Frontend
    // translates this in Faz 4; keep the code stable.
    if (isPassportExpired(typeof extracted.passportExpiry === "string" ? extracted.passportExpiry : null)) {
      if (!warnings.includes("PASSPORT_EXPIRED")) warnings.push("PASSPORT_EXPIRED");
    }

    // Portal Uyumluluk Katmanı — soft normalization of residence country and
    // city. Never blocks extraction; unmatched values are cleared with a
    // stable warning code so the UI can flag them.
    if (extracted.countryOfResidence != null && String(extracted.countryOfResidence).trim() !== "") {
      const rawResidence = String(extracted.countryOfResidence).trim();
      const canon = canonicalCountry(rawResidence);
      if (canon) {
        extracted.countryOfResidence = canon;
      } else {
        extracted.countryOfResidenceRaw = rawResidence;
        extracted.countryOfResidence = null;
        warnings.push("RESIDENCE_COUNTRY_UNMATCHED");
      }
    }
    if (extracted.city != null && String(extracted.city).trim() !== "") {
      const rawCity = String(extracted.city).trim();
      const cleaned = cleanCity(rawCity);
      if (cleaned) {
        extracted.city = cleaned;
      } else {
        extracted.cityRaw = rawCity;
        extracted.city = null;
        warnings.push("CITY_UNCLEAN");
      }
    }

    // FAZ 3 — map AI educationRecords[] to the PUT /students/:id/education
    // body shape, filtered/ordered by the applied level's required records,
    // with the GPA-percent guarantee applied.
    const education = appliedLevelKey
      ? mapExtractionToEducation(extracted.educationRecords, appliedLevelKey)
      : [];

    // FIX-15D: Auto-upsert education_records when diploma or transcript is extracted
    // and a studentId is provided in the request body.
    // Confidence gating: skip upsert when AI reports low confidence to avoid persisting
    // unreliable data. Add a note to extractedNotes so the staff member is aware.
    if (extracted.confidence === "low") {
      extracted.extractedNotes = [
        extracted.extractedNotes,
        "Low confidence — extracted fields were not auto-saved. Please review and save manually.",
      ].filter(Boolean).join(" ");
    }

    const studentIdRaw = (req.body as any)?.studentId;
    const eduUpserted = { skipped: true, level: null as string | null };
    const skipDueToLowConfidence = extracted.confidence === "low";
    if (!skipDueToLowConfidence && studentIdRaw && /diploma|transcript|degree/i.test(String(extracted.documentType || ""))) {
      const studentId = Number(studentIdRaw);
      if (Number.isFinite(studentId) && studentId > 0) {
        try {
          // Determine education level — eduLevel canonical field takes priority.
          const eduLevelNorm = String(extracted.eduLevel || "").toLowerCase().replace(/[-\s]+/g, "_").trim();
          let level: "high_school" | "bachelor" | "master";
          if (eduLevelNorm === "high_school" || eduLevelNorm === "high school" || eduLevelNorm === "highschool") {
            level = "high_school";
          } else if (eduLevelNorm === "master") {
            level = "master";
          } else if (eduLevelNorm === "bachelor") {
            level = "bachelor";
          } else {
            // Fallback: keyword scan of degree / level / documentType fields
            const degreeRaw = String(extracted.degree || extracted.level || extracted.documentType || "").toLowerCase();
            if (/high.?school|secondary|lisans öncesi/i.test(degreeRaw)) level = "high_school";
            else if (/master|msc|ma\b|mba|graduate/i.test(degreeRaw)) level = "master";
            else level = "bachelor";
          }

          // Derive gpaType from gpaScale returned by normalizer
          const gpaType: string | null =
            extracted.gpaScale === 100 ? "percentage" :
            extracted.gpaScale === 4   ? "4.0" :
            null;

          // Parse graduation year from extracted data for endYear
          const endYear = extracted.graduationYear
            ? Number(String(extracted.graduationYear).slice(0, 4))
            : null;

          // Parse start year from extracted data
          const startYearRaw = extracted.eduStartYear
            ? Number(String(extracted.eduStartYear).slice(0, 4))
            : null;
          const startYear = Number.isFinite(startYearRaw) && startYearRaw! > 1900 ? startYearRaw : null;

          const upsertRow = {
            studentId,
            level,
            schoolName:    extracted.institutionName ?? extracted.schoolName ?? null,
            country:       extracted.country ?? null,
            city:          extracted.eduCity ?? null,
            fieldOfStudy:  extracted.fieldOfStudy ?? extracted.major ?? null,
            startMonth:    extracted.eduStartMonth ?? null,
            startYear,
            endMonth:      extracted.eduEndMonth ?? null,
            endYear:       Number.isFinite(endYear) ? endYear : null,
            gpa:           extracted.gpa ? String(extracted.gpa) : null,
            gpaType,
            languageScore: extracted.eduLanguageScore ?? null,
            source:        "ai_extracted" as const,
          };

          await db
            .insert(educationRecordsTable)
            .values(upsertRow)
            .onConflictDoUpdate({
              target: [educationRecordsTable.studentId, educationRecordsTable.level],
              set: {
                ...upsertRow,
                updatedAt: new Date(),
              },
            });
          eduUpserted.skipped = false;
          eduUpserted.level = level;
        } catch (upsertErr) {
          // Non-fatal — AI extraction result is still returned to client.
          console.warn("[ai-extract] education_records upsert failed (non-fatal):", upsertErr);
        }
      }
    }

    res.json({ extracted, warnings, extractorId: extractor.id || null, eduUpserted, education, appliedLevel: appliedLevelKey });
    await recordExtractorRun({
      extractorId: extractor.id,
      scope: "staff",
      documentCount: documents.length,
      documentTypes: [extracted.documentType].filter(Boolean) as string[],
      model,
      promptTokens: (message as any).usage?.input_tokens ?? null,
      completionTokens: (message as any).usage?.output_tokens ?? null,
      latencyMs: Date.now() - runStart,
      status: "success",
      triggeredBy: (req as any).user?.id ?? null,
    });
  } catch (err: any) {
    console.error("AI extraction error:", err);
    res.status(500).json({ error: "AI extraction failed" });
    await recordExtractorRun({
      extractorId: extractor.id,
      scope: "staff",
      documentCount: 0,
      model: extractor.model,
      latencyMs: Date.now() - runStart,
      status: "error",
      errorMessage: String(err?.message || err),
      triggeredBy: (req as any).user?.id ?? null,
    });
  }
});

const LEAD_FIELDS = [
  "firstName", "lastName", "email", "phone", "nationality",
  "interestedProgram", "interestedUniversity", "interestedCountry",
  "source", "estimatedValue", "notes",
];
const STUDENT_FIELDS = [
  "firstName", "lastName", "email", "phone", "nationality", "dateOfBirth",
  "passportNumber", "highSchool", "graduationYear", "gpa", "languageScore",
  "motherName", "fatherName", "passportExpiry", "passportIssueDate", "address", "notes",
];

// Maximum data rows accepted per bulk import to protect the DB / request budget.
const BULK_CSV_MAX_ROWS = 5000;

function normHeader(h: string): string {
  return String(h ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Synonyms shared by both entities (names, contact, nationality, notes).
const SHARED_SYNONYMS: Record<string, string> = {
  firstname: "firstName", fname: "firstName", givenname: "firstName", givennames: "firstName",
  ad: "firstName", adi: "firstName", isim: "firstName", name: "firstName",
  lastname: "lastName", surname: "lastName", lname: "lastName", familyname: "lastName",
  soyad: "lastName", soyadi: "lastName", soyisim: "lastName",
  email: "email", emailaddress: "email", mail: "email", eposta: "email", epostaadresi: "email",
  phone: "phone", phonenumber: "phone", mobile: "phone", mobilephone: "phone", tel: "phone",
  telephone: "phone", telefon: "phone", gsm: "phone", cep: "phone", ceptelefonu: "phone", whatsapp: "phone",
  nationality: "nationality", citizenship: "nationality", uyruk: "nationality", milliyet: "nationality",
  notes: "notes", note: "notes", comment: "notes", comments: "notes", remarks: "notes",
  aciklama: "notes", description: "notes",
};
const LEAD_SYNONYMS: Record<string, string> = {
  interestedprogram: "interestedProgram", program: "interestedProgram", programofinterest: "interestedProgram",
  bolum: "interestedProgram", department: "interestedProgram", major: "interestedProgram",
  interesteduniversity: "interestedUniversity", university: "interestedUniversity", uni: "interestedUniversity",
  universite: "interestedUniversity",
  interestedcountry: "interestedCountry", destinationcountry: "interestedCountry", targetcountry: "interestedCountry",
  hedefulke: "interestedCountry", country: "interestedCountry",
  source: "source", leadsource: "source", kaynak: "source",
  estimatedvalue: "estimatedValue", value: "estimatedValue", dealvalue: "estimatedValue",
  amount: "estimatedValue", deger: "estimatedValue", tutar: "estimatedValue", budget: "estimatedValue",
};
const STUDENT_SYNONYMS: Record<string, string> = {
  dateofbirth: "dateOfBirth", dob: "dateOfBirth", birthdate: "dateOfBirth", birthday: "dateOfBirth",
  dogumtarihi: "dateOfBirth",
  passportnumber: "passportNumber", passportno: "passportNumber", passport: "passportNumber",
  pasaport: "passportNumber", pasaportno: "passportNumber",
  highschool: "highSchool", school: "highSchool", lise: "highSchool",
  graduationyear: "graduationYear", gradyear: "graduationYear", mezuniyetyili: "graduationYear",
  gpa: "gpa", gradepointaverage: "gpa", ortalama: "gpa",
  languagescore: "languageScore", langscore: "languageScore", ielts: "languageScore",
  toefl: "languageScore", dilpuani: "languageScore",
  mothername: "motherName", anneadi: "motherName",
  fathername: "fatherName", babaadi: "fatherName",
  passportexpiry: "passportExpiry", passportexpiration: "passportExpiry", passportexpirydate: "passportExpiry",
  passportissuedate: "passportIssueDate", passportissue: "passportIssueDate",
  address: "address", adres: "address",
};

function buildHeaderMap(isLead: boolean): Record<string, string> {
  const fields = isLead ? LEAD_FIELDS : STUDENT_FIELDS;
  const map: Record<string, string> = {};
  // Canonical field names always map to themselves.
  for (const f of fields) map[normHeader(f)] = f;
  Object.assign(map, SHARED_SYNONYMS, isLead ? LEAD_SYNONYMS : STUDENT_SYNONYMS);
  // Drop any synonym whose target isn't valid for this entity.
  const valid = new Set(fields);
  for (const k of Object.keys(map)) {
    if (!valid.has(map[k])) delete map[k];
  }
  return map;
}

/**
 * Parse a CSV string into a header row + data rows using SheetJS so quoting,
 * embedded commas and newlines are handled correctly.
 */
function parseCsvRows(csvData: string): string[][] {
  const wb = XLSX.read(csvData, { type: "string", raw: false });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const sheet = wb.Sheets[sheetName];
  return XLSX.utils.sheet_to_json<string[]>(sheet, {
    header: 1,
    defval: "",
    blankrows: false,
    raw: false,
  });
}

router.post("/ai/extract-bulk-csv", requireAuth, aiRateLimit(20, 15 * 60 * 1000), aiJson, async (req, res): Promise<void> => {
  try {
    const { csvData, entity } = req.body as { csvData: string; entity?: "student" | "lead" };
    if (!csvData || !csvData.trim()) {
      res.status(400).json({ error: "No CSV data provided" });
      return;
    }
    const isLead = entity === "lead";
    const fields = isLead ? LEAD_FIELDS : STUDENT_FIELDS;

    const rows = parseCsvRows(csvData);
    if (rows.length < 2) {
      res.json({ students: [], records: [] });
      return;
    }

    const headers = (rows[0] || []).map((h) => String(h ?? "").trim());
    const headerMap = buildHeaderMap(isLead);
    const colToField: (string | null)[] = headers.map((h) => headerMap[normHeader(h)] ?? null);

    // Fuzzy header fallback: if the required name columns weren't recognized,
    // ask the AI to map ONLY the header names (a tiny payload, never row data).
    const haveName = colToField.includes("firstName") && colToField.includes("lastName");
    if (!haveName) {
      const unmappedIdx = colToField
        .map((f, i) => (f === null ? i : -1))
        .filter((i) => i >= 0 && headers[i]);
      if (unmappedIdx.length > 0) {
        try {
          const anthropic = await getAnthropicClient();
          const claudeConfig = await getClaudeConfig();
          const msg = await anthropic.messages.create({
            model: claudeConfig.model || DEFAULT_CSV_MODEL,
            max_tokens: 1024,
            messages: [{
              role: "user",
              content: `Map each CSV column header to exactly one of these canonical field names, or null if none fit. Canonical fields: ${fields.join(", ")}.
Return ONLY a JSON object whose keys are the EXACT header strings and whose values are a canonical field name or null. No explanation.
Headers: ${JSON.stringify(unmappedIdx.map((i) => headers[i]))}`,
            }],
          });
          const tb = msg.content.find((b) => b.type === "text");
          if (tb && tb.type === "text") {
            const m = tb.text.match(/\{[\s\S]*\}/);
            if (m) {
              const mapping = JSON.parse(m[0]) as Record<string, string | null>;
              const validSet = new Set(fields);
              for (const i of unmappedIdx) {
                const target = mapping[headers[i]];
                if (target && validSet.has(target) && !colToField.includes(target)) {
                  colToField[i] = target;
                }
              }
            }
          }
        } catch (err) {
          // AI mapping is best-effort; deterministic mapping still applies.
          console.warn("CSV header AI-mapping fallback failed:", (err as any)?.message || err);
        }
      }
    }

    const records: Record<string, any>[] = [];
    for (let r = 1; r < rows.length && records.length < BULK_CSV_MAX_ROWS; r++) {
      const row = rows[r] || [];
      const rec: Record<string, any> = {};
      for (let c = 0; c < colToField.length; c++) {
        const field = colToField[c];
        if (!field) continue;
        const raw = row[c];
        const v = raw == null ? "" : String(raw).trim();
        if (v === "") continue;
        rec[field] = v;
      }
      // Skip fully empty rows; rows missing names are reported by the bulk insert.
      if (rec.firstName || rec.lastName) records.push(rec);
    }

    res.json({ students: records, records });
  } catch (err: any) {
    console.error("CSV parse error:", err);
    res.status(500).json({ error: "CSV parsing failed" });
  }
});

// ---------------------------------------------------------------------------
// FAZ 1 — POST /ai/students/:id/extract-education
//
// Sends ALL of a student's education-related documents (transcript, diploma,
// "other"; never photo/passport) to the AI in ONE messages.create call, maps
// the returned educationRecords[] to the PUT /students/:id/education body
// shape via mapExtractionToEducation, and idempotently upserts them into
// student_education_records level-by-level (no duplicates thanks to the
// partial unique index on (student_id, level) WHERE deleted_at IS NULL).
//
// Critical gate fix vs /ai/extract-document: even when the AI reports
// confidence === "low", a record is STILL saved as long as at least one of
// institution/program/gpa/graduationYear/languageScore is non-null — the
// response then carries a "LOW_CONFIDENCE_EDUCATION" warning instead of
// silently dropping readable data.
// ---------------------------------------------------------------------------

const EDUCATION_DOC_TYPES = ["transcript", "diploma", "other"] as const;
const IMAGE_MEDIA_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
// Defensive request-budget caps for the single messages.create call.
const MAX_EDUCATION_DOCS = 10;
const MAX_EDUCATION_TOTAL_BYTES = 15 * 1024 * 1024; // raw bytes (~20MB as base64)

const extractEducationParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

/** Resolve the applied study level server-side (never trust the client). */
async function resolveAppliedLevelKey(studentId: number): Promise<string | null> {
  const [stu] = await db.select({ interestedLevel: studentsTable.interestedLevel })
    .from(studentsTable)
    .where(and(eq(studentsTable.id, studentId), isNull(studentsTable.deletedAt)));
  if (stu?.interestedLevel && stu.interestedLevel.trim()) return stu.interestedLevel.trim();
  const [appRow] = await db.select({ degree: programsTable.degree })
    .from(applicationsTable)
    .innerJoin(programsTable, eq(applicationsTable.programId, programsTable.id))
    .where(eq(applicationsTable.studentId, studentId))
    .orderBy(desc(applicationsTable.id))
    .limit(1);
  return appRow?.degree && appRow.degree.trim() ? appRow.degree.trim() : null;
}

router.post(
  "/ai/students/:id/extract-education",
  requireAuth,
  requireRole(...STAFF_ROLES),
  requireAgentStaffPermission("students"),
  aiRateLimit(10, 15 * 60 * 1000),
  validate({ params: extractEducationParamsSchema }),
  async (req, res): Promise<void> => {
    const { id: studentId } = getValidated<{ params: typeof extractEducationParamsSchema }>(req).params;
    try {
      const [student] = await db.select({ id: studentsTable.id })
        .from(studentsTable)
        .where(and(eq(studentsTable.id, studentId), isNull(studentsTable.deletedAt)));
      if (!student) {
        res.status(404).json({ error: "Student not found" });
        return;
      }

      // Level is resolved SERVER-side; without it we cannot build the
      // level-based prompt section, so return early with a stable warning.
      const levelKey = await resolveAppliedLevelKey(studentId);
      if (!levelKey) {
        const decision = decideEducationExtraction({ levelKey: null, documentCount: 0 });
        await logAudit(req.user!.id, "ai_extract_education", "student", studentId, {
          levelKey: null, documentCount: 0, upserted: 0, warnings: decision.warnings,
        }, req.ip);
        res.json({ ...decision, upserted: 0 });
        return;
      }

      // Education-related documents only — photo/passport are never sent.
      const docRows = await db.select({
        id: documentsTable.id,
        name: documentsTable.name,
        type: documentsTable.type,
        fileKey: documentsTable.fileKey,
        fileData: documentsTable.fileData,
        mimeType: documentsTable.mimeType,
      })
        .from(documentsTable)
        .where(and(
          eq(documentsTable.studentId, studentId),
          isNull(documentsTable.deletedAt),
          inArray(documentsTable.type, [...EDUCATION_DOC_TYPES]),
        ))
        .orderBy(asc(documentsTable.id));

      // Reuse the existing storage/base64 fallback chain to load bytes.
      // Defensive caps: never exceed the model request budget — stop adding
      // documents past the raw-byte / count limits (uploads are compressed
      // to <=2MB system-wide, so this only trips on unusual data).
      const loaded: Array<{ label: string; mimeType: string; base64: string }> = [];
      let totalBytes = 0;
      for (const doc of docRows) {
        if (loaded.length >= MAX_EDUCATION_DOCS) {
          console.warn(`[ai-extract-education] student #${studentId}: document count cap (${MAX_EDUCATION_DOCS}) reached — remaining docs skipped`);
          break;
        }
        try {
          const bytes = await loadDocumentBytes(doc);
          if (!bytes) continue;
          const mime = (doc.mimeType || bytes.mimeType || "").toLowerCase();
          const isPdf = mime === "application/pdf";
          const isImage = (IMAGE_MEDIA_TYPES as readonly string[]).includes(mime);
          if (!isPdf && !isImage) continue; // unsupported content for vision
          if (totalBytes + bytes.buffer.length > MAX_EDUCATION_TOTAL_BYTES) {
            console.warn(`[ai-extract-education] student #${studentId}: total byte cap reached — document #${doc.id} and remaining docs skipped`);
            break;
          }
          totalBytes += bytes.buffer.length;
          loaded.push({
            label: `${doc.type}: ${doc.name}`,
            mimeType: mime,
            base64: bytes.buffer.toString("base64"),
          });
        } catch (docErr) {
          console.warn(`[ai-extract-education] failed to load document #${doc.id} (non-fatal):`, docErr);
        }
      }

      if (loaded.length === 0) {
        const decision = decideEducationExtraction({ levelKey, documentCount: 0 });
        await logAudit(req.user!.id, "ai_extract_education", "student", studentId, {
          levelKey, documentCount: 0, upserted: 0, warnings: decision.warnings,
        }, req.ip);
        res.json({ ...decision, upserted: 0 });
        return;
      }

      let anthropic;
      let claudeConfig;
      try {
        anthropic = await getAnthropicClient();
        claudeConfig = await getClaudeConfig();
      } catch (err) {
        res.status(503).json({ error: err instanceof Error ? err.message : "AI integration not configured" });
        return;
      }

      // ALL education documents go in ONE messages.create call, reusing the
      // legacy prompt + the level-based education section.
      const promptText = EXTRACT_PROMPT + "\n" + buildEducationPromptSection(levelKey);
      type ContentBlock =
        | { type: "text"; text: string }
        | { type: "image"; source: { type: "base64"; media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp"; data: string } }
        | { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } };
      const contentBlocks: ContentBlock[] = [{ type: "text", text: promptText }];
      for (const doc of loaded) {
        contentBlocks.push({ type: "text", text: `\n--- Document: ${doc.label} ---` });
        if (doc.mimeType === "application/pdf") {
          contentBlocks.push({
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: doc.base64 },
          });
        } else {
          contentBlocks.push({
            type: "image",
            source: {
              type: "base64",
              media_type: doc.mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
              data: doc.base64,
            },
          });
        }
      }

      const message = await anthropic.messages.create({
        model: claudeConfig.model || DEFAULT_VISION_MODEL,
        max_tokens: 8192,
        messages: [{ role: "user", content: contentBlocks as never }],
      });

      const textBlock = message.content.find((b) => b.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        res.status(500).json({ error: "No response from AI" });
        return;
      }

      let extracted: Record<string, unknown> = {};
      try {
        const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
        if (jsonMatch) extracted = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
      } catch {
        res.status(500).json({ error: "Failed to parse AI response" });
        return;
      }

      // Map to the PUT /students/:id/education body shape (level filter,
      // dedup, GPA guarantee), drop no-data records, and apply the CRITICAL
      // GATE FIX: low confidence never drops readable records — they are
      // saved AND flagged with the stable LOW_CONFIDENCE_EDUCATION warning.
      const { records, warnings } = decideEducationExtraction({
        levelKey,
        documentCount: loaded.length,
        educationRecords: extracted.educationRecords,
        confidence: extracted.confidence,
      });

      // Idempotent, race-safe level-based upsert: ON CONFLICT against the
      // partial unique index on (student_id, level) WHERE deleted_at IS NULL
      // — concurrent calls can never create duplicates or 500 on the index.
      let upserted = 0;
      if (records.length > 0) {
        await db.transaction(async (tx) => {
          for (let i = 0; i < records.length; i++) {
            const rec = records[i];
            const values = {
              studentId,
              level: rec.level,
              institution: rec.institution,
              program: rec.program,
              graduationYear: rec.graduationYear,
              gpa: rec.gpa,
              gpaRaw: rec.gpaRaw,
              gpaScale: rec.gpaScale,
              languageScore: rec.languageScore,
              sortOrder: i,
            };
            await tx.insert(studentEducationRecordsTable)
              .values(values)
              .onConflictDoUpdate({
                target: [studentEducationRecordsTable.studentId, studentEducationRecordsTable.level],
                targetWhere: isNull(studentEducationRecordsTable.deletedAt),
                set: {
                  institution: values.institution,
                  program: values.program,
                  graduationYear: values.graduationYear,
                  gpa: values.gpa,
                  gpaRaw: values.gpaRaw,
                  gpaScale: values.gpaScale,
                  languageScore: values.languageScore,
                  sortOrder: values.sortOrder,
                  updatedAt: new Date(),
                },
              });
            upserted++;
          }
        });
      }

      await logAudit(req.user!.id, "ai_extract_education", "student", studentId, {
        levelKey,
        documentCount: loaded.length,
        upserted,
        warnings,
      }, req.ip);

      res.json({ records, warnings, levelKey, upserted });
    } catch (err) {
      console.error("[ai-extract-education] extraction failed:", err);
      res.status(500).json({ error: "AI extraction failed" });
    }
  },
);

export default router;
