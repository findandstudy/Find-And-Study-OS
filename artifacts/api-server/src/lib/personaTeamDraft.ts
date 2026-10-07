import { createHash } from "node:crypto";
import { z } from "zod";

const member = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/),
    name: z.string().trim().min(1).max(100),
    kind: z.enum(["manager", "department", "specialist"]),
    parent: z.string().nullable(),
    purpose: z.string().trim().min(1).max(2000),
    output: z.string().trim().min(1).max(2000),
    provider: z.literal("mock"),
    model: z.literal("mock-fixture"),
    tools: z.array(z.literal("mock_draft")).length(1),
    dataScopes: z.array(z.literal("persona_mock_context")).length(1),
    capMicros: z.number().int().positive().max(1000000),
    timeoutSeconds: z.number().int().min(1).max(30),
    concurrency: z.literal(1),
    humanApproval: z.literal(true),
  })
  .strict();
const schema = z
  .object({
    schemaVersion: z.literal(1),
    name: z.string().trim().min(1).max(100),
    members: z.array(member).min(1).max(20),
  })
  .strict();
export function parsePersonaTeamDraft(input: unknown) {
  const value = schema.parse(input);
  const seen = new Map<string, (typeof value.members)[number]>();
  let roots = 0;
  for (const item of value.members) {
    if (seen.has(item.key)) throw Error("PERSONA_TEAM_DUPLICATE");
    if (item.parent === null) {
      if (item.kind !== "manager") throw Error("PERSONA_TEAM_ROOT_INVALID");
      roots++;
    } else {
      const parent = seen.get(item.parent);
      if (!parent || parent.kind === "specialist" || item.kind === "manager")
        throw Error("PERSONA_TEAM_PARENT_INVALID");
    }
    seen.set(item.key, item);
  }
  if (roots !== 1) throw Error("PERSONA_TEAM_ROOT_INVALID");
  return value;
}
export function personaTeamDigest(input: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(parsePersonaTeamDraft(input)))
    .digest("hex");
}
export const socialMockTeamTemplate = {
  schemaVersion: 1,
  name: "Find And Study — sosyal medya taslak ekibi",
  members: [
    ["manager", "Genel müdür", "manager", null],
    ["social", "Sosyal medya birimi", "department", "manager"],
    ["research", "Araştırma uzmanı", "specialist", "social"],
    ["copy", "Metin uzmanı", "specialist", "social"],
    ["creative", "Görsel/video taslak uzmanı", "specialist", "social"],
  ].map(([key, name, kind, parent]) => ({
    key,
    name,
    kind,
    parent,
    purpose: "Yalnız sentetik yerel taslak hazırlama",
    output: "İnsan incelemesine sunulan taslak",
    provider: "mock",
    model: "mock-fixture",
    tools: ["mock_draft"],
    dataScopes: ["persona_mock_context"],
    capMicros: 100000,
    timeoutSeconds: 30,
    concurrency: 1,
    humanApproval: true,
  })),
};

