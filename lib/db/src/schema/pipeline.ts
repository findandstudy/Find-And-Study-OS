import { pgTable, serial, text, integer, timestamp, uniqueIndex, boolean } from "drizzle-orm/pg-core";

export const pipelineStagesTable = pgTable("pipeline_stages", {
  id: serial("id").primaryKey(),
  entityType: text("entity_type").notNull(),
  key: text("key").notNull(),
  label: text("label").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  variant: text("variant"),
  icon: text("icon"),
  color: text("color"),
  isNotesMandatory: boolean("is_notes_mandatory").notNull().default(false),
  canAttachFile: boolean("can_attach_file").notNull().default(false),
  maxFiles: integer("max_files").notNull().default(1),
  isFileUploadMandatory: boolean("is_file_upload_mandatory").notNull().default(false),
  canGoBack: boolean("can_go_back").notNull().default(true),
  isCaseClose: boolean("is_case_close").notNull().default(false),
  countries: text("countries"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("pipeline_stages_entity_key_uniq").on(table.entityType, table.key),
]);

export type PipelineStage = typeof pipelineStagesTable.$inferSelect;
export type InsertPipelineStage = typeof pipelineStagesTable.$inferInsert;
