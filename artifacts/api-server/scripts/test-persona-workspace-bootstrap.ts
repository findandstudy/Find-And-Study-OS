import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { createPersonaWorkspaceFromEnvironment } from "../src/lib/personaWorkspaceBootstrap";

const project = { projectId: "019a2000-0000-7000-8000-000000000103", tenantId: "019a2000-0000-7000-8000-000000000101", organizationId: "019a2000-0000-7000-8000-000000000102" };
const configured = {
  NODE_ENV: "production", PERSONA_WORKSPACE_ENABLED: "true", PERSONA_RUNTIME_MODE: "staging-mock",
  APP_BASE_URL: "https://staging.findandstudy.com", ALLOW_LIVE_INTEGRATIONS: "false",
  PERSONA_DATABASE_URL: "postgresql://fas_persona_staging_executor:fixture-only@db:5432/fasos_staging",
  PERSONA_DATABASE_SERVER_ADDRESS: "172.23.0.2", PERSONA_ADMIN_PROJECT_JSON: JSON.stringify(project),
};

test("normal product bootstrap remains disabled without explicit staging configuration", async () => {
  const app = express();
  app.use("/api/persona-workspace", createPersonaWorkspaceFromEnvironment({}));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    const result = await fetch(`http://127.0.0.1:${address.port}/api/persona-workspace/projects`);
    assert.equal(result.status, 503);
    assert.deepEqual(await result.json(), { error: "PERSONA_WORKSPACE_NOT_CONFIGURED" });
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

for (const [name, override] of [
  ["production origin", { APP_BASE_URL: "https://apply.findandstudy.com" }],
  ["live integrations", { ALLOW_LIVE_INTEGRATIONS: "true" }],
  ["missing database", { PERSONA_DATABASE_URL: "" }],
  ["production database", { PERSONA_DATABASE_URL: configured.PERSONA_DATABASE_URL.replace("fasos_staging", "fasos_apply") }],
  ["privileged role", { PERSONA_DATABASE_URL: configured.PERSONA_DATABASE_URL.replace("fas_persona_staging_executor", "postgres") }],
  ["external host", { PERSONA_DATABASE_URL: configured.PERSONA_DATABASE_URL.replace("@db:", "@remote.example:") }],
  ["connection override", { PERSONA_DATABASE_URL: `${configured.PERSONA_DATABASE_URL}?options=-c%20role=postgres` }],
  ["unpinned server", { PERSONA_DATABASE_SERVER_ADDRESS: "db" }],
  ["invalid project", { PERSONA_ADMIN_PROJECT_JSON: JSON.stringify({ ...project, projectId: "unknown" }) }],
  ["caller role option", { PERSONA_ADMIN_PROJECT_JSON: JSON.stringify({ ...project, role: "super_admin" }) }],
] as const) test(`staging bootstrap rejects ${name} without exposing connection details`, () => {
  assert.throws(() => createPersonaWorkspaceFromEnvironment({ ...configured, ...override }), error => {
    assert.ok(error instanceof Error);
    assert.equal(error.message, "PERSONA_STAGING_BOOTSTRAP_INVALID");
    assert.ok(!error.message.includes("fixture-only"));
    return true;
  });
});

test("explicit staging composition has no KMS, signer, provider or session secret requirement", () => {
  const previous = Object.fromEntries(Object.keys(configured).map(key => [key, process.env[key]]));
  try {
    Object.assign(process.env, configured);
    assert.doesNotThrow(() => createPersonaWorkspaceFromEnvironment(configured));
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
