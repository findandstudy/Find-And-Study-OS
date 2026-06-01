import { Router, type IRouter } from "express";
import { db, usersTable, rolesTable, studentsTable, softDelete } from "@workspace/db";
import { eq, ilike, or, sql, and, isNull } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { requireAuth, requireRole, logAudit } from "../lib/auth";
import { ADMIN_ROLES, MANAGER_ROLES, STAFF_ROLES } from "../lib/roles";
import { createSession, SESSION_TTL, SESSION_COOKIE, type SessionData } from "../lib/replitAuth";
import { getSessionCookieOptions } from "../lib/cookieOptions";
import { validatePassword } from "../lib/passwordPolicy";
import { parsePaginationParams, buildPageMeta } from "@workspace/pagination";
import { z } from "zod";
import { validate, getValidated } from "../middlewares/validate";

const createUserBodySchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  role: z.string().min(1),
  phone: z.string().trim().optional().nullable(),
  language: z.string().trim().optional(),
  password: z.string().optional(),
  avatarUrl: z.string().trim().optional().nullable(),
});

const router: IRouter = Router();

const ALLOWED_PATCH_FIELDS = ["email", "firstName", "lastName", "phone", "language", "avatarUrl", "startDate", "homeAddress", "passportNumber", "contractUrl", "passportUrl", "emergencyContactName", "emergencyContactPhone"];
const ADMIN_PATCH_FIELDS = [...ALLOWED_PATCH_FIELDS, "role", "isActive", "permissionOverrides"];

router.get("/users", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  const { role, search } = req.query as Record<string, string>;
  const pageParams = parsePaginationParams(req, { defaultLimit: 50, maxLimit: "small" });

  const conditions = [isNull(usersTable.deletedAt)];
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
    .limit(pageParams.limit)
    .offset(pageParams.offset);

  res.json({ data, meta: buildPageMeta(Number(count), pageParams) });
});

