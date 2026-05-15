import { Router, type IRouter } from "express";
import crypto from "crypto";
import { db, agentsTable, usersTable, commissionsTable, agentBranchesTable, branchesTable, contractTemplatesTable, signingSessionsTable, settingsTable, emailVerificationCodesTable } from "@workspace/db";
import { eq, sql, isNull, isNotNull, and, or, ilike, inArray, desc, type SQL } from "drizzle-orm";
import { requireAuth, requireRole, requireAgentStaffPermission, logAudit, AGENT_STAFF_PERMISSIONS as PERM_KEYS } from "../lib/auth";
import { writeAudit } from "../lib/auditLog";
import { sendEmail } from "../lib/email";
import { createSigningToken } from "../lib/signingTokens";
import { ONBOARDING_HELPERS } from "./agentOnboarding";
import { STAFF_ROLES, MANAGER_ROLES } from "../lib/roles";
import { getVisibleBranchIds, isAgentInScope } from "../lib/branchScope";
import bcrypt from "bcryptjs";
import { createSession, getSession, deleteSession, SESSION_COOKIE, SESSION_TTL, type SessionData } from "../lib/replitAuth";
import { getSessionCookieOptions } from "../lib/cookieOptions";
import { dispatchNotification } from "../lib/notificationDispatcher";
import { toE164 } from "../lib/inbox/phone";
import { getCurrentSeason } from "../lib/season";
import { setAgencyStaff, getAgencyStaff, getAgencyStaffWithLegacy, getAgencyStaffMap, parseStaffInput, staffDisplayName } from "../lib/agencyStaff";
import { validatePassword } from "../lib/passwordPolicy";

const router: IRouter = Router();

const AGENT_PATCH_FIELDS = [
  "firstName", "lastName", "email", "phone",
  "status", "commissionRate", "notes", "companyName", "country",
  "agencyCode", "state", "city", "address", "businessName",
  "entityType", "taxNumber", "preferredContractLanguage", "assignedContractTemplateId",
  "category", "logoUrl", "agentIdProofUrl", "businessCertUrl",
  "contractUrl", "contractStartDate", "contractEndDate",
  "branch", "parentAgentId",
  "subAgentCommissionRate", "hideServiceFees", "assignedStaffId", "canManageStaff",
];

const AGENT_SELF_PATCH_FIELDS = [
  "businessName", "logoUrl", "businessCertUrl",
];

function isValidStorageUrl(url: string): boolean {
  if (!url) return true;
  return url.startsWith("/api/storage/objects/") || url.startsWith("https://");
}

router.get("/agents/contract-alerts", requireAuth, requireRole(...STAFF_ROLES), async (_req, res): Promise<void> => {
  try {
    const sixtyDaysFromNow = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
    const rows = await db.select({
      id: agentsTable.id,
      firstName: agentsTable.firstName,
      lastName: agentsTable.lastName,
      companyName: agentsTable.companyName,
      contractEndDate: agentsTable.contractEndDate,
    }).from(agentsTable)
      .where(
        and(
          isNotNull(agentsTable.contractEndDate),
          isNull(agentsTable.deletedAt),
          eq(agentsTable.status, "active"),
          sql`${agentsTable.contractEndDate} <= ${sixtyDaysFromNow.toISOString().split("T")[0]}`
        )
      )
      .orderBy(agentsTable.contractEndDate);
    res.json(rows);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/agents/me", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const userRole = req.user!.role;

  let agent;
  if (userRole === "agent_staff") {
    const [staffUser] = await db.select({ managingAgentId: usersTable.managingAgentId }).from(usersTable).where(eq(usersTable.id, userId));
    if (!staffUser?.managingAgentId) { res.status(404).json({ error: "Agent profile not found" }); return; }
    [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, staffUser.managingAgentId));
  } else {
    [agent] = await db.select().from(agentsTable).where(eq(agentsTable.userId, userId));
  }
  if (!agent) { res.status(404).json({ error: "Agent profile not found" }); return; }

  const assignedStaffList = await getAgencyStaffWithLegacy(agent.id, agent.assignedStaffId ?? null);
  const primaryEntry = assignedStaffList.find(s => s.isPrimary) || assignedStaffList[0] || null;
  const assignedStaff = primaryEntry ? {
    id: primaryEntry.userId,
    firstName: primaryEntry.firstName,
    lastName: primaryEntry.lastName,
    email: primaryEntry.email,
    phone: primaryEntry.phone,
    avatarUrl: primaryEntry.avatarUrl,
    role: primaryEntry.role,
  } : null;

  let parentAgent = null;
  if (userRole === "sub_agent" && agent.parentAgentId) {
    const [parentAgentRow] = await db.select().from(agentsTable).where(eq(agentsTable.id, agent.parentAgentId));
    if (parentAgentRow) {
      const [parentUser] = await db.select({
        id: usersTable.id,
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
        email: usersTable.email,
        phone: usersTable.phone,
        avatarUrl: usersTable.avatarUrl,
        role: usersTable.role,
      }).from(usersTable).where(eq(usersTable.id, parentAgentRow.userId));
      if (parentUser) {
        parentAgent = {
          ...parentUser,
          companyName: parentAgentRow.companyName,
          logoUrl: parentAgentRow.logoUrl,
        };
      }
    }
  }

  res.json({ ...agent, assignedStaff, assignedStaffList, parentAgent });
});

router.patch("/agents/me", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.userId, userId));
  if (!agent) { res.status(404).json({ error: "Agent profile not found" }); return; }
  const updates: Record<string, unknown> = {};
  for (const key of AGENT_SELF_PATCH_FIELDS) {
    if (req.body[key] !== undefined) {
      const val = req.body[key] || null;
      if ((key === "logoUrl" || key === "businessCertUrl") && val && !isValidStorageUrl(val)) {
        res.status(400).json({ error: `Invalid URL for ${key}` });
        return;
      }
      if (key === "businessName" && val && typeof val === "string" && val.length > 200) {
        res.status(400).json({ error: "Business name too long (max 200 characters)" });
        return;
      }
      updates[key] = val;
    }
  }
  if (Object.keys(updates).length === 0) {
    res.json(agent);
    return;
  }
  const [updated] = await db.update(agentsTable).set(updates).where(eq(agentsTable.id, agent.id)).returning();
  res.json(updated);
});

