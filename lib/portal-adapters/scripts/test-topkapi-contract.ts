import assert from "node:assert/strict";
import { test } from "node:test";

import {
  classifyTopkapiStudentCheck,
  countTopkapiProgramChoices,
} from "../src/universities/topkapi/adapter.js";
import {
  matchTopkapiProgramLevelRadio,
  topkapiProgramLevelRadioCandidates,
} from "../src/universities/topkapi/format.js";

test("Topkapi duplicate classifier accepts explicit exists/new outcomes", () => {
  assert.equal(classifyTopkapiStudentCheck('{"status":"exists"}'), "exists");
  assert.equal(classifyTopkapiStudentCheck('{"status":"new"}'), "new");
  assert.equal(classifyTopkapiStudentCheck('{"status":"success"}'), "new");
  assert.equal(classifyTopkapiStudentCheck(""), "new");
  assert.equal(classifyTopkapiStudentCheck("null"), "new");
  assert.equal(classifyTopkapiStudentCheck("{}"), "new");
  assert.equal(classifyTopkapiStudentCheck("[]"), "new");
});

test("Topkapi duplicate classifier fails closed on HTML and unknown payloads", () => {
  assert.equal(classifyTopkapiStudentCheck("<html>502 Bad Gateway</html>"), "unknown");
  assert.equal(classifyTopkapiStudentCheck('{"status":"maybe"}'), "unknown");
  assert.equal(classifyTopkapiStudentCheck("{broken"), "unknown");
  assert.equal(classifyTopkapiStudentCheck('[{"status":"exists"}]'), "unknown");
});

test("Topkapi Step-4 AJAX classifier accepts a settled empty program list", () => {
  assert.equal(
    countTopkapiProgramChoices(JSON.stringify({
      status: "success",
      programChoicesHtml: `
        <select name="programFirstPreference">
          <option value="0">Not Selected</option>
        </select>
        <select name="programSecondPreference"><option value="0">Not Selected</option></select>
      `,
    })),
    0,
  );
});

test("Topkapi Step-4 AJAX classifier counts only real first-preference options", () => {
  assert.equal(
    countTopkapiProgramChoices(JSON.stringify({
      status: "success",
      programChoicesHtml: `
        <select class="form-select" name='programFirstPreference' required>
          <option value="0">Not Selected</option>
          <option value="41">Graphic Design (Associate) - English</option>
          <option value='42' disabled>Other</option>
        </select>
      `,
    })),
    2,
  );
});

test("Topkapi Step-4 accepts one real option without a placeholder", () => {
  assert.equal(
    countTopkapiProgramChoices(JSON.stringify({
      status: "success",
      programChoicesHtml: `
        <select name="programFirstPreference">
          <option value="91">Computer Programming (Associate)</option>
        </select>
      `,
    })),
    1,
  );
});

test("Topkapi Step-4 AJAX classifier fails closed on malformed payloads", () => {
  assert.equal(countTopkapiProgramChoices("<html>502</html>"), null);
  assert.equal(countTopkapiProgramChoices('{"status":"error"}'), null);
  assert.equal(countTopkapiProgramChoices('{"status":"success","programChoicesHtml":"<div/>"}'), null);
});

test("Topkapi Step-4 level matcher accepts Associate portal aliases", () => {
  const radios = [
    { value: "Bachelor", label: "Lisans", index: 0 },
    { value: "Associate Degree", label: "Ön Lisans", index: 1 },
  ];
  assert.equal(matchTopkapiProgramLevelRadio("Associate", radios)?.index, 1);
  assert.ok(
    topkapiProgramLevelRadioCandidates("Associate").some(
      (candidate) => candidate === "Ön Lisans",
    ),
  );
});

test("Topkapi Step-4 level matcher can use a Turkish visible label", () => {
  const radios = [
    { value: "2", label: "Lisans", index: 0 },
    { value: "1", label: "Önlisans Programları", index: 1 },
  ];
  assert.equal(matchTopkapiProgramLevelRadio("Associate", radios)?.index, 1);
});

test("Topkapi Step-4 level matcher keeps thesis variants distinct", () => {
  const radios = [
    { value: "Masters (Non Thesis)", label: "Yüksek Lisans (Tezsiz)", index: 0 },
    { value: "Masters (Thesis)", label: "Yüksek Lisans (Tezli)", index: 1 },
  ];
  assert.equal(
    matchTopkapiProgramLevelRadio("Master", radios, "Business (Thesis)")?.index,
    1,
  );
  assert.equal(
    matchTopkapiProgramLevelRadio("Master", radios, "Business (Non-Thesis)")?.index,
    0,
  );
});

test("Topkapi Step-4 level matcher fails closed when the requested level is absent", () => {
  assert.equal(
    matchTopkapiProgramLevelRadio("Doctorate", [
      { value: "Bachelor", label: "Lisans", index: 0 },
    ]),
    null,
  );
});
