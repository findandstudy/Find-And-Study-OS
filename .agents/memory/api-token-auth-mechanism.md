---
name: Persistent API token auth mechanism
description: How Bearer API-token auth coexists with cookie sessions in api-server (scopes, default-deny guard, CSRF, self-management ban)
---

Persistent API tokens (`fas_live_` + 32 base62) let external callers hit the api-server programmatically without a cookie session.

**Core design (do not regress):**
- Store only `SHA-256(plain)` in `api_tokens.token_hash`; the plain value is returned exactly once at create time and never again.
- Auth middleware checks **Bearer first**, then **`?api_key=` query fallback** (header always wins; only consulted when no Bearer), then falls back to session. A valid token sets `req.user` + `req.tokenScopes` (+ `req.apiTokenAuth=true`). Sessions are completely unaffected — no regression.
- Query fallback reads `api_key` (documented) + `apiKey` (alias) via `extractQueryToken`; **deliberately NOT `token`** (collides with public-sign/intake `?token=` links). No `fas_live_` prefix gate on the query (unlike Bearer) so an invalid `?api_key=` still hits `lookupApiToken` → same 401 body. **Why:** Bearer gates the prefix to let unknown Bearer schemes fall through to session; `api_key` is reserved for us so any value is a token attempt.
- **Bearer requests skip CSRF** (no cookie, no double-submit). Session requests still require CSRF.

**Scope enforcement is central + default-deny, NOT per-route:**
- `middlewares/tokenScopeGuard.ts` holds a method+path→required-scope table (`resolveScopeRule`), mounted before all routers.
- Sessions bypass the guard entirely. Token requests: unmapped endpoint → 403 `TOKEN_ENDPOINT_FORBIDDEN`; mapped but missing scope → 403 `INSUFFICIENT_SCOPE`.
- **Why central table over sprinkling `requireScope`:** a per-route approach silently leaves every un-annotated endpoint wide open to tokens (least-privilege gap). Central default-deny means a new route is closed to tokens until explicitly mapped. `requireScope` helper is kept + tested but the guard is the real gate.

**Tokens can never manage tokens:** `blockTokenAuth` on every `/api-tokens*` route returns 403 if `req.apiTokenAuth` — a leaked token must not be able to mint/revoke further tokens. Token management is cookie-session only.

**Prod migration:** the `api_tokens` table + indexes are created by idempotent boot DDL in `api-server/src/index.ts` (deploy runs no migrations — see prod-schema-bootstrap-ddl.md).

**Scopes (7, resource:action):** applications:read/write/patch, documents:read/write, students:read, universities:read. `AVAILABLE_SCOPES` in `lib/apiToken.ts` is the single source; the management UI fetches them via `GET /api-tokens/scopes`.

**UI:** edcons admin page `/admin/api-tokens` (ADMIN_ROLES). Backend revoke is `POST /api-tokens/:id/revoke` (soft, keeps row), NOT DELETE. List/create/scopes all under `apiTokens.*` i18n keys in all 10 locales.
