import { and, desc, eq, ilike, isNull, or } from "drizzle-orm";
import {
  db,
  documentsTable,
  studentsTable,
} from "@workspace/db";
import {
  getAnthropicClient,
  getClaudeConfig,
} from "@workspace/integrations-anthropic-ai";
import { validatePassportNumber } from "@workspace/portal-adapters";
import { loadDocumentBytes } from "./documentBytes.js";
import { normalizeInboxStudentExtraction } from "./inboxStudentExtraction.js";
import { logAudit } from "./auth.js";

export interface PortalProfileAutoExtractResult {
  status:
    | "updated"
    | "no_passport_document"
    | "no_missing_fields"
    | "low_confidence"
    | "unreadable"
    | "ai_unavailable";
  fields: string[];
}

const PROMPT = `You extract identity data from an official passport for a university application.
Return ONLY one JSON object with these keys:
{
  "dateOfBirth": "YYYY-MM-DD or null",
  "gender": "male|female or null",
  "nationality": "full English country name or null",
  "passportNumber": "string or null",
  "passportIssueDate": "YYYY-MM-DD or null",
  "passportExpiry": "YYYY-MM-DD or null",
  "motherName": "exact text or null",
  "fatherName": "exact text or null",
  "confidence": "high|medium|low"
}
Never guess. Passport number must be cross-checked against the MRZ when present.
If any character or date is uncertain, use null.`;

const FIELD_MAP = {
  dateOfBirth: studentsTable.dateOfBirth,
  gender: studentsTable.gender,
  nationality: studentsTable.nationality,
  passportNumber: studentsTable.passportNumber,
  passportIssueDate: studentsTable.passportIssueDate,
  passportExpiry: studentsTable.passportExpiry,
  motherName: studentsTable.motherName,
  fatherName: studentsTable.fatherName,
} as const;

type ExtractField = keyof typeof FIELD_MAP;

const has = (value: unknown): boolean =>
  value != null && String(value).trim() !== "";

const EXTRACT_ALIASES: Record<ExtractField, string[]> = {
  dateOfBirth: ["dateOfBirth", "birthDate", "dob"],
  gender: ["gender", "sex"],
  nationality: ["nationality", "citizenship"],
  passportNumber: ["passportNumber", "passportNo"],
  passportIssueDate: ["passportIssueDate", "issueDate"],
  passportExpiry: ["passportExpiry", "passportExpiryDate", "expiryDate"],
  motherName: ["motherName"],
  fatherName: ["fatherName"],
};

function readExtractedField(
  extracted: Record<string, unknown>,
  field: ExtractField,
): unknown {
  for (const key of EXTRACT_ALIASES[field]) {
    if (has(extracted[key])) return extracted[key];
  }
  return null;
}

function validIsoDate(value: unknown): value is string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ""))) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value;
}

function safeExtractedValue(
  field: ExtractField,
  value: unknown,
): string | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (
    field === "dateOfBirth" ||
    field === "passportIssueDate" ||
    field === "passportExpiry"
  ) {
    return validIsoDate(text) ? text : null;
  }
  if (field === "gender") {
    return /^(male|female)$/.test(text.toLowerCase())
      ? text.toLowerCase()
      : null;
  }
  if (field === "passportNumber") {
    return validatePassportNumber(text) ? null : text;
  }
  return text.slice(0, 255);
}

