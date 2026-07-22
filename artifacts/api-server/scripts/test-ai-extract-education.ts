/**
 * educationExtraction — unit tests (FAZ 3).
 *
 * AE-1  Level mapping: Bachelor apply → only high_school record kept.
 * AE-2  Master apply → only bachelor record kept.
 * AE-3  PhD apply → bachelor + master kept, ordered.
 * AE-4  GPA normalize: "3.5/4" → percent with gpaRaw + gpaScale=100.
 * AE-5  Unnormalizable GPA kept raw (gpaScale null).
 * AE-6  high_school program force-nulled; dedup levels (first wins).
 * AE-7  Garbage / non-array input → [].
 * AE-8  Prompt section lists required records per level.
 * AE-9  Passport soft-warning helper: expired → true (route pushes code).
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:ai-extract-education
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildEducationPromptSection,
  mapExtractionToEducation,
} from "../src/lib/educationExtraction.js";
import { isPassportExpired } from "../src/lib/passportValidity.js";

const mockAll = [
  { level: "high_school", institution: "Ankara Lisesi", graduationYear: "2019", gpa: "87.5", languageScore: null },
  { level: "bachelor", institution: "Bilkent University", program: "Computer Science", graduationYear: 2023, gpa: "3.5/4", languageScore: "IELTS 7.0" },
  { level: "master", institution: "METU", program: "AI", graduationYear: 2025, gpa: "3.8/4", languageScore: "TOEFL 100" },
];

describe("mapExtractionToEducation — level mapping", () => {
  it("AE-1 Bachelor apply (group A) → only high_school", () => {
    const out = mapExtractionToEducation(mockAll, "Bachelor");
    assert.equal(out.length, 1);
    assert.equal(out[0].level, "high_school");
    assert.equal(out[0].institution, "Ankara Lisesi");
    assert.equal(out[0].graduationYear, 2019);
  });
  it("AE-2 Master apply (group B) → only bachelor", () => {
    const out = mapExtractionToEducation(mockAll, "Master");
    assert.equal(out.length, 1);
    assert.equal(out[0].level, "bachelor");
    assert.equal(out[0].program, "Computer Science");
    assert.equal(out[0].languageScore, "IELTS 7.0");
  });
  it("AE-3 PhD apply (group C) → bachelor + master ordered", () => {
    const out = mapExtractionToEducation(mockAll, "PhD");
    assert.deepEqual(out.map((r) => r.level), ["bachelor", "master"]);
  });
});

describe("mapExtractionToEducation — GPA guarantee", () => {
  it("AE-4 '3.5/4' → percent, gpaRaw kept, gpaScale=100", () => {
    const out = mapExtractionToEducation(mockAll, "Master");
    const b = out[0];
    assert.equal(b.gpaRaw, "3.5/4");
    assert.equal(b.gpaScale, 100);
    const pct = Number(b.gpa);
    assert.ok(pct > 80 && pct <= 100, `expected percent-ish value, got ${b.gpa}`);
  });
  it("AE-4b '87.5' stays a percent decimal", () => {
    const out = mapExtractionToEducation(mockAll, "Bachelor");
    assert.equal(out[0].gpa, "87.5");
    assert.equal(out[0].gpaScale, 100);
  });
  it("AE-5 unnormalizable gpa kept raw with null scale", () => {
    const out = mapExtractionToEducation(
      [{ level: "high_school", gpa: "Pekiyi" }],
      "Foundation",
    );
    assert.equal(out[0].gpa, "Pekiyi");
    assert.equal(out[0].gpaRaw, "Pekiyi");
    assert.equal(out[0].gpaScale, null);
  });
});

describe("mapExtractionToEducation — hygiene", () => {
  it("AE-6 high_school program nulled; duplicate level first-wins", () => {
    const out = mapExtractionToEducation(
      [
        { level: "high_school", institution: "First HS", program: "ShouldDrop" },
        { level: "high_school", institution: "Second HS" },
      ],
      "Language Course",
    );
    assert.equal(out.length, 1);
    assert.equal(out[0].institution, "First HS");
    assert.equal(out[0].program, null);
  });
  it("AE-7 garbage input → []", () => {
    assert.deepEqual(mapExtractionToEducation(undefined, "Bachelor"), []);
    assert.deepEqual(mapExtractionToEducation("nope", "Bachelor"), []);
    assert.deepEqual(mapExtractionToEducation([{ level: "kindergarten" }], "Bachelor"), []);
    assert.deepEqual(mapExtractionToEducation({ level: "bachelor" }, "Master"), []);
  });
});

describe("buildEducationPromptSection", () => {
  it("AE-8 lists exactly the required records per applied level", () => {
    const a = buildEducationPromptSection("Bachelor");
    assert.ok(a.includes('"level": "high_school"'));
    assert.ok(!a.includes('"level": "bachelor"'));

    const b = buildEducationPromptSection("Yüksek Lisans");
    assert.ok(b.includes('"level": "bachelor"'));
    assert.ok(!b.includes('"level": "high_school"'));

    const c = buildEducationPromptSection("Doktora");
    assert.ok(c.includes('"level": "bachelor"'));
    assert.ok(c.includes('"level": "master"'));
    assert.ok(c.includes("educationRecords"));
  });
});

describe("passport soft-warning", () => {
  it("AE-9 expired expiry triggers the warning path, valid does not", () => {
    assert.equal(isPassportExpired("2020-01-01"), true);
    assert.equal(isPassportExpired("2099-12-31"), false);
    assert.equal(isPassportExpired("garbage"), false);
  });
});
