// ---------------------------------------------------------------------------
// SIT portal — READ-ONLY GraphQL client
//
// SIT exposes a GraphQL endpoint at POST /api/graphql. We use it STRICTLY for
// read-only lookups (idempotency + catalog), never for writes — all writes go
// through the portal UI (SIT's write mutations are non-functional for partner
// accounts).
//
// AUTH: a session cookie alone is not enough — SIT (Laravel/axios SPA) also
// wants the `X-XSRF-TOKEN` header echoed from the XSRF-TOKEN cookie and, when
// present, an `Authorization: Bearer` token the app keeps in web storage. The
// symptom of the missing header/token is a 200 response with `data: null`
// (never surfaced as an auth error), which used to be logged as "shape
// mismatch — null". `collectAuth` gathers both (XSRF from the browser context
// cookie jar, bearer from local/sessionStorage) and we send them via TWO
// transports, tried in order until one returns usable data:
//   1) page.request.post + the auth headers + Origin/Referer — CORS-immune and
//      the transport we KNOW reaches the server (it returned 200 in prod); the
//      only thing it lacked before was the XSRF/bearer headers.
//   2) an in-page window.fetch (credentials:"include") to a RELATIVE path so it
//      is always same-origin — the SPA-faithful fallback if (1) is rejected. A
//      cross-origin ABSOLUTE URL here is what made the earlier in-page fetch
//      throw and silently fall back to a cookie-only request.
//
// Every response is validated with zod and narrowed to a typed shape; on any
// network error, GraphQL error, or shape mismatch the helpers return null/[]
// so the adapter can fall back to scanning the UI (graceful degradation —
// the live schema may evolve). Diagnostics log the HTTP status, whether the
// XSRF/bearer credentials were attached, any GraphQL `errors`, and the
// PII-redacted response STRUCTURE so a real auth/schema problem is visible.
// ---------------------------------------------------------------------------

import { z } from "zod";
import type { Page } from "playwright-core";
import { logger } from "../../browser.js";
import type { ProgramCandidate } from "../../programMatch.js";
import { SIT_URLS } from "./selectors.js";

const GRAPHQL_PATH = "/api/graphql";

// SIT authenticates GraphQL with a Supabase access_token. The Supabase project
// (auth + rest) lives here; the token endpoint mints an access_token from the
// SIT email/password (the same portal_credentials used for the UI login).
const SUPABASE_URL = "https://knqtjanxjwfjfrwoater.supabase.co";
const SUPABASE_TOKEN_PATH = "/auth/v1/token?grant_type=password";

// A bare (unprefixed) JWT — used to validate a minted/captured access_token.
const JWT_RE = /^ey[\w-]+\.[\w-]+\.[\w-]+$/;

// ---------------------------------------------------------------------------
// Supabase auth for GraphQL.
//
// DEFINITIVE approach (mintSupabaseBearer): the adapter's headless SPA login
// does NOT produce a real Supabase session — it reaches the app but the heavy
// SPA login never authenticates, so no access_token is ever written to storage
// and no authenticated /api/graphql request is fired to intercept. Three prior
// approaches (storage read, poll+cookie, SPA header capture) all failed for
// this reason. Instead we BYPASS the SPA login and mint an access_token
// directly from Supabase Auth: capture the public anon `apikey` the SPA sends
// on its own *.supabase.co requests, then POST it with the SIT email/password
// to /auth/v1/token?grant_type=password. The returned access_token is the
// Bearer the GraphQL endpoint needs.
//
// The passive SPA-header capture and web-storage reads are retained only as
// best-effort fallbacks. All tokens/keys are held in memory only (keyed weakly
// by page) and are NEVER logged (only bearer=true/false + HTTP status).
// ---------------------------------------------------------------------------
const capturedBearerByPage = new WeakMap<Page, string>();
const capturedAnonKeyByPage = new WeakMap<Page, string>();
const captureInstalledPages = new WeakSet<Page>();

// Matches "Bearer <jwt>" and captures the bare JWT (group 1).
const BEARER_JWT_RE = /^bearer\s+(ey[\w-]+\.[\w-]+\.[\w-]+)\s*$/i;

/**
 * Attach a one-time network listener that captures (a) the Bearer token the SPA
 * sends on its own /api/graphql requests and (b) the public anon `apikey`
 * header the SPA sends on its *.supabase.co requests (needed to mint a token).
 * Idempotent per page. Call as early as possible after opening the portal so
 * both are captured during natural navigation before our first GraphQL call.
 */
