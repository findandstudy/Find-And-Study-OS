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

**DEFINITIVE (what actually works): capture the SPA's own header from the
network — do NOT read web storage.** In the headless adapter context the
Supabase session does NOT materialize where the adapter can read it after its
own login: BOTH localStorage `sb-*-auth-token` and the `base64-` cookie came
back empty in prod (two commits of storage-reading + polling failed). The
robust source is the SPA itself — once logged in, the portal frontend attaches
`Authorization: Bearer <access_token>` to EVERY `/api/graphql` request. Arm a
`page.on("request")` listener that grabs that header and store the bare JWT in
a per-page WeakMap; reuse it verbatim on our read-only calls. Storage reading
is kept only as a last-resort fallback.
**Why:** headless login doesn't persist the gotrue session to a readable
localStorage/cookie in Playwright's context; the live SPA request header is the
only reliable carrier.

**How to apply (lib/portal-adapters/src/universities/sit/):**
- `installSpaAuthCapture(page)` (graphql.ts) — idempotent (WeakSet) request
  listener → WeakMap<Page,string>. Call in adapter `login()` right after
  launchPortal (before performLogin) AND in `ensureLoggedIn` so the header is
  captured during the natural post-login students-list load.
- `collectAuth()` PRIMARY = the captured header; if not yet seen, ONE bounded
  `page.waitForRequest(/api/graphql + bearer, 12s)`, then re-check the map;
  only then fall back to the storage poll (localStorage + base64 cookie).
- Both transports (page.request + in-page fetch) already send
  `Authorization: Bearer` when `auth.bearer` is present.
- Diagnostics: symptom is `data:null` with no `errors`. Log `bearer=true/false`
  (booleans only) and, on success, "data received". **Never log the token
  value** (PII/secret) — response logging must redact JWT-like strings.
- No bearer found ⇒ log ONE clear warning ("Supabase token bulunamadı — login
  akışı değişti mi?") and short-circuit (return null → UI-scan fallback); do
  NOT hammer both transports, they'd only return data:null.
- Same Supabase-Bearer pattern likely applies to the United adapter too.
