import type { Request, RequestHandler, Response } from "express";
import type { SessionData } from "./replitAuth";

const previewLoginPath = "/en/login?returnTo=%2Fadmin%2Fagent-team-preview%2F";

/** Only the fixed browser entry page receives a login redirect. Asset/API
 * requests keep their JSON errors; no caller-supplied return path is trusted. */
function redirectPreviewDocumentToLogin(req: Request, res: Response): boolean {
  const pathname = req.originalUrl.split("?")[0];
  const accept = req.headers.accept;
  if (!isPersonaTeamPreviewEnabled() || req.method !== "GET" ||
    !["/admin/agent-team-preview", "/admin/agent-team-preview/"].includes(pathname) ||
    typeof accept !== "string" || !accept.split(",").some((part) => part.trim().split(";")[0].toLowerCase() === "text/html") ||
    req.accepts(["html", "json"]) !== "html" ||
    req.headers["x-requested-with"] !== undefined ||
    (req.headers["sec-fetch-dest"] !== undefined && req.headers["sec-fetch-dest"] !== "document") ||
    (req.headers["sec-fetch-mode"] !== undefined && req.headers["sec-fetch-mode"] !== "navigate")) {
    return false;
  }
  res.redirect(302, previewLoginPath);
  return true;
}

/** A fixed, synthetic visual preview is not a persona project or an execution
 * capability. This guard must be mounted AFTER the existing authMiddleware. */
export function isPersonaTeamPreviewEnabled(): boolean {
  return process.env.NODE_ENV === "production" &&
    process.env.APP_BASE_URL === "https://staging.findandstudy.com" &&
    process.env.ALLOW_LIVE_INTEGRATIONS === "false" &&
    process.env.PERSONA_TEAM_PREVIEW_ENABLED === "true";
}

type SessionReader = (sessionId: string) => Promise<SessionData | null>;
/** The optional reader is a server-side test dependency, never HTTP input.
 * Production composition omits it and uses the canonical current session read. */
export function createPersonaTeamPreviewAccess(
  readSession?: SessionReader,
): RequestHandler {
  return async (req, res, next): Promise<void> => {
    res.set("Cache-Control", "private, no-store");
    res.set("X-Content-Type-Options", "nosniff");
    res.set("X-Robots-Tag", "noindex, nofollow");
    if (!isPersonaTeamPreviewEnabled()) {
      res.status(404).json({ error: "PERSONA_TEAM_PREVIEW_UNAVAILABLE" });
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.set("Allow", "GET, HEAD");
      res.status(405).json({ error: "PERSONA_TEAM_PREVIEW_READ_ONLY" });
      return;
    }
    // An invalid or unrelated Authorization value must not fall back to cookies.
    if (req.headers.authorization !== undefined || req.apiTokenAuth || req.tokenScopes !== undefined) {
      res.status(403).json({ error: "PERSONA_TEAM_PREVIEW_INTERACTIVE_SESSION_REQUIRED" });
      return;
    }
    try {
      if (!req.user && redirectPreviewDocumentToLogin(req, res)) return;
      // Lazy imports keep the pure runtime gate free from DB bootstrap side
      // effects. These are the existing app's real guards, not reimplementations.
      const { requireAuth, requireRole } = await import("./auth");
      let authenticated = false;
      await requireAuth(req, res, () => { authenticated = true; });
      if (!authenticated) return;
      let administrator = false;
      // ADMIN_ROLES also includes manager; this preview intentionally does not.
      requireRole("super_admin", "admin")(req, res, () => { administrator = true; });
      if (!administrator) return;

      const { getSessionId, getSession } = await import("./replitAuth");
      const sid = getSessionId(req);
      if (!sid || !/^[a-f0-9]{64}$/.test(sid)) {
        if (redirectPreviewDocumentToLogin(req, res)) return;
        res.status(401).json({ error: "PERSONA_TEAM_PREVIEW_INTERACTIVE_SESSION_REQUIRED" });
        return;
      }
      const session = await (readSession ?? getSession)(sid);
      if ((!session || !session.user) && redirectPreviewDocumentToLogin(req, res)) return;
      if (!session || !session.user || !Number.isSafeInteger(req.user!.id) || req.user!.id <= 0 ||
        session.user.id !== req.user!.id) {
        res.status(401).json({ error: "PERSONA_TEAM_PREVIEW_SESSION_INVALID" });
        return;
      }
      // Do not trust a client impersonation header or cached display role. The
      // canonical session's originalSid is the authoritative impersonation field.
      if (session.originalSid !== undefined) {
        res.status(403).json({ error: "PERSONA_TEAM_PREVIEW_IMPERSONATION_FORBIDDEN" });
        return;
      }
      if (!isPersonaTeamPreviewEnabled()) {
        res.status(404).json({ error: "PERSONA_TEAM_PREVIEW_UNAVAILABLE" });
        return;
      }
      next();
    } catch {
      res.status(503).json({ error: "PERSONA_TEAM_PREVIEW_AUTH_UNAVAILABLE" });
    }
  };
}
