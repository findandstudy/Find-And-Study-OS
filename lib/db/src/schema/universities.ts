import { pgTable, text, serial, timestamp, integer, boolean, real, jsonb, index, date, unique, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import type { CatalogSourceMetadata } from "./catalog";

export const universitiesTable = pgTable("universities", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  country: text("country").notNull(),
  city: text("city"),
  website: text("website"),
  logoUrl: text("logo_url"),
  description: text("description"),
  sourceMetadata: jsonb("source_metadata").notNull().default({}).$type<CatalogSourceMetadata>(),
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

  // Public registration matching policy. "unknown" is intentionally not
  // equivalent to accepting every nationality; the matcher reports that a
  // human/catalog check is required until verified evidence is entered.
  nationalityPolicy: text("nationality_policy").notNull().default("unknown"),
  acceptedNationalityCodes: jsonb("accepted_nationality_codes").notNull().default([]).$type<string[]>(),
  defaultRequiredEducationLevel: text("default_required_education_level"),
  defaultMinGradeValue: real("default_min_grade_value"),
  defaultGradeScale: text("default_grade_scale"),
  defaultLanguageRequirements: jsonb("default_language_requirements").notNull().default([]).$type<Array<{
    test: string;
    overall: number;
    sections?: Record<string, number>;
    validMonths?: number;
  }>>(),
  defaultConditionalAdmission: boolean("default_conditional_admission").notNull().default(false),
  admissionSourceUrl: text("admission_source_url"),
  admissionVerifiedAt: timestamp("admission_verified_at", { withTimezone: true }),
  admissionValidUntil: timestamp("admission_valid_until", { withTimezone: true }),

  // Active staff explicitly responsible for this university — they
  // also receive university-contract expiry warnings (alongside
  // active super_admin/admin/manager users).
  assignedStaffIds: jsonb("assigned_staff_ids").notNull().default([]).$type<number[]>(),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("universities_country_idx").on(table.country),
  index("universities_is_active_idx").on(table.isActive),
]);

