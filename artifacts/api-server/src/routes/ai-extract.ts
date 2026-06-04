import { Router, type IRouter, type Request, type Response, type NextFunction, json } from "express";
import { requireAuth } from "../lib/auth";
import { getAnthropicClient, getClaudeConfig } from "@workspace/integrations-anthropic-ai";
import { normalizeGpaTo100 } from "../lib/gpaNormalize";
import {
  buildExtractionPrompt,
  getActiveExtractor,
  isFallbackExtractor,
  recordExtractorRun,
} from "../lib/aiExtractorService";

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

    res.json({ extracted, warnings, extractorId: extractor.id || null });
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

router.post("/ai/extract-bulk-csv", requireAuth, aiRateLimit(5, 15 * 60 * 1000), aiJson, async (req, res): Promise<void> => {
  try {
    const { csvData, entity } = req.body as { csvData: string; entity?: "student" | "lead" };
    if (!csvData) {
      res.status(400).json({ error: "No CSV data provided" });
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

    const isLead = entity === "lead";
    const promptIntro = isLead
      ? `Parse this CSV data and extract sales lead records. Return a JSON array of lead objects with keys: firstName, lastName, email, phone, nationality, interestedProgram, interestedUniversity, interestedCountry, source, estimatedValue, notes.`
      : `Parse this CSV data and extract student records. Return a JSON array of student objects with keys: firstName, lastName, email, phone, nationality, dateOfBirth, passportNumber, highSchool, graduationYear, gpa, languageScore, motherName, fatherName, passportExpiry, passportIssueDate, address, notes.`;

    const message = await anthropic.messages.create({
      model: claudeConfig.model || DEFAULT_CSV_MODEL,
      max_tokens: 8192,
      messages: [{
        role: "user",
        content: `${promptIntro}
        
Map any reasonable column name variations (e.g. "first name", "First Name", "firstname" all map to firstName).
Return ONLY the JSON array, no explanation.
Set null for missing values.

CSV:
${csvData.slice(0, 10000)}`,
      }],
    });

    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      res.status(500).json({ error: "No response from AI" });
      return;
    }

    let records: any[] = [];
    try {
      const jsonMatch = textBlock.text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        records = JSON.parse(jsonMatch[0]);
      }
    } catch {
      res.status(500).json({ error: "Failed to parse AI response" });
      return;
    }

    res.json({ students: records, records });
  } catch (err: any) {
    console.error("CSV parse error:", err);
    res.status(500).json({ error: "CSV parsing failed" });
  }
});

export default router;