router.post("/users", requireAuth, requireRole(...ADMIN_ROLES), validate({ body: createUserBodySchema }), async (req, res): Promise<void> => {
  const { email: normalizedEmail, firstName, lastName, role, phone, language, password, avatarUrl } =
    getValidated<{ body: typeof createUserBodySchema }>(req).body;

  const BUILTIN_ROLES = ["super_admin", "admin", "manager", "staff", "consultant", "editor", "accountant", "student", "agent", "sub_agent", "pending"];
  const dbRoles = await db.select({ name: rolesTable.name }).from(rolesTable);
  const validRoles = [...new Set([...BUILTIN_ROLES, ...dbRoles.map(r => r.name)])];
  if (!validRoles.includes(role)) {
    res.status(400).json({ error: "Invalid role" });
    return;
  }

  const [existingUser] = await db.select().from(usersTable).where(and(eq(usersTable.email, normalizedEmail), isNull(usersTable.deletedAt)));
  if (existingUser) {
    if (existingUser.role !== role) {
      res.status(409).json({ error: `This email is already in use by a ${existingUser.role} account. Same email cannot be used across different roles.` });
    } else {
      res.status(409).json({ error: "A user with this email already exists" });
    }
    return;
  }

  let passwordHash: string | undefined;
  if (password) {
    const pwd = validatePassword(password);
    if (!pwd.ok) {
      res.status(400).json({ error: pwd.message });
      return;
    }
    passwordHash = await bcrypt.hash(pwd.value, 10);
  }

  const [user] = await db
    .insert(usersTable)
    .values({
      email: normalizedEmail,
      firstName, lastName, role,
      phone: phone || null,
      language: language || "en",
      avatarUrl: avatarUrl || null,
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

  if (updates.permissionOverrides !== undefined) {
    const po = updates.permissionOverrides;
    if (po === null) {
      updates.permissionOverrides = null;
    } else if (typeof po !== "object" || Array.isArray(po)) {
      res.status(400).json({ error: "permissionOverrides must be an object" });
      return;
    } else {
      const cleaned: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(po as Record<string, unknown>)) {
        if (typeof v === "boolean") cleaned[k] = v;
      }
      updates.permissionOverrides = cleaned;
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
  const [existing] = await db.select({ id: usersTable.id, email: usersTable.email })
    .from(usersTable)
    .where(and(eq(usersTable.id, id), isNull(usersTable.deletedAt)));
  if (!existing) { res.status(404).json({ error: "User not found" }); return; }

  // Soft-delete: set deletedAt/deletedBy, deactivate, and free the email so
  // a fresh account can reuse the same address. Original is preserved with a
  // `<id>__deleted_<email>` prefix for forensic reference and to keep the
  // unique index satisfied.
  const renamedEmail = existing.email
    ? `${id}__deleted_${existing.email}`.slice(0, 255)
    : null;
  await db.update(usersTable).set({
    deletedAt: sql`now()`,
    deletedBy: req.user!.id,
    isActive: false,
    email: renamedEmail,
  }).where(eq(usersTable.id, id));
  await logAudit(req.user!.id, "delete_user", "user", id, { soft: true }, req.ip);
  res.sendStatus(204);
});

// Hard-delete (purge) — super_admin only. Drops the row entirely; only run
// after audit / commission references have been re-attributed.
router.post("/users/:id/purge", requireAuth, requireRole("super_admin"), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (req.user!.id === id) {
    res.status(400).json({ error: "Cannot purge your own account" });
    return;
  }
  const result = await db.delete(usersTable).where(eq(usersTable.id, id));
  await logAudit(req.user!.id, "purge_user", "user", id, { hard: true }, req.ip);
  res.json({ success: true, deleted: result.rowCount ?? 0 });
});

router.post("/users/:id/set-password", requireAuth, requireRole(...ADMIN_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const { password } = req.body;
  const pwd = validatePassword(password);
  if (!pwd.ok) {
    res.status(400).json({ error: pwd.message });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  const hash = await bcrypt.hash(pwd.value, 10);
  await db.update(usersTable).set({ passwordHash: hash }).where(eq(usersTable.id, id));
  await logAudit(req.user!.id, "auth.set_password", "user", id, { adminInitiated: true }, req.ip);
  res.json({ success: true });
});

router.get("/users/me/profile", requireAuth, async (req, res): Promise<void> => {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.id));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  const { passwordHash: _ph, replitId: _rid, ...safe } = user as Record<string, unknown>;
  res.json(safe);
});

router.post("/users/me/change-password", requireAuth, async (req, res): Promise<void> => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: "Current and new password are required" });
    return;
  }
  const pwd = validatePassword(newPassword);
  if (!pwd.ok) {
    res.status(400).json({ error: pwd.message });
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
  const hash = await bcrypt.hash(pwd.value, 10);
  await db.update(usersTable).set({ passwordHash: hash }).where(eq(usersTable.id, req.user!.id));
  await logAudit(req.user!.id, "auth.change_password", "user", req.user!.id, {}, req.ip);
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

  const currentSid = req.cookies[SESSION_COOKIE];
  if (!currentSid) { res.status(400).json({ error: "Session cookie required for impersonation" }); return; }

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
    originalSid: currentSid,
  };

  const sid = await createSession(sessionData);
  res.cookie(SESSION_COOKIE, sid, getSessionCookieOptions(req, SESSION_TTL));
  await logAudit(req.user!.id, "auth.impersonate.start", "user", id, { targetRole: targetUser.role }, req.ip);
  let redirectTo = "/staff";
  if (ADMIN_ROLES.includes(targetUser.role as any)) redirectTo = "/admin";
  else if (targetUser.role === "student") redirectTo = "/student";
  else if (["agent", "sub_agent", "agent_staff"].includes(targetUser.role)) redirectTo = "/agent";
  else if (STAFF_ROLES.includes(targetUser.role as any)) redirectTo = "/staff";
  res.json({ success: true, redirectTo, role: targetUser.role });
});

export default router;
