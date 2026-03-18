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

  universityType: text("university_type"),
  taxType: text("tax_type"),
  taxPercent: real("tax_percent"),
  qsRanking: integer("qs_ranking"),
  timesRanking: integer("times_ranking"),
  shanghaiRanking: integer("shanghai_ranking"),
  cwtsLeidenRanking: integer("cwts_leiden_ranking"),
  address: text("address"),
  onlinePaymentUrl: text("online_payment_url"),
  cricosLink: text("cricos_link"),
  documentsLink: text("documents_link"),
  currentFeeListLink: text("current_fee_list_link"),
  initialDepositOptions: text("initial_deposit_options"),
  admissionProcess: text("admission_process"),
  contactPersonName: text("contact_person_name"),
  contactPersonPhone: text("contact_person_phone"),
  contactPersonEmail: text("contact_person_email"),
  status: text("status").notNull().default("open"),

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
  feeType: text("fee_type"),
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
