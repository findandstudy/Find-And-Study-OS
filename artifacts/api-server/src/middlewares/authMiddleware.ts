import { type Request, type Response, type NextFunction } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  clearSession,
  getSessionId,
  getSession,
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

async function rehydrateUser(sessionUser: SessionUser): Promise<SessionUser | null> {
  const [dbUser] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, sessionUser.id));
  if (!dbUser) return null;
  return {
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

  const freshUser = await rehydrateUser(session.user);
  if (!freshUser) {
    await clearSession(res, sid);
    next();
    return;
  }

  req.user = freshUser;
  next();
}
