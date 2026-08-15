import { db, knowledgeSourcesTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { retrieveKnowledgeChunks } from "./knowledgeRetrieval";
import { resolveDormBookingCampusGuidance } from "./dormBookingCampusMap";

export const SEARCH_DORMBOOKING_CATALOG_TOOL_NAME = "searchDormBookingCatalog";

export const searchDormBookingCatalogToolDefinition = {
  name: SEARCH_DORMBOOKING_CATALOG_TOOL_NAME,
  description:
    "Search the bot's authoritative DormBooking Live Catalog. Use this before naming a dormitory, room, price, fee, gender eligibility, district or listing URL. An empty result means no catalog-backed answer is allowed.",
  input_schema: {
    type: "object" as const,
    properties: {
      query: { type: "string", description: "Student need or exact dormitory/room query" },
    },
    required: ["query"],
    additionalProperties: false,
  },
};

export async function isDormBookingCatalogToolEnabled(aiBotId?: number | null): Promise<boolean> {
  if (!Number.isInteger(aiBotId) || Number(aiBotId) <= 0) return false;
  const [source] = await db.select({ id: knowledgeSourcesTable.id })
    .from(knowledgeSourcesTable)
    .where(and(
      eq(knowledgeSourcesTable.aiBotId, Number(aiBotId)),
      eq(knowledgeSourcesTable.type, "dormbooking"),
      eq(knowledgeSourcesTable.isActive, true),
      eq(knowledgeSourcesTable.status, "ready"),
    ));
  return Boolean(source);
}

export async function executeDormBookingCatalogTool(
  input: unknown,
  aiBotId?: number | null,
): Promise<{ matches: Array<{ source: string; content: string }>; authoritative: true }> {
  const query = input && typeof input === "object" && typeof (input as { query?: unknown }).query === "string"
    ? (input as { query: string }).query.trim()
    : "";
  if (!query || !(await isDormBookingCatalogToolEnabled(aiBotId))) {
    return { matches: [], authoritative: true };
  }
  const chunks = await retrieveKnowledgeChunks(query, {
    aiBotId,
    sourceTypes: ["dormbooking"],
  });
  const campusGuidance = resolveDormBookingCampusGuidance(query);
  return {
    matches: [
      ...(campusGuidance ? [{ source: "DormBooking verified campus routing table", content: campusGuidance }] : []),
      ...chunks.map((chunk) => ({ source: chunk.sourceName, content: chunk.content })),
    ],
    authoritative: true,
  };
}
