// ---------------------------------------------------------------------------
// SIT portal — READ-ONLY GraphQL client
//
// SIT exposes a GraphQL endpoint at POST /api/graphql. We use it STRICTLY for
// read-only lookups (idempotency + catalog), never for writes — all writes go
// through the portal UI (SIT's write mutations are non-functional for partner
// accounts).
//
// AUTH: the POST is issued from INSIDE the authenticated page context
// (page.evaluate → window.fetch with credentials:"include"). This is what makes
// the request carry the SPA's full session — same-origin cookies AND the extra
// bits a cookie-only client (page.request) silently drops: the Laravel/axios
// `X-XSRF-TOKEN` header echoed from the XSRF-TOKEN cookie, a best-effort
// `Authorization: Bearer` read from local/sessionStorage when the app keeps its
// token there, and the correct Origin/Referer. The symptom of the missing
// header/token was a 200 response with `data: null` (never surfaced as an auth
// error), which used to be logged only as "shape mismatch — null".
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

// ---------------------------------------------------------------------------
// Issue the POST from inside the authenticated page context. window.fetch with
// credentials:"include" carries the session cookies AND the Origin/Referer the
// server may require; we additionally attach the Laravel/axios X-XSRF-TOKEN
// header (echoed from the XSRF-TOKEN cookie) and a best-effort bearer token
// discovered in local/sessionStorage. page.request (cookies only) is used ONLY
// as a fallback if the in-page fetch itself throws (e.g. blocked by CSP).
// ---------------------------------------------------------------------------
async function postGraphqlInPage(
  page: Page,
  url: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<RawGqlResponse> {
  const result = await page.evaluate(
    async (args: {
      url: string;
      query: string;
      variables: Record<string, unknown>;
    }) => {
      const readCookie = (name: string): string | null => {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const src = typeof document !== "undefined" ? document.cookie : "";
        const m = src.match(new RegExp("(?:^|; )" + escaped + "=([^;]*)"));
        return m ? decodeURIComponent(m[1]) : null;
      };
      const looksLikeJwt = (v: unknown): v is string =>
        typeof v === "string" && /^ey[\w-]+\.[\w-]+\.[\w-]+$/.test(v);
      const findBearer = (): string | null => {
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

      const headers: Record<string, string> = {
        "content-type": "application/json",
        accept: "application/json",
        "x-requested-with": "XMLHttpRequest",
      };
      const xsrf = readCookie("XSRF-TOKEN");
      if (xsrf) headers["X-XSRF-TOKEN"] = xsrf;
      const bearer = findBearer();
      if (bearer) headers["authorization"] = "Bearer " + bearer;

      let status = 0;
      let ok = false;
      let bodyText = "";
      let threw = "";
      try {
        const resp = await fetch(args.url, {
          method: "POST",
          credentials: "include",
          headers,
          body: JSON.stringify({ query: args.query, variables: args.variables }),
        });
        status = resp.status;
        ok = resp.ok;
        bodyText = await resp.text();
      } catch (e) {
        threw = e instanceof Error ? e.message : String(e);
      }
      return { status, ok, bodyText, threw, xsrfSent: !!xsrf, authSent: !!bearer };
    },
    { url, query, variables },
  );
  return { ...result, via: "page-fetch" };
}

async function postGraphql(
  page: Page,
  url: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<RawGqlResponse> {
  let inPage: RawGqlResponse;
  try {
    inPage = await postGraphqlInPage(page, url, query, variables);
  } catch (e) {
    inPage = {
      status: 0,
      ok: false,
      bodyText: "",
      threw: e instanceof Error ? e.message : String(e),
      via: "page-fetch",
      xsrfSent: false,
      authSent: false,
    };
  }
  if (!inPage.threw) return inPage;

  // Fallback: cookie-only request context (does not carry XSRF/bearer).
  try {
    const res = await page.request.post(url, {
      data: { query, variables },
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "x-requested-with": "XMLHttpRequest",
      },
      timeout: 20_000,
    });
    return {
      status: res.status(),
      ok: res.ok(),
      bodyText: await res.text(),
      threw: "",
      via: "request",
      xsrfSent: false,
      authSent: false,
    };
  } catch (e) {
    return {
      status: 0,
      ok: false,
      bodyText: "",
      threw: `${inPage.threw} | fallback: ${e instanceof Error ? e.message : String(e)}`,
      via: "request",
      xsrfSent: false,
      authSent: false,
    };
  }
}

// ---------------------------------------------------------------------------
// Low-level request — POST { query, variables }, validate envelope + data.
// ---------------------------------------------------------------------------
async function gqlRequest<S extends z.ZodTypeAny>(
  page: Page,
  query: string,
  variables: Record<string, unknown>,
  dataSchema: S,
  label: string,
): Promise<z.infer<S> | null> {
  const raw = await postGraphql(
    page,
    SIT_URLS.base + GRAPHQL_PATH,
    query,
    variables,
  );
  const meta =
    `HTTP ${raw.status} via ${raw.via}` +
    `${raw.xsrfSent ? " +xsrf" : ""}${raw.authSent ? " +bearer" : ""}`;

  if (raw.threw) {
    logger.warn(`[sit:graphql] ${label}: request failed (${meta}): ${raw.threw}`);
    return null;
  }

  let body: unknown;
  try {
    body = JSON.parse(raw.bodyText);
  } catch {
    // A non-JSON body (typically an HTML login page) is the classic "session
    // not accepted" symptom — surface the status + a bounded snippet. Strip
    // JWTs and any CSRF/token attribute values first so a login page that
    // embeds a token/meta tag cannot leak it into the logs.
    const snippet = raw.bodyText
      .replace(/\s+/g, " ")
      .replace(/ey[\w-]+\.[\w-]+\.[\w-]+/g, "[redacted-jwt]")
      .replace(
        /((?:csrf|token|xsrf|authenticity)[\w-]*["']?\s*[:=]\s*["']?)[^"'\s>]+/gi,
        "$1[redacted]",
      )
      .trim()
      .slice(0, 300);
    logger.warn(
      `[sit:graphql] ${label}: non-JSON response (${meta}) — likely an unauthenticated redirect. First 300 chars: ${snippet}`,
    );
    return null;
  }

  const envelope = z
    .object({
      data: z.unknown().optional(),
      errors: z.array(z.object({ message: z.string() })).optional(),
    })
    .safeParse(body);

  if (!envelope.success) {
    logger.warn(
      `[sit:graphql] ${label}: malformed response envelope (${meta}) — top-level keys: [${
        body && typeof body === "object" ? Object.keys(body).join(", ") : typeof body
      }]`,
    );
    return null;
  }

  // Surface GraphQL errors verbatim (e.g. "Unauthenticated.", "Cannot query
  // field X") — these are the actual cause the old code hid behind "null".
  if (envelope.data.errors && envelope.data.errors.length > 0) {
    logger.warn(
      `[sit:graphql] ${label}: GraphQL errors (${meta}): ` +
        envelope.data.errors.map((e) => e.message).join("; "),
    );
    return null;
  }

  // `data: null` with NO errors is an ambiguous "empty/blocked" response. Most
  // often it means the request was not authenticated at the API layer even
  // though the browser page is logged in — log it explicitly (with whether the
  // credentials were attached) instead of the useless "shape mismatch — null".
  if (envelope.data.data == null) {
    logger.warn(
      `[sit:graphql] ${label}: server returned data:null with no errors (${meta}) — the GraphQL request was likely not accepted as authenticated (session/CSRF/token). Sent xsrf=${raw.xsrfSent} bearer=${raw.authSent}.`,
    );
    return null;
  }

  const parsed = dataSchema.safeParse(envelope.data.data);
  if (!parsed.success) {
    // Shape mismatch is non-fatal: the caller falls back to scanning the UI.
    // Logged (with the failing field path + query label) rather than thrown,
    // and never retried, so a diverging live schema degrades gracefully
    // instead of looping. The live schema may return a connection as
    // `{ nodes: [...] }`, `{ edges: [{ node }] }`, a bare array, or null —
    // all accepted by the schemas below, so this only fires on a genuinely
    // unexpected shape. When it does, dump the ACTUAL response data (bounded,
    // PII-redacted) so the true live shape can be read straight from the run
    // logs and the parser adjusted, instead of guessing.
    const issue = parsed.error.issues[0];
    const at = issue?.path?.length ? ` at "${issue.path.join(".")}"` : "";
    logger.warn(
      `[sit:graphql] ${label}: data shape mismatch${at} (${meta}) — actual response shape: ${redactedStringify(
        envelope.data.data,
      )}`,
    );
    return null;
  }
  return parsed.data;
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
