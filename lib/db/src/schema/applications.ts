import { pgTable, text, serial, timestamp, integer, real, boolean, index, type AnyPgColumn } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { studentsTable } from "./students";
import { programsTable, universitiesTable } from "./universities";
import { agentsTable } from "./agents";
import { usersTable } from "./users";

export const applicationsTable = pgTable("applications", {
  id: serial("id").primaryKey(),
  studentId: integer("student_id").notNull().references(() => studentsTable.id, { onDelete: "cascade" }),
  programId: integer("program_id").references(() => programsTable.id, { onDelete: "set null" }),
  universityId: integer("university_id").references(() => universitiesTable.id, { onDelete: "set null" }),
  agentId: integer("agent_id").references(() => agentsTable.id, { onDelete: "set null" }),
  assignedToId: integer("assigned_to_id").references(() => usersTable.id, { onDelete: "set null" }),
  season: text("season").notNull().default("2026"),
  stage: text("stage").notNull().default("inquiry"),
  intake: text("intake"),
  level: text("level"),
  instructionLanguage: text("instruction_language"),
  deadline: text("deadline"),
  programName: text("program_name"),
  universityName: text("university_name"),
  country: text("country"),
  tuitionFee: real("tuition_fee"),
  discountedFee: real("discounted_fee"),
  scholarship: real("scholarship"),
  commissionRate: real("commission_rate"),
  serviceFeeAmount: real("service_fee_amount"),
  applicationFee: real("application_fee"),
  depositFee: real("deposit_fee"),
  advancedFee: real("advanced_fee"),
  languageFee: real("language_fee"),
  currency: text("currency").default("USD"),
  notes: text("notes"),
  campaignId: integer("campaign_id"),
  campaignName: text("campaign_name"),
  campaignType: text("campaign_type"),
  campaignPercent: real("campaign_percent"),
  originType: text("origin_type").notNull().default("direct"),
  originEntityType: text("origin_entity_type"),
  originEntityId: integer("origin_entity_id"),
  originDisplayName: text("origin_display_name"),
  originLocked: boolean("origin_locked").notNull().default(false),
  originStudentId: integer("origin_student_id"),
  branchId: integer("branch_id"),
  // Automatic backup-programme (supersession) links. When a full programme is
  // superseded by an auto-created fallback application, the original points to
  // the new one (superseded_by) and the new one points back (superseded_from).
  supersededByApplicationId: integer("superseded_by_application_id").references(
    (): AnyPgColumn => applicationsTable.id,
    { onDelete: "set null" },
  ),
  supersededFromApplicationId: integer(
    "superseded_from_application_id",
  ).references((): AnyPgColumn => applicationsTable.id, {
    onDelete: "set null",
  }),
  supersedeReason: text("supersede_reason"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deletedBy: integer("deleted_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("applications_student_id_idx").on(table.studentId),
  index("applications_program_id_idx").on(table.programId),
  index("applications_university_id_idx").on(table.universityId),
  index("applications_agent_id_idx").on(table.agentId),
  index("applications_assigned_to_id_idx").on(table.assignedToId),
  index("applications_stage_idx").on(table.stage),
  index("applications_season_idx").on(table.season),
  index("applications_origin_type_idx").on(table.originType),
]);

export const insertApplicationSchema = createInsertSchema(applicationsTable).omit({ id: true, createdAt: true, updatedAt: true, deletedAt: true });
export type InsertApplication = z.infer<typeof insertApplicationSchema>;
export type Application = typeof applicationsTable.$inferSelect;