export function installSpaAuthCapture(page: Page): void {
  if (captureInstalledPages.has(page)) return;
  captureInstalledPages.add(page);
  page.on("request", (req) => {
    try {
      const url = req.url();
      // (b) public anon apikey from any Supabase request (never logged).
      if (url.includes(".supabase.co") && !capturedAnonKeyByPage.has(page)) {
        const key = req.headers()["apikey"];
        if (typeof key === "string" && key) capturedAnonKeyByPage.set(page, key);
      }
      // (a) Bearer from the SPA's own graphql calls (fallback source).
      if (url.includes(GRAPHQL_PATH)) {
        const authz = req.headers()["authorization"];
        const m = typeof authz === "string" ? authz.match(BEARER_JWT_RE) : null;
        if (m) capturedBearerByPage.set(page, m[1]);
      }
    } catch {
      /* header read failed — ignore, other requests may still be captured */
    }
  });
}

/**
 * Resolve the public anon apikey — from the passive capture, or by waiting once
 * (bounded) for the SPA to fire a *.supabase.co request carrying it. Returns
 * null if none is observed. The key value is NEVER logged.
 */
async function resolveAnonKey(page: Page): Promise<string | null> {
  let key = capturedAnonKeyByPage.get(page);
  if (key) return key;
  try {
    const req = await page.waitForRequest(
      (r) => r.url().includes(".supabase.co") && !!r.headers()["apikey"],
      { timeout: 12_000 },
    );
    const k = req.headers()["apikey"];
    if (typeof k === "string" && k) {
      capturedAnonKeyByPage.set(page, k);
      key = k;
    }
  } catch {
    /* no supabase request observed */
  }
  return key ?? capturedAnonKeyByPage.get(page) ?? null;
}

/**
 * Log the login-page state (URL + storage/cookie KEY NAMES only, plus a
 * screenshot to /tmp) when auth fails, so we can see WHERE the adapter is and
 * whether it is authenticated — WITHOUT ever logging any secret value.
 */
async function logSitLoginDiagnostics(page: Page): Promise<void> {
  try {
    const info = await page
      .evaluate(() => {
        let lsKeys: string[] = [];
        try {
          lsKeys = Object.keys(window.localStorage);
        } catch {
          /* access denied */
        }
        let cookieKeys: string[] = [];
        try {
          cookieKeys = document.cookie
            .split(";")
            .map((x) => x.trim().split("=")[0])
            .filter(Boolean);
        } catch {
          /* access denied */
        }
        return { lsKeys, cookieKeys };
      })
      .catch(() => ({ lsKeys: [] as string[], cookieKeys: [] as string[] }));
    logger.warn(
      `[sit:auth] tanı — sayfa: ${page.url()}; localStorage anahtarları: [${
        info.lsKeys.join(", ") || "yok"
      }]; cookie anahtarları: [${info.cookieKeys.join(", ") || "yok"}]`,
    );
    await page
      .screenshot({ path: "/tmp/sit-login-state.png" })
      .catch(() => {});
  } catch {
    /* diagnostics are best-effort */
  }
}

/**
 * PRIMARY auth path — mint a Supabase access_token via the password grant,
 * bypassing the unreliable SPA login. Stores the token in capturedBearerByPage
 * (so collectAuth picks it up as the primary Bearer). Idempotent: returns early
 * if a Bearer is already held for the page. Non-fatal — on any failure it logs
 * (status + bearer=false only, never a secret) and returns false so the caller
 * falls back to the passive capture / storage read / UI scan.
 */
