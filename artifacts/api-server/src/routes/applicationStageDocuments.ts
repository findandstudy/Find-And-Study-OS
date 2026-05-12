import { Router, type IRouter } from "express";
import { db, applicationStageDocumentsTable, applicationsTable, studentsTable, usersTable, pipelineStagesTable } from "@workspace/db";
import { eq, and, sql, desc, isNull } from "drizzle-orm";
import { requireAuth, requireAgentStaffPermission, logAudit } from "../lib/auth";
import { STAFF_ROLES, ADMIN_ROLES, isAgentRole } from "../lib/roles";
import { canUploadStageDocument } from "../lib/stagePermissions";
import { getAgentVisibleIds } from "../lib/agentVisibility";
import { validateUploadedFile, sanitizeFileName } from "../lib/fileUploadValidation";
import { buildDocNameFromParts } from "../lib/docNaming";

const router: IRouter = Router();

interface StageBehavior {
  uploadPermissionLevel: string;
  tracksOfferExpiry: boolean;
  requiresValidUntil: boolean;
}

async function getStageBehavior(stageKey: string): Promise<StageBehavior | null> {
  const [row] = await db.select({
    uploadPermissionLevel: pipelineStagesTable.uploadPermissionLevel,
    tracksOfferExpiry: pipelineStagesTable.tracksOfferExpiry,
    requiresValidUntil: pipelineStagesTable.requiresValidUntil,
  }).from(pipelineStagesTable)
    .where(and(
      eq(pipelineStagesTable.entityType, "application"),
      eq(pipelineStagesTable.key, stageKey),
    ));
  if (!row) return null;
  return {
    uploadPermissionLevel: row.uploadPermissionLevel || "none",
    tracksOfferExpiry: !!row.tracksOfferExpiry,
    requiresValidUntil: !!row.requiresValidUntil,
  };
}

async function verifyApplicationAccess(userId: number, role: string, applicationId: number): Promise<boolean> {
  const [app] = await db.select().from(applicationsTable).where(and(eq(applicationsTable.id, applicationId), isNull(applicationsTable.deletedAt)));
  if (!app) return false;

  if (STAFF_ROLES.includes(role as any)) return true;

  if (role === "student") {
    const [studentRec] = await db.select().from(studentsTable).where(eq(studentsTable.userId, userId));
    return !!studentRec && studentRec.id === app.studentId;
  }

  if (isAgentRole(role)) {
    const visibleIds = await getAgentVisibleIds(userId, role);
    return !!app.agentId && visibleIds.includes(app.agentId);
  }

  return false;
}

router.get("/applications/:id/stage-documents", requireAuth, requireAgentStaffPermission("documents"), async (req, res): Promise<void> => {
  const applicationId = parseInt(req.params.id, 10);
  const user = req.user!;

  const hasAccess = await verifyApplicationAccess(user.id, user.role, applicationId);
  if (!hasAccess) { res.status(403).json({ error: "Access denied" }); return; }

  const { stage, page = "1", limit = "100" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10)));
  const offset = (pageNum - 1) * limitNum;
  const conditions = [eq(applicationStageDocumentsTable.applicationId, applicationId)];
  if (stage) conditions.push(eq(applicationStageDocumentsTable.stage, stage));

  const docs = await db
    .select({
      id: applicationStageDocumentsTable.id,
      applicationId: applicationStageDocumentsTable.applicationId,
      stage: applicationStageDocumentsTable.stage,
      fileName: applicationStageDocumentsTable.fileName,
      fileUrl: applicationStageDocumentsTable.fileUrl,
      mimeType: applicationStageDocumentsTable.mimeType,
      sizeBytes: applicationStageDocumentsTable.sizeBytes,
      uploadedBy: applicationStageDocumentsTable.uploadedBy,
      uploadedByRole: applicationStageDocumentsTable.uploadedByRole,
      uploadedByName: applicationStageDocumentsTable.uploadedByName,
      isMissingDocNote: applicationStageDocumentsTable.isMissingDocNote,
      validUntil: applicationStageDocumentsTable.validUntil,
      expiryNotifiedThresholds: applicationStageDocumentsTable.expiryNotifiedThresholds,
      hasFileData: sql<boolean>`${applicationStageDocumentsTable.fileData} IS NOT NULL`.as("has_file_data"),
      createdAt: applicationStageDocumentsTable.createdAt,
    })
    .from(applicationStageDocumentsTable)
    .where(and(...conditions))
    .orderBy(desc(applicationStageDocumentsTable.createdAt))
    .limit(limitNum)
    .offset(offset);

  res.json(docs);
});

