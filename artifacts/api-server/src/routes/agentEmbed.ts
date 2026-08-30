import { Router, type IRouter } from "express";
import crypto from "crypto";
import { db, agentsTable, aiBotsTable, embedWidgetsTable, usersTable } from "@workspace/db";
import { and, desc, eq, isNull } from "drizzle-orm";
import { requireAuth, requireRole, logAudit } from "../lib/auth";
import { AGENT_ROLES } from "../lib/roles";
import { resolveAgentFeatures } from "../lib/agentFeatures";

const router: IRouter = Router();

type AgentEmbedMode = "lead_form" | "combined" | "course_finder" | "ai_chatbot";

const AGENT_EMBED_FILTER_KEYS = [
  "country",
  "city",
  "universityType",
  "universityId",
  "level",
  "language",
  "field",
] as const;

type AgentEmbedPresetFilters = {
  country?: string;
  city?: string;
  universityType?: string;
  universityScope: "all" | "selected";
  universityIds?: number[];
  universityId?: number;
  level?: string;
  language?: string;
  field?: string;
};

function cleanFilterText(value: unknown, maxLength = 160): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.trim().slice(0, maxLength);
  return cleaned || undefined;
}

function normalizeAgentEmbedFilters(value: unknown): {
  presetFilters: AgentEmbedPresetFilters;
  lockedFilters: string[];
} | null {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const requestedScope = source.universityScope === "selected" ? "selected" : "all";
  const universityIds = Array.isArray(source.universityIds)
    ? [...new Set(source.universityIds
      .map((id: unknown) => Number(id))
      .filter((id: number) => Number.isInteger(id) && id > 0))]
      .slice(0, 100)
    : [];
  if (requestedScope === "selected" && universityIds.length === 0) return null;

  const presetFilters: AgentEmbedPresetFilters = { universityScope: requestedScope };
  const lockedFilters: string[] = [];
  const assignText = (key: "country" | "city" | "universityType" | "level" | "language" | "field") => {
    const cleaned = cleanFilterText(source[key]);
    if (!cleaned) return;
    presetFilters[key] = cleaned;
    lockedFilters.push(key);
  };
  assignText("country");
  assignText("city");
  assignText("universityType");
  assignText("level");
  assignText("language");
  assignText("field");

  if (requestedScope === "selected") {
    presetFilters.universityIds = universityIds;
    if (universityIds.length === 1) presetFilters.universityId = universityIds[0];
    lockedFilters.push("universityId");
  }
  return { presetFilters, lockedFilters };
}

function resolveAgentEmbedMode(value: unknown): AgentEmbedMode {
  if (
    value === "combined" ||
    value === "course_finder" ||
    value === "ai_chatbot"
  ) {
    return value;
  }
  return "lead_form";
}

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
  const requestedMode = resolveAgentEmbedMode(req.body?.mode);
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
  const hasPresetFilters = Object.prototype.hasOwnProperty.call(req.body || {}, "presetFilters");
  const normalizedFilters = hasPresetFilters
    ? normalizeAgentEmbedFilters(req.body?.presetFilters)
    : undefined;
  if (hasPresetFilters && !normalizedFilters) {
    res.status(400).json({ error: "Selected university scope requires at least one university." });
    return;
  }

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
  const experienceName = requestedMode === "ai_chatbot"
    ? "AI Assistant"
    : requestedMode === "combined"
      ? "Course Finder"
      : requestedMode === "course_finder"
        ? "Program Catalog"
        : "Lead Form";
  const values: Record<string, any> = {
    name: String(req.body?.name || `${agent.companyName || agent.businessName || "Agency"} ${experienceName}`).slice(0, 160),
    mode: requestedMode,
    allowedDomains,
    theme,
    aiBotId: defaultBotId,
    isActive: req.body?.isActive !== false,
    agentId: agent.id,
  };
  if (normalizedFilters) {
    values.presetFilters = normalizedFilters.presetFilters;
    values.lockedFilters = normalizedFilters.lockedFilters;
    values.hiddenFilters = [];
    values.visibleFilters = [...AGENT_EMBED_FILTER_KEYS];
  }

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
      presetFilters: normalizedFilters?.presetFilters || { universityScope: "all" },
      lockedFilters: normalizedFilters?.lockedFilters || [],
      hiddenFilters: [],
      visibleFilters: normalizedFilters ? [...AGENT_EMBED_FILTER_KEYS] : [],
    } as any).returning();
    widget = rows[0];
  }
  await logAudit(req.user!.id, current ? "agent.embed.update" : "agent.embed.create", "embed_widget", widget.id, {
    agentId: agent.id,
    mode: requestedMode,
    allowedDomains,
    ...(normalizedFilters ? { presetFilters: normalizedFilters.presetFilters } : {}),
  }, req.ip);
  res.json({ widget: publicWidget(widget), features });
});

export default router;
