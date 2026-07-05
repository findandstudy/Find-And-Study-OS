---
name: SIT auth single-session + token grant
description: How SIT adapter authenticates without tripping captcha/rate-limit
---

# SIT auth: mint token, never submit the login form

The SIT (sitconnect) portal trips **captcha / rate-limit** when the /auth/login
FORM is SUBMITTED repeatedly. The old flow ran `performLogin` (fill + submit)
once per submission and cached the Supabase token per-page (WeakMap), so every
fresh page re-logged-in.

**Rule:** obtain the Supabase bearer via a **token grant** (global `fetch`,
`grant_type=password` or `refresh_token`) — never by submitting the form. The
token is cached at **process level**, keyed by lowercased email, and reused
across all submissions (single-session). UI form login is a LAST RESORT gated by
a ~10-min cooldown after a captcha failure (no tight retry loop).

Acquisition order in `getSitAccessToken`: fresh cached token → env
`SIT_REFRESH_TOKEN` refresh grant → env `SIT_ACCESS_TOKEN` (JWT) → password
grant. Optional env `SIT_SUPABASE_URL` / `SIT_SUPABASE_ANON_KEY` override the
hardcoded URL + page-captured anon key.

**Why (two easy-to-miss traps):**
- **Always GET the origin even when a token is cached.** GraphQL reads need the
  Laravel **XSRF-TOKEN cookie** (+ Bearer + apikey). Each submission gets a
  brand-new page, so `login()` must still navigate (plain GET, no submit) to set
  the cookie. Use `sitCanAuthWithoutPage()` ONLY to decide whether to also wait
  for the SPA to boot and capture the anon key — never to skip navigation.
- **Env refresh fallback must key off token *validity*, not presence.** A
  non-JWT `SIT_ACCESS_TOKEN` must not block the `SIT_REFRESH_TOKEN` refresh
  branch. Gate on `injectedValid = injected && JWT_RE.test(injected)`.

Never log token/secret VALUES — only acquired/refreshed/reused/expired state and
HTTP status. In-memory only (no DB persistence → honors no-migration);
`SIT_REFRESH_TOKEN` survives restarts.
