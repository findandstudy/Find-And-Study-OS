/**
 * declarative/schema.ts — Zod schema + types for the DB-backed declarative
 * adapter SPEC format (the richer successor to the flat DeclarativeConfig).
 *
 * A "spec" describes an entire portal application flow — login, form steps,
 * document slots, program selection and success/failure detection — as a
 * single JSON-serialisable object that the interpreter (`interpreter.ts`)
 * executes against a Playwright page. Specs are stored in the
 * `portal_adapter_specs` table and uploaded/validated/versioned from the
 * Adapters tab. The existing flat `DeclarativeConfig` (portal_adapters table)
 * stays untouched — this is an opt-in parallel system.
 *
 * Design notes
 * ------------
 * - TS types are DERIVED from the zod schemas (`z.infer`) so the validator and
 *   the compile-time types can never drift.
 * - URL fields reuse the api-server SSRF guard (`isSafePortalUrl`): https only,
 *   no loopback/private/link-local/metadata hosts.
 * - Profile references use a `profile.<field>` path validated against the
 *   canonical `PROFILE_FIELDS` list (single source shared with dbLoader).
 * - `jsHook` steps are accepted by the schema but only EXECUTED for trusted
 *   specs (builtin source, or super_admin-approved). The schema is not the
 *   security boundary — the interpreter + endpoints are. See interpreter.ts.
 */

import { z } from "zod";
import { isSafePortalUrl, PROFILE_FIELDS, FILE_FIELDS } from "../shared.js";

// ---------------------------------------------------------------------------
// Shared leaf schemas
// ---------------------------------------------------------------------------

const safeUrlSchema = z
  .string()
  .url()
  .refine(isSafePortalUrl, {
    message:
      "URL must be https and must not target a private/loopback/link-local/metadata host",
  });

const profileFieldSchema = z.enum(PROFILE_FIELDS);
const fileFieldSchema = z.enum(FILE_FIELDS);

/** A `profile.<field>` reference, e.g. "profile.email". The field part must be
 *  a known SubmitProfile key. */
export const profilePathSchema = z
  .string()
  .regex(/^profile\.[a-zA-Z]+$/, {
    message: 'valueFrom must be of the form "profile.<field>"',
  })
  .refine(
    (s) => (PROFILE_FIELDS as readonly string[]).includes(s.slice("profile.".length)),
    { message: `unknown profile field (expected one of: ${PROFILE_FIELDS.join(", ")})` },
  );

/**
 * Value transform applied to a resolved profile value before it is typed into
 * the portal.
 *  - override : table[value] ?? value   (keep original when no mapping exists)
 *  - map      : table[value] ?? value   (alias of override; explicit intent)
 *  - fuzzy    : fuzzy-match against live <option> labels (only meaningful in
 *               programSelection, where candidate options exist). Elsewhere a
 *               fuzzy transform is a no-op passthrough.
 */
export const transformSchema = z.object({
  type: z.enum(["override", "map", "fuzzy"]),
  table: z.record(z.string(), z.string()).optional(),
  threshold: z.number().min(0).max(1).optional(),
});

// ---------------------------------------------------------------------------
// Step schemas (discriminated by `action`)
// ---------------------------------------------------------------------------

const navigateStep = z.object({
  action: z.literal("navigate"),
  url: safeUrlSchema,
  optional: z.boolean().optional(),
});

// NOTE: the "exactly one of value/valueFrom" rule is enforced in the
// top-level superRefine (below) rather than via `.refine()` here, because
// discriminatedUnion members must be plain ZodObjects (a ZodEffects from
// `.refine()` is rejected by z.discriminatedUnion).
const fillStep = z.object({
  action: z.literal("fill"),
  selector: z.string().min(1),
  value: z.string().optional(),
  valueFrom: profilePathSchema.optional(),
  transform: transformSchema.optional(),
  optional: z.boolean().optional(),
});

const selectStep = z.object({
  action: z.literal("select"),
  selector: z.string().min(1),
  valueFrom: profilePathSchema,
  /** Select by visible option label instead of value attribute. */
  byLabel: z.boolean().optional(),
  transform: transformSchema.optional(),
  optional: z.boolean().optional(),
});

const clickStep = z.object({
  action: z.literal("click"),
  selector: z.string().min(1),
  /** Marks the terminal submit click — skipped in dry-run. */
  final: z.boolean().optional(),
  optional: z.boolean().optional(),
});