router.post("/applications/:id/stage-documents", requireAuth, requireAgentStaffPermission("documents"), async (req, res): Promise<void> => {
  const applicationId = parseInt(req.params.id, 10);
  const user = req.user!;

  const hasAccess = await verifyApplicationAccess(user.id, user.role, applicationId);
  if (!hasAccess) { res.status(403).json({ error: "Access denied" }); return; }

  const { stage, fileName, fileData, fileUrl, mimeType, sizeBytes, validUntil } = req.body;

  if (!stage || !fileName) {
    res.status(400).json({ error: "stage and fileName are required" });
    return;
  }

  const behavior = await getStageBehavior(stage);
  if (!behavior || behavior.uploadPermissionLevel === "none") {
    res.status(400).json({ error: "Document upload not allowed for this stage" });
    return;
  }

  let validUntilDate: Date | null = null;
  if (validUntil) {
    const parsed = new Date(validUntil);
    if (isNaN(parsed.getTime())) {
      res.status(400).json({ error: "validUntil must be a valid date" });
      return;
    }
    validUntilDate = parsed;
  }
  if (behavior.requiresValidUntil && !validUntilDate) {
    res.status(400).json({ error: "validUntil is required for this stage" });
    return;
  }

  let descriptiveName: string | null = null;
  try {
    const [appStudent] = await db
      .select({ firstName: studentsTable.firstName, lastName: studentsTable.lastName })
      .from(applicationsTable)
      .innerJoin(studentsTable, eq(studentsTable.id, applicationsTable.studentId))
      .where(eq(applicationsTable.id, applicationId));
    if (appStudent) {
      descriptiveName = buildDocNameFromParts(
        appStudent.firstName,
        appStudent.lastName,
        stage,
        mimeType,
      );
    }
  } catch (e) {
    console.error("[STAGE-DOC] failed to resolve student name for descriptive doc name:", e);
  }
  const safeName = descriptiveName ?? sanitizeFileName(fileName);

  if (fileData) {
    if (!mimeType) {
      res.status(400).json({ error: "mimeType is required for file uploads" });
      return;
    }
    const fileSizeBytes = sizeBytes ? Number(sizeBytes) : Math.ceil((fileData.length * 3) / 4);
    const validationError = validateUploadedFile(safeName, mimeType, fileSizeBytes);
    if (validationError) {
      const httpStatus = validationError.type === "size_exceeded" ? 413 : 400;
      res.status(httpStatus).json({ error: validationError.message });
      return;
    }
  }

  if (fileUrl) {
    try {
      const url = new URL(fileUrl);
      if (url.protocol !== "https:" && url.protocol !== "http:") {
        res.status(400).json({ error: "fileUrl must use http or https protocol" });
        return;
      }
    } catch {
      res.status(400).json({ error: "fileUrl must be a valid URL" });
      return;
    }
  }

  if (!fileData && !fileUrl) {
    res.status(400).json({ error: "Either fileData or fileUrl is required" });
    return;
  }

  const allowed = canUploadStageDocument(behavior.uploadPermissionLevel, user.role);
  if (!allowed) {
    res.status(403).json({ error: "You do not have permission to upload documents for this stage" });
    return;
  }

  const uploaderName = `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email;

  const [doc] = await db.insert(applicationStageDocumentsTable).values({
    applicationId,
    stage,
    fileName: safeName,
    fileData: fileData || null,
    fileUrl: fileUrl || null,
    mimeType: mimeType || null,
    sizeBytes: sizeBytes ? Number(sizeBytes) : null,
    uploadedBy: user.id,
    uploadedByRole: user.role,
    uploadedByName: uploaderName,
    isMissingDocNote: false,
    validUntil: behavior.tracksOfferExpiry ? validUntilDate : null,
  }).returning();

  await logAudit(user.id, "upload_stage_document", "application", applicationId, { stage, fileName, docId: doc.id }, req.ip);
  res.status(201).json(doc);
});

router.patch("/applications/:id/stage-documents/:docId", requireAuth, requireAgentStaffPermission("documents"), async (req, res): Promise<void> => {
  const applicationId = parseInt(req.params.id, 10);
  const docId = parseInt(req.params.docId, 10);
  const user = req.user!;

  const isAdmin = ADMIN_ROLES.includes(user.role as any);
  if (!isAdmin) {
    res.status(403).json({ error: "Only administrators can edit document metadata" });
    return;
  }

  const [doc] = await db.select().from(applicationStageDocumentsTable)
    .where(and(eq(applicationStageDocumentsTable.id, docId), eq(applicationStageDocumentsTable.applicationId, applicationId)));
  if (!doc) { res.status(404).json({ error: "Document not found" }); return; }

  const updates: Record<string, unknown> = {};
  if (req.body.validUntil !== undefined) {
    if (req.body.validUntil === null || req.body.validUntil === "") {
      updates.validUntil = null;
    } else {
      const parsed = new Date(req.body.validUntil);
      if (isNaN(parsed.getTime())) {
        res.status(400).json({ error: "validUntil must be a valid date" });
        return;
      }
      updates.validUntil = parsed;
    }
    updates.expiryNotifiedThresholds = null;
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No valid fields to update" });
    return;
  }

  const [updated] = await db.update(applicationStageDocumentsTable)
    .set(updates)
    .where(eq(applicationStageDocumentsTable.id, docId))
    .returning();

  await logAudit(user.id, "update_stage_document", "application", applicationId, { docId, ...updates }, req.ip);
  res.json(updated);
});

router.delete("/applications/:id/stage-documents/:docId", requireAuth, requireAgentStaffPermission("documents"), async (req, res): Promise<void> => {
  const applicationId = parseInt(req.params.id, 10);
  const docId = parseInt(req.params.docId, 10);
  const user = req.user!;

  const isAdmin = ADMIN_ROLES.includes(user.role as any);
  const [doc] = await db.select().from(applicationStageDocumentsTable)
    .where(and(eq(applicationStageDocumentsTable.id, docId), eq(applicationStageDocumentsTable.applicationId, applicationId)));

  if (!doc) { res.status(404).json({ error: "Document not found" }); return; }

  if (!isAdmin && doc.uploadedBy !== user.id) {
    res.status(403).json({ error: "You can only delete your own uploads" });
    return;
  }

  await db.delete(applicationStageDocumentsTable)
    .where(eq(applicationStageDocumentsTable.id, docId));

  await logAudit(user.id, "delete_stage_document", "application", applicationId, { docId, stage: doc.stage }, req.ip);
  res.sendStatus(204);
});

router.get("/applications/:id/missing-doc-notes", requireAuth, requireAgentStaffPermission("documents"), async (req, res): Promise<void> => {
  const applicationId = parseInt(req.params.id, 10);
  const user = req.user!;

  const hasAccess = await verifyApplicationAccess(user.id, user.role, applicationId);
  if (!hasAccess) { res.status(403).json({ error: "Access denied" }); return; }

  const { page = "1", limit = "50" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10)));
  const offset = (pageNum - 1) * limitNum;

  const notes = await db
    .select()
    .from(applicationStageDocumentsTable)
    .where(and(
      eq(applicationStageDocumentsTable.applicationId, applicationId),
      eq(applicationStageDocumentsTable.stage, "missing_docs"),
      eq(applicationStageDocumentsTable.isMissingDocNote, true),
    ))
    .orderBy(desc(applicationStageDocumentsTable.createdAt))
    .limit(limitNum)
    .offset(offset);

  res.json(notes);
});

router.post("/applications/:id/missing-doc-notes", requireAuth, requireAgentStaffPermission("documents"), async (req, res): Promise<void> => {
  const applicationId = parseInt(req.params.id, 10);
  const user = req.user!;

  const isAdmin = ADMIN_ROLES.includes(user.role as any);
  if (!isAdmin) {
    res.status(403).json({ error: "Only administrators can manage missing document notes" });
    return;
  }

  const { notes } = req.body;
  if (!notes || !Array.isArray(notes)) {
    res.status(400).json({ error: "notes array is required" });
    return;
  }

  await db.delete(applicationStageDocumentsTable).where(and(
    eq(applicationStageDocumentsTable.applicationId, applicationId),
    eq(applicationStageDocumentsTable.stage, "missing_docs"),
    eq(applicationStageDocumentsTable.isMissingDocNote, true),
  ));

  const uploaderName = `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email;

  const insertValues = notes.filter((n: string) => n.trim()).map((note: string) => ({
    applicationId,
    stage: "missing_docs",
    fileName: note.trim(),
    uploadedBy: user.id,
    uploadedByRole: user.role,
    uploadedByName: uploaderName,
    isMissingDocNote: true,
  }));

  if (insertValues.length > 0) {
    await db.insert(applicationStageDocumentsTable).values(insertValues);
  }

  const result = await db.select().from(applicationStageDocumentsTable).where(and(
    eq(applicationStageDocumentsTable.applicationId, applicationId),
    eq(applicationStageDocumentsTable.stage, "missing_docs"),
    eq(applicationStageDocumentsTable.isMissingDocNote, true),
  )).orderBy(desc(applicationStageDocumentsTable.createdAt));

  await logAudit(user.id, "update_missing_doc_notes", "application", applicationId, { count: result.length }, req.ip);
  res.json(result);
});

