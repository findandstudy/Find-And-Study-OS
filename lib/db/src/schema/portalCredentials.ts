import {
  pgTable,
  serial,
  text,
  boolean,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const portalCredentialsTable = pgTable(
  "portal_credentials",
  {
    id: serial("id").primaryKey(),
    portalKey: text("portal_key").notNull(),
    usernameEnc: text("username_enc").notNull(),
    passwordEnc: text("password_enc").notNull(),
    extraEnc: text("extra_enc"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("portal_creds_portal_key_uniq").on(table.portalKey),
  ],
);

export type PortalCredential = typeof portalCredentialsTable.$inferSelect;
export type InsertPortalCredential = typeof portalCredentialsTable.$inferInsert;