router.get("/agents/me/embed-token", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.userId, userId));
  if (!agent) { res.status(404).json({ error: "Agent profile not found" }); return; }
  if (!agent.embedToken) {
    const token = crypto.randomUUID();
    await db.update(agentsTable).set({ embedToken: token }).where(eq(agentsTable.id, agent.id));
    res.json({ embedToken: token });
    return;
  }
  res.json({ embedToken: agent.embedToken });
});

router.get("/agents/:agentId/embed-token", requireAuth, requireRole("super_admin"), async (req, res): Promise<void> => {
  const agentId = parseInt(req.params.agentId, 10);
  if (isNaN(agentId)) { res.status(400).json({ error: "Invalid agent id" }); return; }
  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, agentId));
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }
  if (!agent.embedToken) {
    const token = crypto.randomUUID();
    await db.update(agentsTable).set({ embedToken: token }).where(eq(agentsTable.id, agentId));
    res.json({ embedToken: token });
    return;
  }
  res.json({ embedToken: agent.embedToken });
});

router.get("/agents/me/sub-agents", requireAuth, requireRole("agent"), async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.userId, userId));
  if (!agent) { res.status(404).json({ error: "Agent profile not found" }); return; }

  const { search, status, page = "1", limit = "50" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
  const offset = (pageNum - 1) * limitNum;

  const conditions: SQL[] = [eq(agentsTable.parentAgentId, agent.id)];

  if (status && status !== "all") {
    conditions.push(eq(agentsTable.status, status));
  }
  if (search) {
    conditions.push(
      or(
        ilike(agentsTable.firstName, `%${search}%`),
        ilike(agentsTable.lastName, `%${search}%`),
        ilike(agentsTable.email, `%${search}%`),
        ilike(agentsTable.phone, `%${search}%`),
      )
    );
  }

  const whereClause = and(...conditions);
  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(agentsTable).where(whereClause);

  const data = await db
    .select()
    .from(agentsTable)
    .where(whereClause)
    .limit(limitNum)
    .offset(offset)
    .orderBy(desc(agentsTable.createdAt));

  res.json({
    data,
    meta: { total: Number(count), page: pageNum, limit: limitNum, totalPages: Math.ceil(Number(count) / limitNum) },
  });
});

router.post("/agents/me/sub-agents", requireAuth, requireRole("agent"), async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const [parentAgent] = await db.select().from(agentsTable).where(eq(agentsTable.userId, userId));
  if (!parentAgent) { res.status(404).json({ error: "Agent profile not found" }); return; }

  const { firstName, lastName, email, phone, commissionRate, password, companyName, logoUrl, hideServiceFees } = req.body;
  if (!firstName || !lastName) {
    res.status(400).json({ error: "First name and last name are required" });
    return;
  }

  let newUserId: number | null = null;
  if (email) {
    const [existingUser] = await db.select().from(usersTable).where(eq(usersTable.email, email));
    if (existingUser) {
      res.status(400).json({ error: "A user with this email already exists" });
      return;
    }
    const userValues: any = { email, firstName, lastName, role: "sub_agent", phone: phone || null, phoneE164: toE164(phone || null) };
    if (password) {
      const pwd = validatePassword(password);
      if (!pwd.ok) { res.status(400).json({ error: pwd.message }); return; }
      userValues.passwordHash = await bcrypt.hash(pwd.value, 10);
    }
    const [newUser] = await db.insert(usersTable).values(userValues).returning();
    newUserId = newUser.id;
  }

  const [subAgent] = await db.insert(agentsTable).values({
    userId: newUserId,
    parentAgentId: parentAgent.id,
    firstName,
    lastName,
    email: email || null,
    phone: phone || null,
    phoneE164: toE164(phone || null),
    commissionRate: commissionRate ? parseFloat(commissionRate) : (parentAgent.subAgentCommissionRate || null),
    status: "active",
    agencyCode: parentAgent.agencyCode || null,
    country: parentAgent.country || null,
    companyName: companyName || parentAgent.companyName || null,
    businessName: parentAgent.businessName || null,
    logoUrl: logoUrl || null,
    hideServiceFees: hideServiceFees === true,
    embedToken: crypto.randomUUID(),
  }).returning();

  dispatchNotification({
    actorUserId: req.user!.id,
    event: "agent.sub_agent_added",
    title: "Sub-Agent Added",
    body: `A new sub-agent ${firstName} ${lastName} has been added.`,
    actionUrl: `/staff/agents`,
    icon: "UserPlus",
    templateVars: { firstName, lastName, email: email || "" },
  }).catch(() => {});

  res.status(201).json(subAgent);
});

router.patch("/agents/me/sub-agents/:id", requireAuth, requireRole("agent"), async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const subAgentId = parseInt(req.params.id, 10);
  const [parentAgent] = await db.select().from(agentsTable).where(eq(agentsTable.userId, userId));
  if (!parentAgent) { res.status(404).json({ error: "Agent profile not found" }); return; }

  const [subAgent] = await db.select().from(agentsTable).where(and(eq(agentsTable.id, subAgentId), eq(agentsTable.parentAgentId, parentAgent.id)));
  if (!subAgent) { res.status(404).json({ error: "Sub-agent not found" }); return; }

  const allowed = ["firstName", "lastName", "email", "phone", "commissionRate", "status", "companyName", "logoUrl", "hideServiceFees", "canManageStaff"];
  const updates: Record<string, unknown> = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      if (key === "commissionRate") {
        updates[key] = req.body[key] !== null && req.body[key] !== "" ? parseFloat(req.body[key]) : null;
      } else if (key === "hideServiceFees" || key === "canManageStaff") {
        updates[key] = req.body[key] === true;
      } else {
        updates[key] = req.body[key] || null;
      }
    }
  }

  if (Object.keys(updates).length === 0) {
    res.json(subAgent);
    return;
  }

  if (Object.prototype.hasOwnProperty.call(updates, "phone")) {
    (updates as any).phoneE164 = toE164((updates as any).phone);
  }
  const [updated] = await db.update(agentsTable).set(updates).where(eq(agentsTable.id, subAgentId)).returning();
  if (subAgent.userId && (updates.firstName !== undefined || updates.lastName !== undefined || updates.email !== undefined || updates.phone !== undefined)) {
    const userUpdates: Record<string, unknown> = {};
    if (updates.firstName !== undefined) userUpdates.firstName = updates.firstName;
    if (updates.lastName !== undefined) userUpdates.lastName = updates.lastName;
    if (updates.email !== undefined) userUpdates.email = updates.email;
    if (updates.phone !== undefined) {
      userUpdates.phone = updates.phone;
      (userUpdates as any).phoneE164 = toE164((updates as any).phone);
    }
    if (Object.keys(userUpdates).length > 0) {
      await db.update(usersTable).set(userUpdates).where(eq(usersTable.id, subAgent.userId));
    }
  }
  res.json(updated);
});

