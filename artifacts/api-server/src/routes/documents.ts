import { Router, type IRouter } from "express";
import { db, documentsTable, studentsTable } from "@workspace/db";
import { eq, and, inArray, desc, isNull } from "drizzle-orm";
import { requireAuth, requireRole, logAudit } from "../lib/auth";
import { STAFF_ROLES, AGENT_ROLES, isAgentRole } from "../lib/roles";
import { getAgentVisibleIds } from "../lib/agentVisibility";
import { dispatchNotification } from "../lib/notificationDispatcher";
import { validateUploadedFile, sanitizeFileName, isPdf } from "../lib/fileUploadValidation";

const router: IRouter = Router();

const DOC_PATCH_FIELDS = ["name", "type", "status", "studentId", "applicationId", "notes"];

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

router.get("/documents", requireAuth, async (req, res): Promise<void> => {
  const { studentId, applicationId, type, status } = req.query as Record<string, string>;

  const conditions = [isNull(documentsTable.deletedAt)];
  if (studentId) conditions.push(eq(documentsTable.studentId, parseInt(studentId, 10)));
  if (applicationId) conditions.push(eq(documentsTable.applicationId, parseInt(applicationId, 10)));
  if (type) conditions.push(eq(documentsTable.type, type));
  if (status) conditions.push(eq(documentsTable.status, status));

  const user = req.user!;
  const isStaff = STAFF_ROLES.includes(user.role as any);

  if (!isStaff) {
    if (user.role === "student") {
      const [studentRec] = await db.select().from(studentsTable).where(eq(studentsTable.userId, user.id));
      if (!studentRec) { res.json([]); return; }
      conditions.push(eq(documentsTable.studentId, studentRec.id));
    } else {
      res.status(403).json({ error: "Access denied" });
      return;
    }
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  const docs = await db.select().from(documentsTable).where(whereClause).orderBy(desc(documentsTable.createdAt));
  res.json(docs);
});

router.post("/documents", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const isStaff = STAFF_ROLES.includes(user.role as any);
  const { name, type, status = "pending", studentId, applicationId, fileUrl, fileData, mimeType, sizeBytes, notes, originalFileName } = req.body;

  if (!isStaff) {
    if (user.role === "student") {
      const [studentRec] = await db.select().from(studentsTable).where(eq(studentsTable.userId, user.id));
      if (!studentRec || (studentId && studentRec.id !== studentId)) {
        res.status(403).json({ error: "Students can only upload documents for themselves" });
        return;
      }
    } else if (isAgentRole(user.role)) {
      if (studentId) {
        const visibleIds = await getAgentVisibleIds(user.id, user.role);
        const [student] = await db.select().from(studentsTable).where(eq(studentsTable.id, studentId));
        if (!student || !student.agentId || !visibleIds.includes(student.agentId)) {
          res.status(403).json({ error: "You can only upload documents for your own students" });
          return;
        }
      }
    } else {
      res.status(403).json({ error: "Access denied" });
      return;
    }
  }

  if (!name || !type) {
    res.status(400).json({ error: "name and type are required" });
    return;
  }
  if (fileUrl && !isValidHttpUrl(fileUrl)) {
    res.status(400).json({ error: "fileUrl must be a valid http/https URL" });
    return;
  }

  const safeName = name ? sanitizeFileName(name) : name;

  if (fileData) {
    if (!mimeType) {
      res.status(400).json({ error: "mimeType is required for file uploads" });
      return;
    }
    const fileSizeBytes = sizeBytes ? Number(sizeBytes) : Math.ceil((fileData.length * 3) / 4);
    const validationFileName = originalFileName
      ? sanitizeFileName(originalFileName)
      : (() => {
          const syntheticExt = isPdf(mimeType) ? ".pdf" : mimeType === "image/png" ? ".png" : ".jpg";
          return `document${syntheticExt}`;
        })();
    const validationError = validateUploadedFile(validationFileName, mimeType, fileSizeBytes);
    if (validationError) {
      const httpStatus = validationError.type === "size_exceeded" ? 413 : 400;
      res.status(httpStatus).json({ error: validationError.message });
      return;
    }
  }

  const effectiveStatus = isStaff ? status : "pending";
  const [doc] = await db.insert(documentsTable).values({
    name: safeName, type, status: effectiveStatus,
    studentId: studentId || null,
    applicationId: isStaff ? (applicationId || null) : null,
    fileUrl: fileUrl || null,
    fileData: fileData || null,
    mimeType: mimeType || null,
    sizeBytes: sizeBytes ? Number(sizeBytes) : null,
    notes: notes || null,
  }).returning();
  await logAudit(user.id, "create_document", "document", doc.id, { name, type }, req.ip);

  if (doc.studentId && (type === "photo" || type === "photograph") && fileData) {
    try {
      const photoMime = mimeType || "image/jpeg";
      const photoUrl = `data:${photoMime};base64,${fileData}`;
      await db.update(studentsTable).set({ photoUrl }).where(eq(studentsTable.id, doc.studentId));
    } catch (err) {
      console.error("[DOCUMENTS] Failed to set student photo from document:", err);
    }
  }

  if (doc.studentId) {
    const [studentRec] = await db.select({ assignedToId: studentsTable.assignedToId }).from(studentsTable).where(eq(studentsTable.id, doc.studentId));
    const recipientIds: number[] = [];
    if (studentRec?.assignedToId) recipientIds.push(studentRec.assignedToId);
    dispatchNotification({
      event: "student.document_uploaded",
      title: "Document Uploaded",
      body: `A new document "${doc.name}" (${doc.type}) has been uploaded.`,
      actionUrl: `/staff/students`,
      icon: "Upload",
      recipientUserIds: recipientIds.length > 0 ? recipientIds : undefined,
      templateVars: { documentName: doc.name, documentType: doc.type },
    }).catch(() => {});
  }

  res.status(201).json(doc);
});

