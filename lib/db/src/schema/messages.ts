import { pgTable, serial, text, timestamp, integer, boolean, jsonb, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const conversationsTable = pgTable("conversations", {
  id: serial("id").primaryKey(),
  type: text("type").notNull().default("direct"),
  title: text("title"),
  createdById: integer("created_by_id").references(() => usersTable.id),
  isArchived: boolean("is_archived").notNull().default(false),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
  lastMessagePreview: text("last_message_preview"),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("conversations_created_by_id_idx").on(table.createdById),
]);

export const conversationParticipantsTable = pgTable("conversation_participants", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull().references(() => conversationsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  lastReadAt: timestamp("last_read_at", { withTimezone: true }),
  isMuted: boolean("is_muted").notNull().default(false),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
});

export const messagesTable = pgTable("messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull().references(() => conversationsTable.id, { onDelete: "cascade" }),
  senderId: integer("sender_id").references(() => usersTable.id),
  content: text("content").notNull(),
  channel: text("channel").notNull().default("internal"),
  status: text("status").notNull().default("sent"),
  replyToId: integer("reply_to_id"),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("messages_sender_id_idx").on(table.senderId),
  index("messages_conversation_id_idx").on(table.conversationId),
]);

export const broadcastsTable = pgTable("broadcasts", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  channel: text("channel").notNull().default("internal"),
  targetAudience: text("target_audience").notNull().default("all"),
  targetRoles: jsonb("target_roles").default([]),
  status: text("status").notNull().default("draft"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  sentById: integer("sent_by_id").references(() => usersTable.id),
  recipientCount: integer("recipient_count").default(0),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("broadcasts_sent_by_id_idx").on(table.sentById),
]);

export const messageTemplatesTable = pgTable("message_templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category").notNull().default("general"),
  subject: text("subject"),
  content: text("content").notNull(),
  channel: text("channel").notNull().default("all"),
  language: text("language").notNull().default("en"),
  variables: jsonb("variables").default([]),
  isActive: boolean("is_active").notNull().default(true),
  createdById: integer("created_by_id").references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("msg_templates_created_by_id_idx").on(table.createdById),
]);

export type Conversation = typeof conversationsTable.$inferSelect;
export type Message = typeof messagesTable.$inferSelect;
export type Broadcast = typeof broadcastsTable.$inferSelect;
export type MessageTemplate = typeof messageTemplatesTable.$inferSelect;
