import assert from "node:assert/strict";
import test from "node:test";
import { applyAiWritingField, collectAiWritingFields, detailAiPageFacts, detailAiWritingContext } from "../src/pages/admin/website/adminAiWriting";

test("AI writing inventory includes nested editable copy and excludes operational values", () => {
  const section = {
    title: "Overview",
    body: "",
    href: "/en/programs",
    presentation: { backgroundColor: "#fff" },
    cards: [{ title: "First card", body: "Details", href: "https://example.com" }],
    sources: [{ label: "Official source", url: "https://example.com" }],
  };
  const fields = collectAiWritingFields(section);
  assert.deepEqual(fields.map(field => field.path), ["root.title", "root.body", "root.cards[0].title", "root.cards[0].body"]);
  const updated = applyAiWritingField(section, "root.cards[0].body", "Updated details");
  assert.equal(updated.cards[0].body, "Updated details");
  assert.equal(updated.cards[0].href, "https://example.com");
  assert.equal(section.cards[0].body, "Details");
});

test("detail AI context binds catalogue city, country, university and program facts automatically", () => {
  const payload = { data: { id: 5, name: "Computer Science", universityName: "Acıbadem University", universityCity: "Istanbul", universityCountry: "Türkiye" } };
  assert.deepEqual(detailAiPageFacts("program", payload), {
    city: "Istanbul",
    country: "Türkiye",
    university: "Acıbadem University",
    program: "Computer Science",
  });
  const context = detailAiWritingContext({ kind: "program", pageTitle: "Computer Science", sectionTitle: "Overview", sectionKey: "overview", payload });
  for (const expected of ["COUNTRY: Türkiye", "CITY: Istanbul", "UNIVERSITY: Acıbadem University", "PROGRAM: Computer Science"]) assert.match(context, new RegExp(expected));
  assert.match(context, /Never guess a missing city, country, university or program/);
});
