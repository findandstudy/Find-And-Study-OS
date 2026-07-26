import assert from "node:assert/strict";
import test from "node:test";
import { normalizeMulticoGpaSystem } from "../src/universities/multico/adapter.js";
import {
  chooseOkanProgramIndex,
  resolveOkanDegreeValue,
} from "../src/universities/okan/adapter.js";
import { resolveUnitedDegreeLabel } from "../src/universities/united/adapter.js";

test("United uses exact live degree-card labels", () => {
  assert.equal(resolveUnitedDegreeLabel("Associate"), "Vocational School");
  assert.equal(resolveUnitedDegreeLabel("Bachelor"), "Bachelor");
  assert.equal(resolveUnitedDegreeLabel("Master"), "Master");
  assert.equal(resolveUnitedDegreeLabel("PhD"), "PhD");
  assert.equal(resolveUnitedDegreeLabel("Foundation"), null);
});

test("Multico uses exact live GPA select values", () => {
  assert.equal(normalizeMulticoGpaSystem("4.0"), "4");
  assert.equal(normalizeMulticoGpaSystem("100"), "100");
  assert.equal(normalizeMulticoGpaSystem("6"), null);
});

test("Okan refuses unknown degree levels and ambiguous programs", () => {
  assert.equal(resolveOkanDegreeValue("Bachelor"), "2");
  assert.equal(resolveOkanDegreeValue("unknown"), null);
  assert.equal(
    chooseOkanProgramIndex(
      ["Business Administration (Thesis)", "Business Administration (Non-Thesis)"],
      "Business Administration",
    ),
    null,
  );
});
