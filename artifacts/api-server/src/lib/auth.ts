import { Request, Response, NextFunction } from "express";
import { db, auditLogsTable } from "@workspace/db";

export type AuthUser = {
  id: number;
  replitId: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  role: string;
  avatarUrl: string | null;
  language: string;
  isActive: boolean;
};

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  if (!req.user.isActive) {
    res.status(403).json({ error: "Account is pending activation. Contact your administrator." });
    return;
  }

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
