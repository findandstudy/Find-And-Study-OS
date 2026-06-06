import { pgTable, text, serial, timestamp, integer, boolean, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { programsTable } from "./universities";
import { leadsTable } from "./leads";

export const embedWidgetsTable = pgTable("embed_widgets", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  mode: text("mode").notNull().default("combined"),
  presetFilters: jsonb("preset_filters").notNull().default({}),
  lockedFilters: jsonb("locked_filters").notNull().default([]),
  hiddenFilters: jsonb("hidden_filters").notNull().default([]),
  visibleFilters: jsonb("visible_filters").notNull().default([]),
  theme: jsonb("theme").notNull().default({}),
  allowedDomains: jsonb("allowed_domains").notNull().default([]),
  embedApiKey: text("embed_api_key"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const embedSubmissionsTable = pgTable("embed_submissions", {
  id: serial("id").primaryKey(),
  widgetId: integer("widget_id").notNull().references(() => embedWidgetsTable.id, { onDelete: "cascade" }),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  countryCode: text("country_code"),
  nationality: text("nationality"),
  desiredLevel: text("desired_level"),
  desiredProgram: text("desired_program"),
  preferredUniversity: text("preferred_university"),
  message: text("message"),
  programId: integer("program_id").references(() => programsTable.id, { onDelete: "set null" }),
  programName: text("program_name"),
  universityName: text("university_name"),
  sourceWebsite: text("source_website"),
  sourcePageUrl: text("source_page_url"),
  utmSource: text("utm_source"),
  utmMedium: text("utm_medium"),
  utmCampaign: text("utm_campaign"),
  utmTerm: text("utm_term"),
  utmContent: text("utm_content"),
  leadId: integer("lead_id").references(() => leadsTable.id, { onDelete: "set null" }),
  aiExtractedData: jsonb("ai_extracted_data"),
  documentCount: integer("document_count").default(0),
  status: text("status").notNull().default("new"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("embed_submissions_widget_id_idx").on(table.widgetId),
  index("embed_submissions_created_at_idx").on(table.createdAt),
  index("embed_submissions_lead_id_idx").on(table.leadId),
]);

export const insertEmbedWidgetSchema = createInsertSchema(embedWidgetsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEmbedWidget = z.infer<typeof insertEmbedWidgetSchema>;
export type EmbedWidget = typeof embedWidgetsTable.$inferSelect;

export const insertEmbedSubmissionSchema = createInsertSchema(embedSubmissionsTable).omit({ id: true, createdAt: true });
export type InsertEmbedSubmission = z.infer<typeof insertEmbedSubmissionSchema>;
export type EmbedSubmission = typeof embedSubmissionsTable.$inferSelect;
