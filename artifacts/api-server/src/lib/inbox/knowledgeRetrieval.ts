// AI Agent Faz 2 — retrieval: embed the student's message and pull the top-K
// most relevant chunks from ACTIVE, ready file/url/text knowledge sources.
// Never touches program_scope/webhook/conversation source types — those stay
// on their own dedicated paths (searchPrograms tool / future integrations).
//
// Faz 2b: production Postgres (Hostinger) has no pgvector extension
// available, so embeddings are stored as plain JSONB float arrays and
// similarity is computed with brute-force cosine in Node. This is entirely
// fast enough for a knowledge base of a few thousand chunks — do not
// reintroduce the `vector` type, `<=>` operator, or ivfflat/hnsw indexes.
import { db, knowledgeChunksTable, knowledgeSourcesTable } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { embedQuery } from "./knowledgeEmbed";

export interface RetrievedChunk {
  sourceId: number;
  sourceName: string;
  content: string;
  distance: number;
}

const RAG_SOURCE_TYPES = ["file", "url", "text"] as const;
const TOP_K = 5;
// Cosine distance (1 - cosine similarity) ranges 0 (identical) to 2
// (opposite). Chunks farther than this are considered irrelevant noise and
// dropped.
const MAX_DISTANCE = 0.6;

function cosineDistance(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 2;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 2;
  const similarity = dot / (Math.sqrt(normA) * Math.sqrt(normB));
  return 1 - similarity;
}

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

    const rows = await db
      .select({
        sourceId: knowledgeChunksTable.sourceId,
        content: knowledgeChunksTable.content,
        embedding: knowledgeChunksTable.embedding,
      })
      .from(knowledgeChunksTable)
      .where(inArray(knowledgeChunksTable.sourceId, [...idSet]));

    const scored = rows
      .map((r) => ({
        sourceId: r.sourceId,
        sourceName: nameById.get(r.sourceId) ?? "Knowledge source",
        content: r.content,
        distance: cosineDistance(embedding, (r.embedding as number[] | null) ?? []),
      }))
      .filter((r) => r.distance <= MAX_DISTANCE)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, TOP_K);

    return scored;
  } catch (err) {
    console.error("[knowledge-retrieval] failed, continuing without RAG context:", err);
    return [];
  }
}