export async function mintSupabaseBearer(
  page: Page,
  creds: { user: string; password: string },
): Promise<boolean> {
  if (capturedBearerByPage.has(page)) return true;
  installSpaAuthCapture(page);

  const anonKey = await resolveAnonKey(page);
  if (!anonKey) {
    logger.warn(
      "[sit:auth] Supabase anon apikey yakalanamadı — password grant atlanıyor (bearer=false)",
    );
    await logSitLoginDiagnostics(page);
    return false;
  }

  try {
    const res = await page.request.post(SUPABASE_URL + SUPABASE_TOKEN_PATH, {
      headers: { apikey: anonKey, "content-type": "application/json" },
      data: { email: creds.user, password: creds.password },
      timeout: 20_000,
    });
    const status = res.status();
    if (!res.ok()) {
      logger.warn(
        `[sit:auth] Supabase password grant başarısız (status=${status}, bearer=false)`,
      );
      await logSitLoginDiagnostics(page);
      return false;
    }
    const body = (await res.json().catch(() => null)) as {
      access_token?: unknown;
    } | null;
    const token = body?.access_token;
    if (typeof token === "string" && JWT_RE.test(token)) {
      capturedBearerByPage.set(page, token);
      logger.info(
        `[sit:auth] Supabase access_token alındı (bearer=true, status=${status})`,
      );
      return true;
    }
    logger.warn(
      `[sit:auth] Supabase password grant yanıtında access_token yok (status=${status}, bearer=false)`,
    );
    await logSitLoginDiagnostics(page);
    return false;
  } catch (e) {
    logger.warn(
      `[sit:auth] Supabase password grant hata: ${
        e instanceof Error ? e.message : String(e)
      } (bearer=false)`,
    );
    await logSitLoginDiagnostics(page);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Redact PII value-keys so the STRUCTURE of a response is safe to log. Program
// / university names are deliberately NOT redacted (they are catalog data, not
// PII, and are needed to debug shape/matching), but any student identifier is.
// ---------------------------------------------------------------------------
function redactedStringify(value: unknown, max = 1000): string {
  try {
    const raw = JSON.stringify(value, (k, v) =>
      /email|passport|phone|password|token|address|tckn|national|firstname|lastname|surname|fullname|dob|birth/i.test(
        k,
      )
        ? "[redacted]"
        : v,
    );
    if (raw == null) return String(value);
    return raw.length > max ? `${raw.slice(0, max)}…(truncated)` : raw;
  } catch {
    return "(unserializable)";
  }
}

interface RawGqlResponse {
  status: number;
  ok: boolean;
  bodyText: string;
  threw: string;
  via: "page-fetch" | "request";
  xsrfSent: boolean;
  authSent: boolean;
}

interface SitAuth {
  xsrf?: string;
  bearer?: string;
  // The public anon apikey the SPA sends alongside the Bearer (harmless to
  // include on our own calls; some Supabase-fronted routes expect both).
  apiKey?: string;
  // Diagnostics (page URL + KEY NAMES only, never values) captured when no
  // bearer was found, so the caller can tell "token truly absent" from "wrong
  // page / key renamed / login flow changed" without ever logging a secret.
  bearerDiag?: { url: string; lsKeys: string[]; cookieKeys: string[] };
}

// ---------------------------------------------------------------------------
// Collect the authentication material the SIT API expects beyond the session
// cookie: the Laravel/axios X-XSRF-TOKEN (the XSRF-TOKEN cookie value, URL-
// decoded) and a best-effort bearer token the SPA may keep in web storage.
// The XSRF cookie is read from the BROWSER CONTEXT (page.context().cookies),
// which is reliable even if it is HttpOnly — reading document.cookie in-page
// would miss those. The bearer is the SUPABASE access_token: SIT authenticates
// GraphQL with `Authorization: Bearer <access_token>`.
//
// The session is written to web storage right AFTER login completes, so a
// single early read can miss it. We POLL (≤15s, 500ms interval) and check TWO
// sources each pass, returning the moment either yields a JWT:
//   1) localStorage `sb-<project-ref>-auth-token` — gotrue-js plain JSON.
//   2) cookie `sb-<project-ref>-auth-token` — @supabase/ssr `base64-<b64(JSON)>`
//      (decode via atob of the value after the "base64-" prefix).
// A generic JWT scan is kept as a last-resort fallback. When nothing is found
// we capture the storage/cookie KEY NAMES ONLY (never values) so the caller can
// distinguish "token truly absent" from "key renamed". Failures are non-fatal.
// ---------------------------------------------------------------------------
async function collectAuth(page: Page, baseUrl: string): Promise<SitAuth> {
  const auth: SitAuth = {};

  try {
    const cookies = await page.context().cookies(baseUrl);
    const xsrf = cookies.find((c) => c.name === "XSRF-TOKEN");
    if (xsrf?.value) auth.xsrf = decodeURIComponent(xsrf.value);
  } catch {
    /* cookie read failed — proceed without XSRF */
  }

  // PRIMARY bearer source — the Authorization header the SPA attaches to its
  // OWN /api/graphql requests, captured from the network. This is the live
  // token verbatim and far more reliable than reading web storage in the
  // headless context. installSpaAuthCapture is idempotent; the token is usually
  // already captured from the students-list load that preceded this call.
  installSpaAuthCapture(page);
  const anon = capturedAnonKeyByPage.get(page);
  if (anon) auth.apiKey = anon;
  let captured = capturedBearerByPage.get(page);
  if (!captured) {
    // Nothing captured yet — wait ONCE (bounded) for the SPA to fire an
    // authenticated graphql request we can observe. No blind retries.
    try {
      const req = await page.waitForRequest(
        (r) =>
          r.url().includes(GRAPHQL_PATH) &&
          BEARER_JWT_RE.test(r.headers()["authorization"] ?? ""),
        { timeout: 12_000 },
      );
      const m = (req.headers()["authorization"] ?? "").match(BEARER_JWT_RE);
      if (m) {
        capturedBearerByPage.set(page, m[1]);
        captured = m[1];
      }
    } catch {
      /* no SPA graphql request observed — fall back to storage read below */
    }
    captured = captured ?? capturedBearerByPage.get(page);
  }
  if (captured) {
    auth.bearer = captured;
    return auth;
  }

  try {
    const res = await page.evaluate(async () => {
      const looksLikeJwt = (v: unknown): v is string =>
        typeof v === "string" && /^ey[\w-]+\.[\w-]+\.[\w-]+$/.test(v);

      // Decode a Supabase session value. gotrue-js v2 stores the session as a
      // plain JSON object; @supabase/ssr stores it base64-encoded behind a
      // "base64-" prefix (used for the cookie form). Handle both.
      const parseSession = (raw: string | null): unknown => {
        if (!raw) return null;
        let text = raw;
        if (text.startsWith("base64-")) {
          try {
            text = atob(text.slice("base64-".length));
          } catch {
            return null;
          }
        }
        try {
          return JSON.parse(text);
        } catch {
          return null;
        }
      };

      // Pull the access_token out of a parsed Supabase session, tolerating the
      // top-level shape, the legacy `currentSession` wrapper, and array form.
      const extractAccessToken = (s: unknown): string | null => {
        let cand: unknown;
        if (Array.isArray(s)) {
          cand = (s[0] as { access_token?: unknown } | undefined)?.access_token;
        } else if (s && typeof s === "object") {
          const o = s as {
            access_token?: unknown;
            currentSession?: { access_token?: unknown };
          };
          cand = o.access_token ?? o.currentSession?.access_token;
        }
        return looksLikeJwt(cand) ? cand : null;
      };

      // Source 1 (authoritative) — localStorage `sb-<project-ref>-auth-token`.
      // The project ref changes per deployment, so discover the key dynamically.
      const readLocalStorage = (): string | null => {
        try {
          if (!window.localStorage) return null;
          const keys = Object.keys(window.localStorage).filter(
            (k) => k.startsWith("sb-") && k.endsWith("-auth-token"),
          );
          for (const k of keys) {
            const tok = extractAccessToken(
              parseSession(window.localStorage.getItem(k)),
            );
            if (tok) return tok;
          }
        } catch {
          /* access denied */
        }
        return null;
      };

      // Source 2 — cookie `sb-<project-ref>-auth-token` = `base64-<b64(JSON)>`
      // (the @supabase/ssr format). parseSession's base64- branch decodes it.
      const readCookie = (): string | null => {
        try {
          const c = document.cookie
            .split(";")
            .map((x) => x.trim())
            .find((x) => x.startsWith("sb-") && x.includes("-auth-token="));
          if (!c) return null;
          const value = decodeURIComponent(c.split("=").slice(1).join("="));
          return extractAccessToken(parseSession(value));
        } catch {
          return null;
        }
      };

      // Source 3 (last resort) — generic scan of web storage for any JWT-looking
      // value or token-ish JSON field (covers non-Supabase / future changes).
      const readHeuristic = (): string | null => {
        const stores: Storage[] = [];
        try {
          if (window.localStorage) stores.push(window.localStorage);
        } catch {
          /* access denied */
        }
        try {
          if (window.sessionStorage) stores.push(window.sessionStorage);
        } catch {
          /* access denied */
        }
        for (const store of stores) {
          let len = 0;
          try {
            len = store.length;
          } catch {
            len = 0;
          }
          for (let i = 0; i < len; i++) {
            const key = store.key(i);
            if (!key) continue;
            const val = store.getItem(key);
            if (!val) continue;
            if (looksLikeJwt(val)) return val;
            if (/token|auth|access|bearer|jwt/i.test(key)) {
              try {
                const parsed = JSON.parse(val) as Record<string, unknown>;
                const cand =
                  parsed?.token ??
                  parsed?.accessToken ??
                  parsed?.access_token ??
                  parsed?.authToken ??
                  parsed?.jwt ??
                  parsed?.value;
                if (looksLikeJwt(cand)) return cand;
              } catch {
                /* not JSON */
              }
            }
          }
        }
        return null;
      };

      // Poll ≤15s (30 × 500ms). The session appears right after login; return
      // the instant any source yields a JWT (happy path returns on pass 0 with
      // no delay). No blind retries — this is the ONLY wait.
      for (let i = 0; i < 30; i++) {
        const tok = readLocalStorage() || readCookie() || readHeuristic();
        if (tok) {
          return {
            bearer: tok,
            lsKeys: [] as string[],
            cookieKeys: [] as string[],
          };
        }
        await new Promise((r) => setTimeout(r, 500));
      }

      // Not found — capture KEY NAMES ONLY (never values) for diagnostics.
      let lsKeys: string[] = [];
      try {
        lsKeys = Object.keys(window.localStorage);
      } catch {
        /* access denied */
      }
      let cookieKeys: string[] = [];
      try {
        cookieKeys = document.cookie
          .split(";")
          .map((x) => x.trim().split("=")[0])
          .filter(Boolean);
      } catch {
        /* access denied */
      }
      return { bearer: null as string | null, lsKeys, cookieKeys };
    });

    if (res?.bearer) {
      auth.bearer = res.bearer;
    } else {
      auth.bearerDiag = {
        url: page.url(),
        lsKeys: res?.lsKeys ?? [],
        cookieKeys: res?.cookieKeys ?? [],
      };
    }
  } catch {
    /* storage/cookie read failed — proceed without bearer */
  }

  return auth;
}

// ---------------------------------------------------------------------------
// Transport 1 — page.request (Playwright's context request). It shares the
// browser's cookie jar and is NOT subject to CORS, so it always reaches the
// endpoint; we add the X-XSRF-TOKEN / bearer headers (and Origin/Referer) that
// a cookie-only request was missing. This is the primary path because it is the
// one we KNOW reaches the server (it returned HTTP 200 in production).
// ---------------------------------------------------------------------------
async function postViaRequest(
  page: Page,
  url: string,
  baseUrl: string,
  query: string,
  variables: Record<string, unknown>,
  auth: SitAuth,
): Promise<RawGqlResponse> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
    "x-requested-with": "XMLHttpRequest",
    origin: baseUrl,
    referer: baseUrl + "/",
  };
  if (auth.xsrf) headers["X-XSRF-TOKEN"] = auth.xsrf;
  if (auth.bearer) headers["authorization"] = "Bearer " + auth.bearer;
  if (auth.apiKey) headers["apikey"] = auth.apiKey;

  try {
    const res = await page.request.post(url, {
      data: { query, variables },
      headers,
      timeout: 20_000,
    });
    return {
      status: res.status(),
      ok: res.ok(),
      bodyText: await res.text(),
      threw: "",
      via: "request",
      xsrfSent: !!auth.xsrf,
      authSent: !!auth.bearer,
    };
  } catch (e) {
    return {
      status: 0,
      ok: false,
      bodyText: "",
      threw: e instanceof Error ? e.message : String(e),
      via: "request",
      xsrfSent: !!auth.xsrf,
      authSent: !!auth.bearer,
    };
  }
}

