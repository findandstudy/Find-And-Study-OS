import { pgTable, text, serial, timestamp, integer, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const applicationsTable = pgTable("applications", {
  id: serial("id").primaryKey(),
  studentId: integer("student_id").notNull(),
  programId: integer("program_id"),
  universityId: integer("university_id"),
  agentId: integer("agent_id"),
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
  scholarship: real("scholarship"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertApplicationSchema = createInsertSchema(applicationsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertApplication = z.infer<typeof insertApplicationSchema>;
export type Application = typeof applicationsTable.$inferSelect;
