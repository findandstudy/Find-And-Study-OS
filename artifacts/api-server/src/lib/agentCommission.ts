import { db, agentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export interface AgentCommissionInfo {
  agentId: number | null;
  agentCommissionRate: string | null;
  agentCommissionAmount: string | null;
  subAgentId: number | null;
  subAgentCommissionRate: string | null;
  subAgentCommissionAmount: string | null;
}

export async function resolveAgentCommission(
  agentId: number | null | undefined,
  universityCommissionAmount: number
): Promise<AgentCommissionInfo> {
  const empty: AgentCommissionInfo = {
    agentId: agentId ?? null,
    agentCommissionRate: null,
    agentCommissionAmount: null,
    subAgentId: null,
    subAgentCommissionRate: null,
    subAgentCommissionAmount: null,
  };

  if (!agentId || universityCommissionAmount <= 0) return empty;

  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, agentId));
  if (!agent) return empty;

  if (agent.parentAgentId) {
    const [parentAgent] = await db.select().from(agentsTable).where(eq(agentsTable.id, agent.parentAgentId));
    if (!parentAgent) return empty;

    const parentRate = parentAgent.commissionRate ?? 0;
    const parentAmount = parentRate > 0 ? (universityCommissionAmount * parentRate) / 100 : 0;

    const subRate = agent.commissionRate ?? 0;
    const subAmount = subRate > 0 && parentAmount > 0 ? (parentAmount * subRate) / 100 : 0;

    return {
      agentId: parentAgent.id,
      agentCommissionRate: parentRate > 0 ? String(parentRate) : null,
      agentCommissionAmount: parentAmount > 0 ? String(Math.round(parentAmount * 100) / 100) : null,
      subAgentId: agent.id,
      subAgentCommissionRate: subRate > 0 ? String(subRate) : null,
      subAgentCommissionAmount: subAmount > 0 ? String(Math.round(subAmount * 100) / 100) : null,
    };
  }

  const rate = agent.commissionRate ?? 0;
  const amount = rate > 0 ? (universityCommissionAmount * rate) / 100 : 0;

  return {
    agentId: agent.id,
    agentCommissionRate: rate > 0 ? String(rate) : null,
    agentCommissionAmount: amount > 0 ? String(Math.round(amount * 100) / 100) : null,
    subAgentId: null,
    subAgentCommissionRate: null,
    subAgentCommissionAmount: null,
  };
}
