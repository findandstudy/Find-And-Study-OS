import { pgTable, serial, integer, text, boolean, jsonb, timestamp, customType } from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Table — knowledge_sources (AI Agent Faz 1 scaffold, extended in Faz 2)
//
// A generic registry of sources the AI intake agent may draw live information
// from. Faz 1 shipped exactly one row, type='program_scope', whose `config` is
// the { enabled, countries, universityTypes } scope object also mirrored onto
// AiAgentConfig.programScope (see aiAgentConfig.ts) for fast reads on the hot
// bot-reply path.
//
// Faz 2 (RAG) adds admin-managed external knowledge: type='file' (PDF/Word/
// Excel upload), type='url' (scraped web page), type='text' (free-text note).
// For these, `config` holds source-specific metadata (objectPath/url/rawText,
// mimeType, extractedChars) and the extracted text is chunked + embedded into
// the sibling `knowledge_chunks` table (never into `config` itself — jsonb is
// not the place for large blobs or vectors). `status` tracks the ingestion
// pipeline: pending → processing → ready | error. This file intentionally
// keeps `config` as untyped jsonb so future source types don't require a
// schema migration.
// ---------------------------------------------------------------------------

export const knowledgeSourceTypeValues = [
  "program_scope",
  "url",
  "file",
  "text",
  "webhook",
  "conversation",
] as const;
export type KnowledgeSourceType = (typeof knowledgeSourceTypeValues)[number];

export const knowledgeSourcesTable = pgTable("knowledge_sources", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(),
  name: text("name").notNull(),
  config: jsonb("config").notNull().default({}),
  isActive: boolean("is_active").notNull().default(true),
  status: text("status"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type KnowledgeSource = typeof knowledgeSourcesTable.$inferSelect;
export type InsertKnowledgeSource = typeof knowledgeSourcesTable.$inferInsert;

// ---------------------------------------------------------------------------
// Table — knowledge_chunks (AI Agent Faz 2 — RAG)
//
// Chunked + embedded text extracted from a `file`/`url`/`text` knowledge
// source. Retrieval (knowledgeRetrieval.ts) embeds the student's message and
// pulls the top-K chunks by cosine distance (pgvector `<=>` operator) from
// ACTIVE sources only, injecting them into the bot system prompt as untrusted
// data (never as instructions). `embedding` uses OpenAI text-embedding-3-small
// (1536 dims), called directly against the OpenAI API — the AI Integrations
// proxy does not support embeddings.
// ---------------------------------------------------------------------------

const vector1536 = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return "vector(1536)";
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: string): number[] {
    return value
      .slice(1, -1)
      .split(",")
      .filter((s) => s.length > 0)
      .map(Number);
  },
});

export const knowledgeChunksTable = pgTable("knowledge_chunks", {
  id: serial("id").primaryKey(),
  sourceId: integer("source_id")
    .notNull()
    .references(() => knowledgeSourcesTable.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  embedding: vector1536("embedding"),
  tokenCount: integer("token_count").notNull().default(0),
  chunkIndex: integer("chunk_index").notNull().default(0),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type KnowledgeChunk = typeof knowledgeChunksTable.$inferSelect;
export type InsertKnowledgeChunk = typeof knowledgeChunksTable.$inferInsert;
