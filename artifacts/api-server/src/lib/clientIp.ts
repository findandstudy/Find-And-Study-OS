import type { Request } from "express";

/**
 * Resolve the client IP address from a request.
 *
 * The Express app sets `trust proxy = 1` so `req.ip` already reflects the
 * first entry of `X-Forwarded-For` (Replit's edge proxy). We return `null`
 * — never the literal string "unknown" — when the IP cannot be determined,
 * so that audit logs and rate-limit keys do not collapse every anonymous
 * caller into a single bucket.
 */
export function getClientIp(req: Request): string | null {
  const ip = req.ip;
  if (!ip || typeof ip !== "string") return null;
  const trimmed = ip.trim();
  if (!trimmed || trimmed.toLowerCase() === "unknown") return null;
  return trimmed;
}

/**
 * Same as `getClientIp` but returns a stable rate-limit key suffix when no
 * IP is available. Falls back to `"anon"` so anonymous requests are still
 * limited as a single bucket — preferable to "unknown" because the intent
 * is explicit.
 */
export function getRateLimitIp(req: Request): string {
  return getClientIp(req) ?? "anon";
}
