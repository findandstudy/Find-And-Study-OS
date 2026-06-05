---
name: CSRF cookie must exist on page load
description: Why agents got a silent 403 signing contracts in prod, and the double-submit cookie-bootstrap rule that prevents it.
---

# CSRF cookie must be present at page-load time, not only after an /api call

Double-submit CSRF: server sets `csrf_token` cookie (httpOnly=false, SameSite=Lax,
Secure in prod) and requires header `x-csrf-token` to equal it on unsafe methods.
The client only attaches the header **if** the `csrf_token` cookie is readable in
`document.cookie` (both `customFetch` in lib/api-client-react and the `csrfSetup`
window.fetch monkeypatch guard on cookie presence). No cookie → no header → server
returns `403 {"error":"CSRF token missing or invalid"}`.

**The trap:** if the cookie is only set on `/api` responses (not on the SPA's
`index.html` page load), a freshly-loaded client that issues an unsafe request
before any cookie-setting `/api` GET completes (e.g. an agent landing straight on
the contract-signing screen from a cached/sticky user) POSTs without the token and
gets a 403. Verified in prod: `GET /`, `/tr/agent`, `/tr/login` returned NO
`Set-Cookie: csrf_token` — only `/api/...` did.

**Why:** the deployed CSRF middleware didn't reliably issue the cookie on HTML page
loads, and the client can't self-heal (it has no token to send and won't prime one).

**How to apply:**
- Guarantee the `csrf_token` cookie exists when serving `index.html` (the SPA
  fallback that sends the HTML), independent of middleware ordering. That removes
  the missing-cookie race for the first unsafe request.
- The CSRF reject path returns 403 **silently** (no console output) — that is why
  "no log" appears in prod. Instrument the rejection with a structured line
  (method/path/cookiePresent/headerPresent/match/userId/role/ua) so the exact cause
  is visible. Never log the token value itself.
- Diagnose source-of-403 with curl: JSON `{"error":"CSRF token missing or invalid"}`
  = app CSRF (not a proxy/autoscale HTML 403); cookie+matching header → passes CSRF
  and falls through to requireAuth 401. Oversized bodies return JSON 413, never HTML
  (rules out signature/drawing-area size as a cause).