router.delete("/agents/me/sub-agents/:id", requireAuth, requireRole("agent"), async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const subAgentId = parseInt(req.params.id, 10);
  const [parentAgent] = await db.select().from(agentsTable).where(eq(agentsTable.userId, userId));
  if (!parentAgent) { res.status(404).json({ error: "Agent profile not found" }); return; }

  const [subAgent] = await db.select().from(agentsTable).where(and(eq(agentsTable.id, subAgentId), eq(agentsTable.parentAgentId, parentAgent.id)));
  if (!subAgent) { res.status(404).json({ error: "Sub-agent not found" }); return; }

  if (subAgent.userId) {
    await db.delete(usersTable).where(eq(usersTable.id, subAgent.userId));
  }
  await db.delete(agentsTable).where(eq(agentsTable.id, subAgentId));
  res.json({ success: true });
});

router.post("/agents/me/sub-agents/:id/set-password", requireAuth, requireRole("agent"), async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const subAgentId = parseInt(req.params.id, 10);
  const [parentAgent] = await db.select().from(agentsTable).where(eq(agentsTable.userId, userId));
  if (!parentAgent) { res.status(404).json({ error: "Agent profile not found" }); return; }

  const [subAgent] = await db.select().from(agentsTable).where(and(eq(agentsTable.id, subAgentId), eq(agentsTable.parentAgentId, parentAgent.id)));
  if (!subAgent) { res.status(404).json({ error: "Sub-agent not found" }); return; }
  if (!subAgent.userId) { res.status(400).json({ error: "Sub-agent has no login account" }); return; }

  const { password } = req.body;
  const pwd = validatePassword(password);
  if (!pwd.ok) { res.status(400).json({ error: pwd.message }); return; }
  const hash = await bcrypt.hash(pwd.value, 10);
  await db.update(usersTable).set({ passwordHash: hash }).where(eq(usersTable.id, subAgent.userId));
  res.json({ success: true });
});

router.patch("/agents/me/sub-agents/:id/status", requireAuth, requireRole("agent"), async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const subAgentId = parseInt(req.params.id, 10);
  const [parentAgent] = await db.select().from(agentsTable).where(eq(agentsTable.userId, userId));
  if (!parentAgent) { res.status(404).json({ error: "Agent profile not found" }); return; }

  const [subAgent] = await db.select().from(agentsTable).where(and(eq(agentsTable.id, subAgentId), eq(agentsTable.parentAgentId, parentAgent.id)));
  if (!subAgent) { res.status(404).json({ error: "Sub-agent not found" }); return; }

  const { status } = req.body;
  if (!["active", "inactive"].includes(status)) {
    res.status(400).json({ error: "Status must be 'active' or 'inactive'" });
    return;
  }
  const [updated] = await db.update(agentsTable).set({ status }).where(eq(agentsTable.id, subAgentId)).returning();
  if (subAgent.userId) {
    await db.update(usersTable).set({ isActive: status === "active" }).where(eq(usersTable.id, subAgent.userId));
  }
  res.json(updated);
});

router.post("/agents/me/sub-agents/:id/impersonate", requireAuth, requireRole("agent"), async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const subAgentId = parseInt(req.params.id, 10);
  const [parentAgent] = await db.select().from(agentsTable).where(eq(agentsTable.userId, userId));
  if (!parentAgent) { res.status(404).json({ error: "Agent profile not found" }); return; }

  const [subAgent] = await db.select().from(agentsTable).where(and(eq(agentsTable.id, subAgentId), eq(agentsTable.parentAgentId, parentAgent.id)));
  if (!subAgent) { res.status(404).json({ error: "Sub-agent not found" }); return; }
  if (!subAgent.userId) { res.status(400).json({ error: "Sub-agent has no login account" }); return; }

  if (subAgent.status !== "active") { res.status(400).json({ error: "Sub-agent account is deactivated" }); return; }

  const [targetUser] = await db.select().from(usersTable).where(eq(usersTable.id, subAgent.userId));
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
    access_token: `agent-impersonation-${Date.now()}`,
    originalSid: currentSid,
  };

  const sid = await createSession(sessionData);
  res.cookie(SESSION_COOKIE, sid, getSessionCookieOptions(req, SESSION_TTL));
  logAudit(req.user!.id, "auth.impersonate.start", "user", targetUser.id, { targetRole: targetUser.role, via: "agents/sub-agents" }, req.ip);
  res.json({ success: true, redirectTo: "/agent" });
});

router.post("/agents/me/return-to-agent", requireAuth, async (req, res): Promise<void> => {
  const currentSid = req.cookies[SESSION_COOKIE];
  if (!currentSid) { res.status(400).json({ error: "No active session" }); return; }

  const sessionData = await getSession(currentSid);
  if (!sessionData) { res.status(400).json({ error: "Invalid session" }); return; }

  const originalSid = sessionData.originalSid;
  if (!originalSid) { res.status(400).json({ error: "No parent session to return to" }); return; }

  const originalSession = await getSession(originalSid);
  if (!originalSession) { res.status(400).json({ error: "Original session expired. Please log in again." }); return; }

  await deleteSession(currentSid);

  res.cookie(SESSION_COOKIE, originalSid, getSessionCookieOptions(req, SESSION_TTL));
  const originalUserId = originalSession.user?.id ?? null;
  const impersonatedUserId = req.user?.id;
  logAudit(originalUserId, "auth.impersonate.end", "user", impersonatedUserId, {}, req.ip);
  res.json({ success: true, redirectTo: "/" });
});

