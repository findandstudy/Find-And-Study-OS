import type {
  UniversityAdapter,
  AdapterSession,
  SubmitProfile,
  SubmitFiles,
  SubmitResult,
  LoginOpts,
  PortalProgramOption,
} from "../../types.js";
import { launchPortal, logger } from "../../browser.js";
import { portalCreds } from "../../portalCreds.js";
import { fold, matchProgram } from "../../programMatch.js";

// ---------------------------------------------------------------------------
// United portal allowlist — EXACTLY 3 universities (do not add/remove)
// Credentials: UNITED_USER + UNITED_PASSWORD (or inject via opts.credentials
// which the worker resolves from the DB-backed portal_credentials table).
//
// United = Salesforce-backed, ASP.NET MVC + KT Stepper multi-step wizard on
// partner.unitededucation.com/Manage/newapplication (NOT a single webhook like
// SIT). The create is multi-step + stateful, so this adapter drives the UI and
// — on the first LIVE submission — instruments the page network to capture the
// real final `POST /Manage/newapplication` body (token-redacted) so a Phase-2
// HTTP replay can be written later.
// ---------------------------------------------------------------------------
export const UNITED_ALLOWLIST: readonly string[] = [
  "Biruni Üniversitesi",
  "Nişantaşı Üniversitesi",
  "Ankara Bilim Üniversitesi",
] as const;

/** Pre-folded entries for fast matches() lookup. */
const UNITED_ALLOWLIST_FOLDED: readonly string[] = UNITED_ALLOWLIST.map(fold);

/** True when `name` is one of the 3 United member universities (folded, fuzzy). */
function isUnitedMember(name: string | undefined | null): boolean {
  const f = fold(String(name || ""));
  if (!f) return false;
  return UNITED_ALLOWLIST_FOLDED.some((entry) => f.includes(entry) || entry.includes(f));
}

const PORTAL_URL = "https://partner.unitededucation.com";

// Endpoints whose requests we mirror to the log during a live submission so the
// first real run reveals the exact create contract (field names + Salesforce
// contactid/programid/appid) for a future Phase-2 HTTP replay.
const NETLOG_URL_RE =
  /\/Manage\/(newapplication|uploadfilesone|selectprogram|Degreelist|test1)|\/Account\/searchapp/i;

