import { Router, type IRouter } from "express";
import { db, invoicesTable, commissionsTable, serviceFeesTable } from "@workspace/db";
import { eq, sql, and, ilike } from "drizzle-orm";
import { requireAuth, requireRole, logAudit } from "../lib/auth";
import { FINANCE_ROLES, STAFF_ROLES } from "../lib/roles";

const router: IRouter = Router();

function generateInvoiceNumber() {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `INV-${ts}-${rand}`;
}

function toNum(v: any): number {
  return parseFloat(String(v ?? 0)) || 0;
}

function calcCommissionAmounts(body: any) {
  const programFee = toNum(body.programFee);
  const uRate = toNum(body.universityCommissionRate);
  const aRate = toNum(body.agentCommissionRate);
  const uAmount = body.universityCommissionAmount !== undefined
    ? toNum(body.universityCommissionAmount)
    : programFee > 0 && uRate > 0 ? (programFee * uRate) / 100 : 0;
  const aAmount = body.agentCommissionAmount !== undefined
    ? toNum(body.agentCommissionAmount)
    : uAmount > 0 && aRate > 0 ? (uAmount * aRate) / 100 : 0;
  return { uAmount, aAmount };
}

/* ─── COMMISSIONS ────────────────────────────────────────────── */

const COMMISSION_PATCH_FIELDS = [
  "status", "season", "currency", "studentName", "universityName", "programName",
  "isStateUniversity", "programFee", "universityCommissionRate", "universityCommissionAmount",
  "universityCollected", "agentCommissionRate", "agentCommissionAmount", "agentPaid",
  "confirmedAt", "offsetAmount", "studentId", "agentId", "applicationId", "notes",
];

