import type { Request, Response, NextFunction } from "express";
import { getSession, getSessionId } from "../replitAuth";

export function isEmailAutomationHumanSnapshot(user: { id: number; role: string; isActive: boolean } | undefined,
  apiToken: boolean | undefined, session: { user: { id: number }; originalSid?: string } | null): boolean {
  return !!user && user.isActive && ["admin", "super_admin"].includes(user.role)
    && !apiToken && !!session && session.user.id === user.id && !session.originalSid;
}

/** Session-only administration; a privileged impersonated account is not a checker. */
export async function emailAutomationHumanAllowed(req: Request): Promise<boolean> {
  if (!req.user || req.apiTokenAuth || !["admin", "super_admin"].includes(req.user.role)) return false;
  const sid = getSessionId(req);
  return isEmailAutomationHumanSnapshot(req.user, req.apiTokenAuth, sid ? await getSession(sid) : null);
}

export async function requireEmailAutomationHuman(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!await emailAutomationHumanAllowed(req)) { res.status(403).json({ error: "EMAIL_HUMAN_ADMIN_REQUIRED" }); return; }
    next();
  } catch { res.status(503).json({ error: "EMAIL_AUTHORITY_UNAVAILABLE" }); }
}
