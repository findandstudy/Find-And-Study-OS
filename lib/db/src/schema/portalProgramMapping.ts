import {
  pgTable,
  serial,
  text,
  jsonb,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Table — per-university program name translation dictionary
// Stores a { "portal label" → "CRM program name" } override map.
// ---------------------------------------------------------------------------

export const portalProgramMappingTable = pgTable(
  "portal_program_mapping",
  {
    id: serial("id").primaryKey(),
    universityKey: text("university_key").notNull(),
    /** { "portal label": "CRM program name" } */
    mappings: jsonb("mappings")
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("portal_prog_map_key_uniq").on(table.universityKey),
  ],
);

export type PortalProgramMapping =
  typeof portalProgramMappingTable.$inferSelect;
export type InsertPortalProgramMapping =
  typeof portalProgramMappingTable.$inferInsert;
