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
// Duplicate-passport guard (FIX-14): CheckDuplicateValidation "already exists"
// mesajı self-referans DEĞİLDİR — önceki başarısız run'ın Salesforce'ta taslak
// halinde bıraktığı Application__c kaydına karşı ateşlenir. Bu sinyal artık
// alreadyExists=true (worker retry etmez) olarak ele alınır.
// Gerçek yeni-öğrenci duplicate'i → Program adımında AlreadyApplicationError.
//
// Dry-run: doSubmit=false Documents'a kadar replay eder, FINISH GÖNDERMEZ.
// ---------------------------------------------------------------------------

import { appendFileSync } from "node:fs";

import { and, eq, isNull } from "drizzle-orm";
import { db, portalSubmissionsTable } from "@workspace/db";

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
  type EduRecord,
  buildTermFields,
  buildDegreeFields,
  buildProgramFields,
  buildPersonalFields,
  buildEducationalFields,
  buildQuestionnaireFields,
  buildDocumentsFields,
  checkMissingEduRecord,
  classifyProfileLevel,
} from "./flow-fields.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ADAPTER_KEY   = "altinbas";
const PORTAL_URL    = "https://apply.altinbas.edu.tr/partner/s/";
const APP_FORM_URL  = PORTAL_URL + "application-form";
const SESSION_STATE = "/tmp/altinbas-portal-state.json";

/** Levels this adapter accepts. Everything else → skipped. */
const ACCEPTED_LEVELS = new Set([
  // Graduate
  "master", "phd", "doctorate", "doktora", "yüksek lisans", "yuksek lisans",
  // Undergraduate (portal opening imminent — adapter ready, IDs captured live)
  "bachelor", "lisans",
  // Sub-degree associate (portal opening imminent — adapter ready, IDs captured live)
  "associate", "önlisans", "onlisans", "ön lisans",
]);

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
  /**
   * FIX-6: EXPLICIT "applicationId" ANAHTARIYLA görülen Id'ler (bu run'da
   * oluşturulan başvurular). a02 PREFIX fallback'i availability kayıtlarını
   * da yakaladığı için güvenilmez — self-duplicate ayrımı BU set üzerinden.
   */
  explicitAppIds: Set<string>;
  /**
   * FIX-8: dört binding anahtarının EXPLICIT anahtar adıyla görülen SON değeri.
   * rt.ids prefix-fallback'le kirlenebilir (ilk görülen 003/001/a02) — Educational
   * binding'lerinde explicit değer varsa o kazanır (deterministik kaynak seçimi).
   */
  explicitIds: FlowIds;
  /**
   * FIX-9: explicitIds'teki her değerin kaynağı — "flow" (FlowRuntimeConnect-
   * Controller yanıtı, güvenilir) | "aura" (flow-dışı trafik, seçim-sonrası
   * kabul edilir ama flow-explicit'i ASLA ezemez). Provenance loguna yansır.
   */
  explicitIdSource: Partial<Record<keyof FlowIds, "flow" | "aura">>;
  /**
   * FIX-9: TÜM ham gövdelerde (flow + flow-dışı aura) regex ile görülen a02
   * Id evreni — commit'te İLK KEZ beliren başvuru Id'sini JSON parse edilemese
   * de yakalamak için (2199 kanıtı: walk hiç çalışmadı, 4 Id de YOK kaldı).
   */
  seenA02: Set<string>;
  /**
   * FIX-9: ham taramadan görülen 003/001 (Contact/Account) — son çare
   * fallback. SADECE applicant seçiminden SONRA dolar (applicantSelected):
   * seçim öncesi trafik portal/oturum bağlamı taşır (yanlış Contact riski);
   * seçim SONRASI ilk trafik = applicant-detay yüklemesi = seçilen öğrenci.
   */
  scanIds: FlowIds;
  /** FIX-9: applicant grid'inde öğrenci seçildi mi — scanIds doldurma kapısı. */
  applicantSelected: boolean;
  /**
   * FIX-12: commit ÖNCESİ görülen a02 Id'leri (program availability kayıtları).
   * Educational guard'ında fallback adayı filtrelemek için kullanılır — bu
   * set'te olan bir a02 availability kaydıdır, application DEĞİLDİR.
   */
  knownAvailabilityIds: Set<string>;
}

function newFlowRuntime(): FlowRuntime {
  return {
    template: null,
    state: null,
    lastRaw: "",
    records: new Map(),
    ids: {},
    reqCounter: 100,
    explicitAppIds: new Set(),
    explicitIds: {},
    explicitIdSource: {},
    seenA02: new Set(),
    scanIds: {},
    applicantSelected: false,
    knownAvailabilityIds: new Set(),
  };
}

/**
 * FIX-9: ham gövdeden Id topla — JSON parse edilemese de çalışır (escaped
 * varyantlar dahil). walk'a bağımlılığı kaldırır: 2199 run'ında yanıtlar parse
 * edilemeyince 4 Educational Id'si de boş gitmişti.
 *  - Explicit anahtarlar (applicantId/applicationId/accountId/contactId +
 *    Salesforce büyük-harf AccountId/ContactId) → rt.explicitIds/rt.ids.
 *    applicationId explicit'i SADECE flow-controller yanıtlarından (source=
 *    "flow") toplanır — flow-dışı trafik (applicant-detay'daki ESKİ taslaklar)
 *    explicitAppIds/provenAppId'yi kirletemez.
 *  - a02 evreni → rt.seenA02 (commit baseline kaynağı; her kaynaktan).
 *  - 003/001 → rt.scanIds (son çare fallback) — YALNIZ applicant seçiminden
 *    sonra (rt.applicantSelected), seçim-sonrası ilk görülen kazanır
 *    (= applicant-detay yüklemesi = seçilen öğrenci).
 */
/**
 * FIX-10: makul Salesforce record Id kontrolü. 2199 kanıtı: gevşek regex
 * (`a02[a-zA-Z0-9]{12,15}`) ham gövdedeki bir token PARÇASINI yakaladı
 * (a02Q3107ut6nun1 — "00000" padding'i yok) ve Educational'a bağlanıp
 * validation'ı düşürdü. Gerçek Id'ler 15 veya 18 karakter ve reserved
 * sıfır-padding içerir (a02Q300000ODWYwIAP, 003Q300000ao3HJIAY, ...).
 */
function isSfIdShape(id: string): boolean {
  return id.length === 15 || id.length === 18;
}

/**
 * FIX-10 (review sertleştirmesi): "0000" reserved padding Salesforce garantisi
 * DEĞİL — sert red yerine YUMUŞAK sıralama sinyali. Padding'li adaylar önce
 * gelir; padding'siz aday yalnız başka seçenek yoksa (WARN ile) kullanılır.
 */
function hasSfPadding(id: string): boolean {
  return /0{4}/.test(id);
}

