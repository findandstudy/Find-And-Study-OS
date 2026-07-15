import { type Request, type Response, type NextFunction } from "express";
import { db, usersTable, rolesTable, DEFAULT_ROLE_PERMISSIONS } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  clearSession,
  getSessionId,
  getSession,
  touchSession,
  SESSION_COOKIE,
  SESSION_TTL,
  type SessionUser,
} from "../lib/replitAuth";
import { getSessionCookieOptions } from "../lib/cookieOptions";
import { extractBearerToken, extractQueryToken, lookupApiToken } from "../lib/apiTokenAuth";

declare global {
  namespace Express {
    interface Request {
      isAuthenticated(): this is AuthedRequest;
      user?: SessionUser | undefined;
      // Scopes granted to the API token that authenticated this request.
      // Undefined for cookie/session requests (those are gated by role/perms).
      tokenScopes?: string[] | undefined;
      // True when the request authenticated via an "Authorization: Bearer"
      // API token rather than a session cookie. Used to bypass CSRF and to
      // switch on scope enforcement.
      apiTokenAuth?: boolean | undefined;
    }

    interface AuthedRequest {
      user: SessionUser;
    }
  }
}

// ─── Role-permission cache ────────────────────────────────────────────────────
// Roles change rarely; cache the rolesTable lookup per role name for 60 s so
// every authenticated request does not incur an extra DB round-trip.
const PERM_CACHE_TTL = 60_000;
const rolePermCache = new Map<string, { perms: string[]; exp: number }>();

// admin / super_admin already have isAdmin=true on the frontend → canSee is
// always true for them, so there is no need to populate agentStaffPermissions.
const ADMINISH_ROLES = new Set(["admin", "super_admin"]);

async function resolveRolePerms(role: string): Promise<string[]> {
  const now = Date.now();
  const cached = rolePermCache.get(role);
  if (cached && cached.exp > now) return cached.perms;

  const [row] = await db
    .select({ permissions: rolesTable.permissions })
    .from(rolesTable)
    .where(eq(rolesTable.name, role));

  const perms: string[] = row
    ? ((row.permissions as string[] | null) ?? [])
    : ((DEFAULT_ROLE_PERMISSIONS as Record<string, string[]>)[role] ?? []);

  rolePermCache.set(role, { perms, exp: now + PERM_CACHE_TTL });
  return perms;
}

/**
 * Populate `user.agentStaffPermissions` with the effective permission set for
 * the user's role (sourced from rolesTable, cached per role) unioned with any
 * per-user agent_staff permissions already stored on the DB row.
 *
 * This is what the frontend `canSee(perm)` check consults for sidebar menu
 * visibility — without this, staff/consultant/accountant roles would always
 * see an empty set and therefore no gated menu items.
 *
 * Skipped for admin/super_admin (they pass the isAdmin short-circuit instead).
 * Never throws — on error the existing session value is preserved unchanged.
 */
async function enrichWithEffectivePerms(
  user: SessionUser,
  dbUser: typeof usersTable.$inferSelect,
): Promise<void> {
  if (ADMINISH_ROLES.has(user.role)) return;
  try {
    const rolePerms = await resolveRolePerms(user.role);
    // Union: role-level perms ∪ per-user agent_staff column (for agent_staff rows)
    const own = Array.isArray(dbUser.agentStaffPermissions)
      ? (dbUser.agentStaffPermissions as string[])
      : [];
    user.agentStaffPermissions = Array.from(new Set([...rolePerms, ...own]));
  } catch {
    // Preserve whatever buildSessionUser already set on error.
  }
}

// ─────────────────────────────────────────────────────────────────────────────

async function fetchDbUser(id: number): Promise<typeof usersTable.$inferSelect | null> {
  const [dbUser] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  return dbUser ?? null;
}

