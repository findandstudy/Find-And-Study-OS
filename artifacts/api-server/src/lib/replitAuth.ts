import crypto from "crypto";
import { type Request, type Response } from "express";
import { db, sessionsTable } from "@workspace/db";
import { eq, asc, and, sql } from "drizzle-orm";
import { getClearCookieOptions } from "./cookieOptions";

export const SESSION_COOKIE = "sid";

/** Idle timeout: session expires 30 min after last activity. */
export const IDLE_TIMEOUT = 30 * 60 * 1000;

/** Backward-compatible alias — do not remove (imported by routes). */
export const SESSION_TTL = IDLE_TIMEOUT;

/** Maximum concurrent sessions allowed per user. */
export const MAX_SESSIONS_PER_USER = 3;

export interface SessionUser {
  id: number;
  replitId: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  role: string;
  avatarUrl: string | null;
  language: string;
  isActive: boolean;
  emailVerified: boolean;
  phone?: string | null;
  startDate?: string | null;
  homeAddress?: string | null;
  passportNumber?: string | null;
  contractUrl?: string | null;
  passportUrl?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  agentStaffPermissions?: string[];
}

export interface SessionData {
  user: SessionUser;
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
}

/**
 * Create a new session.
 *
 * If `userId` is supplied:
 *   - Counts active sessions belonging to that user.
 *   - Deletes the oldest session(s) so at most MAX_SESSIONS_PER_USER - 1
 *     remain before inserting the new one (ensuring max = MAX_SESSIONS_PER_USER).
 *
 * Impersonation sessions (userId = undefined) bypass the limit and are not
 * counted toward any user's quota.
 */
export async function createSession(
  data: SessionData,
  userId?: number,
): Promise<string> {
  if (userId !== undefined) {
    const existing = await db
      .select({ sid: sessionsTable.sid })
      .from(sessionsTable)
      .where(
        and(
          eq(sessionsTable.userId, userId),
          sql`${sessionsTable.expire} > NOW()`,
        ),
      )
      .orderBy(asc(sessionsTable.expire));

    const overflow = existing.length - (MAX_SESSIONS_PER_USER - 1);
    if (overflow > 0) {
      const toDelete = existing.slice(0, overflow);
      for (const s of toDelete) {
        await deleteSession(s.sid);
      }
    }
  }

  const sid = crypto.randomBytes(32).toString("hex");
  await db.insert(sessionsTable).values({
    sid,
    sess: data as unknown as Record<string, unknown>,
    expire: new Date(Date.now() + IDLE_TIMEOUT),
    userId: userId ?? null,
  });
  return sid;
}

export async function getSession(sid: string): Promise<SessionData | null> {
  const [row] = await db
    .select()
    .from(sessionsTable)
    .where(eq(sessionsTable.sid, sid));

  if (!row || row.expire < new Date()) {
    if (row) await deleteSession(sid);
    return null;
  }

  return row.sess as unknown as SessionData;
}

/**
 * Slide the session expiry forward by IDLE_TIMEOUT.
 * Call this on every authenticated request (fire-and-forget via setImmediate).
 */
export async function touchSession(sid: string): Promise<void> {
  await db
    .update(sessionsTable)
    .set({ expire: new Date(Date.now() + IDLE_TIMEOUT) })
    .where(eq(sessionsTable.sid, sid));
}

export async function updateSession(
  sid: string,
  data: SessionData,
): Promise<void> {
  await db
    .update(sessionsTable)
    .set({
      sess: data as unknown as Record<string, unknown>,
      expire: new Date(Date.now() + IDLE_TIMEOUT),
    })
    .where(eq(sessionsTable.sid, sid));
}

export async function deleteSession(sid: string): Promise<void> {
  await db.delete(sessionsTable).where(eq(sessionsTable.sid, sid));
}

export async function clearSession(
  res: Response,
  sid?: string,
  req?: Request,
): Promise<void> {
  if (sid) await deleteSession(sid);
  // When req is unavailable (e.g. background callers), fall back to a
  // synthesized request shape so we still match what was likely set.
  const reqLike = req ?? ({
    secure: process.env.NODE_ENV === "production",
    headers: {},
  } as Request);
  res.clearCookie(SESSION_COOKIE, getClearCookieOptions(reqLike));
}

export function getSessionId(req: Request): string | undefined {
  const authHeader = req.headers["authorization"];
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }
  return req.cookies?.[SESSION_COOKIE];
}
