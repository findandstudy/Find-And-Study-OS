import { pgTable, text, serial, timestamp, boolean, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const documentRequirementsTable = pgTable("document_requirements", {
  id: serial("id").primaryKey(),
  documentType: text("document_type").notNull(),
  level: text("level").notNull(),
  enabled: boolean("enabled").notNull().default(false),
  mandatory: boolean("mandatory").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("doc_req_type_level_idx").on(table.documentType, table.level),
]);

export const insertDocumentRequirementSchema = createInsertSchema(documentRequirementsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDocumentRequirement = z.infer<typeof insertDocumentRequirementSchema>;
export type DocumentRequirement = typeof documentRequirementsTable.$inferSelect;