// ---------------------------------------------------------------------------
// Transport 2 — in-page window.fetch (SPA-faithful). Uses a RELATIVE path so it
// is always same-origin with the current page (an absolute cross-origin URL is
// what makes the browser throw), credentials:"include" for cookies, plus the
// XSRF/bearer headers. Secondary because it can be blocked by CSP or a
// destroyed execution context; used when transport 1 does not yield data.
// ---------------------------------------------------------------------------
async function postViaPageFetch(
  page: Page,
  path: string,
  query: string,
  variables: Record<string, unknown>,
  auth: SitAuth,
): Promise<RawGqlResponse> {
  try {
    const result = await page.evaluate(
      async (args: {
        path: string;
        query: string;
        variables: Record<string, unknown>;
        xsrf: string | null;
        bearer: string | null;
        apiKey: string | null;
      }) => {
        const headers: Record<string, string> = {
          "content-type": "application/json",
          accept: "application/json",
          "x-requested-with": "XMLHttpRequest",
        };
        if (args.xsrf) headers["X-XSRF-TOKEN"] = args.xsrf;
        if (args.bearer) headers["authorization"] = "Bearer " + args.bearer;
        if (args.apiKey) headers["apikey"] = args.apiKey;

        let status = 0;
        let ok = false;
        let bodyText = "";
        let threw = "";
        try {
          const resp = await fetch(args.path, {
            method: "POST",
            credentials: "include",
            headers,
            body: JSON.stringify({
              query: args.query,
              variables: args.variables,
            }),
          });
          status = resp.status;
          ok = resp.ok;
          bodyText = await resp.text();
        } catch (e) {
          threw = e instanceof Error ? e.message : String(e);
        }
        return { status, ok, bodyText, threw };
      },
      {
        path,
        query,
        variables,
        xsrf: auth.xsrf ?? null,
        bearer: auth.bearer ?? null,
        apiKey: auth.apiKey ?? null,
      },
    );
    return {
      ...result,
      via: "page-fetch",
      xsrfSent: !!auth.xsrf,
      authSent: !!auth.bearer,
    };
  } catch (e) {
    return {
      status: 0,
      ok: false,
      bodyText: "",
      threw: e instanceof Error ? e.message : String(e),
      via: "page-fetch",
      xsrfSent: !!auth.xsrf,
      authSent: !!auth.bearer,
    };
  }
}