const uploadStep = z.object({
  action: z.literal("upload"),
  selector: z.string().min(1),
  /** Document slot key (see documents.slots) or a SubmitFiles field. */
  slot: z.string().min(1),
  optional: z.boolean().optional(),
});

const checkStep = z.object({
  action: z.literal("check"),
  selector: z.string().min(1),
  value: z.boolean().optional(),
  optional: z.boolean().optional(),
});

const radioStep = z.object({
  action: z.literal("radio"),
  valueFrom: profilePathSchema,
  map: z.record(z.string().min(1), z.string().min(1)),
  fallback: z.string().min(1).optional(),
  optional: z.boolean().optional(),
});

const waitForStep = z.object({
  action: z.literal("waitFor"),
  selector: z.string().min(1),
  optional: z.boolean().optional(),
});

const ajaxWaitStep = z.object({
  action: z.literal("ajaxWait"),
  /** Substring of the XHR/fetch URL to await (best-effort; needs page support). */
  urlContains: z.string().min(1),
  timeoutMs: z.number().int().positive().max(120000).optional(),
  optional: z.boolean().optional(),
});

const jsHookStep = z.object({
  action: z.literal("jsHook"),
  /** Arbitrary page.evaluate() expression. Executed ONLY for trusted specs. */
  script: z.string().min(1),
  optional: z.boolean().optional(),
});

export const specStepSchema = z.discriminatedUnion("action", [
  navigateStep,
  fillStep,
  selectStep,
  clickStep,
  uploadStep,
  checkStep,
  radioStep,
  waitForStep,
  ajaxWaitStep,
  jsHookStep,
]);

// ---------------------------------------------------------------------------
// Top-level blocks
// ---------------------------------------------------------------------------

export const metaSchema = z.object({
  key: z.string().min(1).regex(/^[a-z0-9_-]+$/, {
    message: "key must be lowercase letters, digits, underscores or hyphens",
  }),
  name: z.string().min(1),
  baseUrl: safeUrlSchema,
  panelUrl: safeUrlSchema.optional(),
  /** Lowercase substrings matched against the case-folded university name. */
  matches: z.array(z.string().min(1)).min(1),
  experimental: z.boolean().optional(),
});

export const authSchema = z.object({
  loginUrl: safeUrlSchema,
  /** Login form steps (fill credentials, click submit, wait). */
  loginSteps: z.array(specStepSchema).min(1),
  /** Optional storageState key for session reuse (engine-managed). */
  sessionStorageKey: z.string().min(1).optional(),
  /** Substring expected in the post-login URL to confirm authentication. */
  successUrlContains: z.string().min(1).optional(),
});

const docSlotSchema = z.object({
  /** SubmitFiles field this slot maps to (photo/passport/transcript/diploma). */
  fileField: fileFieldSchema,
  /** Desired output format. Conversion is performed upstream (worker), not in
   *  the interpreter — this is a declaration of intent for the pipeline. */
  target: z.enum(["jpg", "pdf", "png"]).optional(),
  maxKB: z.number().int().positive().optional(),
  normalize: z.boolean().optional(),
});

export const documentsSchema = z.object({
  slots: z.record(z.string().min(1), docSlotSchema),
});

const levelRuleSchema = z.object({
  /** Matched (case-insensitive substring) against profile.level. */
  when: z.string().min(1),
  /** Radio/selector clicked when the rule matches. */
  radio: z.string().min(1),
});

export const programSelectionSchema = z.object({
  /** How portal options are sourced. "ajaxOptions" = live dropdown enumeration. */
  source: z.enum(["ajaxOptions", "static"]).default("ajaxOptions"),
  /** Selector of the <select> whose options hold the program list. */
  selector: z.string().min(1).optional(),
  /** Education-level → radio selector rules (thesis / non-thesis, etc.). */
  levelRules: z.array(levelRuleSchema).optional(),
  /** Fuzzy match acceptance threshold (0..1). */
  fuzzyThreshold: z.number().min(0).max(1).optional(),
});

