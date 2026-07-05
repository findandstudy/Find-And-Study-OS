/**
 * profile.ts — builds a SubmitProfile + SubmitFiles from the DB record
 * for a given portal submission (or directly from an application).
 *
 * Documents are downloaded from their fileUrl / fileKey, or decoded from
 * base64 fileData, into a per-submission temp dir so the adapter can
 * reference them as local file paths.
 *
 * Two entry points share the same profile-mapping + document-download core:
 *   - buildStudentProfile(submissionId)      — used by the production worker
 *     (resolves application + student from a portal_submissions row).
 *   - buildProfileFromApplication(appId)      — used by the local dry-test CLI
 *     (resolves student directly from an application, no submission row).
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  db,
  portalSubmissionsTable,
  applicationsTable,
  studentsTable,
  documentsTable,
} from "@workspace/db";
import { eq, and, isNull, desc } from "drizzle-orm";
import { buildProfile, mapDocType, REQUIRED_DOCS, extractStudentDocumentRefs, selectPriorSchoolName } from "@workspace/portal-adapters";
import type { SubmitProfile, SubmitFiles, StudentDocumentRef } from "@workspace/portal-adapters";

const execFileP = promisify(execFile);

// ---------------------------------------------------------------------------
// Result shape
// ---------------------------------------------------------------------------

export interface StudentProfileResult {
  profile: SubmitProfile;
  files: SubmitFiles;
  /** Caller is responsible for removing this directory after use. */
  tempDir: string;
  /** SubmitFiles keys that were successfully downloaded (for logging / resultJson). */
  filledSlots: string[];
  /** REQUIRED_DOCS slots with no downloaded file (for logging / resultJson). */
  missingSlots: string[];
  /**
   * Per-slot download errors for slots that had a document record but failed
   * to produce a local file. Empty when all slots resolved cleanly.
   */
  downloadErrors: Record<string, string>;
}

type StudentRow = typeof studentsTable.$inferSelect;
type ApplicationRow = typeof applicationsTable.$inferSelect;

// ---------------------------------------------------------------------------
// Shared core: profile mapping
// ---------------------------------------------------------------------------

/**
 * Maps a CRM student + application record into a CRM-agnostic SubmitProfile.
 * Single source of truth shared by both entry points below.
 */
function buildSubmitProfileFromRecords(
  student: StudentRow,
  app: ApplicationRow,
): SubmitProfile {
  return buildProfile({
    email:          student.email          ?? "",
    passportNumber: student.passportNumber ?? "",
    firstName:      student.firstName       ?? "",
    lastName:       student.lastName        ?? "",
    dateOfBirth:    student.dateOfBirth     ?? "",
    gender:         student.gender          ?? "",
    fatherName:     student.fatherName      ?? "",
    motherName:     student.motherName      ?? "",
    nationality:    student.nationality     ?? "",
    address:        student.address         ?? "",
    phone:          student.phone           ?? "",
    level:          app.level               ?? "",
    programName:    app.programName         ?? "",
    programId:      app.programId           != null ? String(app.programId) : "",
    universityName: app.universityName      ?? undefined,
    schoolName:     selectPriorSchoolName(app.level, {
      highSchool:         student.highSchool,
      universityBachelor: student.universityBachelor,
      universityMaster:   student.universityMaster,
    }),
    gpa:            student.gpa             ?? undefined,
    graduationYear: student.graduationYear  ?? undefined,
  });
}

// ---------------------------------------------------------------------------
// Shared core: document download
// ---------------------------------------------------------------------------

interface DownloadedDocs {
  files: SubmitFiles;
  tempDir: string;
  filledSlots: string[];
  missingSlots: string[];
  downloadErrors: Record<string, string>;
  /** Photo URL for URL-fetching create webhooks (e.g. SIT). */
  photoUrl?: string;
  /** Document URLs for URL-fetching create webhooks (e.g. SIT). */
  documentRefs: StudentDocumentRef[];
}