// ---------------------------------------------------------------------------
// Interpret a raw transport response into either parsed data or a classified,
// human-readable failure. Separated from transport so each attempt can be
// logged and we can decide whether a second transport is worth trying.
// ---------------------------------------------------------------------------
type Interpretation<T> =
  | { kind: "ok"; data: T }
  // "gotData" means the API DID return non-null data (auth works); the shape
  // just did not match — retrying another transport cannot change that.
  | { kind: "gotData"; message: string }
  // recoverable: another transport (or a re-auth) might succeed.
  | { kind: "retry"; message: string };

function interpret<S extends z.ZodTypeAny>(
  raw: RawGqlResponse,
  dataSchema: S,
): Interpretation<z.infer<S>> {
  if (raw.threw) {
    return { kind: "retry", message: `request failed: ${raw.threw}` };
  }

  let body: unknown;
  try {
    body = JSON.parse(raw.bodyText);
  } catch {
    // A non-JSON body (typically an HTML login page) is the classic "session
    // not accepted" symptom. Strip JWTs and CSRF/token attribute values so a
    // login page embedding a token/meta tag cannot leak it into the logs.
    const snippet = raw.bodyText
      .replace(/\s+/g, " ")
      .replace(/ey[\w-]+\.[\w-]+\.[\w-]+/g, "[redacted-jwt]")
      .replace(
        /((?:csrf|token|xsrf|authenticity)[\w-]*["']?\s*[:=]\s*["']?)[^"'\s>]+/gi,
        "$1[redacted]",
      )
      .trim()
      .slice(0, 300);
    return {
      kind: "retry",
      message: `non-JSON response (likely an unauthenticated redirect). First 300 chars: ${snippet}`,
    };
  }

  const envelope = z
    .object({
      data: z.unknown().optional(),
      errors: z.array(z.object({ message: z.string() })).optional(),
    })
    .safeParse(body);

  if (!envelope.success) {
    const keys =
      body && typeof body === "object"
        ? Object.keys(body).join(", ")
        : typeof body;
    return {
      kind: "retry",
      message: `malformed response envelope — top-level keys: [${keys}]`,
    };
  }

  // Surface GraphQL errors verbatim (e.g. "Unauthenticated.", "Cannot query
  // field X") — the actual cause the old code hid behind "null".
  if (envelope.data.errors && envelope.data.errors.length > 0) {
    return {
      kind: "retry",
      message: `GraphQL errors: ${envelope.data.errors
        .map((e) => e.message)
        .join("; ")}`,
    };
  }

  // `data: null` with NO errors ≈ request not accepted as authenticated.
  if (envelope.data.data == null) {
    return {
      kind: "retry",
      message: `server returned data:null with no errors — request likely not accepted as authenticated (session/CSRF/token)`,
    };
  }

  const parsed = dataSchema.safeParse(envelope.data.data);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const at = issue?.path?.length ? ` at "${issue.path.join(".")}"` : "";
    return {
      kind: "gotData",
      message: `data shape mismatch${at} — actual response shape: ${redactedStringify(
        envelope.data.data,
      )}`,
    };
  }
  return { kind: "ok", data: parsed.data };
}

