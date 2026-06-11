import type { Request } from "express";

/**
 * Resolve the real client IP from a request.
 *
 * SECURITY (IP Spoofing / Rate-Limit Bypass):
 * The app is behind exactly ONE trusted proxy (the Replit edge). With
 * `trust proxy = 1`, Express uses the LEFTMOST `X-Forwarded-For` entry as
 * `req.ip`. That entry is attacker-controlled: a client can inject an
 * arbitrary IP via `X-Forwarded-For: fake-ip` before the real IP is appended
 * by the edge, allowing them to rotate through fake IPs and bypass per-IP
 * rate limits entirely.
 *
 * The correct approach: read the RIGHTMOST (last) entry of `X-Forwarded-For`.
 * That entry is added by the outermost trusted proxy (Replit edge) and cannot
 * be injected by the client — the client's payload arrives at the edge before
 * the edge appends the actual remote address. Assuming exactly one trusted
 * proxy hop, the rightmost XFF entry is always the real client IP.
 *
 * Falls back to `req.socket.remoteAddress` when XFF is absent (e.g. direct
 * connections in tests or non-proxied environments).
 */
export function getClientIp(req: Request): string | null {
  const xff = req.headers["x-forwarded-for"];
  const xffStr = Array.isArray(xff) ? xff[xff.length - 1] : xff;
  if (xffStr) {
    const parts = xffStr.split(",");
    const last = parts[parts.length - 1]?.trim();
    if (last && last.toLowerCase() !== "unknown") return last;
  }
  // No XFF header — fall back to the raw socket address. In production this
  // will be the Replit edge proxy IP, not the client, but it provides a stable
  // non-null key so anonymous requesters still hit a single shared bucket
  // rather than being ungated.
  const socketIp = req.socket?.remoteAddress?.trim();
  if (socketIp && socketIp.toLowerCase() !== "unknown") return socketIp;
  return null;
}

/**
 * Same as `getClientIp` but returns a stable rate-limit bucket key when no
 * IP can be determined. Falls back to `"anon"` so anonymous requests are
 * still limited rather than ungated.
 */
export function getRateLimitIp(req: Request): string {
  return getClientIp(req) ?? "anon";
}