function scanIdsFromRaw(rt: FlowRuntime, raw: string, source: "flow" | "aura"): void {
  // FIX-10: değer uzunluğu TAM 15 veya 18 (16-17 char junk explicit bile olsa red).
  const keyRe =
    /\\?"(applicantId|applicationId|accountId|contactId|AccountId|ContactId|Application__c)\\?"\s*:\s*\\?"([a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?)\\?"/g;
  let m: RegExpExecArray | null;
  while ((m = keyRe.exec(raw)) !== null) {
    // FIX-11: Application__c is a Salesforce lookup field in commit responses
    // carrying the real application record Id (a02). It never appears in
    // availability payloads, so adding it to explicitAppIds is safe. Only
    // accept from flow-controller responses (source="flow").
    if (m[1] === "Application__c") {
      if (source !== "flow") continue;
      const id = m[2];
      if (!hasSfPadding(id)) {
        logger.warn(`[altinbas] Application__c=${id} 0000-padding'siz (şüpheli format) — yine de kabul`);
      }
      logger.info(`[altinbas] FIX-11: Application__c=${id} → explicitAppIds (from-Application__c)`);
      rt.explicitAppIds.add(id);
      continue;
    }
    const k = (m[1].charAt(0).toLowerCase() + m[1].slice(1)) as keyof FlowIds;
    if (source !== "flow") {
      // Flow-dışı trafikten: applicationId ASLA (eski taslak kirliliği);
      // diğerleri YALNIZ applicant seçiminden sonra (oturum/portal bağlamındaki
      // yanlış Contact/Account explicit'leri seçim öncesi kabul edilmez) ve
      // flow-explicit bir değeri ASLA ezemez.
      if (k === "applicationId") continue;
      if (!rt.applicantSelected) continue;
      if (rt.explicitIdSource[k] === "flow") continue;
    }
    // FIX-10: anahtar bağlamı güçlü kanıt — kabul, ama padding'siz format
    // şüpheli olduğundan görünür kılınır (sert red YOK, gerçek Id kaybetmeyelim).
    if (!hasSfPadding(m[2])) {
      logger.warn(`[altinbas] explicit ${k}=${m[2]} 0000-padding'siz (şüpheli format) — yine de kabul`);
    }
    rt.explicitIds[k] = m[2];
    rt.explicitIdSource[k] = source;
    rt.ids[k] = m[2];
    if (k === "applicationId") rt.explicitAppIds.add(m[2]);
  }
  // FIX-10: tam 15 veya 18 karakter (token parçası eleme). seenA02 BASELINE
  // olduğundan padding'siz a02'ler de eklenir (geniş baseline = daha güvenli
  // commit-diff, junk yanlışlıkla "run-created" sayılamaz). scanIds (son çare)
  // için padding tercih sinyali: padding'li aday padding'siz olanı yükseltir.
  const idRe = /\b(?:a02|003|001)[a-zA-Z0-9]{12}(?:[a-zA-Z0-9]{3})?\b/g;
  const setScan = (k: keyof FlowIds, id: string): void => {
    const cur = rt.scanIds[k];
    if (!cur) rt.scanIds[k] = id;
    else if (!hasSfPadding(cur) && hasSfPadding(id)) rt.scanIds[k] = id;
  };
  while ((m = idRe.exec(raw)) !== null) {
    const id = m[0];
    if (id.startsWith("a02")) {
      rt.seenA02.add(id);
    } else if (rt.applicantSelected) {
      if (id.startsWith("003")) {
        setScan("contactId", id);
        setScan("applicantId", id);
      } else {
        setScan("accountId", id);
      }
    }
  }
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
      // FIX-4: yanıtlar yeni state'i "serializedEncodedState" anahtarıyla döndürür
      // ("serializedState" REQUEST tarafının anahtarı). İkisini de kabul et —
      // aksi halde state 3048'lik boot-request state'inde takılı kalır ve flow
      // ikinci NEXT'te interviewStatus:"Error" verir (response-chaining şart).
      const enc = o["serializedEncodedState"];
      if (typeof enc === "string" && enc.length > 200) {
        states.push(enc);
      } else {
        const ss = o["serializedState"];
        if (typeof ss === "string" && ss.length > 200) states.push(ss);
      }

      const id = o["Id"];
      // FIX-10: records havuzu prefix-fallback'i beslediğinden şekil vetlenir
      // (tam 15 veya 18 — 16/17 char junk havuza giremez).
      if (typeof id === "string" && /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/.test(id)) {
        rt.records.set(id, o);
      }

      for (const key of ["applicantId", "applicationId", "accountId", "contactId"] as const) {
        const v = o[key];
        // FIX-10: parse yolunda da tam 15/18 şekil şartı (padding sert red değil).
        if (typeof v === "string" && /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/.test(v)) {
          rt.ids[key] = v;
          rt.explicitIds[key] = v; // FIX-8: explicit anahtar > prefix fallback
          rt.explicitIdSource[key] = "flow";
          if (key === "applicationId") rt.explicitAppIds.add(v); // FIX-6: bizim oluşturduğumuz
        }
      }
      // FIX-11: Application__c lookup field — Salesforce commit responses carry
      // the real application record Id here (a02). Walk confirms it via JSON
      // parse; regex path (scanIdsFromRaw) covers parse-failure fallback.
      const appCVal = o["Application__c"];
      if (typeof appCVal === "string" && /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/.test(appCVal)) {
        logger.info(`[altinbas] FIX-11: Application__c=${appCVal} (walk) → explicitAppIds`);
        rt.explicitAppIds.add(appCVal);
        // Also promote to explicitIds.applicationId if not yet set by a stronger source.
        if (!rt.explicitIds.applicationId) {
          rt.explicitIds.applicationId = appCVal;
          rt.explicitIdSource.applicationId = "flow";
        }
        if (!rt.ids.applicationId) rt.ids.applicationId = appCVal;
      }

      for (const v of Object.values(o)) walk(v);
    }
  };

  // FIX-9: Id taraması walk'tan BAĞIMSIZ her gövdede çalışır (parse edilemese de).
  scanIdsFromRaw(rt, raw, "flow");

  const start = raw.indexOf("{");
  if (start >= 0) {
    try {
      walk(JSON.parse(raw.slice(start)));
    } catch {
      /* JSON parse edilemedi — regex fallback aşağıda */
    }
  }

  if (!states.length) {
    // Regex fallback: JSON parse edilemeyen / string içine gömülü (escaped)
    // gövdeden serialized(Encoded)State çek — `\"...\":\"...\"` varyantı dahil.
    const re = /\\?"serialized(?:Encoded)?State\\?"\s*:\s*\\?"((?:[^"\\]|\\.){200,}?)\\?"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw)) !== null) {
      try {
        states.push(JSON.parse(`"${m[1]}"`) as string);
      } catch {
        states.push(m[1]);
      }
    }
  }

  // Id prefix'lerinden applicant/application çıkarımı (003=Contact, 001=Account, a02=Application__c).
  // FIX-10: padding'li Id'ler önce (yumuşak sıralama) — havuz zaten şekil-vetli.
  const recIds = [...rt.records.keys()];
  for (const pass of [recIds.filter(hasSfPadding), recIds]) {
    for (const id of pass) {
      if (id.startsWith("003") && !rt.ids.contactId) { rt.ids.contactId = id; rt.ids.applicantId = rt.ids.applicantId ?? id; }
      if (id.startsWith("001") && !rt.ids.accountId) rt.ids.accountId = id;
      if (id.startsWith("a02") && !rt.ids.applicationId) rt.ids.applicationId = id;
    }
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
      if (!post.includes("FlowRuntimeConnectController") && !url.includes("FlowRuntimeConnect")) return;
      const p = new URLSearchParams(post);
      const context = p.get("aura.context") || "";
      const token = p.get("aura.token") || "";
      const pageURI = p.get("aura.pageURI") || "/partner/s/application-form";
      if (context && token) {
        rt.template = { origin: new URL(url).origin, context, token, pageURI };
      }
      // FIX-1: initial serializedState navigateFlow REQUEST gövdesinde gelir
      // (message=<urlenc JSON> → actions[0].params.request.serializedState).
      // Yanıt-state'i her zaman daha günceldir; request-state SADECE seed olarak
      // (rt.state boşken) kullanılır.
      if (!rt.state) {
        const msgStr = p.get("message") || "";
        if (msgStr.includes("serializedState")) {
          try {
            const msg = JSON.parse(msgStr) as {
              actions?: Array<{ params?: { request?: { serializedState?: unknown } } }>;
            };
            for (const a of msg.actions ?? []) {
              const ss = a?.params?.request?.serializedState;
              if (typeof ss === "string" && ss.length > 200) {
                rt.state = ss;
                logger.info(
                  `[altinbas] flow boot yakalandı (REQUEST gövdesinden) serializedState len=${ss.length}`,
                );
                break;
              }
            }
          } catch {
            /* message parse edilemedi — yanıt tarafı yakalayabilir */
          }
        }
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
        if (!reqPost.includes("FlowRuntimeConnectController") && !url.includes("FlowRuntimeConnect")) {
          // FIX-9: flow-dışı aura yanıtlarından SADECE Id taranır (state'e
          // ASLA dokunulmaz — zincir bozulmaz). Applicant-detay sayfası
          // Contact(003)/Account(001) Id'lerini burada taşır.
          scanIdsFromRaw(rt, raw, "aura");
          return;
        }
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
  return /"state"\s*:\s*"ERROR"|"exceptionEvent"\s*:\s*true|"errors"\s*:\s*\[\s*\{|\\?"interviewStatus\\?"\s*:\s*\\?"Error\\?"/.test(raw);
}

/** Aura action state:SUCCESS içeriyor mu? (FINISH başarı kanıtının parçası.) */
function auraActionSucceeded(raw: string): boolean {
  return /"state"\s*:\s*"SUCCESS"/.test(raw);
}

/**
 * Ekran sırası rank'i: Term=0 → Degree=1 → Program=2 → Personal=3 →
 * Educational=4 → Questionnaire=5 → Documents=6. Okunamayan stage = -1
 * (bilinmiyor — adım atlama YAPILMAZ, baştan başlanır).
 */
function stageRank(stage: string | null): number {
  if (!stage) return -1;
  const s = stage.toLowerCase();
  if (/document|upload/.test(s)) return 6;
  if (/question/.test(s)) return 5;
  if (/educat/.test(s)) return 4;
  if (/personal/.test(s)) return 3;
  if (/program/.test(s)) return 2;
  if (/degree/.test(s)) return 1;
  if (/term/.test(s)) return 0;
  return -1;
}

/**
 * CheckDuplicateValidation passport mesajı — FIX-14: bu mesaj commit/Personal'da
 * önceki başarısız run'ın Salesforce'ta taslak halinde bıraktığı Application__c
 * kaydına karşı ateşlenir. Self-referans DEĞİLDİR (FIX-7 varsayımı yanlıştı —
 * canlı kanıt 71 başarısız denemede her seferinde bu sinyali üretti).
 * guard() içinde alreadyExists=true → temiz dönüş (worker sonsuz retry yapmaz).
 * Gerçek ilk-başvuru duplicate'i → Program adımında AlreadyApplicationError ile
 * kayıt OLUŞTURULMADAN ÖNCE yakalanır (isAlreadyAppliedProgram).
 */
function isDuplicatePassport(raw: string): boolean {
  return /an application with this passport number already exists|you cannot submit a new application using the same passport/i.test(raw);
}

/**
 * FIX-7: GERÇEK duplicate kontrolü = SADECE Program adımı.
 * Öğrenci bu programa daha önce başvurduysa Program NEXT yanıtında
 * AlreadyApplicationError.message DOLAR (oluşturmadan önce çalışan kontrol).
 * Escaped-JSON toleranslı: AlreadyApplicationError'ı izleyen ±300 karakter
 * içinde DOLU bir message alanı arar; null/"" eşleşmez.
 */
function isAlreadyAppliedProgram(raw: string): boolean {
  if (/already applied for this program/i.test(raw)) return true;
  const re = /AlreadyApplicationError[\s\S]{0,300}?\\?"message\\?"\s*:\s*\\?"((?:[^"\\]|\\.){4,}?)\\?"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    if (m[1].trim().length > 0) return true;
  }
  return false;
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
  // FIX-4 sanity: gerçek interview state ~onbinlerce karakter; çok küçük state
  // muhtemelen boot-REQUEST'in erken state'i (yanıt zinciri kopmuş demektir).
  if (rt.state.length < 5000) {
    logger.warn(
      `[altinbas] navigateFlow[${tag}] stateLen=${rt.state.length} ŞÜPHELİ KÜÇÜK (<5000) — yanıt zinciri (serializedEncodedState) yakalanamamış olabilir`,
    );
  }

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

  // Canlı yakalanan gerçek endpoint formatı: ...aura?r=<n>&aura.FlowRuntimeConnect.navigateFlow=1
  const url = `${rt.template.origin}/partner/s/sfsites/aura?r=${rt.reqCounter}&aura.FlowRuntimeConnect.navigateFlow=1`;
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
  dumpRecords(rt, tag);

  const stage = readStageFromRaw(raw);
  logger.info(
    `[altinbas] navigateFlow[${tag}] action=${action} nf=${fields.length} → status=${resp.status} stage=${stage ?? "?"} err=${flowHasError(raw)} ${tag === "program" ? `alreadyApplied=${isAlreadyAppliedProgram(raw)}` : `dupPassport=${isDuplicatePassport(raw)}`} len=${raw.length} newStateLen=${rt.state.length}`,
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
 * FIX-2 captured FALLBACK'ler: dinamik record parse boş kalırsa canlı yakalanmış
 * cycle ID'leri kullanılır (Fall 2026-2027 cycle'ı). Fallback kullanımı WARN loglanır.
 * PhD degree Id'si HENÜZ bilinmiyor — ilk PhD dry-run'ında ALTINBAS_CAPTURE=1 ile
 * yakalanıp eklenecek (TODO).
 */
