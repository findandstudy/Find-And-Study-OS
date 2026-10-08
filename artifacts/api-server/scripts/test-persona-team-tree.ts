import assert from "node:assert/strict";
import test from "node:test";
// Browser module also exposes pure tree transformations for the contract tests.
// @ts-ignore JS module intentionally shared with the isolated browser.
import {
  orderedTeam,
  moveTeamMember,
  removeTeamMember,
  describeTeamChanges,
} from "../src/lib/persona-team-tree.client.js";
import {
  socialMockTeamTemplate,
  parsePersonaTeamDraft,
  personaTeamDigest,
} from "../src/lib/personaTeamDraft";
test("change summary makes additions removals and instruction/parent edits explicit", () => {
  const changed = moveTeamMember(socialMockTeamTemplate, "research", "manager");
  changed.members.find((m: any) => m.key === "copy").purpose =
    "Updated instruction";
  changed.members.push({
    ...changed.members[1],
    key: "new_department",
    name: "New department",
  });
  const changes = describeTeamChanges(
    socialMockTeamTemplate,
    removeTeamMember(changed, "creative"),
  );
  assert.ok(changes.some((line: string) => line.includes("bağlı birim")));
  assert.ok(changes.some((line: string) => line.includes("talimat")));
  assert.ok(
    changes.some((line: string) => line.includes("Eklendi: New department")),
  );
  assert.ok(
    changes.some((line: string) => line.includes("Taslaktan çıkarıldı:")),
  );
  assert.deepEqual(
    describeTeamChanges(socialMockTeamTemplate, socialMockTeamTemplate),
    [],
  );
});
test("delete preserves children under the former parent and never deletes the root", () => {
  const result = removeTeamMember(socialMockTeamTemplate, "social");
  assert.equal(result.members.length, 4);
  assert.equal(
    result.members.find((m: any) => m.key === "research").parent,
    "manager",
  );
  parsePersonaTeamDraft(result);
  assert.equal(socialMockTeamTemplate.members.length, 5);
  assert.equal(
    removeTeamMember(socialMockTeamTemplate, "copy").members.length,
    4,
  );
  assert.throws(() => removeTeamMember(socialMockTeamTemplate, "manager"));
  assert.throws(() => removeTeamMember(socialMockTeamTemplate, "missing"));
});

test("tree edits preserve the existing server document contract and original draft", () => {
  const original = structuredClone(socialMockTeamTemplate);
  const result = moveTeamMember(original, "research", "manager");
  assert.equal(
    result.members.find((m: any) => m.key === "research").parent,
    "manager",
  );
  assert.deepEqual(original, socialMockTeamTemplate);
  parsePersonaTeamDraft(result);
  assert.notEqual(personaTeamDigest(result), personaTeamDigest(original));
  for (const m of result.members) {
    assert.equal(m.humanApproval, true);
    assert.equal(m.provider, "mock");
    assert.deepEqual(m.tools, ["mock_draft"]);
  }
});
test("tree reorders parent before descendants without dropping members", () => {
  const original = structuredClone(socialMockTeamTemplate);
  original.members.push({
    ...original.members[1],
    key: "second",
    name: "Second",
  });
  const result = moveTeamMember(original, "social", "second");
  parsePersonaTeamDraft(result);
  assert.equal(result.members.length, 6);
  assert.equal(result.members[1].key, "second");
  assert.equal(
    result.members.find((m: any) => m.key === "copy").parent,
    "social",
  );
});
for (const [key, parent] of [
  ["manager", "social"],
  ["social", "social"],
  ["social", "copy"],
  ["copy", "missing"],
  ["missing", "manager"],
]) {
  test("tree rejects invalid relation " + key + "/" + parent, () => {
    assert.throws(() => moveTeamMember(socialMockTeamTemplate, key, parent));
  });
}
test("tree rejects cycles, duplicates, disconnected records and excessive membership", () => {
  const cycle = structuredClone(socialMockTeamTemplate);
  cycle.members.push({ ...cycle.members[1], key: "child", parent: "social" });
  assert.throws(() => moveTeamMember(cycle, "social", "child"));
  assert.throws(() =>
    orderedTeam({ ...cycle, members: [...cycle.members, cycle.members[1]] }),
  );
  assert.throws(() =>
    orderedTeam({
      ...cycle,
      members: cycle.members.map((m) =>
        m.key === "social" ? { ...m, parent: "absent" } : m,
      ),
    }),
  );
  assert.throws(() =>
    orderedTeam({
      ...cycle,
      members: Array.from({ length: 21 }, () => cycle.members[0]),
    }),
  );
});
