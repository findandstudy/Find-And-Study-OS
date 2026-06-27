import { type Request, type Response, type NextFunction } from "express";
import { db, usersTable } from "@workspace/db";
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
