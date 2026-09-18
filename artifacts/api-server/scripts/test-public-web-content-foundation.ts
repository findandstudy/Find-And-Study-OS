import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  PUBLIC_WEB_REQUIRED_FACTS,
  buildPublicWebCanonicalPath,
  evaluatePublicWebPublication,
  normalizePublicWebLocale,
  normalizePublicWebSlug,
  resolvePublicWebRollout,
  type PublicWebPublicationCandidate,
} from "../src/lib/publicWebContentContract.js";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const TENANT_A = "018f8200-0000-7000-8000-000000000101";
const TENANT_B = "018f8200-0000-7000-8000-000000000102";
const NOW = "2026-09-08T12:00:00.000Z";

const completeProgramEvidence = [
  {
    status: "VERIFIED" as const,
    factKeys: PUBLIC_WEB_REQUIRED_FACTS.PROGRAM,
    verifiedAt: "2026-09-01T12:00:00.000Z",
    expiresAt: "2026-12-01T12:00:00.000Z",
  },
];

function programCandidate(
  overrides: Partial<PublicWebPublicationCandidate> = {},
): PublicWebPublicationCandidate {
  return {
    entityType: "PROGRAM",
    entityId: 42,
    entityActive: true,
    locale: "en",
    slug: "Computer Engineering",
    canonicalPath: "/en/programs/computer-engineering-42",
    title: "Computer Engineering",
    contentSizeBytes: 8_000,
    origin: "HUMAN",
    authorLegacyUserId: 10,
    reviewerLegacyUserId: 11,
    publisherLegacyUserId: 11,
    reviewedAt: "2026-09-07T12:00:00.000Z",
    sourceSha256: SHA_A,
    contentSha256: SHA_B,
    generatorReceiptSha256: null,
    qualityStatus: "PASS",
    sourceCoverage: "COMPLETE",
    translationStatus: "SOURCE",
    seoStatus: "PASS",
    structuredDataStatus: "PASS",
    requestedIndex: true,
    evidence: completeProgramEvidence,
    ...overrides,
  };
}

test("canonical URL builders preserve stable ids and normalize Latin slugs", () => {
  assert.equal(normalizePublicWebSlug("  İstanbul Æroskøbing Üniversitesi  "), "istanbul-aeroskobing-universitesi");
  assert.equal(normalizePublicWebLocale("PT-BR"), "pt");
  assert.equal(normalizePublicWebLocale("xx"), null);
  assert.equal(
    buildPublicWebCanonicalPath({
      entityType: "UNIVERSITY",
      entityId: 91,
      locale: "tr",
      slug: "İstanbul Teknik Üniversitesi",
    }),
    "/tr/universities/istanbul-teknik-universitesi-91",
  );
  assert.equal(
    buildPublicWebCanonicalPath({
      entityType: "DESTINATION",
      entityId: 7,
      locale: "en",
      slug: "United Kingdom",
    }),
    "/en/destinations/united-kingdom",
  );
  assert.equal(
    buildPublicWebCanonicalPath({
      entityType: "CITY",
      entityId: 34,
      locale: "tr",
      slug: "İstanbul",
    }),
    "/tr/cities/istanbul-34",
  );
  assert.throws(
    () => buildPublicWebCanonicalPath({ entityType: "PROGRAM", entityId: 0, locale: "en", slug: "MBA" }),
    /public_web_entity_id_invalid/,
  );
});

test("a fully reviewed, sourced English programme may publish and index", () => {
  const decision = evaluatePublicWebPublication(programCandidate(), NOW);
  assert.deepEqual(decision, {
    publishAllowed: true,
    indexAllowed: true,
    publishBlockers: [],
    indexBlockers: [],
    missingFactKeys: [],
  });
});

test("maker-checker, source coverage and critical facts fail closed", () => {
  const decision = evaluatePublicWebPublication(
    programCandidate({
      reviewerLegacyUserId: 10,
      sourceCoverage: "PARTIAL",
      evidence: [
        {
          status: "VERIFIED",
          factKeys: ["name", "institution"],
          verifiedAt: "2026-09-01T12:00:00.000Z",
          expiresAt: null,
        },
      ],
    }),
    NOW,
  );
  assert.equal(decision.publishAllowed, false);
  assert.ok(decision.publishBlockers.includes("maker_checker_conflict"));
  assert.ok(decision.publishBlockers.includes("source_coverage_incomplete"));
  assert.ok(decision.publishBlockers.includes("critical_fact_evidence_missing"));
  assert.deepEqual(decision.missingFactKeys, [
    "degree",
    "tuition",
    "currency",
    "duration",
    "requirements",
    "intakes",
  ]);
});