// ---------------------------------------------------------------------------
// Low-level request — POST { query, variables }, validate envelope + data.
// Tries transport 1 (page.request + auth headers) then, if that does not yield
// usable data, transport 2 (in-page fetch). Each failed attempt is logged with
// the transport, HTTP status, and which credentials were attached.
// ---------------------------------------------------------------------------
async function gqlRequest<S extends z.ZodTypeAny>(
  page: Page,
  query: string,
  variables: Record<string, unknown>,
  dataSchema: S,
  label: string,
): Promise<z.infer<S> | null> {
  const absUrl = SIT_URLS.base + GRAPHQL_PATH;
  const auth = await collectAuth(page, SIT_URLS.base);

  // The SIT /api/graphql endpoint authenticates with the Supabase Bearer
  // access_token — without it the server returns HTTP 200 with data:null (never
  // an auth error). If no token was found, say so ONCE and clearly rather than
  // hammering both transports and logging opaque "data:null" twice.
  if (!auth.bearer) {
    // KEY NAMES ONLY (no values) so we can tell "truly absent" from "renamed".
    const diag = auth.bearerDiag;
    const keyInfo = diag
      ? ` — sayfa: ${diag.url}; localStorage anahtarları: [${
          diag.lsKeys.join(", ") || "yok"
        }]; cookie anahtarları: [${diag.cookieKeys.join(", ") || "yok"}]`
      : "";
    logger.warn(
      `[sit:graphql] ${label}: Supabase token bulunamadı — login akışı değişti mi? (Authorization: Bearer eklenemedi) — GraphQL atlanıyor, UI taramasına düşülecek${keyInfo}`,
    );
    // Without the Bearer token the endpoint only ever returns data:null, so
    // don't blindly hammer both transports — bail to the caller's UI fallback.
    return null;
  }

  const attempts: Array<() => Promise<RawGqlResponse>> = [
    () => postViaRequest(page, absUrl, SIT_URLS.base, query, variables, auth),
    () => postViaPageFetch(page, GRAPHQL_PATH, query, variables, auth),
  ];

  for (const run of attempts) {
    const raw = await run();
    const meta = `HTTP ${raw.status} via ${raw.via} xsrf=${raw.xsrfSent} bearer=${raw.authSent}`;
    const result = interpret(raw, dataSchema);

    if (result.kind === "ok") {
      logger.info(`[sit:graphql] ${label}: OK — data received (${meta})`);
      return result.data;
    }

    logger.warn(`[sit:graphql] ${label}: ${result.message} (${meta})`);

    // The API returned data but the shape didn't match — another transport
    // would return the same shape, so stop and let the caller scan the UI.
    if (result.kind === "gotData") return null;
    // Otherwise (auth/empty/error/network) fall through to the next transport.
  }

  return null;
}

