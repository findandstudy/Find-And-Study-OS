import { Router, type IRouter } from "express";
import { db, documentsTable, studentsTable, applicationsTable } from "@workspace/db";
import { eq, and, inArray, desc, isNull } from "drizzle-orm";
import { requireAuth, requireRole, logAudit } from "../lib/auth";
import { STAFF_ROLES, AGENT_ROLES, isAgentRole } from "../lib/roles";
import { getAgentVisibleIds } from "../lib/agentVisibility";
import { dispatchNotification } from "../lib/notificationDispatcher";
import { validateUploadedFile, validateUploadedFileBuffer, sanitizeFileName, isPdf } from "../lib/fileUploadValidation";
import { buildDocNameFromParts } from "../lib/docNaming";
import archiver from "archiver";
import { PDFDocument } from "pdf-lib";

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
    } else if (isAgentRole(user.role)) {
      if (studentId) {
        const visibleIds = await getAgentVisibleIds(user.id, user.role);
        const [student] = await db.select().from(studentsTable).where(eq(studentsTable.id, parseInt(studentId, 10)));
        if (!student || !student.agentId || !visibleIds.includes(student.agentId)) {
          res.json([]);
          return;
        }
      } else {
        const visibleIds = await getAgentVisibleIds(user.id, user.role);
        const agentStudents = await db.select({ id: studentsTable.id }).from(studentsTable).where(
          inArray(studentsTable.agentId, visibleIds.length > 0 ? visibleIds : [0])
        );
        const studentIds = agentStudents.map(s => s.id);
        if (studentIds.length === 0) { res.json([]); return; }
        conditions.push(inArray(documentsTable.studentId, studentIds));
      }
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

  let descriptiveName: string | null = null;
  let resolvedStudentId: number | null = studentId ?? null;
  if (!resolvedStudentId && applicationId) {
    try {
      const [appRec] = await db
        .select({ studentId: applicationsTable.studentId })
        .from(applicationsTable)
        .where(eq(applicationsTable.id, applicationId));
      if (appRec?.studentId) resolvedStudentId = appRec.studentId;
    } catch (e) {
      console.error("[DOCUMENTS] failed to resolve studentId from applicationId:", e);
    }
  }
  if (resolvedStudentId) {
    try {
      const [studentRec] = await db
        .select({ firstName: studentsTable.firstName, lastName: studentsTable.lastName })
        .from(studentsTable)
        .where(eq(studentsTable.id, resolvedStudentId));
      if (studentRec) {
        descriptiveName = buildDocNameFromParts(
          studentRec.firstName,
          studentRec.lastName,
          type,
          mimeType,
        );
      }
    } catch (e) {
      console.error("[DOCUMENTS] failed to resolve student name for descriptive doc name:", e);
    }
  }
  const safeName = descriptiveName
    ? descriptiveName
    : (name ? sanitizeFileName(name) : name);

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
    let buffer: Buffer | null = null;
    try {
      buffer = Buffer.from(fileData, "base64");
    } catch {
      res.status(400).json({ error: "Invalid base64 file data" });
      return;
    }
    const validationError = await validateUploadedFileBuffer(validationFileName, mimeType, buffer);
    if (validationError) {
      const httpStatus = validationError.type === "size_exceeded" ? 413 : 400;
      res.status(httpStatus).json({ error: validationError.message });
      return;
    }
    if (!sizeBytes) {
      // ensure size matches actual decoded bytes for downstream consumers
      (req.body as any).sizeBytes = buffer.byteLength;
    }
  }

  const effectiveStatus = isStaff ? status : "pending";

  if (studentId && type) {
    const oldDocs = await db.select({ id: documentsTable.id }).from(documentsTable).where(
      and(
        eq(documentsTable.studentId, studentId),
        eq(documentsTable.type, type),
        isNull(documentsTable.deletedAt)
      )
    );
    if (oldDocs.length > 0) {
      await db.update(documentsTable)
        .set({ deletedAt: new Date() })
        .where(inArray(documentsTable.id, oldDocs.map(d => d.id)));
    }
  }

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
    actorUserId: req.user!.id,
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
    } else if (isAgentRole(user.role)) {
      if (doc.studentId) {
        const visibleIds = await getAgentVisibleIds(user.id, user.role);
        const [student] = await db.select().from(studentsTable).where(eq(studentsTable.id, doc.studentId));
        if (!student || !student.agentId || !visibleIds.includes(student.agentId)) {
          res.status(403).json({ error: "Access denied" }); return;
        }
      } else {
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
  const [existingDoc] = await db.select().from(documentsTable).where(and(eq(documentsTable.id, id), isNull(documentsTable.deletedAt)));
  const [doc] = await db.update(documentsTable).set(updates).where(and(eq(documentsTable.id, id), isNull(documentsTable.deletedAt))).returning();
  if (!doc) { res.status(404).json({ error: "Document not found" }); return; }
  await logAudit(req.user!.id, "update_document", "document", id, updates, req.ip);

  if (updates.status && existingDoc && updates.status !== existingDoc.status) {
    const recipientIds: number[] = [];
    if (doc.studentId) {
      const [student] = await db.select({ userId: studentsTable.userId, assignedToId: studentsTable.assignedToId }).from(studentsTable).where(eq(studentsTable.id, doc.studentId));
      if (student?.userId) recipientIds.push(student.userId);
      if (student?.assignedToId) recipientIds.push(student.assignedToId);
    }
    dispatchNotification({
    actorUserId: req.user!.id,
      event: "document.status_changed",
      title: "Document Status Updated",
      body: `Document "${doc.name}" status changed to "${updates.status}".`,
      actionUrl: doc.studentId ? `/staff/students/${doc.studentId}` : `/staff/documents`,
      icon: "FileCheck",
      recipientUserIds: recipientIds.length > 0 ? recipientIds : undefined,
      templateVars: { documentName: doc.name, documentType: doc.type || "", newStatus: String(updates.status) },
    }).catch(() => {});
  }

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

router.delete("/documents/:id", requireAuth, requireRole(...STAFF_ROLES, ...AGENT_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [doc] = await db.select().from(documentsTable).where(and(eq(documentsTable.id, id), isNull(documentsTable.deletedAt)));
  if (!doc) { res.status(404).json({ error: "Document not found" }); return; }

  const user = req.user!;
  if (isAgentRole(user.role)) {
    if (!doc.studentId) { res.status(403).json({ error: "Access denied" }); return; }
    const visibleIds = await getAgentVisibleIds(user.id, user.role);
    const [student] = await db.select().from(studentsTable).where(eq(studentsTable.id, doc.studentId));
    if (!student || !student.agentId || !visibleIds.includes(student.agentId)) {
      res.status(403).json({ error: "Access denied" }); return;
    }
  }

  await db.update(documentsTable).set({ deletedAt: new Date() }).where(eq(documentsTable.id, id));
  await logAudit(req.user!.id, "delete_document", "document", id, { name: doc.name }, req.ip);
  res.sendStatus(204);
});

router.get("/documents/download-zip/:studentId", requireAuth, requireRole(...STAFF_ROLES, ...AGENT_ROLES), async (req, res): Promise<void> => {
  const studentId = parseInt(req.params.studentId, 10);
  if (isNaN(studentId)) { res.status(400).json({ error: "Invalid studentId" }); return; }

  const [student] = await db.select().from(studentsTable).where(eq(studentsTable.id, studentId));
  if (!student) { res.status(404).json({ error: "Student not found" }); return; }

  if (isAgentRole(req.user!.role)) {
    const visibleIds = await getAgentVisibleIds(req.user!.id, req.user!.role);
    if (!student.agentId || !visibleIds.includes(student.agentId)) {
      res.status(403).json({ error: "Access denied" }); return;
    }
  }

  const docs = await db.select().from(documentsTable).where(
    and(eq(documentsTable.studentId, studentId), isNull(documentsTable.deletedAt))
  );

  if (docs.length === 0) {
    res.status(404).json({ error: "No documents found for this student" });
    return;
  }

  const studentName = `${student.firstName}_${student.lastName}`.replace(/\s+/g, "_");
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${studentName}_documents.zip"`);

  const archive = archiver("zip", { zlib: { level: 5 } });
  archive.pipe(res);

  // Rebuild descriptive names on the fly so old documents (uploaded before
  // the descriptive-naming feature) also download as
  // "FIRSTNAME LASTNAME - DocLabel.ext". Dedupe collisions with " (id)".
  const seenNames = new Set<string>();
  for (const doc of docs) {
    if (doc.fileData) {
      let name = buildDocNameFromParts(student.firstName, student.lastName, doc.type, doc.mimeType);
      if (seenNames.has(name)) {
        const dotIdx = name.lastIndexOf(".");
        name = dotIdx > 0
          ? `${name.slice(0, dotIdx)} (${doc.id})${name.slice(dotIdx)}`
          : `${name} (${doc.id})`;
      }
      seenNames.add(name);
      archive.append(Buffer.from(doc.fileData, "base64"), { name });
    }
  }

  await archive.finalize();
});

router.post("/documents/merge-pdf", requireAuth, requireRole(...STAFF_ROLES, ...AGENT_ROLES), async (req, res): Promise<void> => {
  const { documentIds, studentId } = req.body;

  if (!Array.isArray(documentIds) || documentIds.length < 2) {
    res.status(400).json({ error: "At least 2 document IDs are required" });
    return;
  }

  const numericIds = documentIds.map((id: any) => parseInt(id, 10)).filter((id: number) => !isNaN(id));
  const docs = await db.select().from(documentsTable).where(
    and(inArray(documentsTable.id, numericIds), isNull(documentsTable.deletedAt))
  );

  const pdfDocs = docs.filter(d => d.fileData && d.mimeType === "application/pdf");
  if (pdfDocs.length < 2) {
    res.status(400).json({ error: "At least 2 PDF documents are required for merge" });
    return;
  }

  if (isAgentRole(req.user!.role) && studentId) {
    const visibleIds = await getAgentVisibleIds(req.user!.id, req.user!.role);
    const [student] = await db.select().from(studentsTable).where(eq(studentsTable.id, parseInt(studentId, 10)));
    if (!student || !student.agentId || !visibleIds.includes(student.agentId)) {
      res.status(403).json({ error: "Access denied" }); return;
    }
  }

  try {
    const mergedPdf = await PDFDocument.create();

    for (const doc of pdfDocs) {
      const pdfBytes = Buffer.from(doc.fileData!, "base64");
      const sourcePdf = await PDFDocument.load(pdfBytes);
      const pages = await mergedPdf.copyPages(sourcePdf, sourcePdf.getPageIndices());
      for (const page of pages) {
        mergedPdf.addPage(page);
      }
    }

    const mergedBytes = await mergedPdf.save();
    const base64 = Buffer.from(mergedBytes).toString("base64");

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="merged_documents.pdf"`);
    res.send(Buffer.from(mergedBytes));
  } catch (err) {
    console.error("[DOCUMENTS] PDF merge error:", err);
    res.status(500).json({ error: "Failed to merge PDFs" });
  }
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