/** Redact the ASP.NET MVC anti-forgery token out of a captured request body. */
function redactToken(body: string): string {
  if (!body) return body;
  return body
    // form-urlencoded: __RequestVerificationToken=....(&|end)
    .replace(/(__RequestVerificationToken=)[^&]*/gi, "$1<redacted>")
    // JSON: "__RequestVerificationToken":"...."
    .replace(/("__RequestVerificationToken"\s*:\s*")[^"]*"/gi, '$1<redacted>"');
}

// Body-capture redaction. The instrumentation exists to reveal the create
// CONTRACT — i.e. every field NAME plus the structural Salesforce ids
// (contactid/programid/appid + the cascade select ids) needed to write a
// Phase-2 HTTP replay. It must NEVER leak applicant PII values, so we log all
// keys but redact VALUES by default (default-deny), showing values only for a
// safe allowlist of structural/id fields and always redacting known-PII keys.
const SAFE_VALUE_KEY =
  /(^|_)id$|^select(university|program|degree|lang|campus)$|^(regtype|country|destination|degree|program|lang|campus)$|^university/i;
const PII_KEY =
  /(name|passport|kimlik|phone|mail|address|birth|dob|dateinput|school|father|mother|national|tckn)/i;

/** Sanitize a captured request body: keys kept, PII values redacted, token redacted. */
function sanitizeBody(raw: string): string {
  if (!raw) return raw;
  const body = redactToken(raw);
  const keepValue = (key: string): boolean => {
    const k = key.trim();
    if (/token/i.test(k)) return true; // already redacted by redactToken
    return SAFE_VALUE_KEY.test(k) && !PII_KEY.test(k);
  };
  // form-urlencoded (the ASP.NET MVC create POST): k1=v1&k2=v2...
  if (/^[^{[]*=/.test(body)) {
    return body
      .split("&")
      .map((pair) => {
        const eq = pair.indexOf("=");
        if (eq < 0) return pair;
        const rawKey = pair.slice(0, eq);
        let decoded = rawKey;
        try { decoded = decodeURIComponent(rawKey); } catch {}
        return keepValue(decoded) ? pair : rawKey + "=<redacted>";
      })
      .join("&")
      .slice(0, 4000);
  }
  // JSON body — redact string values of non-allowlisted keys recursively.
  try {
    const walk = (o: any): any => {
      if (o && typeof o === "object") {
        for (const key of Object.keys(o)) {
          if (o[key] && typeof o[key] === "object") walk(o[key]);
          else if (!keepValue(key)) o[key] = "<redacted>";
        }
      }
      return o;
    };
    return JSON.stringify(walk(JSON.parse(body))).slice(0, 4000);
  } catch {
    // Unknown format — do not risk logging raw PII.
    return "<unparsed body redacted>";
  }
}

// ---------------------------------------------------------------------------
// Flexible option matching (fixes programMissing false-positives)
//
// United's select2 <option> labels carry parenthetical qualifiers the CRM name
// omits, e.g. "Computer Engineering (Non-Thesis) (Turkish)". A strict
// text.includes(programName) then never matches. normLabel() drops the
// parentheticals and Turkish-folds; looseMatchIndex() then tries, in order:
// (a) normalized substring (either direction for longer strings), then
// (b) token overlap ≥ 60%. It NEVER guesses when nothing clears the bar.
// ---------------------------------------------------------------------------
function normLabel(s: string): string {
  return fold(String(s || "").replace(/\([^)]*\)/g, " "));
}

function looseMatchIndex(optTexts: string[], want: string): number {
  const w = normLabel(want);
  if (!w) return -1;
  const N = optTexts.map(normLabel);
  // (a) normalized substring — direct, and reverse for longer strings.
  let idx = N.findIndex((o) => o && (o.includes(w) || (w.length > 4 && o.length > 4 && w.includes(o))));
  if (idx >= 0) return idx;
  // (b) token overlap ≥ 60% of the wanted tokens.
  const wt = new Set(w.split(" ").filter((x) => x.length > 2));
  if (wt.size === 0) return -1;
  let best = -1, bestScore = 0;
  N.forEach((o, i) => {
    const ot = o.split(" ").filter((x) => x.length > 2);
    const hit = ot.filter((x) => wt.has(x)).length;
    const sc = hit / wt.size;
    if (sc > bestScore) { bestScore = sc; best = i; }
  });
  return bestScore >= 0.6 ? best : -1;
}

// Selects whose value MUST be an intentional match — never auto-pick the first
// option (would submit the wrong university/program/degree/language). A critical
// select with exactly one real option is still auto-selected (forced, unambiguous).
const CRITICAL_SELECT_IDS = new Set(["selectuniversity", "selectprogram", "selectdegree", "selectlang"]);

export const unitedAdapter: UniversityAdapter = {
  key:       "united",
  label:     "United Portal",
  allowlist: [...UNITED_ALLOWLIST],

  matches(name: string): boolean {
    return isUnitedMember(name);
  },

  async login(opts?: LoginOpts): Promise<AdapterSession> {
    // ---- Pre-flight: resolve creds + log SOURCE ONLY (never the value) ------
    let user = "";
    let password = "";
    let source = "MISSING";
    if (opts?.credentials?.user && opts?.credentials?.password) {
      user = opts.credentials.user;
      password = opts.credentials.password;
      source = "opts/db"; // worker-injected from DB portal_credentials
    } else {
      // portalCreds() reads UNITED_EMAIL / UNITED_USER + UNITED_PASSWORD env.
      try {
        const env = portalCreds("united");
        user = env.user;
        password = env.password;
        source = "env";
      } catch {
        source = "MISSING";
      }
    }
    logger.info(`[united] creds: ${source}`);
    if (!user || !password) {
      throw new Error(
        "[united] MISSING credentials — set UNITED_USER/UNITED_PASSWORD or portal_credentials row",
      );
    }

    const session = await launchPortal({ headless: opts?.headless ?? true });
    logger.info("[united] login — navigating to portal");

    const page: any = session.page;
    try {
      await page.goto(PORTAL_URL + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(3500);
      await page.locator("input[name*=user i], input[placeholder*=user i], input[id*=user i], input[type=text]").first().fill(user);
      await page.locator("input[type=password]").first().fill(password);
      await page.getByRole("button", { name: /sign ?in|log ?in|giris/i }).first().click({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(6000);
      if (await page.locator("input[type=password]").first().isVisible().catch(() => false)) throw new Error("[united] login failed - wrong creds or captcha");
      logger.info("[united] login successful -> " + page.url());
    } catch (err) { await session.close().catch(() => {}); throw err; }
    return session;
  },

  async submit(
    session: AdapterSession,
    profile: SubmitProfile,
    _files: SubmitFiles,
    doSubmit?: boolean,
  ): Promise<SubmitResult> {
    logger.info("[united] submit — program:", profile.programName, "| university:", profile.universityName);
    const page: any = session.page;
    // Dry boundary: EITHER the runner passing doSubmit=false OR PORTAL_DRYRUN=1.
    const dryRun = doSubmit === false || process.env.PORTAL_DRYRUN === "1";
    const result: any = { alreadyExists: false, submitted: false, programMissing: false };
    const wait = (ms: number) => page.waitForTimeout(ms);

    // ---- §0 Member gate: never push a non-member university into United ------
    if (!isUnitedMember(profile.universityName)) {
      logger.warn(
        `[united] SKIP — "${profile.universityName || "(none)"}" is not a United member ` +
        `(allowlist: ${UNITED_ALLOWLIST.join(" / ")}); routing to direct`,
      );
      result.skippedNotMember = true;
      result.routeTo = "direct";
      result.detail = "university not in United allowlist";
      return result;
    }

    // ---- §1 Instrumentation: capture the REAL create contract (redacted) ----
    // Attach BEFORE any navigation/submit so the final POST /Manage/newapplication
    // body (all field names + Salesforce ids) lands in the logs for Phase-2 replay.
    const netlog: Array<{ url: string; method: string; status: string; post: string }> = [];
    const onFinished = async (req: any) => {
      try {
        const url = String(req.url());
        if (!NETLOG_URL_RE.test(url)) return;
        const method = req.method();
        let post = "";
        if (method === "POST") { try { post = sanitizeBody((req.postData() || "").slice(0, 4000)); } catch {} }
        let status = ""; try { const res = await req.response(); status = res ? String(res.status()) : ""; } catch {}
        const shortUrl = url.split("?")[0];
        netlog.push({ url: shortUrl, method, status, post });
        logger.info(`[united][net] ${method} ${shortUrl} -> ${status}` + (post ? ` body=${post}` : ""));
      } catch {}
    };
    page.on("requestfinished", onFinished);

    // Select a native/select2 <select> by id. Waits for the option list to
    // populate (AJAX cascade), LOGS the option texts (first-run reality check),
    // and flexibly matches `want` (see looseMatchIndex). Fires change + select2
    // jQuery trigger so the next cascade step fetches. Returns true only when
    // `want` matched. For CRITICAL_SELECT_IDS it never auto-picks the first
    // option on a miss (would submit the wrong value) — only a lone real option.
    const selById = async (id: string, want?: string): Promise<boolean> => {
      try {
        const loc = page.locator("#" + id);
        if (!(await loc.count())) return false;
        // Wait for AJAX-populated options before matching (cascade).
        await page
          .waitForFunction((sid: string) => {
            const el = document.getElementById(sid) as any;
            return !!el && el.options && el.options.length > 0;
          }, id, { timeout: 12000 })
          .catch(() => {});
        const opts = (await loc.locator("option").allInnerTexts().catch(() => [])) as string[];
        logger.info(`[united] ${id} options(${opts.length}): ` + JSON.stringify(opts.slice(0, 40)));
        const isReal = (o: string) => !!o.trim() && !/^(please\s+)?(select|se\u00e7)/i.test(o.trim());
        const w = String(want || "").trim();
        let idx = -1, matched = false;
        if (w) { idx = looseMatchIndex(opts, w); if (idx >= 0) matched = true; }
        // No explicit target (e.g. selectlang/selectcampus): the cascade usually
        // pre-selects the program-derived value — respect it rather than guess or
        // stall. Keeps critical selectlang from blocking the Program→Personal step.
        if (idx < 0 && !w) {
          const sel = (await loc.evaluate((el: any) => el.selectedIndex).catch(() => -1)) as number;
          if (typeof sel === "number" && sel >= 0 && isReal(opts[sel] || "")) idx = sel;
        }
        if (idx < 0) {
          const realIdx = opts.map((o, i) => (isReal(o) ? i : -1)).filter((i) => i >= 0);
          if (!CRITICAL_SELECT_IDS.has(id)) idx = realIdx.length ? realIdx[0] : -1; // optional: first real
          else if (realIdx.length === 1) idx = realIdx[0];                          // critical + lone real: forced
          // critical + multiple options + no target/match → leave unselected
        }
        if (idx >= 0) {
          await page.evaluate(([sid, i]: [string, number]) => {
            const el: any = document.getElementById(sid);
            if (!el) return;
            el.selectedIndex = i;
            el.dispatchEvent(new Event("change", { bubbles: true }));
            const jq = (window as any).jQuery;
            if (jq) jq(el).trigger("change"); // select2
          }, [id, idx]);
          await wait(1200); // cascade AJAX
          logger.info(`[united] select ${id} -> index ${idx} "${opts[idx]}"${matched ? " (matched)" : " (fallback)"}`);
        } else {
          logger.warn(`[united] select ${id}: no match for "${w}" (left unselected)`);
        }
        return matched;
      } catch (e) { return false; }
    };
    // Scan all selects, pick the one with an option matching `re`, select it.
    const selByOpt = async (re: RegExp): Promise<boolean> => {
      try {
        const sels = page.locator("select");
        const n = await sels.count();
        for (let i = 0; i < n; i++) {
          const sl = sels.nth(i);
          const opts = (await sl.locator("option").allInnerTexts().catch(() => [])) as string[];
          const idx = opts.findIndex((o) => re.test(o));
          if (idx >= 0) { await sl.selectOption({ index: idx }).catch(() => {}); await wait(800); return true; }
        }
      } catch (e) {}
      return false;
    };
    // Read every <option> {value,text} of a select (for logging + matchProgram).
    const readOptions = async (id: string): Promise<Array<{ value: string; text: string }>> => {
      try {
        return (await page.$$eval(`#${id} option`, (opts: any[]) =>
          opts.map((o) => ({ value: String(o.value || ""), text: String(o.textContent || "").replace(/\s+/g, " ").trim() })),
        )) as Array<{ value: string; text: string }>;
      } catch { return []; }
    };
    const clickContinue = async (): Promise<boolean> => {
      let b = page.getByRole("button", { name: /continue|next|ileri|devam/i }).first();
      if (await b.count()) { await b.click({ timeout: 8000 }).catch(() => {}); await wait(2800); return true; }
      b = page.locator("button:has-text('Continue'), a:has-text('Continue'), input[value*='Continue' i]").first();
      if (await b.count()) { await b.click({ timeout: 8000 }).catch(() => {}); await wait(2800); return true; }
      return false;
    };

    try {
      await page.goto(PORTAL_URL + "/Manage/newapplication", { waitUntil: "domcontentloaded", timeout: 60000 });
      await wait(5000);
      const txt0 = (await page.evaluate("(()=>document.body?document.body.innerText:'')()")) as string;
      if (/already.*application|zaten.*basvuru/i.test(txt0)) { result.alreadyExists = true; logger.warn("[united] already has application"); return result; }

      // ---- §3 Dedup: GET /Account/searchapp?word=<email|name> --------------
      // Salesforce-backed search. Log ONLY the count + Id (never PII values).
      const searchWord = (profile.email || `${profile.firstName || ""} ${profile.lastName || ""}`).trim();
      let existingContactId = "";
      if (searchWord) {
        try {
          const res = await page.request.get(
            `${PORTAL_URL}/Account/searchapp?word=${encodeURIComponent(searchWord)}`,
            { timeout: 20000 },
          );
          const status = res.status();
          let json: any = null;
          try { json = await res.json(); } catch {}
          const total = typeof json?.totalSize === "number" ? json.totalSize : (Array.isArray(json?.records) ? json.records.length : 0);
          const rec0 = Array.isArray(json?.records) ? json.records[0] : null;
          existingContactId = String(rec0?.ContactId || rec0?.Id || "");
          logger.info(`[united] dedup searchapp -> status=${status} count=${total}` + (existingContactId ? ` id=${existingContactId}` : ""));
          if (total > 0) result.alreadyExists = true;
        } catch (e: any) {
          logger.warn("[united] dedup searchapp failed (continuing): " + (e?.message || e));
        }
      }

      // ---- §3 Registration type: New Student (Transfer when applicable) -----
      const isTransfer = /transfer/i.test(String((profile as any).studentType || (profile as any).registrationType || ""));
      const regMatched = await selById("regtype", isTransfer ? "Transfer" : "New Student");
      if (!regMatched) await selByOpt(/new student/i);
      // Destination (single-country portals default to Türkiye).
      await selByOpt(/t\u00fcrkiye|turkiye|turkey/i);
      // If dedup found an existing student, seed the Salesforce contact id so the
      // portal auto-fills / links personal info (best-effort; field may not exist yet).
      if (existingContactId) {
        try {
          const c = page.locator("#contactid");
          if (await c.count()) await c.fill(existingContactId).catch(() => {});
        } catch {}
      }
      await clickContinue();

      // ---- §2 Program cascade (select2, AJAX): -----------------------------
      //   #selectuniversity → /Manage/selectprogram → #selectprogram
      //   → /Manage/Degreelist → #selectdegree → #selectlang
      //   → /Manage/test1 → #selectcampus
      await selById("selectuniversity", profile.universityName);

      // Program: reuse programMatch (panel mappings + EN/TR synonyms) against the
      // LIVE dropdown so the fallback rule matches SIT's X/Y logic. Capture the
      // full option list for orchestrator fallback when nothing matches.
      await page
        .waitForFunction(() => ((document.getElementById("selectprogram") as any)?.options?.length ?? 0) > 0, { timeout: 15000 })
        .catch(() => {});
      const progOptions = await readOptions("selectprogram");
      logger.info("[united] selectprogram options: " + JSON.stringify(progOptions.map((o) => o.text).slice(0, 50)));
      let progMatched = false;
      if (profile.programName) {
        const candidates = progOptions
          .filter((o) => o.value && o.text && !/^(please\s+)?(select|se\u00e7)/i.test(o.text))
          .map((o) => ({ id: o.value, name: o.text }));
        const m = matchProgram(profile.programName, candidates, {
          nameMap: profile.programNameMap,
          nameMapGeneral: profile.programNameMapGeneral,
          synonyms: profile.programSynonyms,
        });
        if (m) {
          await page.evaluate(([v]: [string]) => {
            const el: any = document.getElementById("selectprogram");
            if (!el) return;
            el.value = v;
            el.dispatchEvent(new Event("change", { bubbles: true }));
            const jq = (window as any).jQuery; if (jq) jq(el).trigger("change");
          }, [m.match.id]);
          await wait(1200);
          progMatched = true;
          logger.info(`[united] selectprogram = "${m.match.name}" (conf ${m.conf.toFixed(2)})`);
        } else {
          // Flexible fallback: strip parenthetical qualifiers + token overlap
          // over the LIVE option TEXT (matchProgram's Jaccard is diluted by
          // United's "(Non-Thesis) (Turkish)" suffixes). Never auto-picks.
          const li = looseMatchIndex(progOptions.map((o) => o.text), profile.programName);
          const hit = li >= 0 ? progOptions[li] : undefined;
          if (hit?.value) {
            await page.evaluate(([v]: [string]) => {
              const el: any = document.getElementById("selectprogram");
              if (!el) return;
              el.value = v;
              el.dispatchEvent(new Event("change", { bubbles: true }));
              const jq = (window as any).jQuery; if (jq) jq(el).trigger("change");
            }, [hit.value]);
            await wait(1200);
            progMatched = true;
            logger.info(`[united] selectprogram = "${hit.text}" (loose match)`);
          }
        }
      }
      if (profile.programName && !progMatched) {
        result.programMissing = true;
        result.resolution = "not_in_dropdown";
        result.availablePrograms = progOptions
          .filter((o) => o.value && o.text)
          .map<PortalProgramOption>((o) => ({ value: o.value, name: o.text, enabled: true }));
        logger.warn(`[united] program not matched in dropdown: "${profile.programName}"`);
      }

      // Degree / language / campus cascade (each AJAX-driven). degree & lang are
      // critical (no wrong auto-pick); campus may default to its lone/first option.
      await selById("selectdegree", profile.level);
      await selById("selectlang");
      await selById("selectcampus");
      await clickContinue();
      await wait(2500);

      // We should now be at Personal Information.
      const atPersonal = await page.locator("#firstname, #lastname").first().count().catch(() => 0);
      if (dryRun) {
        result.dryReachedFinal = !!atPersonal;
        if (!atPersonal) { result.stuckStep = 3; result.stuckBody = (await page.evaluate("(()=>document.body?document.body.innerText:'')()")).replace(/\s+/g, " ").slice(0, 220); }
        logger.warn("[united] DRY: reached Program→Personal boundary (atPersonal=" + atPersonal + "); stopping before Personal Information — no student created");
        logger.info("[united] netlog summary: " + JSON.stringify(netlog.map((n) => ({ u: n.url, m: n.method, s: n.status }))));
        return result;
      }

      // ===== REAL submission (requires explicit approval; first-real gating handled by worker) =====
      // ---- §4 Personal information (validated field ids) -------------------
      const fill = async (id: string, v?: string) => { const l = page.locator("#" + id); if ((await l.count()) && v) await l.fill(String(v)).catch(() => {}); };
      await fill("firstname", profile.firstName);
      await fill("lastname", profile.lastName);
      await fill("fathername", (profile as any).fatherName);
      await fill("mothername", (profile as any).motherName);
      await fill("passport", profile.passportNumber);
      await fill("kimlik", (profile as any).nationalId); // foreigners: blank / passport
      await fill("phone11", String((profile as any).phone || "").replace(/^\+?90/, "")); // intl-tel-input strips +90
      await fill("SecondarySchoolName", (profile as any).lastSchool || profile.schoolName);
      await fill("dateInput", (profile as any).dob || profile.dateOfBirth); // DOB — format confirmed via first-run logs
      await selById("gender", (profile as any).gender || profile.gender || "Male");
      // Country dropdowns (233 countries): nationality + secondary-school country.
      await selById("ContentPlaceHolder1_DropDownList4", (profile as any).nationalityName || profile.nationality);
      await selById("ContentPlaceHolder1_DropDownList5", (profile as any).schoolCountryName);
      await clickContinue();

      // ---- §5 Documents — /Manage/uploadfilesone --------------------------
      // Order: passport → diploma/transcript → photo. Skip missing inputs; a
      // missing document must NOT drop the create.
      const fi = page.locator("input[type=file]"); const fn = await fi.count();
      const order = [(_files as any).passport, (_files as any).diploma, (_files as any).transcript, (_files as any).photo].filter(Boolean) as string[];
      for (let i = 0; i < fn; i++) { const fp = order[i] || (_files as any).passport; if (fp) await fi.nth(i).setInputFiles(fp).catch(() => {}); }
      await clickContinue();
      await wait(2500);

      // ---- §6 Final submit -------------------------------------------------
      const finalBtn = page.getByRole("button", { name: /submit|finish|complete application|tamamla|g\u00f6nder|onayla/i }).first();
      if (await finalBtn.count()) {
        await finalBtn.click({ timeout: 8000 }).catch(() => {});
        await wait(6000);
        const done = (await page.evaluate("(()=>document.body?document.body.innerText:'')()")) as string;
        if (/successfully|application (submitted|created|completed)|ba\u015fvurunuz al\u0131nm/i.test(done)) {
          result.submitted = true;
          // Salesforce app id from #appid or the URL (e.g. a0v...).
          let appId = "";
          try { const a = page.locator("#appid"); if (await a.count()) appId = String(await a.inputValue().catch(() => "")); } catch {}
          if (!appId) { const mUrl = /[?&](appid|id)=([a-z0-9]+)/i.exec(String(page.url())); if (mUrl) appId = mUrl[2]; }
          if (appId) { result.externalRef = appId; logger.info("[united] externalRef (Salesforce app id) = " + appId); }
        }
      }
    } catch (e: any) { result.error = e.message; }
    finally {
      try { page.off("requestfinished", onFinished); } catch {}
    }
    logger.info("[united] netlog summary: " + JSON.stringify(netlog.map((n) => ({ u: n.url, m: n.method, s: n.status }))));
    logger.info("[united] submit " + JSON.stringify(result));
    return result;
  },
};
