import { Router, type IRouter } from "express";
import { db, documentsTable, studentsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth, requireRole, logAudit } from "../lib/auth";
import { STAFF_ROLES } from "../lib/roles";

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

  const conditions = [];
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
  const docs = await db.select().from(documentsTable).where(whereClause).orderBy(documentsTable.createdAt);
  res.json(docs);
});

router.post("/documents", requireAuth, requireRole(...STAFF_ROLES), async (req, res): Promise<void> => {
  const { name, type, status = "pending", studentId, applicationId, fileUrl, fileData, mimeType, sizeBytes, notes } = req.body;
  if (!name || !type) {
    res.status(400).json({ error: "name and type are required" });
    return;
  }
  if (fileUrl && !isValidHttpUrl(fileUrl)) {
    res.status(400).json({ error: "fileUrl must be a valid http/https URL" });
    return;
  }
  const [doc] = await db.insert(documentsTable).values({
    name, type, status,
    studentId: studentId || null,
    applicationId: applicationId || null,
    fileUrl: fileUrl || null,
    fileData: fileData || null,
    mimeType: mimeType || null,
    sizeBytes: sizeBytes ? Number(sizeBytes) : null,
    notes: notes || null,
  }).returning();
  await logAudit(req.user!.id, "create_document", "document", doc.id, { name, type }, req.ip);
  res.status(201).json(doc);
});

router.get("/documents/:id", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, id));
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
  const [doc] = await db.update(documentsTable).set(updates).where(eq(documentsTable.id, id)).returning();
  if (!doc) { res.status(404).json({ error: "Document not found" }); return; }
  await logAudit(req.user!.id, "update_document", "document", id, updates, req.ip);
  res.json(doc);
});

router.delete("/documents/:id", requireAuth, requireRole(...STAFF_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, id));
  if (!doc) { res.status(404).json({ error: "Document not found" }); return; }
  await db.delete(documentsTable).where(eq(documentsTable.id, id));
  await logAudit(req.user!.id, "delete_document", "document", id, { name: doc.name }, req.ip);
  res.sendStatus(204);
});

router.post("/documents/:id/extract", requireAuth, requireRole(...STAFF_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, id));
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