const AGENT_STAFF_PERMISSIONS = PERM_KEYS.map(key => ({
  key,
  label: key.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
}));

async function resolveManagingAgent(userId: number, userRole: string) {
  if (userRole === "agent" || userRole === "sub_agent") {
    const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.userId, userId));
    return agent || null;
  }
  if (userRole === "agent_staff") {
    const [staffUser] = await db.select({ managingAgentId: usersTable.managingAgentId }).from(usersTable).where(eq(usersTable.id, userId));
    if (!staffUser?.managingAgentId) return null;
    const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, staffUser.managingAgentId));
    return agent || null;
  }
  return null;
}

router.get("/agents/me/staff", requireAuth, requireRole("agent", "sub_agent"), async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const userRole = req.user!.role;
  const agent = await resolveManagingAgent(userId, userRole);
  if (!agent) { res.status(404).json({ error: "Agent profile not found" }); return; }
  const { search, page = "1", limit = "50" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
  const offset = (pageNum - 1) * limitNum;

  const conditions: SQL[] = [
    eq(usersTable.role, "agent_staff"),
    eq(usersTable.managingAgentId, agent.id),
  ];

  if (search) {
    conditions.push(
      or(
        ilike(usersTable.firstName, `%${search}%`),
        ilike(usersTable.lastName, `%${search}%`),
        ilike(usersTable.email, `%${search}%`),
      )
    );
  }

  const whereClause = and(...conditions);
  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(usersTable).where(whereClause);

  const data = await db
    .select({
      id: usersTable.id,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      email: usersTable.email,
      phone: usersTable.phone,
      isActive: usersTable.isActive,
      agentStaffPermissions: usersTable.agentStaffPermissions,
      createdAt: usersTable.createdAt,
    })
    .from(usersTable)
    .where(whereClause)
    .limit(limitNum)
    .offset(offset)
    .orderBy(desc(usersTable.createdAt));

  res.json({
    data,
    meta: { total: Number(count), page: pageNum, limit: limitNum, totalPages: Math.ceil(Number(count) / limitNum) },
  });
});

router.post("/agents/me/staff", requireAuth, requireRole("agent", "sub_agent"), async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const userRole = req.user!.role;
  const agent = await resolveManagingAgent(userId, userRole);
  if (!agent) { res.status(404).json({ error: "Agent profile not found" }); return; }

  const { firstName, lastName, email, phone, password, permissions } = req.body;
  if (!firstName || !lastName || !email) {
    res.status(400).json({ error: "First name, last name, and email are required" });
    return;
  }
  const pwdNew = validatePassword(password);
  if (!pwdNew.ok) { res.status(400).json({ error: pwdNew.message }); return; }

  const [existingUser] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  if (existingUser) {
    res.status(400).json({ error: "A user with this email already exists" });
    return;
  }

  const validPerms = Array.isArray(permissions) 
    ? permissions.filter((p: string) => AGENT_STAFF_PERMISSIONS.some(asp => asp.key === p)) 
    : ["leads", "students", "applications", "documents", "course_finder"];

  const passwordHash = await bcrypt.hash(password, 10);
  const [newUser] = await db.insert(usersTable).values({
    email,
    firstName,
    lastName,
    phone: phone || null,
    phoneE164: toE164(phone || null),
    role: "agent_staff",
    passwordHash,
    managingAgentId: agent.id,
    agentStaffPermissions: validPerms,
    isActive: true,
  }).returning();

  res.status(201).json({
    id: newUser.id,
    firstName: newUser.firstName,
    lastName: newUser.lastName,
    email: newUser.email,
    phone: newUser.phone,
    isActive: newUser.isActive,
    agentStaffPermissions: newUser.agentStaffPermissions,
    createdAt: newUser.createdAt,
  });
});

router.patch("/agents/me/staff/:id", requireAuth, requireRole("agent", "sub_agent"), async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const userRole = req.user!.role;
  const staffId = parseInt(req.params.id, 10);
  const agent = await resolveManagingAgent(userId, userRole);
  if (!agent) { res.status(404).json({ error: "Agent profile not found" }); return; }

  const [staffUser] = await db.select().from(usersTable).where(
    and(eq(usersTable.id, staffId), eq(usersTable.role, "agent_staff"), eq(usersTable.managingAgentId, agent.id))
  );
  if (!staffUser) { res.status(404).json({ error: "Staff member not found" }); return; }

  const updates: Record<string, unknown> = {};
  if (req.body.firstName !== undefined) updates.firstName = req.body.firstName;
  if (req.body.lastName !== undefined) updates.lastName = req.body.lastName;
  if (req.body.phone !== undefined) {
    updates.phone = req.body.phone || null;
    (updates as any).phoneE164 = toE164(req.body.phone || null);
  }
  if (req.body.isActive !== undefined) updates.isActive = req.body.isActive;
  if (req.body.permissions !== undefined) {
    const validPerms = Array.isArray(req.body.permissions)
      ? req.body.permissions.filter((p: string) => AGENT_STAFF_PERMISSIONS.some(asp => asp.key === p))
      : [];
    updates.agentStaffPermissions = validPerms;
  }
  if (req.body.password) {
    const pwd = validatePassword(req.body.password);
    if (!pwd.ok) { res.status(400).json({ error: pwd.message }); return; }
    updates.passwordHash = await bcrypt.hash(pwd.value, 10);
  }

  if (Object.keys(updates).length === 0) {
    const { passwordHash: _ph, ...safeStaff } = staffUser;
    res.json(safeStaff);
    return;
  }

  const [updated] = await db.update(usersTable).set(updates).where(eq(usersTable.id, staffId)).returning();
  res.json({
    id: updated.id,
    firstName: updated.firstName,
    lastName: updated.lastName,
    email: updated.email,
    phone: updated.phone,
    isActive: updated.isActive,
    agentStaffPermissions: updated.agentStaffPermissions,
    createdAt: updated.createdAt,
  });
});

