import * as oidc from "openid-client";
import { type Request, type Response, type NextFunction } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  clearSession,
  getOidcConfig,
  getSessionId,
  getSession,
  updateSession,
  type SessionData,
  type SessionUser,
} from "../lib/replitAuth";

declare global {
  namespace Express {
    interface Request {
      isAuthenticated(): this is AuthedRequest;
      user?: SessionUser | undefined;
    }

    interface AuthedRequest {
      user: SessionUser;
    }
  }
}

async function refreshIfExpired(
  sid: string,
  session: SessionData,
): Promise<SessionData | null> {
  const now = Math.floor(Date.now() / 1000);
  if (!session.expires_at || now <= session.expires_at) return session;

  if (!session.refresh_token) return null;

  try {
    const config = await getOidcConfig();
    const tokens = await oidc.refreshTokenGrant(
      config,
      session.refresh_token,
    );
    session.access_token = tokens.access_token;
    session.refresh_token = tokens.refresh_token ?? session.refresh_token;
    session.expires_at = tokens.expiresIn()
      ? now + tokens.expiresIn()!
      : session.expires_at;
    await updateSession(sid, session);
    return session;
  } catch {
    return null;
  }
}

async function rehydrateUser(sessionUser: SessionUser): Promise<SessionUser | null> {
  const [dbUser] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, sessionUser.id));
  if (!dbUser) return null;
  return {
    id: dbUser.id,
    replitId: dbUser.replitId!,
    email: dbUser.email,
    firstName: dbUser.firstName,
    lastName: dbUser.lastName,
    role: dbUser.role,
    avatarUrl: dbUser.avatarUrl,
    language: dbUser.language,
    isActive: dbUser.isActive,
  };
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  req.isAuthenticated = function (this: Request) {
    return this.user != null;
  } as Request["isAuthenticated"];

  const sid = getSessionId(req);
  if (!sid) {
    next();
    return;
  }

  const session = await getSession(sid);
  if (!session?.user?.id) {
    await clearSession(res, sid);
    next();
    return;
  }

  const refreshed = await refreshIfExpired(sid, session);
  if (!refreshed) {
    await clearSession(res, sid);
    next();
    return;
  }

  const freshUser = await rehydrateUser(refreshed.user);
  if (!freshUser) {
    await clearSession(res, sid);
    next();
    return;
  }

  req.user = freshUser;
  next();
}
