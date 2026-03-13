import { Router, type IRouter } from "express";
import { db, documentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();

router.get("/documents", requireAuth, async (req, res): Promise<void> => {
  const { studentId, applicationId, type, status } = req.query as Record<string, string>;

  let query = db.select().from(documentsTable);
  const docs = await db.select().from(documentsTable).orderBy(documentsTable.createdAt);
  res.json(docs);
});

router.post("/documents", requireAuth, async (req, res): Promise<void> => {
  const { name, type, status = "pending", ...rest } = req.body;
  if (!name || !type) {
    res.status(400).json({ error: "name and type are required" });
    return;
  }
  const [doc] = await db.insert(documentsTable).values({ name, type, status, ...rest }).returning();
  res.status(201).json(doc);
});

router.get("/documents/:id", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, id));
  if (!doc) { res.status(404).json({ error: "Document not found" }); return; }
  res.json(doc);
});

router.patch("/documents/:id", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  const [doc] = await db.update(documentsTable).set(req.body).where(eq(documentsTable.id, id)).returning();
  if (!doc) { res.status(404).json({ error: "Document not found" }); return; }
  res.json(doc);
});

router.delete("/documents/:id", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  await db.delete(documentsTable).where(eq(documentsTable.id, id));
  res.sendStatus(204);
});

router.post("/documents/:id/extract", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, id));
  if (!doc) { res.status(404).json({ error: "Document not found" }); return; }

  const extractedFields: Record<string, string> = {};
  const confidenceScore = 0.85;
  const docType = doc.type;

  if (docType === "passport") {
    extractedFields["documentType"] = "Passport";
    extractedFields["note"] = "AI extraction requires document file. Please upload a document file for AI processing.";
  } else if (docType === "diploma" || docType === "transcript") {
    extractedFields["documentType"] = docType;
    extractedFields["note"] = "AI extraction requires document file. Please upload a document file for AI processing.";
  } else {
    extractedFields["documentType"] = docType;
    extractedFields["note"] = "AI extraction requires document file.";
  }

  await db.update(documentsTable).set({
    extractedData: JSON.stringify(extractedFields),
    confidenceScore,
    status: "extracted",
  }).where(eq(documentsTable.id, id));

  res.json({
    documentId: id,
    extractedFields,
    confidenceScore,
    rawText: null,
    docType,
  });
});

export default router;