router.delete("/agents/me/staff/:id", requireAuth, requireRole("agent", "sub_agent"), async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const userRole = req.user!.role;
  const staffId = parseInt(req.params.id, 10);
  const agent = await resolveManagingAgent(userId, userRole);
  if (!agent) { res.status(404).json({ error: "Agent profile not found" }); return; }

  const [staffUser] = await db.select().from(usersTable).where(
    and(eq(usersTable.id, staffId), eq(usersTable.role, "agent_staff"), eq(usersTable.managingAgentId, agent.id))
  );
  if (!staffUser) { res.status(404).json({ error: "Staff member not found" }); return; }

  await db.delete(usersTable).where(eq(usersTable.id, staffId));
  res.json({ success: true });
});

router.get("/agents/me/staff/permissions", requireAuth, requireRole("agent", "sub_agent"), async (_req, res): Promise<void> => {
  res.json(AGENT_STAFF_PERMISSIONS);
});

router.get("/agents", requireAuth, requireRole(...STAFF_ROLES), async (req, res): Promise<void> => {
  const { search, status, page = "1", limit = "50", type, country, branchId } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
  const offset = (pageNum - 1) * limitNum;

  const conditions: SQL[] = [];

  // Branch scoping: super_admin sees all (or filtered by ?branchId=).
  // Other staff are restricted to agents linked to their visible branches.
  const visible = await getVisibleBranchIds(req.user!.id, req.user!.role);
  const requestedBranchId = branchId && branchId !== "all" ? parseInt(branchId, 10) : null;
  if (visible !== null) {
    if (visible.length === 0) {
      res.json({ data: [], meta: { total: 0, page: pageNum, limit: limitNum, totalPages: 0 } });
      return;
    }
    conditions.push(sql`${agentsTable.id} IN (SELECT agent_id FROM agent_branches WHERE branch_id = ANY(${visible}))`);
  } else if (requestedBranchId && !isNaN(requestedBranchId)) {
    conditions.push(sql`${agentsTable.id} IN (SELECT agent_id FROM agent_branches WHERE branch_id = ${requestedBranchId})`);
  }

  if (type === "agent") {
    conditions.push(isNull(agentsTable.parentAgentId));
  } else if (type === "sub_agent") {
    conditions.push(isNotNull(agentsTable.parentAgentId));
  }

  if (status && status !== "all") {
    conditions.push(eq(agentsTable.status, status));
  }

  if (country && country !== "all") {
    conditions.push(eq(agentsTable.country, country));
  }

  if (search) {
    conditions.push(
      or(
        ilike(agentsTable.firstName, `%${search}%`),
        ilike(agentsTable.lastName, `%${search}%`),
        ilike(agentsTable.email, `%${search}%`),
        ilike(agentsTable.companyName, `%${search}%`),
        ilike(agentsTable.agencyCode, `%${search}%`),
        ilike(agentsTable.businessName, `%${search}%`),
      )
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(agentsTable).where(whereClause);

  const rows = await db
    .select()
    .from(agentsTable)
    .where(whereClause)
    .limit(limitNum)
    .offset(offset)
    .orderBy(desc(agentsTable.createdAt));

  // Pull branch links and assigned-staff for the current page in one query each.
  const agentIds = rows.map(r => r.id);
  const branchLinks = agentIds.length > 0
    ? await db.select({ agentId: agentBranchesTable.agentId, branchId: agentBranchesTable.branchId })
        .from(agentBranchesTable).where(inArray(agentBranchesTable.agentId, agentIds))
    : [];
  const branchesByAgent = new Map<number, number[]>();
  for (const l of branchLinks) {
    const arr = branchesByAgent.get(l.agentId) || [];
    arr.push(l.branchId);
    branchesByAgent.set(l.agentId, arr);
  }
  const staffByAgent = await getAgencyStaffMap(agentIds);

  // Back-compat: agents whose join rows haven't been backfilled yet — resolve
  // legacy scalar to a synthetic primary entry in one batched user query.
  const legacyOnlyIds = new Map<number, number>();
  for (const r of rows) {
    if ((staffByAgent.get(r.id)?.length ?? 0) === 0 && r.assignedStaffId) {
      legacyOnlyIds.set(r.id, r.assignedStaffId);
    }
  }
  if (legacyOnlyIds.size > 0) {
    const legacyUsers = await db.select({
      id: usersTable.id,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      email: usersTable.email,
      phone: usersTable.phone,
      avatarUrl: usersTable.avatarUrl,
      role: usersTable.role,
    }).from(usersTable).where(inArray(usersTable.id, Array.from(new Set(legacyOnlyIds.values()))));
    const userMap = new Map(legacyUsers.map(u => [u.id, u]));
    for (const [agentId, uid] of legacyOnlyIds) {
      const u = userMap.get(uid);
      if (u) staffByAgent.set(agentId, [{
        userId: u.id, isPrimary: true,
        firstName: u.firstName, lastName: u.lastName, email: u.email,
        phone: u.phone, avatarUrl: u.avatarUrl, role: u.role,
      }]);
    }
  }

  const data = rows.map(r => {
    const list = staffByAgent.get(r.id) || [];
    const primary = list.find(s => s.isPrimary) || list[0] || null;
    return {
      ...r,
      branchIds: branchesByAgent.get(r.id) || [],
      assignedStaffId: primary ? primary.userId : r.assignedStaffId,
      assignedStaffName: primary ? staffDisplayName(primary) : null,
      assignedStaffList: list,
    };
  });

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

router.get("/agents/:id/sub-agents", requireAuth, requireRole(...STAFF_ROLES), async (req, res): Promise<void> => {
  const parentId = parseInt(req.params.id, 10);
  if (!(await isAgentInScope(req.user!.id, req.user!.role, parentId))) {
    res.status(403).json({ error: "Agent not in your branch scope" });
    return;
  }
  const { page = "1", limit = "50" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10)));
  const offset = (pageNum - 1) * limitNum;
  const subs = await db.select().from(agentsTable).where(eq(agentsTable.parentAgentId, parentId)).orderBy(desc(agentsTable.createdAt)).limit(limitNum).offset(offset);
  res.json(subs);
});

router.post("/agents", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  const {
    firstName, lastName, status = "active", email, phone,
    companyName, country, commissionRate, agencyCode,
    state, city, address, businessName, category,
    logoUrl, agentIdProofUrl, businessCertUrl, contractUrl, branch,
    parentAgentId, subAgentCommissionRate, hideServiceFees,
    assignedStaffId, branchIds,
    entityType, taxNumber, preferredContractLanguage,
    assignedContractTemplateId,
    contractStartDate, contractEndDate, notes,
  } = req.body;

  const parseDate = (v: unknown): Date | null => {
    if (v === null || v === undefined || v === "") return null;
    if (v instanceof Date) return v;
    const d = new Date(String(v));
    return isNaN(d.getTime()) ? null : d;
  };

  if (!firstName || !lastName) {
    res.status(400).json({ error: "firstName and lastName are required" });
    return;
  }

  // Required: a contract template must be selected so the agent can be sent
  // their primary onboarding sign request as part of account creation.
  const tplId = assignedContractTemplateId ? parseInt(String(assignedContractTemplateId), 10) : null;
  if (!tplId || isNaN(tplId)) {
    res.status(400).json({ error: "assignedContractTemplateId is required" });
    return;
  }
  const [template] = await db.select().from(contractTemplatesTable).where(and(
    eq(contractTemplatesTable.id, tplId),
    isNull(contractTemplatesTable.deletedAt),
    eq(contractTemplatesTable.isActive, true),
  ));
  if (!template) {
    res.status(404).json({ error: "Selected contract template not found or inactive" });
    return;
  }
  // Validate template language/entityType match the agent metadata when provided.
  const ent = entityType === "individual" ? "individual" : "company";
  if (template.entityType !== ent) {
    res.status(400).json({ error: `Template entityType (${template.entityType}) does not match agent entityType (${ent})` });
    return;
  }
  if (preferredContractLanguage && template.language !== preferredContractLanguage) {
    res.status(400).json({ error: `Template language (${template.language}) does not match agent preferredContractLanguage (${preferredContractLanguage})` });
    return;
  }
  if (!email) {
    res.status(400).json({ error: "Email is required to send onboarding verification" });
    return;
  }

  let userId: number | null = null;
  {
    const [existingUser] = await db.select().from(usersTable).where(eq(usersTable.email, email));
    if (existingUser) {
      userId = existingUser.id;
      // Force email re-verification for the onboarding flow.
      await db.update(usersTable).set({ emailVerified: false }).where(eq(usersTable.id, existingUser.id));
    } else {
      const role = parentAgentId ? "sub_agent" : "agent";
      const [newUser] = await db.insert(usersTable).values({
        email, firstName, lastName, role,
        phone: phone || null, phoneE164: toE164(phone || null),
        emailVerified: false, isActive: true,
      }).returning();
      userId = newUser.id;
    }
  }

  const [agent] = await db.insert(agentsTable).values({
    userId,
    firstName, lastName, status,
    entityType: ent,
    taxNumber: taxNumber || null,
    preferredContractLanguage: preferredContractLanguage || template.language,
    assignedContractTemplateId: template.id,
    email: email || null,
    phone: phone || null,
    phoneE164: toE164(phone || null),
    companyName: companyName || null,
    country: country || null,
    commissionRate: commissionRate ? parseFloat(commissionRate) : null,
    agencyCode: agencyCode || null,
    state: state || null,
    city: city || null,
    address: address || null,
    businessName: businessName || null,
    category: category || null,
    logoUrl: logoUrl || null,
    agentIdProofUrl: agentIdProofUrl || null,
    businessCertUrl: businessCertUrl || null,
    contractUrl: contractUrl || null,
    contractStartDate: parseDate(contractStartDate),
    contractEndDate: parseDate(contractEndDate),
    notes: notes || null,
    branch: branch || null,
    parentAgentId: parentAgentId ? parseInt(parentAgentId, 10) : null,
    subAgentCommissionRate: subAgentCommissionRate ? parseFloat(subAgentCommissionRate) : null,
    hideServiceFees: hideServiceFees === true || hideServiceFees === "true" ? true : false,
    embedToken: crypto.randomUUID(),
  }).returning();

  // Persist agency-assigned staff (multi). Accepts either the new
  // `assignedStaff: [{userId, isPrimary}]` array or the legacy single
  // `assignedStaffId` (treated as the primary contact).
  {
    const staff = parseStaffInput(
      req.body.assignedStaff,
      assignedStaffId ? parseInt(String(assignedStaffId), 10) : null,
    );
    if (staff.length > 0) await setAgencyStaff(agent.id, staff);
  }

  // Branch links: explicit list, else inherit creator's first visible branch.
  let finalBranchIds: number[] = Array.isArray(branchIds)
    ? branchIds.map((x: any) => parseInt(x, 10)).filter((n: number) => !isNaN(n))
    : [];
  // Authorization: non-super_admin may only assign visible branches.
  if (req.user!.role !== "super_admin" && finalBranchIds.length > 0) {
    const visible = await getVisibleBranchIds(req.user!.id, req.user!.role);
    const allowed = new Set(visible || []);
    const bad = finalBranchIds.filter(b => !allowed.has(b));
    if (bad.length > 0) {
      res.status(403).json({ error: "Cannot assign branches outside your scope", branches: bad });
      return;
    }
  }
  if (finalBranchIds.length === 0) {
    const visible = await getVisibleBranchIds(req.user!.id, req.user!.role);
    if (visible && visible.length > 0) finalBranchIds = [visible[0]];
  }
  if (finalBranchIds.length > 0) {
    await db.insert(agentBranchesTable)
      .values(finalBranchIds.map(bid => ({ agentId: agent.id, branchId: bid })))
      .onConflictDoNothing();
  }

  // ── Onboarding: 6-digit verification code + admin-driven signing session ──
  try {
    const normalizedEmail = email.toLowerCase().trim();
    await db.update(emailVerificationCodesTable)
      .set({ used: true })
      .where(and(eq(emailVerificationCodesTable.email, normalizedEmail), eq(emailVerificationCodesTable.used, false)));
    const code = ONBOARDING_HELPERS.generateVerificationCode();
    const token = ONBOARDING_HELPERS.generateOnboardingToken();
    await db.insert(emailVerificationCodesTable).values({
      email: normalizedEmail, code, token, expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });
    try {
      const emailContent = await ONBOARDING_HELPERS.buildOnboardingVerificationCodeEmail(firstName, code, normalizedEmail, token);
      await sendEmail(normalizedEmail, emailContent);
    } catch (err) {
      console.error("[agents POST] failed to send verification email:", err);
    }
    await writeAudit({
      userId: req.user!.id,
      action: "agent.email_verification_sent",
      resource: "user",
      resourceId: userId,
      changes: { agentId: agent.id, initial: true },
      ipAddress: req.ip,
    });

    const [s] = await db.select({ days: settingsTable.defaultSigningDeadlineDays }).from(settingsTable);
    const days = Math.max(1, Math.min(365, s?.days || 14));
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    const { tokenHash } = createSigningToken();
    const signerName = `${firstName} ${lastName}`.trim() || businessName || null;
    const [session] = await db.insert(signingSessionsTable).values({
      templateId: template.id,
      agentId: agent.id,
      tokenHash,
      mode: "admin_driven",
      status: "review_pending",
      intakeData: null,
      signerEmail: normalizedEmail,
      signerName,
      expiresAt,
      isPrimaryOnboarding: true,
      createdByUserId: req.user!.id,
    }).returning();
    await writeAudit({
      userId: req.user!.id,
      action: "agent.contract_auto_assigned",
      resource: "signing_session",
      resourceId: session.id,
      changes: { agentId: agent.id, templateId: template.id, expiresAt: expiresAt.toISOString(), days },
      ipAddress: req.ip,
    });
  } catch (err) {
    console.error("[agents POST] onboarding setup failed:", err);
  }

  dispatchNotification({
    actorUserId: req.user!.id,
    event: "agent.new_registration",
    title: "New Agent Registration",
    body: `A new agent ${firstName} ${lastName} (${companyName || "N/A"}) has been registered.`,
    actionUrl: `/staff/agents/${agent.id}`,
    icon: "Building",
    templateVars: { firstName, lastName, companyName: companyName || "", email: email || "" },
  }).catch(() => {});

  res.status(201).json(agent);
});

router.get("/agents/:id", requireAuth, requireRole(...STAFF_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, id));
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }
  if (!(await isAgentInScope(req.user!.id, req.user!.role, id))) {
    res.status(403).json({ error: "Agent not in your branch scope" });
    return;
  }
  const links = await db.select({ branchId: agentBranchesTable.branchId }).from(agentBranchesTable).where(eq(agentBranchesTable.agentId, id));
  const assignedStaffList = await getAgencyStaffWithLegacy(id, agent.assignedStaffId ?? null);
  const primary = assignedStaffList.find(s => s.isPrimary) || assignedStaffList[0] || null;
  res.json({
    ...agent,
    branchIds: links.map(l => l.branchId),
    assignedStaffList,
    assignedStaffName: primary ? staffDisplayName(primary) : null,
  });
});

