import { Router, type IRouter, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { db, usersTable, emailVerificationCodesTable } from "@workspace/db";
import { eq, and, gt, sql } from "drizzle-orm";
import { sendEmail } from "../lib/email";
import {
  clearSession,
  getSession,
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

function buildSessionUser(user: Record<string, unknown>): SessionUser {
  const result: SessionUser = {
    id: user.id as number,
    replitId: (user.replitId as string) || `local-${user.id}`,
    email: user.email as string | null,
    firstName: user.firstName as string | null,
    lastName: user.lastName as string | null,
    role: user.role as string,
    avatarUrl: user.avatarUrl as string | null,
    language: user.language as string,
    isActive: user.isActive as boolean,
    emailVerified: user.emailVerified as boolean,
    startDate: user.startDate as string | null,
    homeAddress: user.homeAddress as string | null,
    passportNumber: user.passportNumber as string | null,
    contractUrl: user.contractUrl as string | null,
    passportUrl: user.passportUrl as string | null,
    emergencyContactName: user.emergencyContactName as string | null,
    emergencyContactPhone: user.emergencyContactPhone as string | null,
  };
  if (user.role === "agent_staff" && user.agentStaffPermissions) {
    result.agentStaffPermissions = user.agentStaffPermissions as string[];
  }
  return result;
}

function generateVerificationCode(): string {
  return crypto.randomInt(100000, 999999).toString();
}

function buildVerificationCodeEmail(firstName: string, code: string): { subject: string; html: string; text: string } {
  const subject = "Your Verification Code — Find & Study";
  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);">
    <div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:32px;text-align:center;">
      <h1 style="margin:0;color:#fff;font-size:24px;">Find & Study</h1>
      <p style="margin:8px 0 0;color:rgba(255,255,255,.8);font-size:14px;">Email Verification</p>
    </div>
    <div style="padding:32px;">
      <h2 style="margin:0 0 16px;color:#111827;font-size:20px;">Verify Your Email</h2>
      <p style="margin:0 0 24px;color:#374151;font-size:15px;line-height:1.6;">
        Hi ${firstName}, use the code below to verify your email address. This code expires in 15 minutes.
      </p>
      <div style="text-align:center;margin:0 0 24px;">
        <div style="display:inline-block;background:#f0f0ff;border:2px solid #6366f1;border-radius:12px;padding:16px 32px;letter-spacing:8px;font-size:32px;font-weight:700;color:#6366f1;">${code}</div>
      </div>
      <p style="margin:0 0 8px;color:#6b7280;font-size:13px;text-align:center;">
        If you did not create an account, you can safely ignore this email.
      </p>
    </div>
  </div>
</body>
</html>`;
  const text = `Hi ${firstName},\n\nYour verification code is: ${code}\n\nThis code expires in 15 minutes.\nIf you did not create an account, you can safely ignore this email.`;
  return { subject, html, text };
}

router.get("/auth/me", async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const [freshUser] = await db.select().from(usersTable).where(eq(usersTable.id, req.user.id));
  const userData = freshUser ? buildSessionUser(freshUser) : req.user;

  const sid = req.cookies?.sid;
  let isImpersonating = false;
  if (sid) {
    const sess = await getSession(sid);
    if (sess && (sess as any).originalSid) {
      isImpersonating = true;
    }
  }

  res.json({ ...userData, isImpersonating });
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
    const isPublicApplyPendingVerification = user.createdFromSource === "public_apply" && !user.emailVerified && user.passwordHash;
    if (!isPublicApplyPendingVerification) {
      res.status(403).json({ error: "Your account has been deactivated. Please contact an administrator." });
      return;
    }
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

  try {
    const emailContent = buildVerificationCodeEmail(firstName.trim(), code);
    await sendEmail(normalizedEmail, emailContent);
  } catch (err) {
    console.error("[EMAIL VERIFICATION] Failed to send verification email:", err);
  }

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

  try {
    const emailContent = buildVerificationCodeEmail(user.firstName || "Student", code);
    await sendEmail(normalizedEmail, emailContent);
  } catch (err) {
    console.error("[EMAIL VERIFICATION] Failed to send verification email:", err);
  }

  res.json({ message: "A new verification code has been sent to your email." });
});

router.post("/auth/forgot-password", async (req: Request, res: Response) => {
  const { email } = req.body;
  if (!email) {
    res.status(400).json({ error: "Email is required" });
    return;
  }

  const normalizedEmail = email.toLowerCase().trim();

  const ip = req.ip || "unknown";
  if (!checkRateLimit(`forgot:${ip}`, 5) || !checkRateLimit(`forgot:${normalizedEmail}`, 3)) {
    res.status(429).json({ error: "Too many reset requests. Please try again later." });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, normalizedEmail));

  if (!user) {
    res.json({ message: "If an account with that email exists, a password reset link has been sent." });
    return;
  }

  const { generateSecureToken, buildPasswordResetEmail, sendEmail } = await import("../lib/email");
  const resetToken = generateSecureToken();
  const tokenHash = crypto.createHash("sha256").update(resetToken).digest("hex");
  const resetExpires = new Date(Date.now() + 60 * 60 * 1000);

  await db
    .update(usersTable)
    .set({ passwordResetToken: tokenHash, passwordResetExpires: resetExpires })
    .where(eq(usersTable.id, user.id));

  const baseUrl = process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}`
    : "http://localhost:5000";
  const resetUrl = `${baseUrl}/login?token=${resetToken}`;

  const emailContent = buildPasswordResetEmail({
    firstName: user.firstName || "User",
    resetUrl,
  });
  await sendEmail(user.email || normalizedEmail, emailContent);

  console.log(`[PASSWORD RESET] Reset email sent to ${normalizedEmail}`);

  res.json({ message: "If an account with that email exists, a password reset link has been sent." });
});

