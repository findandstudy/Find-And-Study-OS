import { z } from "zod";
export const workflowSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    brief: z.string().trim().min(1).max(2000),
    nodes: z
      .array(
        z
          .object({
            key: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/),
            personaId: z.number().int().positive(),
            dependsOn: z.array(z.string()).max(8),
          })
          .strict(),
      )
      .min(1)
      .max(8),
  })
  .strict();
export function parsePersonaWorkflow(input: unknown) {
  const result = workflowSchema.parse(input);
  const seen = new Set<string>();
  for (const node of result.nodes) {
    if (
      seen.has(node.key) ||
      new Set(node.dependsOn).size !== node.dependsOn.length ||
      node.dependsOn.some((key) => !seen.has(key))
    )
      throw Error("PERSONA_WORKFLOW_DEPENDENCY_INVALID");
    seen.add(node.key);
  }
  return result;
}
export function socialMockWorkflow(
  personas: {
    research: number;
    copy: number;
    creative: number;
    quality: number;
  },
  brief: string,
) {
  return parsePersonaWorkflow({
    name: "Social mock draft pipeline",
    brief,
    nodes: [
      { key: "research", personaId: personas.research, dependsOn: [] },
      { key: "copy", personaId: personas.copy, dependsOn: ["research"] },
      {
        key: "media_storyboard",
        personaId: personas.creative,
        dependsOn: ["copy"],
      },
      {
        key: "quality_review",
        personaId: personas.quality,
        dependsOn: ["research", "copy", "media_storyboard"],
      },
    ],
  });
}
