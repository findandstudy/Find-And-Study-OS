// ---------------------------------------------------------------------------
// Altınbaş University — Salesforce Screen Flow REPLAY adapter
//
// Portal: https://apply.altinbas.edu.tr/partner/s/
// Technology: Salesforce Experience Cloud (Screen Flow)
//
// SCOPE: Master (Yüksek Lisans) + PhD (Doktora) ONLY.
//   Associate / Bachelor gelirse → skipped (never silent-fail).
//
// MİMARİ (Faz-4, canlı yakalanan kontrat 2026-07-10):
//   Wizard bir Salesforce Screen Flow. Her ekran geçişi
//   POST /partner/s/sfsites/aura → FlowRuntimeConnectController.navigateFlow:
//     { action: NEXT | CONTINUE_AFTER_COMMIT | FINISH,
//       serializedState: <~90KB ŞİFRELİ, server-chained — ASLA elle kurulmaz>,
//       fields: [ {field, value, isVisible}, ... ] }  // DÜZ METİN — biz yazarız
//
//   serializedState şifreli + zincirli olduğu için adaptör CANLI login'li
//   tarayıcıda çalışır: login → applicant → "Create New Application" flow'u
//   boot eder (serializedState applicant context'i kazanır), interceptor her
//   yanıttan EN GÜNCEL serializedState'i tutar, ekranlar Next'e TIKLAMADAN
//   page.evaluate(fetch) ile replay edilir. Kapalı-shadow DOM ve koordinat YOK.
//
//   Sıra: Term(NEXT) → Degree(NEXT) → Program(NEXT) →
//         CONTINUE_AFTER_COMMIT(×N, fields:[]) → Personal(NEXT) →
//         Educational(NEXT) → Questionnaire(NEXT) → Documents(NEXT) → FINISH.
//
//   FINISH + ContentVersion (belge upload) payload'ları henüz canlı
//   yakalanmadı — ALTINBAS_CAPTURE=1 ile ilk gerçek run'da tüm aura
//   request/response'ları /tmp/altinbas-capture.json'a dökülür.
//
// Duplicate-passport guard: aynı passport+term+degree ile 2. başvuru portal
// tarafından ENGELLENİR → SKIPPED_DUPLICATE (alreadyExists=true, FAIL değil).
//
// Dry-run: doSubmit=false Documents'a kadar replay eder, FINISH GÖNDERMEZ.
// ---------------------------------------------------------------------------

import { appendFileSync } from "node:fs";

import type {
  UniversityAdapter,
  AdapterSession,
  SubmitProfile,
  SubmitFiles,
  SubmitResult,
  LoginOpts,
  ProgramOption,
  PortalProgramOption,
} from "../../types.js";
import { launchPortal, logger } from "../../browser.js";
import { portalCreds } from "../../portalCreds.js";
import { fold } from "../../programMatch.js";
import {
  type FlowField,
  type FlowIds,
  buildTermFields,
  buildDegreeFields,
  buildProgramFields,
  buildPersonalFields,
  buildEducationalFields,
  buildQuestionnaireFields,
  buildDocumentsFields,
} from "./flow-fields.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ADAPTER_KEY   = "altinbas";
const PORTAL_URL    = "https://apply.altinbas.edu.tr/partner/s/";
const APP_FORM_URL  = PORTAL_URL + "application-form";
const SESSION_STATE = "/tmp/altinbas-portal-state.json";

/** Levels this adapter accepts. Everything else → skipped. */
const ACCEPTED_LEVELS = new Set(["master", "phd", "doctorate", "doktora", "yüksek lisans", "yuksek lisans"]);

// Salesforce LWC hydration is slow — never use networkidle on SF pages.
const SF_HYDRATION_MS = 8000;

// ALTINBAS_CAPTURE=1 → TÜM /sfsites/aura request+response gövdeleri logger'a
// (kırpılmış) ve /tmp/altinbas-capture.json'a (tam, JSON-lines) dökülür.
const CAPTURE = process.env.ALTINBAS_CAPTURE === "1";
const CAPTURE_FILE = "/tmp/altinbas-capture.json";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalise a level string for the guard check. */
function normLevel(level: string): string {
  return level.trim().toLowerCase();
}

/** True when this level is accepted by Altınbaş adapter. */
function isAcceptedLevel(level: string): boolean {
  return ACCEPTED_LEVELS.has(normLevel(level));
}

/** Snapshot the current screen. Returns the /tmp path or null. */
async function captureScreen(
  page: any,
  tag: string,
): Promise<string | null> {
  try {
    const path = `/tmp/altinbas-capture-${tag}-${Date.now()}.png`;
    await page.screenshot({ path, fullPage: false });
    return path;
  } catch {
    return null;
  }
}

/** Click the Next / Continue button (yalnız Step-1 Basic Info'da kullanılır). */
async function clickNext(page: any): Promise<boolean> {
  const btn = page.getByRole("button", {
    name: /^\s*(next|continue|ileri|sonraki|devam)\s*$/i,
  }).first();
  if (await btn.count()) {
    await btn.click({ timeout: 30000 }).catch(() => {});
    return true;
  }
  return false;
}

/**
 * Salesforce Experience Cloud occasionally shows a "Sorry to interrupt" /
 * "CSS Error" dialog (static-resource hiccup). Dismiss it without ever
 * blocking the flow: prefer "Refresh" (reloads application-form?nocache=…),
 * else "Cancel and close". Always wrapped so callers can fire-and-forget.
 */
async function dismissSfError(page: any): Promise<void> {
  try {
    const dialog = page.getByRole("dialog").filter({
      hasText: /sorry to interrupt|css error/i,
    });
    if (!(await dialog.count().catch(() => 0))) return;

    logger.info("[altinbas] dismissSfError: Salesforce error dialog detected");
    const refreshBtn = dialog.getByRole("button", { name: /refresh/i }).first();
    if (await refreshBtn.count().catch(() => 0)) {
      await refreshBtn.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(3000);
      return;
    }

    const closeBtn = dialog
      .getByRole("button", { name: /cancel and close|close/i })
      .first();
    if (await closeBtn.count().catch(() => 0)) {
      await closeBtn.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(1000);
    }
  } catch {
    /* never block the flow on this */
  }
}

