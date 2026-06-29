---
name: Topkapi adapter quirks
description: Known gotchas in the Topkapi portal automation adapter that bit us during real submission runs.
---

## 1. ALL-CAPS Turkish option text (country dropdowns)

The portal stores some countries in ALL-CAPS with Turkish dotted-I: e.g. `"ÖZBEKİSTAN"` (229), `"TÜRKMENİSTAN"` (219), `"KIRGIZİSTAN"` (115).

Plain JS `"ÖZBEKİSTAN".toLowerCase()` decomposes `İ` (U+0130) into `"i" + combining dot` (U+0307), so `.includes("özbekistan")` returns false.

**Fix:** Inside `page.$eval` callbacks, inline this normalizer (no named function — see §2):
```js
const nv = v.replace(/\u0130/gi, "i").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
```
Apply to both the search term and each option text before `.includes()`.

The same logic lives server-side as `fold()` in `programMatch.ts` (already handles this correctly via NFKD + diacritic strip).

---

## 2. esbuild `__name` in `page.$eval` / `page.evaluate` callbacks

esbuild's `keep-names` mode wraps **every** named function — including top-level `function foo()` declarations — with `__name(fn, "name")`. That helper exists in the Node.js bundle but **not** in Playwright's browser sandbox.

**Rule:** Pass a string literal to `page.evaluate` / `page.$eval` for any non-trivial callback:
```ts
await page.evaluate(`(function() {
  var el = document.querySelector(…);
  …
})()`);
```
Arrow functions and named function declarations inside the callback argument all trigger `__name` wrapping. String form bypasses esbuild transformation entirely.

---

## 3. "Exclusive bölge" jconfirm on Step 2

After clicking "Sonraki Adım" on Step 1, the portal may open a `jconfirm-modern` modal:
> *"Exclusive bölgeden başvuru yapıyorsunuz. Aşağıdaki acenta üzerinden başvurunuzu yapmanız gereklidir. Multico"* — single **TAMAM** button.

This modal blocks all pointer events including the Step 2 "Sonraki Adım" button.

**Fix:** `dismissJconfirm()` uses `page.evaluate()` DOM click (bypasses Playwright overlay check), pre- and post-dismiss around every `clickNext()` call. Uses `page.waitForSelector(".jconfirm.jconfirm-open", { state: "hidden" })` to confirm close.

---

## 4. portal_submission mode enum is `{dry, real}` (not `live`)

```sql
SELECT enum_range(NULL::portal_submission_mode);  -- {dry,real}
```

To run a real submission: `UPDATE portal_submissions SET mode='real', status='queued', ...`

---

## 5. programMatch synonym groups needed for Turkish portals

`programMatch.ts` SYNONYM_GROUPS needed two additions to reach conf ≥ 0.6 for English-labelled programs against Turkish portal options:

```ts
["ingilizce", "english"],   // language of instruction
["lisans", "bachelor", "undergraduate"],  // degree level
```

Without these, "Bachelor of Computer Engineering (English)" vs "Bilgisayar Mühendisliği (İngilizce - Lisans - Tam Zamanlı)" scored Jaccard=0.5.

---

## 6. Worker typecheck fails on pre-existing topkapi `$eval` DOM errors

`pnpm --filter @workspace/portal-automation-worker run typecheck` reports `Element.value/options`, `'o' is of type unknown`, and `NodeListOf must have [Symbol.iterator]` errors in `lib/portal-adapters/src/universities/topkapi/adapter.ts` (~lines 520/524/607). These are **pre-existing** (browser-context `$eval` callbacks typed under the worker tsconfig, which lacks DOM lib/downlevelIteration) and identical to HEAD — NOT regressions.

