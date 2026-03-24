import { Router, type IRouter } from "express";
import { db, agentsTable, usersTable } from "@workspace/db";
import { eq, sql, isNull, isNotNull, and, or, ilike, inArray, desc } from "drizzle-orm";
import { requireAuth, requireRole } from "../lib/auth";
import { STAFF_ROLES, MANAGER_ROLES } from "../lib/roles";
import bcrypt from "bcryptjs";
import { createSession, getSession, deleteSession, SESSION_COOKIE, SESSION_TTL, type SessionData } from "../lib/replitAuth";

const router: IRouter = Router();

const AGENT_PATCH_FIELDS = [
  "firstName", "lastName", "email", "phone",
  "status", "commissionRate", "notes", "companyName", "country",
  "agencyCode", "state", "city", "address", "businessName",
  "category", "logoUrl", "agentIdProofUrl", "businessCertUrl",
  "contractUrl", "branch", "pointOfContact", "parentAgentId",
  "subAgentCommissionRate", "hideServiceFees",
];

const AGENT_SELF_PATCH_FIELDS = [
  "businessName", "logoUrl", "businessCertUrl",
];

function isValidStorageUrl(url: string): boolean {
  if (!url) return true;
  return url.startsWith("/api/storage/objects/") || url.startsWith("https://");
}

router.get("/agents/me", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.userId, userId));
  if (!agent) { res.status(404).json({ error: "Agent profile not found" }); return; }
  res.json(agent);
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

router.get("/agents/me/sub-agents", requireAuth, requireRole("agent"), async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.userId, userId));
  if (!agent) { res.status(404).json({ error: "Agent profile not found" }); return; }

  const { search, status, page = "1", limit = "50" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
  const offset = (pageNum - 1) * limitNum;

  const conditions: any[] = [eq(agentsTable.parentAgentId, agent.id)];

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
    const userValues: any = { email, firstName, lastName, role: "sub_agent", phone: phone || null };
    if (password && password.length >= 6) {
      userValues.passwordHash = await bcrypt.hash(password, 10);
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
    commissionRate: commissionRate ? parseFloat(commissionRate) : (parentAgent.subAgentCommissionRate || null),
    status: "active",
    agencyCode: parentAgent.agencyCode || null,
    country: parentAgent.country || null,
    companyName: companyName || parentAgent.companyName || null,
    businessName: parentAgent.businessName || null,
    logoUrl: logoUrl || null,
    hideServiceFees: hideServiceFees === true,
  }).returning();

  res.status(201).json(subAgent);
});

router.patch("/agents/me/sub-agents/:id", requireAuth, requireRole("agent"), async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const subAgentId = parseInt(req.params.id, 10);
  const [parentAgent] = await db.select().from(agentsTable).where(eq(agentsTable.userId, userId));
  if (!parentAgent) { res.status(404).json({ error: "Agent profile not found" }); return; }

  const [subAgent] = await db.select().from(agentsTable).where(and(eq(agentsTable.id, subAgentId), eq(agentsTable.parentAgentId, parentAgent.id)));
  if (!subAgent) { res.status(404).json({ error: "Sub-agent not found" }); return; }

  const allowed = ["firstName", "lastName", "email", "phone", "commissionRate", "status", "companyName", "logoUrl", "hideServiceFees"];
  const updates: Record<string, unknown> = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      if (key === "commissionRate") {
        updates[key] = req.body[key] !== null && req.body[key] !== "" ? parseFloat(req.body[key]) : null;
      } else if (key === "hideServiceFees") {
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

  const [updated] = await db.update(agentsTable).set(updates).where(eq(agentsTable.id, subAgentId)).returning();
  if (subAgent.userId && (updates.firstName !== undefined || updates.lastName !== undefined || updates.email !== undefined || updates.phone !== undefined)) {
    const userUpdates: Record<string, unknown> = {};
    if (updates.firstName !== undefined) userUpdates.firstName = updates.firstName;
    if (updates.lastName !== undefined) userUpdates.lastName = updates.lastName;
    if (updates.email !== undefined) userUpdates.email = updates.email;
    if (updates.phone !== undefined) userUpdates.phone = updates.phone;
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
  if (!password || password.length < 6) {
    res.status(400).json({ error: "Password must be at least 6 characters" });
    return;
  }
  const hash = await bcrypt.hash(password, 10);
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
    },
    access_token: `agent-impersonation-${Date.now()}`,
    originalSid: currentSid,
  } as any;

  const sid = await createSession(sessionData);
  res.cookie("sid", sid, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL,
  });
  res.json({ success: true, redirectTo: "/" });
});

