import test from "node:test";
import assert from "node:assert/strict";
import { publicCatalogRequirements } from "../src/lib/publicCatalogRequirements";

test("public requirements remove importer references and unstructured timing", () => {
  assert.equal(publicCatalogRequirements("IELTS: 6.0 | Campus: London | Mode: Full time | Country: UK | Edvoy Ref: secret-ref | Source URL: private-url | Import Reference: internal | Intake Years: 2025 | Intakes: September | Deadline: tomorrow | Application Deadline: yesterday | Offer Turnaround: 3 days | Decision Time: 2 weeks"), "IELTS: 6.0 | Campus: London | Mode: Full time | Country: UK");
  assert.equal(publicCatalogRequirements("Source: private\nIntake: January"), null);
  assert.equal(publicCatalogRequirements(null), null);
  assert.equal(publicCatalogRequirements("Recognised degree\nPortfolio required"), "Recognised degree | Portfolio required");
});
