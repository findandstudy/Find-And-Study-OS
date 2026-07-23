/**
 * educationAutoExtract — shared core of the FAZ 1 extract-education flow.
 *
 * The former POST /ai/students/:id/extract-education body moved here so it
 * can run in TWO ways with identical behavior:
 *  1. The staff endpoint (ai-extract.ts) — manual, always runs.
 *  2. The automatic document-upload trigger (documents route) — fires when a
 *     transcript/diploma/degree document is created AND the student's
 *     education records are still empty (idempotent, non-blocking).
 *
 * Level is resolved SERVER-side (students.interestedLevel → latest
 * application's program degree). Low confidence never drops readable
 * records (LOW_CONFIDENCE_EDUCATION warning instead).
 */
import { eq, desc, and, isNull, inArray, asc } from "drizzle-orm";
import {
  db,
  studentsTable,
  applicationsTable,
  programsTable,
  documentsTable,
  studentEducationRecordsTable,
} from "@workspace/db";
import { getAnthropicClient, getClaudeConfig } from "@workspace/integrations-anthropic-ai";
import { logAudit } from "./auth";
import { loadDocumentBytes } from "./documentBytes";
import { EXTRACT_PROMPT } from "./extractPrompt";
import {
  buildEducationPromptSection,
  decideEducationExtraction,
  EDUCATION_SOURCE_DOC_TYPES,
  educationRecordHasData,
  isEducationTriggerDocType,
  type EducationRecordOutput,
} from "./educationExtraction";

const IMAGE_MEDIA_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
// Defensive request-budget caps for the single messages.create call.
const MAX_EDUCATION_DOCS = 10;
const MAX_EDUCATION_TOTAL_BYTES = 15 * 1024 * 1024; // raw bytes (~20MB as base64)
const DEFAULT_VISION_MODEL = "claude-sonnet-4-6";

/** Resolve the applied study level server-side (never trust the client). */
export async function resolveAppliedLevelKey(studentId: number): Promise<string | null> {
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

export type EducationExtractionRunResult =
  | { status: "not_found" }
  | { status: "skipped_filled"; upserted: 0 }
  | { status: "ai_unavailable"; error: string }
  | { status: "ai_failed"; error: string }
  | {
      status: "ok";
      records: EducationRecordOutput[];
      warnings: string[];
      levelKey: string | null;
      upserted: number;
    };

export interface RunEducationExtractionOptions {
  studentId: number;
  /** Actor recorded in the audit log (uploader for the auto trigger). */
  actorUserId: number | null;
  ip?: string;
  /**
   * Auto-trigger idempotency: skip entirely (no AI call, no overwrite) when
   * the student already has at least one data-bearing education record.
   */
  skipIfFilled?: boolean;
  /** Audit action name — endpoint keeps "ai_extract_education". */
  auditAction?: string;
}

/** true when the student already has a data-bearing education record. */
async function hasFilledEducation(studentId: number): Promise<boolean> {
  const rows = await db.select({
    level: studentEducationRecordsTable.level,
    institution: studentEducationRecordsTable.institution,
    program: studentEducationRecordsTable.program,
    graduationYear: studentEducationRecordsTable.graduationYear,
    gpa: studentEducationRecordsTable.gpa,
    gpaRaw: studentEducationRecordsTable.gpaRaw,
    gpaScale: studentEducationRecordsTable.gpaScale,
    languageScore: studentEducationRecordsTable.languageScore,
  })
    .from(studentEducationRecordsTable)
    .where(and(
      eq(studentEducationRecordsTable.studentId, studentId),
      isNull(studentEducationRecordsTable.deletedAt),
    ));
  return rows.some((r) => educationRecordHasData(r as EducationRecordOutput));
}

/**
 * The full extract-education core (moved verbatim from the FAZ 1 endpoint):
 * resolve level → collect education docs → ONE anthropic call →
 * decideEducationExtraction → race-safe idempotent upsert → audit.
 */
export async function runEducationExtraction(
  opts: RunEducationExtractionOptions,
): Promise<EducationExtractionRunResult> {
  const { studentId, actorUserId, ip } = opts;
  const auditAction = opts.auditAction ?? "ai_extract_education";

  const [student] = await db.select({ id: studentsTable.id })
    .from(studentsTable)
    .where(and(eq(studentsTable.id, studentId), isNull(studentsTable.deletedAt)));
  if (!student) return { status: "not_found" };

  if (opts.skipIfFilled && (await hasFilledEducation(studentId))) {
    return { status: "skipped_filled", upserted: 0 };
  }

  // Level is resolved SERVER-side; without it we cannot build the
  // level-based prompt section, so return early with a stable warning.
  const levelKey = await resolveAppliedLevelKey(studentId);
  if (!levelKey) {
    const decision = decideEducationExtraction({ levelKey: null, documentCount: 0 });
    logAudit(actorUserId, auditAction, "student", studentId, {
      levelKey: null, documentCount: 0, upserted: 0, warnings: decision.warnings,
    }, ip);
    return { status: "ok", ...decision, upserted: 0 };
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
      inArray(documentsTable.type, [...EDUCATION_SOURCE_DOC_TYPES]),
    ))
    .orderBy(asc(documentsTable.id));

  // Reuse the existing storage/base64 fallback chain to load bytes.
  // Defensive caps: never exceed the model request budget — stop adding
  // documents past the raw-byte / count limits.
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
    logAudit(actorUserId, auditAction, "student", studentId, {
      levelKey, documentCount: 0, upserted: 0, warnings: decision.warnings,
    }, ip);
    return { status: "ok", ...decision, upserted: 0 };
  }

  let anthropic;
  let claudeConfig;
  try {
    anthropic = await getAnthropicClient();
    claudeConfig = await getClaudeConfig();
  } catch (err) {
    return {
      status: "ai_unavailable",
      error: err instanceof Error ? err.message : "AI integration not configured",
    };
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

  let extracted: Record<string, unknown> = {};
  try {
    const message = await anthropic.messages.create({
      model: claudeConfig.model || DEFAULT_VISION_MODEL,
      max_tokens: 8192,
      messages: [{ role: "user", content: contentBlocks as never }],
    });
    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return { status: "ai_failed", error: "No response from AI" };
    }
    const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
    if (jsonMatch) extracted = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
  } catch (err) {
    return {
      status: "ai_failed",
      error: err instanceof Error ? err.message : "AI extraction failed",
    };
  }

  // Map to the PUT /students/:id/education body shape (level filter, dedup,
  // GPA guarantee), drop no-data records, and apply the CRITICAL GATE FIX:
  // low confidence never drops readable records — they are saved AND flagged
  // with the stable LOW_CONFIDENCE_EDUCATION warning.
  const { records, warnings } = decideEducationExtraction({
    levelKey,
    documentCount: loaded.length,
    educationRecords: extracted.educationRecords,
    confidence: extracted.confidence,
  });

  // Idempotent, race-safe level-based upsert: ON CONFLICT against the
  // partial unique index on (student_id, level) WHERE deleted_at IS NULL.
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

  logAudit(actorUserId, auditAction, "student", studentId, {
    levelKey, documentCount: loaded.length, upserted, warnings,
  }, ip);

  return { status: "ok", records, warnings, levelKey, upserted };
}