router.get("/documents/:id", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [doc] = await db.select().from(documentsTable).where(and(eq(documentsTable.id, id), isNull(documentsTable.deletedAt)));
  if (!doc) { res.status(404).json({ error: "Document not found" }); return; }

  const user = req.user!;
  const isStaff = STAFF_ROLES.includes(user.role as any);
  if (!isStaff) {
    if (user.role === "student") {
      const [studentRec] = await db.select().from(studentsTable).where(eq(studentsTable.userId, user.id));
      if (!studentRec || studentRec.id !== doc.studentId) {
        res.status(403).json({ error: "Access denied" }); return;
      }
    } else {
      res.status(403).json({ error: "Access denied" }); return;
    }
  }

  res.json(doc);
});

router.patch("/documents/:id", requireAuth, requireRole(...STAFF_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  if (req.body.fileUrl !== undefined) {
    if (!isValidHttpUrl(req.body.fileUrl)) {
      res.status(400).json({ error: "fileUrl must be a valid http/https URL" });
      return;
    }
  }

  const updates: Record<string, unknown> = {};
  for (const key of DOC_PATCH_FIELDS) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }
  if (req.body.fileUrl !== undefined) updates.fileUrl = req.body.fileUrl;

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No valid fields to update" });
    return;
  }
  const [doc] = await db.update(documentsTable).set(updates).where(and(eq(documentsTable.id, id), isNull(documentsTable.deletedAt))).returning();
  if (!doc) { res.status(404).json({ error: "Document not found" }); return; }
  await logAudit(req.user!.id, "update_document", "document", id, updates, req.ip);
  res.json(doc);
});

router.post("/documents/bulk-delete", requireAuth, requireRole(...STAFF_ROLES), async (req, res): Promise<void> => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ error: "ids array is required" });
    return;
  }
  const numericIds = ids.map((id: any) => parseInt(id, 10)).filter((id: number) => !isNaN(id));
  if (numericIds.length === 0) {
    res.status(400).json({ error: "No valid ids provided" });
    return;
  }
  const docs = await db.select().from(documentsTable).where(and(inArray(documentsTable.id, numericIds), isNull(documentsTable.deletedAt)));
  if (docs.length === 0) {
    res.status(404).json({ error: "No documents found" });
    return;
  }
  const activeIds = docs.map(d => d.id);
  await db.update(documentsTable).set({ deletedAt: new Date() }).where(inArray(documentsTable.id, activeIds));
  await logAudit(req.user!.id, "bulk_delete_documents", "document", null as any, { count: docs.length, ids: numericIds }, req.ip);
  res.json({ deleted: docs.length });
});

router.delete("/documents/:id", requireAuth, requireRole(...STAFF_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [doc] = await db.select().from(documentsTable).where(and(eq(documentsTable.id, id), isNull(documentsTable.deletedAt)));
  if (!doc) { res.status(404).json({ error: "Document not found" }); return; }
  await db.update(documentsTable).set({ deletedAt: new Date() }).where(eq(documentsTable.id, id));
  await logAudit(req.user!.id, "delete_document", "document", id, { name: doc.name }, req.ip);
  res.sendStatus(204);
});

router.post("/documents/:id/extract", requireAuth, requireRole(...STAFF_ROLES, ...AGENT_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [doc] = await db.select().from(documentsTable).where(and(eq(documentsTable.id, id), isNull(documentsTable.deletedAt)));
  if (!doc) { res.status(404).json({ error: "Document not found" }); return; }

  if (!doc.fileUrl) {
    res.status(422).json({ error: "Document has no file attached. Upload a file before extracting." });
    return;
  }

  res.status(501).json({
    error: "AI document extraction is not yet configured. Please contact your administrator to enable this feature.",
    documentId: id,
  });
});

export default router;
