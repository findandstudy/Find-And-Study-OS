import { pgTable, text, serial, timestamp, integer, boolean, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const universitiesTable = pgTable("universities", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  country: text("country").notNull(),
  city: text("city"),
  website: text("website"),
  logoUrl: text("logo_url"),
  description: text("description"),
  ranking: integer("ranking"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const programsTable = pgTable("programs", {
  id: serial("id").primaryKey(),
  universityId: integer("university_id").notNull(),
  name: text("name").notNull(),
  degree: text("degree"),
  field: text("field"),
  language: text("language"),
  duration: text("duration"),
  tuitionFee: real("tuition_fee"),
  currency: text("currency").default("USD"),
  scholarship: real("scholarship"),
  intakes: text("intakes"),
  requirements: text("requirements"),
  commissionRate: real("commission_rate"),
  applicationFee: real("application_fee"),
  advancedFee: real("advanced_fee"),
  depositFee: real("deposit_fee"),
  serviceFeeAmount: real("service_fee_amount"),
  discountedFee: real("discounted_fee"),
  languageFee: real("language_fee"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertUniversitySchema = createInsertSchema(universitiesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUniversity = z.infer<typeof insertUniversitySchema>;
export type University = typeof universitiesTable.$inferSelect;

export const insertProgramSchema = createInsertSchema(programsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProgram = z.infer<typeof insertProgramSchema>;
export type Program = typeof programsTable.$inferSelect;
