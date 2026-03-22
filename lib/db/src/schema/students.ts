import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const studentsTable = pgTable("students", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
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
  agentId: integer("agent_id"),
  assignedToId: integer("assigned_to_id"),
  highSchool: text("high_school"),
  universityBachelor: text("university_bachelor"),
  universityMaster: text("university_master"),
  graduationYear: integer("graduation_year"),
  gpa: text("gpa"),
  languageScore: text("language_score"),
  season: text("season").notNull().default("2026"),
  photoUrl: text("photo_url"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertStudentSchema = createInsertSchema(studentsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertStudent = z.infer<typeof insertStudentSchema>;
export type Student = typeof studentsTable.$inferSelect;