/**
 * Fill a Salesforce Experience Cloud combobox/typeahead field by visible
 * label, then pick the best-matching option from the resulting listbox.
 * Used for Citizenship on the Basic Info step.
 */
async function pickCombobox(
  page: any,
  labelPattern: RegExp,
  searchTerm: string,
): Promise<boolean> {
  if (!searchTerm) return false;
  try {
    let box = page.getByLabel(labelPattern).first();
    if (!(await box.count().catch(() => 0))) {
      // Fallback: nearby role=combobox / typeahead input
      box = page
        .locator("input[role=combobox], input[aria-autocomplete=list], input[aria-autocomplete=both]")
        .first();
    }
    if (!(await box.count().catch(() => 0))) {
      logger.warn(`[altinbas] pickCombobox: no input found for ${labelPattern}`);
      return false;
    }

    await box.click({ timeout: 8000 }).catch(() => {});
    await box.fill("").catch(() => {});
    await box.fill(searchTerm).catch(() => {});
    await page.waitForTimeout(1500);

    const optSel = "[role=option], lightning-base-combobox-item, .slds-listbox__option, li[role=option]";
    await page.waitForSelector(optSel, { timeout: 8000 }).catch(() => {});
    const opts = page.locator(optSel);
    const optCount = await opts.count().catch(() => 0);
    if (!optCount) {
      logger.warn(`[altinbas] pickCombobox: no options appeared for "${searchTerm}"`);
      return false;
    }

    const searchFold = fold(searchTerm);
    for (let i = 0; i < optCount; i++) {
      const txt = ((await opts.nth(i).innerText().catch(() => "")) || "").trim();
      const optFold = fold(txt);
      if (optFold === searchFold || optFold.startsWith(searchFold) || optFold.includes(searchFold)) {
        await opts.nth(i).click({ timeout: 5000 }).catch(() => {});
        logger.info(`[altinbas] pickCombobox: picked "${txt}" for "${searchTerm}"`);
        await page.waitForTimeout(500);
        return true;
      }
    }

    logger.warn(`[altinbas] pickCombobox: no matching option for "${searchTerm}" (options seen: ${optCount})`);
    return false;
  } catch (e) {
    logger.warn(`[altinbas] pickCombobox error for "${searchTerm}":`, e);
    return false;
  }
}

/**
 * SLDS faux radio: plain check()/click() silently no-ops. Force-check with
 * change dispatch + faux-label fallback. (Student-grid row selection.)
 */
async function forceCheckRadio(page: any, locator: any): Promise<boolean> {
  await locator.check({ force: true, timeout: 5000 }).catch(async () => {
    await locator.click({ force: true, timeout: 5000 }).catch(() => {});
  });
  await locator.dispatchEvent("change").catch(() => {});
  let checked = await locator.isChecked().catch(() => false);
  if (!checked) {
    const faux = locator.locator(
      "xpath=ancestor::*[self::td or self::div or self::label][1]//*[contains(@class,'slds-radio_faux') or contains(@class,'slds-radio__label')]",
    ).first();
    if (await faux.count().catch(() => 0)) {
      await faux.click({ force: true, timeout: 4000 }).catch(() => {});
      checked = await locator.isChecked().catch(() => false);
    }
  }
  return checked;
}

// ---------------------------------------------------------------------------
// FLOW REPLAY — interceptor + navigateFlow driver
// ---------------------------------------------------------------------------

interface FlowTemplate {
  origin: string;
  context: string;
  token: string;
  pageURI: string;
}

interface FlowRuntime {
  template: FlowTemplate | null;
  /** En güncel serializedState — HER yanıttan güncellenir, ASLA elle kurulmaz. */
  state: string | null;
  lastRaw: string;
  /** Yanıtlardan toplanan Id'li kayıtlar (Term/Degree/Program adayları), Id → record. */
  records: Map<string, Record<string, unknown>>;
  ids: FlowIds;
  reqCounter: number;
}

function newFlowRuntime(): FlowRuntime {
  return {
    template: null,
    state: null,
    lastRaw: "",
    records: new Map(),
    ids: {},
    reqCounter: 100,
  };
}

/** ALTINBAS_CAPTURE=1 dump — logger (kırpılmış) + /tmp/altinbas-capture.json (tam). */
function captureDump(kind: string, url: string, body: string): void {
  if (!CAPTURE) return;
  try {
    appendFileSync(
      CAPTURE_FILE,
      JSON.stringify({ ts: new Date().toISOString(), kind, url, body }) + "\n",
    );
  } catch {
    /* capture asla akışı kırmaz */
  }
  logger.info(`[altinbas][capture] ${kind} ${url.slice(0, 140)} :: ${body.slice(0, 1200)}`);
}

/**
 * Bir aura yanıtını sindir: en güncel serializedState, Id'li kayıtlar
 * (Term/Degree/Program adayları) ve applicant/application/account/contact
 * Id'leri çıkar.
 */
