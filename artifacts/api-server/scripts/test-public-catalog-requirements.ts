import test from "node:test";
import assert from "node:assert/strict";
import { publicCatalogRequirements } from "../src/lib/publicCatalogRequirements";
import { splitRequirements } from "../../edcons/src/pages/public/detailPresentation";

test("API and frontend remove only the exact program slug, preserving real hyphenated requirements", () => {
  const slug = "international-foundation-programme-one-year-business-abbey-college-manchester";
  const context = { canonicalPath: `/en/programs/${slug}-145792`, id: 145792 };
  for (const artifact of [slug, `${slug}-145792`]) {
    assert.equal(publicCatalogRequirements(artifact, context), null);
    assert.deepEqual(splitRequirements(artifact, context), { requirements: [], metadata: [] });
    const input = `${artifact} | A-level | portfolio-based assessment | İngilizce yeterlilik`;
    assert.equal(publicCatalogRequirements(input, context), "A-level | portfolio-based assessment | İngilizce yeterlilik");
    assert.deepEqual(splitRequirements(input, context).requirements, ["A-level", "portfolio-based assessment", "İngilizce yeterlilik"]);
  }
  for (const realText of ["A-level", "portfolio-based", "English-language-proficiency", `${slug}-999`]) {
    assert.equal(publicCatalogRequirements(realText, context), realText);
    assert.deepEqual(splitRequirements(realText, context).requirements, [realText]);
  }
  assert.equal(publicCatalogRequirements(slug), slug, "no context means no identity guess");
});

test("public requirements remove importer references and unstructured timing", () => {
  assert.equal(publicCatalogRequirements("IELTS: 6.0 | Campus: London | Mode: Full time | Country: UK | Edvoy Ref: secret-ref | Source URL: private-url | Import Reference: internal | Intake Years: 2025 | Intakes: September | Deadline: tomorrow | Application Deadline: yesterday | Offer Turnaround: 3 days | Decision Time: 2 weeks"), "IELTS: 6.0 | Campus: London | Mode: Full time | Country: UK");
  assert.equal(publicCatalogRequirements("Source: private\nIntake: January"), null);
  assert.equal(publicCatalogRequirements(null), null);
  assert.equal(publicCatalogRequirements("Recognised degree\nPortfolio required"), "Recognised degree | Portfolio required");
});