export const successSchema = z.object({
  /** Substring expected in the final URL on success. */
  responseUrlIncludes: z.string().min(1).optional(),
  /** "field=value" assertion against a JSON response body. */
  okJsonField: z.string().min(1).optional(),
  /** Regex (as string) the success URL must match, e.g. capturing a UUID. */
  redirectPattern: z.string().min(1).optional(),
  /** Where to read the external reference from ("redirectUuid" or a regex group). */
  captureRefFrom: z.string().min(1).optional(),
  /** Substring expected in the page HTML on success. */
  successText: z.string().min(1).optional(),
  /** Selector that must exist on success. */
  successSelector: z.string().min(1).optional(),
  /** Substring indicating the applicant already exists. */
  alreadyExistsText: z.string().min(1).optional(),
  /** Substring indicating the programme was not found. */
  programMissingText: z.string().min(1).optional(),
});

export const failureSchema = z.object({
  /** JSON field holding a generic error message on failure. */
  genericBodyField: z.string().min(1).optional(),
  /** Substring in page HTML indicating a hard failure. */
  failureText: z.string().min(1).optional(),
});

// ---------------------------------------------------------------------------
// Whole spec
// ---------------------------------------------------------------------------

export const adapterSpecSchema = z
  .object({
    /** Spec format version for forward-compat. Currently always 1. */
    specVersion: z.literal(1).default(1),
    meta: metaSchema,
    auth: authSchema,
    steps: z.array(specStepSchema).min(1),
    documents: documentsSchema.optional(),
    programSelection: programSelectionSchema.optional(),
    success: successSchema.default({}),
    failure: failureSchema.optional(),
  })
  .superRefine((spec, ctx) => {
    const checkFills = (steps: SpecStep[], base: (string | number)[]): void => {
      steps.forEach((s, i) => {
        if (s.action === "fill" && (s.value == null) === (s.valueFrom == null)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [...base, i],
            message: 'fill step requires exactly one of "value" or "valueFrom"',
          });
        }
      });
    };
    checkFills(spec.steps, ["steps"]);
    checkFills(spec.auth.loginSteps, ["auth", "loginSteps"]);
  });

// ---------------------------------------------------------------------------
// Derived TS types (single source of truth — never hand-write these)
// ---------------------------------------------------------------------------

export type Transform = z.infer<typeof transformSchema>;
export type SpecStep = z.infer<typeof specStepSchema>;
export type AdapterMeta = z.infer<typeof metaSchema>;
export type AdapterAuth = z.infer<typeof authSchema>;
export type AdapterDocuments = z.infer<typeof documentsSchema>;
export type ProgramSelection = z.infer<typeof programSelectionSchema>;
export type SuccessSpec = z.infer<typeof successSchema>;
export type FailureSpec = z.infer<typeof failureSchema>;
export type AdapterSpec = z.infer<typeof adapterSpecSchema>;

// ---------------------------------------------------------------------------
// parseAdapterSpec — validate a raw (untyped) spec object
// ---------------------------------------------------------------------------

export interface SpecIssue {
  path: string;
  message: string;
}

export type SpecParseResult =
  | { ok: true; spec: AdapterSpec }
  | { ok: false; error: string; issues: SpecIssue[] };

/**
 * Returns true when a spec contains any jsHook step. Accepts an untyped value
 * (e.g. a raw jsonb row) and traverses defensively, so it is safe to call on
 * both parsed `AdapterSpec`s and unvalidated stored specs.
 */
export function specHasJsHook(spec: unknown): boolean {
  const listHasJsHook = (steps: unknown): boolean =>
    Array.isArray(steps) &&
    steps.some(
      (s) =>
        typeof s === "object" &&
        s !== null &&
        (s as { action?: unknown }).action === "jsHook",
    );
  if (typeof spec !== "object" || spec === null) return false;
  const s = spec as { steps?: unknown; auth?: { loginSteps?: unknown } };
  return listHasJsHook(s.steps) || listHasJsHook(s.auth?.loginSteps);
}

/**
 * Validates a raw spec object against `adapterSpecSchema`. Returns a typed spec
 * on success, or a flat error string plus a structured issue list on failure.
 */
export function parseAdapterSpec(raw: unknown): SpecParseResult {
  const res = adapterSpecSchema.safeParse(raw);
  if (!res.success) {
    const issues: SpecIssue[] = res.error.issues.map((i) => ({
      path: i.path.join(".") || "(root)",
      message: i.message,
    }));
    return {
      ok: false,
      error: issues.map((i) => `${i.path}: ${i.message}`).join("; "),
      issues,
    };
  }
  return { ok: true, spec: res.data };
}