function ingestFlowResponse(rt: FlowRuntime, raw: string): void {
  if (!raw) return;
  rt.lastRaw = raw;

  const states: string[] = [];

  const walk = (n: unknown): void => {
    if (Array.isArray(n)) {
      for (const x of n) walk(x);
      return;
    }
    if (n && typeof n === "object") {
      const o = n as Record<string, unknown>;
      const ss = o["serializedState"];
      if (typeof ss === "string" && ss.length > 200) states.push(ss);

      const id = o["Id"];
      if (typeof id === "string" && /^[a-zA-Z0-9]{15,18}$/.test(id)) {
        rt.records.set(id, o);
      }

      for (const key of ["applicantId", "applicationId", "accountId", "contactId"] as const) {
        const v = o[key];
        if (typeof v === "string" && /^[a-zA-Z0-9]{15,18}$/.test(v)) rt.ids[key] = v;
      }

      for (const v of Object.values(o)) walk(v);
    }
  };

  const start = raw.indexOf("{");
  if (start >= 0) {
    try {
      walk(JSON.parse(raw.slice(start)));
    } catch {
      /* JSON parse edilemedi — regex fallback aşağıda */
    }
  }

  if (!states.length) {
    // Regex fallback: JSON parse edilemeyen gövdeden serializedState çek.
    const re = /"serializedState"\s*:\s*"((?:[^"\\]|\\.){200,}?)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw)) !== null) {
      try {
        states.push(JSON.parse(`"${m[1]}"`) as string);
      } catch {
        states.push(m[1]);
      }
    }
  }

  // Id prefix'lerinden applicant/application çıkarımı (003=Contact, 001=Account, a02=Application__c)
  for (const id of rt.records.keys()) {
    if (id.startsWith("003") && !rt.ids.contactId) { rt.ids.contactId = id; rt.ids.applicantId = rt.ids.applicantId ?? id; }
    if (id.startsWith("001") && !rt.ids.accountId) rt.ids.accountId = id;
    if (id.startsWith("a02") && !rt.ids.applicationId) rt.ids.applicationId = id;
  }

  if (states.length) {
    // Son (en güncel) state kazanır.
    rt.state = states[states.length - 1];
  }
}

/**
 * Interceptor: TÜM /sfsites/aura trafiğini dinle.
 *  - request: aura.context / aura.token / aura.pageURI template'ini yakala
 *    (SIT token-replay deseni — sonraki replay'lerde aynen kullanılır).
 *  - response: en güncel serializedState + kayıtlar + Id'ler.
 * "Create New Application" tıklanmadan ÖNCE kurulmalı ki flow-boot yanıtı
 * (ilk serializedState) kaçmasın.
 */
function setupFlowInterceptor(page: any, rt: FlowRuntime): void {
  page.on("request", (req: any) => {
    try {
      const url: string = req.url();
      if (!url.includes("/sfsites/aura")) return;
      const post: string = (req.postData() as string | null) || "";
      if (!post.includes("aura.token")) return;
      // Capture dump = TÜM aura trafiği (kontrat gereği); template/state ise
      // SADECE FlowRuntimeConnectController trafiğinden — arka plan Aura
      // çağrıları zincirlenmiş state'i/template'i bozamasın.
      captureDump("browser-request", url, post);
      if (!post.includes("FlowRuntimeConnectController")) return;
      const p = new URLSearchParams(post);
      const context = p.get("aura.context") || "";
      const token = p.get("aura.token") || "";
      const pageURI = p.get("aura.pageURI") || "/partner/s/application-form";
      if (context && token) {
        rt.template = { origin: new URL(url).origin, context, token, pageURI };
      }
    } catch {
      /* interceptor asla akışı kırmaz */
    }
  });

  page.on("response", (res: any) => {
    void (async () => {
      try {
        const url: string = res.url();
        if (!url.includes("/sfsites/aura")) return;
        const reqPost: string = (res.request()?.postData?.() as string | null) || "";
        const raw: string = await res.text().catch(() => "");
        if (!raw) return;
        captureDump("browser-response", url, raw);
        // Yalnız flow-controller yanıtları state'e sindirilir.
        if (!reqPost.includes("FlowRuntimeConnectController")) return;
        ingestFlowResponse(rt, raw);
      } catch {
        /* interceptor asla akışı kırmaz */
      }
    })();
  });
}

/** Yanıttaki (son) currentStage değerini oku — ekran doğrulama/log için. */
function readStageFromRaw(raw: string): string | null {
  let stage: string | null = null;
  const re = /"currentStage"\s*:\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) stage = m[1];
  return stage;
}

/**
 * Gövde gerçekten bir aura action yanıtı mı? (HTML login sayfası, edge 403
 * HTML'i vb. değil.) JSON parse + actions[] varlığı aranır.
 */
function isAuraResponse(raw: string): boolean {
  const start = raw.indexOf("{");
  if (start < 0) return false;
  try {
    const o = JSON.parse(raw.slice(start)) as Record<string, unknown>;
    return Array.isArray(o["actions"]) || typeof o["events"] === "object";
  } catch {
    return false;
  }
}

