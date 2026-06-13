import {
  pgTable,
  pgEnum,
  serial,
  boolean,
  jsonb,
  timestamp,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const portalAutomationModeEnum = pgEnum("portal_automation_mode", [
  "dry",
  "real",
]);

export const portalAutomationScopeEnum = pgEnum("portal_automation_scope", [
  "only_applied",
  "selected",
  "all",
]);

// ---------------------------------------------------------------------------
// Table — single-row global settings
// ---------------------------------------------------------------------------

export const portalAutomationSettingsTable = pgTable(
  "portal_automation_settings",
  {
    id: serial("id").primaryKey(),
    isEnabled: boolean("is_enabled").notNull().default(false),
    triggerStages: jsonb("trigger_stages")
      .$type<string[]>()
      .notNull()
      .default([]),
    mode: portalAutomationModeEnum("mode").notNull().default("dry"),
    scope: portalAutomationScopeEnum("scope").notNull().default("only_applied"),
    selectedUniversityKeys: jsonb("selected_university_keys")
      .$type<string[]>()
      .notNull()
      .default([]),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
);

export type PortalAutomationSettings =
  typeof portalAutomationSettingsTable.$inferSelect;
export type InsertPortalAutomationSettings =
  typeof portalAutomationSettingsTable.$inferInsert;
