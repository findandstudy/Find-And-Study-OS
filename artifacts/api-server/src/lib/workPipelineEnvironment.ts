/** Explicit, fail-closed local/staging scope. Never enables the Apply runtime. */
export function workPipelineEnvironmentAllowed(env: NodeJS.ProcessEnv): boolean {
  let db: URL;
  try { db = new URL(env.DATABASE_URL || "invalid:"); } catch { return false; }
  if (!["postgres:", "postgresql:"].includes(db.protocol) || db.search) return false;
  if (env.ALLOW_LIVE_INTEGRATIONS !== "false") return false;
  if (env.WORK_PIPELINES_ENV === "staging") {
    return env.NODE_ENV === "production"
      && db.hostname === "db" && (db.port || "5432") === "5432"
      && db.pathname === "/fasos_staging" && db.username === "fas_app"
      && env.BASE_URL === "https://staging.findandstudy.com"
      && /^staging-[a-zA-Z0-9._-]+$/.test(env.RELEASE_ID || "")
      && env.EMAIL_DELIVERY_DISABLED === "true";
  }
  return !env.WORK_PIPELINES_ENV && env.NODE_ENV !== "production"
    && db.hostname === "127.0.0.1" && db.port === "5433"
    && (db.pathname === "/fasos_apply_local" ||
      (env.NODE_ENV === "test" && env.EMAIL_DELIVERY_DISABLED === "true" && db.pathname === "/fas_dev_pipeline_hardening"));
}