router.get("/applications/:id/stage-documents/:docId/download", requireAuth, requireAgentStaffPermission("documents"), async (req, res): Promise<void> => {
  const applicationId = parseInt(req.params.id, 10);
  const docId = parseInt(req.params.docId, 10);
  const user = req.user!;

  const hasAccess = await verifyApplicationAccess(user.id, user.role, applicationId);
  if (!hasAccess) { res.status(403).json({ error: "Access denied" }); return; }

  const [doc] = await db.select().from(applicationStageDocumentsTable)
    .where(and(eq(applicationStageDocumentsTable.id, docId), eq(applicationStageDocumentsTable.applicationId, applicationId)));

  if (!doc) { res.status(404).json({ error: "Document not found" }); return; }

  // Rebuild descriptive name on the fly so old uploads also get
  // "FIRSTNAME LASTNAME - StageLabel.ext" at download time.
  let downloadName = doc.fileName;
  try {
    const [appStudent] = await db
      .select({ firstName: studentsTable.firstName, lastName: studentsTable.lastName })
      .from(applicationsTable)
      .innerJoin(studentsTable, eq(studentsTable.id, applicationsTable.studentId))
      .where(eq(applicationsTable.id, applicationId));
    if (appStudent) {
      downloadName = buildDocNameFromParts(
        appStudent.firstName,
        appStudent.lastName,
        doc.stage,
        doc.mimeType,
      );
    }
  } catch (e) {
    console.error("[STAGE-DOC] failed to rebuild descriptive name on download:", e);
  }

  if (doc.fileData) {
    const buffer = Buffer.from(doc.fileData, "base64");
    res.setHeader("Content-Type", doc.mimeType || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(downloadName)}"`);
    res.setHeader("Content-Length", buffer.length);
    res.send(buffer);
  } else if (doc.fileUrl) {
    res.redirect(doc.fileUrl);
  } else {
    res.status(404).json({ error: "No file data available" });
  }
});

export default router;