export const programsTable = pgTable("programs", {
  id: serial("id").primaryKey(),
  universityId: integer("university_id").notNull().references(() => universitiesTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  // English is the canonical source language for programme content. Localized
  // projections live in program_translations and are regenerated whenever one
  // of the human-readable source fields changes.
  description: text("description"),
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
  enrollmentFee: real("enrollment_fee"),
  adaptationFee: real("adaptation_fee"),
  advancedFee: real("advanced_fee"),
  depositFee: real("deposit_fee"),
  serviceFeeAmount: real("service_fee_amount"),
  discountedFee: real("discounted_fee"),
  languageFee: real("language_fee"),
  feeType: text("fee_type"),
  priceValidFrom: date("price_valid_from"),
  priceValidUntil: date("price_valid_until"),
  financeNotes: text("finance_notes"),
  refundProcess: text("refund_process"),
  minGpa: real("min_gpa"),
  minLanguageScore: real("min_language_score"),
  requiredEducationLevel: text("required_education_level"),
  minGradeValue: real("min_grade_value"),
  gradeScale: text("grade_scale"),
  languageRequirements: jsonb("language_requirements").$type<Array<{
    test: string;
    overall: number;
    sections?: Record<string, number>;
    validMonths?: number;
  }>>(),
  conditionalAdmission: boolean("conditional_admission"),
  admissionSourceUrl: text("admission_source_url"),
  admissionVerifiedAt: timestamp("admission_verified_at", { withTimezone: true }),
  admissionValidUntil: timestamp("admission_valid_until", { withTimezone: true }),
  universityApplicationPeriodId: integer("university_application_period_id"),
  applicationsOpenOverrideAt: date("applications_open_override_at"),
  applicationDeadlineOverrideAt: date("application_deadline_override_at"),
  classesStartOverrideOn: date("classes_start_override_on"),
  classesEndOverrideOn: date("classes_end_override_on"),
  quota: integer("quota"),
  sourceMetadata: jsonb("source_metadata").notNull().default({}).$type<CatalogSourceMetadata>(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("programs_university_id_idx").on(table.universityId),
  index("programs_degree_idx").on(table.degree),
  index("programs_field_idx").on(table.field),
  index("programs_is_active_idx").on(table.isActive),
]);

/**
 * Verified institution-level application calendar. Teaching dates are kept
 * separate from the application window and may remain null when unknown.
 * Programs link to a row and inherit it unless an explicit override is set.
 */
export const universityApplicationPeriodsTable = pgTable("university_application_periods", {
  id: serial("id").primaryKey(),
  universityId: integer("university_id").notNull().references(() => universitiesTable.id, { onDelete: "cascade" }),
  termName: text("term_name").notNull(),
  academicYear: integer("academic_year").notNull(),
  campusName: text("campus_name"),
  applicationsOpenAt: date("applications_open_at"),
  applicationDeadlineAt: date("application_deadline_at"),
  classesStartOn: date("classes_start_on"),
  classesEndOn: date("classes_end_on"),
  sourceTimezone: text("source_timezone").notNull(),
  sourceUrl: text("source_url").notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdById: integer("created_by_id"),
  updatedById: integer("updated_by_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  unique("university_application_periods_identity_uq").on(table.universityId, table.termName, table.academicYear, table.campusName),
  index("university_application_periods_lookup_idx").on(table.universityId, table.isActive, table.applicationDeadlineAt),
  check("university_application_periods_year_chk", sql`${table.academicYear} BETWEEN 2000 AND 2200`),
  check("university_application_periods_window_chk", sql`${table.applicationDeadlineAt} IS NULL OR ${table.applicationsOpenAt} IS NULL OR ${table.applicationDeadlineAt} >= ${table.applicationsOpenAt}`),
  check("university_application_periods_teaching_window_chk", sql`${table.classesEndOn} IS NULL OR ${table.classesStartOn} IS NULL OR ${table.classesEndOn} >= ${table.classesStartOn}`),
  check("university_application_periods_timezone_chk", sql`length(trim(${table.sourceTimezone})) BETWEEN 1 AND 64`),
  check("university_application_periods_source_chk", sql`${table.sourceUrl} ~ '^https://'`),
]);

export const applicationDeadlineReminderIntentsTable = pgTable("application_deadline_reminder_intents", {
  id: serial("id").primaryKey(),
  universityApplicationPeriodId: integer("university_application_period_id").notNull().references(() => universityApplicationPeriodsTable.id, { onDelete: "cascade" }),
  subjectType: text("subject_type").notNull(),
  subjectId: integer("subject_id").notNull(),
  channel: text("channel").notNull(),
  daysBefore: integer("days_before").notNull(),
  scheduleFingerprint: text("schedule_fingerprint").notNull(),
  status: text("status").notNull().default("PREVIEW_ONLY"),
  reasonCode: text("reason_code").notNull(),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancelReason: text("cancel_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  unique("application_deadline_reminder_intents_identity_uq").on(table.universityApplicationPeriodId, table.subjectType, table.subjectId, table.channel, table.daysBefore, table.scheduleFingerprint),
  index("application_deadline_reminder_intents_period_status_idx").on(table.universityApplicationPeriodId, table.status, table.daysBefore),
  check("application_deadline_reminder_intents_subject_chk", sql`${table.subjectType} IN ('LEAD', 'APPLICATION')`),
  check("application_deadline_reminder_intents_channel_chk", sql`${table.channel} IN ('EMAIL', 'WHATSAPP')`),
  check("application_deadline_reminder_intents_days_chk", sql`${table.daysBefore} IN (30, 7)`),
  check("application_deadline_reminder_intents_status_chk", sql`${table.status} IN ('PREVIEW_ONLY', 'PENDING', 'CANCELLED', 'SENT', 'SUPPRESSED')`),
  check("application_deadline_reminder_intents_hash_chk", sql`${table.scheduleFingerprint} ~ '^[0-9a-f]{64}$'`),
]);

export const insertUniversitySchema = createInsertSchema(universitiesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUniversity = z.infer<typeof insertUniversitySchema>;
export type University = typeof universitiesTable.$inferSelect;

export const insertProgramSchema = createInsertSchema(programsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProgram = z.infer<typeof insertProgramSchema>;
export type Program = typeof programsTable.$inferSelect;
