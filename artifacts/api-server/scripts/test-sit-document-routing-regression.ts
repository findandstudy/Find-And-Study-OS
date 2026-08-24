import test from "node:test";
import assert from "node:assert/strict";
import {
  findMissingMandatoryTypes,
  getDocEquivalenceGroup,
} from "@workspace/doc-equivalence";
import { mapDocType } from "@workspace/portal-adapters/doc-type";

test("visible diploma labels satisfy both CRM and SIT document gates", () => {
  const uploaded = new Set([
    "Passport",
    "Photo",
    "Diploma Certificate",
    "Diploma Transcript",
  ]);

  assert.deepEqual(
    findMissingMandatoryTypes(
      ["passport", "photo", "diploma_certificate", "diploma_transcript"],
      uploaded,
    ),
    [],
  );
  assert.equal(getDocEquivalenceGroup("Diploma Certificate"), "hs_certificate");
  assert.equal(getDocEquivalenceGroup("Diploma Transcript"), "hs_transcript");
  assert.equal(mapDocType("Diploma Certificate"), "diploma");
  assert.equal(mapDocType("Diploma Transcript"), "transcript");
});
