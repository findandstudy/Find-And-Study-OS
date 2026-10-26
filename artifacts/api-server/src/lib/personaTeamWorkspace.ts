import { z } from "zod";
import { parsePersonaTeamDraft } from "./personaTeamDraft";

const key = z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/);
const layoutSchema = z
  .object({
    positions: z
      .array(
        z
          .object({
            key,
            x: z.number().finite().min(0).max(3800),
            y: z.number().finite().min(0).max(3800),
          })
          .strict(),
      )
      .max(20),
    zoom: z.number().finite().min(0.25).max(2),
    selectedKey: key.nullable(),
  })
  .strict();
const inputSchema = z
  .object({
    expectedRevision: z.number().int().min(0).max(2147483646),
    document: z.unknown(),
    layout: layoutSchema,
  })
  .strict();

/** An actor's editable work, not an approved team or execution authority.
 * Sharing, approval, installation and execution remain separate existing flows. */
export function parsePersonaTeamWorkspace(input: unknown) {
  const value = inputSchema.parse(input);
  const document = parsePersonaTeamDraft(value.document);
  const members = new Set(document.members.map((member) => member.key));
  const positioned = new Set<string>();
  for (const position of value.layout.positions) {
    if (!members.has(position.key) || positioned.has(position.key))
      throw new Error("PERSONA_WORKSPACE_LAYOUT_INVALID");
    positioned.add(position.key);
  }
  if (
    value.layout.selectedKey !== null &&
    !members.has(value.layout.selectedKey)
  )
    throw new Error("PERSONA_WORKSPACE_LAYOUT_INVALID");
  const result = { ...value, document };
  // Remain below the existing scoped API's 32 KiB JSON limit, including UTF-8.
  if (Buffer.byteLength(JSON.stringify(result), "utf8") > 30 * 1024)
    throw new Error("PERSONA_WORKSPACE_TOO_LARGE");
  return result;
}
