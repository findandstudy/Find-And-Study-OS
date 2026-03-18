import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

export const pipelineStagesTable = pgTable("pipeline_stages", {
  id: serial("id").primaryKey(),
  entityType: text("entity_type").notNull(),
  key: text("key").notNull(),
  label: text("label").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  variant: text("variant"),
  icon: text("icon"),
  color: text("color"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type PipelineStage = typeof pipelineStagesTable.$inferSelect;
export type InsertPipelineStage = typeof pipelineStagesTable.$inferInsert;
