import { isIP } from "node:net";

const STAGING_ORIGIN = "https://staging.findandstudy.com";
const STAGING_DATABASE = "fasos_staging";
const STAGING_EXECUTOR = "fas_persona_staging_executor";
const issuedBoundaries = new WeakMap<object, Readonly<PersonaStagingRuntimeConfig> | null>();
declare const personaBoundaryBrand: unique symbol;

/** This value is minted by server bootstrap, never parsed from HTTP input. */
export type PersonaRuntimeBoundary = Readonly<{
  mode: "disposable-test" | "staging-mock";
  requireSessionBoundary: boolean;
  [personaBoundaryBrand]: true;
}>;
export type PersonaStagingRuntimeConfig = {
  mode: "staging-mock";
  publicOrigin: "https://staging.findandstudy.com";
  database: {
    name: "fasos_staging";
    /** Exact numeric address reported by PostgreSQL, not a DNS name or request Host. */
    host: string;
    port: 5432;
    role: "fas_persona_staging_executor";
  };
};
export type PersonaDatabaseIdentity = {
  db?: unknown;
  host?: unknown;
  port?: unknown;
  role?: unknown;
  session_role?: unknown;
  rolsuper?: unknown;
  rolbypassrls?: unknown;
};
const deny = (code: string): never => { throw new Error(`PERSONA_${code}`); };
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const exactKeys = (value: object, keys: string[]) =>
  Object.keys(value).sort().join("\0") === keys.sort().join("\0");

/** The test corridor remains exact and cannot be promoted by changing env after
 * creation. Staging uses an explicit, immutable and production-denying pin. */
export function createPersonaRuntimeBoundary(config?: PersonaStagingRuntimeConfig): PersonaRuntimeBoundary {
  let snapshot: Readonly<PersonaStagingRuntimeConfig> | null = null;
  if (config !== undefined) {
    if (!record(config) || !exactKeys(config, ["mode", "publicOrigin", "database"]) ||
      config.mode !== "staging-mock" || config.publicOrigin !== STAGING_ORIGIN ||
      !record(config.database) || !exactKeys(config.database, ["name", "host", "port", "role"]) ||
      config.database.name !== STAGING_DATABASE || config.database.role !== STAGING_EXECUTOR ||
      config.database.port !== 5432 || typeof config.database.host !== "string" ||
      !isIP(config.database.host) || config.database.host.includes("%") ||
      config.database.host.trim() !== config.database.host)
      deny("STAGING_CONFIG_REQUIRED");
    snapshot = Object.freeze({
      mode: "staging-mock" as const,
      publicOrigin: STAGING_ORIGIN,
      database: Object.freeze({ ...config.database }),
    });
  }
  const boundary = Object.freeze({
    mode: snapshot ? "staging-mock" : "disposable-test",
    requireSessionBoundary: !!snapshot,
  }) as PersonaRuntimeBoundary;
  issuedBoundaries.set(boundary, snapshot);
  assertPersonaRuntime(boundary);
  return boundary;
}

export function assertPersonaRuntime(boundary: PersonaRuntimeBoundary): void {
  if (!boundary || !issuedBoundaries.has(boundary)) deny("RUNTIME_BOUNDARY_REQUIRED");
  const config = issuedBoundaries.get(boundary);
  if (!config) {
    if (process.env.NODE_ENV !== "test" || process.env.ALLOW_LIVE_INTEGRATIONS !== "false")
      deny("MOCK_ONLY");
    return;
  }
  if (process.env.NODE_ENV !== "production" ||
    process.env.ALLOW_LIVE_INTEGRATIONS !== "false" ||
    process.env.PERSONA_RUNTIME_MODE !== "staging-mock" ||
    process.env.APP_BASE_URL !== STAGING_ORIGIN)
    deny("STAGING_MOCK_ONLY");
}

/** Called on the acquired connection before BEGIN, on EVERY business operation.
 * Missing role flags are unknown, not false. Staging refuses SET ROLE sessions. */
export function assertPersonaDatabase(boundary: PersonaRuntimeBoundary, identity: PersonaDatabaseIdentity | undefined): void {
  assertPersonaRuntime(boundary);
  const config = issuedBoundaries.get(boundary);
  const safeRole = identity?.rolsuper === false && identity?.rolbypassrls === false;
  if (!config) {
    if (typeof identity?.db !== "string" || !/^codex_persona_flow_test_\d+_\d+$/.test(identity.db) ||
      identity.host !== "127.0.0.1" || identity.port !== 5433 || !safeRole)
      deny("TEST_DATABASE_REQUIRED");
    return;
  }
  if (!safeRole || identity?.db !== config.database.name || identity.host !== config.database.host ||
    identity.port !== config.database.port || identity.role !== config.database.role ||
    identity.session_role !== config.database.role)
    deny("STAGING_DATABASE_REQUIRED");
}