export async function autoFillMissingProfileFromPassport(opts: {
  studentId: number;
  actorUserId: number | null;
  ip?: string;
  requiredFields?: readonly string[];
}): Promise<PortalProfileAutoExtractResult> {
  const [student] = await db
    .select()
    .from(studentsTable)
    .where(and(
      eq(studentsTable.id, opts.studentId),
      isNull(studentsTable.deletedAt),
    ));
  if (!student) return { status: "unreadable", fields: [] };

  const requested = opts.requiredFields
    ? new Set(opts.requiredFields)
    : null;
  const isRequested = (field: ExtractField): boolean =>
    !requested ||
    requested.has(field) ||
    (field === "passportExpiry" && requested.has("passportExpiryDate"));
  const missing = (Object.keys(FIELD_MAP) as ExtractField[])
    .filter((field) => isRequested(field) && !has(student[field]));
  if (missing.length === 0) {
    return { status: "no_missing_fields", fields: [] };
  }

  const [document] = await db
    .select()
    .from(documentsTable)
    .where(and(
      eq(documentsTable.studentId, opts.studentId),
      isNull(documentsTable.deletedAt),
      or(
        ilike(documentsTable.type, "%passport%"),
        ilike(documentsTable.type, "%pasaport%"),
        ilike(documentsTable.name, "%passport%"),
        ilike(documentsTable.name, "%pasaport%"),
      ),
    ))
    .orderBy(desc(documentsTable.createdAt), desc(documentsTable.id))
    .limit(1);
  if (!document) return { status: "no_passport_document", fields: [] };

  let extracted: Record<string, unknown> | null = null;
  if (document.extractedData) {
    try {
      extracted = JSON.parse(document.extractedData) as Record<string, unknown>;
    } catch {
      extracted = null;
    }
  }

  if (!extracted) {
    const bytes = await loadDocumentBytes(document);
    if (!bytes) return { status: "unreadable", fields: [] };
    const mime = bytes.mimeType.toLowerCase();
    const isPdf = mime === "application/pdf";
    const supportedImage = [
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
    ].includes(mime);
    if (!isPdf && !supportedImage) {
      return { status: "unreadable", fields: [] };
    }

    try {
      const [anthropic, config] = await Promise.all([
        getAnthropicClient(),
        getClaudeConfig(),
      ]);
      const source = {
        type: "base64" as const,
        media_type: mime,
        data: bytes.buffer.toString("base64"),
      };
      const content = isPdf
        ? [
            { type: "text" as const, text: PROMPT },
            { type: "document" as const, source },
          ]
        : [
            { type: "text" as const, text: PROMPT },
            { type: "image" as const, source },
          ];
      const message = await anthropic.messages.create({
        model: config.model || "claude-sonnet-4-6",
        max_tokens: 2048,
        messages: [{ role: "user", content: content as never }],
      });
      const textBlock = message.content.find((block) => block.type === "text");
      const json = textBlock?.type === "text"
        ? textBlock.text.match(/\{[\s\S]*\}/)?.[0]
        : null;
      if (!json) return { status: "unreadable", fields: [] };
      extracted = normalizeInboxStudentExtraction(
        JSON.parse(json) as Record<string, unknown>,
      );
      await db.update(documentsTable)
        .set({
          extractedData: JSON.stringify(extracted),
          confidenceScore:
            extracted.confidence === "high"
              ? 1
              : extracted.confidence === "medium" ? 0.6 : 0.3,
        })
        .where(eq(documentsTable.id, document.id));
    } catch {
      return { status: "ai_unavailable", fields: [] };
    }
  }

  const highConfidence =
    extracted.confidence === "high" ||
    (document.confidenceScore ?? 0) >= 0.9;
  if (!highConfidence) return { status: "low_confidence", fields: [] };

  const patch: Record<string, string> = {};
  for (const field of missing) {
    const value = safeExtractedValue(
      field,
      readExtractedField(extracted, field),
    );
    if (value) patch[field] = value;
  }
  if (Object.keys(patch).length === 0) {
    return { status: "unreadable", fields: [] };
  }

  await db.update(studentsTable)
    .set(patch)
    .where(and(
      eq(studentsTable.id, opts.studentId),
      isNull(studentsTable.deletedAt),
    ));

  const fields = Object.keys(patch);
  await logAudit(
    opts.actorUserId,
    "portal_preflight_auto_fill_identity",
    "student",
    opts.studentId,
    { documentId: document.id, fields, confidence: "high" },
    opts.ip,
  );
  return { status: "updated", fields };
}
