import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";
const policyModuleUrl = new URL("../src/lib/agentApplicationPolicy.ts", import.meta.url).href;
const {
  computeAgentApplicationContractHash,
  hashSensitiveEvidence,
  normalizeRegistrationKey,
  pickLatestRegistrationTemplates,
} = await import(policyModuleUrl) as typeof import("../src/lib/agentApplicationPolicy");
const liveModeModuleUrl = new URL("../src/lib/inbox/liveMode.ts", import.meta.url).href;
const { isLiveIntegrationsEnabled } = await import(liveModeModuleUrl) as typeof import("../src/lib/inbox/liveMode");

test("production agency emails are live without requiring a redundant override", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousAllowLive = process.env.ALLOW_LIVE_INTEGRATIONS;
  try {
    delete process.env.ALLOW_LIVE_INTEGRATIONS;
    process.env.NODE_ENV = "production";
    assert.equal(isLiveIntegrationsEnabled(), true);
    process.env.NODE_ENV = "development";
    assert.equal(isLiveIntegrationsEnabled(), false);
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousAllowLive === undefined) delete process.env.ALLOW_LIVE_INTEGRATIONS;
    else process.env.ALLOW_LIVE_INTEGRATIONS = previousAllowLive;
  }
});

test("sensitive application evidence fails closed in production without a secret", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousSessionSecret = process.env.SESSION_SECRET;
  const previousAuthSecret = process.env.AUTH_SECRET;
  try {
    process.env.NODE_ENV = "production";
    delete process.env.SESSION_SECRET;
    delete process.env.AUTH_SECRET;
    assert.throws(
      () => hashSensitiveEvidence("evidence", "test"),
      /AGENT_APPLICATION_EVIDENCE_SECRET_MISSING/,
    );
    process.env.SESSION_SECRET = "test-secret";
    assert.equal(
      hashSensitiveEvidence("evidence", "test"),
      hashSensitiveEvidence("evidence", "test"),
    );
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousSessionSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSessionSecret;
    if (previousAuthSecret === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = previousAuthSecret;
  }
});

test("registration keys normalize without imposing a hard-coded type or language list", () => {
  assert.equal(normalizeRegistrationKey("  Cooperative-Partner  "), "cooperative-partner");
  assert.equal(normalizeRegistrationKey(" Português "), "português");
});

test("one deterministic latest template is exposed for every dynamic type/language pair", () => {
  const rows = [
    { id: 1, entityType: "Company", language: "English", version: 1, publishedAt: "2026-01-01" },
    { id: 2, entityType: "company", language: "english", version: 2, publishedAt: "2026-01-01" },
    { id: 3, entityType: "company", language: "english", version: 2, publishedAt: "2026-02-01" },
    { id: 4, entityType: "Individual", language: "Türkçe", version: 1, publishedAt: "2026-03-01" },
    { id: 5, entityType: "Cooperative", language: "Português", version: 1, publishedAt: "2026-03-01" },
  ];
  assert.deepEqual(pickLatestRegistrationTemplates(rows).map((row) => row.id), [3, 5, 4]);
});

test("signed application hash is stable by key order and changes with contract-relevant data", () => {
  const first = computeAgentApplicationContractHash({ templateId: 10, email: "a@example.com", companyName: "A" });
  const reordered = computeAgentApplicationContractHash({ companyName: "A", email: "a@example.com", templateId: 10 });
  const changed = computeAgentApplicationContractHash({ companyName: "B", email: "a@example.com", templateId: 10 });
  assert.equal(first, reordered);
  assert.notEqual(first, changed);
});

test("agency application route preserves exact contract, signature and idempotent approval guards", async () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const source = await readFile(path.resolve(here, "../src/routes/agentApplications.ts"), "utf8");
  assert.match(source, /normalizeRegistrationKey\(row\.entityType\) === e/);
  assert.match(source, /normalizeRegistrationKey\(row\.language\) === l/);
  assert.match(source, /agentApplicationContractHash/);
  assert.match(source, /EMAIL_NOT_VERIFIED/);
  assert.match(source, /alreadyApproved: true/);
  assert.match(source, /isLiveIntegrationsEnabled\(\)/);
  assert.doesNotMatch(source, /process\.env\.ALLOW_LIVE_INTEGRATIONS/);
  assert.match(source, /Verification email could not be delivered/);
  assert.doesNotMatch(source, /fallbackTemplate|defaultTemplate/);
  assert.ok(source.includes("return /^[a-z][a-z\\d+.-]*:\\/\\//i.test(trimmed) ? trimmed : `https://${trimmed}`"));
  assert.match(source, /Website must use HTTP or HTTPS/);
  assert.ok(
    source.indexOf("readAgentApplicationEmailProof(body.emailVerificationToken)")
      < source.indexOf("const idempotencyKey ="),
    "email ownership must be verified before an idempotent response can rotate an access token",
  );
});

test("public agency application uses system-backed multi-selects and exposes invalid fields", async () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const source = await readFile(path.resolve(here, "../../edcons/src/pages/public/AgencyApplication.tsx"), "utf8");
  const multiSelectSource = await readFile(path.resolve(here, "../../edcons/src/components/ui/multi-select-filter.tsx"), "utf8");
  assert.match(source, /MultiSelectFilter/);
  assert.match(source, /options=\{countryOptions\}/);
  assert.match(source, /CountryFlag/);
  assert.match(source, /countryCodeFromEmoji/);
  assert.match(source, /PhoneInput/);
  assert.doesNotMatch(source, /\{country\.flagEmoji\}/);
  assert.match(multiSelectSource, /icon\?: ReactNode/);
  assert.match(multiSelectSource, /opt\.icon/);
  assert.match(multiSelectSource, /singleSelectedOption\.icon/);
  assert.match(source, /operatingCountries: stringList\(form\.operatingCountries\)/);
  assert.match(source, /recruitmentMarkets: stringList\(form\.recruitmentMarkets\)/);
  assert.match(source, /cause\?\.data\?\.details\?\.fieldErrors/);
  assert.match(source, /website: normalizeWebsite\(form\.website\)/);
  assert.doesNotMatch(source, /hint=\{copy\.commaHint\}/);
});

test("migration is additive and links application evidence to lifecycle records", async () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const migration = await readFile(path.resolve(here, "../../../lib/db/drizzle/0054_agent_applications.sql"), "utf8");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "agent_applications"/);
  assert.match(migration, /signing_session_id_signing_sessions_id_fk/);
  assert.match(migration, /signed_contract_id_signed_contracts_id_fk/);
  assert.match(migration, /approved_agent_id_agents_id_fk/);
  assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE|DELETE FROM/);
});

test("agency codes are database-generated only when an approved agent is inserted", async () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const migration = await readFile(path.resolve(here, "../../../lib/db/drizzle/0055_agent_application_review_then_sign.sql"), "utf8");
  const route = await readFile(path.resolve(here, "../src/routes/agentApplications.ts"), "utf8");
  assert.match(migration, /CREATE SEQUENCE IF NOT EXISTS agent_agency_code_seq/);
  assert.match(migration, /ALTER COLUMN agency_code SET DEFAULT/);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS agents_agency_code_unique/);
  assert.match(route, /tx\.insert\(agentsTable\)\.values\(\{/);
  assert.doesNotMatch(route, /agencyCode:\s*application\./);
});
