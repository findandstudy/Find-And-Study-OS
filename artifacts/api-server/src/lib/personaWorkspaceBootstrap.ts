import { Pool } from "pg";
import { isIP } from "node:net";
import { createPersonaWorkspaceApplication } from "./personaWorkspaceApplication";
import { createPersonaRuntimeBoundary } from "./personaRuntimeBoundary";

/** Only the separately provisioned staging mock workspace can opt in.
 * No account creation, ownership inference, migration, signer or external AI.
 * Production and invalid configuration are never silently downgraded.
 */
export function createPersonaWorkspaceFromEnvironment(env = process.env) {
  if (env.PERSONA_WORKSPACE_ENABLED !== "true")
    return createPersonaWorkspaceApplication();
  const reject = (): never => { throw new Error("PERSONA_STAGING_BOOTSTRAP_INVALID"); };
  if (env.NODE_ENV !== "production" || env.PERSONA_RUNTIME_MODE !== "staging-mock" ||
      env.APP_BASE_URL !== "https://staging.findandstudy.com" || env.ALLOW_LIVE_INTEGRATIONS !== "false")
    reject();
  let connection: URL;
  let project: unknown;
  try {
    connection = new URL(env.PERSONA_DATABASE_URL ?? "");
    project = JSON.parse(env.PERSONA_ADMIN_PROJECT_JSON ?? "");
  } catch { return reject(); }
  if (connection.protocol !== "postgresql:" || connection.hostname !== "db" ||
      (connection.port || "5432") !== "5432" || connection.pathname !== "/fasos_staging" ||
      connection.username !== "fas_persona_staging_executor" || !connection.password ||
      connection.search || connection.hash) reject();
  const address = env.PERSONA_DATABASE_SERVER_ADDRESS ?? "";
  if (!isIP(address) || address.includes("%")) reject();
  const record = project as Record<string, unknown> | null;
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
  if (!record || typeof record !== "object" || Array.isArray(record) ||
      Object.keys(record).sort().join(",") !== "organizationId,projectId,tenantId" ||
      ![record.projectId, record.tenantId, record.organizationId].every(v => typeof v === "string" && uuid.test(v)))
    reject();
  const runtime = createPersonaRuntimeBoundary({
    mode: "staging-mock", publicOrigin: "https://staging.findandstudy.com",
    database: { name: "fasos_staging", host: address, port: 5432, role: "fas_persona_staging_executor" },
  });
  // URL never enters a log, API response or error. Connections are lazy and
  // must pass PostgreSQL-reported identity checks on every business operation.
  const pool = new Pool({
    connectionString: connection.toString(), max: 6,
    connectionTimeoutMillis: 4000, idleTimeoutMillis: 10000,
    application_name: "persona-staging-admin-workspace",
  });
  pool.on("error", () => console.error("[persona-workspace] database connection unavailable"));
  return createPersonaWorkspaceApplication({
    pool, runtime,
    adminSession: {
      project: record as { projectId: string; tenantId: string; organizationId: string },
      trustedOrigin: "https://staging.findandstudy.com",
    },
  });
}