function buildSessionUser(dbUser: typeof usersTable.$inferSelect): SessionUser {
  const result: SessionUser = {
    id: dbUser.id,
    replitId: dbUser.replitId || `local-${dbUser.id}`,
    email: dbUser.email,
    firstName: dbUser.firstName,
    lastName: dbUser.lastName,
    role: dbUser.role,
    avatarUrl: dbUser.avatarUrl,
    language: dbUser.language,
    isActive: dbUser.isActive,
    emailVerified: dbUser.emailVerified,
    phone: dbUser.phone,
  };
  if (dbUser.role === "agent_staff") {
    // Always emit the field for agent_staff (even when the DB column is null)
    // so the frontend never sees `undefined` and mis-renders Access Denied.
    result.agentStaffPermissions = Array.isArray(dbUser.agentStaffPermissions)
      ? (dbUser.agentStaffPermissions as string[])
      : [];
  }
  return result;
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  req.isAuthenticated = function (this: Request) {
    return this.user != null;
  } as Request["isAuthenticated"];

  // Bearer API token takes precedence over the session cookie when present.
  // A malformed/unknown/expired/revoked token is rejected outright (401) rather
  // than silently falling back to session auth, which would be surprising and
  // could mask a bad credential.
  const bearer = extractBearerToken(req.headers.authorization);
  if (bearer) {
    const result = await lookupApiToken(bearer);
    if (!result) {
      res.status(401).json({ error: "Invalid or expired API token" });
      return;
    }
    req.user = buildSessionUser(result.dbUser);
    await enrichWithEffectivePerms(req.user, result.dbUser);
    req.tokenScopes = result.scopes;
    req.apiTokenAuth = true;
    next();
    return;
  }

  // Fallback: API token supplied via the "?api_key=" query parameter. Only
  // reached when no Bearer header was present (the header always wins), so this
  // is purely additive and breaks no existing header-based integration. The
  // same lookupApiToken validation path is used — an invalid query key yields
  // the identical 401 as the header flow. The key is never logged here.
  const queryToken = extractQueryToken(req.query as Record<string, unknown>);
  if (queryToken) {
    const result = await lookupApiToken(queryToken);
    if (!result) {
      res.status(401).json({ error: "Invalid or expired API token" });
      return;
    }
    req.user = buildSessionUser(result.dbUser);
    await enrichWithEffectivePerms(req.user, result.dbUser);
    req.tokenScopes = result.scopes;
    req.apiTokenAuth = true;
    next();
    return;
  }

  const sid = getSessionId(req);
  if (!sid) {
    next();
    return;
  }

  const session = await getSession(sid);
  if (!session?.user?.id) {
    await clearSession(res, sid, req);
    next();
    return;
  }

  const dbUser = await fetchDbUser(session.user.id);
  if (!dbUser) {
    await clearSession(res, sid, req);
    next();
    return;
  }

  // a) Soft-deleted account
  if (dbUser.deletedAt !== null) {
    await clearSession(res, sid, req);
    res.status(401).json({ error: "Account not found" });
    return;
  }

  // b) Deactivated account
  if (dbUser.isActive === false) {
    await clearSession(res, sid, req);
    res.status(403).json({ error: "Account deactivated" });
    return;
  }

  // c) Unverified email — only enforced for students. Staff, admin, agent and
  // other internal roles are onboarded by an administrator and are allowed in
  // even without confirming their email address (matches the behaviour of the
  // frontend EmailVerificationGuard, which also only blocks the student role).
  if (dbUser.emailVerified === false && dbUser.role === "student") {
    await clearSession(res, sid, req);
    res.status(403).json({ error: "Email not verified" });
    return;
  }

  req.user = buildSessionUser(dbUser);
  await enrichWithEffectivePerms(req.user, dbUser);

  // Slide session expiry on every authenticated request (fire-and-forget).
  setImmediate(() => {
    touchSession(sid).catch(() => {});
  });

  // Slide the BROWSER cookie expiry forward to match the server-side session.
  // Without this, the cookie's maxAge is fixed at login time (30 min) and
  // disappears even though the user is actively using the app — leading to
  // unexpected 401 "Authentication required" errors on the next mutation.
  res.cookie(SESSION_COOKIE, sid, getSessionCookieOptions(req, SESSION_TTL));

  next();
}