/**
 * Non-JPEG raster image formats we convert to JPEG. JPEG is intentionally
 * absent (already accepted), as are vector/document formats (svg, pdf) and any
 * format sharp reports that we don't want to rasterize.
 */
const CONVERTIBLE_RASTER_FORMATS = new Set([
  "png",
  "webp",
  "gif",
  "tiff",
  "avif",
  "heif", // HEIC reports as "heif" — converted only if this sharp build supports it
]);

/**
 * Some portals (e.g. Topkapı) accept only JPG/JPEG for the photo and reject
 * PNG / WEBP / HEIC with "Dosya türü geçersiz". Convert any non-JPEG raster
 * IMAGE to JPEG before upload (PDFs and already-JPEG files are left untouched).
 *
 * Detection is CONTENT-based via sharp.metadata() — the extension and DB
 * mimeType are NOT trusted, so a PNG mislabeled as .jpg / image/jpeg is still
 * converted. Only formats in CONVERTIBLE_RASTER_FORMATS are converted, so real
 * JPEGs, PDFs, SVGs and anything sharp can't read are left exactly as-is.
 *
 * The photo slot is the exception: Topkapı also rejects raw CRM JPEGs on the
 * "Fotoğraf" field but accepts the same image once re-encoded through sharp, so
 * the photo is ALWAYS re-encoded (regardless of input format) into a clean
 * baseline sRGB JPEG with metadata stripped.
 *
 * Returns the (possibly new .jpg) path; never throws — on failure the original
 * path is returned so the upload still proceeds.
 */
async function ensureJpegImage(
  filePath: string,
  docKey: string,
  logLabel: string,
): Promise<string> {
  let format: string | undefined;
  try {
    format = (await sharp(filePath).metadata()).format;
  } catch {
    // Not a sharp-decodable image (e.g. PDF or unsupported codec) — leave as is.
    return filePath;
  }
  if (!format) return filePath;

  // Photo slot: ALWAYS re-encode through sharp, even when already JPEG. The
  // portal rejects raw CRM JPEGs but accepts sharp-re-encoded baseline JPEGs.
  if (docKey === "photo") {
    const jpgPath = filePath.replace(/\.[^.]+$/, "") + ".jpg";
    const kb = (n: number) => Math.round(n / 1024);
    let oldSize = 0;
    try {
      oldSize = (await fs.stat(filePath)).size;
    } catch {
      /* keep 0 */
    }
    try {
      const out = await sharp(filePath)
        .rotate() // bake in EXIF orientation
        .flatten({ background: "#ffffff" }) // drop alpha → white
        .resize({ width: 1000, height: 1000, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 90, progressive: false, mozjpeg: false }) // baseline, no metadata
        .toBuffer();
      await fs.writeFile(jpgPath, out);
      console.log(
        `[portal-profile] ${logLabel} normalized photo ${kb(oldSize)}→${kb(out.length)} KB`,
      );
      return jpgPath;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[portal-profile] ${logLabel} photo normalize failed — format=${format}: ${msg}`,
      );
      return filePath;
    }
  }

  if (!CONVERTIBLE_RASTER_FORMATS.has(format)) return filePath;

  const jpgPath = filePath.replace(/\.[^.]+$/, "") + ".jpg";
  try {
    await sharp(filePath).jpeg({ quality: 90 }).toFile(jpgPath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[portal-profile] ${logLabel} jpeg conversion failed — slot=${docKey} format=${format}: ${msg}`,
    );
    return filePath;
  }
  console.log(`[portal-profile] ${logLabel} converted ${docKey} ${format}→jpg`);
  return jpgPath;
}

/**
 * Document slots that the portal accepts ONLY as PDF (passport, transcript,
 * diploma). The photo slot is intentionally absent — it must stay an image
 * (JPEG), handled by ensureJpegImage above.
 */
const PDF_DOC_SLOTS = new Set<string>(["passport", "transcript", "diploma"]);

