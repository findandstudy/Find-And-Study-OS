---
name: Reproducing prod-only React #185 (edcons)
description: How to faithfully reproduce/triage a production-only React minified error #185 (Maximum update depth) in the edcons monorepo when dev is clean.
---

When the deployed edcons portal throws React #185 ("Maximum update depth exceeded") on page load (caught by the global ErrorBoundary → "Page could not be loaded") but dev looks fine, triage in this order:

1. **Verify the live bundle is actually the current code.** `curl -s https://<prod-domain>/ | rg -o '/assets/[^"]+\.(js|css)'` and compare the Vite content-hashed asset names to a fresh local build (`artifacts/edcons/dist/public/index.html`). Identical hashes ⇒ byte-identical bundle ⇒ NOT a stale deploy; the trigger is runtime state/data, not the code.
2. **Reproduce the prod bundle locally.** Prod serving = api-server in `NODE_ENV=production` serving `edcons/dist/public` via `serveStaticFrontend()` on one port (no vite proxy). Build with the exact prod cmd (`deploy/build-production.sh`: `BASE_PATH="/" NODE_ENV=production` for the frontend). Then run server + Playwright + kill **in ONE bash command** — background servers are killed when a bash tool call returns.
3. **Drive a real browser.** Standalone `playwright` fails with `libgbm.so.1` missing; pass `executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` (a wrapped Nix chromium that loads its own libs). Auth via API: GET any endpoint first to receive the `csrf_token` cookie, then POST `/api/auth/login` with header `x-csrf-token` = that cookie (double-submit CSRF in api-server `app.ts`).
4. **Read the request counts, not the totals.** A page firing ~100 requests in 5s is usually just one-time code-split chunk + asset loads (max repeat ~2), NOT a loop. `waitUntil:"networkidle"` will time out on this app even when healthy (persistent connections), so use `domcontentloaded` + a fixed wait and check the DOM for the ErrorBoundary fallback text.

**ErrorBoundary is NOT the loop.** Its auto-reload is cooldown-guarded (one cache-busted reload per pathname per 5 min via a sessionStorage timestamp), so it cannot reload-loop; it just contains the symptom. The #185 root cause is a render-time setState/effect loop elsewhere.

**Why fresh-context + dev-DB can't reproduce it:** the loop is triggered only by *persisted client state* (localStorage keys: `edcons_user`, `edcons_branding`, `edcons_theme`, `_edcons_nav_path`, `edcons_lang`) rehydrated by the NEW bundle, or by *production-DB-specific data*. A fresh/incognito Playwright context (empty localStorage) on dev data is the cleanest case and will pass. To bisect: have the user open production in an incognito/cleared-site-data window — if it works there, the cause is stale persisted client state (fix with a localStorage schema-version guard that wipes incompatible state on bundle change); if it still crashes, it is prod-data-dependent (inspect the specific prod records the crashing page renders).
