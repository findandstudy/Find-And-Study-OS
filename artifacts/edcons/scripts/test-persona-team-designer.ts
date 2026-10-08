import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { parsePersonaTeamDraft, socialMockTeamTemplate } from "../../api-server/src/lib/personaTeamDraft";
import {
  DESIGNER_MAX_MEMBERS, DESIGNER_MAX_POSITION, DESIGNER_NODE_WIDTH, DESIGNER_NODE_HEIGHT,
  createDesignerTeam, validateDesignerTeam, nextDesignerMemberKey, addDesignerMember,
  updateDesignerMember, renameDesignerTeam, reparentDesignerMember, removeDesignerMember,
  getDesignerDescendantKeys, getDesignerParentOptions, layoutDesignerTeam,
  setDesignerPosition, clampDesignerPosition,
  type DesignerTeam, type DesignerMemberPatch,
} from "../src/lib/personaTeamDesigner";

const initial = () => createDesignerTeam(socialMockTeamTemplate);
const json = (value: unknown) => JSON.stringify(value);

test("authenticated backend template shape is preserved and there is no implicit client fallback", () => {
  const team = initial();
  assert.deepEqual(team, parsePersonaTeamDraft(socialMockTeamTemplate));
  assert.throws(() => createDesignerTeam(undefined));
  assert.throws(() => createDesignerTeam({ error: "Authentication required" }));
  assert.notEqual(team.members, socialMockTeamTemplate.members);
  team.members[0].name = "Changed only in local state";
  assert.equal(socialMockTeamTemplate.members[0].name, "Genel müdür");
});

test("validation orders a shuffled tree into the existing parent-before-child contract", () => {
  const team = initial();
  team.members.reverse();
  const ordered = validateDesignerTeam(team);
  assert.equal(ordered.members[0].key, "manager");
  assert.deepEqual(parsePersonaTeamDraft(ordered), ordered);
  assert.equal(team.members[0].key, "creative", "caller input must remain untouched");
});

test("duplicate keys, multiple roots, root kind, unknown parent and hidden cycles fail closed", () => {
  const cases: Array<(team: DesignerTeam) => void> = [
    (team) => { team.members[1].key = team.members[0].key; },
    (team) => { team.members[1].parent = null; },
    (team) => { team.members[0].kind = "department"; },
    (team) => { team.members[1].parent = "missing"; },
    (team) => { team.members[1].parent = "research"; },
    (team) => { team.members[2].kind = "manager"; },
    (team) => { team.members[1].parent = "social"; },
    (team) => { team.members[2].kind = "department"; team.members[1].parent = "research"; },
  ];
  for (const mutate of cases) {
    const team = initial(); mutate(team);
    assert.throws(() => validateDesignerTeam(team));
  }
});

test("runtime-shaped payloads, extra fields and non-mock policy changes are rejected", () => {
  for (const patch of [
    { provider: "openai" }, { model: "real-model" }, { tools: ["publish"] },
    { dataScopes: ["all"] }, { humanApproval: false }, { concurrency: 2 },
    { executionId: "something" }, { capMicros: 0 }, { timeoutSeconds: 31 },
    { key: "../outside" },
  ]) {
    const team = initial();
    Object.assign(team.members[0], patch);
    assert.throws(() => validateDesignerTeam(team));
  }
  assert.throws(() => validateDesignerTeam({ ...initial(), projectId: 1 }));
});

test("add operations use deterministic unique keys and preserve approved hierarchy rules", () => {
  const original = initial(), before = json(original);
  let team = addDesignerMember(original, "department", "social", { name: "  Alt birim  " });
  assert.equal(nextDesignerMemberKey(original, "department"), "department_1");
  assert.equal(team.members.find((member) => member.key === "department_1")?.name, "Alt birim");
  team = addDesignerMember(team, "specialist", "manager");
  assert.equal(team.members.find((member) => member.key === "specialist_1")?.parent, "manager");
  team = addDesignerMember(team, "specialist", "department_1");
  assert.equal(team.members.find((member) => member.key === "specialist_2")?.parent, "department_1");
  assert.deepEqual(parsePersonaTeamDraft(team), team);
  assert.equal(json(original), before);
  assert.throws(() => addDesignerMember(original, "specialist", "research"));
  assert.throws(() => addDesignerMember(original, "department", "absent"));
  assert.throws(() => addDesignerMember(original, "manager" as "department", "social"));
  assert.throws(() => addDesignerMember(original, "specialist", "social", { provider: "live" } as DesignerMemberPatch));
});