/** Aura/flow hata sinyali (state:ERROR, exceptionEvent, errors[]). */
function flowHasError(raw: string): boolean {
  return /"state"\s*:\s*"ERROR"|"exceptionEvent"\s*:\s*true|"errors"\s*:\s*\[\s*\{/.test(raw);
}

/** Aura action state:SUCCESS içeriyor mu? (FINISH başarı kanıtının parçası.) */
function auraActionSucceeded(raw: string): boolean {
  return /"state"\s*:\s*"SUCCESS"/.test(raw);
}

/** Duplicate-passport guard mesajı (SKIPPED_DUPLICATE — fail DEĞİL). */
function isDuplicatePassport(raw: string): boolean {
  return /application with this passport|passport number already|already an application|Prevent_Duplicate_Passport/i.test(raw);
}

/**
 * navigateFlow REPLAY: Next'e tıklamadan, canlı sayfa context'inde fetch ile
 * POST at. serializedState = SON yanıttan (rt.state); aura.context/token/
 * pageURI = yakalanan template'ten. Yanıt sindirilir (yeni state).
 */
async function postNavigateFlow(
  page: any,
  rt: FlowRuntime,
  action: "NEXT" | "CONTINUE_AFTER_COMMIT" | "FINISH",
  fields: FlowField[],
  tag: string,
): Promise<string> {
  if (!rt.template) throw new Error("[altinbas] flow template yok — hiç aura request yakalanmadı");
  if (!rt.state) throw new Error("[altinbas] serializedState yok — flow boot yanıtı yakalanamadı");

  rt.reqCounter += 1;
  const message = JSON.stringify({
    actions: [
      {
        id: `${rt.reqCounter};a`,
        descriptor: "aura://FlowRuntimeConnectController/ACTION$navigateFlow",
        callingDescriptor: "UNKNOWN",
        params: { request: { action, serializedState: rt.state, fields } },
      },
    ],
  });

  const params = new URLSearchParams();
  params.set("message", message);
  params.set("aura.context", rt.template.context);
  params.set("aura.pageURI", rt.template.pageURI);
  params.set("aura.token", rt.template.token);

  const url = `${rt.template.origin}/partner/s/sfsites/aura?r=${rt.reqCounter}&other.FlowRuntimeConnectController.navigateFlow=1`;
  captureDump("replay-request", url, params.toString());

  const resp: { status: number; text: string } = await page.evaluate(
    async (a: { url: string; body: string }) => {
      const res = await fetch(a.url, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
        body: a.body,
      });
      return { status: res.status, text: await res.text() };
    },
    { url, body: params.toString() },
  );

  const raw = resp.text;
  captureDump("replay-response", url, raw);

  if (resp.status < 200 || resp.status >= 300) {
    throw new Error(
      `[altinbas] navigateFlow[${tag}] HTTP ${resp.status}: ${raw.replace(/\s+/g, " ").slice(0, 300)}`,
    );
  }
  if (!isAuraResponse(raw)) {
    // HTML login sayfası / edge hatası vb. — aura yanıtı DEĞİL, state'e sindirme.
    throw new Error(
      `[altinbas] navigateFlow[${tag}] yanıt aura JSON değil (session düşmüş olabilir): ${raw.replace(/\s+/g, " ").slice(0, 300)}`,
    );
  }

  ingestFlowResponse(rt, raw);

  const stage = readStageFromRaw(raw);
  logger.info(
    `[altinbas] navigateFlow[${tag}] action=${action} nf=${fields.length} → status=${resp.status} stage=${stage ?? "?"} err=${flowHasError(raw)} dup=${isDuplicatePassport(raw)} len=${raw.length}`,
  );
  return raw;
}

// ---------------------------------------------------------------------------
// Flow kayıtlarından Term / Degree / Program seçimi
// ---------------------------------------------------------------------------

/** Kayıttaki tüm string değerleri tek metinde birleştir (eşleme için). */
function recordText(r: Record<string, unknown>): string {
  return Object.values(r)
    .filter((v): v is string => typeof v === "string")
    .join(" | ");
}

/** Kayıttan insan-okur görünen ad çıkar (Name > label > en uzun harfli string). */
function recordDisplayName(r: Record<string, unknown>): string {
  for (const key of ["Name", "label", "MasterLabel"]) {
    const v = r[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  let best = "";
  for (const v of Object.values(r)) {
    if (typeof v === "string" && /[A-Za-zÇĞİÖŞÜçğıöşü]{3,}/.test(v) && v.length > best.length && v.length < 120) {
      best = v;
    }
  }
  return best || String(r["Id"] ?? "?");
}

/**
 * Term seçimi: flow'a önceden yüklü Term kayıtları (Id prefix a0C) içinden
 * "Fall 2026 - 2027" benzeri etiketli olanları bul, EN YÜKSEK yılı seç.
 */
function pickTermOption(rt: FlowRuntime): { label: string; id: string } | null {
  const YEAR_RANGE = /(?:fall|spring|summer|güz|bahar|yaz)?\s*\d{4}\s*-\s*\d{4}/i;
  const cands: Array<{ label: string; id: string; year: number }> = [];
  for (const [id, r] of rt.records) {
    if (!id.startsWith("a0C")) continue;
    for (const v of Object.values(r)) {
      if (typeof v === "string" && YEAR_RANGE.test(v)) {
        const years = v.match(/\d{4}/g) || [];
        const year = Math.max(...years.map(Number), 0);
        cands.push({ label: v.trim(), id, year });
        break;
      }
    }
  }
  if (!cands.length) return null;
  cands.sort((a, b) => b.year - a.year);
  logger.info(`[altinbas] term adayları: ${cands.map((c) => `${c.label}(${c.id})`).join(", ")}`);
  return { label: cands[0].label, id: cands[0].id };
}

/**
 * Degree seçimi: a0C kayıtları içinden profile.level'e göre Master ya da
 * PhD/Doctorate etiketlisini bul.
 */
function pickDegreeOption(rt: FlowRuntime, level: string): { label: string; id: string } | null {
  const wantPhd = /phd|doctor|doktora/i.test(level);
  const re = wantPhd ? /^(phd|doctorate|ph\.?\s*d)/i : /^master/i;
  for (const [id, r] of rt.records) {
    if (!id.startsWith("a0C")) continue;
    for (const v of Object.values(r)) {
      if (typeof v === "string" && re.test(v.trim())) {
        return { label: v.trim(), id };
      }
    }
  }
  return null;
}

/**
 * Program seçimi: eligible-program listesi (eduhub__Program__c taşıyan ya da
 * Id prefix a0A kayıtlar) içinden CRM program adıyla kelime-bazlı eşleşen
 * EN YÜKSEK skorlu kaydı döndür. Bulunamazsa aday listesi de döner
 * (programMissing + availablePrograms → fallback orchestration).
 */
function pickProgramRecord(
  rt: FlowRuntime,
  profile: SubmitProfile,
): { record: Record<string, unknown> | null; candidates: PortalProgramOption[] } {
  const cands: Array<{ record: Record<string, unknown>; id: string }> = [];
  for (const [id, r] of rt.records) {
    if (id.startsWith("a0A") || typeof r["eduhub__Program__c"] === "string") {
      cands.push({ record: r, id });
    }
  }

  const candidates: PortalProgramOption[] = cands.map((c) => ({
    value: c.id,
    name: recordDisplayName(c.record),
    enabled: true,
  }));

  const queryWords = fold(profile.programName || "")
    .split(/\s+/)
    .filter((w) => w.length > 3);
  if (!queryWords.length || !cands.length) {
    logger.warn(
      `[altinbas] program eşleme: aday=${cands.length} queryWords=${queryWords.length} ("${profile.programName}")`,
    );
    return { record: null, candidates };
  }

  let best: { record: Record<string, unknown>; score: number; id: string } | null = null;
  for (const c of cands) {
    const txt = fold(recordText(c.record));
    let score = 0;
    for (const w of queryWords) if (txt.includes(w)) score += 1;
    if (score > 0 && (!best || score > best.score)) best = { record: c.record, score, id: c.id };
  }

  if (best) {
    logger.info(
      `[altinbas] program eşleşti: "${recordDisplayName(best.record)}" (Id=${best.id}, skor=${best.score}/${queryWords.length})`,
    );
    return { record: best.record, candidates };
  }

  logger.warn(
    `[altinbas] program BULUNAMADI: "${profile.programName}" — adaylar: ${candidates
      .map((c) => c.name)
      .slice(0, 30)
      .join("; ")}`,
  );
  return { record: null, candidates };
}

// ---------------------------------------------------------------------------
// Flow replay sürücüsü — Term → Degree → Program → commit → Personal →
// Educational → Questionnaire → Documents → FINISH
// ---------------------------------------------------------------------------
async function runFlowReplay(
  page: any,
  rt: FlowRuntime,
  profile: SubmitProfile,
  files: SubmitFiles,
  dryRun: boolean,
  result: SubmitResult,
  screenshots: string[],
): Promise<void> {
  // 1) Flow boot'unu bekle: Create New Application yanıtı ilk serializedState'i getirir.
  for (let t = 0; t < 45 && (!rt.state || !rt.template); t++) {
    await page.waitForTimeout(1000);
  }
  if (!rt.state || !rt.template) {
    result.detail =
      "Altınbaş: flow boot yakalanamadı — serializedState/template yok (Create New Application flow'u başlatmadı mı?)";
    logger.warn(`[altinbas] ${result.detail}`);
    const shot = await captureScreen(page, "flow-boot-missing");
    if (shot) screenshots.push(shot);
    return;
  }
  logger.info(
    `[altinbas] flow boot OK: stateLen=${rt.state.length} records=${rt.records.size} bootStage=${readStageFromRaw(rt.lastRaw) ?? "?"}`,
  );

  /** Yanıtı denetle: duplicate → SKIPPED_DUPLICATE; ERROR → fail-visible detail. true = DUR. */
  const guard = (raw: string, tag: string): boolean => {
    if (isDuplicatePassport(raw)) {
      result.alreadyExists = true;
      result.detail =
        "Altınbaş: SKIPPED_DUPLICATE — aynı passport+term+degree ile başvuru zaten var (portal duplicate guard)";
      logger.info(`[altinbas] ${result.detail} (@${tag})`);
      return true;
    }
    if (flowHasError(raw)) {
      result.detail = `Altınbaş flow ERROR @${tag}: ${raw.replace(/\s+/g, " ").slice(0, 500)}`;
      logger.warn(`[altinbas] ${result.detail}`);
      return true;
    }
    return false;
  };

  // 2) TERM (NEXT)
  const term = pickTermOption(rt);
  if (!term) {
    logger.warn("[altinbas] Term kaydı bulunamadı — TermSelector alansız NEXT deneniyor (default term varsayımı)");
  } else {
    logger.info(`[altinbas] Term: "${term.label}" (${term.id})`);
  }
  let raw = await postNavigateFlow(page, rt, "NEXT", term ? buildTermFields(term) : [], "term");
  if (guard(raw, "Term")) return;

  // 3) DEGREE (NEXT)
  const degree = pickDegreeOption(rt, profile.level || "");
  if (!degree) {
    result.detail = `Altınbaş: Degree seçeneği bulunamadı (level="${profile.level}") — flow kayıtlarında Master/PhD etiketi yok`;
    logger.warn(`[altinbas] ${result.detail}`);
    return;
  }
  logger.info(`[altinbas] Degree: "${degree.label}" (${degree.id})`);
  raw = await postNavigateFlow(page, rt, "NEXT", buildDegreeFields(degree), "degree");
  if (guard(raw, "Degree")) return;

  // 4) PROGRAM (NEXT) — eligible listeden eşle
  const { record: prog, candidates } = pickProgramRecord(rt, profile);
  if (!prog) {
    result.programMissing = true;
    result.detail = `Altınbaş: program eligible listede bulunamadı: "${profile.programName}"`;
    if (candidates.length) {
      result.resolution = "not_in_dropdown";
      result.availablePrograms = candidates;
      result.requestedProgram = { name: profile.programName };
    }
    return;
  }
  raw = await postNavigateFlow(page, rt, "NEXT", buildProgramFields(prog), "program");
  if (guard(raw, "Program")) return;

  // 5) CONTINUE_AFTER_COMMIT (×N, fields:[]) — başvuru kaydı burada OLUŞUR.
  for (let i = 0; i < 4 && !/Personal Information/i.test(raw); i++) {
    raw = await postNavigateFlow(page, rt, "CONTINUE_AFTER_COMMIT", [], `commit${i + 1}`);
    if (guard(raw, `commit${i + 1}`)) return;
  }
  if (!/Personal Information/i.test(raw)) {
    logger.warn(
      `[altinbas] commit sonrası Personal Information görünmedi (stage=${readStageFromRaw(raw) ?? "?"}) — yine de devam ediliyor`,
    );
  }
  if (rt.ids.applicationId) {
    logger.info(`[altinbas] applicationId=${rt.ids.applicationId} applicantId=${rt.ids.applicantId ?? "?"}`);
  }

  // 6) PERSONAL (NEXT) — 46 alan; ISO tarih + 3'lü ülke picklist + kod-prefix telefon
  raw = await postNavigateFlow(page, rt, "NEXT", buildPersonalFields(profile), "personal");
  if (guard(raw, "Personal")) return;

  // 7) EDUCATIONAL (NEXT) — boş listeler + ID binding'leri
  raw = await postNavigateFlow(page, rt, "NEXT", buildEducationalFields(rt.ids), "educational");
  if (guard(raw, "Educational")) return;

  // 8) QUESTIONNAIRE (NEXT) — cevap şekli henüz yakalanmadı; boş dene.
  raw = await postNavigateFlow(page, rt, "NEXT", buildQuestionnaireFields(), "questionnaire");
  if (guard(raw, "Questionnaire")) return;

  // 9) DOCUMENTS (NEXT) — ContentVersion upload HENÜZ yakalanmadı; belgesiz geç.
  const wanted: Array<[string, string | undefined]> = [
    ["photo", files.photo],
    ["passport", files.passport],
    ["transcript", files.transcript],
    ["diploma", files.diploma],
  ];
  const missing = wanted.filter(([, p]) => !p).map(([t]) => t);
  logger.info(
    `[altinbas] Documents: ContentVersion upload henüz replay edilmiyor (ilk ALTINBAS_CAPTURE=1 run'ında yakalanacak); eldeki dosyalar: ${wanted
      .filter(([, p]) => p)
      .map(([t]) => t)
      .join(", ") || "yok"}`,
  );
  if (missing.length) result.missingDocuments = missing;
  raw = await postNavigateFlow(page, rt, "NEXT", buildDocumentsFields(), "documents");
  if (guard(raw, "Documents")) return;

  // 10) FINISH — dry-run'da GÖNDERİLMEZ.
  if (dryRun) {
    result.detail = "Altınbaş: dry-run — flow Documents'a kadar replay edildi, FINISH GÖNDERİLMEDİ";
    logger.info(`[altinbas] ${result.detail}`);
    return;
  }
  raw = await postNavigateFlow(page, rt, "FINISH", [], "finish");
  if (guard(raw, "FINISH")) return;

  // FINISH başarı kanıtı: HTTP 2xx + aura JSON (postNavigateFlow garanti eder)
  // YETMEZ — aura action state:SUCCESS da şart. Aksi halde fail-visible.
  if (!auraActionSucceeded(raw)) {
    result.detail = `Altınbaş: FINISH yanıtında state:SUCCESS yok — başarı SAYILMADI: ${raw.replace(/\s+/g, " ").slice(0, 500)}`;
    logger.warn(`[altinbas] ${result.detail}`);
    return;
  }

  result.submitted = true;
  if (rt.ids.applicationId) result.externalRef = rt.ids.applicationId;
  result.detail = `Altınbaş: FINISH gönderildi, aura state:SUCCESS (flow replay)${rt.ids.applicationId ? ` — applicationId=${rt.ids.applicationId}` : ""}`;
  logger.info(`[altinbas] ${result.detail}`);
}

// ---------------------------------------------------------------------------
// Application-form navigation helper
//
// Salesforce Experience Cloud SPA: a cold goto(application-form) is
// redirected by the route-guard back to Home — hard-goto to the deep route
// must NEVER be used. The only reliable path is a click-through SPA
// navigation: Home → "APPLY NOW" (client nav) → Basic Info form.
// ---------------------------------------------------------------------------

/** True once the Basic Info ("Application Form") screen has hydrated. */
async function onWizard(page: any): Promise<boolean> {
  try {
    // "Applicant Email" is unique to the Basic Info form — the most
    // reliable anchor for this Salesforce Experience Cloud screen.
    const emailBox = page.getByLabel(/applicant email/i);
    return (await emailBox.count().catch(() => 0)) > 0;
  } catch {
    return false;
  }
}

async function tryGoto(page: any): Promise<void> {
  // Boot on portal Home first.
  await page
    .goto(PORTAL_URL, { waitUntil: "domcontentloaded", timeout: 60000 })
    .catch(() => {});
  await page.waitForTimeout(SF_HYDRATION_MS);
  await dismissSfError(page);

  if (await onWizard(page)) return;

  // Click "APPLY NOW" (SPA nav) — try role=button, then role=link, then a
  // generic text-match fallback. Hard goto(APP_FORM_URL) is intentionally
  // NOT used here: it gets bounced back to Home by the route guard.
  const candidates = [
    page.getByRole("button", { name: /apply now/i }),
    page.getByRole("link", { name: /apply now/i }),
    page.locator("button, a, [role=button]").filter({ hasText: /apply now/i }),
  ];

  for (const cand of candidates) {
    const loc = cand.first();
    if (await loc.count().catch(() => 0)) {
      await loc.scrollIntoViewIfNeeded().catch(() => {});
      await loc.click({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(4000);
      await dismissSfError(page);
      break;
    }
  }

  // Poll up to 30s for the Basic Info form to appear.
  for (let t = 0; t < 30 && !(await onWizard(page)); t++) {
    await page.waitForTimeout(1000);
  }
}

async function navigateToAppForm(page: any): Promise<void> {
  // With a valid session the wizard loads directly; APPLY NOW is absent on Home in automated sessions. direct goto to the wizard.
  for (let d = 0; d < 3 && !(await onWizard(page)); d++) {
    await page.goto(APP_FORM_URL, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(SF_HYDRATION_MS);
    await dismissSfError(page);
  }
  if (await onWizard(page)) return;
  for (let attempt = 0; attempt < 3 && !(await onWizard(page)); attempt++) {
    logger.info(`[altinbas] navigateToAppForm: attempt ${attempt + 1}/3`);
    await tryGoto(page);
  }
  logger.info(`[altinbas] navigateToAppForm: onWizard=${await onWizard(page)}`);
}

// ---------------------------------------------------------------------------
// Step 1: Basic Information (DOM ile doldurulan TEK ekran — flow'dan ÖNCE)
//
// Fields seen: First Name*, Last Name*, Citizenship* (lookup), Passport Number*, Applicant Email*
// ---------------------------------------------------------------------------
async function fillStep1(page: any, profile: SubmitProfile): Promise<void> {
  logger.info("[altinbas] Step 1 (Basic Info): filling label-based fields");
  await dismissSfError(page);

  // Wait for the Basic Info anchor field to hydrate.
  await page.getByLabel(/applicant email/i).first().waitFor({ timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1000);

  // First Name
  const firstNameBox = page.getByLabel(/first name/i).first();
  if (await firstNameBox.count().catch(() => 0)) {
    await firstNameBox.fill(profile.firstName).catch(() => {});
  } else {
    logger.warn("[altinbas] Step 1: First Name field not found");
  }

  // Last Name
  const lastNameBox = page.getByLabel(/last name/i).first();
  if (await lastNameBox.count().catch(() => 0)) {
    await lastNameBox.fill(profile.lastName).catch(() => {});
  } else {
    logger.warn("[altinbas] Step 1: Last Name field not found");
  }

  // Passport Number
  const passportBox = page.getByLabel(/passport number/i).first();
  if (await passportBox.count().catch(() => 0)) {
    await passportBox.fill(profile.passportNumber).catch(() => {});
  } else {
    logger.warn("[altinbas] Step 1: Passport Number field not found");
  }

  // Applicant Email
  const emailBox = page.getByLabel(/applicant email/i).first();
  if (await emailBox.count().catch(() => 0)) {
    await emailBox.fill(profile.email).catch(() => {});
  } else {
    logger.warn("[altinbas] Step 1: Applicant Email field not found");
  }

  // Citizenship combobox (Salesforce typeahead)
  const citizenshipOk = await pickCombobox(
    page,
    /citizenship/i,
    profile.nationality || "Turkey",
  );
  if (!citizenshipOk) {
    logger.warn("[altinbas] Step 1: Citizenship combobox did not resolve a match — required field may block Next");
  }

  await page.waitForTimeout(800);
  logger.info(
    "[altinbas] Step1 filled: first/last/passport/email/citizenship",
    {
      firstName: await firstNameBox.inputValue().catch(() => "?"),
      lastName:  await lastNameBox.inputValue().catch(() => "?"),
      passport:  await passportBox.inputValue().catch(() => "?"),
      email:     await emailBox.inputValue().catch(() => "?"),
      citizenshipOk,
    },
  );

  logger.info("[altinbas] Step 1: clicking Next");
  const nextBtn = page.getByRole("button", { name: /^next$/i }).first();
  if (await nextBtn.count().catch(() => 0)) {
    await nextBtn.click({ timeout: 10000 }).catch(() => {});
  } else {
    await clickNext(page);
  }
  await page.waitForTimeout(3000);
}

/**
 * Student summary screen (post Step-1 Next): click "Create New Application"
 * to enter the Screen Flow. Bu tıklama flow'u BOOT eder — serializedState
 * applicant context'ini buradan kazanır. Returns true on success.
 */
async function clickCreateNewApplication(page: any): Promise<boolean> {
  await dismissSfError(page);

  // Faz-2.1 KANITLANDI (headed dry-run): after Basic Info → Next, the screen
  // is often a student-search GRID (columns Full Name/Email/Passport, footer
  // "Go To Applicant Detail Page") rather than the student summary directly.
  // The row radio is an SLDS faux-control — plain check()/click() silently
  // no-ops (checked stays false) and "Go To Applicant Detail Page" is then a
  // no-op too. Force-select the first row and force-click through.
  const gotoDetail = page.getByRole("button", { name: /go to applicant detail page/i }).first();
  if (await gotoDetail.count().catch(() => 0)) {
    const row = page.locator('input[type="radio"]').first();
    if (await row.count().catch(() => 0)) {
      const checked = await forceCheckRadio(page, row);
      logger.info(`[altinbas] grid row radio checked=${checked}`);
    }
    await page.waitForTimeout(800);
    await gotoDetail.click({ force: true, timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(SF_HYDRATION_MS);
    await dismissSfError(page);
    logger.info("[altinbas] clicked Go To Applicant Detail Page");
  }

  // Create New Application can be below the fold on the detail page.
  await page.mouse.wheel(0, 4000).catch(() => {});
  await page.waitForTimeout(1200);

  const createBtn = page.getByRole("button", { name: /create new application/i }).first();
  if (!(await createBtn.count().catch(() => 0))) {
    logger.warn("[altinbas] Create New Application button not found on student summary screen");
    return false;
  }
  await createBtn.scrollIntoViewIfNeeded().catch(() => {});
  await createBtn.click({ force: true, timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(3000);
  logger.info("[altinbas] clicked Create New Application — flow boot bekleniyor");
  return true;
}

// ---------------------------------------------------------------------------
// Duplicate detection (DOM — Step-1/grid ekranları için; flow içi duplicate
// isDuplicatePassport ile yanıt gövdesinden yakalanır)
// ---------------------------------------------------------------------------
async function checkAlreadyExists(page: any): Promise<boolean> {
  try {
    const txt: string = await page.evaluate(
      () => (document.body?.innerText || "").replace(/\s+/g, " "),
    );
    const DUP = /already an application for this (passport|email)|already exists|duplicate/i;
    const APP_NUM = /\b[A-Z]{2,3}\d{6,}\b/;
    if (DUP.test(txt)) return true;
    if (/application\s*number/i.test(txt) && APP_NUM.test(txt)) return true;
    return false;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Main adapter export
// ---------------------------------------------------------------------------
export const altinbasAdapter: UniversityAdapter = {
  key:   ADAPTER_KEY,
  label: "Altınbaş Üniversitesi",

  allowlist: ["altinbas", "altınbaş"],

  matches(name: string): boolean {
    const f = fold(name);
    return f.includes("altinbas") || f.includes("altinbas universitesi");
  },

  // -------------------------------------------------------------------------
  // login — Salesforce Experience Cloud partner community
  // -------------------------------------------------------------------------
  async login(opts?: LoginOpts): Promise<AdapterSession> {
    const { user, password } = opts?.credentials ?? portalCreds(ADAPTER_KEY);
    logger.info(`[altinbas] login → ${PORTAL_URL}`);

    const session = await launchPortal({
      headless: opts?.headless ?? true,
      storagePath: SESSION_STATE,
    });

    const page: any = session.page;
    page.setDefaultTimeout(30000);

    try {
      await page.goto(PORTAL_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(4000);

      // Already logged in?
      const url: string = page.url();
      if (url.includes("/partner/s/") && !url.includes("/login") && !url.includes("/Login")) {
        await page.goto(PORTAL_URL, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
      await page.waitForTimeout(SF_HYDRATION_MS);
      const _stale = page.url().toLowerCase().includes("login") || (await page.locator("input[type=password]").first().isVisible().catch(() => false));
      if (!_stale) { logger.info("[altinbas] login: session reused (already authenticated)"); return session; }
      logger.info("[altinbas] login: stored session stale - re-authenticating via form");
      }

      // Fill email
      for (const sel of [
        "input[type=email]",
        "input[name*=email i]",
        "input[id*=email i]",
        "input[type=text]",
      ]) {
        const el = page.locator(sel).first();
        if ((await el.count()) && (await el.isVisible().catch(() => false))) {
          await el.fill(user).catch(() => {});
          break;
        }
      }

      // Fill password
      await page.locator("input[type=password]").first().fill(password);

      // Click login button
      await page
        .getByRole("button", { name: /log\s*in|sign\s*in|giris|giriş/i })
        .first()
        .click({ timeout: 10000 })
        .catch(() => {});

      // Wait up to 30s for redirect away from login
      for (let t = 0; t < 30; t++) {
        await page.waitForTimeout(1000);
        const u: string = page.url();
        if (!u.includes("/login") && !u.includes("/Login")) break;
      }

      const stillLogin = await page
        .locator("input[type=password]")
        .first()
        .isVisible()
        .catch(() => false);
      if (stillLogin) {
        throw new Error("[altinbas] login failed — password field still visible (wrong credentials or captcha)");
      }

      logger.info(`[altinbas] login successful → ${page.url()}`);

      // Save session for reuse
      try {
        await page.context().storageState({ path: SESSION_STATE });
      } catch {/* non-fatal */}
    } catch (err) {
      await session.close().catch(() => {});
      throw err;
    }

    return session;
  },

  // -------------------------------------------------------------------------
  // submit — login'li tarayıcıda flow boot + navigateFlow REPLAY
  // -------------------------------------------------------------------------
  async submit(
    session: AdapterSession,
    profile: SubmitProfile,
    files: SubmitFiles,
    doSubmit: boolean = true,
  ): Promise<SubmitResult> {
    const page: any = session.page;
    page.setDefaultTimeout(30000);

    const dryRun =
      doSubmit === false ||
      process.env.PORTAL_DRYRUN === "1" ||
      process.env.ALTINBAS_DRYRUN === "1";

    logger.info("[altinbas] submit start (SCREEN FLOW REPLAY)", {
      student:     `${profile.firstName} ${profile.lastName}`,
      level:       profile.level,
      programName: profile.programName,
      dryRun,
      capture:     CAPTURE,
    });

    // ── Level guard ─────────────────────────────────────────────────────────
    if (!isAcceptedLevel(profile.level || "")) {
      const msg = `Altınbaş: level "${profile.level}" kapalı (yalnız Master/PhD)`;
      logger.info(`[altinbas] ${msg}`);
      return {
        alreadyExists:  false,
        submitted:      false,
        programMissing: false,
        detail:         msg,
      };
    }

    const result: SubmitResult = {
      alreadyExists:  false,
      submitted:      false,
      programMissing: false,
    };
    const screenshots: string[] = [];

    // ── Flow interceptor'ı EN BAŞTA kur (Create New Application'dan önce
    //    kurulu olmalı ki flow-boot yanıtındaki ilk serializedState kaçmasın;
    //    template'i Step-1 aura trafiğinden bile toplayabilir). ─────────────
    const rt = newFlowRuntime();
    setupFlowInterceptor(page, rt);
    if (CAPTURE) {
      logger.info(`[altinbas] ALTINBAS_CAPTURE=1 — tüm aura trafiği ${CAPTURE_FILE} dosyasına dökülüyor`);
    }

    // ── Navigate to application form ─────────────────────────────────────
    logger.info("[altinbas] navigating to application form");
    await navigateToAppForm(page);
    await page.waitForTimeout(2000);

    // Early duplicate check (Students/Applications list page)
    if (await checkAlreadyExists(page)) {
      logger.info("[altinbas] duplicate detected before form");
      result.alreadyExists = true;
      return { ...result, screenshots };
    }

    // ── Initial screenshot (pre-Step 1) ──────────────────────────────────
    const initShot = await captureScreen(page, "pre-step1");
    if (initShot) screenshots.push(initShot);

    // ── Step 1: Basic Information (DOM) ───────────────────────────────────
    await fillStep1(page, profile);
    await page.waitForTimeout(3000);

    if (await checkAlreadyExists(page)) {
      logger.info("[altinbas] duplicate detected after Step 1");
      result.alreadyExists = true;
      return { ...result, screenshots };
    }

    // ── Student summary → Create New Application (flow BOOT) ──────────────
    const createdApp = await clickCreateNewApplication(page);
    if (!createdApp) {
      logger.warn("[altinbas] could not click Create New Application — capturing student summary screen and aborting");
      const stuckShot = await captureScreen(page, "student-summary-stuck");
      if (stuckShot) screenshots.push(stuckShot);
      result.detail = "Altınbaş: Create New Application butonu bulunamadı (flow boot edilemedi)";
      return { ...result, screenshots };
    }

    // ── Screen Flow REPLAY: Term → Degree → Program → commit → Personal →
    //    Educational → Questionnaire → Documents → FINISH ───────────────────
    try {
      await runFlowReplay(page, rt, profile, files, dryRun, result, screenshots);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn(`[altinbas] flow replay hatası: ${msg}`);
      result.detail = result.detail || `Altınbaş flow replay hatası: ${msg}`;
      const failShot = await captureScreen(page, "flow-replay-failed");
      if (failShot) screenshots.push(failShot);
    }

    if (screenshots.length) result.screenshots = screenshots;
    logger.info("[altinbas] submit complete", result);
    return result;
  },

  // -------------------------------------------------------------------------
  // listPrograms — Phase 2 placeholder
  // TODO: flow boot + Term/Degree replay sonrası eligible listeden doldurulabilir.
  // -------------------------------------------------------------------------
  async listPrograms(
    session: AdapterSession,
    level?: string,
  ): Promise<ProgramOption[]> {
    logger.warn("[altinbas] listPrograms: not yet implemented (Phase 2)");
    return [];
  },
};
