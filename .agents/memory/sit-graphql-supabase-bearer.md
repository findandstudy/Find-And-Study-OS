---
name: SIT GraphQL auth = Supabase Bearer access_token
description: SIT /api/graphql authenticates with the Supabase access_token as Bearer; the token lives in a dynamic localStorage sb-*-auth-token key. Session cookie + XSRF alone are not enough.
---

SIT (partners.sitconnect.net) uses **Supabase Auth**. Its GraphQL endpoint
`POST /api/graphql` returns **HTTP 200 with `data: null`** (never a real auth
error) unless the request carries `Authorization: Bearer <access_token>`.

**Where the token is:** localStorage, under a key shaped
`sb-<project-ref>-auth-token` (project ref changes per deployment — discover it
dynamically: `startsWith("sb-") && endsWith("-auth-token")`). The value is the
Supabase session; read the top-level `access_token`. Handle these value shapes:
plain JSON, `@supabase/ssr` `base64-`-prefixed JSON (strip prefix, `atob`),
legacy `currentSession.access_token`, and array form (`[0].access_token`).

**Why the earlier generic storage-scan failed in prod:** a heuristic JWT/token
scan logged `bearer=false`. The Supabase-specific key read is authoritative and
should be tried FIRST, with the heuristic kept only as a resilience fallback.

**Timing + two sources (critical):** the Supabase session is written to web
storage right AFTER login completes, so a single early read misses it — and it
lives in TWO places on an authenticated session: localStorage `sb-*-auth-token`
(plain JSON) AND cookie `sb-*-auth-token` (`base64-<b64(JSON)>`, decode via
`atob(slice(7))`). `collectAuth` must POLL (≤15s, 500ms) and check BOTH each
pass, returning on the first JWT (happy path returns on pass 0, no delay).
Reading localStorage once (as the first commit did) logs "token bulunamadı".

**How to apply (lib/portal-adapters/src/universities/sit/graphql.ts):**
- `collectAuth()` extracts the bearer (poll localStorage + base64 cookie +
  generic scan); both transports (page.request + in-page fetch) already send
  `Authorization: Bearer` when it's present.
- Diagnostics: symptom is `data:null` with no `errors`. Log `bearer=true/false`
  (booleans only) and, on success, "data received". **Never log the token
  value** (PII/secret) — response logging must redact JWT-like strings.
- No bearer found ⇒ log ONE clear warning ("Supabase token bulunamadı — login
  akışı değişti mi?") and short-circuit (return null → UI-scan fallback); do
  NOT hammer both transports, they'd only return data:null.
- Same Supabase-Bearer pattern likely applies to the United adapter too.