test("the existing twenty-member maximum applies to all additions", () => {
  let team = initial();
  while (team.members.length < DESIGNER_MAX_MEMBERS) team = addDesignerMember(team, "specialist", "social");
  assert.equal(team.members.length, 20);
  assert.throws(() => addDesignerMember(team, "specialist", "social"), /PERSONA_TEAM_LIMIT/);
  assert.deepEqual(parsePersonaTeamDraft(team), team);
});

test("field edits validate full limits, do not mutate inputs, and cannot change authority or hierarchy", () => {
  const original = initial(), before = json(original);
  const team = updateDesignerMember(original, "research", {
    name: " Araştırma ", purpose: " Amaç ", output: " Çıktı ", capMicros: 123, timeoutSeconds: 12,
  });
  assert.equal(team.members.find((member) => member.key === "research")?.purpose, "Amaç");
  assert.equal(json(original), before);
  for (const patch of [
    { name: " " }, { name: "x".repeat(101) }, { purpose: "x".repeat(2001) },
    { output: "" }, { capMicros: 1.5 }, { capMicros: 1000001 },
    { timeoutSeconds: 0 }, { parent: "manager" }, { kind: "manager" },
    { provider: "openai" }, { humanApproval: false },
  ]) assert.throws(() => updateDesignerMember(original, "research", patch as DesignerMemberPatch));
  assert.throws(() => updateDesignerMember(original, "absent", { name: "x" }));
  assert.equal(renameDesignerTeam(original, "  Yeni takım  ").name, "Yeni takım");
  assert.throws(() => renameDesignerTeam(original, ""));
});

test("reparent preserves descendants and ordering but rejects self/cyclic/root/specialist targets", () => {
  let original = addDesignerMember(initial(), "department", "manager");
  original = addDesignerMember(original, "department", "social");
  const before = json(original);
  const team = reparentDesignerMember(original, "social", "department_1");
  assert.equal(team.members.find((member) => member.key === "social")?.parent, "department_1");
  assert.equal(team.members.find((member) => member.key === "research")?.parent, "social");
  assert.deepEqual(parsePersonaTeamDraft(team), team);
  for (const [key, parent] of [["social", "social"], ["social", "department_2"], ["manager", "social"], ["social", "research"], ["social", "absent"]]) {
    assert.throws(() => reparentDesignerMember(original, key, parent));
  }
  assert.equal(json(original), before);
});

test("parent choices exclude descendants, leaf specialists and the selected member", () => {
  const team = addDesignerMember(initial(), "department", "social");
  assert.deepEqual(getDesignerParentOptions(team, "social").map((member) => member.key), ["manager"]);
  assert.deepEqual(getDesignerParentOptions(team, "manager"), []);
  assert.deepEqual(getDesignerParentOptions(team, "research").map((member) => member.key), ["manager", "social", "department_1"]);
  assert.deepEqual(getDesignerDescendantKeys(team, "social"), ["social", "research", "copy", "creative", "department_1"]);
  assert.throws(() => getDesignerDescendantKeys(team, "absent"));
});

test("default deletion promotes children like the existing editor and subtree deletion is explicit", () => {
  const original = addDesignerMember(initial(), "department", "social"), before = json(original);
  const promoted = removeDesignerMember(original, "social");
  assert.equal(promoted.members.length, original.members.length - 1);
  assert(promoted.members.slice(1).every((member) => member.parent === "manager"));
  assert.deepEqual(parsePersonaTeamDraft(promoted), promoted);
  const subtree = removeDesignerMember(original, "social", { mode: "subtree" });
  assert.deepEqual(subtree.members.map((member) => member.key), ["manager"]);
  assert.throws(() => removeDesignerMember(original, "manager"), /ROOT_DELETE_DENIED/);
  assert.throws(() => removeDesignerMember(original, "absent"));
  assert.throws(() => removeDesignerMember(original, "social", { mode: "anything" as "subtree" }));
  assert.equal(json(original), before);
});

