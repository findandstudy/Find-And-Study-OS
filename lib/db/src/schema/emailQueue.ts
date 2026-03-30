import { pgTable, serial, text, timestamp, boolean, index } from "drizzle-orm/pg-core";

export const emailQueueTable = pgTable("email_queue", {
  id: serial("id").primaryKey(),
  toEmail: text("to_email").notNull(),
  subject: text("subject").notNull(),
  htmlBody: text("html_body").notNull(),
  textBody: text("text_body").notNull(),
  status: text("status").notNull().default("pending"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("email_queue_status_idx").on(table.status),
]);
