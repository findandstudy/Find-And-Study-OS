import type { NextFunction, Request, Response } from "express";

const STUDENT_VERIFICATION_ALLOWLIST_EXACT = new Set([
  "/auth/me",
  "/auth/logout",
  "/auth/resend-verification-email",
  "/auth/verify-email",
  "/auth/resend-code",
  "/health",
]);

const STUDENT_VERIFICATION_ALLOWLIST_PREFIX = [
  "/auth/verify-email-token/",
];

/**
 * Keep an unverified student's authenticated session alive so the verification
 * screen can resend and consume verification messages, while denying access to
 * every other API until the address has been verified.
 */
export function studentEmailVerificationGate(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (
    !req.user
    || req.user.role !== "student"
    || req.user.emailVerified !== false
  ) {
    next();
    return;
  }

  const path = req.path;
  if (
    STUDENT_VERIFICATION_ALLOWLIST_EXACT.has(path)
    || STUDENT_VERIFICATION_ALLOWLIST_PREFIX.some((prefix) => path.startsWith(prefix))
  ) {
    next();
    return;
  }

  res.status(403).json({
    error: "Email verification required",
    code: "EMAIL_VERIFICATION_REQUIRED",
  });
}