**Why:** `typecheck:libs` (lib's own tsconfig) passes clean; only the worker tsconfig surfaces them. Easy to mistake for damage you just caused.

**How to apply:** Before chasing topkapi typecheck errors, `diff` the file against `git show HEAD:...` — if identical, ignore. Verify your own portal-adapters work with `pnpm run typecheck:libs` + the portal-adapters unit tests, not the worker typecheck.

---

## 7. Per-slot upload format: photo=JPEG image, passport/transcript/diploma=PDF

The portal rejects passport/transcript/diploma uploaded as JPG/PNG with "Dosya türü geçersiz" — those three slots accept ONLY PDF. The photo slot is the opposite: it must stay an image (JPEG), never PDF.

**Where:** `lib/portal-runner/src/profile.ts` normalizes each downloaded doc before the adapter uploads it. `ensureUploadFormat()` dispatches by slot: `photo` → `ensureJpegImage`, `passport|transcript|diploma` (PDF_DOC_SLOTS) → `ensurePdfDocument` (wraps an image into a single-page PDF via pdf-lib; already-PDF detected by `%PDF-` magic bytes and passed through; non-decodable files left as-is).

**How to apply:** detection is CONTENT-based (sharp.metadata + magic bytes), never the DB mimeType/extension — a PNG mislabeled `.jpg`/`image/jpeg` is still handled. If a new portal needs different per-slot formats, change the slot→format mapping here, not in the adapter.

### 7b. Oversized docs (>1.8 MB) → compressed AFTER conversion (gs / sharp)

Topkapı reports oversized uploads as "Dosya türü geçersiz" (misleading — it's a SIZE limit, ~1.8 MB). `shrinkIfBig()` runs inside `ensureUploadFormat` AFTER the format conversion: PDFs via Ghostscript (`gs -sDEVICE=pdfwrite -dPDFSETTINGS=/ebook`), images via `sharp` resize ≤1600w jpeg q72. PDF-vs-image is decided by `%PDF-` MAGIC BYTES, not extension — a base64-path PDF keeps a `.bin` name, so extension checks misroute it into sharp and throw. Never throws / never enlarges (returns original on failure or non-smaller output). `gs` is NOT in the Replit dev env (graceful fallback) — it must be installed on the VPS worker for PDF compression to actually fire.

### IMPORTANT: portal-runner is NOT in `typecheck:libs`

`pnpm run typecheck:libs` (tsc --build) does NOT cover `lib/portal-runner` (it ships raw src, not built). A broken portal-runner edit (e.g. a missing `const execFileP = promisify(execFile)`) passes `typecheck:libs` silently. To typecheck portal-runner: `pnpm --filter @workspace/portal-runner exec tsc --noEmit -p tsconfig.json` — but that ALSO drags in topkapi adapter.ts's pre-existing `$eval` DOM + duplicate-country-key (TS1117) errors (present on HEAD, NOT regressions); grep the output for `profile.ts` to see only your own errors.

---

## 8. Master Tezli/Tezsiz lives in the program NAME, not the degree level

For Topkapı Master applications the thesis flag (Tezli/Tezsiz) is encoded in the CRM **program name** (e.g. "İşletme Yüksek Lisans (Tezsiz)"), NOT in `profile.level` (which is just "Yüksek Lisans"). So `mapEduLevel` must take BOTH `level` and `programName` and test the combined string; passing level alone silently defaults every master to "Masters (Thesis)".

**How to apply:** detect Turkish (tezli/tezsiz) AND English (thesis/non-thesis); use `fold()` not `toLowerCase()` so ALL-CAPS Turkish "TEZSİZ" normalises (dotted-İ → i). Same dual-form rule applies to `programMatch.applyHardFilters` (hasTez/hasTezsiz) which only matches Turkish tokens.

---

## 9. DB program_overrides resolved against LIVE options before fuzzy

`portal_program_mapping.program_overrides` (CRM programId → portal option value/label) is threaded as `profile.programOverrides` and must be resolved DIRECTLY against the live dropdown options BEFORE `matchProgram`: by exact option value → exact folded label → partial folded label. A hit wins conf 1.0. A miss must log ALL options as `"value: label"` and fall back to fuzzy — never hard-block on a stale/typo'd override.

**Why:** `matchProgram`'s built-in override step only does exact id/folded-name match, so subtle portal-label drift silently fell through to fuzzy (which could pick the wrong Tezli/Tezsiz variant) with no debug trail. The explicit adapter-level path adds partial match + full option logging.
