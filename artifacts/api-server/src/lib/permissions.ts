import {
  db,
  usersTable,
  rolesTable,
  DEFAULT_ROLE_PERMISSIONS,
  getAllPermissions,
} from "@workspace/db";
import { eq } from "drizzle-orm";

type PermUser = { id: number; role: string };

// Roles that implicitly hold every permission, mirroring the frontend
// `hasPermission` short-circuit in use-auth.ts (super_admin + admin).
const ALL_PERMISSION_ROLES = new Set(["super_admin", "admin"]);

/**
 * Resolve the effective permission set for a user.
 *
 * Order of resolution:
 *   1. super_admin / admin → all permissions (matches frontend behaviour).
 *   2. The stored role row (`roles.permissions`) is authoritative; falls back
 *      to the static DEFAULT_ROLE_PERMISSIONS only when no row exists.
 *   3. Per-user overrides (`users.permission_overrides`, a `{ key: boolean }`
 *      map) are applied last: `true` grants the key, `false` revokes it. This
 *      is a tri-state on top of the role default — keys absent from the map
 *      simply inherit the role.
 */
export async function getEffectivePermissionSet(user: PermUser): Promise<Set<string>> {
  if (ALL_PERMISSION_ROLES.has(user.role)) {
    return new Set(getAllPermissions());
  }

  const [roleRow] = await db
    .select({ permissions: rolesTable.permissions })
    .from(rolesTable)
    .where(eq(rolesTable.name, user.role));

  const base = roleRow
    ? ((roleRow.permissions as string[] | null) ?? [])
    : ((DEFAULT_ROLE_PERMISSIONS as Record<string, string[]>)[user.role] || []);

  const set = new Set<string>(base);

  const [u] = await db
    .select({ overrides: usersTable.permissionOverrides })
    .from(usersTable)
    .where(eq(usersTable.id, user.id));

  const overrides = (u?.overrides as Record<string, boolean> | null) || {};
  for (const [key, granted] of Object.entries(overrides)) {
    if (granted) set.add(key);
    else set.delete(key);
  }

  return set;
}

export async function userHasPermission(user: PermUser, key: string): Promise<boolean> {
  if (ALL_PERMISSION_ROLES.has(user.role)) return true;
  const set = await getEffectivePermissionSet(user);
  return set.has(key);
}

/**
 * Decide whether a non-admin staff user may access a record based on its
 * assignment and the user's record-visibility permissions. Admin-tier roles
 * bypass this entirely (handled by callers via ADMIN_ROLES).
 *
 *   - Own records: always accessible.
 *   - Unassigned records: require `records.view_unassigned`.
 *   - Records assigned to someone else: require `records.view_others`.
 */
export function canAccessAssignedRecord(
  perms: Set<string>,
  assignedToId: number | null,
  userId: number,
): boolean {
  if (assignedToId === userId) return true;
  if (assignedToId === null) return perms.has("records.view_unassigned");
  return perms.has("records.view_others");
}
