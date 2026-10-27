import assert from "node:assert/strict";
import test from "node:test";
import {
  parsePersonaTeamDraft,
  personaTeamDigest,
  socialMockTeamTemplate,
} from "../src/lib/personaTeamDraft";
test("social team is editable but bounded to mock, human-reviewed capabilities", () => {
  const draft = parsePersonaTeamDraft(socialMockTeamTemplate);
  assert.equal(draft.members.length, 5);
  assert.equal(draft.members[2].parent, "social");
  const changed = structuredClone(draft);
  changed.members[2].purpose = "Another reviewed purpose";
  assert.notEqual(personaTeamDigest(changed), personaTeamDigest(draft));
});
for (const [label, change] of [
  ["live provider", (d: any) => (d.members[0].provider = "anthropic")],
  ["grant injection", (d: any) => (d.members[0].role = "super_admin")],
  ["side effect tool", (d: any) => (d.members[0].tools = ["send_message"])],
  ["unreviewed operation", (d: any) => (d.members[0].humanApproval = false)],
  ["unknown budget", (d: any) => (d.members[0].capMicros = null)],
  ["cycle", (d: any) => (d.members[0].parent = "creative")],
  ["duplicate", (d: any) => (d.members[1].key = "manager")],
  [
    "multiple root",
    (d: any) => {
      d.members[1].parent = null;
      d.members[1].kind = "manager";
    },
  ],
  ["specialist manager", (d: any) => (d.members[4].parent = "copy")],
  ["unbounded concurrency", (d: any) => (d.members[0].concurrency = 100)],
] as const)
  test("rejects " + label, () => {
    const draft = structuredClone(socialMockTeamTemplate);
    change(draft);
    assert.throws(() => parsePersonaTeamDraft(draft));
  });
