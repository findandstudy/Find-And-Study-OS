import { pgTable, serial, text, timestamp, integer, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { messageTemplatesTable } from "./messages";
import { channelAccountsTable } from "./inbox";
import { emailQueueTable } from "./emailQueue";

/** Immutable revisions of the existing template identity; not another template catalogue. */
export const emailTemplateVersionsTable = pgTable("message_template_email_versions", {
  id: serial("id").primaryKey(),
  templateId: integer("template_id").notNull().references(() => messageTemplatesTable.id, { onDelete: "restrict" }),
  version: integer("version").notNull(),
  status: text("status").notNull().default("draft"),
  subject: text("subject").notNull(),
  content: text("content").notNull(),
  language: text("language").notNull(),
  variables: jsonb("variables").$type<string[]>().notNull().default([]),
  createdById: integer("created_by_id").notNull(),
  approvedById: integer("approved_by_id"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [uniqueIndex("message_template_email_version_uidx").on(table.templateId, table.version)]);

/** Application-only transition intent. Delivery uses the existing email_queue. */
export const stageEmailDispatchesTable = pgTable("pipeline_stage_email_dispatches", {
  id: serial("id").primaryKey(),
  applicationId: integer("application_id").notNull(),
  studentId: integer("student_id").notNull(),
  agentId: integer("agent_id"),
  stageKey: text("stage_key").notNull(),
  templateVersionId: integer("template_version_id").notNull().references(() => emailTemplateVersionsTable.id),
  senderAccountId: integer("sender_account_id").notNull().references(() => channelAccountsTable.id),
  senderRevision: integer("sender_revision").notNull(),
  origin: text("origin").notNull(),
  status: text("status").notNull().default("queued"),
  emailQueueId: integer("email_queue_id").references(() => emailQueueTable.id),
  errorCode: text("error_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  uniqueIndex("pipeline_stage_email_dispatch_uidx").on(table.applicationId, table.stageKey),
  index("pipeline_stage_email_dispatch_claim_idx").on(table.status, table.id),
  index("pipeline_stage_email_dispatch_queue_idx").on(table.emailQueueId),
]);
