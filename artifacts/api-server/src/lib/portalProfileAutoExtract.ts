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
import {
  evaluateSitIdentity,
  sitPassportIdentityProofFromDocument,
  validatePassportNumber,
} from "@workspace/portal-adapters";
import { loadDocumentBytes } from "./documentBytes.js";
import { normalizeInboxStudentExtraction } from "./inboxStudentExtraction.js";
import { logAudit } from "./auth.js";
import { buildPassportDateRepairDecision } from "./portalPassportDateRepair.js";
import {
  hasHighConfidencePassportIdentityExtraction,
  shouldRefreshPassportIdentityExtraction,
  stampPassportIdentityExtraction,
} from "./portalPassportExtractionPolicy.js";

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

export interface PortalPassportIdentityVerificationResult {
  status:
    | "verified"
    | "mismatch"
    | "no_passport_document"
    | "low_confidence"
    | "unreadable"
    | "ai_unavailable";
  fields: string[];
  documentId?: number;
}

export interface PortalProfileDateRepairResult {
  status:
    | "updated"
    | "no_invalid_fields"
    | "no_passport_document"
    | "identity_mismatch"
    | "low_confidence"
    | "unreadable"
    | "ai_unavailable";
  fields: string[];
  documentId?: number;
}

const PROMPT = `You extract identity data from an official passport for a university application.
Return ONLY one JSON object with these keys:
{
  "firstName": "all given names exactly as printed, or null",
  "lastName": "surname exactly as printed, or null",
  "dateOfBirth": "YYYY-MM-DD or null",
  "gender": "male|female or null",
  "nationality": "full English country name or null",
  "passportNumber": "string or null",
  "passportIssueDate": "YYYY-MM-DD or null",
  "passportExpiry": "YYYY-MM-DD or null",
  "motherName": "exact text or null",
  "fatherName": "exact text or null",
  "identityConfidence": "high|medium|low",
  "confidence": "high|medium|low"
}
Never guess. Passport number must be cross-checked against the MRZ when present.
identityConfidence applies ONLY to firstName, lastName and passportNumber. Set it
to high only when all three are clearly legible and the passport number agrees
with the MRZ when an MRZ is present. General confidence may remain medium when a
non-identity field (for example a parent name) is unclear.
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

type PassportDocument = typeof documentsTable.$inferSelect;

type PassportExtractionResult =
  | {
      status: "ok";
      document: PassportDocument;
      extracted: Record<string, unknown>;
      confidenceScore: number;
    }
  | {
      status:
        | "no_passport_document"
        | "unreadable"
        | "ai_unavailable";
      document?: PassportDocument;
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

function parseExtractedData(
  value: string | null | undefined,
): Record<string, unknown> | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function findLatestPassportDocument(
  studentId: number,
): Promise<PassportDocument | null> {
  const [document] = await db
    .select()
    .from(documentsTable)
    .where(and(
      eq(documentsTable.studentId, studentId),
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
  return document ?? null;
}

async function loadPassportExtraction(
  studentId: number,
): Promise<PassportExtractionResult> {
  const document = await findLatestPassportDocument(studentId);
  if (!document) return { status: "no_passport_document" };

  let extracted = parseExtractedData(document.extractedData);
  let confidenceScore = document.confidenceScore ?? 0;

  // Legacy payloads either omitted identity or stored only a document-wide
  // medium score. Re-read once with identity-specific confidence, then stamp
  // the payload so an unclear source does not cause an AI request per click.
  if (shouldRefreshPassportIdentityExtraction(extracted, confidenceScore)) {
    const bytes = await loadDocumentBytes(document);
    if (!bytes) return { status: "unreadable", document };
    const mime = bytes.mimeType.toLowerCase();
    const isPdf = mime === "application/pdf";
    const supportedImage = [
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
    ].includes(mime);
    if (!isPdf && !supportedImage) {
      return { status: "unreadable", document };
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
      if (!json) return { status: "unreadable", document };
      extracted = stampPassportIdentityExtraction(
        normalizeInboxStudentExtraction(
          JSON.parse(json) as Record<string, unknown>,
        ),
      );
      confidenceScore =
        extracted.confidence === "high"
          ? 1
          : extracted.confidence === "medium" ? 0.6 : 0.3;
      await db.update(documentsTable)
        .set({
          extractedData: JSON.stringify(extracted),
          confidenceScore,
        })
        .where(eq(documentsTable.id, document.id));
    } catch {
      return { status: "ai_unavailable", document };
    }
  }

  if (!extracted) return { status: "unreadable", document };
  return { status: "ok", document, extracted, confidenceScore };
}

/**
 * Independently verify CRM name + passport number against the latest passport
 * document. This never repairs a populated identity field: disagreement is a
 * hard, PII-safe fail-closed result that must be reviewed by a human.
 */
export async function verifyStudentIdentityAgainstPassport(opts: {
  studentId: number;
  actorUserId: number | null;
  ip?: string;
}): Promise<PortalPassportIdentityVerificationResult> {
  const [student] = await db
    .select()
    .from(studentsTable)
    .where(and(
      eq(studentsTable.id, opts.studentId),
      isNull(studentsTable.deletedAt),
    ));
  if (!student) return { status: "unreadable", fields: [] };

  const loaded = await loadPassportExtraction(opts.studentId);
  if (loaded.status !== "ok") {
    return {
      status: loaded.status,
      fields: [],
      ...(loaded.document ? { documentId: loaded.document.id } : {}),
    };
  }

  const proof = sitPassportIdentityProofFromDocument({
    extractedData: loaded.extracted,
    confidenceScore: loaded.confidenceScore,
    documentId: loaded.document.id,
  });
  if (!proof) {
    const highConfidence = hasHighConfidencePassportIdentityExtraction(
      loaded.extracted,
      loaded.confidenceScore,
    );
    return {
      status: highConfidence ? "unreadable" : "low_confidence",
      fields: [],
      documentId: loaded.document.id,
    };
  }

  const evaluation = evaluateSitIdentity(
    {
      firstName: student.firstName ?? "",
      lastName: student.lastName ?? "",
      passportNumber: student.passportNumber ?? "",
    },
    proof,
  );
  const fields = [...new Set([
    ...evaluation.missingFields,
    ...evaluation.mismatchedFields,
  ])];
  const status = evaluation.matched ? "verified" : "mismatch";
  await logAudit(
    opts.actorUserId,
    `portal_preflight_identity_${status}`,
    "student",
    opts.studentId,
    { documentId: loaded.document.id, fields, confidence: "high" },
    opts.ip,
  );
  return { status, fields, documentId: loaded.document.id };
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

  const loaded = await loadPassportExtraction(opts.studentId);
  if (loaded.status !== "ok") {
    return { status: loaded.status, fields: [] };
  }
  const { document, extracted, confidenceScore } = loaded;

  const highConfidence =
    extracted.confidence === "high" ||
    confidenceScore >= 0.9;
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

export async function autoRepairInvalidProfileDatesFromPassport(opts: {
  studentId: number;
  actorUserId: number | null;
  ip?: string;
  invalidFields: readonly string[];
}): Promise<PortalProfileDateRepairResult> {
  const [student] = await db
    .select()
    .from(studentsTable)
    .where(and(
      eq(studentsTable.id, opts.studentId),
      isNull(studentsTable.deletedAt),
    ));
  if (!student) return { status: "unreadable", fields: [] };

  const requested = opts.invalidFields.filter((field) =>
    field === "dateOfBirth" ||
    field === "passportIssueDate" ||
    field === "passportExpiryDate");
  if (requested.length === 0) {
    return { status: "no_invalid_fields", fields: [] };
  }

  const loaded = await loadPassportExtraction(opts.studentId);
  if (loaded.status !== "ok") {
    return {
      status: loaded.status,
      fields: [],
      ...(loaded.document ? { documentId: loaded.document.id } : {}),
    };
  }

  const decision = buildPassportDateRepairDecision({
    student,
    extracted: loaded.extracted,
    confidenceScore: loaded.confidenceScore,
    documentId: loaded.document.id,
    invalidFields: requested,
  });
  if (decision.status !== "repairable") {
    return {
      status: decision.status,
      fields: decision.fields,
      documentId: loaded.document.id,
    };
  }

  await db.update(studentsTable)
    .set(decision.patch)
    .where(and(
      eq(studentsTable.id, opts.studentId),
      isNull(studentsTable.deletedAt),
    ));
  await logAudit(
    opts.actorUserId,
    "portal_preflight_auto_repair_identity_dates",
    "student",
    opts.studentId,
    {
      documentId: loaded.document.id,
      fields: decision.fields,
      confidence: "high",
    },
    opts.ip,
  );
  return {
    status: "updated",
    fields: decision.fields,
    documentId: loaded.document.id,
  };
}
