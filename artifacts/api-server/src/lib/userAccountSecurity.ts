const PRIVILEGED_ROLE_RANK: Record<string, number> = {
  manager: 1,
  admin: 2,
  super_admin: 3,
};

const MANAGER_ASSIGNABLE_ROLES = new Set([
  "staff",
  "consultant",
  "editor",
  "accountant",
  "student",
  "agent",
  "sub_agent",
  "agent_staff",
  "pending",
]);

/**
 * Protect the privileged account hierarchy. A privileged actor may manage
 * accounts below their own tier; only a super administrator may manage
 * another super administrator. Self-service profile edits are handled
 * separately by the route and never authorize role changes.
 */
export function canManageTargetAccount(actorRole: string, targetRole: string): boolean {
  if (actorRole === "super_admin") return true;
  const actorRank = PRIVILEGED_ROLE_RANK[actorRole] ?? 0;
  const targetRank = PRIVILEGED_ROLE_RANK[targetRole] ?? 0;
  return actorRank > 0 && targetRank < actorRank;
}

/**
 * Limit which roles an actor may grant. Unknown/custom roles can carry
 * arbitrary permissions, so they require the role-management authority held
 * by administrators; managers are restricted to the explicit operational
 * role allow-list.
 */
export function canAssignUserRole(actorRole: string, nextRole: string): boolean {
  if (actorRole === "super_admin") return true;
  if (actorRole === "admin") {
    return nextRole !== "super_admin" && nextRole !== "admin";
  }
  if (actorRole === "manager") return MANAGER_ASSIGNABLE_ROLES.has(nextRole);
  return false;
}

export function isPrivilegedUserRole(role: string): boolean {
  return (PRIVILEGED_ROLE_RANK[role] ?? 0) > 0;
}
