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
): Promise<{
  matches: Array<{ source: string; content: string }>;
  costRecords: Array<Record<string, unknown>>;
  authoritative: true;
}> {
  const query = input && typeof input === "object" && typeof (input as { query?: unknown }).query === "string"
    ? (input as { query: string }).query.trim()
    : "";
  if (!query || !(await isDormBookingCatalogToolEnabled(aiBotId))) {
    const empty = { matches: [], costRecords: [], authoritative: true as const };
    traceCatalogCall({ query, aiBotId, result: empty });
    return empty;
  }
  const chunks = await retrieveKnowledgeChunks(query, {
    aiBotId,
    sourceTypes: ["dormbooking"],
  });
  const campusGuidance = resolveDormBookingCampusGuidance(query);
  const matches = [
    ...(campusGuidance ? [{ source: "DormBooking verified campus routing table", content: campusGuidance }] : []),
    ...chunks.map((chunk) => ({ source: chunk.sourceName, content: chunk.content })),
  ];
  const costRecords = matches.flatMap((match) => {
    const records: Array<Record<string, unknown>> = [];
    for (const found of match.content.matchAll(/CATALOG COST JSON:\s*(\{[^\n]+\})/g)) {
      try {
        const value = JSON.parse(found[1]);
        if (value && typeof value === "object") records.push(value as Record<string, unknown>);
      } catch {
        // A malformed upstream record remains in the text for diagnosis but
        // is never presented as a structured price record.
      }
    }
    return records;
  });
  const result = {
    matches: [
      ...matches,
    ],
    costRecords,
    authoritative: true as const,
  };
  traceCatalogCall({ query, aiBotId, result });
  return result;
}

function traceCatalogCall(input: { query: string; aiBotId?: number | null; result: unknown }): void {
  const until = Date.parse(process.env.DORMBOOKING_CATALOG_TRACE_UNTIL ?? "");
  if (!Number.isFinite(until) || Date.now() > until) return;
  const serialized = JSON.stringify({
    event: "dormbooking_catalog_tool",
    at: new Date().toISOString(),
    aiBotId: input.aiBotId ?? null,
    arguments: { query: input.query.slice(0, 500) },
    rawResponse: input.result,
  });
  // Keep a single call from flooding logs while retaining enough raw catalog
  // output to diagnose absent fields during the temporary trace window.
  console.info(serialized.slice(0, 100_000));
}