router.post("/agents/me/return-to-agent", requireAuth, async (req, res): Promise<void> => {
  const currentSid = req.cookies[SESSION_COOKIE];
  if (!currentSid) { res.status(400).json({ error: "No active session" }); return; }

  const sessionData = await getSession(currentSid);
  if (!sessionData) { res.status(400).json({ error: "Invalid session" }); return; }

  const originalSid = (sessionData as any).originalSid;
  if (!originalSid) { res.status(400).json({ error: "No parent session to return to" }); return; }

  const originalSession = await getSession(originalSid);
  if (!originalSession) { res.status(400).json({ error: "Original session expired. Please log in again." }); return; }

  await deleteSession(currentSid);

  res.cookie("sid", originalSid, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL,
  });
  res.json({ success: true, redirectTo: "/" });
});

router.get("/agents", requireAuth, requireRole(...STAFF_ROLES), async (req, res): Promise<void> => {
  const { search, status, page = "1", limit = "50", type } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
  const offset = (pageNum - 1) * limitNum;

  const conditions: any[] = [];

  if (type === "agent") {
    conditions.push(isNull(agentsTable.parentAgentId));
  } else if (type === "sub_agent") {
    conditions.push(isNotNull(agentsTable.parentAgentId));
  }

  if (status && status !== "all") {
    conditions.push(eq(agentsTable.status, status));
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

  const data = await db
    .select()
    .from(agentsTable)
    .where(whereClause)
    .limit(limitNum)
    .offset(offset)
    .orderBy(desc(agentsTable.createdAt));

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
    pointOfContact, parentAgentId, subAgentCommissionRate, hideServiceFees,
  } = req.body;

  if (!firstName || !lastName) {
    res.status(400).json({ error: "firstName and lastName are required" });
    return;
  }

  let userId: number | null = null;
  if (email) {
    const [existingUser] = await db.select().from(usersTable).where(eq(usersTable.email, email));
    if (existingUser) {
      userId = existingUser.id;
    } else {
      const role = parentAgentId ? "sub_agent" : "agent";
      const [newUser] = await db.insert(usersTable).values({
        email, firstName, lastName, role, phone: phone || null,
      }).returning();
      userId = newUser.id;
    }
  }

  const [agent] = await db.insert(agentsTable).values({
    userId,
    firstName, lastName, status,
    email: email || null,
    phone: phone || null,
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
    branch: branch || null,
    pointOfContact: pointOfContact || null,
    parentAgentId: parentAgentId ? parseInt(parentAgentId, 10) : null,
    subAgentCommissionRate: subAgentCommissionRate ? parseFloat(subAgentCommissionRate) : null,
    hideServiceFees: hideServiceFees === true || hideServiceFees === "true" ? true : false,
  }).returning();

  res.status(201).json(agent);
});

router.get("/agents/:id", requireAuth, requireRole(...STAFF_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, id));
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }
  res.json(agent);
});

router.patch("/agents/:id", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const updates: Record<string, unknown> = {};
  for (const key of AGENT_PATCH_FIELDS) {
    if (req.body[key] !== undefined) {
      if (key === "commissionRate" || key === "subAgentCommissionRate") {
        updates[key] = req.body[key] !== null && req.body[key] !== "" ? parseFloat(req.body[key]) : null;
      } else if (key === "hideServiceFees") {
        updates[key] = req.body[key] === true || req.body[key] === "true";
      } else if (key === "parentAgentId") {
        updates[key] = req.body[key] ? parseInt(req.body[key], 10) : null;
      } else {
        updates[key] = req.body[key];
      }
    }
  }
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No valid fields to update" });
    return;
  }
  const [agent] = await db.update(agentsTable).set(updates).where(eq(agentsTable.id, id)).returning();
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }
  res.json(agent);
});

router.delete("/agents/:id", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
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
  if (!password || password.length < 6) {
    res.status(400).json({ error: "Password must be at least 6 characters" });
    return;
  }
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
  res.json({ success: true, redirectTo: "/" });
});

export default router;
