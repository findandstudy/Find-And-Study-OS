import { pgTable, serial, text, timestamp, boolean } from "drizzle-orm/pg-core";

export const emailQueueTable = pgTable("email_queue", {
  id: serial("id").primaryKey(),
  toEmail: text("to_email").notNull(),
  subject: text("subject").notNull(),
  htmlBody: text("html_body").notNull(),
  textBody: text("text_body").notNull(),
  status: text("status").notNull().default("pending"),
  sentAt: timestamp("sent_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
