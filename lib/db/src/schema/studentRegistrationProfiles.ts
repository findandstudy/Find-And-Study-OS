import { pgTable, text, serial, timestamp, integer, real, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { programsTable } from "./universities";

// Pre-registration answers are student declarations, never verified evidence.
// They are linked to the provisional user only when account creation succeeds.
export const studentRegistrationProfilesTable = pgTable("student_registration_profiles", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  nationalityCode: text("nationality_code"),
  educationCountryCode: text("education_country_code"),
  completedEducationLevel: text("completed_education_level"),
  targetEducationLevel: text("target_education_level"),
  gradeValue: real("grade_value"),
  gradeScale: text("grade_scale"),
  languageTest: text("language_test"),
  languageOverall: real("language_overall"),
  languageSubscores: jsonb("language_subscores").notNull().default({}).$type<Record<string, number>>(),
  languageTestDate: timestamp("language_test_date", { withTimezone: true }),
  preferredCountryCodes: jsonb("preferred_country_codes").notNull().default([]).$type<string[]>(),
  preferredFields: jsonb("preferred_fields").notNull().default([]).$type<string[]>(),
  budgetAmount: real("budget_amount"),
  budgetCurrency: text("budget_currency"),
  fundingSource: text("funding_source"),
  selectedProgramId: integer("selected_program_id").references(() => programsTable.id, { onDelete: "set null" }),
  declarationStatus: text("declaration_status").notNull().default("declared"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("student_registration_profiles_user_uniq").on(table.userId),
  index("student_registration_profiles_selected_program_idx").on(table.selectedProgramId),
]);

export type StudentRegistrationProfile = typeof studentRegistrationProfilesTable.$inferSelect;
export type InsertStudentRegistrationProfile = typeof studentRegistrationProfilesTable.$inferInsert;
