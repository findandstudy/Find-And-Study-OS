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
): Promise<z.infer<S> | null> {
  try {
    const res = await page.request.post(SIT_URLS.base + GRAPHQL_PATH, {
      data: { query, variables },
      headers: { "content-type": "application/json", accept: "application/json" },
      timeout: 20_000,
    });

    if (!res.ok()) {
      logger.warn(`[sit:graphql] HTTP ${res.status()}`);
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
      logger.warn("[sit:graphql] malformed response envelope");
      return null;
    }
    if (envelope.data.errors && envelope.data.errors.length > 0) {
      logger.warn(
        "[sit:graphql] errors: " +
          envelope.data.errors.map((e) => e.message).join("; "),
      );
      return null;
    }

    const parsed = dataSchema.safeParse(envelope.data.data);
    if (!parsed.success) {
      logger.warn("[sit:graphql] data shape mismatch");
      return null;
    }
    return parsed.data;
  } catch (e) {
    logger.warn(
      "[sit:graphql] request failed: " +
        (e instanceof Error ? e.message : String(e)),
    );
    return null;
  }
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
  students: z.object({
    nodes: z.array(
      z.object({
        id: z.union([z.string(), z.number()]).transform((v) => String(v)),
        email: z.string().nullish(),
        passportNumber: z.string().nullish(),
      }),
    ),
  }),
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

  const data = await gqlRequest(page, STUDENT_SEARCH_QUERY, { q }, studentSearchSchema);
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
      applications: z.object({
        nodes: z.array(
          z.object({
            id: z.union([z.string(), z.number()]).transform((v) => String(v)),
            status: z.string().nullish(),
            university: z.object({ name: z.string().nullish() }).nullish(),
            program: z.object({ name: z.string().nullish() }).nullish(),
          }),
        ),
      }),
    })
    .nullable(),
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
  programs: z.object({
    nodes: z.array(
      z.object({
        id: z.union([z.string(), z.number()]).transform((v) => String(v)),
        name: z.string(),
      }),
    ),
    pageInfo: z.object({
      hasNextPage: z.boolean(),
      endCursor: z.string().nullish(),
    }),
  }),
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
    );
    if (!data) break;

    for (const n of data.programs.nodes) {
      out.push({ id: n.id, name: n.name });
    }

    if (!data.programs.pageInfo.hasNextPage || !data.programs.pageInfo.endCursor) {
      break;
    }
    after = data.programs.pageInfo.endCursor;
  }

  return out;
}
