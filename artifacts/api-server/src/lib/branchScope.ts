import { db, usersTable, agentsTable, agentBranchesTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const SUPER_ROLES = new Set(["super_admin"]);

/**
 * Returns the list of branch IDs the user is allowed to see.
 * - super_admin → null (means: no scoping, see everything)
 * - any other role with a branch_id → [branchId]
 * - agents/sub_agents/agent_staff → all branches assigned to their agency
 *   via the agent_branches join table (plus their direct branchId if any)
 * - users with no branch assigned → [] (sees nothing branch-scoped)
 */
export async function getVisibleBranchIds(userId: number, role: string): Promise<number[] | null> {
  if (SUPER_ROLES.has(role)) return null;

  const [user] = await db
    .select({ branchId: usersTable.branchId, managingAgentId: usersTable.managingAgentId })
    .from(usersTable)
    .where(eq(usersTable.id, userId));

  const ids = new Set<number>();
  if (user?.branchId) ids.add(user.branchId);

  if (role === "agent" || role === "sub_agent") {
    const [agent] = await db.select({ id: agentsTable.id }).from(agentsTable).where(eq(agentsTable.userId, userId));
    if (agent) {
      // Self + child agents (sub-agents under this agent) so an agent sees its full sub-tree.
      const children = await db.select({ id: agentsTable.id }).from(agentsTable).where(eq(agentsTable.parentAgentId, agent.id));
      const agentIds = [agent.id, ...children.map(c => c.id)];
      const rows = await db
        .select({ branchId: agentBranchesTable.branchId })
        .from(agentBranchesTable)
        .where(inArray(agentBranchesTable.agentId, agentIds));
      rows.forEach(r => ids.add(r.branchId));
    }
  } else if (role === "agent_staff" && user?.managingAgentId) {
    const rows = await db.select({ branchId: agentBranchesTable.branchId }).from(agentBranchesTable).where(eq(agentBranchesTable.agentId, user.managingAgentId));
    rows.forEach(r => ids.add(r.branchId));
  }

  return Array.from(ids);
}

/**
 * Resolve a branch_id to inherit on a newly created record.
 * - If creator is super_admin and explicitly passed a branchId, use it.
 * - Otherwise inherit from the creator's first visible branch (their own).
 */
export async function resolveCreateBranchId(
  userId: number,
  role: string,
  explicitBranchId?: number | null,
): Promise<number | null> {
  if (SUPER_ROLES.has(role)) {
    return explicitBranchId ?? null;
  }
  const visible = await getVisibleBranchIds(userId, role);
  if (visible && visible.length > 0) return visible[0];
  return explicitBranchId ?? null;
}
