// AI Agent Faz 2 — retrieval: embed the student's message and pull the top-K
// most relevant chunks from ACTIVE, ready file/url/text knowledge sources.
// Never touches program_scope/webhook/conversation source types — those stay
// on their own dedicated paths (searchPrograms tool / future integrations).
import { db, knowledgeChunksTable, knowledgeSourcesTable } from "@workspace/db";
import { and, eq, sql, inArray } from "drizzle-orm";
import { embedQuery } from "./knowledgeEmbed";

export interface RetrievedChunk {
  sourceId: number;
  sourceName: string;
  content: string;
  distance: number;
}

const RAG_SOURCE_TYPES = ["file", "url", "text"] as const;
const TOP_K = 5;
// Cosine distance (pgvector `<=>`) ranges 0 (identical) to 2 (opposite).
// Chunks farther than this are considered irrelevant noise and dropped.
const MAX_DISTANCE = 0.6;

/**
 * Retrieve the top-K relevant knowledge chunks for a query message. Returns an
 * empty array (never throws) on any failure — embeddings being unavailable
 * (e.g. missing OPENAI_API_KEY) or the DB being unreachable must never break
 * the bot reply; retrieval is an enhancement, not a hard dependency.
 */
export async function retrieveKnowledgeChunks(query: string): Promise<RetrievedChunk[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  try {
    const activeSourceIds = await db
      .select({ id: knowledgeSourcesTable.id, name: knowledgeSourcesTable.name })
      .from(knowledgeSourcesTable)
      .where(
        and(
          inArray(knowledgeSourcesTable.type, [...RAG_SOURCE_TYPES]),
          eq(knowledgeSourcesTable.isActive, true),
          eq(knowledgeSourcesTable.status, "ready"),
        ),
      );
    if (activeSourceIds.length === 0) return [];
    const idSet = new Set(activeSourceIds.map((s) => s.id));
    const nameById = new Map(activeSourceIds.map((s) => [s.id, s.name]));

    const embedding = await embedQuery(trimmed);
    const vectorLiteral = `[${embedding.join(",")}]`;

    const rows = await db
      .select({
        sourceId: knowledgeChunksTable.sourceId,
        content: knowledgeChunksTable.content,
        distance: sql<number>`${knowledgeChunksTable.embedding} <=> ${vectorLiteral}::vector`,
      })
      .from(knowledgeChunksTable)
      .where(inArray(knowledgeChunksTable.sourceId, [...idSet]))
      .orderBy(sql`${knowledgeChunksTable.embedding} <=> ${vectorLiteral}::vector`)
      .limit(TOP_K);

    return rows
      .filter((r) => r.distance <= MAX_DISTANCE)
      .map((r) => ({
        sourceId: r.sourceId,
        sourceName: nameById.get(r.sourceId) ?? "Knowledge source",
        content: r.content,
        distance: r.distance,
      }));
  } catch (err) {
    console.error("[knowledge-retrieval] failed, continuing without RAG context:", err);
    return [];
  }
}
