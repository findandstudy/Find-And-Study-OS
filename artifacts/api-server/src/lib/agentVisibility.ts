import { db, agentsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export async function getAgentVisibleIds(userId: number, userRole: string): Promise<number[]> {
  if (userRole === "agent_staff") {
    const [staffUser] = await db.select({ managingAgentId: usersTable.managingAgentId }).from(usersTable).where(eq(usersTable.id, userId));
    if (!staffUser?.managingAgentId) return [];
    const [managingAgent] = await db.select().from(agentsTable).where(eq(agentsTable.id, staffUser.managingAgentId));
    if (!managingAgent) return [];
    if (!managingAgent.parentAgentId) {
      const subAgents = await db.select({ id: agentsTable.id }).from(agentsTable).where(eq(agentsTable.parentAgentId, managingAgent.id));
      return [managingAgent.id, ...subAgents.map(s => s.id)];
    }
    return [managingAgent.id];
  }

  const [agentRec] = await db.select().from(agentsTable).where(eq(agentsTable.userId, userId));
  if (!agentRec) return [];

  if (userRole === "agent") {
    // A parent agent (no parentAgentId) sees its OWN records plus those of its
    // OWN sub-agents (agents whose parentAgentId === this agent). Records of
    // other agencies (and their sub-agents) are NEVER included — the sub-agent
    // query is scoped strictly to parentAgentId = agentRec.id, so this stays
    // IDOR-safe. A sub-agent that somehow carries the "agent" role (parentAgentId
    // set) falls through to own-only.
    if (!agentRec.parentAgentId) {
      const subAgents = await db.select({ id: agentsTable.id }).from(agentsTable).where(eq(agentsTable.parentAgentId, agentRec.id));
      return [agentRec.id, ...subAgents.map(s => s.id)];
    }
    return [agentRec.id];
  }

  return [agentRec.id];
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
