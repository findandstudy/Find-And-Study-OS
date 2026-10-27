import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import {
  createPersonaRuntimeBoundary,
  assertPersonaRuntime,
  assertPersonaDatabase,
  type PersonaRuntimeBoundary,
  type PersonaStagingRuntimeConfig,
} from "../src/lib/personaRuntimeBoundary";
import { createPersonaScopedMock } from "../src/lib/personaScopedMock";
import { createPersonaCookieSession } from "../src/lib/personaCookieSession";

const config = (): PersonaStagingRuntimeConfig => ({
  mode: "staging-mock", publicOrigin: "https://staging.findandstudy.com",
  database: { name: "fasos_staging", host: "172.30.0.2", port: 5432, role: "fas_persona_staging_executor" },
});
const stagingIdentity = () => ({ db: "fasos_staging", host: "172.30.0.2", port: 5432,
  role: "fas_persona_staging_executor", session_role: "fas_persona_staging_executor", rolsuper: false, rolbypassrls: false });
const disposableIdentity = () => ({ db: "codex_persona_flow_test_123_456", host: "127.0.0.1", port: 5433, rolsuper: false, rolbypassrls: false });
function environment(staging: boolean) {
  process.env.NODE_ENV = staging ? "production" : "test";
  process.env.ALLOW_LIVE_INTEGRATIONS = "false";
  process.env.PERSONA_RUNTIME_MODE = staging ? "staging-mock" : "off";
  process.env.APP_BASE_URL = staging ? "https://staging.findandstudy.com" : "http://127.0.0.1";
}
test("default corridor remains disposable-only even when staging flags are present", () => {
  environment(false);
  const boundary = createPersonaRuntimeBoundary();
  assert.equal(boundary.mode, "disposable-test");
  assertPersonaDatabase(boundary, disposableIdentity());
  for (const change of [{ db: "fasos_apply_local" }, { db: "fasos_staging" }, { db: "fasos_apply" }, { host: "172.30.0.2" }, { port: 5432 }, { rolsuper: true }, { rolbypassrls: undefined }])
    assert.throws(() => assertPersonaDatabase(boundary, { ...disposableIdentity(), ...change }), /PERSONA_TEST_DATABASE_REQUIRED/);
  environment(true);
  assert.throws(() => createPersonaRuntimeBoundary(), /PERSONA_MOCK_ONLY/);
  assert.throws(() => assertPersonaRuntime(boundary), /PERSONA_MOCK_ONLY/);
});
test("staging corridor is explicit, pinned and opaque", () => {
  environment(true);
  const boundary = createPersonaRuntimeBoundary(config());
  assert.ok(Object.isFrozen(boundary));
  assert.equal(boundary.requireSessionBoundary, true);
  assertPersonaDatabase(boundary, stagingIdentity());
  assert.throws(() => assertPersonaRuntime({ ...boundary } as PersonaRuntimeBoundary), /PERSONA_RUNTIME_BOUNDARY_REQUIRED/);
  assert.throws(() => assertPersonaRuntime(null as unknown as PersonaRuntimeBoundary), /PERSONA_RUNTIME_BOUNDARY_REQUIRED/);
});
test("production, live mode, fake origin, hostname and extra properties cannot configure staging", () => {
  environment(true);
  for (const change of [
    { mode: "live" }, { publicOrigin: "https://apply.findandstudy.com" },
    { publicOrigin: "https://staging.findandstudy.com/" }, { bypass: true },
    ...[{ name: "fasos_apply" }, { name: "fasos_staging_copy" }, { port: 5433 }, { role: "fas_app" }, { role: "postgres" }, { host: "db" }, { host: "172.30.0.2 " }, { host: "fe80::1%eth0" }, { bypass: true }]
      .map((patch) => ({ database: { ...config().database, ...patch } })),
  ]) assert.throws(() => createPersonaRuntimeBoundary({ ...config(), ...change } as PersonaStagingRuntimeConfig), /PERSONA_STAGING_CONFIG_REQUIRED/);
});
test("exact database identity rejects name, host, port, SET ROLE, missing flags and privileged roles", () => {
  environment(true);
  const boundary = createPersonaRuntimeBoundary(config());
  for (const change of [
    { db: "fasos_apply" }, { db: "fasos_apply_local" }, { host: "172.30.0.3" }, { port: 5433 },
    { role: "fas_app" }, { session_role: "postgres" }, { role: undefined }, { session_role: undefined },
    { rolsuper: true }, { rolbypassrls: true }, { rolsuper: undefined }, { rolbypassrls: undefined }, { port: "5432" },
  ]) assert.throws(() => assertPersonaDatabase(boundary, { ...stagingIdentity(), ...change }), /PERSONA_STAGING_DATABASE_REQUIRED/);
  assert.throws(() => assertPersonaDatabase(boundary, undefined), /PERSONA_STAGING_DATABASE_REQUIRED/);
});
test("server bootstrap config is copied and frozen rather than mutable request authority", () => {
  environment(true);
  const mutable = config(), boundary = createPersonaRuntimeBoundary(mutable);
  mutable.database.host = "172.30.0.3";
  assertPersonaDatabase(boundary, stagingIdentity());
  assert.throws(() => assertPersonaDatabase(boundary, { ...stagingIdentity(), host: mutable.database.host }), /PERSONA_STAGING_DATABASE_REQUIRED/);
});
test("every operation rechecks runtime mode, canonical origin and outbound kill-switch", () => {
  environment(true);
  const boundary = createPersonaRuntimeBoundary(config());
  for (const [key, value] of [["NODE_ENV", "test"], ["ALLOW_LIVE_INTEGRATIONS", "true"], ["PERSONA_RUNTIME_MODE", "off"], ["APP_BASE_URL", "https://apply.findandstudy.com"]]) {
    process.env[key] = value;
    assert.throws(() => assertPersonaRuntime(boundary), /PERSONA_STAGING_MOCK_ONLY/);
    assert.throws(() => assertPersonaDatabase(boundary, stagingIdentity()), /PERSONA_STAGING_MOCK_ONLY/);
    environment(true);
  }
});
test("service requires real session boundary before DB or provider access in staging", async () => {
  environment(true);
  let connections = 0;
  const pool = { async connect() { connections++; throw new Error("SHOULD_NOT_CONNECT"); } } as unknown as Pick<Pool, "connect">;
  const signed = { audience: "persona", environmentId: "staging", cellId: "staging", issuerId: "issuer", keyRing: [] };
  const boundary = createPersonaRuntimeBoundary(config());
  const service = createPersonaScopedMock(pool, signed, undefined, boundary);
  await assert.rejects(service.list({ token: "fake", tenantId: "fake", principalId: "fake", sessionFingerprint: "fake" }, "fake"), /PERSONA_SESSION_BOUNDARY_REQUIRED/);
  assert.equal(connections, 0);
  assert.throws(() => createPersonaScopedMock(pool, { ...signed, environmentId: "production" }, undefined, boundary), /PERSONA_STAGING_SESSION_CONFIG_REQUIRED/);
});
test("session factory requires exact staging origin and active-context environment", () => {
  environment(true);
  const boundary = createPersonaRuntimeBoundary(config());
  for (const options of [
    { trustedOrigins: ["https://apply.findandstudy.com"], issuance: { environmentId: "staging" } },
    { trustedOrigins: ["https://staging.findandstudy.com", "https://apply.findandstudy.com"], issuance: { environmentId: "staging" } },
    { trustedOrigins: ["https://staging.findandstudy.com"], issuance: { environmentId: "production" } },
  ]) assert.throws(() => createPersonaCookieSession(options as never, boundary), /PERSONA_STAGING_SESSION_CONFIG_REQUIRED/);
});
