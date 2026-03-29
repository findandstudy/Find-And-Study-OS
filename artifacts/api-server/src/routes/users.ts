import { Router, type IRouter } from "express";
import { db, usersTable, rolesTable } from "@workspace/db";
import { eq, ilike, or, sql, and } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { requireAuth, requireRole, logAudit } from "../lib/auth";
import { ADMIN_ROLES, MANAGER_ROLES, STAFF_ROLES } from "../lib/roles";
import { createSession, SESSION_TTL, type SessionData } from "../lib/replitAuth";

const router: IRouter = Router();

const ALLOWED_PATCH_FIELDS = ["email", "firstName", "lastName", "phone", "language", "avatarUrl", "startDate", "homeAddress", "passportNumber", "contractUrl", "passportUrl", "emergencyContactName", "emergencyContactPhone"];
const ADMIN_PATCH_FIELDS = [...ALLOWED_PATCH_FIELDS, "role", "isActive"];

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

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(usersTable).where(whereClause);

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
    .where(whereClause)
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
  const { email, firstName, lastName, role, phone, language, password } = req.body;
  if (!email || !firstName || !lastName || !role) {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }

  const BUILTIN_ROLES = ["super_admin", "admin", "manager", "staff", "consultant", "editor", "accountant", "student", "agent", "sub_agent", "pending"];
  const dbRoles = await db.select({ name: rolesTable.name }).from(rolesTable);
  const validRoles = [...new Set([...BUILTIN_ROLES, ...dbRoles.map(r => r.name)])];
  if (!validRoles.includes(role)) {
    res.status(400).json({ error: "Invalid role" });
    return;
  }

  const [existingUser] = await db.select().from(usersTable).where(eq(usersTable.email, email.toLowerCase().trim()));
  if (existingUser) {
    res.status(409).json({ error: "A user with this email already exists" });
    return;
  }

  let passwordHash: string | undefined;
  if (password) {
    if (password.length < 6) {
      res.status(400).json({ error: "Password must be at least 6 characters" });
      return;
    }
    passwordHash = await bcrypt.hash(password, 10);
  }

  const [user] = await db
    .insert(usersTable)
    .values({
      email: email.toLowerCase().trim(),
      firstName, lastName, role,
      phone: phone || null,
      language: language || "en",
      isActive: true,
      emailVerified: true,
      passwordHash: passwordHash || null,
    })
    .returning();
  await logAudit(req.user!.id, "create_user", "user", user.id, { role }, req.ip);
  const { passwordHash: _ph, replitId: _ri, ...safeNewUser } = user as any;
  res.status(201).json(safeNewUser);
});

router.get("/users/:id", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  const { replitId: _r, passwordHash: _p, ...safeUser } = user as any;
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

  if (updates.role !== undefined) {
    const BUILTIN = ["super_admin", "admin", "manager", "staff", "consultant", "editor", "accountant", "student", "agent", "sub_agent", "pending"];
    const dbR = await db.select({ name: rolesTable.name }).from(rolesTable);
    const valid = [...new Set([...BUILTIN, ...dbR.map(r => r.name)])];
    if (!valid.includes(updates.role as string)) {
      res.status(400).json({ error: "Invalid role" });
      return;
    }
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No valid fields to update" });
    return;
  }

  const [user] = await db.update(usersTable).set(updates).where(eq(usersTable.id, id)).returning();
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  await logAudit(req.user!.id, "update_user", "user", id, updates, req.ip);
  const { passwordHash: _ph2, replitId: _ri2, ...safePatchUser } = user as any;
  res.json(safePatchUser);
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

router.post("/users/:id/set-password", requireAuth, requireRole(...ADMIN_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const { password } = req.body;
  if (!password || password.length < 6) {
    res.status(400).json({ error: "Password must be at least 6 characters" });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  const hash = await bcrypt.hash(password, 10);
  await db.update(usersTable).set({ passwordHash: hash }).where(eq(usersTable.id, id));
  await logAudit(req.user!.id, "set_password", "user", id, {}, req.ip);
  res.json({ success: true });
});

router.post("/users/me/change-password", requireAuth, async (req, res): Promise<void> => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: "Current and new password are required" });
    return;
  }
  if (newPassword.length < 6) {
    res.status(400).json({ error: "New password must be at least 6 characters" });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.id));
  if (!user || !user.passwordHash) {
    res.status(400).json({ error: "Cannot change password" });
    return;
  }
  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) {
    res.status(400).json({ error: "Current password is incorrect" });
    return;
  }
  const hash = await bcrypt.hash(newPassword, 10);
  await db.update(usersTable).set({ passwordHash: hash }).where(eq(usersTable.id, req.user!.id));
  await logAudit(req.user!.id, "change_password", "user", req.user!.id, {}, req.ip);
  res.json({ success: true });
});

router.post("/users/:id/impersonate", requireAuth, requireRole(...ADMIN_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (req.user!.id === id) {
    res.status(400).json({ error: "Cannot impersonate yourself" });
    return;
  }
  const [targetUser] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!targetUser) { res.status(404).json({ error: "User not found" }); return; }

  const sessionData: SessionData = {
    user: {
      id: targetUser.id,
      replitId: targetUser.replitId || `impersonated-${targetUser.id}`,
      email: targetUser.email,
      firstName: targetUser.firstName,
      lastName: targetUser.lastName,
      role: targetUser.role,
      avatarUrl: targetUser.avatarUrl,
      language: targetUser.language,
      isActive: targetUser.isActive,
      emailVerified: targetUser.emailVerified,
    },
    access_token: `impersonation-${Date.now()}`,
  };

  const sid = await createSession(sessionData);
  res.cookie("sid", sid, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL,
  });
  await logAudit(req.user!.id, "impersonate_user", "user", id, { targetRole: targetUser.role }, req.ip);
  let redirectTo = "/staff";
  if (ADMIN_ROLES.includes(targetUser.role as any)) redirectTo = "/admin";
  else if (targetUser.role === "student") redirectTo = "/student";
  else if (["agent", "sub_agent", "agent_staff"].includes(targetUser.role)) redirectTo = "/agent";
  else if (STAFF_ROLES.includes(targetUser.role as any)) redirectTo = "/staff";
  res.json({ success: true, redirectTo, role: targetUser.role });
});

export default router;