router.patch("/agents/:id", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (!(await isAgentInScope(req.user!.id, req.user!.role, id))) {
    res.status(403).json({ error: "Agent not in your branch scope" });
    return;
  }
  const updates: Record<string, unknown> = {};
  for (const key of AGENT_PATCH_FIELDS) {
    if (req.body[key] !== undefined) {
      if (key === "commissionRate" || key === "subAgentCommissionRate") {
        updates[key] = req.body[key] !== null && req.body[key] !== "" ? parseFloat(req.body[key]) : null;
      } else if (key === "hideServiceFees" || key === "canManageStaff") {
        updates[key] = req.body[key] === true || req.body[key] === "true";
      } else if (key === "parentAgentId") {
        updates[key] = req.body[key] ? parseInt(req.body[key], 10) : null;
      } else if (key === "assignedStaffId") {
        // Handled out-of-band by setAgencyStaff below to keep the
        // agency_assigned_staff join table in sync.
      } else if (key === "contractStartDate" || key === "contractEndDate") {
        const v = req.body[key];
        if (v === null || v === "" || v === undefined) {
          updates[key] = null;
        } else if (v instanceof Date) {
          updates[key] = v;
        } else {
          const d = new Date(String(v));
          updates[key] = isNaN(d.getTime()) ? null : d;
        }
      } else {
        updates[key] = req.body[key];
      }
    }
  }
  const hasStaffUpdate = req.body.assignedStaff !== undefined || req.body.assignedStaffId !== undefined;
  if (Object.keys(updates).length === 0 && req.body.branchIds === undefined && !hasStaffUpdate) {
    res.status(400).json({ error: "No valid fields to update" });
    return;
  }
  if (Object.prototype.hasOwnProperty.call(updates, "phone")) {
    (updates as any).phoneE164 = toE164((updates as any).phone);
  }
  const [oldAgent] = await db.select().from(agentsTable).where(eq(agentsTable.id, id));
  if (!oldAgent) { res.status(404).json({ error: "Agent not found" }); return; }

  // branchIds is a separate concern (join table), handle it before/after the agent update.
  if (req.body.branchIds !== undefined && Array.isArray(req.body.branchIds)) {
    const newIds: number[] = req.body.branchIds
      .map((x: any) => parseInt(x, 10))
      .filter((n: number) => !isNaN(n));
    // Authorization: non-super_admin may only assign visible branches.
    if (req.user!.role !== "super_admin" && newIds.length > 0) {
      const visible = await getVisibleBranchIds(req.user!.id, req.user!.role);
      const allowed = new Set(visible || []);
      const bad = newIds.filter(b => !allowed.has(b));
      if (bad.length > 0) {
        res.status(403).json({ error: "Cannot assign branches outside your scope", branches: bad });
        return;
      }
    }
    await db.delete(agentBranchesTable).where(eq(agentBranchesTable.agentId, id));
    if (newIds.length > 0) {
      await db.insert(agentBranchesTable)
        .values(newIds.map(bid => ({ agentId: id, branchId: bid })))
        .onConflictDoNothing();
    }
  }

  // No regular fields? Return early.
  let agent = oldAgent;
  if (Object.keys(updates).length > 0) {
    [agent] = await db.update(agentsTable).set(updates).where(eq(agentsTable.id, id)).returning();
  }
  if (hasStaffUpdate) {
    const staff = parseStaffInput(
      req.body.assignedStaff,
      req.body.assignedStaffId === null || req.body.assignedStaffId === undefined || req.body.assignedStaffId === ""
        ? null
        : parseInt(String(req.body.assignedStaffId), 10),
    );
    await setAgencyStaff(id, staff);
    [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, id));
  }
  if (oldAgent.userId && Object.prototype.hasOwnProperty.call(updates, "phone")) {
    await db.update(usersTable).set({
      phone: (updates as any).phone,
      phoneE164: (updates as any).phoneE164,
    }).where(eq(usersTable.id, oldAgent.userId));
  }

  const commissionRateChanged = updates.commissionRate !== undefined && updates.commissionRate !== oldAgent.commissionRate;
  if (commissionRateChanged) {
    const newRate = agent.commissionRate ?? 0;
    const currentSeason = await getCurrentSeason();

    const agentComms = await db.select().from(commissionsTable)
      .where(and(
        eq(commissionsTable.agentId, id),
        eq(commissionsTable.season, currentSeason),
        sql`${commissionsTable.universityCommissionAmount} IS NOT NULL`,
        sql`CAST(${commissionsTable.universityCommissionAmount} AS numeric) > 0`
      ));

    let recalculated = 0;
    for (const comm of agentComms) {
      const uAmount = parseFloat(String(comm.universityCommissionAmount ?? "0")) || 0;
      const agentAmount = (uAmount * newRate) / 100;
      const commUpdates: Record<string, unknown> = {
        agentCommissionRate: String(newRate),
        agentCommissionAmount: String(Math.round(agentAmount * 100) / 100),
      };

      if (comm.subAgentId) {
        const [subAgent] = await db.select().from(agentsTable).where(eq(agentsTable.id, comm.subAgentId));
        if (subAgent && subAgent.commissionRate) {
          const subAmount = (agentAmount * subAgent.commissionRate) / 100;
          commUpdates.subAgentCommissionRate = String(subAgent.commissionRate);
          commUpdates.subAgentCommissionAmount = String(Math.round(subAmount * 100) / 100);
        }
      }

      await db.update(commissionsTable).set(commUpdates).where(eq(commissionsTable.id, comm.id));
      recalculated++;
    }

    if (recalculated > 0) {
      console.log(`[Commission Recalc] Agent ${id} rate changed to ${newRate}% → recalculated ${recalculated} commission(s) for season ${currentSeason}`);
    }
  }

  res.json(agent);
});

