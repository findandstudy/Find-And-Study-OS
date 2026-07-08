import { pgTable, serial, text, boolean, jsonb, timestamp } from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Table — knowledge_sources (AI Agent Faz 1 scaffold)
//
// A generic registry of sources the AI intake agent may draw live information
// from. Faz 1 ships exactly one row, type='program_scope', whose `config` is
// the { enabled, countries, universityTypes } scope object also mirrored onto
// AiAgentConfig.programScope (see aiAgentConfig.ts) for fast reads on the hot
// bot-reply path. Faz 2/3 will add url/file/webhook/conversation rows to the
// same table — this file intentionally keeps `config` as untyped jsonb so
// future source types don't require a schema migration.
// ---------------------------------------------------------------------------

export const knowledgeSourceTypeValues = [
  "program_scope",
  "url",
  "file",
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
