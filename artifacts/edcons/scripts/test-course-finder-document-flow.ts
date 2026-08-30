import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";

const courseFinderPath = new URL("../src/pages/staff/CourseFinder.tsx", import.meta.url);

test("course finder persists selected documents before application validation", async () => {
  const source = await readFile(courseFinderPath, "utf8");
  const submitStart = source.indexOf("async function handleSubmit()");
  const saveIndex = source.indexOf("await saveDocumentsForStudent(", submitStart);
  const applyIndex = source.indexOf("/api/course-finder/apply", submitStart);

  assert.ok(submitStart > 0);
  assert.ok(saveIndex > submitStart, "selected files must be persisted during submit");
  assert.ok(applyIndex > saveIndex, "files must be persisted before the apply API call");
  assert.match(source, /uploadedDocumentIds,/);
  assert.match(source, /submittedDocumentCount/);
  assert.doesNotMatch(source, /\bdocCount\b/);
  assert.doesNotMatch(source, /\{uploadedCount\}/);
  assert.doesNotMatch(source, /saveDocumentsForApplication/);
});

test("course finder progress counts only satisfied mandatory slots", async () => {
  const source = await readFile(courseFinderPath, "utf8");

  assert.match(source, /const satisfiedRequiredCount = requiredDocKeys\.length - missingRequiredCount/);
  assert.match(
    source,
    /uploadedCount", \{ n: satisfiedRequiredCount, total: requiredDocKeys\.length \}/,
  );
  assert.match(source, /String\(d\.status \|\| ""\)\.toLowerCase\(\) !== "rejected"/);
});

test("student course finder resolves the student profile id before document access", async () => {
  const source = await readFile(courseFinderPath, "utf8");
  assert.match(source, /course-finder-self-student/);
  assert.match(source, /api\/students\/me/);
  assert.match(source, /id: selfStudentProfile\.id/);
  assert.doesNotMatch(source, /id: currentUser\.id,[\s\S]{0,160}setSelectedStudent/);
});
