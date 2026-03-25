import { Router, type IRouter } from "express";
import { db, applicationStageDocumentsTable, applicationsTable, studentsTable, usersTable } from "@workspace/db";
import { eq, and, sql, desc, isNull } from "drizzle-orm";
import { requireAuth, requireAgentStaffPermission, logAudit } from "../lib/auth";
import { STAFF_ROLES, ADMIN_ROLES, isAgentRole } from "../lib/roles";
import { getAgentVisibleIds } from "../lib/agentVisibility";

const router: IRouter = Router();

const EVERYONE_UPLOAD_STAGES = [
  "app_fee_paid", "missing_docs", "upload_payment",
  "visa_approved", "student_card", "visa_reject",
];

const ADMIN_ONLY_UPLOAD_STAGES = [
  "offer_received", "acceptance_letter", "final_acceptance",
];

const ALL_DOC_STAGES = [...EVERYONE_UPLOAD_STAGES, ...ADMIN_ONLY_UPLOAD_STAGES];

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

  const { stage, fileName, fileData, fileUrl, mimeType, sizeBytes } = req.body;

  if (!stage || !fileName) {
    res.status(400).json({ error: "stage and fileName are required" });
    return;
  }

  if (!ALL_DOC_STAGES.includes(stage)) {
    res.status(400).json({ error: "Document upload not allowed for this stage" });
    return;
  }

  if (fileData && typeof fileData === "string" && fileData.length > 15 * 1024 * 1024) {
    res.status(413).json({ error: "File too large. Maximum 10MB" });
    return;
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

  const isStaff = STAFF_ROLES.includes(user.role as any);
  const isAdmin = ADMIN_ROLES.includes(user.role as any);

  if (ADMIN_ONLY_UPLOAD_STAGES.includes(stage) && !isAdmin) {
    res.status(403).json({ error: "Only administrators can upload documents for this stage" });
    return;
  }

  if (EVERYONE_UPLOAD_STAGES.includes(stage) && !isStaff && !isAgentRole(user.role) && user.role !== "student") {
    res.status(403).json({ error: "You do not have permission to upload documents" });
    return;
  }

  const uploaderName = `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email;

  const [doc] = await db.insert(applicationStageDocumentsTable).values({
    applicationId,
    stage,
    fileName,
    fileData: fileData || null,
    fileUrl: fileUrl || null,
    mimeType: mimeType || null,
    sizeBytes: sizeBytes ? Number(sizeBytes) : null,
    uploadedBy: user.id,
    uploadedByRole: user.role,
    uploadedByName: uploaderName,
    isMissingDocNote: false,
  }).returning();

  await logAudit(user.id, "upload_stage_document", "application", applicationId, { stage, fileName, docId: doc.id }, req.ip);
  res.status(201).json(doc);
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

  if (doc.fileData) {
    const buffer = Buffer.from(doc.fileData, "base64");
    res.setHeader("Content-Type", doc.mimeType || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(doc.fileName)}"`);
    res.setHeader("Content-Length", buffer.length);
    res.send(buffer);
  } else if (doc.fileUrl) {
    res.redirect(doc.fileUrl);
  } else {
    res.status(404).json({ error: "No file data available" });
  }
});

export default router;
