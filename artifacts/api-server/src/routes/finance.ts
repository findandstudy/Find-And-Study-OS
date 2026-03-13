import { Router, type IRouter } from "express";
import { db, invoicesTable, commissionsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();

function generateInvoiceNumber() {
  return `INV-${Date.now().toString(36).toUpperCase()}`;
}

router.get("/invoices", requireAuth, async (req, res): Promise<void> => {
  const { studentId, status, page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = parseInt(page, 10);
  const limitNum = parseInt(limit, 10);
  const offset = (pageNum - 1) * limitNum;

  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(invoicesTable);

  const data = await db
    .select()
    .from(invoicesTable)
    .limit(limitNum)
    .offset(offset)
    .orderBy(invoicesTable.createdAt);

  res.json({
    data,
    meta: {
      total: Number(count),
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(Number(count) / limitNum),
    },
  });
});

router.post("/invoices", requireAuth, async (req, res): Promise<void> => {
  const { studentId, amount, currency = "USD", status = "draft", ...rest } = req.body;
  if (!studentId || !amount) {
    res.status(400).json({ error: "studentId and amount are required" });
    return;
  }
  const [invoice] = await db.insert(invoicesTable).values({
    studentId,
    amount,
    currency,
    status,
    invoiceNumber: generateInvoiceNumber(),
    ...rest,
  }).returning();
  res.status(201).json(invoice);
});

router.get("/invoices/:id", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, id));
  if (!invoice) { res.status(404).json({ error: "Invoice not found" }); return; }
  res.json(invoice);
});

router.patch("/invoices/:id", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  const [invoice] = await db.update(invoicesTable).set(req.body).where(eq(invoicesTable.id, id)).returning();
  if (!invoice) { res.status(404).json({ error: "Invoice not found" }); return; }
  res.json(invoice);
});

router.get("/commissions", requireAuth, async (req, res): Promise<void> => {
  const { agentId, status } = req.query as Record<string, string>;
  const data = await db.select().from(commissionsTable).orderBy(commissionsTable.createdAt);
  res.json(data);
});

router.post("/commissions", requireAuth, async (req, res): Promise<void> => {
  const { agentId, amount, currency = "USD", status = "pending", ...rest } = req.body;
  if (!agentId || !amount) {
    res.status(400).json({ error: "agentId and amount are required" });
    return;
  }
  const [commission] = await db.insert(commissionsTable).values({ agentId, amount, currency, status, ...rest }).returning();
  res.status(201).json(commission);
});

router.patch("/commissions/:id", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  const [commission] = await db.update(commissionsTable).set(req.body).where(eq(commissionsTable.id, id)).returning();
  if (!commission) { res.status(404).json({ error: "Commission not found" }); return; }
  res.json(commission);
});

export default router;
