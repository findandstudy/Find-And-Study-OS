---
name: Topkapı language-agnostic locators
description: Why Topkapı Playwright locators must be bilingual once the portal UI is physically switched to English
---

The Topkapı adapter physically switches the portal UI to English BEFORE program
discovery, so the Step-4 dropdown loads English-track options that are
missing/Turkish-only otherwise.

**Enforce the switch on the `/add` form page, not only in `login()`.**
**Why:** the login-time switch runs on `/panel`, but `submit()` and
`listPrograms()` then `goto(/panel/applications/add)` with a FRESH url, which
reverts to the account default (Turkish) → Step-4 shows Turkish options. The
login call is a non-fatal pre-warm only; the authoritative call is
`ensureEnglishLanguage(page, {fatal:true, returnTo:/add})` right after the
`goto(/add)` in BOTH `submit()` and `listPrograms()`, before Step 1.
**How to apply:** it is FATAL on the `/add` path — if it can't confirm English
after a retry it throws (never silently submits through a Turkish dropdown). The
worker (`portal-automation-worker/src/runner.ts`) lets that error propagate →
submission marked failed, process stays alive. Required log lines:
`[topkapi] language: switching to English…` then `…confirmed English` or
`…SWITCH FAILED (still Turkish)`.

**VERIFIED live-DOM switcher mechanism (do NOT guess generic selectors):** the
trigger is a top-right flag + text showing the CURRENT language autonym
("Türkçe" while Turkish, "English" once switched) and may be a plain
`<span>`/`<div>`, NOT a button/link — so open it with
`page.locator("header,…[class*='header']").getByText(/^(English|Türkçe|…)$/)`,
not `getByRole("button")`. The menu entries are real `<a>` links whose exact text
is `English`/`Türkçe` with `href="javascript:;"` (client-side handler) — click
`getByRole("link",{name:/^english$/i})`. Generic `[data-kt-lang]/.language-switch/
[class*='language']` selectors do NOT hit the real link. A HIDDEN template
`<a>English</a>` renders alongside the visible entry, so iterate ALL matches and
click the first `isVisible()` one — `.first()` may resolve to the hidden template
and skip the switch entirely (this was the silent-Turkish bug).

**The switch is client-side (no reload/navigation event).** So: verify by
POLLING rendered content (`waitForEnglish` polls `isEnglishUI` ~5s), NOT by a
navigation/`networkidle` wait; and `isEnglishUI` must be content-first (compare
TR vs EN UI-word + wizard-step-title counts) because `<html lang>` may not update
— use `<html lang>` only as a tiebreaker. Strategy ladder: A real menu
trigger→option click (2 passes), B in-page DOM heuristic, C locale-URL GET then
re-land on `returnTo`. `dumpLanguageSwitcher` logs candidate switcher DOM once
per attempt so the real selector can be pinned from a live dry-run.

**All `page.evaluate` in the switch path MUST be string-literal**, not arrow/
named-function callbacks: esbuild keep-names wraps inner fns with `__name`, which
doesn't exist in the browser sandbox and throws → the strategy dies silently in
the bundled worker (dev/tsx hides it). `isEnglishUI`, `clickEnglishSwitchInPage`,
`dumpLanguageSwitcher` are all string-literal for this reason.

**Rule:** every text-based Playwright locator in the Topkapı adapter must be
bilingual/language-agnostic, or it silently times out in English mode.

**Why:** a Turkish-only locator like `getByRole("button", {name:/Sonraki Adım/i})`
waits the full 8s and fails once the button renders as "Next Step". That timeout
was mistaken for a matcher problem; the actual fix is the locators, not the matcher.

**How to apply:**
- Nav/submit buttons: dual-lang regex, e.g. `/(Sonraki Adım|Next Step)/i`,
  `/(Başvuruyu Tamamla|Complete Application)/i`.
- Program-full: detect via `option.disabled` (language-agnostic) FIRST; the text
  suffix check is only a fallback and must match `(Kontenjan Dolu|Quota Full)`.
- Placeholder detection is position-based (skip option index 0), already
  language-agnostic — do not switch it to text matching.
- COUNTRY_NAME_MAP once had two overlapping blocks (quoted + unquoted keys) →
  21 TS1117 duplicate-key errors; keep it a single deduped map.
