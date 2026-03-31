import { db, agentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { STAFF_ROLES } from "./roles";

export interface OriginMeta {
  originType: "direct" | "agent" | "sub_agent";
  originEntityType: string | null;
  originEntityId: number | null;
  originDisplayName: string | null;
}

const STAFF_SET = new Set<string>(STAFF_ROLES as unknown as string[]);

function agentDisplayName(agent: { companyName: string | null; businessName: string | null; firstName: string; lastName: string }): string {
  return agent.companyName || agent.businessName || `${agent.firstName} ${agent.lastName}`;
}

export async function inferOriginFromUser(userRole: string, userId: number, managingAgentId?: number | null): Promise<OriginMeta> {
  if (STAFF_SET.has(userRole) || userRole === "student") {
    return { originType: "direct", originEntityType: null, originEntityId: null, originDisplayName: "Find And Study" };
  }

  if (userRole === "agent_staff") {
    if (!managingAgentId) {
      return { originType: "direct", originEntityType: null, originEntityId: null, originDisplayName: "Find And Study" };
    }
    const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, managingAgentId));
    if (!agent) return { originType: "direct", originEntityType: null, originEntityId: null, originDisplayName: "Find And Study" };
    if (agent.parentAgentId) {
      return { originType: "sub_agent", originEntityType: "agent", originEntityId: agent.id, originDisplayName: agentDisplayName(agent) };
    }
    return { originType: "agent", originEntityType: "agent", originEntityId: agent.id, originDisplayName: agentDisplayName(agent) };
  }

  if (userRole === "sub_agent") {
    const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.userId, userId));
    if (!agent) return { originType: "sub_agent", originEntityType: null, originEntityId: null, originDisplayName: null };
    return { originType: "sub_agent", originEntityType: "agent", originEntityId: agent.id, originDisplayName: agentDisplayName(agent) };
  }

  if (userRole === "agent") {
    const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.userId, userId));
    if (!agent) return { originType: "agent", originEntityType: null, originEntityId: null, originDisplayName: null };
    return { originType: "agent", originEntityType: "agent", originEntityId: agent.id, originDisplayName: agentDisplayName(agent) };
  }

  return { originType: "direct", originEntityType: null, originEntityId: null, originDisplayName: "Find And Study" };
}

export async function inferOriginFromAgentId(agentId: number): Promise<OriginMeta> {
  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, agentId));
  if (!agent) return { originType: "agent", originEntityType: "agent", originEntityId: agentId, originDisplayName: null };
  if (agent.parentAgentId) {
    return { originType: "sub_agent", originEntityType: "agent", originEntityId: agent.id, originDisplayName: agentDisplayName(agent) };
  }
  return { originType: "agent", originEntityType: "agent", originEntityId: agent.id, originDisplayName: agentDisplayName(agent) };
}

export function directOrigin(): OriginMeta {
  return { originType: "direct", originEntityType: null, originEntityId: null, originDisplayName: "Find And Study" };
}