/**
 * A GraphQL connection that may arrive in any of the common shapes:
 *   - `{ nodes: [...] }`            (nodes-style connection)
 *   - `{ edges: [{ node: ... }] }` (Relay edges/node connection)
 *   - `[...]`                       (bare array)
 *   - `null`                        (empty result — no rows)
 * Returns a schema that normalises ALL of them to `{ nodes: T[] }` so
 * downstream code has one shape to consume. Accepting an explicit `null` is
 * important: SIT returns a null connection when a search yields no rows, which
 * must be read as "no records" (→ create flow) rather than logged as a shape
 * mismatch and retried. A genuinely ABSENT field (undefined) is intentionally
 * NOT accepted so real schema drift still surfaces via the mismatch diagnostic.
 */
function connection<T extends z.ZodTypeAny>(
  node: T,
): z.ZodType<{ nodes: z.infer<T>[] }> {
  return z
    .union([
      z.object({ nodes: z.array(node) }),
      z.object({ edges: z.array(z.object({ node })) }),
      z.array(node),
      z.null(),
    ])
    .transform((v) => {
      if (v == null) return { nodes: [] as z.infer<T>[] };
      if (Array.isArray(v)) return { nodes: v };
      if ("edges" in v) return { nodes: v.edges.map((e) => e.node) };
      return v;
    }) as z.ZodType<{ nodes: z.infer<T>[] }>;
}

// ---------------------------------------------------------------------------
// Student lookup (idempotency) — match by email or passport.
// ---------------------------------------------------------------------------
export interface SitStudentRef {
  id: string;
  email?: string;
  passportNumber?: string;
}

const STUDENT_SEARCH_QUERY = /* GraphQL */ `
  query StudentSearch($q: String!) {
    students(search: $q, first: 25) {
      nodes { id email passportNumber }
    }
  }
`;

const studentSearchSchema = z.object({
  students: connection(
    z.object({
      id: z.union([z.string(), z.number()]).transform((v) => String(v)),
      email: z.string().nullish(),
      passportNumber: z.string().nullish(),
    }),
  ),
});

/**
 * Find an existing SIT student by email or passport (read-only, for
 * idempotency). Returns the first record whose email or passport matches
 * case-insensitively, or null when none / GraphQL unavailable.
 */