router.delete("/agents/:id", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (!(await isAgentInScope(req.user!.id, req.user!.role, id))) {
    res.status(403).json({ error: "Agent not in your branch scope" });
    return;
  }
  const [agent] = await db.delete(agentsTable).where(eq(agentsTable.id, id)).returning();
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }
  res.json({ success: true });
});

router.post("/agents/bulk-delete", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ error: "ids array is required" });
    return;
  }
  const numIds = ids.map((id: any) => parseInt(id, 10)).filter((id: number) => !isNaN(id));
  if (numIds.length === 0) {
    res.status(400).json({ error: "No valid IDs provided" });
    return;
  }
  const deleted = await db.delete(agentsTable).where(inArray(agentsTable.id, numIds)).returning();
  res.json({ success: true, count: deleted.length });
});

router.post("/agents/bulk-assign", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  const { ids, assignedStaffId } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ error: "ids array is required" });
    return;
  }
  const numIds = ids.map((id: any) => parseInt(id, 10)).filter((id: number) => !isNaN(id));
  if (numIds.length === 0) {
    res.status(400).json({ error: "No valid IDs provided" });
    return;
  }
  const staffVal = assignedStaffId === null || assignedStaffId === undefined ? null : parseInt(assignedStaffId, 10);
  const newStaff = staffVal && !isNaN(staffVal) ? [{ userId: staffVal, isPrimary: true }] : [];
  // Branch-scope enforcement: silently skip out-of-scope agent IDs.
  const scoped: number[] = [];
  for (const aid of numIds) {
    if (await isAgentInScope(req.user!.id, req.user!.role, aid)) scoped.push(aid);
  }
  for (const aid of scoped) await setAgencyStaff(aid, newStaff);
  res.json({ success: true, count: scoped.length, skipped: numIds.length - scoped.length });
});

