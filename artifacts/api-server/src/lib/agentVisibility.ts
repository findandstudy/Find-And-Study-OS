import { db, agentsTable, usersTable } from "@workspace/db";
import { and, eq, inArray, isNull } from "drizzle-orm";

const AGENT_VISIBILITY_TTL = 30_000;
const agentVisibilityCache = new Map<string, { ids: number[]; fetchedAt: number }>();
const agentNotificationCache = new Map<number, { ids: number[]; fetchedAt: number }>();

export async function getAgentVisibleIds(userId: number, userRole: string): Promise<number[]> {
  const cacheKey = `${userId}:${userRole}`;
  const cached = agentVisibilityCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < AGENT_VISIBILITY_TTL) {
    return cached.ids;
  }

  let ids: number[];

  if (userRole === "agent_staff") {
    const [staffUser] = await db.select({ managingAgentId: usersTable.managingAgentId }).from(usersTable).where(eq(usersTable.id, userId));
    if (!staffUser?.managingAgentId) {
      ids = [];
    } else {
      const [managingAgent] = await db.select().from(agentsTable).where(eq(agentsTable.id, staffUser.managingAgentId));
      if (!managingAgent) {
        ids = [];
      } else if (!managingAgent.parentAgentId) {
        const subAgents = await db.select({ id: agentsTable.id }).from(agentsTable).where(eq(agentsTable.parentAgentId, managingAgent.id));
        ids = [managingAgent.id, ...subAgents.map(s => s.id)];
      } else {
        ids = [managingAgent.id];
      }
    }
  } else {
    const [agentRec] = await db.select().from(agentsTable).where(eq(agentsTable.userId, userId));
    if (!agentRec) {
      ids = [];
    } else if (userRole === "agent" && !agentRec.parentAgentId) {
      // A parent agent (no parentAgentId) sees its OWN records plus those of its
      // OWN sub-agents (agents whose parentAgentId === this agent). Records of
      // other agencies (and their sub-agents) are NEVER included — the sub-agent
      // query is scoped strictly to parentAgentId = agentRec.id, so this stays
      // IDOR-safe.
      const subAgents = await db.select({ id: agentsTable.id }).from(agentsTable).where(eq(agentsTable.parentAgentId, agentRec.id));
      ids = [agentRec.id, ...subAgents.map(s => s.id)];
    } else {
      ids = [agentRec.id];
    }
  }

  agentVisibilityCache.set(cacheKey, { ids, fetchedAt: Date.now() });
  return ids;
}

export function invalidateAgentVisibilityCache(userId: number, userRole: string): void {
  agentVisibilityCache.delete(`${userId}:${userRole}`);
  // Relationship changes can affect both visibility and notification fan-out.
  agentNotificationCache.clear();
}

/**
 * Return the active user accounts that should receive an application
 * notification for an agent-owned record.
 *
 * The owner, its ancestor agents, and their agent_staff members are included.
 * Descendant/sibling agencies are deliberately excluded so a child event never
 * leaks to an unrelated agency.
 */
export async function getAgentNotificationRecipientIds(agentId: number): Promise<number[]> {
  if (!Number.isSafeInteger(agentId) || agentId <= 0) return [];
  const cached = agentNotificationCache.get(agentId);
  if (cached && Date.now() - cached.fetchedAt < AGENT_VISIBILITY_TTL) {
    return [...cached.ids];
  }

  const scopedAgentIds: number[] = [];
  const seen = new Set<number>();
  let currentId: number | null = agentId;
  for (let depth = 0; depth < 32 && currentId != null; depth += 1) {
    if (seen.has(currentId)) break;
    seen.add(currentId);

    const [agent] = await db
      .select({
        id: agentsTable.id,
        parentAgentId: agentsTable.parentAgentId,
      })
      .from(agentsTable)
      .where(and(
        eq(agentsTable.id, currentId),
        eq(agentsTable.status, "active"),
        isNull(agentsTable.deletedAt),
      ))
      .limit(1);
    if (!agent) break;
    scopedAgentIds.push(agent.id);
    currentId = agent.parentAgentId ?? null;
  }

  if (scopedAgentIds.length === 0) return [];

  const staffUsers = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(and(
      inArray(usersTable.managingAgentId, scopedAgentIds),
      eq(usersTable.role, "agent_staff"),
      eq(usersTable.isActive, true),
    ));

  // userId is nullable on legacy agent rows; active users only receive notifications.
  const ownerUsers = await db
    .select({ id: usersTable.id })
    .from(agentsTable)
    .innerJoin(usersTable, eq(agentsTable.userId, usersTable.id))
    .where(and(
      inArray(agentsTable.id, scopedAgentIds),
      eq(agentsTable.status, "active"),
      isNull(agentsTable.deletedAt),
      eq(usersTable.isActive, true),
    ));
  const recipientIds = Array.from(new Set([
    ...ownerUsers.map((row) => row.id),
    ...staffUsers.map((row) => row.id),
  ]));
  agentNotificationCache.set(agentId, { ids: recipientIds, fetchedAt: Date.now() });
  return [...recipientIds];
}

export async function getAgentRecord(userId: number, userRole?: string) {
  if (userRole === "agent_staff") {
    const [staffUser] = await db.select({ managingAgentId: usersTable.managingAgentId }).from(usersTable).where(eq(usersTable.id, userId));
    if (!staffUser?.managingAgentId) return null;
    const [agentRec] = await db.select().from(agentsTable).where(eq(agentsTable.id, staffUser.managingAgentId));
    return agentRec || null;
  }
  const [agentRec] = await db.select().from(agentsTable).where(eq(agentsTable.userId, userId));
  return agentRec || null;
}

export async function getManagingAgentId(userId: number, userRole: string): Promise<number | null> {
  if (userRole === "agent_staff") {
    const [staffUser] = await db.select({ managingAgentId: usersTable.managingAgentId }).from(usersTable).where(eq(usersTable.id, userId));
    return staffUser?.managingAgentId || null;
  }
  const [agentRec] = await db.select({ id: agentsTable.id }).from(agentsTable).where(eq(agentsTable.userId, userId));
  return agentRec?.id || null;
}