/**
 * Some portals (e.g. Topkapı) accept passport / transcript / diploma ONLY as
 * PDF and reject JPG / PNG with "Dosya türü geçersiz". Wrap any raster IMAGE
 * for these slots into a single-page PDF before upload.
 *
 * Detection is CONTENT-based: files that already start with the %PDF- magic
 * bytes are left untouched; otherwise sharp decodes the image (JPEG/PNG embed
 * directly, anything else — webp/heic/tiff/gif/avif — is rasterized to JPEG
 * first). Files sharp can't read and that aren't PDFs are left exactly as-is so
 * the upload still proceeds. Never throws — on failure the original path is
 * returned.
 */
async function ensurePdfDocument(
  filePath: string,
  docKey: string,
  logLabel: string,
): Promise<string> {
  // Already a PDF? leave untouched (detect by magic bytes, not extension/mime).
  try {
    const fh = await fs.open(filePath, "r");
    try {
      const head = Buffer.alloc(5);
      await fh.read(head, 0, 5, 0);
      if (head.toString("latin1") === "%PDF-") return filePath;
    } finally {
      await fh.close();
    }
  } catch {
    return filePath;
  }

  // Not a PDF — must be a sharp-decodable image to wrap, else leave as-is.
  let format: string | undefined;
  try {
    format = (await sharp(filePath).metadata()).format;
  } catch {
    return filePath;
  }
  if (!format) return filePath;

  try {
    let embedBytes: Buffer;
    let isPng: boolean;
    if (format === "png") {
      embedBytes = await fs.readFile(filePath);
      isPng = true;
    } else if (format === "jpeg") {
      embedBytes = await fs.readFile(filePath);
      isPng = false;
    } else {
      // webp / heic / tiff / gif / avif → rasterize to JPEG first
      embedBytes = await sharp(filePath).jpeg({ quality: 90 }).toBuffer();
      isPng = false;
    }

    const pdf = await PDFDocument.create();
    const img = isPng
      ? await pdf.embedPng(embedBytes)
      : await pdf.embedJpg(embedBytes);
    const page = pdf.addPage([img.width, img.height]);
    page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });

    const pdfPath = filePath.replace(/\.[^.]+$/, "") + ".pdf";
    await fs.writeFile(pdfPath, await pdf.save());
    console.log(`[portal-profile] ${logLabel} converted ${docKey} ${format}→pdf`);
    return pdfPath;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[portal-profile] ${logLabel} pdf conversion failed — slot=${docKey} format=${format}: ${msg}`,
    );
    return filePath;
  }
}

/**
 * Upper size bound for an uploaded image. The Topkapı portal rejects files over
 * its limit with a misleading "Dosya türü geçersiz" (invalid file type) error,
 * so oversized images are downscaled before upload. PDFs are handled separately
 * (always normalized through Ghostscript regardless of size — see below).
 */
const MAX_UPLOAD_BYTES = 1.8 * 1024 * 1024;

/** True when the file starts with the %PDF- magic bytes (content, not ext). */
async function isPdfFile(filePath: string): Promise<boolean> {
  try {
    const fh = await fs.open(filePath, "r");
    try {
      const head = Buffer.alloc(5);
      await fh.read(head, 0, 5, 0);
      return head.toString("latin1") === "%PDF-";
    } finally {
      await fh.close();
    }
  } catch {
    return false;
  }
}

/**
 * Normalizes a document for upload to the portal.
 *
 * The Topkapı portal rejects raw CRM PDFs with a misleading "Dosya türü
 * geçersiz" (invalid file type) error, but accepts the same content once it has
 * been rewritten by Ghostscript. So EVERY PDF is normalized through Ghostscript
 * regardless of size (no size threshold, no size comparison — the goal is a
 * portal-compatible rewrite, not compression). If `gs` errors or produces an
 * empty file, the original is used so the upload still proceeds.
 *
 * Images (the photo slot stays a JPEG) are instead downscaled to ≤1600px wide
 * JPEG q72 only when they exceed MAX_UPLOAD_BYTES, returning the original unless
 * the result is strictly smaller.
 *
 * Detection is CONTENT-based (magic bytes) — a real PDF saved with a `.bin`
 * extension (base64 path) is still routed to Ghostscript, not sharp. Never
 * throws: on any failure the original path is returned.
 */
async function normalizeForUpload(
  filePath: string,
  docKey: string,
  logLabel: string,
): Promise<string> {
  let size: number;
  try {
    size = (await fs.stat(filePath)).size;
  } catch {
    return filePath;
  }

  const kb = (n: number) => Math.round(n / 1024);

  // --- PDF → Ghostscript (ALWAYS normalize, any size) ----------------------
  if (await isPdfFile(filePath)) {
    const out = filePath.replace(/\.[^.]+$/, "") + ".min.pdf";
    try {
      await execFileP("gs", [
        "-sDEVICE=pdfwrite",
        "-dCompatibilityLevel=1.4",
        "-dPDFSETTINGS=/ebook",
        "-dNOPAUSE",
        "-dQUIET",
        "-dBATCH",
        `-sOutputFile=${out}`,
        filePath,
      ]);
      const outSize = (await fs.stat(out)).size;
      if (outSize > 0) {
        console.log(`[portal-profile] ${logLabel} normalized pdf ${docKey} ${kb(size)}→${kb(outSize)} KB`);
        return out;
      }
    } catch (err) {
      console.warn(`[portal-profile] ${logLabel} gs normalize failed — slot=${docKey}: ${err instanceof Error ? err.message : String(err)}`);
    }
    return filePath;
  }

  // --- Image → sharp (only when oversized) ---------------------------------
  if (size <= MAX_UPLOAD_BYTES) return filePath;
  const out = filePath.replace(/\.[^.]+$/, "") + ".min.jpg";
  try {
    await sharp(filePath)
      .resize({ width: 1600, withoutEnlargement: true })
      .jpeg({ quality: 72 })
      .toFile(out);
    const outSize = (await fs.stat(out)).size;
    if (outSize > 0 && outSize < size) {
      console.log(`[portal-profile] ${logLabel} compressed image ${docKey} ${kb(size)}→${kb(outSize)} KB`);
      return out;
    }
  } catch (err) {
    console.warn(`[portal-profile] ${logLabel} image compress failed — slot=${docKey}: ${err instanceof Error ? err.message : String(err)}`);
  }
  return filePath;
}

/**
 * Per-slot upload-format normalization. photo → JPEG; passport / transcript /
 * diploma → PDF (image→pdf via pdf-lib). Both helpers are content-based and
 * never throw. After conversion, every PDF (native or image→pdf output) is
 * rewritten through Ghostscript; oversized photos are downscaled.
 */
async function ensureUploadFormat(
  filePath: string,
  docKey: string,
  logLabel: string,
): Promise<string> {
  const converted = PDF_DOC_SLOTS.has(docKey)
    ? await ensurePdfDocument(filePath, docKey, logLabel)
    : await ensureJpegImage(filePath, docKey, logLabel);
  return normalizeForUpload(converted, docKey, logLabel);
}

/**
 * Downloads a student's documents into a fresh temp directory.
 *
 * Document resolution order per slot:
 *   1. Non-deleted records with content (fileUrl / fileKey / fileData), sorted
 *      so content-bearing rows win over empty stubs when multiple non-deleted
 *      records exist for the same slot (first-wins after sort).
 *   2. Empty stub records (fileUrl = fileKey = fileData = NULL) are skipped.
 *   3. For each candidate: try URL download (fileUrl then fileKey), then fall
 *      back to base64 fileData written to a temp file.
 *
 * Download failures are non-fatal: they are recorded in `downloadErrors` and
 * the slot is listed in `missingSlots`.
 *
 * @param tempPrefix  mkdtemp prefix (e.g. "portal-sub-12" / "portal-app-2054").
 * @param logLabel    label used in log lines (e.g. "#12" / "app#2054").
 */
async function downloadStudentDocuments(
  studentId: number,
  tempPrefix: string,
  logLabel: string,
): Promise<DownloadedDocs> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `${tempPrefix}-`));

  const docs = await db
    .select({
      type:      documentsTable.type,
      fileUrl:   documentsTable.fileUrl,
      fileKey:   documentsTable.fileKey,
      fileData:  documentsTable.fileData,
      name:      documentsTable.name,
      sizeBytes: documentsTable.sizeBytes,
      mimeType:  documentsTable.mimeType,
    })
    .from(documentsTable)
    .where(
      and(
        eq(documentsTable.studentId, studentId),
        isNull(documentsTable.deletedAt),
      ),
    )
    .orderBy(desc(documentsTable.createdAt));

  // Sort: content-bearing records first so they win the first-wins slot race
  // when an empty stub also exists for the same type.
  const hasContent = (d: typeof docs[0]) =>
    !!(d.fileUrl || d.fileKey || d.fileData);
  const sortedDocs = [...docs].sort((a, b) => {
    const ac = hasContent(a) ? 0 : 1;
    const bc = hasContent(b) ? 0 : 1;
    return ac - bc;
  });

  const files: SubmitFiles = {};
  const downloadErrors: Record<string, string> = {};

  await Promise.all(
    sortedDocs.map(async (doc) => {
      if (!doc.type) return;

      const docKey = mapDocType(doc.type);
      if (!docKey) return;

      if (files[docKey]) return; // first-wins — already resolved by a content-bearing record

      // Skip empty stubs entirely (no content in any storage field)
      if (!doc.fileUrl && !doc.fileKey && !doc.fileData) return;

      try {
        // --- path A: URL download (fileUrl preferred, fileKey as fallback) ---
        const url = doc.fileUrl ?? doc.fileKey;
        if (url) {
          const ext = url.split("?")[0].split(".").pop()?.toLowerCase() ?? "bin";
          const dest = path.join(tempDir, `${docKey}.${ext}`);
          await downloadFile(url, dest);
          files[docKey] = await ensureUploadFormat(dest, docKey, logLabel);
          return;
        }

        // --- path B: base64 fileData fallback --------------------------------
        if (doc.fileData) {
          const buf = Buffer.from(doc.fileData, "base64");
          const dest = path.join(tempDir, `${docKey}.bin`);
          await fs.writeFile(dest, buf);
          files[docKey] = await ensureUploadFormat(dest, docKey, logLabel);
          return;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        downloadErrors[docKey] = `type=${doc.type}: ${msg}`;
        console.warn(
          `[portal-profile] ${logLabel} doc download failed` +
          ` — slot=${docKey} type=${doc.type}: ${msg}`,
        );
      }
    }),
  );

  const filledSlots  = REQUIRED_DOCS.filter((slot) => !!files[slot]);
  const missingSlots = REQUIRED_DOCS.filter((slot) => !files[slot]);

  const missingDetail =
    missingSlots.length > 0
      ? missingSlots.map((s) => downloadErrors[s] ? `${s}(err: ${downloadErrors[s]})` : `${s}(no-record)`).join(", ")
      : "";

  console.log(
    `[portal-profile] ${logLabel} doc slots — filled: [${filledSlots.join(", ")}]` +
    (missingSlots.length > 0 ? ` | missing: [${missingDetail}]` : " | all 4 filled"),
  );

  // URL refs for URL-fetching create webhooks (e.g. SIT). Independent of the
  // local-file download above — derived directly from the CRM document rows.
  const { photoUrl, documents: documentRefs } = extractStudentDocumentRefs(docs);
  console.log(
    `[portal-profile] ${logLabel} doc urls — photo: ${photoUrl ? "yes" : "no"}` +
    ` | documents: ${documentRefs.length}` +
    (documentRefs.length ? ` [${documentRefs.map((d) => d.type).join(", ")}]` : ""),
  );

  return { files, tempDir, filledSlots, missingSlots, downloadErrors, photoUrl, documentRefs };
}

// ---------------------------------------------------------------------------
// buildStudentProfile — submission-keyed (production worker)
// ---------------------------------------------------------------------------

/**
 * Fetches the application + student data for a given portal_submission row,
 * downloads the student's documents to a temporary directory, and returns
 * a SubmitProfile + SubmitFiles ready for the adapter.
 *
 * Throws when the submission, application, or student cannot be found.
 */
export async function buildStudentProfile(
  submissionId: number,
): Promise<StudentProfileResult> {
  // ----- 1. Load submission ------------------------------------------------
  const [sub] = await db
    .select()
    .from(portalSubmissionsTable)
    .where(eq(portalSubmissionsTable.id, submissionId));

  if (!sub) throw new Error(`Submission ${submissionId} not found`);

  // ----- 2. Load application -----------------------------------------------
  const [app] = await db
    .select()
    .from(applicationsTable)
    .where(
      and(
        eq(applicationsTable.id, sub.applicationId),
        isNull(applicationsTable.deletedAt),
      ),
    );

  if (!app) throw new Error(`Application ${sub.applicationId} not found`);

  // ----- 3. Load student ---------------------------------------------------
  if (!sub.studentId) throw new Error(`Submission ${submissionId} has no studentId`);

  const [student] = await db
    .select()
    .from(studentsTable)
    .where(eq(studentsTable.id, sub.studentId));

  if (!student) throw new Error(`Student ${sub.studentId} not found`);

  // ----- 4. Build profile + download documents -----------------------------
  const profile = buildSubmitProfileFromRecords(student, app);

  // Aggregator (SIT/United) routing: the submission carries the member
  // (catalog) university it must select inside the aggregator portal. Override
  // the profile so the adapter's school-selection (matchAllowedUniversity /
  // selById("selectuniversity", profile.universityName)) targets the member,
  // not the aggregator or a drifted free-text name.
  const meta = sub.meta as { targetUniversityName?: string } | null;
  if (meta?.targetUniversityName) {
    profile.universityName = meta.targetUniversityName;
  }

  const dl = await downloadStudentDocuments(
    sub.studentId,
    `portal-sub-${submissionId}`,
    `#${submissionId}`,
  );

  // Carry document/photo URLs on the profile for URL-fetching create webhooks.
  if (dl.photoUrl) profile.photoUrl = dl.photoUrl;
  if (dl.documentRefs.length) profile.studentDocuments = dl.documentRefs;

  return { profile, ...dl };
}