test("automatic layout is deterministic, nonoverlapping, bounded and never changes relations", () => {
  const teams = [initial()];
  let broad = initial();
  while (broad.members.length < DESIGNER_MAX_MEMBERS) broad = addDesignerMember(broad, "specialist", "manager");
  teams.push(broad);
  let deep = removeDesignerMember(initial(), "social", { mode: "subtree" });
  let parent = "manager";
  while (deep.members.length < DESIGNER_MAX_MEMBERS) {
    const key = nextDesignerMemberKey(deep, "department");
    deep = addDesignerMember(deep, "department", parent); parent = key;
  }
  teams.push(deep);
  for (const team of teams) {
    const before = json(team), layout = layoutDesignerTeam(team), positions = Object.values(layout);
    assert.deepEqual(layout, layoutDesignerTeam(team));
    assert.equal(json(team), before);
    assert.equal(positions.length, team.members.length);
    for (const position of positions) {
      assert(position.x >= 0 && position.x + DESIGNER_NODE_WIDTH <= DESIGNER_MAX_POSITION);
      assert(position.y >= 0 && position.y + DESIGNER_NODE_HEIGHT <= DESIGNER_MAX_POSITION);
    }
    for (let a = 0; a < positions.length; a++) for (let b = a + 1; b < positions.length; b++) {
      const p = positions[a], q = positions[b];
      assert(Math.abs(p.x - q.x) >= DESIGNER_NODE_WIDTH || Math.abs(p.y - q.y) >= DESIGNER_NODE_HEIGHT);
    }
  }
});

test("the five-member template centers its manager and department above the specialists", () => {
  const positions = layoutDesignerTeam(initial());
  const midpoint = (positions.research.x + positions.creative.x) / 2;
  assert.equal(positions.manager.x, midpoint);
  assert.equal(positions.social.x, midpoint);
  assert.equal(positions.copy.x, midpoint);
  assert(positions.research.x < positions.copy.x && positions.copy.x < positions.creative.x);
  assert(positions.manager.y < positions.social.y && positions.social.y < positions.copy.y);
  assert.equal(positions.research.y, positions.copy.y);
  assert.equal(positions.copy.y, positions.creative.y);
});

test("uneven subtrees center parents over their complete descendant span", () => {
  let team = addDesignerMember(initial(), "department", "manager");
  team = addDesignerMember(team, "specialist", "department_1");
  const positions = layoutDesignerTeam(team);
  assert.equal(positions.social.x, (positions.research.x + positions.creative.x) / 2);
  assert.equal(positions.department_1.x, positions.specialist_1.x);
  assert.equal(positions.manager.x, (positions.research.x + positions.specialist_1.x) / 2);
});

test("position moves are immutable and reject invalid coordinates while explicit clamp is bounded", () => {
  const positions = layoutDesignerTeam(initial()), before = json(positions);
  const moved = setDesignerPosition(positions, "social", { x: 90.5, y: 120 });
  assert.deepEqual(moved.social, { x: 90.5, y: 120 });
  assert.equal(json(positions), before);
  for (const position of [{ x: NaN, y: 1 }, { x: Infinity, y: 1 }, { x: -1, y: 1 }, { x: 1, y: 3801 }]) {
    assert.throws(() => setDesignerPosition(positions, "social", position));
  }
  assert.deepEqual(clampDesignerPosition({ x: -4, y: 5000 }), { x: 0, y: 3800 });
  assert.throws(() => clampDesignerPosition({ x: NaN, y: 0 }));
  assert.throws(() => setDesignerPosition(positions, "__proto__", { x: 1, y: 1 }));
  let filled = {};
  for (let index = 0; index < 20; index++) filled = setDesignerPosition(filled, `member_${index}`, { x: 1, y: 1 });
  assert.throws(() => setDesignerPosition(filled, "overflow", { x: 1, y: 1 }));
});

test("the local model has no persistence, network, provider or server dependency", () => {
  const source = readFileSync(new URL("../src/lib/personaTeamDesigner.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\b(fetch|XMLHttpRequest|WebSocket|localStorage|sessionStorage|indexedDB)\b/);
  assert.doesNotMatch(source, /from\s+["'][^"']*(api-server|node:|provider)/);
});
