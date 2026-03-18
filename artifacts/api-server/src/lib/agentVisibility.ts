import { db, agentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export async function getAgentVisibleIds(userId: number, userRole: string): Promise<number[]> {
  const [agentRec] = await db.select().from(agentsTable).where(eq(agentsTable.userId, userId));
  if (!agentRec) return [];

  if (userRole === "agent") {
    const subAgents = await db.select({ id: agentsTable.id }).from(agentsTable).where(eq(agentsTable.parentAgentId, agentRec.id));
    return [agentRec.id, ...subAgents.map(s => s.id)];
  }

  return [agentRec.id];
}

export async function getAgentRecord(userId: number) {
  const [agentRec] = await db.select().from(agentsTable).where(eq(agentsTable.userId, userId));
  return agentRec || null;
}
