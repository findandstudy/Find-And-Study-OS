import assert from "node:assert/strict";
import test from "node:test";
import { parsePersonaTeamWorkspace } from "../src/lib/personaTeamWorkspace";
import { socialMockTeamTemplate } from "../src/lib/personaTeamDraft";

const workspace = () => ({
  expectedRevision: 0,
  document: structuredClone(socialMockTeamTemplate),
  layout: {
    positions: [{ key: "manager", x: 40, y: 80 }],
    zoom: 1,
    selectedKey: "manager",
  },
});
test("editable workspace preserves document and layout without creating approval fields", () => {
  const parsed = parsePersonaTeamWorkspace(workspace());
  assert.equal(parsed.document.members.length, 5);
  assert.deepEqual(parsed.layout.positions, [{ key: "manager", x: 40, y: 80 }]);
  assert.equal("approved" in parsed, false);
});
for (const [label, edit] of [
  ["revision omission", (v: any) => delete v.expectedRevision],
  ["negative revision", (v: any) => (v.expectedRevision = -1)],
  ["overflow revision", (v: any) => (v.expectedRevision = 2147483647)],
  ["actor spoof", (v: any) => (v.actor = "another-principal")],
  ["project spoof", (v: any) => (v.projectId = "another-project")],
  ["approval spoof", (v: any) => (v.approved = true)],
  ["unknown member", (v: any) => (v.layout.positions[0].key = "unknown")],
  [
    "duplicate position",
    (v: any) => v.layout.positions.push(v.layout.positions[0]),
  ],
  ["out of bounds coordinate", (v: any) => (v.layout.positions[0].x = 3801)],
  ["infinite coordinate", (v: any) => (v.layout.positions[0].y = Infinity)],
  ["unsupported zoom", (v: any) => (v.layout.zoom = 10)],
  ["unknown selection", (v: any) => (v.layout.selectedKey = "unknown")],
  ["layout injection", (v: any) => (v.layout.execution = true)],
  ["live provider", (v: any) => (v.document.members[0].provider = "anthropic")],
  ["broken tree", (v: any) => (v.document.members[0].parent = "creative")],
] as const)
  test(`workspace rejects ${label}`, () => {
    const value = workspace();
    edit(value);
    assert.throws(() => parsePersonaTeamWorkspace(value));
  });
test("workspace UTF-8 payload has a bounded transport size", () => {
  const value = workspace();
  for (const member of value.document.members) {
    member.purpose = "語".repeat(1800);
    member.output = "語".repeat(1800);
  }
  assert.throws(
    () => parsePersonaTeamWorkspace(value),
    /PERSONA_WORKSPACE_TOO_LARGE/,
  );
});
test("workspace allows incomplete visual placement but no unvalidated team document", () => {
  const value = workspace();
  value.layout.positions = [];
  value.layout.selectedKey = null as any;
  assert.equal(parsePersonaTeamWorkspace(value).layout.positions.length, 0);
});
