import { pgTable, serial, text, timestamp, integer, boolean, jsonb, real } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const userSessionsTable = pgTable("user_sessions_activity", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  totalDurationSeconds: integer("total_duration_seconds").notNull().default(0),
  activeDurationSeconds: integer("active_duration_seconds").notNull().default(0),
  idleDurationSeconds: integer("idle_duration_seconds").notNull().default(0),
  endReason: text("end_reason"),
  userAgent: text("user_agent"),
  ipAddress: text("ip_address"),
  isActive: boolean("is_active").notNull().default(true),
});

export const userPageVisitsTable = pgTable("user_page_visits", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  sessionId: integer("session_id").references(() => userSessionsTable.id, { onDelete: "cascade" }),
  route: text("route").notNull(),
  moduleName: text("module_name").notNull(),
  enteredAt: timestamp("entered_at", { withTimezone: true }).notNull().defaultNow(),
  leftAt: timestamp("left_at", { withTimezone: true }),
  totalDurationSeconds: integer("total_duration_seconds").notNull().default(0),
  activeDurationSeconds: integer("active_duration_seconds").notNull().default(0),
  idleDurationSeconds: integer("idle_duration_seconds").notNull().default(0),
});

export const userActivityEventsTable = pgTable("user_activity_events", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  sessionId: integer("session_id").references(() => userSessionsTable.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(),
  route: text("route"),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const userPresenceTable = pgTable("user_presence", {
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }).primaryKey(),
  status: text("status").notNull().default("offline"),
  lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
  currentRoute: text("current_route"),
  sessionId: integer("session_id"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type UserSessionActivity = typeof userSessionsTable.$inferSelect;
export type UserPageVisit = typeof userPageVisitsTable.$inferSelect;
export type UserActivityEvent = typeof userActivityEventsTable.$inferSelect;
export type UserPresence = typeof userPresenceTable.$inferSelect;