router.patch("/agents/:id/status", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const { status } = req.body;
  if (!status || !["active", "inactive"].includes(status)) {
    res.status(400).json({ error: "status must be 'active' or 'inactive'" });
    return;
  }
  const [agent] = await db.update(agentsTable).set({ status }).where(eq(agentsTable.id, id)).returning();
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }
  res.json(agent);
});

router.post("/agents/:id/set-password", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const { password } = req.body;
  const pwd = validatePassword(password);
  if (!pwd.ok) { res.status(400).json({ error: pwd.message }); return; }
  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, id));
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }
  if (!agent.userId) {
    res.status(400).json({ error: "Agent has no linked user account" });
    return;
  }
  const hash = await bcrypt.hash(password, 10);
  await db.update(usersTable).set({ passwordHash: hash }).where(eq(usersTable.id, agent.userId));
  res.json({ success: true });
});

router.post("/agents/:id/impersonate", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, id));
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }
  if (!agent.userId) {
    res.status(400).json({ error: "Agent has no linked user account" });
    return;
  }
  const [targetUser] = await db.select().from(usersTable).where(eq(usersTable.id, agent.userId));
  if (!targetUser) { res.status(404).json({ error: "User not found" }); return; }
  if (!["agent", "sub_agent"].includes(targetUser.role)) {
    res.status(403).json({ error: "Can only impersonate agent or sub-agent accounts" });
    return;
  }

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
  logAudit(req.user!.id, "auth.impersonate.start", "user", targetUser.id, { targetRole: targetUser.role, via: "agents" }, req.ip);
  res.json({ success: true, redirectTo: "/agent" });
});

export default router;