router.get("/commissions", requireAuth, requireRole(...STAFF_ROLES), async (req, res): Promise<void> => {
  const { agentId, status, season, search, page = "1", limit = "100" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(500, Math.max(1, parseInt(limit, 10)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];
  if (agentId) conditions.push(eq(commissionsTable.agentId, parseInt(agentId, 10)));
  if (status) conditions.push(eq(commissionsTable.status, status));
  if (season) conditions.push(eq(commissionsTable.season, season));
  if (search) {
    conditions.push(
      sql`(${commissionsTable.studentName} ilike ${"%" + search + "%"} OR ${commissionsTable.universityName} ilike ${"%" + search + "%"})`
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(commissionsTable).where(whereClause);
  const data = await db.select().from(commissionsTable).where(whereClause).limit(limitNum).offset(offset)
    .orderBy(commissionsTable.createdAt);

  const all = await db.select().from(commissionsTable).where(whereClause);
  const summary = {
    potentialCount: all.filter(c => c.status === "potential").length,
    confirmedCount: all.filter(c => c.status === "confirmed").length,
    totalUniversityCommission: all.reduce((s, c) => s + toNum(c.universityCommissionAmount), 0),
    totalUniversityCollected: all.reduce((s, c) => s + toNum(c.universityCollected), 0),
    totalAgentCommission: all.reduce((s, c) => s + toNum(c.agentCommissionAmount), 0),
    totalAgentPaid: all.reduce((s, c) => s + toNum(c.agentPaid), 0),
    totalNetAgency: all.reduce((s, c) => s + (toNum(c.universityCommissionAmount) - toNum(c.agentCommissionAmount)), 0),
    totalOffsetAmount: all.reduce((s, c) => s + toNum(c.offsetAmount), 0),
  };

  res.json({
    data,
    summary,
    meta: { total: Number(count), page: pageNum, limit: limitNum, totalPages: Math.ceil(Number(count) / limitNum) },
  });
});

router.post("/commissions", requireAuth, requireRole(...FINANCE_ROLES), async (req, res): Promise<void> => {
  const {
    applicationId, studentId, agentId,
    studentName, universityName, programName, isStateUniversity,
    season = String(new Date().getFullYear()),
    currency = "USD",
    programFee, universityCommissionRate, agentCommissionRate,
    universityCommissionAmount, agentCommissionAmount,
    status = "potential", notes,
  } = req.body;

  const { uAmount, aAmount } = calcCommissionAmounts({
    programFee, universityCommissionRate, agentCommissionRate,
    universityCommissionAmount, agentCommissionAmount,
  });

  const [commission] = await db.insert(commissionsTable).values({
    applicationId: applicationId || null,
    studentId: studentId || null,
    agentId: agentId || null,
    studentName: studentName || null,
    universityName: universityName || null,
    programName: programName || null,
    isStateUniversity: isStateUniversity ?? false,
    season,
    currency,
    programFee: programFee ? String(programFee) : null,
    universityCommissionRate: universityCommissionRate ? String(universityCommissionRate) : null,
    universityCommissionAmount: uAmount > 0 ? String(uAmount) : (universityCommissionAmount ? String(universityCommissionAmount) : null),
    universityCollected: "0",
    agentCommissionRate: agentCommissionRate ? String(agentCommissionRate) : null,
    agentCommissionAmount: aAmount > 0 ? String(aAmount) : (agentCommissionAmount ? String(agentCommissionAmount) : null),
    agentPaid: "0",
    status,
    offsetAmount: "0",
    notes: notes || null,
  }).returning();

  await logAudit(req.user!.id, "create_commission", "commission", commission.id, { studentName, universityName }, req.ip);
  res.status(201).json(commission);
});

router.get("/commissions/:id", requireAuth, requireRole(...STAFF_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [c] = await db.select().from(commissionsTable).where(eq(commissionsTable.id, id));
  if (!c) { res.status(404).json({ error: "Commission not found" }); return; }
  res.json(c);
});

router.patch("/commissions/:id", requireAuth, requireRole(...FINANCE_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const updates: Record<string, unknown> = {};
  for (const key of COMMISSION_PATCH_FIELDS) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }

  if (req.body.universityCommissionRate !== undefined || req.body.programFee !== undefined || req.body.agentCommissionRate !== undefined) {
    const existing = await db.select().from(commissionsTable).where(eq(commissionsTable.id, id));
    if (existing[0]) {
      const merged = { ...existing[0], ...req.body };
      const { uAmount, aAmount } = calcCommissionAmounts(merged);
      if (!req.body.universityCommissionAmount && uAmount > 0) updates.universityCommissionAmount = String(uAmount);
      if (!req.body.agentCommissionAmount && aAmount > 0) updates.agentCommissionAmount = String(aAmount);
    }
  }

  if (req.body.status === "confirmed" && !req.body.confirmedAt) {
    updates.confirmedAt = new Date().toISOString();
  }

  if (Object.keys(updates).length === 0) { res.status(400).json({ error: "No valid fields" }); return; }
  const [commission] = await db.update(commissionsTable).set(updates).where(eq(commissionsTable.id, id)).returning();
  if (!commission) { res.status(404).json({ error: "Commission not found" }); return; }
  await logAudit(req.user!.id, "update_commission", "commission", id, updates, req.ip);
  res.json(commission);
});

router.delete("/commissions/:id", requireAuth, requireRole(...FINANCE_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(commissionsTable).where(eq(commissionsTable.id, id));
  await logAudit(req.user!.id, "delete_commission", "commission", id, {}, req.ip);
  res.sendStatus(204);
});

/* ─── SERVICE FEES ───────────────────────────────────────────── */

const SERVICE_FEE_PATCH_FIELDS = [
  "status", "season", "currency", "totalAmount", "payerType",
  "studentName", "universityName", "isStateUniversity",
  "firstInstallmentAmount", "firstInstallmentPaidAt",
  "secondInstallmentAmount", "secondInstallmentPaidAt",
  "studentId", "agentId", "applicationId", "notes",
];

router.get("/service-fees", requireAuth, requireRole(...STAFF_ROLES), async (req, res): Promise<void> => {
  const { studentId, agentId, status, season, page = "1", limit = "100" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(500, Math.max(1, parseInt(limit, 10)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];
  if (studentId) conditions.push(eq(serviceFeesTable.studentId, parseInt(studentId, 10)));
  if (agentId) conditions.push(eq(serviceFeesTable.agentId, parseInt(agentId, 10)));
  if (status) conditions.push(eq(serviceFeesTable.status, status));
  if (season) conditions.push(eq(serviceFeesTable.season, season));
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(serviceFeesTable).where(whereClause);
  const data = await db.select().from(serviceFeesTable).where(whereClause).limit(limitNum).offset(offset)
    .orderBy(serviceFeesTable.createdAt);

  const all = await db.select().from(serviceFeesTable).where(whereClause);
  const summary = {
    totalServiceFees: all.reduce((s, f) => s + toNum(f.totalAmount), 0),
    totalCollected: all.reduce((s, f) => s + toNum(f.firstInstallmentPaidAt ? f.firstInstallmentAmount : 0) + toNum(f.secondInstallmentPaidAt ? f.secondInstallmentAmount : 0), 0),
    pendingCount: all.filter(f => f.status === "pending").length,
    partialCount: all.filter(f => f.status === "partial").length,
    paidCount: all.filter(f => f.status === "paid").length,
  };

  res.json({ data, summary, meta: { total: Number(count), page: pageNum, limit: limitNum, totalPages: Math.ceil(Number(count) / limitNum) } });
});

router.post("/service-fees", requireAuth, requireRole(...FINANCE_ROLES), async (req, res): Promise<void> => {
  const {
    applicationId, studentId, agentId,
    studentName, universityName, isStateUniversity,
    payerType = "student",
    season = String(new Date().getFullYear()),
    currency = "USD",
    totalAmount, notes,
  } = req.body;

  if (!totalAmount) { res.status(400).json({ error: "totalAmount is required" }); return; }
  const total = toNum(totalAmount);
  if (total <= 0) { res.status(400).json({ error: "totalAmount must be positive" }); return; }

  const half = total / 2;

  const [fee] = await db.insert(serviceFeesTable).values({
    applicationId: applicationId || null,
    studentId: studentId || null,
    agentId: agentId || null,
    studentName: studentName || null,
    universityName: universityName || null,
    isStateUniversity: isStateUniversity ?? false,
    payerType,
    season,
    currency,
    totalAmount: String(total),
    firstInstallmentAmount: String(half),
    firstInstallmentPaidAt: null,
    secondInstallmentAmount: String(half),
    secondInstallmentPaidAt: null,
    status: "pending",
    notes: notes || null,
  }).returning();

  await logAudit(req.user!.id, "create_service_fee", "service_fee", fee.id, { studentName, totalAmount }, req.ip);
  res.status(201).json(fee);
});

router.patch("/service-fees/:id", requireAuth, requireRole(...FINANCE_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const updates: Record<string, unknown> = {};
  for (const key of SERVICE_FEE_PATCH_FIELDS) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }

  const existingArr = await db.select().from(serviceFeesTable).where(eq(serviceFeesTable.id, id));
  if (!existingArr[0]) { res.status(404).json({ error: "Service fee not found" }); return; }
  const existing = existingArr[0];

  const firstPaid = req.body.firstInstallmentPaidAt !== undefined
    ? !!req.body.firstInstallmentPaidAt
    : !!existing.firstInstallmentPaidAt;
  const secondPaid = req.body.secondInstallmentPaidAt !== undefined
    ? !!req.body.secondInstallmentPaidAt
    : !!existing.secondInstallmentPaidAt;

  if (firstPaid && secondPaid) updates.status = "paid";
  else if (firstPaid || secondPaid) updates.status = "partial";
  else updates.status = "pending";

  if (Object.keys(updates).length === 0) { res.status(400).json({ error: "No valid fields" }); return; }
  const [fee] = await db.update(serviceFeesTable).set(updates).where(eq(serviceFeesTable.id, id)).returning();
  await logAudit(req.user!.id, "update_service_fee", "service_fee", id, updates, req.ip);
  res.json(fee);
});

router.delete("/service-fees/:id", requireAuth, requireRole(...FINANCE_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(serviceFeesTable).where(eq(serviceFeesTable.id, id));
  await logAudit(req.user!.id, "delete_service_fee", "service_fee", id, {}, req.ip);
  res.sendStatus(204);
});

/* ─── FINANCE SUMMARY ────────────────────────────────────────── */

router.get("/finance/summary", requireAuth, requireRole(...STAFF_ROLES), async (req, res): Promise<void> => {
  const { season } = req.query as Record<string, string>;
  const conditions = [];
  const sfConditions = [];
  if (season) {
    conditions.push(eq(commissionsTable.season, season));
    sfConditions.push(eq(serviceFeesTable.season, season));
  }
  const whereComm = conditions.length > 0 ? and(...conditions) : undefined;
  const whereSF = sfConditions.length > 0 ? and(...sfConditions) : undefined;

  const commissions = await db.select().from(commissionsTable).where(whereComm);
  const fees = await db.select().from(serviceFeesTable).where(whereSF);

  const confirmedCommissions = commissions.filter(c => c.status === "confirmed" || c.status === "collected_partial" || c.status === "collected_full" || c.status === "settled");
  const totalConfirmedCommission = confirmedCommissions.reduce((s, c) => s + toNum(c.universityCommissionAmount), 0);
  const totalOffsetUsed = commissions.reduce((s, c) => s + toNum(c.offsetAmount), 0);
  const availableOffset = Math.min(totalConfirmedCommission * 0.7, totalConfirmedCommission - totalOffsetUsed);

  res.json({
    season: season || "all",
    commissions: {
      potential: commissions.filter(c => c.status === "potential").length,
      confirmed: commissions.filter(c => c.status !== "potential").length,
      totalUniversityCommission: commissions.reduce((s, c) => s + toNum(c.universityCommissionAmount), 0),
      totalUniversityCollected: commissions.reduce((s, c) => s + toNum(c.universityCollected), 0),
      totalUniversityPending: commissions.reduce((s, c) => s + (toNum(c.universityCommissionAmount) - toNum(c.universityCollected)), 0),
      totalAgentCommission: commissions.reduce((s, c) => s + toNum(c.agentCommissionAmount), 0),
      totalAgentPaid: commissions.reduce((s, c) => s + toNum(c.agentPaid), 0),
      totalAgentPending: commissions.reduce((s, c) => s + (toNum(c.agentCommissionAmount) - toNum(c.agentPaid)), 0),
      totalNetAgency: commissions.reduce((s, c) => s + (toNum(c.universityCollected) - toNum(c.agentPaid)), 0),
    },
    serviceFees: {
      total: fees.reduce((s, f) => s + toNum(f.totalAmount), 0),
      collected: fees.reduce((s, f) => {
        return s + toNum(f.firstInstallmentPaidAt ? f.firstInstallmentAmount : 0) + toNum(f.secondInstallmentPaidAt ? f.secondInstallmentAmount : 0);
      }, 0),
      pending: fees.filter(f => f.status === "pending").length,
      partial: fees.filter(f => f.status === "partial").length,
      paid: fees.filter(f => f.status === "paid").length,
    },
    offset: {
      totalConfirmedCommission,
      totalOffsetUsed,
      availableForOffset: Math.max(0, availableOffset),
      maxOffsetRate: 70,
    },
  });
});

/* ─── INVOICES (kept for backward compat) ────────────────────── */

router.get("/invoices", requireAuth, requireRole(...STAFF_ROLES), async (req, res): Promise<void> => {
  const { studentId, status, page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
  const offset = (pageNum - 1) * limitNum;
  const conditions = [];
  if (studentId) conditions.push(eq(invoicesTable.studentId, parseInt(studentId, 10)));
  if (status) conditions.push(eq(invoicesTable.status, status));
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(invoicesTable).where(whereClause);
  const data = await db.select().from(invoicesTable).where(whereClause).limit(limitNum).offset(offset).orderBy(invoicesTable.createdAt);
  res.json({ data, meta: { total: Number(count), page: pageNum, limit: limitNum, totalPages: Math.ceil(Number(count) / limitNum) } });
});

router.post("/invoices", requireAuth, requireRole(...FINANCE_ROLES), async (req, res): Promise<void> => {
  const { studentId, amount, currency = "USD", status = "draft", dueDate, notes } = req.body;
  if (!studentId || !amount) { res.status(400).json({ error: "studentId and amount are required" }); return; }
  const [invoice] = await db.insert(invoicesTable).values({
    studentId, amount: String(amount), currency, status, invoiceNumber: generateInvoiceNumber(),
    dueDate: dueDate || null, notes: notes || null,
  }).returning();
  await logAudit(req.user!.id, "create_invoice", "invoice", invoice.id, { studentId, amount }, req.ip);
  res.status(201).json(invoice);
});

router.patch("/invoices/:id", requireAuth, requireRole(...FINANCE_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const FIELDS = ["status", "amount", "currency", "dueDate", "paidAt", "notes"];
  const updates: Record<string, unknown> = {};
  for (const key of FIELDS) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }
  if (Object.keys(updates).length === 0) { res.status(400).json({ error: "No valid fields" }); return; }
  const [invoice] = await db.update(invoicesTable).set(updates).where(eq(invoicesTable.id, id)).returning();
  if (!invoice) { res.status(404).json({ error: "Invoice not found" }); return; }
  res.json(invoice);
});

export default router;
