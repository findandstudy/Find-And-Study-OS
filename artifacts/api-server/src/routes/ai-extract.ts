import { Router, type IRouter, type Request, type Response, type NextFunction, json } from "express";
import * as XLSX from "xlsx";
import { requireAuth } from "../lib/auth";
import { getAnthropicClient, getClaudeConfig } from "@workspace/integrations-anthropic-ai";
import { normalizeGpaTo100 } from "../lib/gpaNormalize";
import {
  buildExtractionPrompt,
  getActiveExtractor,
  isFallbackExtractor,
  recordExtractorRun,
} from "../lib/aiExtractorService";
import { db, educationRecordsTable } from "@workspace/db";

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
    extracted.gpa = (Math.round(pct * 10) / 10).toString();
    extracted.gpaScale = 100;
  }
}

function applyExtractorNormalize(extractor: { fields: any[] }, extracted: Record<string, any>): void {
  for (const f of (extractor.fields as any[]) || []) {
    if (f.normalize === "gpa100" && extracted[f.key] != null && extracted[f.key] !== "") {
      const pct = normalizeGpaTo100(String(extracted[f.key]));
      if (!isNaN(pct)) {
        extracted[`${f.key}Raw`] = extracted[f.key];
        extracted[f.key] = (Math.round(pct * 10) / 10).toString();
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
  "extractedNotes": "any additional relevant notes found in the document"
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
- For passport documents: extract all passport fields, name, DOB, nationality, issue/expiry dates, mother name, father name (often listed on passport identity pages)
- For diplomas: extract school name, graduation year, GPA, student name, parent names if visible
- For transcripts: extract school name, GPA, graduation year, student name, courses if relevant
- For photos: only set confidence to "low", documentType to "photo", everything else null
- For nationality: always return the full country name (e.g. "Afghanistan" not "Afghan", "Turkey" not "Turkish", "Iran" not "Iranian", "Pakistan" not "Pakistani", "Uzbekistan" not "Uzbek", "India" not "Indian"). Convert any demonym/adjective form to the full country name.
- Always normalize dates to YYYY-MM-DD format
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
    const promptText = useLegacy ? EXTRACT_PROMPT : buildExtractionPrompt(extractor, { lang: requestedLang });
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

    // FIX-15D: Auto-upsert education_records when diploma or transcript is extracted
    // and a studentId is provided in the request body.
    const studentIdRaw = (req.body as any)?.studentId;
    const eduUpserted = { skipped: true, level: null as string | null };
    if (studentIdRaw && /diploma|transcript|degree/i.test(String(extracted.documentType || ""))) {
      const studentId = Number(studentIdRaw);
      if (Number.isFinite(studentId) && studentId > 0) {
        try {
          // Determine education level from extracted data
          const degreeRaw = String(extracted.degree || extracted.level || extracted.documentType || "").toLowerCase();
          let level: "high_school" | "bachelor" | "master" = "bachelor";
          if (/high.?school|secondary|lisans öncesi/i.test(degreeRaw)) level = "high_school";
          else if (/master|msc|ma\b|mba|graduate/i.test(degreeRaw)) level = "master";

          // Derive gpaType from gpaScale returned by normalizer
          const gpaType: string | null =
            extracted.gpaScale === 100 ? "percentage" :
            extracted.gpaScale === 4   ? "4.0" :
            null;

          // Parse graduation year from extracted data for endYear
          const endYear = extracted.graduationYear
            ? Number(String(extracted.graduationYear).slice(0, 4))
            : null;

          await db
            .insert(educationRecordsTable)
            .values({
              studentId,
              level,
              schoolName:   extracted.institutionName ?? extracted.schoolName ?? null,
              country:      extracted.country ?? null,
              fieldOfStudy: extracted.fieldOfStudy ?? extracted.major ?? null,
              endYear:      Number.isFinite(endYear) ? endYear : null,
              gpa:          extracted.gpa ? String(extracted.gpa) : null,
              gpaType,
              source:       "ai_extracted",
            })
            .onConflictDoUpdate({
              target: [educationRecordsTable.studentId, educationRecordsTable.level],
              set: {
                schoolName:   extracted.institutionName ?? extracted.schoolName ?? null,
                country:      extracted.country ?? null,
                fieldOfStudy: extracted.fieldOfStudy ?? extracted.major ?? null,
                endYear:      Number.isFinite(endYear) ? endYear : null,
                gpa:          extracted.gpa ? String(extracted.gpa) : null,
                gpaType,
                source:       "ai_extracted",
                updatedAt:    new Date(),
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

    res.json({ extracted, warnings, extractorId: extractor.id || null, eduUpserted });
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

export default router;
