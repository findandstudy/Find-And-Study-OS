// ---------------------------------------------------------------------------
// SIT portal — READ-ONLY GraphQL client
//
// SIT exposes a GraphQL endpoint at POST /api/graphql. We use it STRICTLY for
// read-only lookups (idempotency + catalog), never for writes — all writes go
// through the portal UI (SIT's write mutations are non-functional for partner
// accounts). Requests reuse the authenticated Playwright session's cookies via
// page.request, so no separate auth is needed.
//
// Every response is validated with zod and narrowed to a typed shape; on any
// network error, GraphQL error, or shape mismatch the helpers return null/[]
// so the adapter can fall back to scanning the UI (graceful degradation —
// the live schema may evolve).
// ---------------------------------------------------------------------------

import { z } from "zod";
import type { Page } from "playwright-core";
import { logger } from "../../browser.js";
import type { ProgramCandidate } from "../../programMatch.js";
import { SIT_URLS } from "./selectors.js";

const GRAPHQL_PATH = "/api/graphql";

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
  try {
    const res = await page.request.post(SIT_URLS.base + GRAPHQL_PATH, {
      data: { query, variables },
      headers: { "content-type": "application/json", accept: "application/json" },
      timeout: 20_000,
    });

    if (!res.ok()) {
      logger.warn(`[sit:graphql] ${label}: HTTP ${res.status()}`);
      return null;
    }

    const body: unknown = await res.json();
    const envelope = z
      .object({
        data: z.unknown().optional(),
        errors: z.array(z.object({ message: z.string() })).optional(),
      })
      .safeParse(body);

    if (!envelope.success) {
      logger.warn(`[sit:graphql] ${label}: malformed response envelope`);
      return null;
    }
    if (envelope.data.errors && envelope.data.errors.length > 0) {
      logger.warn(
        `[sit:graphql] ${label}: errors: ` +
          envelope.data.errors.map((e) => e.message).join("; "),
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
      // unexpected shape. When it does, dump the ACTUAL response data (bounded)
      // so the true live shape can be read straight from the run logs and the
      // parser adjusted, instead of guessing.
      const issue = parsed.error.issues[0];
      const at = issue?.path?.length ? ` at "${issue.path.join(".")}"` : "";
      let shape: string;
      try {
        // Redact PII value keys (email/passport/phone) so the STRUCTURE of the
        // live response is visible in logs without leaking student data.
        const raw = JSON.stringify(envelope.data.data, (k, v) =>
          /email|passport|phone|password|token|address|tckn|national/i.test(k)
            ? "[redacted]"
            : v,
        );
        shape =
          raw && raw.length > 1000 ? `${raw.slice(0, 1000)}…(truncated)` : raw;
      } catch {
        shape = "(unserializable)";
      }
      logger.warn(
        `[sit:graphql] ${label}: data shape mismatch${at} — actual response shape: ${shape}`,
      );
      return null;
    }
    return parsed.data;
  } catch (e) {
    logger.warn(
      `[sit:graphql] ${label}: request failed: ` +
        (e instanceof Error ? e.message : String(e)),
    );
    return null;
  }
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
