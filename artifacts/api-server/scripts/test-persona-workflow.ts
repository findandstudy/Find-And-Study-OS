import assert from "node:assert/strict";
import test from "node:test";
import {
  parsePersonaWorkflow,
  socialMockWorkflow,
} from "../src/lib/personaWorkflow";
import { personaMessageSchema } from "../src/lib/personaConversation";
const draft = () =>
  socialMockWorkflow(
    { research: 1, copy: 2, creative: 3, quality: 4 },
    "Synthetic brief",
  );
test("social workflow preserves research, copy, storyboard and QA dependency order", () => {
  const d = draft();
  assert.equal(d.nodes.length, 4);
  assert.deepEqual(d.nodes[3].dependsOn, [
    "research",
    "copy",
    "media_storyboard",
  ]);
});
for (const [name, change] of [
  ["cycle", (d: any) => (d.nodes[0].dependsOn = ["quality_review"])],
  ["duplicate key", (d: any) => (d.nodes[1].key = "research")],
  ["unknown dependency", (d: any) => (d.nodes[1].dependsOn = ["external"])],
  [
    "duplicate dependency",
    (d: any) => (d.nodes[1].dependsOn = ["research", "research"]),
  ],
  ["role injection", (d: any) => (d.role = "super_admin")],
  ["live tool", (d: any) => (d.nodes[0].tool = "publish")],
  ["unbounded brief", (d: any) => (d.brief = "x".repeat(2001))],
] as const)
  test("workflow rejects " + name, () => {
    const d = draft();
    change(d);
    assert.throws(() => parsePersonaWorkflow(d));
  });
const message = {
  conversationId: "018f6000-0000-7000-8000-000000000888",
  personaId: 1,
  text: "Synthetic transcript",
  source: "confirmed_voice",
  sourceLabel: "Human confirmed",
  confirmed: true,
  retentionDays: 7,
};
test("voice transcript is accepted only with human confirmation", () => {
  assert.equal(personaMessageSchema.parse(message).source, "confirmed_voice");
  assert.throws(() =>
    personaMessageSchema.parse({ ...message, confirmed: false }),
  );
});
test("memory disallows indefinite retention, provider fields and empty content", () => {
  for (const patch of [
    { retentionDays: 0 },
    { retentionDays: 31 },
    { provider: "heygen" },
    { text: " " },
  ])
    assert.throws(() => personaMessageSchema.parse({ ...message, ...patch }));
});
