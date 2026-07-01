---
name: Topkapı language-agnostic locators
description: Why Topkapı Playwright locators must be bilingual once the portal UI is physically switched to English
---

The Topkapı adapter physically switches the portal UI to English after login
(`ensureEnglishLanguage` in `login()`) BEFORE program discovery, so the program
dropdown loads English-track options that would be missing/Turkish-only otherwise.

**The switch MUST use real Playwright locators, not a single `page.evaluate`.**
**Why:** a one-pass in-page evaluate that opens the flag menu and clicks
"English" in the same synchronous tick fails silently — the animated dropdown
hasn't rendered its items yet, and `el.click()` doesn't fire the theme's
(Metronic/Bootstrap) framework handlers, so the run stays Turkish even though
the code "exists". Prefer trigger-click → wait → option-click with Playwright
locators; verify with `isEnglishUI` after each attempt; keep DOM-heuristic +
locale-URL GETs only as later fallbacks. Idempotent + non-fatal.

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
