import { Request, Response, NextFunction } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export type AuthUser = {
  id: number;
  replitId: string | null;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  role: string;
  avatarUrl: string | null;
  language: string;
  isActive: boolean;
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const replitUserId = req.headers["x-replit-user-id"] as string | undefined;
  const replitUserName = req.headers["x-replit-user-name"] as string | undefined;
  const replitUserImage = req.headers["x-replit-user-image"] as string | undefined;

  if (!replitUserId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  let [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.replitId, replitUserId));

  if (!user) {
    const [created] = await db
      .insert(usersTable)
      .values({
        replitId: replitUserId,
        firstName: replitUserName || null,
        avatarUrl: replitUserImage || null,
        role: "pending",
        language: "en",
        isActive: false,
      })
      .returning();
    user = created;
  }

  if (!user.isActive) {
    res.status(403).json({ error: "Account is pending activation. Contact your administrator." });
    return;
  }

  req.user = user as AuthUser;
  next();
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }
    next();
  };
}

export async function optionalAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const replitUserId = req.headers["x-replit-user-id"] as string | undefined;
  if (replitUserId) {
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.replitId, replitUserId));
    if (user && user.isActive) {
      req.user = user as AuthUser;
    }
  }
  next();
}

export async function logAudit(
  userId: number | null,
  action: string,
  resource: string,
  resourceId?: number,
  changes?: object,
  ipAddress?: string
) {
  try {
    const { auditLogsTable } = await import("@workspace/db");
    await db.insert(auditLogsTable).values({
      userId,
      action,
      resource,
      resourceId,
      changes: changes ? JSON.stringify(changes) : null,
      ipAddress: ipAddress || null,
    });
  } catch (err) {
    console.error("[audit] Failed to write audit log:", err);
  }
}
