import { Router, type IRouter } from "express";
import { db, usersTable } from "@workspace/db";
import { eq, ilike, or, sql } from "drizzle-orm";
import { requireAuth, requireRole, logAudit } from "../lib/auth";
import { ADMIN_ROLES, MANAGER_ROLES } from "../lib/roles";

const router: IRouter = Router();

const ALLOWED_PATCH_FIELDS = ["email", "firstName", "lastName", "phone", "language", "isActive"];
const ADMIN_PATCH_FIELDS = [...ALLOWED_PATCH_FIELDS, "role"];

router.get("/users", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  const { role, search, page = "1", limit = "50" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];
  if (role) conditions.push(eq(usersTable.role, role));
  if (search) {
    conditions.push(
      or(
        ilike(usersTable.firstName, `%${search}%`),
        ilike(usersTable.lastName, `%${search}%`),
        ilike(usersTable.email, `%${search}%`)
      )
    );
  }

  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(usersTable);

  const data = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      role: usersTable.role,
      phone: usersTable.phone,
      language: usersTable.language,
      isActive: usersTable.isActive,
      avatarUrl: usersTable.avatarUrl,
      createdAt: usersTable.createdAt,
    })
    .from(usersTable)
    .limit(limitNum)
    .offset(offset);

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

router.post("/users", requireAuth, requireRole(...ADMIN_ROLES), async (req, res): Promise<void> => {
  const { email, firstName, lastName, role, phone, language } = req.body;
  if (!email || !firstName || !lastName || !role) {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }

  const VALID_ROLES = ["super_admin", "admin", "manager", "staff", "consultant", "editor", "accountant", "student", "agent", "sub_agent", "pending"];
  if (!VALID_ROLES.includes(role)) {
    res.status(400).json({ error: "Invalid role" });
    return;
  }

  const [user] = await db
    .insert(usersTable)
    .values({ email, firstName, lastName, role, phone: phone || null, language: language || "en", isActive: true })
    .returning();
  await logAudit(req.user!.id, "create_user", "user", user.id, { role }, req.ip);
  res.status(201).json(user);
});

router.get("/users/:id", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  const { replitId: _r, ...safeUser } = user as any;
  res.json(safeUser);
});

router.patch("/users/:id", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const isAdmin = ADMIN_ROLES.includes(req.user!.role as any);
  const isSelf = req.user!.id === id;

  if (!isAdmin && !isSelf) {
    res.status(403).json({ error: "Insufficient permissions" });
    return;
  }

  const allowedFields = isAdmin ? ADMIN_PATCH_FIELDS : ALLOWED_PATCH_FIELDS;
  const updates: Record<string, unknown> = {};
  for (const key of allowedFields) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }

  if (!isAdmin && updates.role !== undefined) {
    delete updates.role;
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No valid fields to update" });
    return;
  }

  const [user] = await db.update(usersTable).set(updates).where(eq(usersTable.id, id)).returning();
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  await logAudit(req.user!.id, "update_user", "user", id, updates, req.ip);
  res.json(user);
});

router.delete("/users/:id", requireAuth, requireRole(...ADMIN_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (req.user!.id === id) {
    res.status(400).json({ error: "Cannot delete your own account" });
    return;
  }
  await db.delete(usersTable).where(eq(usersTable.id, id));
  await logAudit(req.user!.id, "delete_user", "user", id, {}, req.ip);
  res.sendStatus(204);
});

export default router;