// ---------------------------------------------------------------------------
// buildProfileFromApplication — application-keyed (local dry-test CLI)
// ---------------------------------------------------------------------------

/**
 * Builds a SubmitProfile + SubmitFiles directly from an application id, with
 * no portal_submissions row required. Resolves the student via the
 * application's studentId. Reuses the exact same profile-mapping and
 * document-download logic as buildStudentProfile (single source of truth) so
 * the local dry-test CLI exercises the identical profile the worker would.
 *
 * Throws when the application or student cannot be found.
 */
export async function buildProfileFromApplication(
  applicationId: number,
): Promise<StudentProfileResult> {
  const [app] = await db
    .select()
    .from(applicationsTable)
    .where(
      and(
        eq(applicationsTable.id, applicationId),
        isNull(applicationsTable.deletedAt),
      ),
    );

  if (!app) throw new Error(`Application ${applicationId} not found`);

  const [student] = await db
    .select()
    .from(studentsTable)
    .where(eq(studentsTable.id, app.studentId));

  if (!student) throw new Error(`Student ${app.studentId} not found`);

  const profile = buildSubmitProfileFromRecords(student, app);
  const dl = await downloadStudentDocuments(
    app.studentId,
    `portal-app-${applicationId}`,
    `app#${applicationId}`,
  );

  // Carry document/photo URLs on the profile for URL-fetching create webhooks.
  if (dl.photoUrl) profile.photoUrl = dl.photoUrl;
  if (dl.documentRefs.length) profile.studentDocuments = dl.documentRefs;

  return { profile, ...dl };
}

// ---------------------------------------------------------------------------
// Internal: download helper
// ---------------------------------------------------------------------------

async function downloadFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} downloading ${url}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(dest, buf);
}
