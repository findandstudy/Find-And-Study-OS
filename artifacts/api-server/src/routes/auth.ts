import { Router, type IRouter, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { db, usersTable, emailVerificationCodesTable } from "@workspace/db";
import { eq, and, gt, sql } from "drizzle-orm";
import {
  clearSession,
  getSessionId,
  createSession,
  SESSION_COOKIE,
  SESSION_TTL,
  type SessionData,
  type SessionUser,
} from "../lib/replitAuth";

const router: IRouter = Router();

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 10;
const MAX_VERIFY_ATTEMPTS = 5;
const MAX_RESEND_ATTEMPTS = 3;

function checkRateLimit(key: string, max: number): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(key);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return true;
  }
  if (entry.count >= max) return false;
  entry.count++;
  return true;
}

function setSessionCookie(res: Response, sid: string) {
  res.cookie(SESSION_COOKIE, sid, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL,
  });
}

function buildSessionUser(user: any): SessionUser {
  return {
    id: user.id,
    replitId: user.replitId || `local-${user.id}`,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    avatarUrl: user.avatarUrl,
    language: user.language,
    isActive: user.isActive,
  };
}

function generateVerificationCode(): string {
  return crypto.randomInt(100000, 999999).toString();
}

router.get("/auth/me", (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  res.json(req.user);
});

router.post("/auth/login", async (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required" });
    return;
  }

  const normalizedEmail = email.toLowerCase().trim();
  const ip = req.ip || "unknown";
  if (!checkRateLimit(`login:${ip}`, MAX_LOGIN_ATTEMPTS) || !checkRateLimit(`login:${normalizedEmail}`, MAX_LOGIN_ATTEMPTS)) {
    res.status(429).json({ error: "Too many login attempts. Please try again later." });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, normalizedEmail));
  if (!user || !user.passwordHash) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  if (!user.isActive) {
    res.status(403).json({ error: "Your account has been deactivated. Please contact an administrator." });
    return;
  }

  const sessionUser = buildSessionUser(user);
  const sessionData: SessionData = {
    user: sessionUser,
    access_token: `local-${crypto.randomBytes(16).toString("hex")}`,
  };

  const sid = await createSession(sessionData);
  setSessionCookie(res, sid);
  res.json({ user: sessionUser });
});

router.post("/auth/register", async (req: Request, res: Response) => {
  const { email, password, firstName, lastName, phone } = req.body;

  if (!email || !password || !firstName || !lastName) {
    res.status(400).json({ error: "All fields are required" });
    return;
  }

  const normalizedEmail = email.toLowerCase().trim();

  const ip = req.ip || "unknown";
  if (!checkRateLimit(`register:${ip}`, 5)) {
    res.status(429).json({ error: "Too many registration attempts. Please try again later." });
    return;
  }

  if (password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" });
    return;
  }

  const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, normalizedEmail));
  if (existing) {
    res.status(409).json({ error: "An account with this email already exists" });
    return;
  }

  const hash = await bcrypt.hash(password, 10);
  const [user] = await db.insert(usersTable).values({
    email: normalizedEmail,
    firstName: firstName.trim(),
    lastName: lastName.trim(),
    phone: phone?.trim() || null,
    passwordHash: hash,
    role: "student",
    isActive: false,
    emailVerified: false,
    language: "en",
  }).returning();

  const code = generateVerificationCode();
  await db.insert(emailVerificationCodesTable).values({
    email: normalizedEmail,
    code,
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  });

  console.log(`[EMAIL VERIFICATION] Code for ${normalizedEmail}: ${code}`);

  res.status(201).json({
    message: "Account created. Please verify your email.",
    requiresVerification: true,
    email: normalizedEmail,
  });
});

router.post("/auth/verify-email", async (req: Request, res: Response) => {
  const { email, code } = req.body;
  if (!email || !code) {
    res.status(400).json({ error: "Email and verification code are required" });
    return;
  }

  const normalizedEmail = email.toLowerCase().trim();

  const ip = req.ip || "unknown";
  if (!checkRateLimit(`verify:${ip}`, MAX_VERIFY_ATTEMPTS) || !checkRateLimit(`verify:${normalizedEmail}`, MAX_VERIFY_ATTEMPTS)) {
    res.status(429).json({ error: "Too many verification attempts. Please request a new code." });
    return;
  }

  const [verificationRecord] = await db
    .select()
    .from(emailVerificationCodesTable)
    .where(
      and(
        eq(emailVerificationCodesTable.email, normalizedEmail),
        eq(emailVerificationCodesTable.code, code.trim()),
        eq(emailVerificationCodesTable.used, false),
        gt(emailVerificationCodesTable.expiresAt, new Date()),
      )
    );

  if (!verificationRecord) {
    res.status(400).json({ error: "Invalid or expired verification code" });
    return;
  }

  await db
    .update(emailVerificationCodesTable)
    .set({ used: true })
    .where(eq(emailVerificationCodesTable.email, normalizedEmail));

  const [user] = await db
    .update(usersTable)
    .set({ emailVerified: true, isActive: true })
    .where(eq(usersTable.email, normalizedEmail))
    .returning();

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const sessionUser = buildSessionUser(user);
  const sessionData: SessionData = {
    user: sessionUser,
    access_token: `local-${crypto.randomBytes(16).toString("hex")}`,
  };

  const sid = await createSession(sessionData);
  setSessionCookie(res, sid);
  res.json({ user: sessionUser, verified: true });
});

router.post("/auth/resend-code", async (req: Request, res: Response) => {
  const { email } = req.body;
  if (!email) {
    res.status(400).json({ error: "Email is required" });
    return;
  }

  const normalizedEmail = email.toLowerCase().trim();

  const ip = req.ip || "unknown";
  if (!checkRateLimit(`resend:${ip}`, MAX_RESEND_ATTEMPTS) || !checkRateLimit(`resend:${normalizedEmail}`, MAX_RESEND_ATTEMPTS)) {
    res.status(429).json({ error: "Too many resend attempts. Please wait before requesting a new code." });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, normalizedEmail));
  if (!user) {
    res.json({ message: "If an account exists, a new code has been sent." });
    return;
  }

  if (user.emailVerified) {
    res.status(400).json({ error: "Email is already verified" });
    return;
  }

  await db
    .update(emailVerificationCodesTable)
    .set({ used: true })
    .where(and(eq(emailVerificationCodesTable.email, normalizedEmail), eq(emailVerificationCodesTable.used, false)));

  const code = generateVerificationCode();
  await db.insert(emailVerificationCodesTable).values({
    email: normalizedEmail,
    code,
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  });

  console.log(`[EMAIL VERIFICATION] New code for ${normalizedEmail}: ${code}`);

  res.json({ message: "A new verification code has been sent to your email." });
});

async function handleLogout(req: Request, res: Response) {
  const sid = getSessionId(req);
  await clearSession(res, sid);
  res.redirect("/login");
}

router.get("/auth/logout", handleLogout);
router.post("/auth/logout", handleLogout);

export default router;