const FALLBACK_TERM = { label: "Fall 2026 - 2027", id: "a0CQ30000AVvpaEMQR" };
const FALLBACK_DEGREE_MASTER = { label: "Master", id: "a0CQ30000AVvqKTMQZ" };

/** ALTINBAS_CAPTURE=1 iken flow record havuzunu dök — option eşleme teşhisi. */
function dumpRecords(rt: FlowRuntime, tag: string): void {
  if (!CAPTURE) return;
  try {
    const entries = [...rt.records.entries()].map(([id, r]) => ({ id, r }));
    logger.info(
      `[altinbas][capture] records@${tag} n=${entries.length} :: ${JSON.stringify(entries).slice(0, 4000)}`,
    );
  } catch {
    /* diagnostic asla akışı kırmaz */
  }
}

/**
 * FIX-3: Term/Degree'de CAPTURED CONSTANT ÖNCELİKLİ (bu cycle stabil).
 * FIX-2'nin gevşek dinamik parse'ı YANLIŞ record tipini seçti: "2026-2027"
 * etiketli a02 (application/availability) kayıtlarını Term sandı → flow
 * interviewStatus:"Error" ile Term'i reddetti. Salesforce Id prefix haritası
 * (yakalanan): a0C=Term/Degree seçenekleri, a02=başvuru/availability,
 * a0A=Program Availability, a0B=Program.
 * Dinamik parse artık SADECE fallback (PhD gibi constant'ı olmayanlar) ve
 * record-tipi filtreli: Id a0C zorunlu + label pattern'i zorunlu.
 */

/** ALTINBAS_CAPTURE=1 iken aday record'un TAM şeklini dök (filtre teşhisi). */
function dumpCandidate(rt: FlowRuntime, id: string, what: string): void {
  if (!CAPTURE) return;
  try {
    const r = rt.records.get(id);
    logger.info(`[altinbas][capture] ${what} aday ${id} :: ${JSON.stringify(r).slice(0, 1500)}`);
  } catch {
    /* diagnostic asla akışı kırmaz */
  }
}

/**
 * Term seçimi: captured constant ÖNCE (FALLBACK_TERM). Dinamik parse yalnız
 * teşhis + constant'sız gelecekteki cycle'lar için: Id a0C ZORUNLU ve label
 * sezon kelimesi içermeli (year-only "2026-2027" a02 kayıtları Term DEĞİL).
 */
function pickTermOption(rt: FlowRuntime): { label: string; id: string } {
  const TERM_LABEL = /(fall|spring|summer|güz|bahar|yaz)[^,]*\d{4}\s*-\s*\d{4}/i;
  const cands: Array<{ label: string; id: string; year: number }> = [];
  for (const [id, r] of rt.records) {
    if (!id.startsWith("a0C")) continue;
    for (const v of Object.values(r)) {
      if (typeof v === "string" && TERM_LABEL.test(v)) {
        const years = v.match(/\d{4}/g) || [];
        cands.push({ label: v.trim(), id, year: Math.max(...years.map(Number), 0) });
        dumpCandidate(rt, id, "term");
        break;
      }
    }
  }
  if (cands.length) {
    cands.sort((a, b) => b.year - a.year);
    logger.info(
      `[altinbas] term dinamik adaylar (a0C+sezon filtreli): ${cands.map((c) => `${c.label}(${c.id})`).join(", ")}`,
    );
  }
  // Captured constant öncelikli — dinamik liste sadece constant yoksa devreye girer.
  if (FALLBACK_TERM.id) {
    logger.info(`[altinbas] Term captured constant kullanılıyor: "${FALLBACK_TERM.label}" (${FALLBACK_TERM.id})`);
    return FALLBACK_TERM;
  }
  return cands.length ? { label: cands[0].label, id: cands[0].id } : FALLBACK_TERM;
}

