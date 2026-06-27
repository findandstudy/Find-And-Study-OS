import { db, apiTokensTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { hashToken } from "./apiToken";

// Pull the plain API token out of an "Authorization: Bearer <token>" header.
// Only our own token format ("fas_live_…") is intercepted; any other Bearer
// value returns null so the request falls through to normal session auth.
export function extractBearerToken(authHeader: string | string[] | undefined): string | null {
  const header = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  if (!header || !header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  if (!token.startsWith("fas_live_")) return null;
  return token;
}

// Coerce a single query value (which Express may deliver as string, array, or
// nested object) into a trimmed non-empty string, or null when unusable.
function firstQueryString(value: unknown): string | null {
  if (typeof value === "string") {
    const t = value.trim();
    return t.length > 0 ? t : null;
  }
  if (Array.isArray(value)) {
    for (const v of value) {
      if (typeof v === "string") {
        const t = v.trim();
        if (t.length > 0) return t;
      }
    }
  }
  return null;
}

// Pull the plain API token out of the request query string. This is a FALLBACK
// for clients that cannot set an Authorization header (e.g. plain GET links);
// the caller only consults it when no Bearer header was supplied, so the header
// always wins. The documented parameter is "api_key"; "apiKey" is accepted for
// tolerance. "token" is intentionally NOT read — it collides with existing
// public sign/intake links. Unlike the Bearer path no prefix filter is applied:
// api_key is reserved for this purpose, so any value is treated as a token
// attempt and an invalid one yields the same 401 as the header flow.
export function extractQueryToken(query: Record<string, unknown> | undefined): string | null {
  if (!query) return null;
  return firstQueryString(query["api_key"]) ?? firstQueryString(query["apiKey"]);
}

export type ApiTokenLookup = {
  token: typeof apiTokensTable.$inferSelect;
  dbUser: typeof usersTable.$inferSelect;
  scopes: string[];
};

// Resolve a plain token to its DB row + owning user, enforcing validity
// (not revoked, not expired, owner active and not soft-deleted). Returns null
// for any failure so the caller can answer a uniform 401. Lookup is by hash —
// the plain value is never stored. last_used_at is touched fire-and-forget.
export async function lookupApiToken(plain: string): Promise<ApiTokenLookup | null> {
  const hash = hashToken(plain);
  const [token] = await db.select().from(apiTokensTable).where(eq(apiTokensTable.tokenHash, hash));
  if (!token) return null;
  if (token.revokedAt) return null;
  if (token.expiresAt && token.expiresAt.getTime() <= Date.now()) return null;

  const [dbUser] = await db.select().from(usersTable).where(eq(usersTable.id, token.userId));
  if (!dbUser || dbUser.deletedAt !== null || dbUser.isActive === false) return null;

  setImmediate(() => {
    db.update(apiTokensTable)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiTokensTable.id, token.id))
      .catch(() => {});
  });

  return { token, dbUser, scopes: (token.scopes as string[] | null) ?? [] };
}
