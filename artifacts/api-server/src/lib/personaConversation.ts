import { z } from "zod";
// No audio/provider call. Voice text must be confirmed by its human author.
export const personaMessageSchema = z
  .object({
    conversationId: z.string().uuid(),
    personaId: z.number().int().positive(),
    text: z.string().trim().min(1).max(8000),
    source: z.enum(["text", "confirmed_voice", "document_note"]),
    sourceLabel: z.string().trim().min(1).max(200),
    confirmed: z.boolean(),
    retentionDays: z.number().int().min(1).max(30),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.source === "confirmed_voice" && !value.confirmed)
      context.addIssue({
        code: "custom",
        message: "Voice transcript confirmation required",
      });
  });