router.post("/auth/set-password", async (req: Request, res: Response) => {
  const { token, password } = req.body;
  if (!token || !password) {
    res.status(400).json({ error: "Token and password are required" });
    return;
  }

  if (password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" });
    return;
  }

  const ip = req.ip || "unknown";
  if (!checkRateLimit(`set-password:${ip}`, 5)) {
    res.status(429).json({ error: "Too many attempts. Please try again later." });
    return;
  }

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const [user] = await db
    .select()
    .from(usersTable)
    .where(
      and(
        eq(usersTable.passwordResetToken, tokenHash),
        gt(usersTable.passwordResetExpires, new Date()),
      )
    );

  if (!user) {
    res.status(400).json({ error: "Invalid or expired link. Please request a new one." });
    return;
  }

  const hash = await bcrypt.hash(password, 10);
  await db
    .update(usersTable)
    .set({
      passwordHash: hash,
      passwordResetToken: null,
      passwordResetExpires: null,
      ...(user.emailVerified ? { isActive: true } : {}),
    })
    .where(eq(usersTable.id, user.id));

  res.json({ success: true, message: user.emailVerified ? "Password has been set. You can now log in." : "Password has been set. Please verify your email to activate your account." });
});

router.get("/auth/verify-email-token/:token", async (req: Request, res: Response) => {
  const ip = req.ip || "unknown";
  if (!checkRateLimit(`verify-token:${ip}`, MAX_VERIFY_ATTEMPTS)) {
    res.redirect("/login?verifyError=invalid");
    return;
  }

  const { token } = req.params;
  if (!token) {
    res.status(400).json({ error: "Token is required" });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.emailVerificationToken, token));

  if (!user) {
    res.redirect("/login?verifyError=invalid");
    return;
  }

  await db
    .update(usersTable)
    .set({
      emailVerified: true,
      emailVerificationToken: null,
      ...(user.passwordHash ? { isActive: true } : {}),
    })
    .where(eq(usersTable.id, user.id));

  res.redirect("/login?verified=true");
});

router.post("/auth/resend-verification-email", async (req: Request, res: Response) => {
  const emailParam = req.body?.email?.toLowerCase?.()?.trim?.();

  if (!req.user && !emailParam) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const ip = req.ip || "unknown";
  const rateLimitKey = req.user ? `resend-verify:${req.user.id}` : `resend-verify:${emailParam}`;
  if (!checkRateLimit(`resend-verify:${ip}`, MAX_RESEND_ATTEMPTS) || !checkRateLimit(rateLimitKey, MAX_RESEND_ATTEMPTS)) {
    res.status(429).json({ error: "Too many attempts. Please wait before requesting again." });
    return;
  }

  const [user] = req.user
    ? await db.select().from(usersTable).where(eq(usersTable.id, req.user.id))
    : await db.select().from(usersTable).where(eq(usersTable.email, emailParam));
  if (!user || user.emailVerified) {
    res.json({ message: "If the email is registered and unverified, a verification link has been sent." });
    return;
  }

  const { generateSecureToken } = await import("../lib/email");
  const { buildVerificationEmail, sendEmail } = await import("../lib/email");

  const verificationToken = generateSecureToken();
  await db
    .update(usersTable)
    .set({ emailVerificationToken: verificationToken })
    .where(eq(usersTable.id, user.id));

  const baseUrl = process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}`
    : "http://localhost:5000";
  const verifyEmailUrl = `${baseUrl}/api/auth/verify-email-token/${verificationToken}`;

  const emailContent = buildVerificationEmail({
    firstName: user.firstName || "Student",
    verifyEmailUrl,
  });
  await sendEmail(user.email || "", emailContent);

  res.json({ message: "If the email is registered and unverified, a verification link has been sent." });
});

async function handleLogout(req: Request, res: Response) {
  const sid = getSessionId(req);
  await clearSession(res, sid);
  res.redirect("/login");
}

router.get("/auth/logout", handleLogout);
router.post("/auth/logout", handleLogout);

export default router;
