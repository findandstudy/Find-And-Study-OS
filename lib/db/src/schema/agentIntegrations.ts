import { boolean, index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { agentsTable } from "./agents";

export const agentIntegrationsTable = pgTable("agent_integrations", {
  id: serial("id").primaryKey(),
  agentId: integer("agent_id").notNull().references(() => agentsTable.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  isEnabled: boolean("is_enabled").notNull().default(false),
  // Secret values inside this JSON object are encrypted by encryptConfig.
  // Routes never return decrypted secrets; all reads are masked.
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("agent_integrations_agent_kind_uidx").on(table.agentId, table.kind),
  index("agent_integrations_agent_idx").on(table.agentId),
]);

export type AgentIntegration = typeof agentIntegrationsTable.$inferSelect;