// ---------------------------------------------------------------------------
// Automatic trigger (document upload path)
// ---------------------------------------------------------------------------

/** Avalanche guard: at most one auto-run in flight per student per process. */
const inFlight = new Set<number>();

export interface AutoEducationTriggerInput {
  studentId: number | null | undefined;
  documentType: string | null | undefined;
  actorUserId: number | null;
  ip?: string;
}

/**
 * Fire-and-forget auto extraction on document upload. NEVER throws and never
 * blocks the caller — call it WITHOUT await (or void it). Runs only when:
 *  - the document type is transcript/diploma/degree, and
 *  - the student's education records are still empty (skipIfFilled), and
 *  - no auto-run is already in flight for this student.
 */
export function maybeTriggerAutoEducationExtract(input: AutoEducationTriggerInput): void {
  const { studentId, documentType, actorUserId, ip } = input;
  if (!studentId || !isEducationTriggerDocType(documentType)) return;
  if (inFlight.has(studentId)) return;
  inFlight.add(studentId);
  setImmediate(async () => {
    try {
      const result = await runEducationExtraction({
        studentId,
        actorUserId,
        ip,
        skipIfFilled: true,
        auditAction: "auto_education_extract",
      });
      if (result.status === "ok") {
        console.log(`[auto-education-extract] auto_education_extract triggered student=${studentId} level=${result.levelKey ?? "unresolved"} upserted=${result.upserted}${result.warnings.length ? ` warnings=${result.warnings.join(",")}` : ""}`);
      } else if (result.status !== "skipped_filled") {
        console.warn(`[auto-education-extract] student=${studentId} not run: ${result.status}${"error" in result ? ` (${result.error})` : ""}`);
      }
    } catch (err) {
      // Non-fatal by contract — the upload already succeeded.
      console.warn(`[auto-education-extract] student=${studentId} failed (non-fatal):`, err);
    } finally {
      inFlight.delete(studentId);
    }
  });
}
