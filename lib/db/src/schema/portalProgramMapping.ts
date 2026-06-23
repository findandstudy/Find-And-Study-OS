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
    /** { "portal label": "CRM program name" } — legacy human dictionary (panel). */
    mappings: jsonb("mappings")
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    /**
     * Manual program overrides consumed by the matcher: CRM programId → portal
     * <option> value (or option text). Bypasses fuzzy matching (conf 1.0).
     * Merged OVER the adapter's built-in defaults (DB wins).
     */
    programOverrides: jsonb("program_overrides")
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    /**
     * EN↔TR synonym equivalence groups (folded single tokens) used to EXTEND
     * the matcher's built-in synonym dictionary. Never removes built-in groups.
     */
    synonyms: jsonb("synonyms")
      .$type<string[][]>()
      .notNull()
      .default([]),
    /**
     * Country name/adjective (lowercased) → portal dropdown label. Merged OVER
     * the adapter's built-in country maps (DB wins).
     */
    countryOverrides: jsonb("country_overrides")
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
