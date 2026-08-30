import { Router, type IRouter } from "express";
import crypto from "crypto";
import { db, agentsTable, aiBotsTable, embedWidgetsTable, usersTable } from "@workspace/db";
import { and, desc, eq, isNull } from "drizzle-orm";
import { requireAuth, requireRole, logAudit } from "../lib/auth";
import { AGENT_ROLES } from "../lib/roles";
import { resolveAgentFeatures } from "../lib/agentFeatures";

const router: IRouter = Router();

async function getAgentForActor(userId: number, role: string) {
  if (role === "agent_staff") {
    const [staff] = await db.select({ managingAgentId: usersTable.managingAgentId })
      .from(usersTable).where(eq(usersTable.id, userId));
    if (!staff?.managingAgentId) return null;
    const [agent] = await db.select().from(agentsTable).where(and(
      eq(agentsTable.id, staff.managingAgentId),
      isNull(agentsTable.deletedAt),
    ));
    return agent ?? null;
  }
  const [agent] = await db.select().from(agentsTable).where(and(
    eq(agentsTable.userId, userId),
    isNull(agentsTable.deletedAt),
  ));
  return agent ?? null;
}

function publicWidget(widget: Record<string, any> | null) {
  if (!widget) return null;
  const { embedApiKey: _secret, ...safe } = widget;
  return safe;
}

router.get("/agents/me/embed-widget", requireAuth, requireRole(...AGENT_ROLES), async (req, res): Promise<void> => {
  const agent = await getAgentForActor(req.user!.id, req.user!.role);
  if (!agent) { res.status(404).json({ error: "Agent profile not found" }); return; }
  const features = resolveAgentFeatures(agent.planTier, agent.featureOverrides);
  if (!features.embed_standard) {
    res.status(403).json({ error: "Embed is not enabled for this agency", code: "AGENT_FEATURE_DISABLED" });
    return;
  }
  const [widget] = await db.select().from(embedWidgetsTable)
    .where(eq(embedWidgetsTable.agentId, agent.id))
    .orderBy(desc(embedWidgetsTable.updatedAt), desc(embedWidgetsTable.id))
    .limit(1);
  res.json({ widget: publicWidget(widget || null), features });
});

router.put("/agents/me/embed-widget", requireAuth, requireRole("agent", "sub_agent"), async (req, res): Promise<void> => {
  const agent = await getAgentForActor(req.user!.id, req.user!.role);
  if (!agent) { res.status(404).json({ error: "Agent profile not found" }); return; }
  const features = resolveAgentFeatures(agent.planTier, agent.featureOverrides);
  if (!features.embed_standard) {
    res.status(403).json({ error: "Embed is not enabled for this agency", code: "AGENT_FEATURE_DISABLED" });
    return;
  }
  const requestedMode = req.body?.mode === "ai_chatbot" ? "ai_chatbot" : "lead_form";
  if (requestedMode === "ai_chatbot" && !features.embed_ai) {
    res.status(403).json({ error: "AI Embed is not enabled for this agency", code: "AGENT_FEATURE_DISABLED" });
    return;
  }
  const allowedDomains = Array.isArray(req.body?.allowedDomains)
    ? req.body.allowedDomains
      .map((value: unknown) => String(value).trim().toLowerCase())
      .filter((value: string) => /^(?:[a-z0-9-]+\.)*[a-z0-9-]+(?::\d+)?$/.test(value))
      .slice(0, 20)
    : [];

  let defaultBotId: number | null = null;
  if (requestedMode === "ai_chatbot") {
    const [defaultBot] = await db.select({ id: aiBotsTable.id }).from(aiBotsTable)
      .where(and(eq(aiBotsTable.isDefault, true), eq(aiBotsTable.isActive, true)))
      .limit(1);
    if (!defaultBot) { res.status(409).json({ error: "No active default AI assistant is configured" }); return; }
    defaultBotId = defaultBot.id;
  }

  const [current] = await db.select().from(embedWidgetsTable)
    .where(eq(embedWidgetsTable.agentId, agent.id))
    .orderBy(desc(embedWidgetsTable.updatedAt), desc(embedWidgetsTable.id))
    .limit(1);
  const primaryColor = features.custom_branding ? (agent.primaryBrandColor || "#1D4ED8") : "#1D4ED8";
  const secondaryColor = features.custom_branding ? (agent.secondaryBrandColor || "#10B981") : "#10B981";
  const theme: Record<string, string> = {
    primaryColor,
    secondaryColor,
    buttonColor: primaryColor,
  };
  if (requestedMode === "ai_chatbot") {
    theme.welcomeMessage = "How can we help with your study plans?";
    theme.assistantName = agent.companyName || agent.businessName || "Study Assistant";
  }
  const values: Record<string, any> = {
    name: String(req.body?.name || `${agent.companyName || agent.businessName || "Agency"} ${requestedMode === "ai_chatbot" ? "AI Assistant" : "Lead Form"}`).slice(0, 160),
    mode: requestedMode,
    allowedDomains,
    theme,
    aiBotId: defaultBotId,
    isActive: req.body?.isActive !== false,
    agentId: agent.id,
  };

  let widget: any;
  if (current) {
    const rows = await db.update(embedWidgetsTable).set(values)
      .where(and(eq(embedWidgetsTable.id, current.id), eq(embedWidgetsTable.agentId, agent.id)))
      .returning();
    widget = rows[0];
  } else {
    const rows = await db.insert(embedWidgetsTable).values({
      ...values,
      slug: `fas-${agent.id}-${crypto.randomBytes(4).toString("hex")}`,
      presetFilters: {},
      lockedFilters: [],
      hiddenFilters: [],
      visibleFilters: [],
    } as any).returning();
    widget = rows[0];
  }
  await logAudit(req.user!.id, current ? "agent.embed.update" : "agent.embed.create", "embed_widget", widget.id, {
    agentId: agent.id,
    mode: requestedMode,
    allowedDomains,
  }, req.ip);
  res.json({ widget: publicWidget(widget), features });
});

export default router;