test("expired evidence and stale translations cannot publish", () => {
  const decision = evaluatePublicWebPublication(
    programCandidate({
      locale: "tr",
      canonicalPath: "/tr/programs/computer-engineering-42",
      translationStatus: "STALE",
      evidence: [
        {
          status: "VERIFIED",
          factKeys: PUBLIC_WEB_REQUIRED_FACTS.PROGRAM,
          verifiedAt: "2026-01-01T00:00:00.000Z",
          expiresAt: "2026-08-31T23:59:59.000Z",
        },
      ],
    }),
    NOW,
  );
  assert.equal(decision.publishAllowed, false);
  assert.ok(decision.publishBlockers.includes("verified_source_missing"));
  assert.ok(decision.publishBlockers.includes("translation_unavailable"));
});

test("AI-assisted revisions require a receipt and never bypass human review", () => {
  const decision = evaluatePublicWebPublication(
    programCandidate({
      origin: "AI_ASSISTED",
      generatorReceiptSha256: null,
      reviewerLegacyUserId: null,
      reviewedAt: null,
    }),
    NOW,
  );
  assert.equal(decision.publishAllowed, false);
  assert.ok(decision.publishBlockers.includes("ai_receipt_missing"));
  assert.ok(decision.publishBlockers.includes("review_missing"));
});

test("publish eligibility is separate from index eligibility", () => {
  const decision = evaluatePublicWebPublication(
    programCandidate({ requestedIndex: false, seoStatus: "PENDING" }),
    NOW,
  );
  assert.equal(decision.publishAllowed, true);
  assert.equal(decision.indexAllowed, false);
  assert.ok(decision.indexBlockers.includes("index_not_requested"));
  assert.ok(decision.indexBlockers.includes("seo_not_passed"));
});

test("rollout is default-off and malformed allowlists fail closed", () => {
  assert.deepEqual(
    resolvePublicWebRollout({ mode: undefined, tenantId: TENANT_A, tenantAllowlist: undefined }),
    { mode: "off", enabled: false, reason: "mode_off" },
  );
  assert.deepEqual(
    resolvePublicWebRollout({ mode: "allowlist", tenantId: TENANT_A, tenantAllowlist: `${TENANT_B},${TENANT_A}` }),
    { mode: "allowlist", enabled: true, reason: "enabled" },
  );
  assert.deepEqual(
    resolvePublicWebRollout({ mode: "allowlist", tenantId: TENANT_A, tenantAllowlist: "not-a-uuid" }),
    { mode: "off", enabled: false, reason: "invalid_config" },
  );
  assert.deepEqual(
    resolvePublicWebRollout({ mode: "unexpected", tenantId: TENANT_A, tenantAllowlist: TENANT_A }),
    { mode: "off", enabled: false, reason: "invalid_config" },
  );
});

test("migration is additive, tenant-forced and remains runtime-unwired", () => {
  const migration = readFileSync(
    new URL("../../../lib/db/drizzle/0109_public_web_content_foundation.sql", import.meta.url),
    "utf8",
  );
  for (const table of [
    "public_web_content_records",
    "public_web_content_revisions",
    "public_web_source_evidence",
    "public_web_publication_states",
    "public_web_publication_receipts",
    "public_web_route_aliases",
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE "${table}"`));
  }
  assert.match(migration, /ALTER TABLE public\.%I FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /public_web_content_revisions_append_only/);
  assert.match(migration, /public_web_source_evidence_append_only/);
  assert.match(migration, /public_web_publication_receipts_append_only/);
  assert.match(migration, /public web approval requires an independent reviewer/);
  assert.match(migration, /public web approval requires current verified source evidence/);
  assert.doesNotMatch(migration, /INSERT INTO\s+"?(programs|universities|destinations|website_pages)"?/i);
  assert.doesNotMatch(migration, /INSERT INTO\s+role_package_capabilities/i);
  assert.doesNotMatch(migration, /https?:\/\/(?:api\.|staging\.|findandstudy)/i);

  const cityMigration = readFileSync(
    new URL("../../../lib/db/drizzle/0120_public_web_city_pages.sql", import.meta.url),
    "utf8",
  );
  const cityPublicationGuardMigration = readFileSync(
    new URL("../../../lib/db/drizzle/0121_public_web_city_publication_guard.sql", import.meta.url),
    "utf8",
  );
  assert.match(cityMigration, /ADD COLUMN "city_id" integer/);
  assert.match(cityMigration, /FOREIGN KEY \("city_id"\) REFERENCES "cities"\("id"\).*NOT VALID/);
  assert.match(cityMigration, /"entity_type" = 'CITY'.*"city_id" IS NOT NULL/);
  assert.match(cityMigration, /public_web_content_records_city_locale_uq/);
  assert.doesNotMatch(cityMigration, /public_web_city_publication_evidence_guard/);
  assert.match(cityPublicationGuardMigration, /ARRAY\['name','country','body'\]/);
  assert.match(cityPublicationGuardMigration, /public_web_city_publication_evidence_guard/);
  assert.match(cityPublicationGuardMigration, /REVOKE ALL ON FUNCTION "enforce_public_web_city_publication_evidence"\(\) FROM PUBLIC/);
  assert.doesNotMatch(cityMigration, /^\s*(INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM)/im);
  assert.doesNotMatch(cityPublicationGuardMigration, /^\s*(INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM)/im);
});
