import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db, apiTokensTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth, requireRole, logAudit } from "../lib/auth";
import { ADMIN_ROLES } from "../lib/roles";
import { generateToken, validateScopes, AVAILABLE_SCOPES } from "../lib/apiToken";
import { getClientIp } from "../lib/clientIp";

const router: IRouter = Router();

// API tokens may only be managed from an interactive (cookie) session. A token
// must never be able to mint or revoke further tokens — that would let a leaked
// token bootstrap persistent, broader access. Block Bearer-authed requests.
function blockTokenAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.apiTokenAuth) {
    res.status(403).json({ error: "API tokens cannot manage API tokens" });
    return;
  }
  next();
}

// Non-secret projection — never returns token_hash. Each row a caller can see is
// scoped to their own user_id.
function publicToken(t: typeof apiTokensTable.$inferSelect) {
  return {
    id: t.id,
    name: t.name,
    prefix: t.tokenPrefix,
    scopes: (t.scopes as string[] | null) ?? [],
    lastUsedAt: t.lastUsedAt,
    expiresAt: t.expiresAt,
    revokedAt: t.revokedAt,
    createdAt: t.createdAt,
  };
}

// List of scopes a token may hold, for the management UI.
router.get("/api-tokens/scopes", requireAuth, requireRole(...ADMIN_ROLES), blockTokenAuth, async (_req, res): Promise<void> => {
  res.json({ data: AVAILABLE_SCOPES });
});

// List the current user's own tokens (most recent first).
router.get("/api-tokens", requireAuth, requireRole(...ADMIN_ROLES), blockTokenAuth, async (req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(apiTokensTable)
    .where(eq(apiTokensTable.userId, req.user!.id))
    .orderBy(desc(apiTokensTable.createdAt), desc(apiTokensTable.id));
  res.json({ data: rows.map(publicToken) });
});

// Create a token. The plain value is returned exactly once in this response and
// can never be retrieved again.
router.post("/api-tokens", requireAuth, requireRole(...ADMIN_ROLES), blockTokenAuth, async (req, res): Promise<void> => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  if (name.length > 100) {
    res.status(400).json({ error: "name must be 100 characters or fewer" });
    return;
  }

  const rawScopes = req.body?.scopes;
  if (!Array.isArray(rawScopes) || rawScopes.length === 0) {
    res.status(400).json({ error: "scopes must be a non-empty array" });
    return;
  }
  if (!rawScopes.every((s) => typeof s === "string")) {
    res.status(400).json({ error: "scopes must be strings" });
    return;
  }
  const scopes = Array.from(new Set(rawScopes as string[]));
  const { valid, invalid } = validateScopes(scopes);
  if (!valid) {
    res.status(400).json({ error: "Unknown scope(s)", invalid });
    return;
  }

  let expiresAt: Date | null = null;
  if (req.body?.expiresAt != null && req.body.expiresAt !== "") {
    const parsed = new Date(req.body.expiresAt);
    if (isNaN(parsed.getTime())) {
      res.status(400).json({ error: "expiresAt is not a valid date" });
      return;
    }
    if (parsed.getTime() <= Date.now()) {
      res.status(400).json({ error: "expiresAt must be in the future" });
      return;
    }
    expiresAt = parsed;
  }

  const { plain, prefix, hash } = generateToken();
  const [row] = await db
    .insert(apiTokensTable)
    .values({
      userId: req.user!.id,
      name,
      tokenHash: hash,
      tokenPrefix: prefix,
      scopes,
      expiresAt,
      createdBy: req.user!.id,
    })
    .returning();

  logAudit(req.user!.id, "create", "api_token", row.id, { name, scopes, expiresAt }, getClientIp(req) ?? undefined);

  // `token` is the only time the plain value is ever exposed.
  res.status(201).json({ token: plain, ...publicToken(row) });
});

// Revoke a token (soft — keeps the row for audit/last-used history). Only the
// owner may revoke their own token; revoking an already-revoked token is a no-op
// returning the current state.
router.post("/api-tokens/:id/revoke", requireAuth, requireRole(...ADMIN_ROLES), blockTokenAuth, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [existing] = await db
    .select()
    .from(apiTokensTable)
    .where(and(eq(apiTokensTable.id, id), eq(apiTokensTable.userId, req.user!.id)));
  if (!existing) {
    res.status(404).json({ error: "Token not found" });
    return;
  }
  if (existing.revokedAt) {
    res.json(publicToken(existing));
    return;
  }
  const [updated] = await db
    .update(apiTokensTable)
    .set({ revokedAt: new Date() })
    .where(eq(apiTokensTable.id, id))
    .returning();

  logAudit(req.user!.id, "revoke", "api_token", id, { name: existing.name }, getClientIp(req) ?? undefined);

  res.json(publicToken(updated));
});

export default router;