export async function findStudent(
  page: Page,
  by: { email?: string; passportNumber?: string },
): Promise<SitStudentRef | null> {
  const q = (by.email || by.passportNumber || "").trim();
  if (!q) return null;

  const data = await gqlRequest(
    page,
    STUDENT_SEARCH_QUERY,
    { q },
    studentSearchSchema,
    "studentSearch",
  );
  if (!data) return null;

  const email = by.email?.trim().toLowerCase();
  const passport = by.passportNumber?.trim().toLowerCase();

  for (const node of data.students.nodes) {
    const nodeEmail = node.email?.trim().toLowerCase();
    const nodePassport = node.passportNumber?.trim().toLowerCase();
    if (email && nodeEmail && nodeEmail === email) {
      return { id: node.id, email: node.email ?? undefined, passportNumber: node.passportNumber ?? undefined };
    }
    if (passport && nodePassport && nodePassport === passport) {
      return { id: node.id, email: node.email ?? undefined, passportNumber: node.passportNumber ?? undefined };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Existing-application lookup (dedup) for a known student.
// ---------------------------------------------------------------------------
export interface SitApplicationRef {
  id: string;
  universityName?: string;
  programName?: string;
  status?: string;
}

const STUDENT_APPLICATIONS_QUERY = /* GraphQL */ `
  query StudentApplications($studentId: ID!) {
    student(id: $studentId) {
      applications(first: 100) {
        nodes { id status university { name } program { name } }
      }
    }
  }
`;

const studentApplicationsSchema = z.object({
  student: z
    .object({
      applications: connection(
        z.object({
          id: z.union([z.string(), z.number()]).transform((v) => String(v)),
          status: z.string().nullish(),
          university: z.object({ name: z.string().nullish() }).nullish(),
          program: z.object({ name: z.string().nullish() }).nullish(),
        }),
      ),
    })
    .nullish(),
});

/**
 * List a student's existing applications (read-only, for dedup). Returns [] on
 * unavailability so the caller treats "unknown" as "no known duplicate".
 */
export async function listStudentApplications(
  page: Page,
  studentId: string,
): Promise<SitApplicationRef[]> {
  const data = await gqlRequest(
    page,
    STUDENT_APPLICATIONS_QUERY,
    { studentId },
    studentApplicationsSchema,
    "studentApplications",
  );
  if (!data || !data.student) return [];

  return data.student.applications.nodes.map((n) => ({
    id: n.id,
    status: n.status ?? undefined,
    universityName: n.university?.name ?? undefined,
    programName: n.program?.name ?? undefined,
  }));
}

// ---------------------------------------------------------------------------
// Program catalog (paginated, active programs only) for a given university.
// Scoping the catalog to ONE university is what makes program matching exact
// even when many universities share a program name.
// ---------------------------------------------------------------------------
const PROGRAMS_QUERY = /* GraphQL */ `
  query Programs($universityName: String!, $level: String, $after: String) {
    programs(universityName: $universityName, level: $level, active: true, first: 100, after: $after) {
      nodes { id name }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const programsSchema = z.object({
  programs: z.union([
    z.object({
      nodes: z.array(
        z.object({
          id: z.union([z.string(), z.number()]).transform((v) => String(v)),
          name: z.string(),
        }),
      ),
      // pageInfo is optional: a non-paginated live schema simply omits it, in
      // which case we treat the single page as complete.
      pageInfo: z
        .object({
          hasNextPage: z.boolean().nullish(),
          endCursor: z.string().nullish(),
        })
        .nullish(),
    }),
    z.array(
      z.object({
        id: z.union([z.string(), z.number()]).transform((v) => String(v)),
        name: z.string(),
      }),
    ),
  ]),
});

/**
 * Fetch the full active-program catalog for a university (read-only), following
 * pagination. Returns [] on unavailability so the caller falls back to scanning
 * the program combobox in the UI.
 */
export async function fetchProgramCatalog(
  page: Page,
  universityName: string,
  level?: string,
): Promise<ProgramCandidate[]> {
  const out: ProgramCandidate[] = [];
  let after: string | null = null;

  for (let pageNo = 0; pageNo < 25; pageNo++) {
    const data: z.infer<typeof programsSchema> | null = await gqlRequest(
      page,
      PROGRAMS_QUERY,
      { universityName, level: level ?? null, after },
      programsSchema,
      "programs",
    );
    if (!data) break;

    // Normalise `{ nodes, pageInfo }` vs bare-array shapes.
    type ProgramNode = { id: string; name: string };
    type ProgramsPageInfo = {
      hasNextPage?: boolean | null;
      endCursor?: string | null;
    };
    const programsField = data.programs as
      | { nodes: ProgramNode[]; pageInfo?: ProgramsPageInfo | null }
      | ProgramNode[];
    let nodes: ProgramNode[];
    let pageInfo: ProgramsPageInfo | undefined;
    if (Array.isArray(programsField)) {
      nodes = programsField;
      pageInfo = undefined;
    } else {
      nodes = programsField.nodes;
      pageInfo = programsField.pageInfo ?? undefined;
    }

    for (const n of nodes) {
      out.push({ id: n.id, name: n.name });
    }

    if (!pageInfo?.hasNextPage || !pageInfo.endCursor) {
      break;
    }
    after = pageInfo.endCursor;
  }

  return out;
}
