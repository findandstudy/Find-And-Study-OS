import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";
import { getCsrfCookieOptions } from "../lib/cookieOptions";

const CSRF_COOKIE = "csrf_token";
const CSRF_HEADER = "x-csrf-token";
const CSRF_SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Kept independent of router imports so the real boundary can be exercised by
// disposable route tests without starting unrelated LISTEN/seed side effects.
export function csrfProtection(req: Request, res: Response, next: NextFunction) {
  // Bearer API-token requests carry no auth cookie and are immune to CSRF, so
  // they bypass the double-submit cookie check entirely.
  if ((req as any).apiTokenAuth) return next();

  if (
    req.path.startsWith("/api/public/") ||
    req.path.startsWith("/api/webhooks/") ||
    // The agent onboarding verify-with-link endpoint is hit by users clicking
    // an email button before any session/CSRF cookie has been issued. It is
    // protected by per-IP rate limiting and a single-use, time-bounded
    // 6-digit code bound to the email.
    req.path === "/api/agents/onboarding/verify-with-link" ||
    req.path === "/api/agents/onboarding/resend-public"
  ) {
    return next();
  }

  if (!req.cookies[CSRF_COOKIE]) {
    const token = crypto.randomBytes(32).toString("hex");
    res.cookie(CSRF_COOKIE, token, getCsrfCookieOptions(req, 7 * 24 * 60 * 60 * 1000));
    // Express does not add a response cookie back into req.cookies. Mark this
    // request so the SPA fallback handler does not issue a second, conflicting
    // csrf_token for the same response.
    (req as Request & { csrfCookieIssued?: boolean }).csrfCookieIssued = true;
  }

  if (!CSRF_SAFE_METHODS.has(req.method)) {
    const cookieToken = req.cookies[CSRF_COOKIE];
    const headerToken = req.headers[CSRF_HEADER];
    if (!cookieToken || !headerToken || cookieToken !== headerToken) {
      // Production returns this 403 silently, which is why CSRF failures (e.g.
      // an agent whose browser had no csrf_token cookie at contract-signing
      // time) produced "no log". Emit a structured line so the exact cause —
      // missing cookie vs missing header vs mismatch — is visible in prod logs.
      console.warn(
        "[csrf] rejected " +
          JSON.stringify({
            method: req.method,
            path: req.path,
            cookiePresent: Boolean(cookieToken),
            headerPresent: Boolean(headerToken),
            match: Boolean(cookieToken && headerToken && cookieToken === headerToken),
            userId: (req as any).user?.id ?? null,
            role: (req as any).user?.role ?? null,
            ua: req.headers["user-agent"] || null,
          }),
      );
      res.status(403).json({ error: "CSRF token missing or invalid" });
      return;
    }
  }

  next();
}
