import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { projectPublicProgramBrief, type PublicProgramBriefSource } from "../src/lib/publicCatalogProgramBrief";

const row: PublicProgramBriefSource = {
  id: 9401, name: "Synthetic Test Programme", degree: "Master", field: "Computing", duration: "1 year", language: "English",
  description: "Synthetic catalogue description", requirements: "High school transcript | Intake years: 2024-2027 | Edvoy ref: internal | Decision time: 7 days",
  isActive: true, tuitionFee: 12000, discountedFee: null, currency: "GBP",
  universityId: 9301, universityName: "Synthetic College", universityCountry: "Synthetic Country", universityCity: "Synthetic City",
  universityType: "Private", universityIsActive: true, universityWebsite: "https://example.invalid/public", universityHasLogo: true,
};
const options = { locale: "en", prices: [], universityName: row.universityName, universityType: row.universityType, universityPath: "/en/universities/synthetic-college-9301" };

test("public programme brief contains usable canonical facts and labelled legacy price", () => {
  const brief = projectPublicProgramBrief(row, options);
  assert.equal(brief.canonicalPath, "/en/programs/synthetic-test-programme-9401");
  assert.equal(brief.universityPath, options.universityPath);
  assert.equal(brief.universityLogoUrl, "/api/universities/9301/logo");
  assert.equal(brief.universityWebsite, "https://example.invalid/public");
  assert.deepEqual(brief.tuition, { amount: 12000, currency: "GBP", verified: false, source: "legacy", frequency: null, isFrom: false });
  assert.equal(brief.requirements, "High school transcript");
  assert.equal(brief.isActive, true);
  assert.equal(brief.universityIsActive, true);
});

test("localized labels, withheld institution links and closed admissions remain authoritative", () => {
  const brief = projectPublicProgramBrief({ ...row, isActive: false, universityIsActive: false }, {
    ...options, locale: "tr", universityName: "Sentetik Üniversite", universityType: "Vakıf", universityPath: null,
  });
  assert.equal(brief.universityName, "Sentetik Üniversite");
  assert.equal(brief.universityType, "Vakıf");
  assert.equal(brief.universityPath, null);
  assert.equal(brief.isActive, false);
  assert.equal(brief.universityIsActive, false);
  assert.match(brief.canonicalPath, /^\/tr\/programs\//);
});

test("verified price handles currency minor units and ambiguous prices stay explicitly null", () => {
  const yen = { componentType: "TUITION", amountMinor: "12000", currencyCode: "JPY", frequency: "PER_YEAR" };
  assert.equal(projectPublicProgramBrief(row, { ...options, prices: [yen] }).tuition?.amount, 12000);
  assert.equal(projectPublicProgramBrief(row, { ...options, prices: [yen] }).tuition?.verified, true);
  assert.equal(projectPublicProgramBrief(row, { ...options, prices: [yen, { ...yen, currencyCode: "GBP" }] }).tuition, null);
  assert.equal(projectPublicProgramBrief(row, { ...options, prices: Object.assign([yen], { truncated: true }) }).tuition, null);
  assert.equal(projectPublicProgramBrief({ ...row, currency: null }, options).tuition, null);
});

test("public brief does not expose staff fields, arbitrary logo data or importer timing", () => {
  const polluted = { ...row, commissionRate: 20, contactPersonEmail: "synthetic@example.invalid", documentsLink: "https://example.invalid/private", intakes: "2024,2025", universityLogoUrl: "data:image/png;base64,fixture" };
  const brief = projectPublicProgramBrief(polluted, options);
  for (const key of ["commissionRate", "contactPersonEmail", "documentsLink", "intakes", "tuitionFee", "discountedFee", "universityHasLogo"]) assert.equal(Object.hasOwn(brief, key), false);
  assert.doesNotMatch(JSON.stringify(brief), /data:image|Edvoy|2024|Decision time/);
});

test("unsafe university URLs and absent logos remain unavailable", () => {
  for (const universityWebsite of ["javascript:alert(1)", "data:text/html,test", "https://user:password@example.invalid/", "https://example.invalid/\npath", "https:\\example.invalid", "http://example.invalid/"]) {
    assert.equal(projectPublicProgramBrief({ ...row, universityWebsite }, options).universityWebsite, null);
  }
  assert.equal(projectPublicProgramBrief({ ...row, universityHasLogo: false }, options).universityLogoUrl, null);
});

test("API related cards preserve catalogue and publication boundaries with bounded batch enrichment", () => {
  const route = readFileSync(new URL("../src/routes/public-catalog.ts", import.meta.url), "utf8");
  const program = route.split('"/public/catalog/programs/:routeKey"')[1].split('"/public/catalog/universities/:routeKey"')[0];
  assert.match(program, /addPublicCatalogConditions\(relatedConditions, policy\)/);
  assert.match(program, /eq\(programTranslationsTable.status, "published"\)/);
  assert.match(program, /relatedProgramIds === null \|\| relatedProgramIds.has\(related.id\)/);
  assert.match(program, /slice\(0, PUBLIC_CATALOG_RELATED_LIMIT\)/);
  assert.match(program, /readPublicCatalogPrices\(relatedPrograms.map\(row => row.id\), now\)/);
  assert.match(program, /readPublishedLocalizedEntities\(\{ entityType: "university", entityIds: relatedUniversityIds, locale \}\)/);
  assert.match(program, /indexableRelatedUniversityIds === null \|\| indexableRelatedUniversityIds.has\(related.universityId\)/);
  assert.match(program, /projectPublicProgramBrief\(/);
});

test("SSR related enrichment uses the same projection after strict eligible-candidate filtering", () => {
  const source = readFileSync(new URL("../src/lib/publicCatalogRenderReadModel.ts", import.meta.url), "utf8");
  const program = source.split("async function readProgramDetail(")[1].split("async function readUniversityDetail(")[0];
  assert.match(program, /internalLinkMode === "published" && indexableRelatedIds.has\(candidate.id\)/);
  assert.match(program, /slice\(0, PUBLIC_CATALOG_RELATED_LIMIT\)/);
  assert.match(program, /readPublicCatalogPrices\(deliveredRelatedPrograms.map\(row => row.id\), now\)/);
  assert.match(program, /readIndexableUniversityIds\(\{ locale: route.locale, universityIds: relatedUniversityIds \}\)/);
  assert.match(program, /return projectPublicProgramBrief\(candidate,/);
});
