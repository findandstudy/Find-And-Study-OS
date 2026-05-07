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
 * - super_admin may pass any branchId explicitly (or null = unassigned).
 * - Branch-scoped users: explicitBranchId is honored only if it is within
 *   their visible scope; otherwise inherit their first visible branch.
 *   If they have no visible branches, returns null (caller should 403).
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
  if (!visible || visible.length === 0) return null;
  if (explicitBranchId != null && visible.includes(explicitBranchId)) {
    return explicitBranchId;
  }
  return visible[0];
}

/**
 * Verify that the given agent is in the caller's visible branch scope.
 * Returns true for super_admin (no scope), or when at least one of the
 * agent's branches intersects with the caller's visible branches.
 */
export async function isAgentInScope(
  callerUserId: number,
  callerRole: string,
  agentId: number,
): Promise<boolean> {
  const visible = await getVisibleBranchIds(callerUserId, callerRole);
  if (visible === null) return true; // super_admin
  if (visible.length === 0) return false;
  const links = await db
    .select({ branchId: agentBranchesTable.branchId })
    .from(agentBranchesTable)
    .where(eq(agentBranchesTable.agentId, agentId));
  if (links.length === 0) return false;
  const allowed = new Set(visible);
  return links.some(l => allowed.has(l.branchId));
}
