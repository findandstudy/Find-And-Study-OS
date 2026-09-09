import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const program = readFileSync(new URL("../src/pages/public/ProgramDetail.tsx", import.meta.url), "utf8");
const university = readFileSync(new URL("../src/pages/public/UniversityDetail.tsx", import.meta.url), "utf8");
const countries = readFileSync(new URL("../src/pages/public/Countries.tsx", import.meta.url), "utf8");

test("program template keeps prototype information architecture data-bound", () => {
  for (const anchor of ["overview", "requirements", "intakes", "fees", "related"]) {
    assert.match(program, new RegExp(`(?:href=\\"#${anchor}\\"|id=\\"${anchor}\\")`));
  }
  assert.match(program, /payload\.prices\.slice\(0, 8\)/);
  assert.match(program, /applicationDeadlineAt/);
  assert.match(program, /PUBLISHED_INDEXABLE_ONLY/);
  assert.doesNotMatch(program, /Fenerbahçe|3000|30 Nov 2026|unsplash/i);
  assert.doesNotMatch(program, /dangerouslySetInnerHTML/);
});

test("university template keeps overview, facts and governed programs connected", () => {
  for (const anchor of ["overview", "facts", "programs"]) {
    assert.match(university, new RegExp(`(?:href=\\"#${anchor}\\"|id=\\"${anchor}\\")`));
  }
  assert.match(university, /payload\.meta\.programCount/);
  assert.match(university, /programLinkPolicy/);
  assert.match(university, /rel="noopener noreferrer"/);
  assert.doesNotMatch(university, /Fenerbahçe|YÖK|ICEF|example\.com/i);
  assert.doesNotMatch(university, /dangerouslySetInnerHTML/);
});

test("destination collection requests the active locale and follows canonical paths", () => {
  assert.match(countries, /public\/destinations\?locale=/);
  assert.match(countries, /\[lang\]/);
  assert.match(countries, /dest\.canonicalPath \|\| localePath/);
});
