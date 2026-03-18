import { pgTable, serial, integer, timestamp, unique } from "drizzle-orm/pg-core";

export const wishlistsTable = pgTable("wishlists", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  programId: integer("program_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("wishlists_user_program").on(t.userId, t.programId),
]);
