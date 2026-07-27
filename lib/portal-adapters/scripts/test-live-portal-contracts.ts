import assert from "node:assert/strict";
import test from "node:test";
import {
  findMatchingMulticoApplication,
  normalizeMulticoGpaSystem,
} from "../src/universities/multico/adapter.js";
import {
  chooseOkanProgramIndex,
  resolveOkanDegreeValue,
} from "../src/universities/okan/adapter.js";
import {
  resolveUnitedDegreeLabel,
  resolveUnitedDocumentSlots,
} from "../src/universities/united/adapter.js";

test("United uses exact live degree-card labels", () => {
  assert.equal(resolveUnitedDegreeLabel("Associate"), "Vocational School");
  assert.equal(resolveUnitedDegreeLabel("Bachelor"), "Bachelor");
  assert.equal(resolveUnitedDegreeLabel("Master"), "Master");
  assert.equal(resolveUnitedDegreeLabel("PhD"), "PhD");
  assert.equal(resolveUnitedDegreeLabel("Foundation"), null);
});

test("United uses degree-specific live document slots", () => {
  assert.deepEqual(resolveUnitedDocumentSlots("Associate"), {
    diploma: ["cer"],
    transcript: ["trans"],
  });
  assert.deepEqual(resolveUnitedDocumentSlots("Bachelor"), {
    diploma: ["cer"],
    transcript: ["trans"],
  });
  assert.deepEqual(resolveUnitedDocumentSlots("Master"), {
    diploma: ["cerb"],
    transcript: ["transb"],
  });
  assert.deepEqual(resolveUnitedDocumentSlots("PhD"), {
    diploma: ["cerp"],
    transcript: ["transp"],
  });
  assert.equal(resolveUnitedDocumentSlots("Foundation"), null);
});

test("Multico uses exact live GPA select values", () => {
  assert.equal(normalizeMulticoGpaSystem("4.0"), "4");
  assert.equal(normalizeMulticoGpaSystem("100"), "100");
  assert.equal(normalizeMulticoGpaSystem("6"), null);
});

test("Multico target application lookup is exact and fail-closed on ambiguity", () => {
  const one = `
    <h3>Candidate Applications</h3>
    <table>
      <tr><td><a href="/crm/student-applications/edit/8123">#8123</a></td>
      <td>Bachelor of Software Engineering (English)</td><td>Pending</td></tr>
      <tr><td><a href="/crm/student-applications/edit/8124">#8124</a></td>
      <td>Bachelor of Nursing (Turkish)</td><td>Accepted</td></tr>
    </table>`;
  assert.deepEqual(
    findMatchingMulticoApplication(
      one,
      "Bachelor of Software Engineering (English)",
    ),
    { applicationId: "8123", fee: "", status: "Pending" },
  );
  assert.equal(
    findMatchingMulticoApplication(one, "Bachelor of Medicine (English)"),
    null,
  );
  const ambiguous = one.replace(
    "</table>",
    '<tr><td><a href="/crm/student-applications/edit/8125">#8125</a></td><td>Bachelor of Software Engineering (English)</td><td>Pending</td></tr></table>',
  );
  assert.equal(
    findMatchingMulticoApplication(
      ambiguous,
      "Bachelor of Software Engineering (English)",
    ),
    null,
  );
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
