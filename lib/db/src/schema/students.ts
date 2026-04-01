import { pgTable, text, serial, timestamp, integer, boolean, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { agentsTable } from "./agents";

export const studentsTable = pgTable("students", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email"),
  phone: text("phone"),
  dateOfBirth: text("date_of_birth"),
  nationality: text("nationality"),
  passportNumber: text("passport_number"),
  passportIssueDate: text("passport_issue_date"),
  passportExpiry: text("passport_expiry"),
  motherName: text("mother_name"),
  fatherName: text("father_name"),
  address: text("address"),
  status: text("status").notNull().default("active"),
  agentId: integer("agent_id").references(() => agentsTable.id, { onDelete: "set null" }),
  assignedToId: integer("assigned_to_id").references(() => usersTable.id, { onDelete: "set null" }),
  highSchool: text("high_school"),
  universityBachelor: text("university_bachelor"),
  universityMaster: text("university_master"),
  graduationYear: integer("graduation_year"),
  gpa: text("gpa"),
  languageScore: text("language_score"),
  season: text("season").notNull().default("2026"),
  photoUrl: text("photo_url"),
  interestedLevel: text("interested_level"),
  notes: text("notes"),
  nextFollowup: timestamp("next_followup", { withTimezone: true }),
  originType: text("origin_type").notNull().default("direct"),
  originEntityType: text("origin_entity_type"),
  originEntityId: integer("origin_entity_id"),
  originDisplayName: text("origin_display_name"),
  originLocked: boolean("origin_locked").notNull().default(false),
  originLeadId: integer("origin_lead_id"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("students_email_idx").on(table.email),
  index("students_agent_id_idx").on(table.agentId),
  index("students_assigned_to_id_idx").on(table.assignedToId),
  index("students_status_idx").on(table.status),
  index("students_season_idx").on(table.season),
  index("students_user_id_idx").on(table.userId),
  index("students_origin_type_idx").on(table.originType),
]);

export const insertStudentSchema = createInsertSchema(studentsTable).omit({ id: true, createdAt: true, updatedAt: true, deletedAt: true });
export type InsertStudent = z.infer<typeof insertStudentSchema>;
export type Student = typeof studentsTable.$inferSelect;
