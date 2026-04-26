import { type Request, type Response, type NextFunction } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  clearSession,
  getSessionId,
  getSession,
  touchSession,
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
    startDate: dbUser.startDate,
    homeAddress: dbUser.homeAddress,
    passportNumber: dbUser.passportNumber,
    contractUrl: dbUser.contractUrl,
    passportUrl: dbUser.passportUrl,
    emergencyContactName: dbUser.emergencyContactName,
    emergencyContactPhone: dbUser.emergencyContactPhone,
  };
  if (dbUser.role === "agent_staff" && dbUser.agentStaffPermissions) {
    result.agentStaffPermissions = dbUser.agentStaffPermissions as string[];
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

  const dbUser = await fetchDbUser(session.user.id);
  if (!dbUser) {
    await clearSession(res, sid);
    next();
    return;
  }

  // a) Soft-deleted account
  if (dbUser.deletedAt !== null) {
    await clearSession(res, sid);
    res.status(401).json({ error: "Account not found" });
    return;
  }

  // b) Deactivated account
  if (dbUser.isActive === false) {
    await clearSession(res, sid);
    res.status(403).json({ error: "Account deactivated" });
    return;
  }

  // c) Unverified email
  if (dbUser.emailVerified === false) {
    await clearSession(res, sid);
    res.status(403).json({ error: "Email not verified" });
    return;
  }

  req.user = buildSessionUser(dbUser);

  // Slide session expiry on every authenticated request (fire-and-forget).
  setImmediate(() => {
    touchSession(sid).catch(() => {});
  });

  next();
}
