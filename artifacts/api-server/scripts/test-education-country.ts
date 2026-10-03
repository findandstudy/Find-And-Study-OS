import test from "node:test";
import assert from "node:assert/strict";
import { cleanStudentEducationRecords } from "../src/lib/studentEducationInput";
import {
  buildEducationPromptSection,
  mapExtractionToEducation,
} from "../src/lib/educationExtraction";

test("education country supports all four levels and explicit clearing", () => {
  const result = cleanStudentEducationRecords([
    { level: "high_school", country: "Türkiye" },
    { level: "bachelor", country: "Germany" },
    { level: "master", country: null },
    { level: "doctorate", country: "United Kingdom" },
  ]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.records.map((record) => record.country), [
    "Türkiye",
    "Germany",
    null,
    "United Kingdom",
  ]);
});

test("an old client that omits country remains compatible", () => {
  const result = cleanStudentEducationRecords([
    { level: "bachelor", institution: "Example University" },
  ]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.records[0]?.country, null);
});

test("AI mapping keeps an explicit school country and does not infer one", () => {
  const explicit = mapExtractionToEducation([
    {
      level: "bachelor",
      institution: "Example University",
      country: "Canada",
      graduationYear: 2025,
      gpa: "80",
    },
  ], "Master");
  assert.equal(explicit[0]?.country, "Canada");

  const missing = mapExtractionToEducation([
    {
      level: "bachelor",
      institution: "Example University",
      graduationYear: 2025,
      gpa: "80",
    },
  ], "Master");
  assert.equal(missing[0]?.country, null);
});

test("AI prompt forbids guessing the school country", () => {
  const prompt = buildEducationPromptSection("Master");
  assert.match(prompt, /country where the school or university is located/i);
  assert.match(prompt, /only when explicitly shown/i);
  assert.match(prompt, /never guess/i);
});