/**
 * Degree seçimi:
 *   Master → captured constant (FALLBACK_DEGREE_MASTER) — stabil, doğrulandı.
 *   PhD / Bachelor / Associate → Id henüz sabitlenmedi; a0C prefix + label
 *     pattern ile filtreli dinamik arama yapılır. Bulunamazsa null döner
 *     (fail-visible). İlk gerçek run ALTINBAS_CAPTURE=1 ile yapıldığında
 *     yakalanan Id constant olarak eklenebilir (Master gibi).
 *
 * NOT: Bachelor ve Associate için portal ID'leri henüz açık olmadığı için
 * bilinmiyor. Dinamik arama, portal Degree ekranının o zaman sunacağı
 * seçenekler arasından label eşleştirmesi yaparak Id'yi canlı bulur.
 */
const DEGREE_OPTIONS: Record<"associate" | "bachelor" | "master" | "phd", { label: string; id: string }> = {
  associate: { label: "Associate", id: "a0CQ30000AimBgbMQE" },
  bachelor: { label: "Bachelor", id: "a0CQ30000Aim5PsMQI" },
  master: { label: "Master", id: "a0CQ30000AVvqKTMQZ" },
  phd: { label: "PhD", id: "a0CQ30000AVvf4SMQR" },
};

function pickDegreeOption(rt: FlowRuntime, level: string): { label: string; id: string } | null {
  void rt;
  const cls = classifyProfileLevel(level);
  if (cls === "unknown") {
    logger.warn(
      `[altinbas] Degree seviyesi siniflandirilamadi (level="${level}") - DEGREE_OPTIONS eslesme yok`,
    );
    return null;
  }
  const opt = DEGREE_OPTIONS[cls];
  logger.info(`[altinbas] ${opt.label} degree sabit id kullaniliyor: "${opt.label}" (${opt.id})`);
  return opt;
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
    if (id.startsWith("a0A") || id.startsWith("a0B") || typeof r["eduhub__Program__c"] === "string") {
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
// FIX-15B: isDuplicatePassport tespit edilince My Applications sayfasına gidip
// "Signed Up" (yarım) başvuru satırında "Complete Application" tıklanır.
// Başarılı olursa flow resume modunda devam eder (Term/Degree/Program atlanır).
// ---------------------------------------------------------------------------
async function tryResumeFromMyApplications(
  page: any,
  profile: SubmitProfile,
  rt: FlowRuntime,
  result: SubmitResult,
): Promise<boolean> {
  const MY_APPS_URL = "https://apply.altinbas.edu.tr/partner/s/my-applications";
  try {
    logger.info("[altinbas] FIX-15B: isDuplicatePassport → My Applications'a yönlendiriliyor");
    await page.goto(MY_APPS_URL, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => {});
    await page.waitForTimeout(SF_HYDRATION_MS);

    // "Signed Up" = Salesforce Experience Cloud'da tamamlanmamış başvuru.
    const rows = page.locator("tr").filter({ hasText: /signed up/i });
    const rowCount = await rows.count().catch(() => 0);
    if (rowCount === 0) {
      logger.warn("[altinbas] FIX-15B: Signed Up satırı bulunamadı — alreadyExists fallback'e düşülüyor");
      return false;
    }

    const firstRow = rows.first();
    const rowText = await firstRow.innerText().catch(() => "");
    logger.info(`[altinbas] FIX-15B: Signed Up satırı bulundu: "${rowText.replace(/\s+/g, " ").slice(0, 150)}"`);

    // Program mismatch uyarısı: satır metni beklenen programı içermiyorsa kaydet.
    const crmProgram = profile.programName || "";
    if (crmProgram) {
      const firstWord = crmProgram.split(/\s+/)[0].toLowerCase();
      if (firstWord.length > 3 && !rowText.toLowerCase().includes(firstWord)) {
        if (!result.meta) result.meta = {};
        result.meta.programMismatch = {
          expected: crmProgram,
          actual: rowText.replace(/\s+/g, " ").trim().slice(0, 200),
          note: "resume mode — program doğrulanamadı, satır metninden çıkarıldı",
        };
        logger.warn(
          `[altinbas] FIX-15B: program mismatch olası — expected="${crmProgram}", rowText="${rowText.slice(0, 80)}"`,
        );
      }
    }

    // "Complete Application" butonunu önce ilgili satırda, bulunamazsa tüm sayfada ara.
    let completeBtn = firstRow
      .getByRole("button", { name: /complete application/i }).first();
    if (await completeBtn.count().catch(() => 0) === 0) {
      completeBtn = firstRow
        .getByRole("link", { name: /complete application/i }).first();
    }
    if (await completeBtn.count().catch(() => 0) === 0) {
      completeBtn = page.getByRole("button", { name: /complete application/i }).first();
    }
    if (await completeBtn.count().catch(() => 0) === 0) {
      completeBtn = page.getByRole("link", { name: /complete application/i }).first();
    }
    if (await completeBtn.count().catch(() => 0) === 0) {
      logger.warn("[altinbas] FIX-15B: Complete Application butonu bulunamadı — alreadyExists fallback'e düşülüyor");
      return false;
    }

    const beforeLastRaw = rt.lastRaw;
    await completeBtn.scrollIntoViewIfNeeded().catch(() => {});
    await completeBtn.click({ force: true, timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(SF_HYDRATION_MS);
    logger.info("[altinbas] FIX-15B: Complete Application tıklandı — flow boot bekleniyor");

    // Mevcut flow interceptor yeni session'ı da yakalar (aynı URL pattern).
    // rt.lastRaw güncellenene kadar 15s bekle.
    for (let t = 0; t < 15; t++) {
      await page.waitForTimeout(1000);
      if (rt.lastRaw !== beforeLastRaw && rt.lastRaw.length > 0) break;
    }

    if (rt.lastRaw === beforeLastRaw || rt.lastRaw.length === 0) {
      logger.warn("[altinbas] FIX-15B: flow yeniden boot olmadı (serializedState güncel değil)");
      return false;
    }

    logger.info(`[altinbas] FIX-15B: resume başarılı — yeni stage=${readStageFromRaw(rt.lastRaw) ?? "?"}`);
    return true;
  } catch (err) {
    logger.warn(`[altinbas] FIX-15B resume hatası (non-fatal): ${(err as Error).message?.slice(0, 200)}`);
    return false;
  }
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
  // 1) Flow boot'unu bekle: serializedState ya startFlow/navigateFlow yanıtından
  //    ya da ilk navigateFlow REQUEST gövdesinden (FIX-1) yakalanır.
  for (let t = 0; t < 12 && (!rt.state || !rt.template); t++) {
    await page.waitForTimeout(1000);
  }

  // FIX-1 boot seed: Create New Application sonrası Term ekranı render olur ama
  // sayfa kendiliğinden navigateFlow atmayabilir. Term ekranında Next'e BİR KEZ
  // UI'dan tıkla → ilk gerçek navigateFlow tetiklenir → request interceptor
  // template + initial serializedState'i yakalar; sonrası tamamen replay.
  if (!rt.state || !rt.template) {
    logger.info(
      "[altinbas] flow boot henüz yakalanmadı — Term ekranında UI Next ile ilk navigateFlow tetikleniyor (boot seed)",
    );
    try {
      // Yalnız GÖRÜNÜR ve tam "Next" metinli footer butonu (SLDS varyantlarına
      // karşı dar filtre); kaç aday bulunduğu teşhis için loglanır.
      const nextBtns = page
        .locator("button:visible")
        .filter({ hasText: /^\s*Next\s*$/i });
      const n = await nextBtns.count().catch(() => 0);
      logger.info(`[altinbas] boot-seed: görünür "Next" buton adayı=${n}`);
      if (n > 0) await nextBtns.last().click({ force: true, timeout: 8000 });
    } catch (e) {
      logger.warn(`[altinbas] boot-seed Next tıklanamadı: ${(e as Error).message?.slice(0, 200)}`);
    }
    for (let t = 0; t < 20 && (!rt.state || !rt.template); t++) {
      await page.waitForTimeout(1000);
    }
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
  dumpRecords(rt, "boot");

  /**
   * Yanıtı denetle: ERROR veya isDuplicatePassport → DUR (true döndür).
   * FIX-14: CheckDuplicateValidation "already exists" sinyali self-referans
   * DEĞİLDİR — önceki başarısız run'ın SF'te bıraktığı dangling Application__c
   * kaydına karşı ateşlenir. alreadyExists=true → worker retry etmez.
   * Gerçek ilk-başvuru duplicate'i → Program adımında isAlreadyAppliedProgram.
   */
  // FIX-6 teşhis: bu run'da oluşturulduğu kanıtlı başvuru Id'leri — explicit
  // "applicationId" anahtarı + commit yanıtlarında İLK KEZ görülen a02 kayıtları
  // (çift-create şüphesi uyarısı için).
  const runCreatedAppIds = new Set<string>();
  // FIX-10 (round 2): SALT ham-regex kaynaklı a02'ler bağlanamaz — ayrı zayıf
  // (teşhis) kümede tutulur; ancak explicit anahtar bağlamıyla doğrulanırsa
  // commit-trusted'a yükselir. runCreatedAppIds artık YALNIZ parse-edilmiş
  // rt.records diff'inden dolar (güvenilir katman).
  const rawCommitA02 = new Set<string>();
  const ownAppIds = (): Set<string> => new Set([...rt.explicitAppIds, ...runCreatedAppIds]);

  // FIX-14: post-commit guard herhangi bir adımda bloklarsa, bu run'da
  // oluşturulan Application__c ID'leri SF'te dangling kalabilir.
  // rollbackIfNeeded tüm post-commit adım guard'larında (commit döngüsü,
  // Personal, Educational, Questionnaire, Documents, FINISH) çağrılır.
  const rollbackIfNeeded = async (tag: string): Promise<void> =>
    rollbackDanglingApps(page, rt, result, tag, runCreatedAppIds);

  // FIX-15B: isDuplicatePassport → resume attempt (tryResumeFromMyApplications).
  // _duplicateSignal se bildirir; caller'lar bunu kontrol ederek resume dener.
  // Fallback: resume başarısız → alreadyExists=true (orijinal FIX-14 davranışı).
  let _duplicateSignal = false;

  const guard = (raw: string, tag: string): boolean => {
    if (isDuplicatePassport(raw)) {
      _duplicateSignal = true;
      logger.warn(
        `[altinbas] isDuplicatePassport @${tag} — FIX-15B resume akışı başlatılıyor`,
      );
      return true;
    }
    if (flowHasError(raw)) {
      result.detail = `Altınbaş flow ERROR @${tag}: ${raw.replace(/\s+/g, " ").slice(0, 500)}`;
      logger.warn(`[altinbas] ${result.detail}`);
      return true;
    }
    return false;
  };

  let resumeMode = false;

  // Stage-aware başlangıç: boot-seed UI Next tıklaması ekranı ilerletmiş
  // olabilir (örn. Term default'la Degree'ye geçti). Okunabilen boot stage'e
  // göre geçilmiş adımlar ATLANIR; stage okunamıyorsa (-1) Term'den başlanır.
  let curRank = stageRank(readStageFromRaw(rt.lastRaw));
  if (curRank > 0) {
    logger.info(`[altinbas] boot stage rank=${curRank} — önceki adımlar atlanacak`);
  } else if (curRank === -1) {
    logger.info("[altinbas] boot stage OKUNAMADI — replay Term'den başlıyor (ilk yanıt stage'i hizalar)");
  }

  /**
   * Stage geri gittiyse (desync) fail-visible. Aynı rank tolere edilir
   * (commit döngüsü stage'i değiştirmeyebilir); okunamayan stage tolere edilir.
   */
  const noteStage = (r: string, tag: string): boolean => {
    const nr = stageRank(readStageFromRaw(r));
    if (nr >= 0 && curRank >= 0 && nr < curRank) {
      result.detail = `Altınbaş: flow DESYNC @${tag} — stage geri gitti (rank ${curRank}→${nr}, stage="${readStageFromRaw(r)}")`;
      logger.warn(`[altinbas] ${result.detail}`);
      return true;
    }
    if (nr >= 0) curRank = nr;
    return false;
  };

  let raw = rt.lastRaw;

  // 2) TERM (NEXT) — nf=0 YASAK; captured constant öncelikli (FIX-3).
  if (curRank <= 0) {
    const term = pickTermOption(rt);
    logger.info(`[altinbas] Term: "${term.label}" (${term.id})`);
    raw = await postNavigateFlow(page, rt, "NEXT", buildTermFields(term), "term");
    if (flowHasError(raw)) {
      logger.warn(`[altinbas] Term REDDEDİLDİ — sent term=${term.id} label="${term.label}"`);
    }
    if (guard(raw, "Term") || noteStage(raw, "Term")) return;
  } else {
    logger.info("[altinbas] Term adımı atlandı (boot stage ilerisinde)");
  }

  // 3) DEGREE (NEXT)
  if (curRank <= 1) {
    const degree = pickDegreeOption(rt, profile.level || "");
    if (!degree) {
      result.detail = `Altınbaş: Degree seçeneği bulunamadı (level="${profile.level}") — PhD Id'si dinamik bulunamadı ve captured fallback henüz yok (ilk PhD ALTINBAS_CAPTURE run'ında yakalanacak)`;
      logger.warn(`[altinbas] ${result.detail}`);
      return;
    }
    logger.info(`[altinbas] Degree: "${degree.label}" (${degree.id})`);
    raw = await postNavigateFlow(page, rt, "NEXT", buildDegreeFields(degree), "degree");
    if (flowHasError(raw)) {
      logger.warn(`[altinbas] Degree REDDEDİLDİ — sent degree=${degree.id} label="${degree.label}"`);
    }
    if (guard(raw, "Degree") || noteStage(raw, "Degree")) return;
  } else {
    logger.info("[altinbas] Degree adımı atlandı (boot stage ilerisinde)");
  }

  // 4) PROGRAM (NEXT) — eligible listeden eşle
  // 5) CONTINUE_AFTER_COMMIT (×N, fields:[]) — başvuru kaydı burada OLUŞUR.
  if (curRank <= 2) {
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
    // Gerçek ilk-başvuru duplicate'i: Program NEXT yanıtında AlreadyApplicationError
    // kayıt OLUŞTURULMADAN ÖNCE dolar (öğrenci bu programa gerçekten başvurmuş).
    // isDuplicatePassport (dangling SF kaydı) ise guard() içinde yakalanır.
    if (isAlreadyAppliedProgram(raw)) {
      result.alreadyExists = true;
      result.detail =
        "Altınbaş: SKIPPED_DUPLICATE — öğrenci bu programa daha önce başvurmuş (Program adımı AlreadyApplicationError)";
      logger.info(`[altinbas] ${result.detail}`);
      return;
    }
    if (guard(raw, "Program") || noteStage(raw, "Program")) return;

    // FIX-6: commit ÖNCESİ görülen a02 kayıtları (boot/program availability'leri)
    // baseline — commit yanıtlarında İLK KEZ beliren a02'ler bu run'da OLUŞAN
    // başvuru kayıtlarıdır (self-duplicate ayrımının kanıt kaynağı).
    // FIX-9: baseline rt.records'a EK olarak ham-tarama a02 evrenini (seenA02)
    // da kapsar — yanıt JSON parse edilemese bile commit'te İLK KEZ beliren
    // başvuru Id'si yakalanır (2199'da walk hiç çalışmamış, Id'ler boş gitmişti).
    const a02Before = new Set([
      ...[...rt.records.keys()].filter((id) => id.startsWith("a02")),
      ...rt.seenA02,
    ]);
    // FIX-12: availability baseline'ı rt'ye kaydet — Educational guard'ında
    // fallback adayını filtrelemek için (pre-commit a02 = availability, not application).
    for (const id of a02Before) rt.knownAvailabilityIds.add(id);

    for (let i = 0; i < 4 && !/Personal Information/i.test(raw); i++) {
      const ownBefore = ownAppIds();
      raw = await postNavigateFlow(page, rt, "CONTINUE_AFTER_COMMIT", [], `commit${i + 1}`);
      for (const id of rt.records.keys()) {
        if (id.startsWith("a02") && !a02Before.has(id)) runCreatedAppIds.add(id);
      }
      // FIX-9: JSON parse edilemese de commit YANITININ KENDİ gövdesinde ilk
      // kez görülen a02'ler run-created sayılır (global seenA02 diff'i DEĞİL —
      // eşzamanlı flow-dışı trafikteki a02'ler yanlış atfedilmesin).
      // FIX-10 (round 2): ham-regex a02'ler tam 15/18 char (13-17 token parçası
      // eleme — 2199'da a02Q3107ut6nun1 böyle doğmuştu) ama artık DOĞRUDAN
      // bağlanabilir kümeye GİRMEZ: rawCommitA02 salt teşhis; bağlanma yalnız
      // parse-edilmiş records diff'i (üstteki döngü) veya explicit anahtar
      // bağlamıyla doğrulama üzerinden. Adaylar loglanır (capture diff'i).
      const a02Candidates = [
        ...new Set(raw.match(/\ba02[a-zA-Z0-9]{12}(?:[a-zA-Z0-9]{3})?\b/g) ?? []),
      ];
      logger.info(
        `[altinbas] commit${i + 1} yanıtı a02 adayları: padding'li=[${a02Candidates.filter(hasSfPadding).join(",") || "-"}] padding'siz=[${a02Candidates.filter((id) => !hasSfPadding(id)).join(",") || "-"}]`,
      );
      for (const id of a02Candidates) {
        if (!a02Before.has(id)) rawCommitA02.add(id);
      }
      // FIX-6 teşhis (hipotez 1: çift-create): bu commit YENİ bir başvuru Id'si
      // yarattıysa ve öncesinde zaten bir tane vardıysa yüksek sesle uyar.
      const newIds = [...ownAppIds()].filter((id) => !ownBefore.has(id));
      if (newIds.length > 0 && ownBefore.size > 0) {
        logger.warn(
          `[altinbas] ÇİFT-CREATE ŞÜPHESİ @commit${i + 1} — yeni applicationId ${newIds.join(",")} (önceki: ${[...ownBefore].join(",")}); insan akışında commit sayısını ALTINBAS_CAPTURE ile karşılaştırın`,
        );
      }
      if (guard(raw, `commit${i + 1}`) || noteStage(raw, `commit${i + 1}`)) {
        if (_duplicateSignal) {
          _duplicateSignal = false;
          const resumed = await tryResumeFromMyApplications(page, profile, rt, result);
          if (resumed) {
            resumeMode = true;
            curRank = Math.max(curRank, stageRank(readStageFromRaw(rt.lastRaw)));
            break; // commit döngüsünden çık, Personal'a geç
          }
          result.alreadyExists = true;
          result.detail =
            `Altınbaş: CheckDuplicateValidation @commit${i + 1} — resume başarısız; already_exists (FIX-15B). Manuel SF temizliği gerekiyor.`;
          logger.warn(`[altinbas] ${result.detail}`);
        }
        await rollbackIfNeeded(`commit${i + 1}`);
        return;
      }
    }
    if (!/Personal Information/i.test(raw)) {
      logger.warn(
        `[altinbas] commit sonrası Personal Information görünmedi (stage=${readStageFromRaw(raw) ?? "?"}) — yine de devam ediliyor`,
      );
    }
    if (rt.ids.applicationId) {
      logger.info(`[altinbas] applicationId=${rt.ids.applicationId} applicantId=${rt.ids.applicantId ?? "?"}`);
    }
  } else {
    logger.info("[altinbas] Program+commit adımları atlandı (boot stage ilerisinde)");
  }

  // 6) PERSONAL (NEXT) — 46 alan; ISO tarih + 3'lü ülke picklist + kod-prefix telefon
  if (curRank <= 3) {
    raw = await postNavigateFlow(page, rt, "NEXT", buildPersonalFields(profile), "personal");
    if (guard(raw, "Personal") || noteStage(raw, "Personal")) {
      if (_duplicateSignal) {
        _duplicateSignal = false;
        const resumed = await tryResumeFromMyApplications(page, profile, rt, result);
        if (resumed) {
          resumeMode = true;
          curRank = Math.max(curRank, stageRank(readStageFromRaw(rt.lastRaw)));
          // Don't return — fall through to Educational step
        } else {
          result.alreadyExists = true;
          result.detail =
            `Altınbaş: CheckDuplicateValidation @Personal — resume başarısız; already_exists (FIX-15B). Manuel SF temizliği gerekiyor.`;
          logger.warn(`[altinbas] ${result.detail}`);
          await rollbackIfNeeded("personal");
          return;
        }
      } else {
        await rollbackIfNeeded("personal");
        return;
      }
    }
  } else {
    logger.info("[altinbas] Personal adımı atlandı (boot stage ilerisinde)");
  }

  // 7) EDUCATIONAL (NEXT) — boş listeler + ID binding'leri
  if (curRank <= 4) {
    // FIX-8: liste binding'leri BU RUN'ın gerçek başvuru Id'sini taşımalı.
    // rt.ids.applicationId a02 prefix fallback'iyle boot/program availability
    // kaydına kirlenebilir (FIX-6 dersi) — bu run'da oluşturulduğu KANITLI Id
    // (explicit "applicationId" anahtarı > commit'te ilk görülen a02) varsa onu bağla.
    // FIX-9 (review sertleştirmesi): öncelik run-proven (commit-diff) > explicit.
    // explicitAppIds yalnız flow-controller yanıtlarından dolar ama yine de
    // ESKİ taslak Id'leri taşıyabilir; commit'te doğduğu KANITLI Id her zaman önce.
    // FIX-10 (round 2): GÜVEN KATMANLARI. Bağlanabilir adaylar yalnız:
    //  - commit-trusted: parse-edilmiş records diff'i (runCreatedAppIds) ∪
    //    explicit anahtar bağlamıyla doğrulanmış ham commit adayları
    //    (rawCommitA02 ∩ explicitAppIds — commit gövdesinde doğdu + key-context);
    //  - explicit: flow yanıtlarında "applicationId":"..." anahtarıyla görülen.
    // SALT ham-regex (zayıf) adaylar ASLA bağlanmaz (2199: a02Q3107ut6nun1
    // böyle bağlanıp validation düşürmüştü) — yalnız WARN + capture yönlendirmesi.
    // Padding yumuşak sıralama: padding'li commit > padding'li explicit >
    // padding'siz commit > padding'siz explicit (commit>explicit FIX-9 kararı:
    // explicit eski taslak taşıyabilir).
    const commitTrusted = [
      ...new Set([
        ...runCreatedAppIds,
        ...[...rawCommitA02].filter((id) => rt.explicitAppIds.has(id)),
      ]),
    ].filter(isSfIdShape);
    const explicitAll = [...rt.explicitAppIds].filter(isSfIdShape);
    const provenAppId =
      commitTrusted.filter(hasSfPadding).at(-1) ??
      explicitAll.filter(hasSfPadding).at(-1) ??
      commitTrusted.at(-1) ??
      explicitAll.at(-1);
    const weakOnly = [...rawCommitA02].filter(
      (id) => !runCreatedAppIds.has(id) && !rt.explicitAppIds.has(id),
    );
    if (weakOnly.length) {
      logger.warn(
        `[altinbas] SALT ham-taramada görülen a02 adayları BAĞLANMADI (zayıf kanıt): [${weakOnly.join(",")}] — gerçek Id için ALTINBAS_CAPTURE=1 commit dump'ına bakın`,
      );
    }
    if (!provenAppId) {
      logger.warn(
        `[altinbas] Güvenilir applicationId adayı YOK (commitTrusted=[] explicit=[]) — prefix-fallback'e düşülecek; capture ile insan-payload diff önerilir`,
      );
    } else if (!hasSfPadding(provenAppId)) {
      logger.warn(
        `[altinbas] applicationId adayı 0000-padding'siz: ${provenAppId} (şüpheli format — padding'li aday yoktu; commit=[${commitTrusted.join(",") || "-"}] explicit=[${explicitAll.join(",") || "-"}])`,
      );
    }
    if (provenAppId && rt.ids.applicationId !== provenAppId) {
      logger.info(
        `[altinbas] FIX-8: applicationId düzeltildi ${rt.ids.applicationId ?? "?"} → ${provenAppId} (bu run'da oluşturulan kayıt)`,
      );
      rt.ids.applicationId = provenAppId;
    }
    // FIX-11/FIX-12/FIX-13: commitTrusted ve explicit boşsa fallback'i değerlendir.
    // Öncelik:
    //  1. commitTrusted / explicit → provenAppId (yukarıda çözüldü)
    //  2. FIX-13: rt.ids.applicationId (commit sonrası prefix-fallback'te stored) —
    //     hasSfPadding geçiyorsa DOĞRUDAN GÜVEN; availability kontrolü YAPILMAZ.
    //     Gerekçe: application önceki bir run'dan rt.records'ta (a02Before) görünmüş
    //     olabilir → knownAvailabilityIds'e girmiş olabilir; bu onu availability
    //     yapmaz, FIX-12'nin availability filtresi bu durumda hatalıydı.
    //  3. FIX-12: rawCommitA02 havuzu; hasSfPadding + !knownAvailabilityIds ile filtrele
    //     (tek geçerli aday). rt.ids.applicationId yoksa veya padding'siz ise bu devreye girer.
    //  4. ABORT: hiçbiri geçmezse; teşhis logu ekle.
    if (!provenAppId) {
      const fallback = rt.ids.applicationId;
      const fallbackPadded = !!fallback && hasSfPadding(fallback);
      if (fallbackPadded) {
        // FIX-13: commit-sonrası stored değer — hasSfPadding yeterli güvence.
        logger.info(
          `[altinbas] FIX-13: applicationId=${fallback} (from-post-commit-stored;` +
          ` inAvailability=${rt.knownAvailabilityIds.has(fallback!)})`,
        );
        // rt.ids.applicationId zaten doğru — değişiklik gerekmez.
      } else {
        // FIX-12: geniş aday havuzu, availability filtreli.
        const rawCandidates = [
          ...(fallback ? [fallback] : []),
          ...[...rawCommitA02],
        ];
        const trustworthy = [...new Set(rawCandidates)]
          .filter(isSfIdShape)
          .filter(hasSfPadding)
          .filter((id) => !rt.knownAvailabilityIds.has(id));
        if (trustworthy.length === 1) {
          rt.ids.applicationId = trustworthy[0];
          logger.info(
            `[altinbas] FIX-12: applicationId=${trustworthy[0]} (from-fallback-trusted, tek geçerli SF-a02;` +
            ` availability-filtresi: ${rt.knownAvailabilityIds.size} id; fallback=${fallback ?? "null"})`,
          );
        } else {
          logger.warn(
            `[altinbas] FIX-13 teşhis: runState.applicationId=${fallback ?? "null"}` +
            ` hasSfPadding=${fallbackPadded}` +
            ` inAvailability=${fallback ? rt.knownAvailabilityIds.has(fallback) : false}` +
            ` trustworthy=[${trustworthy.join(",")}]` +
            ` commitTrusted=[${commitTrusted.join(",")}] explicit=[${explicitAll.join(",")}]`,
          );
          throw new Error(
            `altinbas Educational ABORT (FIX-11): applicationId Application__c/commit'ten çözülemedi` +
            ` (commitTrusted=[] explicit=[] fallback=${fallback ?? "null"}` +
            ` trustworthy=[${trustworthy.join(",")}])` +
            ` — ALTINBAS_CAPTURE=1 ile commit dump'ını inceleyip Application__c alanını doğrulayın`,
          );
        }
      }
    }
    // FIX-8: dört binding'in TAMAMI için deterministik kaynak seçimi —
    // explicit anahtar (yanıtlarda "contactId":"003..." gibi) > prefix fallback
    // (ilk görülen 003/001/a02, kirlenebilir). applicationId'de run-kanıtlı Id önce.
    const idKeys = ["applicantId", "applicationId", "accountId", "contactId"] as const;
    const effIds: FlowIds = {};
    const provenance: string[] = [];
    for (const k of idKeys) {
      const explicit = rt.explicitIds[k];
      // FIX-9: son çare = ham-tarama (flow-dışı aura trafiği dahil; applicant-
      // detay sayfası Contact/Account Id'lerini taşır). applicationId'de
      // raw-scan fallback YOK — a02 evreni availability kayıtlarıyla kirli,
      // yalnız run-kanıtlı (commit diff) veya explicit değer bağlanır.
      const rawScan = k === "applicationId" ? undefined : rt.scanIds[k];
      const v =
        k === "applicationId" ? (provenAppId ?? explicit ?? rt.ids[k]) : (explicit ?? rt.ids[k] ?? rawScan);
      effIds[k] = v;
      const src =
        k === "applicationId" && provenAppId
          ? commitTrusted.includes(provenAppId)
            ? "commit-raw"
            : "run-proven"
          : explicit
            ? `explicit(${rt.explicitIdSource[k] ?? "flow"})`
            : rt.ids[k]
              ? "prefix-fallback"
              : rawScan
                ? "raw-scan"
                : "YOK";
      provenance.push(`${k}=${v ?? "?"}[${src}]`);
      // FIX-9: flow yanıtıyla doğrulanmamış (aura-explicit/raw-scan) binding'i
      // yine de bağlarız (elimizdeki en iyi veri) ama yüksek sesle işaretleriz.
      if (v && (src === "explicit(aura)" || src === "raw-scan")) {
        logger.warn(
          `[altinbas] Educational ${k}=${v} kaynağı ${src} — flow yanıtında doğrulanmadı (applicant-detay trafiğinden, seçim-sonrası)`,
        );
      }
    }
    // FIX-9: bariz yanlış-prefix'li Id'yi bağlama (spec uyarısı: 003... bir
    // Contact'tır, accountId'ye bağlanamaz) — düşür, WARN'la.
    const prefixOf: Record<(typeof idKeys)[number], string> = {
      applicantId: "003",
      applicationId: "a02",
      accountId: "001",
      contactId: "003",
    };
    for (const k of idKeys) {
      const v = effIds[k];
      if (v && !v.startsWith(prefixOf[k])) {
        logger.warn(`[altinbas] Educational ${k}=${v} beklenen prefix '${prefixOf[k]}' değil — bağlanmadı`);
        effIds[k] = undefined;
      }
    }
    // FIX-9: contactId ve applicantId AYNI Contact'tır (spec) — biri doluysa
    // diğerini ondan tamamla.
    if (!effIds.contactId && effIds.applicantId) effIds.contactId = effIds.applicantId;
    if (!effIds.applicantId && effIds.contactId) effIds.applicantId = effIds.contactId;
    logger.info(`[altinbas] Educational ID provenance: ${provenance.join(" ")}`);
    const missingIds = idKeys.filter((k) => !effIds[k]);
    if (missingIds.length) {
      logger.warn(
        `[altinbas] Educational ID binding EKSİK: ${missingIds.join(",")} — validation hatası olası (kaynak: flow yanıtlarında bu anahtar/prefix hiç görülmedi)`,
      );
    }
    // FIX-15C: education_records'dan bachelor/master kaydı al ve gönder.
    // Master/PhD başvurularında bachelor kaydı yoksa missingDocuments'a ekle.
    const eduRecords = profile.educationRecords;
    const missingEduKey = checkMissingEduRecord(eduRecords, profile.level || "");
    if (missingEduKey) {
      logger.warn(`[altinbas] FIX-15C: ${missingEduKey} eksik — missingDocuments'a eklendi`);
      result.missingDocuments = [...(result.missingDocuments ?? []), missingEduKey];
    }
    // Prefer bachelor record; fall back to master or high_school for the modal.
    const primaryEdu =
      eduRecords?.find((r) => r.level === "bachelor") ??
      eduRecords?.find((r) => r.level === "master") ??
      eduRecords?.find((r) => r.level === "high_school");
    const eduFields = buildEducationalFields(effIds, primaryEdu);
    // Capture karşılaştırması için TAM istek alanları (sadece Id/sabit — PII yok).
    logger.info(`[altinbas] Educational REQUEST fields (nf=${eduFields.length}): ${JSON.stringify(eduFields)}`);
    raw = await postNavigateFlow(page, rt, "NEXT", eduFields, "educational");
    if (guard(raw, "Educational") || noteStage(raw, "Educational")) {
      await rollbackIfNeeded("educational");
      return;
    }
  } else {
    logger.info("[altinbas] Educational adımı atlandı (boot stage ilerisinde)");
  }

  // 8) QUESTIONNAIRE (NEXT) — FIX-15C: Visa Support sorusu gönderiliyor.
  if (curRank <= 5) {
    raw = await postNavigateFlow(page, rt, "NEXT", buildQuestionnaireFields(profile.visaSupport), "questionnaire");
    if (guard(raw, "Questionnaire") || noteStage(raw, "Questionnaire")) {
      await rollbackIfNeeded("questionnaire");
      return;
    }
  } else {
    logger.info("[altinbas] Questionnaire adımı atlandı (boot stage ilerisinde)");
  }

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
  if (guard(raw, "Documents") || noteStage(raw, "Documents")) {
    await rollbackIfNeeded("documents");
    return;
  }

  // 10) FINISH — dry-run'da GÖNDERİLMEZ.
  if (dryRun) {
    result.detail = "Altınbaş: dry-run — flow Documents'a kadar replay edildi, FINISH GÖNDERİLMEDİ";
    logger.info(`[altinbas] ${result.detail}`);
    return;
  }
  raw = await postNavigateFlow(page, rt, "FINISH", [], "finish");
  if (guard(raw, "FINISH") || noteStage(raw, "FINISH")) {
    await rollbackIfNeeded("finish");
    return;
  }

  // FIX-15A: Salesforce LWS "EduhubNavigateToURL" nav-blocked hatası BAŞARI sinyalidir.
  // LWS cross-origin yönlendirmeyi engeller, ama Application__c kaydı çoktan işlendi.
  // "Cannot open: ...my-applications?id=<TOKEN>" URL'inden externalRef çıkarılır.
  {
    const lwsMatch = raw.match(
      /EduhubNavigateToURL[\s\S]{0,600}?Cannot open:\s*https?:\/\/apply\.altinbas\.edu\.tr\/partner\/s\/my-applications\?id=([^"'\s\\&]+)/i,
    );
    if (lwsMatch) {
      const externalRef = lwsMatch[1].replace(/\\/g, "");
      result.submitted = true;
      result.externalRef = externalRef || rt.ids.applicationId;
      result.detail =
        `Altınbaş: FINISH — EduhubNavigateToURL LWS nav-blocked başarı (FIX-15A); externalRef=${result.externalRef ?? "?"}`;
      logger.info(`[altinbas] ${result.detail}`);
      return;
    }
  }

  // FINISH başarı kanıtı: HTTP 2xx + aura JSON (postNavigateFlow garanti eder)
  // YETMEZ — aura action state:SUCCESS da şart. Aksi halde fail-visible.
  if (!auraActionSucceeded(raw)) {
    result.detail = `Altınbaş: FINISH yanıtında state:SUCCESS yok — başarı SAYILMADI: ${raw.replace(/\s+/g, " ").slice(0, 500)}`;
    logger.warn(`[altinbas] ${result.detail}`);
    await rollbackIfNeeded("finish-no-success");
    return;
  }

  result.submitted = true;
  if (rt.ids.applicationId) result.externalRef = rt.ids.applicationId;
  result.detail = `Altınbaş: FINISH gönderildi, aura state:SUCCESS (flow replay)${rt.ids.applicationId ? ` — applicationId=${rt.ids.applicationId}` : ""}`;
  logger.info(`[altinbas] ${result.detail}`);
}

// ---------------------------------------------------------------------------
// Dangling Application__c rollback helper (FIX-14)
//
// Called whenever a post-commit step fails — either via guard()-detected flow
// errors (early return inside runFlowReplay) or thrown exceptions (submit catch).
// Attempts SF REST API DELETE for every known Application__c ID; logs DANGLING
// and appends to result.detail when DELETE fails (for manual cleanup tracking).
// ---------------------------------------------------------------------------
async function rollbackDanglingApps(
  page: any,
  rt: FlowRuntime,
  result: SubmitResult,
  triggerTag: string,
  runCreatedIds: Set<string>,
): Promise<void> {
  const ids = [...new Set([...runCreatedIds, ...rt.explicitAppIds])].filter(Boolean);
  if (ids.length === 0 || !rt.template) return;
  const origin = rt.template.origin;
  for (const appId of ids) {
    let rolled = false;
    try {
      const delResp: { status: number } = await page.evaluate(
        async (a: { url: string }) => {
          const r = await fetch(a.url, {
            method: "DELETE",
            credentials: "include",
          });
          return { status: r.status };
        },
        { url: `${origin}/services/data/v59.0/sobjects/Application__c/${appId}` },
      );
      if (delResp.status >= 200 && delResp.status < 300) {
        logger.info(
          `[altinbas] ROLLBACK OK @${triggerTag}: Application__c ${appId} silindi (HTTP ${delResp.status})`,
        );
        rolled = true;
      } else {
        logger.warn(
          `[altinbas] ROLLBACK başarısız @${triggerTag}: Application__c ${appId} SF REST DELETE HTTP ${delResp.status}`,
        );
      }
    } catch (rollbackErr) {
      logger.warn(
        `[altinbas] ROLLBACK hata @${triggerTag}: Application__c ${appId}: ${(rollbackErr as Error).message?.slice(0, 200)}`,
      );
    }
    if (!rolled) {
      const danglingMsg = `[altinbas] DANGLING APPLICATION__C applicationId=${appId} — manuel Salesforce temizliği gerekiyor`;
      logger.warn(danglingMsg);
      result.detail = (result.detail ? result.detail + " | " : "") + danglingMsg;
    }
  }
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
async function clickCreateNewApplication(page: any, rt: FlowRuntime): Promise<boolean> {
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
    // FIX-9: seçim yapıldı — bundan sonraki aura trafiği seçilen öğrencinin
    // detay yüklemesidir; scanIds (003/001 son-çare fallback) artık dolabilir.
    rt.applicantSelected = true;
    await gotoDetail.click({ force: true, timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(SF_HYDRATION_MS);
    await dismissSfError(page);
    logger.info("[altinbas] clicked Go To Applicant Detail Page");
  }
  // Grid çıkmadıysa doğrudan detay sayfasındayız — seçim kapısını yine aç.
  rt.applicantSelected = true;

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
      const msg = `Altınbaş: level "${profile.level}" kapalı (Master/PhD/Bachelor/Associate)`;
      logger.info(`[altinbas] ${msg}`);
      return {
        alreadyExists:  false,
        submitted:      false,
        programMissing: false,
        detail:         msg,
      };
    }

    // ── Pre-flight: önceki run dangling SF kaydı bırakmış mı? (FIX-14) ──────
    // Aynı CRM applicationId için mode=real, status=failed satırları varsa
    // WARN logu yaz — önceki run(lar) Salesforce'ta taslak Application__c
    // bırakmış olabilir; manuel SF temizliği yapılmadan yeni run'da
    // CheckDuplicateValidation (isDuplicatePassport sinyali) tetiklenir.
    if (profile.applicationDbId) {
      try {
        const prevFailed = await db
          .select({ id: portalSubmissionsTable.id, createdAt: portalSubmissionsTable.createdAt })
          .from(portalSubmissionsTable)
          .where(
            and(
              eq(portalSubmissionsTable.applicationId, profile.applicationDbId),
              eq(portalSubmissionsTable.universityKey, ADAPTER_KEY),
              eq(portalSubmissionsTable.mode, "real"),
              eq(portalSubmissionsTable.status, "failed"),
              isNull(portalSubmissionsTable.deletedAt),
            ),
          );
        if (prevFailed.length > 0) {
          const summary = prevFailed
            .map((r) => `id=${r.id} at=${r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt)}`)
            .join("; ");
          logger.warn(
            `[altinbas] PRE-FLIGHT: applicationId=${profile.applicationDbId} için ${prevFailed.length} adet önceki mode=real status=failed submission var` +
            ` (${summary}) — önceki run(lar) Salesforce'ta dangling Application__c bırakmış olabilir.` +
            ` Manuel SF temizliği yapılmadan bu run'da CheckDuplicateValidation (already_exists) tetiklenebilir.`,
          );
        }
      } catch (preflightErr) {
        logger.warn(`[altinbas] pre-flight sorgusu başarısız (non-fatal): ${(preflightErr as Error).message?.slice(0, 200)}`);
      }
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
    const createdApp = await clickCreateNewApplication(page, rt);
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

      // ── Dangling Application__c rollback (FIX-14) ────────────────────────
      // commit'ten sonra exception fırlatıldıysa Salesforce'ta taslak
      // Application__c kaydı kalmış olabilir. Guard()-detected hatalar zaten
      // runFlowReplay'in içinde rollbackIfNeeded ile yakalanır; bu dal yalnız
      // gerçek throw'lar için son güvencedir.
      // runCreatedAppIds is scoped to runFlowReplay; for exceptions that escape
      // the function, rely on rt.explicitAppIds (union happens inside rollbackDanglingApps).
      await rollbackDanglingApps(page, rt, result, "exception", new Set<string>());
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
