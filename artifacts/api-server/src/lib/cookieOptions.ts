import type { CookieOptions, Request } from "express";

function isSecureRequest(req: Request): boolean {
  if (req.secure) return true;
  const xfp = req.headers["x-forwarded-proto"];
  if (typeof xfp === "string" && xfp.split(",")[0]?.trim() === "https") return true;
  if (Array.isArray(xfp) && xfp[0] === "https") return true;
  return process.env.NODE_ENV === "production";
}

export function getSessionCookieOptions(req: Request, maxAgeMs: number): CookieOptions {
  const secure = isSecureRequest(req);
  return {
    httpOnly: true,
    secure,
    sameSite: secure ? "none" : "lax",
    path: "/",
    maxAge: maxAgeMs,
  };
}

export function getCsrfCookieOptions(req: Request, maxAgeMs: number): CookieOptions {
  const secure = isSecureRequest(req);
  return {
    httpOnly: false,
    secure,
    sameSite: secure ? "none" : "lax",
    path: "/",
    maxAge: maxAgeMs,
  };
}

export function getClearCookieOptions(req: Request): CookieOptions {
  const secure = isSecureRequest(req);
  return {
    path: "/",
    secure,
    sameSite: secure ? "none" : "lax",
  };
}
