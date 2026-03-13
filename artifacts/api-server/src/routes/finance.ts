import { Router, type IRouter } from "express";
import { db, invoicesTable, commissionsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { requireAuth, requireRole, logAudit } from "../lib/auth";
import { FINANCE_ROLES, MANAGER_ROLES } from "../lib/roles";

const router: IRouter = Router();

const INVOICE_PATCH_FIELDS = ["status", "amount", "currency", "dueDate", "paidAt", "notes"];
const COMMISSION_PATCH_FIELDS = ["status", "amount", "currency", "paidAt", "notes"];

function generateInvoiceNumber() {
  return `INV-${Date.now().toString(36).toUpperCase()}`;
}

router.get("/invoices", requireAuth, requireRole(...FINANCE_ROLES), async (req, res): Promise<void> => {
  const { studentId, status, page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
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

router.post("/invoices", requireAuth, requireRole(...FINANCE_ROLES), async (req, res): Promise<void> => {
  const { studentId, amount, currency = "USD", status = "draft", dueDate, notes } = req.body;
  if (!studentId || !amount) {
    res.status(400).json({ error: "studentId and amount are required" });
    return;
  }
  if (isNaN(Number(amount)) || Number(amount) <= 0) {
    res.status(400).json({ error: "amount must be a positive number" });
    return;
  }
  const [invoice] = await db.insert(invoicesTable).values({
    studentId,
    amount,
    currency,
    status,
    invoiceNumber: generateInvoiceNumber(),
    dueDate: dueDate || null,
    notes: notes || null,
  }).returning();
  await logAudit(req.user!.id, "create_invoice", "invoice", invoice.id, { studentId, amount }, req.ip);
  res.status(201).json(invoice);
});

router.get("/invoices/:id", requireAuth, requireRole(...FINANCE_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, id));
  if (!invoice) { res.status(404).json({ error: "Invoice not found" }); return; }
  res.json(invoice);
});

router.patch("/invoices/:id", requireAuth, requireRole(...FINANCE_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const updates: Record<string, unknown> = {};
  for (const key of INVOICE_PATCH_FIELDS) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No valid fields to update" });
    return;
  }
  const [invoice] = await db.update(invoicesTable).set(updates).where(eq(invoicesTable.id, id)).returning();
  if (!invoice) { res.status(404).json({ error: "Invoice not found" }); return; }
  await logAudit(req.user!.id, "update_invoice", "invoice", id, updates, req.ip);
  res.json(invoice);
});

router.get("/commissions", requireAuth, requireRole(...FINANCE_ROLES), async (req, res): Promise<void> => {
  const data = await db.select().from(commissionsTable).orderBy(commissionsTable.createdAt);
  res.json(data);
});

router.post("/commissions", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  const { agentId, amount, currency = "USD", status = "pending", notes } = req.body;
  if (!agentId || !amount) {
    res.status(400).json({ error: "agentId and amount are required" });
    return;
  }
  if (isNaN(Number(amount)) || Number(amount) <= 0) {
    res.status(400).json({ error: "amount must be a positive number" });
    return;
  }
  const [commission] = await db.insert(commissionsTable).values({
    agentId, amount, currency, status, notes: notes || null,
  }).returning();
  await logAudit(req.user!.id, "create_commission", "commission", commission.id, { agentId, amount }, req.ip);
  res.status(201).json(commission);
});

router.patch("/commissions/:id", requireAuth, requireRole(...FINANCE_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const updates: Record<string, unknown> = {};
  for (const key of COMMISSION_PATCH_FIELDS) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No valid fields to update" });
    return;
  }
  const [commission] = await db.update(commissionsTable).set(updates).where(eq(commissionsTable.id, id)).returning();
  if (!commission) { res.status(404).json({ error: "Commission not found" }); return; }
  await logAudit(req.user!.id, "update_commission", "commission", id, updates, req.ip);
  res.json(commission);
});

export default router;
